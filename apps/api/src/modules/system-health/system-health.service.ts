import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AttachmentScanResult, AttachmentScanStatus, Prisma } from "@prisma/client";
import { promises as fs } from "node:fs";
import path from "node:path";
import { rmmHealth } from "./rmm-health";
import { AuthenticatedUser } from "../auth/auth.types";
import { FileScanService } from "../file-storage/file-scan.service";
import { PrismaService } from "../prisma/prisma.service";

export type SystemHealthStatus = "ok" | "warning" | "error" | "disabled" | "unknown";
export type SystemHealthRange = "daily" | "weekly" | "monthly" | "yearly";
export type SystemHealthTimelineStatus = SystemHealthStatus | "unknown";

export interface SystemHealthComponent {
  key: string;
  name: string;
  status: SystemHealthStatus;
  severity: "green" | "orange" | "red" | "gray";
  message: string;
  checkedAt: string;
  metadata?: Record<string, unknown>;
}

const rangeHours: Record<SystemHealthRange, number> = {
  daily: 24,
  weekly: 24 * 7,
  monthly: 24 * 30,
  yearly: 24 * 365
};

const timelineRanges: Record<SystemHealthRange, { bucketCount: number; bucketHours: number }> = {
  daily: { bucketCount: 24, bucketHours: 1 },
  weekly: { bucketCount: 7, bucketHours: 24 },
  monthly: { bucketCount: 30, bucketHours: 24 },
  yearly: { bucketCount: 52, bucketHours: 24 * 7 }
};

const componentNames: Record<string, string> = {
  devices: "Devices / RMM Sync",
  database: "Database",
  storage: "Local storage",
  mail: "Mail flow",
  support_portal: "Support portal",
  event_services: "Event services",
  ai: "AI providers",
  antivirus: "Antivirus scanner",
  audit_logs: "Audit logs"
};

function componentStatus(status: SystemHealthStatus) {
  if (status === "disabled" || status === "unknown") return "gray" as const;
  if (status === "error") return "red" as const;
  if (status === "warning") return "orange" as const;
  return "green" as const;
}

function buildComponent(
  key: string,
  name: string,
  status: SystemHealthStatus,
  message: string,
  metadata?: Record<string, unknown>
): SystemHealthComponent {
  return {
    key,
    name,
    status,
    severity: componentStatus(status),
    message,
    checkedAt: new Date().toISOString(),
    metadata
  };
}

@Injectable()
export class SystemHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SystemHealthService.name);
  private automaticCheckTimer?: NodeJS.Timeout;
  private automaticCheckRunning = false;
  private readonly summaries = new Map<string, {expires: number; value: Awaited<ReturnType<SystemHealthService["getSummaryForOrganization"]>>}>();
  private readonly pendingSummaries = new Map<string, Promise<Awaited<ReturnType<SystemHealthService["getSummaryForOrganization"]>>>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileScan: FileScanService
  ) {}

  onModuleInit() {
    const intervalMs = this.automaticCheckIntervalMs();
    this.automaticCheckTimer = setInterval(() => {
      void this.runAutomaticCheck();
    }, intervalMs);
  }

  onModuleDestroy() {
    if (this.automaticCheckTimer) {
      clearInterval(this.automaticCheckTimer);
    }
  }

  async getSummary(user: AuthenticatedUser, record = false) {
    const organizationId = user.organizationId;
    let summary;
    if (record) {
      summary = await this.getSummaryForOrganization(organizationId, true);
      this.summaries.delete(organizationId);
    } else {
      const cached = this.summaries.get(organizationId);
      if (cached && cached.expires > Date.now()) summary = cached.value;
      else {
        let pending = this.pendingSummaries.get(organizationId);
        if (!pending) {
          pending = this.getSummaryForOrganization(organizationId, false).then(value => {
            if (this.summaries.size >= 100) this.summaries.clear();
            this.summaries.set(organizationId, {expires: Date.now() + 15_000, value});
            return value;
          }).finally(() => this.pendingSummaries.delete(organizationId));
          this.pendingSummaries.set(organizationId, pending);
        }
        summary = await pending;
      }
    }
    // The header clock is available to all authenticated users; diagnostic details are administrative.
    if (user.permissions.includes("system_settings.view")) return {...summary, links: {devices: user.permissions.includes("devices.view"), rmm: user.permissions.includes("remote_access.configure")}};
    return {...summary, components: summary.components.map(({key, name, status}) => ({key, name, status}))};
  }

  private async getSummaryForOrganization(organizationId: string, record = false, source = "manual") {
    const database = await this.checkDatabase();
    if (database.status === "error") {
      return this.aggregate(organizationId, [database], null, record, source);
    }

    const settings = await this.prisma.systemSetting.findUnique({
      where: { organizationId },
      select: {supportPortalEnabled: true, aiAssistantEnabled: true, defaultTimezone: true, dateFormat: true, timeFormat: true,
        remoteAccessProviderEnabled: true, remoteAccessAutoSyncEnabled: true, remoteAccessAutoSyncIntervalMinutes: true,
        remoteAccessLastSyncAt: true, remoteAccessLastSuccessAt: true, remoteAccessLastSyncStatus: true,
        remoteAccessNextAutoSyncAt: true, remoteAccessAutoSyncLockedAt: true}
    });

    const checks: Array<[string, () => Promise<SystemHealthComponent>]> = [
      ["storage", () => this.checkStorage()], ["mail", () => this.checkMail(organizationId)],
      ["support_portal", () => this.checkSupportPortal(organizationId, settings?.supportPortalEnabled ?? false)],
      ["event_services", () => this.checkEventServices(organizationId)],
      ["ai", () => this.checkAi(organizationId, settings?.aiAssistantEnabled ?? false)],
      ["antivirus", () => this.checkAntivirus(organizationId)], ["audit_logs", () => this.checkAuditLogs(organizationId)],
      ["devices", async () => {
        if (!settings) return buildComponent("devices", componentNames.devices, "unknown", "RMM settings are unavailable.");
        const latest = await this.prisma.systemHealthSnapshot.findFirst({where: {organizationId, component: "devices", source: {in: ["rmm_auto", "rmm_manual"]}}, orderBy: {checkedAt: "desc"}, select: {checkedAt: true, metadata: true, source: true}});
        const health = rmmHealth(settings, new Date(), latest);
        return buildComponent("devices", componentNames.devices, health.status, health.message, {...health.metadata, latestOutcome: latest ? {...latest, checkedAt: latest.checkedAt.toISOString()} : null});
      }]
    ];
    const components = await Promise.all(checks.map(async ([key, check]) => {
      try { return await check(); }
      catch { return buildComponent(key, componentNames[key], "unknown", "This check could not complete. Review service logs."); }
    }));
    return this.aggregate(organizationId, [database, ...components], settings, record, source);
  }

  private range(range: string) {
    if (!Object.hasOwn(rangeHours, range)) throw new BadRequestException("Invalid health range.");
    const selected = range as SystemHealthRange;
    const to = new Date();
    return {selected, to, from: new Date(to.getTime() - rangeHours[selected] * 3_600_000)};
  }

  async getHistory(organizationId: string, range = "daily", pageValue = "1", component?: string, status?: string) {
    const {selected, from, to} = this.range(range);
    if (!/^\d+$/.test(pageValue) || !Number.isSafeInteger(Number(pageValue)) || Number(pageValue) < 1) throw new BadRequestException("Invalid history page.");
    if (component && !Object.hasOwn(componentNames, component)) throw new BadRequestException("Invalid health component.");
    if (status && !["ok", "warning", "error", "unknown", "disabled"].includes(status)) throw new BadRequestException("Invalid health status.");
    const where: Prisma.SystemHealthSnapshotWhereInput = {organizationId, checkedAt: {gte: from, lte: to}, ...(component ? {component} : {}), ...(status ? {status} : {})};
    const grouped = await this.prisma.systemHealthSnapshot.groupBy({by: ["status"], where, _count: {_all: true}});
    const totals = {ok: 0, warning: 0, error: 0, unknown: 0, disabled: 0};
    for (const group of grouped) if (Object.hasOwn(totals, group.status)) totals[group.status as keyof typeof totals] = group._count._all;
    const total = grouped.reduce((sum, group) => sum + group._count._all, 0);
    const pageSize = 25;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Number(pageValue), totalPages);
    const snapshots = await this.prisma.systemHealthSnapshot.findMany({where, orderBy: [{checkedAt: "desc"}, {id: "desc"}], skip: (page - 1) * pageSize, take: pageSize});
    return {range: selected, from: from.toISOString(), to: to.toISOString(), totals, total, page, pageSize, totalPages,
      snapshots: snapshots.map(item => ({...item, name: componentNames[item.component] ?? item.component, checkedAt: item.checkedAt.toISOString()}))};
  }

  async getTimeline(organizationId: string, range = "daily") {
    const {selected, from, to} = this.range(range);
    const {bucketCount} = timelineRanges[selected];
    const bucketSeconds = (to.getTime() - from.getTime()) / 1000 / bucketCount;
    // Aggregate in PostgreSQL rather than loading a year's individual snapshots into the API.
    const rows = await this.prisma.$queryRaw<Array<{component: string; bucket: number; status: string; count: bigint}>>(Prisma.sql`
      SELECT component, FLOOR(EXTRACT(EPOCH FROM ("checkedAt" - ${from}::timestamp)) / ${bucketSeconds})::int AS bucket,
        status, COUNT(*) AS count FROM system_health_snapshots
      WHERE "organizationId" = ${organizationId}::uuid AND "checkedAt" >= ${from} AND "checkedAt" < ${to}
      GROUP BY component, bucket, status`);
    return {range: selected, from: from.toISOString(), to: to.toISOString(), bucketHours: bucketSeconds / 3600,
      components: Object.entries(componentNames).map(([key, name]) => {
        const buckets = Array.from({length: bucketCount}, (_, index) => {
          const samples = rows.filter(row => row.component === key && row.bucket === index);
          const snapshotCount = samples.reduce((sum, row) => sum + Number(row.count), 0);
          const states = new Set(samples.map(row => row.status));
          const status: SystemHealthTimelineStatus = states.has("error") ? "error" : states.has("warning") ? "warning" : states.has("unknown") ? "unknown" : states.has("ok") ? "ok" : states.has("disabled") ? "disabled" : "unknown";
          return {id: `${key}-${index}`, start: new Date(from.getTime() + index * bucketSeconds * 1000).toISOString(), end: new Date(from.getTime() + (index + 1) * bucketSeconds * 1000).toISOString(), status, severity: componentStatus(status), snapshotCount, message: snapshotCount ? `${snapshotCount} observations; worst recorded state: ${status}.` : "No observations recorded."};
        });
        const observed = buckets.filter(bucket => bucket.snapshotCount > 0).length;
        const assessed = buckets.filter(bucket => ["ok", "warning", "error"].includes(bucket.status)).length;
        return {key, name, healthyPercent: assessed ? Math.round(buckets.filter(bucket => bucket.status === "ok").length / assessed * 1000) / 10 : null,
          coveragePercent: Math.round(observed / bucketCount * 1000) / 10, warningCount: buckets.filter(b => b.status === "warning").length,
          errorCount: buckets.filter(b => b.status === "error").length, unknownCount: buckets.filter(b => b.status === "unknown").length, buckets};
      })};
  }

  private async aggregate(organizationId: string, components: SystemHealthComponent[], settings: { defaultTimezone: string; dateFormat: string; timeFormat: string } | null, record: boolean, source = "manual") {
    const aggregateStatus: SystemHealthStatus = components.some((component) => component.status === "error")
      ? "error"
      : components.some((component) => component.status === "warning" || component.status === "unknown")
        ? "warning"
        : "ok";

    let recorded = false;
    if (record) {
      try {
      await this.prisma.systemHealthSnapshot.createMany({
        data: components.map((component) => ({
          organizationId, source,
          component: component.key,
          status: component.status,
          severity: component.severity,
          message: component.message,
          metadata: component.metadata ? (component.metadata as Prisma.InputJsonValue) : Prisma.JsonNull
        }))
      });
      recorded = true;
      } catch { this.logger.warn("System health snapshot could not be recorded."); }
    }

    return {
      status: aggregateStatus,
      severity: componentStatus(aggregateStatus),
      checkedAt: new Date().toISOString(),
      serverTime: new Date().toISOString(),
      timezone: settings?.defaultTimezone ?? process.env.DEFAULT_TIMEZONE ?? process.env.TZ ?? "UTC",
      dateFormat: settings?.dateFormat ?? "MMM dd, yyyy",
      timeFormat: settings?.timeFormat ?? "12h",
      components,
      recorded,
      recordingError: record && !recorded ? "The check completed but its snapshot could not be saved." : null,
      automaticCheckIntervalMinutes: this.automaticCheckIntervalMs() / 60_000,
      organizationId
    };
  }

  private automaticCheckIntervalMs() {
    const configured = Number(process.env.SYSTEM_HEALTH_AUTO_CHECK_INTERVAL_MS);
    if (Number.isFinite(configured) && configured >= 60_000) {
      return configured;
    }
    return 15 * 60 * 1000;
  }

  private async runAutomaticCheck() {
    if (this.automaticCheckRunning) {
      return;
    }
    this.automaticCheckRunning = true;
    try {
      const organizations = await this.prisma.organization.findMany({select: {id: true}, orderBy: {createdAt: "asc"}});
      for (const organization of organizations) {
        try { await this.getSummaryForOrganization(organization.id, true, "automatic"); }
        catch { this.logger.warn(`Health check failed for organization ${organization.id}.`); }
      }
    } catch (error) {
      this.logger.warn(`Automatic system health check failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      this.automaticCheckRunning = false;
    }
  }

  private async checkDatabase() {
    try {
      await this.prisma.$queryRawUnsafe("SELECT 1");
      return buildComponent("database", "Database", "ok", "PostgreSQL connection is healthy.");
    } catch {
      return buildComponent("database", "Database", "error", "PostgreSQL connection failed.");
    }
  }

  private async checkStorage() {
    const storagePath = path.resolve(process.env.INIT_CWD ?? process.cwd(), process.env.LOCAL_STORAGE_PATH ?? "storage/local");
    try {
      await fs.access(storagePath);
      return buildComponent("storage", "Local storage", "ok", "Local storage path is reachable.", { path: storagePath });
    } catch {
      return buildComponent("storage", "Local storage", "warning", "Local storage path is not reachable.", { path: storagePath });
    }
  }

  private async checkMail(organizationId: string) {
    const mailboxes = await this.prisma.mailbox.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, emailAddress: true, autoSyncEnabled: true, nextAutoSyncAt: true, lastSyncError: true }
    });
    if (mailboxes.length === 0) {
      return buildComponent("mail", "Mail flow", "warning", "No active mailbox is configured.");
    }

    const syncErrors = mailboxes.filter((mailbox) => mailbox.lastSyncError);
    const overdue = mailboxes.filter((mailbox) => mailbox.autoSyncEnabled && mailbox.nextAutoSyncAt && mailbox.nextAutoSyncAt.getTime() < Date.now() - 15 * 60 * 1000);
    if (syncErrors.length > 0) {
      return buildComponent("mail", "Mail flow", "warning", `${syncErrors.length} active mailbox${syncErrors.length === 1 ? "" : "es"} report sync errors.`, {
        affectedMailboxes: syncErrors.map((mailbox) => mailbox.emailAddress)
      });
    }
    if (overdue.length > 0) {
      return buildComponent("mail", "Mail flow", "warning", `${overdue.length} mailbox sync schedule${overdue.length === 1 ? " is" : "s are"} overdue.`);
    }
    return buildComponent("mail", "Mail flow", "ok", `${mailboxes.length} active mailbox${mailboxes.length === 1 ? "" : "es"} configured; no recorded sync errors or overdue schedules. Outbound delivery is not verified.`);
  }

  private async checkSupportPortal(organizationId: string, enabled: boolean) {
    if (!enabled) {
      return buildComponent("support_portal", "Support portal", "disabled", "Support portal is disabled in Settings.");
    }
    const activeForms = await this.prisma.supportPortalForm.count({ where: { organizationId, isActive: true } });
    return buildComponent("support_portal", "Support portal", activeForms > 0 ? "ok" : "warning", activeForms > 0 ? `${activeForms} active support form${activeForms === 1 ? "" : "s"} configured; public availability is not verified.` : "No active support portal form is available.");
  }

  private async checkEventServices(organizationId: string) {
    const activeServices = await this.prisma.eventServiceService.count({ where: { organizationId, isActive: true } });
    return buildComponent("event_services", "Event services", activeServices > 0 ? "ok" : "warning", activeServices > 0 ? `${activeServices} active event service${activeServices === 1 ? "" : "s"} configured; public availability is not verified.` : "No active event service is configured.");
  }

  private async checkAi(organizationId: string, enabled: boolean) {
    if (!enabled) {
      return buildComponent("ai", "AI providers", "disabled", "AI assistant is disabled in Settings.");
    }
    const enabledProviders = await this.prisma.aiProviderConfig.count({ where: { organizationId, isEnabled: true } });
    return buildComponent("ai", "AI providers", enabledProviders > 0 ? "ok" : "warning", enabledProviders > 0 ? `${enabledProviders} enabled AI provider${enabledProviders === 1 ? "" : "s"} configured; provider connectivity is not verified.` : "No enabled AI provider is configured.");
  }

  private async checkAntivirus(organizationId: string) {
    const [scanner, ticketCounts, eventCounts] = await Promise.all([
      this.fileScan.getScannerHealth(),
      this.scanCountsForTickets(organizationId),
      this.scanCountsForEventServices(organizationId)
    ]);
    const totals = {
      total: ticketCounts.total + eventCounts.total,
      clean: ticketCounts.clean + eventCounts.clean,
      quarantined: ticketCounts.quarantined + eventCounts.quarantined,
      pending: ticketCounts.pending + eventCounts.pending,
      skipped: ticketCounts.skipped + eventCounts.skipped,
      restored: ticketCounts.restored + eventCounts.restored
    };

    const metadata = {
      endpoint: scanner.endpoint,
      enabled: scanner.enabled,
      failClosed: scanner.failClosed,
      reachable: scanner.reachable,
      version: scanner.version,
      counts: totals
    };

    if (!scanner.enabled) {
      return buildComponent("antivirus", "Antivirus scanner", "warning", "ClamAV is not enabled for attachment scanning.", metadata);
    }
    if (!scanner.reachable) {
      return buildComponent("antivirus", "Antivirus scanner", scanner.failClosed ? "error" : "warning", scanner.error ?? "ClamAV is not reachable.", metadata);
    }
    if (totals.quarantined > 0) {
      return buildComponent("antivirus", "Antivirus scanner", "warning", `${totals.quarantined} quarantined attachment${totals.quarantined === 1 ? "" : "s"} need review.`, metadata);
    }
    if (totals.pending > 0 || totals.skipped > 0) {
      return buildComponent("antivirus", "Antivirus scanner", "warning", `${totals.pending + totals.skipped} attachment${totals.pending + totals.skipped === 1 ? "" : "s"} are not fully scanned.`, metadata);
    }
    return buildComponent("antivirus", "Antivirus scanner", "ok", `${totals.clean} attachment${totals.clean === 1 ? "" : "s"} scanned clean.`, metadata);
  }

  private async scanCountsForTickets(organizationId: string) {
    const [total, clean, quarantined, pending, skipped, restored] = await Promise.all([
      this.prisma.ticketAttachment.count({ where: { ticket: { organizationId }, deletedAt: null } }),
      this.prisma.ticketAttachment.count({ where: { ticket: { organizationId }, deletedAt: null, scanStatus: AttachmentScanStatus.CLEAN, scanResult: AttachmentScanResult.PASSED } }),
      this.prisma.ticketAttachment.count({ where: { ticket: { organizationId }, deletedAt: null, scanStatus: { in: [AttachmentScanStatus.SUSPICIOUS, AttachmentScanStatus.BLOCKED] } } }),
      this.prisma.ticketAttachment.count({ where: { ticket: { organizationId }, deletedAt: null, scanStatus: AttachmentScanStatus.PENDING } }),
      this.prisma.ticketAttachment.count({ where: { ticket: { organizationId }, deletedAt: null, scanResult: AttachmentScanResult.SKIPPED } }),
      this.prisma.ticketAttachment.count({ where: { ticket: { organizationId }, deletedAt: null, scanOverriddenAt: { not: null } } })
    ]);
    return { total, clean, quarantined, pending, skipped, restored };
  }

  private async scanCountsForEventServices(organizationId: string) {
    const [total, clean, quarantined, pending, skipped, restored] = await Promise.all([
      this.prisma.eventServiceAttachment.count({ where: { request: { organizationId }, deletedAt: null } }),
      this.prisma.eventServiceAttachment.count({ where: { request: { organizationId }, deletedAt: null, scanStatus: AttachmentScanStatus.CLEAN, scanResult: AttachmentScanResult.PASSED } }),
      this.prisma.eventServiceAttachment.count({ where: { request: { organizationId }, deletedAt: null, scanStatus: { in: [AttachmentScanStatus.SUSPICIOUS, AttachmentScanStatus.BLOCKED] } } }),
      this.prisma.eventServiceAttachment.count({ where: { request: { organizationId }, deletedAt: null, scanStatus: AttachmentScanStatus.PENDING } }),
      this.prisma.eventServiceAttachment.count({ where: { request: { organizationId }, deletedAt: null, scanResult: AttachmentScanResult.SKIPPED } }),
      this.prisma.eventServiceAttachment.count({ where: { request: { organizationId }, deletedAt: null, scanOverriddenAt: { not: null } } })
    ]);
    return { total, clean, quarantined, pending, skipped, restored };
  }

  private async checkAuditLogs(organizationId: string) {
    const recent = await this.prisma.auditLog.count({
      where: { organizationId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
    });
    return buildComponent("audit_logs", "Audit logs", "ok", `${recent} audit event${recent === 1 ? "" : "s"} recorded in the last 24 hours.`);
  }
}
