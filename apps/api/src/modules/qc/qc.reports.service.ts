import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { QcExportDto, QcQueryDto } from "./dto/qc.dto";
import { QcService } from "./qc.service";
import { requireValue } from "./qc.rules";
import { QcExportTable, renderQcExport } from "./qc.export";
import { QcClock } from "./qc.measurement";

export const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100 : null;
export function reopenMetrics(cycles: Array<{ measurement: unknown }>) {
  const observed = cycles.map(cycle => (cycle.measurement as { observed?: { origin?: string; reopened?: boolean } }).observed);
  const measurable = observed.filter(item => item?.origin === "CAPTURED" && typeof item.reopened === "boolean");
  const reopenedCycles = measurable.filter(item => item?.reopened).length;
  return { reopenedCycles, observedCycles: measurable.length, unknownCycles: cycles.length - measurable.length, reopenCyclePercent: measurable.length ? Math.round(reopenedCycles / measurable.length * 10000) / 100 : null };
}
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
      this.qc.prisma.qcAction.findMany({ where: { organizationId: user.organizationId, ...(!user.permissions.includes("qc.view_all") ? { ownerId: user.id } : {}), review: this.qc.reviewWhere(user, query) }, select: { kind: true, status: true, dueAt: true, ownerId: true }, take: 10001 }),
      this.qc.prisma.qcDeliverable.findMany({ where: { organizationId: user.organizationId, ...(!user.permissions.includes("qc.view_all") ? { ownerId: user.id } : query.ownerId ? { ownerId: query.ownerId } : {}), ...(query.clientId ? { project: { clientId: query.clientId } } : {}), ...(query.projectId ? { projectId: query.projectId } : {}), ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}) }, select: { id: true, dueAt: true, deliveredAt: true, status: true, ownerId: true, projectId: true, owner: { select: { firstName: true, lastName: true } }, project: { select: { name: true } }, history: { where: { action: { in: ["deliverable_created", "deliverable_revision"] } }, select: { action: true, metadata: true } } }, take: 10001 }),
      this.qc.program(user), this.qc.prisma.qcWorkEvent.count({ where: { organizationId: user.organizationId, receipt: null } }), this.qc.prisma.qcReinspection.aggregate({ where: { organizationId: user.organizationId, ...(!user.permissions.includes("qc.view_all") ? { technicianId: user.id } : query.ownerId ? { technicianId: query.ownerId } : {}), review: this.qc.reviewWhere(user, query) }, _sum: { remaining: true } }),
      this.qc.prisma.qcReview.findMany({ where: { ...this.qc.reviewWhere(user, { clientId: query.clientId, ownerId: query.ownerId, projectId: query.projectId }), finalizedAt: { not: null, ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }, select: { selectionReasons: true, finalizedAt: true, score: true, ownerId: true }, take: 10001 })
    ]);
    requireValue([cycles, reviews, actions, deliverables, completed].every(rows => rows.length <= 10000), "Narrow the report period or scope to at most 10,000 records per dataset.");
    const scored = reviews.filter(review => review.score !== null && review.status !== "EXCLUDED");
    const activeDeliverables = deliverables.filter(item => item.status !== "CANCELLED");
    const delivered = activeDeliverables.filter(item => item.deliveredAt);
    const originalDue = (item: typeof deliverables[number]) => {
      const value = (item.history.find(event => event.action === "deliverable_created")?.metadata as { dueAt?: string } | undefined)?.dueAt;
      return value ? new Date(value) : null;
    };
    const originalCohort = delivered.filter(item => originalDue(item));
    const rework = reopenMetrics(cycles);
    const technicians = [...new Set([...cycles.map(cycle => cycle.ownerId), ...reviews.map(review => review.ownerId)])].filter((id): id is string => Boolean(id)).map(ownerId => {
      const rows = cycles.filter(cycle => cycle.ownerId === ownerId), inspections = scored.filter(review => review.ownerId === ownerId);
      return { ownerId, ...aggregateCycles(rows), rework: reopenMetrics(rows), openActions: actions.filter(action => action.ownerId === ownerId && action.status !== "VERIFIED").length, recognition: actions.filter(action => action.ownerId === ownerId && action.kind === "RECOGNITION").length, inspected: inspections.length, averageScore: average(inspections.map(review => review.score!)), passRatePercent: inspections.length ? Math.round(inspections.filter(review => !review.selectionReasons.includes("FAILED_RESULT")).length / inspections.length * 10000) / 100 : null };
    });
    const groups = new Map<string, typeof cycles>();
    for (const cycle of cycles) { const day = cycle.startedAt.toISOString().slice(0, 10); groups.set(day, [...(groups.get(day) ?? []), cycle]); }
    const qualityDays = [...new Set(completed.map(review => review.finalizedAt!.toISOString().slice(0, 10)))].sort().map(day => {
      const rows = completed.filter(review => review.finalizedAt!.toISOString().startsWith(day));
      return { day, inspections: rows.length, averageScore: average(rows.flatMap(row => row.score === null ? [] : [row.score])), passRatePercent: rows.length ? Math.round(rows.filter(row => !row.selectionReasons.includes("FAILED_RESULT")).length / rows.length * 10000) / 100 : null };
    });
    const creativeCohorts = [...new Set(activeDeliverables.map(item => `${item.projectId}:${item.ownerId}`))].map(key => {
      const rows = activeDeliverables.filter(item => `${item.projectId}:${item.ownerId}` === key), first = rows[0], finished = rows.filter(item => item.deliveredAt);
      return { project: first.project.name, technician: `${first.owner.firstName} ${first.owner.lastName}`.trim(), total: rows.length, delivered: finished.length, onTime: finished.filter(item => item.deliveredAt! <= item.dueAt).length, averageRevisionRounds: average(rows.map(item => item.history.filter(event => event.action === "deliverable_revision").length)) };
    });
    return { qualityTrends: qualityDays, creativeCohorts, generatedAt: new Date(), period: { from: query.from ?? null, to: query.to ?? null, cohort: "Work cycles started in the period; reviews created in the period; deliverables created in the period" }, program: { lastProcessingAt: user.permissions.includes("qc.view_all") ? program.lastProcessingAt : null, processingErrorCode: user.permissions.includes("qc.view_all") ? program.processingErrorCode : null, captureEnabled: program.captureEnabled, processingEnabled: program.processingEnabled, startedAt: program.startedAt, readiness: program.readiness }, pendingSourceEvents: user.permissions.includes("qc.view_all") ? backlog : null, service: aggregateCycles(cycles), technicians, rework, quality: { completedInPeriod: completed.length, failedInPeriod: completed.filter(item => item.selectionReasons.includes("FAILED_RESULT")).length, passRatePercent: scored.length ? Math.round(scored.filter(review => !review.selectionReasons.includes("FAILED_RESULT")).length / scored.length * 10000) / 100 : null, excluded: reviews.filter(review => review.status === "EXCLUDED").length, selected: reviews.filter(review => review.status !== "EXCLUDED").length, scored: scored.length, averageScore: average(scored.map(review => review.score!)), passed: scored.filter(review => !["FAILED", "COACHING_ISSUED"].includes(review.status) && !review.selectionReasons.includes("FAILED_RESULT")).length, pending: reviews.filter(review => ["PENDING", "IN_REVIEW"].includes(review.status)).length, flags: reviews.reduce((sum, review) => sum + review._count.findings, 0), bulkCleared: reviews.filter(review => review.status === "BULK_CLEARED").length }, followUp: { reinspectionRemaining: reinspection._sum.remaining ?? 0, open: actions.filter(item => item.status !== "VERIFIED").length, overdue: actions.filter(item => item.status !== "VERIFIED" && item.dueAt && item.dueAt < new Date()).length, recognition: actions.filter(item => item.kind === "RECOGNITION").length }, creative: { originalCommitmentOnTime: originalCohort.filter(item => item.deliveredAt! <= originalDue(item)!).length, originalCommitmentSample: originalCohort.length, total: activeDeliverables.length, delivered: delivered.length, onTime: delivered.filter(item => item.deliveredAt! <= item.dueAt).length, overdue: activeDeliverables.filter(item => !item.deliveredAt && item.dueAt < new Date()).length, averageRevisionRounds: average(activeDeliverables.map(item => item.history.filter(event => event.action === "deliverable_revision").length)) }, trends: [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, rows]) => ({ day, ...aggregateCycles(rows) })) };
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
  async exportFile(query: QcExportDto, user: AuthenticatedUser, safe: boolean) {
    const allowed = safe ? ["service"] : ["service", "quality", "technicians", "trends", "creative"];
    const selected = query.sections ? query.sections.split(",") : allowed;
    requireValue(selected.length > 0 && selected.every(key => allowed.includes(key)) && new Set(selected).size === selected.length, "Choose supported export sections.");
    const settings = await this.qc.prisma.systemSetting.findUnique({ where: { organizationId: user.organizationId }, select: { companyName: true, applicationName: true, primaryColor: true } });
    const tables: QcExportTable[] = [];
    const serviceTable = (service: ReturnType<typeof aggregateCycles>) => ({ key: "service", title: "Service performance", columns: ["Metric", "Value", "Basis"], rows: [
      ["Work cycles", service.cycles, "Cycles started in selected period"], ["Measurable cycles", service.completeCycles, "Complete contractual evidence"], ["Incomplete cycles", service.incompleteCycles, "Excluded from contractual compliance"],
      ["SLA compliance (%)", service.slaCompliancePercent, `${service.evaluatedObligations} evaluated obligations`], ["First response (business minutes)", service.averageFirstResponseBusinessMinutes, `${service.firstResponseSample} measured responses`], ["Resolution (business minutes)", service.averageResolutionBusinessMinutes, `${service.resolutionSample} measured resolutions`],
      ["Historical first response (elapsed minutes)", service.historical.averageFirstResponseElapsedMinutes, `${service.historical.firstResponseSample} retained responses; not contractual SLA`], ["Historical resolution (elapsed minutes)", service.historical.averageResolutionElapsedMinutes, `${service.historical.resolutionSample} retained resolutions; not contractual SLA`]
    ] } satisfies QcExportTable);
    let clientName = "";
    if (safe) { const report = await this.clientExport(query, user); clientName = report.client; tables.push(serviceTable(report)); }
    else {
      const report = await this.overview(query, user), users = (await this.qc.lookups(user)).users;
      tables.push(serviceTable(report.service));
      tables.push({ key: "quality", title: "Inspection and follow-up", columns: ["Metric", "Value", "Basis"], rows: [["Completed inspections", report.quality.completedInPeriod, "Finalized in selected period"], ["Pass rate (%)", report.quality.passRatePercent, "Scored selected inspections"], ["Excluded inspections", report.quality.excluded, "Not counted as passes or failures"], ["Reopened cycles (%)", report.rework.reopenCyclePercent, `${report.rework.observedCycles} observable; ${report.rework.unknownCycles} unknown historical cycles`], ["Open follow-up", report.followUp.open, "Matching inspections"], ["Overdue follow-up", report.followUp.overdue, "Matching inspections"], ["Closures still to select", report.followUp.reinspectionRemaining, "Selection is not completed reinspection"]] });
      tables.push({ key: "technicians", title: "Technician scorecards", columns: ["Technician", "Inspected", "Average score", "Pass rate (%)", "SLA (%)", "Open actions"], rows: report.technicians.map(row => { const person = users.find(user => user.id === row.ownerId); return [person ? `${person.firstName} ${person.lastName}` : "Former / unavailable technician", row.inspected, row.averageScore, row.passRatePercent, row.slaCompliancePercent, row.openActions]; }) });
      tables.push({ key: "trends", title: "Quality trend", columns: ["Completed (UTC)", "Inspections", "Average score", "Pass rate (%)"], rows: report.qualityTrends.map(row => [row.day, row.inspections, row.averageScore, row.passRatePercent]) });
      tables.push({ key: "creative", title: "Creative delivery", columns: ["Project", "Technician", "Total", "Delivered", "On time", "Average revisions"], rows: report.creativeCohorts.map(row => [row.project, row.technician, row.total, row.delivered, row.onTime, row.averageRevisionRounds]) });
    }
    const color = /^#[0-9a-f]{6}$/i.test(settings?.primaryColor ?? "") ? settings!.primaryColor : "#334155";
    return renderQcExport({ title: safe ? "Client service performance" : "Internal quality control report", company: [settings?.companyName, settings?.applicationName].filter(Boolean).join(" · "), color, generatedAt: new Date().toISOString(), scope: `${safe ? clientName : "Internal use only"} · ${query.from ?? "All retained dates"} – ${query.to ?? "Present"} (UTC)${query.ownerId ? " · Technician filter applied" : ""}${query.clientId && !safe ? " · Client filter applied" : ""}${query.projectId ? " · Project filter applied" : ""}`, tables: tables.filter(table => selected.includes(table.key)) }, query.format);
  }

}
