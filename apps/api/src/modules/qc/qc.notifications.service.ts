import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { QcDelivery, QcProgram } from "@prisma/client";
import { QcProgramConfiguration, QcNotificationRoute } from "@avidity/shared/dist";
import { QcService, qcJson } from "./qc.service";
import { QcTeamsService } from "./qc.teams.service";
import { QcReportsService } from "./qc.reports.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { MailDeliveryService } from "../mailboxes/mail-delivery.service";
import { calendarPosition, isWorkingTime, requireValue } from "./qc.rules";
import { QcClock } from "./qc.measurement";

interface Notice { event: QcNotificationRoute["event"]; source: string; reviewId?: string; ownerId?: string | null; occurredAt: Date; urgent: boolean; title: string; summary?: string; actionId?: string; deliverableId?: string; cycleId?: string; }
@Injectable()
export class QcNotificationsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout; private running = false;
  private readonly logger = new Logger(QcNotificationsService.name);
  constructor(private readonly qc: QcService, private readonly teams: QcTeamsService, private readonly mail: MailDeliveryService, private readonly reports: QcReportsService, private readonly environment: ConfigService) {}
  onModuleInit() { this.timer = setInterval(() => void this.run(), 60_000); this.timer.unref(); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async run() {
    if (this.running) return; this.running = true;
    try {
      const programs = await this.qc.prisma.qcProgram.findMany({ where: { processingEnabled: true } });
      for (const program of programs) {
        await this.plan(program);
        if (program.deliveryEnabled) await this.deliver(program);
      }
    } catch { this.logger.warn("QC notification processing needs attention. Delivery outcomes remain in the QC audit."); }
    finally { this.running = false; }
  }
  async enqueue(program: QcProgram, notice: Notice) {
    const config = program.configuration as unknown as QcProgramConfiguration;
    for (const route of config.routes.filter(item => item.event === notice.event)) {
      const recipients = new Set(route.audiences.flatMap(audience => audience === "TECHNICIAN" ? notice.ownerId ? [notice.ownerId] : [] : audience === "QC_OWNER" ? config.ownerId ? [config.ownerId] : [] : config.leadershipIds));
      for (const recipientId of recipients) {
        const deduplicationKey = `${program.organizationId}:${notice.event}:${notice.source}:${recipientId}:${route.channel}:${route.delayMinutes}`;
        await this.qc.prisma.qcDelivery.upsert({ where: { deduplicationKey }, create: { organizationId: program.organizationId, reviewId: notice.reviewId, recipientId, channel: route.channel, deduplicationKey, payload: qcJson({ ...notice, route: { channel: route.channel, delayMinutes: route.delayMinutes, audiences: route.audiences, stopOnAcknowledgment: route.stopOnAcknowledgment ?? false }, configurationVersion: program.version }), nextAttemptAt: new Date(notice.occurredAt.getTime() + route.delayMinutes * 60000) }, update: {} });
      }
    }
  }
  async plan(program: QcProgram) {
    const config = program.configuration as unknown as QcProgramConfiguration;
    if (!config.routes.length) return;
    const now = new Date();
    const [reviews, actions, deliverables, cycles] = await Promise.all([
      this.qc.prisma.qcReview.findMany({ where: { organizationId: program.organizationId, status: { not: "CLOSED" } }, include: { findings: { where: { severity: "HIGH", overriddenAt: null } } } }),
      this.qc.prisma.qcAction.findMany({ where: { organizationId: program.organizationId, status: { not: "VERIFIED" }, dueAt: { lt: now } } }),
      this.qc.prisma.qcDeliverable.findMany({ where: { organizationId: program.organizationId, deliveredAt: null, dueAt: { lt: now } } }),
      this.qc.prisma.qcCycle.findMany({ where: { organizationId: program.organizationId, complete: true } })
    ]);
    const day = config.deliveryCalendar ? calendarPosition(now, config.deliveryCalendar.timeZone).day : now.toISOString().slice(0, 10);
    for (const review of reviews) {
      for (const finding of review.findings) await this.enqueue(program, { event: "HIGH_FLAG", source: finding.id, reviewId: review.id, ownerId: review.ownerId, occurredAt: finding.createdAt, urgent: true, title: "High-priority QC exception" });
      if (review.finalizedAt && review.selectionReasons.includes("FAILED_RESULT")) await this.enqueue(program, { event: "REVIEW_FAILED", source: review.id, reviewId: review.id, ownerId: review.ownerId, occurredAt: review.finalizedAt, urgent: false, title: "QC inspection requires follow-up" });
      if (["PENDING", "IN_REVIEW"].includes(review.status) && config.queueAgingMinutes && now.getTime() - review.createdAt.getTime() >= config.queueAgingMinutes * 60000) await this.enqueue(program, { event: "QUEUE_AGING", source: review.id, reviewId: review.id, ownerId: review.ownerId, occurredAt: new Date(review.createdAt.getTime() + config.queueAgingMinutes * 60000), urgent: false, title: "QC review is overdue" });
    }
    for (const action of actions) await this.enqueue(program, { event: "ACTION_OVERDUE", source: `${action.id}:${day}`, actionId: action.id, reviewId: action.reviewId, ownerId: action.ownerId, occurredAt: now, urgent: false, title: "QC corrective action is overdue" });
    for (const item of deliverables) await this.enqueue(program, { event: "CREATIVE_OVERDUE", source: `${item.id}:${item.dueAt.toISOString()}`, deliverableId: item.id, ownerId: item.ownerId, occurredAt: item.dueAt, urgent: false, title: "Creative delivery is overdue" });
    for (const cycle of cycles) for (const clock of (cycle.measurement as unknown as { clocks: QcClock[] }).clocks ?? []) {
      if (!["WARNING", "BREACHED"].includes(clock.state)) continue;
      const event = clock.state === "BREACHED" ? "SLA_BREACH" : "SLA_WARNING";
      const review = await this.qc.prisma.qcReview.findUnique({ where: { organizationId_cycleKey: { organizationId: program.organizationId, cycleKey: cycle.cycleKey } }, select: { id: true } });
      await this.enqueue(program, { event, source: `${cycle.id}:${clock.kind}:${clock.startedAt}`, cycleId: cycle.id, reviewId: review?.id, ownerId: cycle.ownerId, occurredAt: now, urgent: event === "SLA_BREACH", title: event === "SLA_BREACH" ? "A service commitment exceeded its SLA" : "A service commitment is approaching its SLA" });
    }
    if (config.deliveryCalendar && config.dailyDigestMinute !== null && isWorkingTime(now, config.deliveryCalendar)) {
      const position = calendarPosition(now, config.deliveryCalendar.timeZone);
      if (position.minute >= config.dailyDigestMinute) {
        await this.enqueue(program, { event: "DAILY_DIGEST", source: day, occurredAt: now, urgent: false, title: "Daily QC exceptions" });
        if (position.weekday === config.weeklyDigestDay) await this.enqueue(program, { event: "WEEKLY_DIGEST", source: day, occurredAt: now, urgent: false, title: "Weekly quality summary" });
      }
    }
  }
  private async recipient(delivery: QcDelivery): Promise<AuthenticatedUser> {
    const user = await this.qc.prisma.user.findFirst({ where: { id: delivery.recipientId, organizationId: delivery.organizationId, isActive: true, deletedAt: null, forcePasswordChange: false }, include: { groups: { include: { group: { include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } } } } } });
    requireValue(user, "The internal recipient is unavailable.");
    const permissions = [...new Set(user.groups.filter(link => link.group.organizationId === delivery.organizationId).flatMap(link => link.group.roles.filter(item => item.role.organizationId === delivery.organizationId).flatMap(item => item.role.permissions.map(grant => grant.permission.name))))];
    const actor: AuthenticatedUser = { id: user.id, organizationId: user.organizationId, email: user.email, firstName: user.firstName, lastName: user.lastName, forcePasswordChange: user.forcePasswordChange, permissions };
    this.qc.requirePermission(actor, "qc.view");
    const payload = delivery.payload as unknown as Notice;
    if (payload.actionId) requireValue(await this.qc.prisma.qcAction.count({ where: { id: payload.actionId, organizationId: delivery.organizationId, ...(!permissions.includes("qc.view_all") ? { ownerId: actor.id } : {}) } }), "Follow-up is unavailable in recipient scope.");
    else if (delivery.reviewId) await this.qc.review(delivery.reviewId, actor);
    if (!permissions.includes("qc.view_all") && payload.ownerId !== actor.id) throw new Error("Recipient scope changed.");
    return actor;
  }
  async deliver(program: QcProgram) {
    const config = program.configuration as unknown as QcProgramConfiguration;
    if (!config.deliveryCalendar || !config.maxNotificationsPerHour) return;
    const now = new Date();
    const interrupted = await this.qc.prisma.qcDelivery.findMany({ where: { organizationId: program.organizationId, state: "PROCESSING", updatedAt: { lt: new Date(now.getTime() - 300000) } }, select: { id: true, attempts: true }, take: 100 });
    for (const item of interrupted) await this.qc.prisma.$transaction(async tx => {
      const changed = await tx.qcDelivery.updateMany({ where: { id: item.id, state: "PROCESSING", updatedAt: { lt: new Date(now.getTime() - 300000) } }, data: { state: "UNKNOWN", errorCode: "INTERRUPTED_DELIVERY_REQUIRES_RECONCILIATION" } });
      if (changed.count) await tx.qcDeliveryAttempt.createMany({ data: [{ deliveryId: item.id, attempt: item.attempts, outcome: "UNKNOWN", errorCode: "INTERRUPTED_DELIVERY_REQUIRES_RECONCILIATION" }], skipDuplicates: true });
    });
    const working = isWorkingTime(now, config.deliveryCalendar);
    if (!working && !config.urgentOutsideHours) return;
    const rows = await this.qc.prisma.qcDelivery.findMany({ where: { organizationId: program.organizationId, state: "PENDING", nextAttemptAt: { lte: now }, ...(!working ? { payload: { path: ["urgent"], equals: true } } : {}) }, orderBy: { nextAttemptAt: "asc" }, take: 50 });
    for (const row of rows) {
      const payload = row.payload as unknown as Notice & { route?: QcNotificationRoute };
      const route = config.routes.find(item => item.event === payload.event && item.channel === row.channel && (!payload.route || item.delayMinutes === payload.route.delayMinutes && JSON.stringify([...item.audiences].sort()) === JSON.stringify([...payload.route.audiences].sort())));
      if (payload.cycleId && ["SLA_WARNING", "SLA_BREACH"].includes(payload.event)) {
        const cycle = await this.qc.prisma.qcCycle.findFirst({ where: { id: payload.cycleId, organizationId: program.organizationId }, select: { measurement: true, complete: true } });
        const clock = (cycle?.measurement as { clocks?: QcClock[] } | undefined)?.clocks?.find(item => `${payload.cycleId}:${item.kind}:${item.startedAt}` === payload.source);
        if (!cycle?.complete || clock?.state !== (payload.event === "SLA_WARNING" ? "WARNING" : "BREACHED")) { await this.qc.prisma.qcDelivery.updateMany({ where: { id: row.id, state: "PENDING" }, data: { state: "CANCELLED", errorCode: "OBLIGATION_STATE_CHANGED" } }); continue; }
      }
      const acknowledged = route?.stopOnAcknowledgment && await this.qc.prisma.qcDelivery.count({ where: { organizationId: program.organizationId, acknowledgedAt: { not: null }, AND: [{ payload: { path: ["source"], equals: payload.source } }, { payload: { path: ["event"], equals: payload.event } }] } });
      if (!route || acknowledged) { await this.qc.prisma.qcDelivery.updateMany({ where: { id: row.id, state: "PENDING" }, data: { state: "CANCELLED", errorCode: acknowledged ? "ACKNOWLEDGED_ESCALATION_STOPPED" : "ROUTE_REMOVED" } }); continue; }
      if (!isWorkingTime(now, config.deliveryCalendar) && !(payload.urgent && config.urgentOutsideHours)) continue;
      if (payload.actionId && await this.qc.prisma.qcAction.count({ where: { id: payload.actionId, status: "VERIFIED" } }) || payload.deliverableId && await this.qc.prisma.qcDeliverable.count({ where: { id: payload.deliverableId, deliveredAt: { not: null } } }) || row.reviewId && await this.qc.prisma.qcReview.count({ where: { id: row.reviewId, status: "CLOSED" } })) { await this.qc.prisma.qcDelivery.updateMany({ where: { id: row.id, state: "PENDING" }, data: { state: "CANCELLED", errorCode: "WORK_COMPLETED" } }); continue; }
      const claimed = await this.qc.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${row.recipientId}), 71943)::text`;
        const rateCount = await tx.qcDelivery.count({ where: { organizationId: program.organizationId, recipientId: row.recipientId, OR: [{ acceptedAt: { gte: new Date(now.getTime() - 3600000) } }, { state: "PROCESSING" }] } });
        if (rateCount >= config.maxNotificationsPerHour!) { await tx.qcDelivery.updateMany({ where: { id: row.id, state: "PENDING" }, data: { nextAttemptAt: new Date(now.getTime() + 60000) } }); return false; }
        const claim = await tx.qcDelivery.updateMany({ where: { id: row.id, state: "PENDING" }, data: { state: "PROCESSING", attempts: { increment: 1 } } });
        if (claim.count !== 1) return false;
        await tx.qcDeliveryAttempt.create({ data: { deliveryId: row.id, attempt: row.attempts + 1, outcome: "STARTED" } });
        return true;
      });
      if (!claimed) continue;
      let externalStarted = false;
      try {
        const user = await this.recipient(row);
        const appUrl = this.environment.get<string>("APP_URL");
        requireValue(row.channel === "IN_APP" || appUrl && new URL(appUrl).protocol === "https:", "Configure the public application URL before delivery.");
        const summary = ["DAILY_DIGEST", "WEEKLY_DIGEST"].includes(payload.event) ? await this.digest(user, payload.event === "WEEKLY_DIGEST") : "Open the inspection to review the current evidence and required follow-up.";
        const link = `${(appUrl ?? "").replace(/\/$/, "")}/qc/${payload.actionId ? "actions" : row.reviewId ? `reviews/${row.reviewId}` : ""}`;
        if (row.channel === "IN_APP") {
          await this.qc.prisma.$transaction(async tx => { await tx.notification.create({ data: { userId: user.id, title: payload.title, body: summary, metadata: qcJson({ entityType: "QC", href: `/qc/${payload.actionId ? "actions" : row.reviewId ? `reviews/${row.reviewId}` : ""}`, qcDeliveryId: row.id }) } }); await tx.qcDelivery.update({ where: { id: row.id }, data: { state: "ACCEPTED", acceptedAt: new Date(), providerMessageId: `notification:${row.id}`, errorCode: null } }); await tx.qcDeliveryAttempt.create({ data: { deliveryId: row.id, attempt: row.attempts + 1, outcome: "ACCEPTED", providerMessageId: `notification:${row.id}` } }); });
          continue;
        }
        let providerMessageId: string;
        if (row.channel === "OUTLOOK") {
          const mailbox = config.mailboxId ? await this.qc.prisma.mailbox.findFirst({ where: { id: config.mailboxId, organizationId: row.organizationId, isActive: true }, select: { id: true, provider: true, outboundMode: true, tenantId: true } }) : null;
          requireValue(mailbox?.provider === "MICROSOFT365" && mailbox.outboundMode !== "NONE" && mailbox.tenantId, "An active Microsoft mailbox is required.");
          const identity = await this.qc.prisma.user.findUnique({ where: { id: user.id }, select: { microsoftTenantId: true, microsoftPrincipalName: true } });
          requireValue(identity?.microsoftTenantId === mailbox.tenantId && identity.microsoftPrincipalName && !identity.microsoftPrincipalName.toLowerCase().includes("#ext#"), "An internal Microsoft-linked recipient is required; external delivery is not enabled.");
          const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
          externalStarted = true;
          const sent = await this.mail.sendTicketReply({ organizationId: row.organizationId, mailboxId: mailbox.id, to: [identity.microsoftPrincipalName], subject: payload.title, bodyText: `${summary}\n\n${link}`, bodyHtml: `<p>${escape(summary)}</p><p><a href="${escape(link)}">Open Quality Control</a></p>` });
          requireValue(sent?.providerMessageId, "The mail provider did not accept the notification."); providerMessageId = sent.providerMessageId;
        } else {
          requireValue(row.channel === "TEAMS" || row.channel === "TEAMS_DIRECT", "Unsupported QC channel.");
          externalStarted = true;
          providerMessageId = await this.teams.send({ ...row, payload: JSON.parse(JSON.stringify({ ...payload, summary })) }, config, appUrl!);
        }
        await this.qc.prisma.$transaction(async tx => { await tx.qcDelivery.update({ where: { id: row.id }, data: { state: "ACCEPTED", acceptedAt: new Date(), providerMessageId, errorCode: null } }); await tx.qcDeliveryAttempt.create({ data: { deliveryId: row.id, attempt: row.attempts + 1, outcome: "ACCEPTED", providerMessageId } }); });
      } catch {
        await this.qc.prisma.$transaction(async tx => { const state = externalStarted ? "UNKNOWN" : "FAILED"; const errorCode = externalStarted ? "PROVIDER_OUTCOME_REQUIRES_RECONCILIATION" : "RECIPIENT_OR_CONFIGURATION_UNAVAILABLE"; await tx.qcDelivery.update({ where: { id: row.id }, data: { state, errorCode } }); await tx.qcDeliveryAttempt.createMany({ data: [{ deliveryId: row.id, attempt: row.attempts + 1, outcome: state, errorCode }], skipDuplicates: true }); });
      }
    }
  }
  private async digest(user: AuthenticatedUser, weekly: boolean) {
    const report = await this.reports.overview({ from: new Date(Date.now() - (weekly ? 7 : 1) * 86400000).toISOString() }, user);
    const scope = this.qc.scope(user);
    const [pending, open, overdue] = await Promise.all([
      this.qc.prisma.qcReview.count({ where: { ...scope, status: { in: ["PENDING", "IN_REVIEW"] } } }),
      this.qc.prisma.qcAction.count({ where: { organizationId: user.organizationId, ...(!user.permissions.includes("qc.view_all") ? { ownerId: user.id } : {}), status: { not: "VERIFIED" } } }),
      this.qc.prisma.qcAction.count({ where: { organizationId: user.organizationId, ...(!user.permissions.includes("qc.view_all") ? { ownerId: user.id } : {}), status: { not: "VERIFIED" }, dueAt: { lt: new Date() } } })
    ]);
    return `${report.quality.completedInPeriod} inspections completed in this period; ${report.quality.failedInPeriod} failed; ${pending} awaiting review across all dates; ${open} open follow-up actions; ${overdue} overdue actions; ${report.service.breachedObligations} breached SLA obligations. ${report.service.incompleteCycles} work cycles have incomplete evidence.`;
  }
  async deliveries(user: AuthenticatedUser, query: import("./dto/qc.dto").QcQueryDto = {}) {
    return this.qc.prisma.qcDelivery.findMany({ where: { organizationId: user.organizationId, ...(!user.permissions.includes("qc.view_all") ? { recipientId: user.id } : {}) }, select: { attemptEvents: { orderBy: { createdAt: "asc" } }, id: true, reviewId: true, recipientId: true, recipient: { select: { firstName: true, lastName: true } }, channel: true, state: true, attempts: true, nextAttemptAt: true, acceptedAt: true, acknowledgedAt: true, errorCode: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: query.pageSize ?? 100, skip: ((query.page ?? 1) - 1) * (query.pageSize ?? 100) });
  }
  async acknowledge(id: string, user: AuthenticatedUser) {
    return this.qc.prisma.$transaction(async tx => { const changed = await tx.qcDelivery.updateMany({ where: { id, organizationId: user.organizationId, recipientId: user.id, state: "ACCEPTED", acknowledgedAt: null }, data: { acknowledgedAt: new Date() } }); requireValue(changed.count === 1, "This notification is not available for acknowledgment."); await this.qc.history(tx, user, "notification_acknowledged", { deliveryId: id }); return { acknowledged: true }; });
  }
  async retry(id: string, reason: string, user: AuthenticatedUser) {
    requireValue(reason.trim(), "Record the reconciliation or correction before retrying.");
    return this.qc.prisma.$transaction(async tx => { const result = await tx.qcDelivery.updateMany({ where: { id, organizationId: user.organizationId, state: { in: ["FAILED", "UNKNOWN"] } }, data: { state: "PENDING", nextAttemptAt: new Date(), errorCode: null } }); requireValue(result.count === 1, "This notification is not eligible for retry."); await this.qc.history(tx, user, "delivery_retry_requested", { deliveryId: id, reason }); return { queued: true }; });
  }
}
