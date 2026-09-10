import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { emptyQcConfiguration, QcPolicyConfiguration, QcProgramConfiguration } from "@avidity/shared/dist";
import { Prisma, QcProgram } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { businessMinutes, sampleIds } from "./qc.rules";
import { measureCycle, QcSnapshot, splitCycles } from "./qc.measurement";
import { importHistoricalBatch } from "./qc.history-import";
import { qcJson } from "./qc.service";

@Injectable()
export class QcEngineService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private agingCursors = new Map<string, string>();
  private readonly logger = new Logger(QcEngineService.name);
  constructor(private readonly prisma: PrismaService) {}
  onModuleInit() { this.timer = setInterval(() => void this.run(), 60_000); this.timer.unref(); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      const programs = await this.prisma.qcProgram.findMany({ where: { processingEnabled: true, captureEnabled: true } });
      for (const program of programs) {
        try { await this.process(program); }
        catch { await this.prisma.qcProgram.update({ where: { id: program.id }, data: { processingErrorCode: "PROCESSING_RETRY_PENDING" } }); this.logger.warn("QC projection is pending retry for an organization."); }
      }
    } catch { this.logger.warn("QC processing did not complete. Pending source events remain available for retry."); }
    finally { this.running = false; }
  }
  async process(program: QcProgram) {
    const config = { ...emptyQcConfiguration(), ...program.configuration as object };
    if (!program.startedAt || !config.samplingPeriodDays) return;
    const now = new Date();
    // One database transaction owns each organization's projection, across API processes.
    await this.prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${program.organizationId}), 71942) AS locked`;
      if (!locked[0]?.locked) return;
      if (config.historicalMeasurement === "INCLUDE_HISTORY") await importHistoricalBatch(tx, program);
      const pending = await tx.qcWorkEvent.findMany({ where: { organizationId: program.organizationId, receipt: null }, orderBy: { sequence: "asc" }, take: 100 });
      const aging = await tx.ticket.findMany({ where: { organizationId: program.organizationId, deletedAt: null, status: { notIn: ["CLOSED", "RESOLVED", "CANCELLED", "MERGED"] }, qcWorkEvents: { some: {} } }, orderBy: { id: "asc" }, ...(this.agingCursors.get(program.organizationId) ? { cursor: { id: this.agingCursors.get(program.organizationId) }, skip: 1 } : {}), take: 100, select: { id: true } });
      for (const id of new Set([...pending.map(event => event.ticketId), ...aging.map(ticket => ticket.id)])) await this.projectTicket(tx, id, program, config, now);
      this.agingCursors.set(program.organizationId, aging.length === 100 ? aging[aging.length - 1].id : "");
      if (!pending.length) await this.sample(tx, program, config, now);
      if (pending.length) await tx.qcEventReceipt.createMany({ data: pending.map(event => ({ eventId: event.id })), skipDuplicates: true });
      await tx.qcProgram.update({ where: { id: program.id }, data: { lastProcessingAt: now, processingErrorCode: null } });
    }, { timeout: 60_000 });
  }
  async projectTicket(tx: Prisma.TransactionClient, ticketId: string, program: QcProgram, currentConfig: QcProgramConfiguration, now: Date) {
    const ticket = await tx.ticket.findFirst({ where: { id: ticketId, organizationId: program.organizationId, deletedAt: null }, include: { qcProfile: true, qcTimeEntries: { where: { correction: null } }, projectWorkItems: { select: { projectId: true } } } });
    if (!ticket) return;
    const events = await tx.qcWorkEvent.findMany({ where: { ticketId, organizationId: program.organizationId }, orderBy: [{ occurredAt: "asc" }, { sequence: "asc" }] });
    const policies = await tx.qcPolicy.findMany({ where: { organizationId: program.organizationId, publishedAt: { not: null } } });
    const cycles = splitCycles(events);
    for (let index = 0; index < cycles.length; index++) {
      const cycle = cycles[index]; if (!cycle.length) continue;
      const first = cycle[0], last = cycle[cycle.length - 1];
      const cycleKey = `${ticket.id}:${first.id}`;
      const retained = await tx.qcCycle.findUnique({ where: { cycleKey } });
      const retainedMeasurement = retained?.measurement as { configuration?: QcProgramConfiguration; configurationVersion?: number } | undefined;
      const revision = retainedMeasurement?.configuration ? null : await tx.qcConfigRevision.findFirst({ where: { organizationId: program.organizationId, createdAt: { lte: first.occurredAt } }, orderBy: { version: "desc" } });
      const revisionData = revision?.configuration as { configuration?: QcProgramConfiguration } | undefined;
      const config = { ...emptyQcConfiguration(), ...(retainedMeasurement?.configuration ?? revisionData?.configuration ?? currentConfig) };
      const configurationVersion = retainedMeasurement?.configurationVersion ?? revision?.version ?? program.version;
      const current = [...cycle].reverse().find(event => ["CREATED", "REOPENED", "TICKET_CHANGED"].includes(event.kind));
      const close = cycle.find(event => (event.snapshot as QcSnapshot).category === "CLOSED" || (event.snapshot as QcSnapshot).status === "CLOSED");
      const snapshot = (close?.snapshot ?? current?.snapshot ?? {}) as QcSnapshot & { categoryId?: string; rmmDeviceId?: string; rmmAlertReference?: string };
      const eligiblePolicies = policies.filter(policy => policy.clientId === ((first.snapshot as QcSnapshot).clientId ?? ticket.clientId) && policy.effectiveFrom <= first.occurredAt && (!policy.categoryId || policy.categoryId === snapshot.categoryId) && (!policy.projectId || ticket.projectWorkItems.some(work => work.projectId === policy.projectId)) && (!(policy.configuration as unknown as QcPolicyConfiguration).priority || (policy.configuration as unknown as QcPolicyConfiguration).priority === (first.snapshot as QcSnapshot).priority));
      const newest = eligiblePolicies.filter(policy => !eligiblePolicies.some(other => other.name === policy.name && other.projectId === policy.projectId && other.categoryId === policy.categoryId && other.revision > policy.revision));
      const ranked = newest.filter(policy => !policy.effectiveUntil || policy.effectiveUntil > first.occurredAt).map(policy => ({ policy, specificity: Number(Boolean(policy.projectId)) + Number(Boolean(policy.categoryId)) + Number(Boolean((policy.configuration as unknown as QcPolicyConfiguration).priority)) })).sort((a, b) => b.specificity - a.specificity);
      const policy = retained?.policyId ? policies.find(item => item.id === retained.policyId) ?? null : ranked.length && (ranked.length === 1 || ranked[0].specificity !== ranked[1].specificity) ? ranked[0].policy : null;
      const policyConfig = policy?.configuration as unknown as QcPolicyConfiguration | undefined;
      let measurement = policyConfig ? measureCycle(cycle, policyConfig, index === cycles.length - 1 ? now : last.occurredAt) : { complete: false, reason: ranked.length ? "Ambiguous SLA policies" : "No applicable published SLA policy", clocks: [] };
      if (measurement.complete && await tx.qcConfigRevision.count({ where: { organizationId: program.organizationId, createdAt: { gt: first.occurredAt, lte: close?.occurredAt ?? now }, configuration: { path: ["captureEnabled"], equals: false } } })) measurement = { ...measurement, complete: false, reason: "Source capture was disabled during this cycle" };
      const reasons: string[] = [];
      let variance: { state: string; baselineCount: number; medianMinutes: number | null; deviationPercent: number | null } = { state: "NOT_EVALUATED", baselineCount: 0, medianMinutes: null, deviationPercent: null };
      const findings: Array<{ code: string; severity: string; evidence: unknown }> = [];
      if (measurement.complete && measurement.clocks.some(clock => clock.state === "BREACHED")) reasons.push("SLA_BREACH");
      if (index > 0) reasons.push("REOPENED");
      if (snapshot.clientId && config.anchorClientIds.includes(snapshot.clientId)) reasons.push("ANCHOR_CLIENT");
      const minutes = ticket.qcTimeEntries.filter(entry => entry.startedAt >= first.occurredAt && entry.startedAt <= (close?.occurredAt ?? now)).reduce((total, entry) => total + entry.minutes, 0);
      if (config.laborThresholdMinutes !== null && minutes >= config.laborThresholdMinutes) reasons.push("LABOR_THRESHOLD");
      if (close && minutes > 0 && config.varianceBaselineMinimum && config.varianceThresholdPercent && config.flags.some(flag => flag.enabled && flag.code === "TIME_ENTRY_VARIANCE")) {
        const prior = snapshot.categoryId ? await tx.qcCycle.findMany({ where: { organizationId: program.organizationId, categoryId: snapshot.categoryId, ticketId: { not: ticket.id }, closedAt: { not: null, lt: first.occurredAt } }, select: { startedAt: true, closedAt: true, ticket: { select: { qcTimeEntries: { where: { correction: null }, select: { minutes: true, startedAt: true } } } } }, orderBy: { closedAt: "desc" }, take: 10000 }) : [];
        const totals = prior.map(item => item.ticket.qcTimeEntries.filter(entry => entry.startedAt >= item.startedAt && entry.startedAt <= item.closedAt!).reduce((sum, entry) => sum + entry.minutes, 0)).filter(value => value > 0).sort((a, b) => a - b);
        const median = totals.length ? totals.length % 2 ? totals[Math.floor(totals.length / 2)] : (totals[totals.length / 2 - 1] + totals[totals.length / 2]) / 2 : null;
        variance = { state: totals.length >= config.varianceBaselineMinimum ? "EVALUATED" : "INSUFFICIENT_BASELINE", baselineCount: totals.length, medianMinutes: median, deviationPercent: median ? Math.abs(minutes - median) / median * 100 : null };
      }

      for (const rule of config.flags.filter(flag => flag.enabled)) {
        let evidence: unknown = null;
        if (rule.code === "UNDOCUMENTED_CLOSE" && close && (!(close.snapshot as { resolutionNotePresent?: boolean }).resolutionNotePresent || !cycle.some(event => event.kind === "PUBLIC_RESPONSE" && event.occurredAt <= close.occurredAt))) evidence = { closedAt: close.occurredAt, missingResolution: !(close.snapshot as { resolutionNotePresent?: boolean }).resolutionNotePresent, missingPublicResponse: !cycle.some(event => event.kind === "PUBLIC_RESPONSE" && event.occurredAt <= close.occurredAt) };
        if (rule.code === "REOPENED_TICKET" && index > 0 && rule.threshold !== null) {
          const previous = [...cycles[index - 1]].reverse().find(event => ["CLOSED", "RESOLVED"].includes((event.snapshot as QcSnapshot).category ?? (event.snapshot as QcSnapshot).status ?? ""));
          if (previous && first.occurredAt.getTime() - previous.occurredAt.getTime() <= rule.threshold * 86400000) evidence = { previousClosedAt: previous.occurredAt, reopenedAt: first.occurredAt, windowDays: rule.threshold };
        }
        if (rule.code === "OWNERSHIP_CHURN" && rule.threshold !== null) { const owners = [...new Set(cycle.map(event => (event.snapshot as QcSnapshot).assignedUserId).filter(Boolean))]; if (owners.length >= rule.threshold) evidence = { ownerIds: owners, threshold: rule.threshold }; }
        if (["STALLED_TICKET", "SILENT_AGING"].includes(rule.code) && !close && !["RESOLVED", "CANCELLED", "MERGED"].includes(snapshot.category ?? snapshot.status ?? "") && index === cycles.length - 1 && policyConfig && rule.threshold !== null && measurement.complete) {
          const touch = [...cycle].reverse().find(event => rule.code === "SILENT_AGING" ? event.kind === "PUBLIC_RESPONSE" : ["PUBLIC_RESPONSE", "TECHNICAL_TOUCH"].includes(event.kind));
          const elapsed = businessMinutes(touch?.occurredAt ?? first.occurredAt, now, policyConfig.calendar);
          if (elapsed >= rule.threshold) evidence = { lastActivityAt: touch?.occurredAt ?? null, elapsedBusinessMinutes: elapsed, thresholdMinutes: rule.threshold };
        }
        if (rule.code === "TIME_ENTRY_VARIANCE" && close && minutes === 0) evidence = { recordedMinutes: 0, baseline: null, reason: "No recorded labor for this closure cycle" };
        if (rule.code === "TIME_ENTRY_VARIANCE" && variance.state === "EVALUATED" && variance.deviationPercent !== null && config.varianceThresholdPercent && variance.deviationPercent >= config.varianceThresholdPercent) evidence = { recordedMinutes: minutes, ...variance, thresholdPercent: config.varianceThresholdPercent };
        if (rule.code === "UNVERIFIED_RMM_CLOSE" && close && snapshot.rmmDeviceId && snapshot.rmmAlertReference) {
          const verification = await tx.qcRmmEvidence.findFirst({ where: { ticketId, organizationId: program.organizationId, deviceId: snapshot.rmmDeviceId, alertReference: snapshot.rmmAlertReference, createdAt: { lte: close.occurredAt } }, orderBy: { createdAt: "desc" } });
          if (!verification || verification.result !== "VERIFIED" || !config.rmmEvidenceFreshnessMinutes || close.occurredAt.getTime() - verification.createdAt.getTime() > config.rmmEvidenceFreshnessMinutes * 60000) evidence = { deviceId: snapshot.rmmDeviceId, alertReference: snapshot.rmmAlertReference, verificationId: verification?.id ?? null, result: verification?.result ?? "NO_PRE_CLOSE_EVIDENCE", closedAt: close.occurredAt };
        }
        if (evidence) findings.push({ code: rule.code, severity: rule.severity, evidence });
      }
      if (findings.length) reasons.push("FLAGGED");
      const ownerId = snapshot.assignedUserId ?? null;
      const reinspections = close && ownerId ? await tx.qcReinspection.findMany({ where: { organizationId: program.organizationId, technicianId: ownerId, remaining: { gt: 0 }, createdAt: { lt: close.occurredAt } } }) : [];
      const publicResponse = cycle.find(event => event.kind === "PUBLIC_RESPONSE");
      const resolved = cycle.find(event => ["RESOLVED", "CLOSED"].includes((event.snapshot as QcSnapshot).category ?? (event.snapshot as QcSnapshot).status ?? ""));
      const observed = { origin: first.origin, reopened: index > 0, firstResponseElapsedMinutes: publicResponse ? Math.max(0, (publicResponse.occurredAt.getTime() - first.occurredAt.getTime()) / 60000) : null, resolutionElapsedMinutes: resolved ? Math.max(0, (resolved.occurredAt.getTime() - first.occurredAt.getTime()) / 60000) : null };
      await tx.qcCycle.upsert({ where: { cycleKey }, create: { organizationId: program.organizationId, ticketId, cycleKey, ownerId, clientId: (first.snapshot as QcSnapshot).clientId, categoryId: snapshot.categoryId, startedAt: first.occurredAt, closedAt: close?.occurredAt, policyId: policy?.id, complete: measurement.complete, measurement: qcJson({ ...measurement, configuration: config, configurationVersion, observed, labor: { recordedMinutes: minutes, variance } }) }, update: { closedAt: close?.occurredAt, ownerId, categoryId: snapshot.categoryId, policyId: policy?.id, complete: measurement.complete, measurement: qcJson({ ...measurement, configuration: config, configurationVersion, observed, labor: { recordedMinutes: minutes, variance } }) } });
      const existing = await tx.qcReview.findUnique({ where: { organizationId_cycleKey: { organizationId: program.organizationId, cycleKey } } });
      const pendingReinspections = [];
      for (const directive of reinspections) {
        if (directive.reviewId === existing?.id) continue;
        const consumed = await tx.qcHistory.count({ where: { organizationId: program.organizationId, action: "reinspection_selected", AND: [{ metadata: { path: ["directiveId"], equals: directive.id } }, { metadata: { path: ["cycleKey"], equals: cycleKey } }] } });
        if (!consumed) pendingReinspections.push(directive);
      }
      if (pendingReinspections.length) reasons.push("REINSPECTION");
      if (!reasons.length && !existing) continue;
      const review = await tx.qcReview.upsert({ where: { organizationId_cycleKey: { organizationId: program.organizationId, cycleKey } }, create: { organizationId: program.organizationId, ticketId, ownerId, rubricId: config.serviceRubricId, policyId: policy?.id, cycleKey, selectionReasons: reasons }, update: { selectionReasons: [...new Set([...(existing?.selectionReasons ?? []), ...reasons])] } });
      if (reasons.some(reason => reason !== "SAMPLE")) await tx.qcReview.updateMany({ where: { id: review.id, status: "BULK_CLEARED" }, data: { status: "PENDING", version: { increment: 1 } } });
      if (!existing) await tx.qcHistory.create({ data: { organizationId: program.organizationId, reviewId: review.id, action: "review_selected_automatically", metadata: qcJson({ reasons, configurationVersion }) } });
      for (const directive of pendingReinspections) {
        await tx.qcReinspection.update({ where: { id: directive.id }, data: { remaining: { decrement: 1 } } });
        await tx.qcHistory.create({ data: { organizationId: program.organizationId, reviewId: review.id, action: "reinspection_selected", metadata: qcJson({ directiveId: directive.id, cycleKey, remaining: directive.remaining - 1 }) } });
      }
      for (const finding of findings) {
        let target = review;
        if (review.finalizedAt) {
          // A later exception needs a new inspection; retained scores must not be rewritten.
          if (await tx.qcFinding.count({ where: { reviewId: review.id, code: finding.code } })) continue;
          target = await tx.qcReview.upsert({ where: { organizationId_cycleKey: { organizationId: program.organizationId, cycleKey: `${cycleKey}:exception:${finding.code}` } }, create: { organizationId: program.organizationId, ticketId, ownerId, rubricId: config.serviceRubricId, policyId: policy?.id, cycleKey: `${cycleKey}:exception:${finding.code}`, selectionReasons: ["FLAGGED", "FOLLOW_UP"] }, update: {} });
        }
        const created = await tx.qcFinding.createMany({ data: [{ organizationId: program.organizationId, reviewId: target.id, code: finding.code, severity: finding.severity, evidence: qcJson({ ...finding.evidence as object, configurationVersion }) }], skipDuplicates: true });
        if (created.count) {
          await tx.qcHistory.create({ data: { organizationId: program.organizationId, reviewId: target.id, action: "flag_created_automatically", metadata: qcJson({ code: finding.code, configurationVersion, sourceCycleKey: cycleKey }) } });
          if (target.id !== review.id) await tx.qcHistory.create({ data: { organizationId: program.organizationId, reviewId: review.id, action: "follow_up_inspection_requested", metadata: qcJson({ followUpReviewId: target.id, code: finding.code }) } });
          await tx.qcReview.updateMany({ where: { id: target.id, status: "BULK_CLEARED" }, data: { status: "PENDING" } });
          await tx.qcReview.update({ where: { id: target.id }, data: { version: { increment: 1 } } });
        }
      }
    }
  }
  private async sample(tx: Prisma.TransactionClient, program: QcProgram, config: QcProgramConfiguration, now: Date) {
    if (config.samplingPercent === null || config.samplingMinimum === null || !config.samplingPeriodDays || !program.startedAt) return;
    const last = await tx.qcSamplingRun.findFirst({ where: { organizationId: program.organizationId }, orderBy: { periodEnd: "desc" } });
    const periodStart = last?.periodEnd ?? program.startedAt;
    const periodEnd = new Date(periodStart.getTime() + config.samplingPeriodDays * 86400000);
    if (periodEnd > now) return;
    const population = await tx.qcCycle.findMany({ where: { organizationId: program.organizationId, closedAt: { gte: periodStart, lt: periodEnd } }, orderBy: { cycleKey: "asc" } });
    const groups = new Map<string, string[]>();
    for (const cycle of population) for (const dimension of config.samplingDimensions) {
      const value = dimension === "TECHNICIAN" ? cycle.ownerId : dimension === "CLIENT" ? cycle.clientId : cycle.categoryId;
      const key = `${dimension}:${value ?? "UNASSIGNED"}`;
      groups.set(key, [...(groups.get(key) ?? []), cycle.id]);
    }
    const selected = new Set<string>();
    for (const [cohort, ids] of groups) for (const id of sampleIds(ids, config.samplingPercent, config.samplingMinimum, `${program.organizationId}:${periodStart.toISOString()}:${cohort}:${program.version}`)) selected.add(id);
    await tx.qcSamplingRun.create({ data: { organizationId: program.organizationId, periodStart, periodEnd, configurationVersion: program.version, population: qcJson([...groups.entries()]), selection: qcJson([...selected]) } });
    for (const cycle of population.filter(item => selected.has(item.id))) {
      const existing = await tx.qcReview.findUnique({ where: { organizationId_cycleKey: { organizationId: program.organizationId, cycleKey: cycle.cycleKey } } });
      await tx.qcReview.upsert({ where: { organizationId_cycleKey: { organizationId: program.organizationId, cycleKey: cycle.cycleKey } }, create: { organizationId: program.organizationId, ticketId: cycle.ticketId, ownerId: cycle.ownerId, rubricId: ((cycle.measurement as { configuration?: QcProgramConfiguration }).configuration?.serviceRubricId ?? config.serviceRubricId), policyId: cycle.policyId, cycleKey: cycle.cycleKey, selectionReasons: ["SAMPLE"] }, update: { selectionReasons: [...new Set([...(existing?.selectionReasons ?? []), "SAMPLE"])] } });
    }
  }

}
