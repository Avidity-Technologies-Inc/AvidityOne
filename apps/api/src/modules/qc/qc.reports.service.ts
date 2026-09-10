import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { QcQueryDto } from "./dto/qc.dto";
import { QcService } from "./qc.service";
import { requireValue } from "./qc.rules";
import { QcClock } from "./qc.measurement";

export const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100 : null;
export function aggregateCycles(cycles: Array<{ complete: boolean; measurement: unknown }>) {
  const complete = cycles.filter(cycle => cycle.complete);
  const clocks = complete.flatMap(cycle => (cycle.measurement as { clocks?: QcClock[] }).clocks ?? []);
  const first = clocks.filter(clock => clock.kind === "FIRST_RESPONSE" && clock.stoppedAt);
  const resolution = clocks.filter(clock => clock.kind === "RESOLUTION" && clock.stoppedAt);
  const reconstructed = cycles.filter(cycle => (cycle.measurement as { observed?: { origin?: string } }).observed?.origin === "HISTORICAL").map(cycle => (cycle.measurement as { observed: { firstResponseElapsedMinutes: number | null; resolutionElapsedMinutes: number | null } }).observed);
  const historicalResponses = reconstructed.map(item => item.firstResponseElapsedMinutes).filter((value): value is number => value !== null && Number.isFinite(value));
  const historicalResolutions = reconstructed.map(item => item.resolutionElapsedMinutes).filter((value): value is number => value !== null && Number.isFinite(value));
  const evaluated = clocks.filter(clock => clock.stoppedAt || clock.state === "BREACHED");
  return { historical: { cycles: reconstructed.length, firstResponseSample: historicalResponses.length, averageFirstResponseElapsedMinutes: average(historicalResponses), resolutionSample: historicalResolutions.length, averageResolutionElapsedMinutes: average(historicalResolutions), basis: "Elapsed time from retained events, without reconstructed pauses or contractual compliance claims" }, cycles: cycles.length, completeCycles: complete.length, incompleteCycles: cycles.length - complete.length, firstResponseSample: first.length, averageFirstResponseBusinessMinutes: average(first.map(clock => clock.elapsedMinutes)), resolutionSample: resolution.length, averageResolutionBusinessMinutes: average(resolution.map(clock => clock.elapsedMinutes)), evaluatedObligations: evaluated.length, breachedObligations: evaluated.filter(clock => clock.state === "BREACHED").length, slaCompliancePercent: evaluated.length ? Math.round(evaluated.filter(clock => clock.state !== "BREACHED").length / evaluated.length * 10000) / 100 : null };
}
@Injectable()
export class QcReportsService {
  constructor(private readonly qc: QcService) {}
  where(query: QcQueryDto, user: AuthenticatedUser): Prisma.QcCycleWhereInput {
    requireValue(!query.from || !query.to || new Date(query.from) <= new Date(query.to), "Report end must follow its start.");
    requireValue(!query.ownerId || user.permissions.includes("qc.view_all") || query.ownerId === user.id, "You can only report on your own work.");
    return { organizationId: user.organizationId, ...(!user.permissions.includes("qc.view_all") ? { ownerId: user.id } : query.ownerId ? { ownerId: query.ownerId } : {}), ...(query.clientId ? { clientId: query.clientId } : {}), ...(query.projectId ? { ticket: { projectWorkItems: { some: { projectId: query.projectId } } } } : {}), ...(query.from || query.to ? { startedAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}) };
  }
  async overview(query: QcQueryDto, user: AuthenticatedUser) {
    const where = this.where(query, user);
    const [cycles, reviews, actions, deliverables, program, backlog, reinspection, completed] = await Promise.all([
      this.qc.prisma.qcCycle.findMany({ where, orderBy: { startedAt: "desc" }, take: 10001 }),
      this.qc.prisma.qcReview.findMany({ where: this.qc.reviewWhere(user, query), select: { id: true, ownerId: true, status: true, score: true, createdAt: true, finalizedAt: true, selectionReasons: true, _count: { select: { findings: true } } }, take: 10001 }),
      this.qc.prisma.qcAction.findMany({ where: { organizationId: user.organizationId, ...(!user.permissions.includes("qc.view_all") ? { ownerId: user.id } : {}), review: this.qc.reviewWhere(user, query) }, select: { kind: true, status: true, dueAt: true }, take: 10001 }),
      this.qc.prisma.qcDeliverable.findMany({ where: { organizationId: user.organizationId, ...(!user.permissions.includes("qc.view_all") ? { ownerId: user.id } : query.ownerId ? { ownerId: query.ownerId } : {}), ...(query.clientId ? { project: { clientId: query.clientId } } : {}), ...(query.projectId ? { projectId: query.projectId } : {}), ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}) }, select: { id: true, dueAt: true, deliveredAt: true, status: true, history: { where: { action: { in: ["deliverable_created", "deliverable_revision"] } }, select: { action: true, metadata: true } } }, take: 10001 }),
      this.qc.program(user), this.qc.prisma.qcWorkEvent.count({ where: { organizationId: user.organizationId, receipt: null } }), this.qc.prisma.qcReinspection.aggregate({ where: { organizationId: user.organizationId, ...(!user.permissions.includes("qc.view_all") ? { technicianId: user.id } : query.ownerId ? { technicianId: query.ownerId } : {}) }, _sum: { remaining: true } }),
      this.qc.prisma.qcReview.findMany({ where: { ...this.qc.reviewWhere(user, { clientId: query.clientId, ownerId: query.ownerId, projectId: query.projectId }), finalizedAt: { not: null, ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }, select: { selectionReasons: true }, take: 10001 })
    ]);
    requireValue([cycles, reviews, actions, deliverables, completed].every(rows => rows.length <= 10000), "Narrow the report period or scope to at most 10,000 records per dataset.");
    const scored = reviews.filter(review => review.score !== null);
    const delivered = deliverables.filter(item => item.deliveredAt);
    const originalDue = (item: typeof deliverables[number]) => {
      const value = (item.history.find(event => event.action === "deliverable_created")?.metadata as { dueAt?: string } | undefined)?.dueAt;
      return value ? new Date(value) : null;
    };
    const originalCohort = delivered.filter(item => originalDue(item));
    const reopens = cycles.filter(cycle => (cycle.measurement as { observed?: { reopened?: boolean } }).observed?.reopened).length;
    const technicians = [...new Set([...cycles.map(cycle => cycle.ownerId), ...reviews.map(review => review.ownerId)])].filter((id): id is string => Boolean(id)).map(ownerId => {
      const rows = cycles.filter(cycle => cycle.ownerId === ownerId), inspections = scored.filter(review => review.ownerId === ownerId);
      return { ownerId, ...aggregateCycles(rows), inspected: inspections.length, averageScore: average(inspections.map(review => review.score!)), passRatePercent: inspections.length ? Math.round(inspections.filter(review => !review.selectionReasons.includes("FAILED_RESULT")).length / inspections.length * 10000) / 100 : null };
    });
    const groups = new Map<string, typeof cycles>();
    for (const cycle of cycles) { const day = cycle.startedAt.toISOString().slice(0, 10); groups.set(day, [...(groups.get(day) ?? []), cycle]); }
    return { generatedAt: new Date(), period: { from: query.from ?? null, to: query.to ?? null, cohort: "Work cycles started in the period; reviews created in the period; deliverables created in the period" }, program: { lastProcessingAt: user.permissions.includes("qc.view_all") ? program.lastProcessingAt : null, processingErrorCode: user.permissions.includes("qc.view_all") ? program.processingErrorCode : null, captureEnabled: program.captureEnabled, processingEnabled: program.processingEnabled, startedAt: program.startedAt, readiness: program.readiness }, pendingSourceEvents: user.permissions.includes("qc.view_all") ? backlog : null, service: aggregateCycles(cycles), technicians, rework: { reopenedCycles: reopens, observedCycles: cycles.length, reopenCyclePercent: cycles.length ? Math.round(reopens / cycles.length * 10000) / 100 : null }, quality: { completedInPeriod: completed.length, failedInPeriod: completed.filter(item => item.selectionReasons.includes("FAILED_RESULT")).length, passRatePercent: scored.length ? Math.round(scored.filter(review => !review.selectionReasons.includes("FAILED_RESULT")).length / scored.length * 10000) / 100 : null, selected: reviews.length, scored: scored.length, averageScore: average(scored.map(review => review.score!)), passed: scored.filter(review => !["FAILED", "COACHING_ISSUED"].includes(review.status) && !review.selectionReasons.includes("FAILED_RESULT")).length, pending: reviews.filter(review => ["PENDING", "IN_REVIEW"].includes(review.status)).length, flags: reviews.reduce((sum, review) => sum + review._count.findings, 0), bulkCleared: reviews.filter(review => review.status === "BULK_CLEARED").length }, followUp: { reinspectionRemaining: reinspection._sum.remaining ?? 0, open: actions.filter(item => item.status !== "VERIFIED").length, overdue: actions.filter(item => item.status !== "VERIFIED" && item.dueAt && item.dueAt < new Date()).length, recognition: actions.filter(item => item.kind === "RECOGNITION").length }, creative: { originalCommitmentOnTime: originalCohort.filter(item => item.deliveredAt! <= originalDue(item)!).length, originalCommitmentSample: originalCohort.length, total: deliverables.length, delivered: delivered.length, onTime: delivered.filter(item => item.deliveredAt! <= item.dueAt).length, overdue: deliverables.filter(item => !item.deliveredAt && item.dueAt < new Date()).length, averageRevisionRounds: average(deliverables.map(item => item.history.filter(event => event.action === "deliverable_revision").length)) }, trends: [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, rows]) => ({ day, ...aggregateCycles(rows) })) };
  }
  async clientExport(query: QcQueryDto, user: AuthenticatedUser) {
    requireValue(query.clientId, "Select one client for the external report.");
    const client = await this.qc.prisma.client.findFirst({ where: { id: query.clientId, organizationId: user.organizationId, deletedAt: null }, select: { name: true } });
    requireValue(client, "Client is unavailable.");
    // Deliberate safe projection: private reviews, users, coaching and evidence are never loaded.
    this.where(query, user);
    const owner = user.permissions.includes("qc.view_all") ? query.ownerId : user.id;
    const cycles = await this.qc.prisma.$queryRaw<Array<{ complete: boolean; measurement: unknown }>>(Prisma.sql`
      SELECT c.complete, jsonb_build_object('clocks', c.measurement->'clocks', 'observed', c.measurement->'observed') AS measurement
      FROM qc_cycles c WHERE c."organizationId" = ${user.organizationId}::uuid AND c."clientId" = ${query.clientId}::uuid
      ${owner ? Prisma.sql`AND c."ownerId" = ${owner}::uuid` : Prisma.empty}
      ${query.from ? Prisma.sql`AND c."startedAt" >= ${new Date(query.from)}` : Prisma.empty}
      ${query.to ? Prisma.sql`AND c."startedAt" <= ${new Date(query.to)}` : Prisma.empty}
      ${query.projectId ? Prisma.sql`AND EXISTS (SELECT 1 FROM project_work_items w WHERE w."ticketId"=c."ticketId" AND w."projectId"=${query.projectId}::uuid)` : Prisma.empty}
      LIMIT 10001`);
    requireValue(cycles.length <= 10000, "Narrow the export period.");
    const metrics = aggregateCycles(cycles);
    await this.qc.prisma.$transaction(tx => this.qc.history(tx, user, "client_report_exported", { clientId: query.clientId, from: query.from, to: query.to, records: cycles.length }));
    return { client: client.name, generatedAt: new Date().toISOString(), from: query.from ?? null, to: query.to ?? null, coverage: "Incomplete evidence is excluded from contractual compliance calculations.", ...metrics };
  }
}
