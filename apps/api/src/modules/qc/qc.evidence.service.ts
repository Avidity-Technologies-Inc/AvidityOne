import { ConflictException, Injectable } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { DevicesService } from "../devices/devices.service";
import { QcService, qcJson } from "./qc.service";
import { QcWorkService } from "./qc.work.service";
import { requireValue } from "./qc.rules";
import { QcHoldDto, QcResumeDto, QcRmmLinkDto } from "./dto/qc-evidence.dto";

@Injectable()
export class QcEvidenceService {
  constructor(private readonly qc: QcService, private readonly work: QcWorkService, private readonly devices: DevicesService) {}
  async context(ticketId: string, user: AuthenticatedUser) {
    await this.work.ticket(ticketId, user);
    const ticket = await this.qc.prisma.ticket.findFirstOrThrow({ where: { id: ticketId, organizationId: user.organizationId }, select: { clientId: true } });
    return { devices: ticket.clientId ? await this.qc.prisma.device.findMany({ where: { clientId: ticket.clientId, deletedAt: null, OR: [{ remoteAccessId: { not: null } }, { remoteAccessProfile: { isNot: null } }] }, select: { id: true, name: true, hostname: true } }) : [], profile: await this.qc.prisma.qcTicketProfile.findUnique({ where: { ticketId } }), rmmEvidence: await this.qc.prisma.qcRmmEvidence.findMany({ where: { ticketId, organizationId: user.organizationId }, orderBy: { createdAt: "desc" }, take: 100 }), holds: (await this.qc.prisma.qcWorkEvent.findMany({ where: { ticketId, organizationId: user.organizationId, kind: { in: ["SCHEDULED_HOLD", "HOLD_RESUMED"] } }, select: { id: true, kind: true, occurredAt: true, snapshot: true }, orderBy: { occurredAt: "desc" } })) };
  }
  async link(ticketId: string, input: QcRmmLinkDto, user: AuthenticatedUser) {
    await this.work.ticket(ticketId, user);
    const ticket = await this.qc.prisma.ticket.findFirstOrThrow({ where: { id: ticketId, organizationId: user.organizationId }, select: { clientId: true } });
    requireValue(await this.qc.prisma.device.findFirst({ where: { id: input.deviceId, clientId: ticket.clientId ?? "00000000-0000-0000-0000-000000000000", client: { organizationId: user.organizationId }, deletedAt: null } }), "The RMM device must belong to this ticket's client.");
    requireValue(input.alertReference.trim() && input.reason.trim() && new Date(input.triggeredAt) <= new Date(), "Record the actual alert reference, time and correlation evidence.");
    return this.qc.prisma.$transaction(async tx => {
      const previous = await tx.qcTicketProfile.findUnique({ where: { ticketId } });
      if (previous) {
        const changed = await tx.qcTicketProfile.updateMany({ where: { ticketId, version: input.version }, data: { rmmDeviceId: input.deviceId, rmmAlertReference: input.alertReference.trim(), rmmTriggeredAt: new Date(input.triggeredAt), version: { increment: 1 } } });
        if (changed.count !== 1) throw new ConflictException("QC work details changed. Reload before linking the alert.");
      } else { requireValue(input.version === 0, "Reload work details."); await tx.qcTicketProfile.create({ data: { organizationId: user.organizationId, ticketId, rmmDeviceId: input.deviceId, rmmAlertReference: input.alertReference.trim(), rmmTriggeredAt: new Date(input.triggeredAt), version: 1 } }); }
      await this.qc.history(tx, user, "rmm_alert_linked", { ticketId, deviceId: input.deviceId, alertReference: input.alertReference, triggeredAt: input.triggeredAt, reason: input.reason, provenance: "USER_CORRELATED" }); return { linked: true };
    });
  }
  async verifyRmm(ticketId: string, user: AuthenticatedUser) {
    await this.work.ticket(ticketId, user);
    const profile = await this.qc.prisma.qcTicketProfile.findUnique({ where: { ticketId } });
    requireValue(profile?.rmmDeviceId && profile.rmmAlertReference && profile.rmmTriggeredAt, "Link this ticket to its actual device and alert first.");
    const program = await this.qc.program(user), config = program.configuration;
    requireValue(config.rmmVerificationMode && config.rmmEvidenceFreshnessMinutes, "Configure RMM verification mode and evidence freshness first.");
    let evidence: Record<string, unknown>; let result = "UNAVAILABLE";
    try {
      const observation = await this.devices.qcObservation(user, profile.rmmDeviceId, profile.rmmAlertReference);
      const now = new Date();
      const seen = observation.lastSeenAt;
      const fresh = seen && seen <= now && seen >= profile.rmmTriggeredAt && now.getTime() - seen.getTime() <= config.rmmEvidenceFreshnessMinutes * 60000;
      const cleared = observation.alertStatus && config.rmmClearedStatuses.includes(observation.alertStatus) && observation.alertUpdatedAt && observation.alertUpdatedAt >= profile.rmmTriggeredAt && observation.alertUpdatedAt <= now;
      result = fresh && (config.rmmVerificationMode === "CHECK_IN" || cleared) ? "VERIFIED" : !fresh ? "STALE_OR_MISSING_CHECK_IN" : "ALERT_CLEARANCE_UNAVAILABLE";
      evidence = { ...observation, mode: config.rmmVerificationMode, freshnessMinutes: config.rmmEvidenceFreshnessMinutes, configurationVersion: program.version };
    } catch { evidence = { reason: "The configured RMM provider did not return verifiable evidence", configurationVersion: program.version }; }
    return this.qc.prisma.$transaction(async tx => {
      const item = await tx.qcRmmEvidence.create({ data: { organizationId: user.organizationId, ticketId, deviceId: profile.rmmDeviceId!, actorId: user.id, alertReference: profile.rmmAlertReference!, result, evidence: qcJson(evidence) } });
      await tx.qcWorkEvent.create({ data: { organizationId: user.organizationId, ticketId, actorId: user.id, kind: "RMM_OBSERVED", sourceId: item.id, snapshot: qcJson({ evidenceId: item.id, result }) } });
      await this.qc.history(tx, user, "rmm_evidence_recorded", { ticketId, evidenceId: item.id, result }); return item;
    });
  }
  async hold(ticketId: string, input: QcHoldDto, user: AuthenticatedUser) {
    await this.work.ticket(ticketId, user);
    const until = new Date(input.until);
    requireValue(input.reason.trim() && until > new Date() && until.getTime() - Date.now() <= 366 * 86400000, "Choose a future work date within a year and record the scheduling reason.");
    return this.qc.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM tickets WHERE id=${ticketId}::uuid FOR UPDATE`;
      const active = await tx.qcWorkEvent.findMany({ where: { ticketId, kind: { in: ["SCHEDULED_HOLD", "HOLD_RESUMED"] } }, orderBy: { occurredAt: "asc" } });
      requireValue(!active.some(event => event.kind === "SCHEDULED_HOLD" && new Date((event.snapshot as { until: string }).until) > new Date() && !active.some(resumed => resumed.kind === "HOLD_RESUMED" && (resumed.snapshot as { holdId: string }).holdId === event.id)), "Resume the active scheduled hold before creating another.");
      const hold = await tx.qcWorkEvent.create({ data: { organizationId: user.organizationId, ticketId, actorId: user.id, kind: "SCHEDULED_HOLD", snapshot: qcJson({ until, reason: input.reason }) } });
      await this.qc.history(tx, user, "scheduled_hold_created", { ticketId, holdId: hold.id, until, reason: input.reason }); return { id: hold.id };
    });
  }
  async resume(ticketId: string, input: QcResumeDto, user: AuthenticatedUser) {
    await this.work.ticket(ticketId, user);
    requireValue(input.reason.trim(), "Record why scheduled work resumes.");
    return this.qc.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM tickets WHERE id=${ticketId}::uuid FOR UPDATE`;
      const hold = await tx.qcWorkEvent.findFirst({ where: { id: input.holdId, ticketId, organizationId: user.organizationId, kind: "SCHEDULED_HOLD" } });
      requireValue(hold && new Date((hold.snapshot as { until: string }).until) > new Date(), "This scheduled hold is no longer active.");
      requireValue(!await tx.qcWorkEvent.count({ where: { ticketId, kind: "HOLD_RESUMED", sourceId: hold.id } }), "This hold was already resumed.");
      await tx.qcWorkEvent.create({ data: { organizationId: user.organizationId, ticketId, actorId: user.id, kind: "HOLD_RESUMED", sourceId: hold.id, snapshot: qcJson({ holdId: hold.id, reason: input.reason }) } });
      await this.qc.history(tx, user, "scheduled_hold_resumed", { ticketId, holdId: hold.id, reason: input.reason }); return { resumed: true };
    });
  }
}
