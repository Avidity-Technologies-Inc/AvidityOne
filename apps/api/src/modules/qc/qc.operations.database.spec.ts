import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { QcService } from "./qc.service";
import { QcWorkService } from "./qc.work.service";
import { QcReportsService } from "./qc.reports.service";
import { emptyQcConfiguration } from "@avidity/shared/dist";
import { AuthenticatedUser } from "../auth/auth.types";
const databaseUrl = process.env.QC_TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)("QC operational follow-through in isolated PostgreSQL", () => {
  let db: PrismaService, qc: QcService, manager: AuthenticatedUser, technician: AuthenticatedUser, rubricId: string, clientId: string;
  const criteria = [{ id: "resolution", label: "Resolution evidence", weight: 1, critical: true, allowNotApplicable: false }];
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (target.hostname !== "127.0.0.1" || target.port !== "55473" || target.pathname !== "/qc_validation") throw new Error("Dedicated synthetic QC database required.");
    db = new PrismaService({ datasources: { db: { url: databaseUrl } } }); await db.$connect(); qc = new QcService(db);
    const org = await db.organization.create({ data: { name: `QC operations ${randomUUID()}` } });
    const createUser = (firstName: string) => db.user.create({ data: { organizationId: org.id, email: `${randomUUID()}@example.invalid`, firstName, lastName: "Synthetic", passwordHash: "unusable-fixture", forcePasswordChange: false } });
    manager = { ...await createUser("Reviewer"), permissions: ["qc.view", "qc.view_all", "qc.reviews_perform", "qc.coaching_manage", "qc.flags_override", "qc.settings_manage", "qc.export_internal", "qc.export_client"] };
    technician = { ...await createUser("Action owner"), permissions: ["qc.view", "qc.actions_complete_own"] };
    clientId = (await db.client.create({ data: { organizationId: org.id, name: "Synthetic QC client" } })).id;
    await qc.saveProgram({ version: 0, captureEnabled: true, processingEnabled: false, deliveryEnabled: false, reason: "Synthetic operational tests", configuration: { ...emptyQcConfiguration(), failureConsequence: "COACHING" } }, manager);
    const rubric = await qc.createRubric({ name: "Synthetic operations", kind: "SERVICE", revision: 1, passThreshold: 80, reinspectionCount: 0, criteria }, manager); rubricId = rubric.id;
    await qc.publish("rubric", rubricId, manager);
  });
  afterAll(async () => { await db?.$disconnect(); });
  async function review(failed = false) {
    const ticket = await db.ticket.create({ data: { organizationId: manager.organizationId, clientId, assignedUserId: technician.id, ticketNumber: `QC-${randomUUID()}`, subject: "Synthetic follow-through" } });
    const item = await qc.createReview({ ticketId: ticket.id, reason: "Synthetic selection" }, manager);
    await qc.transition(item.id, { version: item.version, action: "START" }, manager);
    if (failed) await qc.score(item.id, { version: (await qc.review(item.id, manager)).version, rubricId, results: [{ criterionId: "resolution", outcome: "FAIL", comment: "Missing verification" }] }, manager);
    return qc.review(item.id, manager);
  }
  it("persists partial drafts, guards versions and prevents other reviewers from changing them", async () => {
    const item = await review(); const input = { version: item.version, rubricId, results: [{ criterionId: "resolution", outcome: "FAIL" as const, comment: "Work in progress" }] };
    await qc.saveDraft(item.id, input, manager);
    const saved = await qc.review(item.id, manager); expect(saved.results).toEqual(input.results); expect(saved.draftSavedAt).not.toBeNull(); expect(saved.finalizedAt).toBeNull();
    await expect(qc.saveDraft(item.id, input, manager)).rejects.toThrow("changed");
    await expect(qc.saveDraft(item.id, { ...input, version: saved.version }, technician)).rejects.toThrow("assigned reviewer");
    await qc.score(item.id, { ...input, version: saved.version }, manager);
    await expect(qc.saveDraft(item.id, { ...input, version: saved.version + 1 }, manager)).rejects.toThrow("open inspection");
  });
  it("requires follow-up on failure or a documented authorized exception", async () => {
    const item = await review(true);
    await expect(qc.transition(item.id, { action: "CLOSE", version: item.version }, manager)).rejects.toThrow("requires verified coaching");
    await expect(qc.transition(item.id, { action: "CLOSE", version: item.version, reason: "Reviewed exception" }, { ...manager, permissions: manager.permissions.filter(p => p !== "qc.coaching_manage") })).rejects.toThrow();
    await qc.transition(item.id, { action: "CLOSE", version: item.version, reason: "Duplicate remedial work already verified" }, manager);
    expect((await qc.review(item.id, manager)).history.find(event => event.action === "review_closed")?.metadata).toMatchObject({ followUpException: true });
  });
  it("links a criterion, reassigns with fresh acknowledgment and returns inadequate evidence", async () => {
    const item = await review(true);
    const input = { reviewId: item.id, ownerId: technician.id, kind: "CORRECTIVE" as const, title: "Verify correction", note: "Document the resolution", dueAt: new Date(Date.now() - 1000).toISOString() };
    await expect(qc.createAction({ ...input, criterionId: "foreign" }, manager)).rejects.toThrow("criterion");
    const action = await qc.createAction({ ...input, criterionId: "resolution" }, manager);
    expect((await qc.review(item.id, manager)).actions[0].owner?.id).toBe(technician.id);
    await qc.updateAction(action.id, { version: 0, action: "ACKNOWLEDGE" }, technician);
    await qc.editAction(action.id, { ...input, version: 1, ownerId: manager.id, reason: "Supervisor takes ownership" }, manager);
    const reassigned = await db.qcAction.findUniqueOrThrow({ where: { id: action.id } }); expect(reassigned.status).toBe("OPEN"); expect(reassigned.acknowledgedAt).toBeNull();
    const owner = { ...manager, permissions: [...manager.permissions, "qc.actions_complete_own"] };
    await qc.updateAction(action.id, { version: 2, action: "ACKNOWLEDGE" }, owner);
    await qc.updateAction(action.id, { version: 3, action: "COMPLETE", evidence: "First evidence" }, owner);
    await expect(qc.updateAction(action.id, { version: 4, action: "RETURN" }, manager)).rejects.toThrow("explanation");
    await qc.updateAction(action.id, { version: 4, action: "RETURN", evidence: "Include customer verification" }, manager);
    expect((await db.qcAction.findUniqueOrThrow({ where: { id: action.id } })).completedAt).toBeNull();
    await qc.updateAction(action.id, { version: 5, action: "COMPLETE", evidence: "Customer verification recorded" }, owner);
    await expect(qc.transition(item.id, { action: "CLOSE", version: (await qc.review(item.id, manager)).version }, manager)).rejects.toThrow("Verify all");
    await qc.updateAction(action.id, { version: 6, action: "VERIFY" }, manager);
    await qc.transition(item.id, { action: "CLOSE", version: (await qc.review(item.id, manager)).version }, manager);
    const history = await qc.actionHistory(action.id, manager); expect(history.map(event => event.action)).toContain("action_return");
    expect(history.find(event => event.action === "action_updated")?.metadata).toMatchObject({ before: { ownerId: technician.id }, after: { ownerId: manager.id } });
    await expect(qc.actionHistory(action.id, technician)).rejects.toThrow("unavailable");
    await expect(qc.editAction(action.id, { ...input, version: 7, reason: "Edit verified" }, manager)).rejects.toThrow("Only open");
  });
  it("serializes review closure against creation of new follow-up", async () => {
    const item = await review(true);
    await Promise.allSettled([
      qc.transition(item.id, { version: item.version, action: "CLOSE", reason: "Verified exception" }, manager),
      qc.createAction({ reviewId: item.id, ownerId: technician.id, kind: "COACHING", title: "Concurrent follow-up", note: "Must not appear on a closed inspection" }, manager)
    ]);
    const result = await qc.review(item.id, manager);
    expect(result.status === "CLOSED" && result.actions.some(action => action.status !== "VERIFIED")).toBe(false);
    expect(result.status === "CLOSED" || result.actions.length === 1).toBe(true);
  });
  it("rolls back a bulk assignment when one selected review has a stale version", async () => {
    const first = await review(), second = await review();
    const eligibility = jest.spyOn(qc, "lookups").mockResolvedValue({ reviewers: [{ id: manager.id }] } as never);
    try {
      await expect(qc.bulkAssign({ reviewerId: manager.id, reason: "Synthetic bulk assignment", items: [{ id: first.id, version: first.version }, { id: second.id, version: second.version - 1 }] }, manager)).rejects.toThrow("No assignments");
      expect((await qc.review(first.id, manager)).version).toBe(first.version);
      expect((await qc.review(first.id, manager)).history.some(event => event.action === "review_assigned")).toBe(false);
      await qc.bulkAssign({ reviewerId: manager.id, reason: "Synthetic eligible assignment", items: [{ id: first.id, version: first.version }, { id: second.id, version: second.version }] }, manager);
      expect((await qc.review(second.id, manager)).version).toBe(second.version + 1);
    } finally { eligibility.mockRestore(); }
  });
  it("filters action ownership, due dates and queue exclusions without treating exclusions as passes", async () => {
    const item = await review(true);
    await qc.createAction({ reviewId: item.id, ownerId: technician.id, kind: "COACHING", title: "Unique search follow-up", note: "Synthetic feedback", dueAt: new Date(Date.now() - 60000).toISOString() }, manager);
    const page = await qc.actionPage(technician, { search: "Unique search", overdue: "true", clientId }); expect(page.total).toBe(1); expect(page.items[0].ownerId).toBe(technician.id);
    await expect(qc.actionPage(technician, { ownerId: manager.id })).rejects.toThrow("restricted");
    const unscored = await review(); await qc.transition(unscored.id, { version: unscored.version, action: "EXCLUDE", reason: "Synthetic test record" }, manager);
    expect((await qc.listReviews({ status: "EXCLUDED", search: "follow-through", clientId }, manager)).items.map(row => row.id)).toContain(unscored.id);
    expect((await qc.listReviews({ ticketId: unscored.ticketId!, clientId: randomUUID() }, manager)).total).toBe(0);
    await expect(qc.transition(item.id, { version: (await qc.review(item.id, manager)).version, action: "EXCLUDE", reason: "Discard failure" }, manager)).rejects.toThrow("unscored");
  });
  it("edits drafts optimistically and keeps published rubric revisions immutable", async () => {
    const input = { name: `Draft ${randomUUID()}`, kind: "SERVICE" as const, revision: 1, passThreshold: 80, reinspectionCount: 0, criteria };
    const draft = await qc.createRubric(input, manager); const row = await db.qcRubric.findUniqueOrThrow({ where: { id: draft.id } });
    await qc.createRubric({ ...input, passThreshold: 85 }, manager, { id: row.id, expectedUpdatedAt: row.updatedAt.toISOString() });
    await expect(qc.createRubric(input, manager, { id: row.id, expectedUpdatedAt: row.updatedAt.toISOString() })).rejects.toThrow("changed");
    await qc.publish("rubric", row.id, manager);
    const current = await db.qcRubric.findUniqueOrThrow({ where: { id: row.id } });
    await expect(qc.createRubric(input, manager, { id: row.id, expectedUpdatedAt: current.updatedAt.toISOString() })).rejects.toThrow("published");
  });
  it("preserves creative history through reassignment and cancellation without activating processing", async () => {
    const work = new QcWorkService(qc);
    const project = await db.project.create({ data: { organizationId: manager.organizationId, clientId, ownerId: manager.id, name: "Synthetic creative project" } });
    const item = await work.createDeliverable({ projectId: project.id, ownerId: technician.id, name: "Original creative proof", kind: "Artwork", dueAt: new Date(Date.now() + 86400000).toISOString() }, manager);
    await work.editDeliverable(item.id, { version: 0, ownerId: manager.id, name: "Updated creative proof", kind: "Artwork", reason: "Change responsible specialist" }, manager);
    await expect(work.editDeliverable(item.id, { version: 0, ownerId: technician.id, name: "Stale overwrite", kind: "Artwork", reason: "Stale tab" }, manager)).rejects.toThrow("changed");
    await work.updateDeliverable(item.id, { version: 1, action: "PROOF_SENT", note: "Synthetic proof recorded" }, manager);
    expect(await db.qcReview.count({ where: { deliverableId: item.id } })).toBe(0);
    await work.updateDeliverable(item.id, { version: 2, action: "CANCEL", note: "Work no longer needed" }, manager);
    const cancelled = await work.deliverable(item.id, manager); expect(cancelled.status).toBe("CANCELLED"); expect(cancelled.dueAt).toEqual(item.dueAt); expect(cancelled.history.map(event => event.action)).toContain("deliverable_details_updated");
    await expect(work.updateDeliverable(item.id, { version: 3, action: "APPROVED", note: "Invalid transition" }, manager)).rejects.toThrow("Cancelled");
    expect((await new QcReportsService(qc).overview({ projectId: project.id }, manager)).creative.total).toBe(0);
  });
  it("exports selected internal sections while keeping client exports free of inspection feedback", async () => {
    const reports = new QcReportsService(qc);
    const internal = await reports.exportFile({ format: "csv", sections: "quality", clientId }, manager, false);
    expect(internal.toString()).toContain("Inspection and follow-up"); expect(internal.toString()).not.toContain("Technician scorecards");
    const safe = await reports.exportFile({ format: "csv", sections: "service", clientId }, manager, true);
    expect(safe.toString()).toContain("Synthetic QC client"); expect(safe.toString()).not.toContain("Missing verification"); expect(safe.toString()).not.toContain("Document the resolution");
  });
});
