import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { QcService } from "./qc.service";
import { QcWorkService } from "./qc.work.service";
import { QcEngineService } from "./qc.engine.service";
import { QcReportsService } from "./qc.reports.service";
import { emptyQcConfiguration } from "@avidity/shared/dist";
import { AuthenticatedUser } from "../auth/auth.types";
import { importHistoricalBatch } from "./qc.history-import";

const databaseUrl = process.env.QC_TEST_DATABASE_URL;
const databaseTests = databaseUrl ? describe : describe.skip;
databaseTests("QC isolated PostgreSQL workflows", () => {
  let prisma: PrismaService; let qc: QcService; let work: QcWorkService; let engine: QcEngineService;
  let user: AuthenticatedUser; let other: AuthenticatedUser; let clientId: string; let ticketId: string; let reviewId: string;
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (target.hostname !== "127.0.0.1" || target.port !== "55473" || target.pathname !== "/qc_validation") throw new Error("QC database tests require the dedicated local synthetic database.");
    prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } }); await prisma.$connect(); qc = new QcService(prisma); work = new QcWorkService(qc); engine = new QcEngineService(prisma);
    const organization = await prisma.organization.create({ data: { name: `QC synthetic ${randomUUID()}` } });
    const makeUser = async (name: string) => prisma.user.create({ data: { organizationId: organization.id, email: `${randomUUID()}@example.invalid`, firstName: name, lastName: "Synthetic", passwordHash: "unusable-synthetic-fixture", forcePasswordChange: false } });
    const primary = await makeUser("Reviewer"), secondary = await makeUser("Technician");
    const permissions = ["qc.view", "qc.view_all", "qc.settings_manage", "qc.reviews_perform", "qc.reviews_assign", "qc.coaching_manage", "qc.work_record", "qc.actions_complete_own", "qc.billing_release"];
    user = { ...primary, permissions }; other = { ...secondary, permissions: ["qc.view", "qc.work_record", "qc.actions_complete_own"] };
    clientId = (await prisma.client.create({ data: { organizationId: organization.id, name: "Synthetic client" } })).id;
    await qc.saveProgram({ version: 0, captureEnabled: true, processingEnabled: false, deliveryEnabled: false, reason: "Synthetic local validation", configuration: { ...emptyQcConfiguration(), ownerId: user.id, failureConsequence: "BILLING_HOLD", historicalMeasurement: "INCLUDE_HISTORY", samplingPercent: 20, samplingPeriodDays: 7, samplingMinimum: 1, samplingDimensions: ["TECHNICIAN"], flags: [{ code: "UNDOCUMENTED_CLOSE", enabled: true, severity: "HIGH", threshold: null }] } }, user);
    ticketId = (await prisma.ticket.create({ data: { organizationId: organization.id, clientId, assignedUserId: user.id, subject: "Synthetic response evidence", ticketNumber: `QC-${randomUUID()}` } })).id;
  });
  afterAll(async () => { await prisma?.$disconnect(); });
  it("captures ticket creation but excludes first-read and unrelated updates", async () => {
    expect(await prisma.qcWorkEvent.count({ where: { ticketId } })).toBe(1);
    await prisma.ticket.update({ where: { id: ticketId }, data: { firstReadAt: new Date(), firstReadByUserId: user.id, subject: "Synthetic revised subject" } });
    expect(await prisma.qcWorkEvent.count({ where: { ticketId } })).toBe(1);
  });
  it("counts a human reply only after acceptance and never counts a system notice", async () => {
    const message = await prisma.ticketMessage.create({ data: { ticketId, authorUserId: user.id, direction: "OUTBOUND", visibility: "PUBLIC", bodyText: "Synthetic response" } });
    await prisma.ticketMessage.create({ data: { ticketId, direction: "OUTBOUND", visibility: "PUBLIC", bodyText: "Synthetic automated receipt", mailDeliveryStatus: "ACCEPTED" } });
    expect(await prisma.qcWorkEvent.count({ where: { ticketId, kind: "PUBLIC_RESPONSE" } })).toBe(0);
    await prisma.ticketMessage.update({ where: { id: message.id }, data: { mailDeliveryStatus: "ACCEPTED", mailDeliveryAcceptedAt: new Date() } });
    await prisma.ticketMessage.update({ where: { id: message.id }, data: { bodyText: "Synthetic retained response" } });
    expect(await prisma.qcWorkEvent.count({ where: { ticketId, kind: "PUBLIC_RESPONSE" } })).toBe(1);
  });
  it("retains immutable events and prevents source deletion through cascade", async () => {
    const event = await prisma.qcWorkEvent.findFirstOrThrow({ where: { ticketId } });
    await expect(prisma.qcWorkEvent.update({ where: { id: event.id }, data: { occurredAt: new Date(0) } })).rejects.toThrow();
    await expect(prisma.ticket.delete({ where: { id: ticketId } })).rejects.toThrow();
    expect(await prisma.ticket.count({ where: { id: ticketId } })).toBe(1);
  });
  it("makes manual selection idempotent and rejects foreign/other-technician reads", async () => {
    const first = await qc.createReview({ ticketId, reason: "Synthetic inspection" }, user);
    const duplicate = await qc.createReview({ ticketId, reason: "Same cycle" }, user); reviewId = first.id;
    expect(duplicate.id).toBe(first.id);
    await expect(qc.review(first.id, other)).rejects.toThrow("not found");
    await expect(qc.review(first.id, { ...user, organizationId: randomUUID() })).rejects.toThrow("not found");
    await expect(work.ticket(ticketId, other)).rejects.toThrow("unavailable");
    await qc.evidence(first.id, user);
    expect(await prisma.qcWorkEvent.count({ where: { ticketId, kind: "TECHNICAL_TOUCH" } })).toBe(0);
  });
  it("prevents simultaneous reviewers from claiming the same version", async () => {
    const version = (await qc.review(reviewId, user)).version;
    const attempts = await Promise.allSettled([qc.transition(reviewId, { version, action: "START" }, user), qc.transition(reviewId, { version, action: "START" }, { ...other, permissions: user.permissions })]);
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
  });
  it("publishes immutable rubrics, scores failure and creates a billing hold", async () => {
    const rubric = await qc.createRubric({ name: `Synthetic rubric ${randomUUID()}`, kind: "SERVICE", revision: 1, passThreshold: 80, reinspectionCount: 2, criteria: [{ id: "resolution", label: "Resolution is verified", weight: 1, critical: true, allowNotApplicable: false }] }, user);
    await qc.publish("rubric", rubric.id, user);
    await expect(prisma.qcRubric.update({ where: { id: rubric.id }, data: { passThreshold: 0 } })).rejects.toThrow();
    const review = await qc.review(reviewId, user); const actor = review.reviewerId === user.id ? user : { ...other, permissions: user.permissions };
    expect(await qc.score(reviewId, { version: review.version, rubricId: rubric.id, results: [{ criterionId: "resolution", outcome: "FAIL", comment: "Synthetic failed evidence" }] }, actor)).toEqual({ score: 0, status: "FAILED" });
    expect((await qc.review(reviewId, user)).billingState).toBe("HELD");
    expect(await prisma.qcReinspection.count({ where: { reviewId } })).toBe(1);
  });
  it("requires action acknowledgment, evidence and verification before billing release", async () => {
    const action = await qc.createAction({ reviewId, ownerId: other.id, kind: "CORRECTIVE", title: "Synthetic correction", note: "Correct synthetic evidence", dueAt: new Date(Date.now() + 86400000).toISOString() }, user);
    await expect(qc.updateAction(action.id, { version: 0, action: "COMPLETE", evidence: "Attempt before acknowledgment" }, other)).rejects.toThrow();
    await qc.updateAction(action.id, { version: 0, action: "ACKNOWLEDGE" }, other);
    await qc.updateAction(action.id, { version: 1, action: "COMPLETE", evidence: "Synthetic corrected evidence" }, other);
    await expect(qc.releaseBilling(reviewId, { version: (await qc.review(reviewId, user)).version, reason: "Not verified" }, user)).rejects.toThrow("Verify");
    await qc.updateAction(action.id, { version: 2, action: "VERIFY" }, user);
    await qc.releaseBilling(reviewId, { version: (await qc.review(reviewId, user)).version, reason: "Synthetic verification accepted" }, user);
    expect((await qc.review(reviewId, user)).billingState).toBe("RELEASED");
  });
  it("appends time corrections, preserves originals and rejects conflicting corrections", async () => {
    const input = { ticketId, startedAt: new Date(Date.now() - 3600000).toISOString(), minutes: 20, description: "Synthetic completed work" };
    const original = await work.time(input, user);
    await work.time({ ...input, minutes: 25, correctionOfId: original.id }, user);
    await expect(work.time({ ...input, minutes: 30, correctionOfId: original.id }, user)).rejects.toThrow();
    await expect(prisma.qcTimeEntry.update({ where: { id: original.id }, data: { minutes: 5 } })).rejects.toThrow();
    expect((await work.ticket(ticketId, user)).timeEntries.reduce((total, entry) => total + entry.minutes, 0)).toBe(25);
  });
  it("projects a close and reopen without duplicating the original review", async () => {
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: "CLOSED", closedAt: new Date() } });
    const program = await prisma.qcProgram.findUniqueOrThrow({ where: { organizationId: user.organizationId } });
    await engine.process(program); await engine.process(program);
    expect(await prisma.qcReview.count({ where: { id: reviewId, ticketId } })).toBe(1);
    expect(await prisma.qcReview.count({ where: { ticketId, selectionReasons: { has: "FOLLOW_UP" } } })).toBe(1);
    expect(await prisma.qcFinding.count({ where: { review: { ticketId }, code: "UNDOCUMENTED_CLOSE" } })).toBe(1);
    expect((await qc.review(reviewId, user)).score).toBe(0);
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: "REOPENED", closedAt: null, reopenedAt: new Date() } });
    await engine.process(program);
    expect(await prisma.qcCycle.count({ where: { ticketId } })).toBe(2);
    expect(await prisma.qcReview.count({ where: { ticketId } })).toBe(3);
  });
  it("consumes each subsequent closure once even when reopen already selected its review", async () => {
    const program = await prisma.qcProgram.findUniqueOrThrow({ where: { organizationId: user.organizationId } });
    expect((await prisma.qcReinspection.findUniqueOrThrow({ where: { reviewId } })).remaining).toBe(2);
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: "CLOSED", closedAt: new Date() } });
    await engine.process(program); await engine.process(program);
    expect((await prisma.qcReinspection.findUniqueOrThrow({ where: { reviewId } })).remaining).toBe(1);
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: "REOPENED", closedAt: null, reopenedAt: new Date() } }); await engine.process(program);
    await prisma.ticket.update({ where: { id: ticketId }, data: { status: "CLOSED", closedAt: new Date() } }); await engine.process(program); await engine.process(program);
    expect((await prisma.qcReinspection.findUniqueOrThrow({ where: { reviewId } })).remaining).toBe(0);
    expect(await prisma.qcHistory.count({ where: { organizationId: user.organizationId, action: "reinspection_selected" } })).toBe(2);
  });
  it("imports retained history once and labels reconstructed measurements incomplete", async () => {
    const program = await prisma.qcProgram.findUniqueOrThrow({ where: { organizationId: user.organizationId } });
    const old = await prisma.ticket.create({ data: { organizationId: user.organizationId, clientId, assignedUserId: user.id, subject: "Synthetic retained historical ticket", ticketNumber: `QC-H-${randomUUID()}`, createdAt: new Date("2026-01-05T14:00:00Z") } });
    await prisma.$transaction(tx => importHistoricalBatch(tx, program));
    const count = await prisma.qcWorkEvent.count({ where: { ticketId: old.id } });
    await prisma.$transaction(tx => importHistoricalBatch(tx, program));
    expect(await prisma.qcWorkEvent.count({ where: { ticketId: old.id } })).toBe(count);
    await engine.process(program);
    expect((await prisma.qcCycle.findFirstOrThrow({ where: { ticketId: old.id } })).complete).toBe(false);
  });
  it("exports only safe client metrics and does not expose private inspection content", async () => {
    const exported = await new QcReportsService(qc).clientExport({ clientId }, user);
    const text = JSON.stringify(exported);
    for (const value of ["Synthetic failed evidence", "coaching", "reviewer", "password", "Synthetic correction"]) expect(text).not.toContain(value);
    expect(exported.client).toBe("Synthetic client");
  });
});
