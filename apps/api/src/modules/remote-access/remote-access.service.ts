import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditLogsService } from "../audit-logs/audit-logs.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";

type RemoteAccessAttemptMode = "control" | "background";

@Injectable()
export class RemoteAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService
  ) {}

  async auditConnectionAttempt(deviceId: string, user: AuthenticatedUser, mode: RemoteAccessAttemptMode = "control") {
    const profile = await this.prisma.remoteAccessProfile.findUnique({
      where: { deviceId },
      include: { device: { include: { client: true, installations: {where:{state:"CURRENT"},select:{reviewReason:true}} } } }
    });

    if (!profile) {
      throw new NotFoundException("Remote access profile was not found.");
    }
    if (profile.device.client.organizationId !== user.organizationId) {
      throw new NotFoundException("Remote access profile was not found.");
    }

    if (profile.device.deletedAt || profile.device.installations?.some(row=>row.reviewReason)) throw new BadRequestException("Review this device identity before connecting.");

    const settings = await this.prisma.systemSetting.findUnique({ where: { organizationId: user.organizationId } });
    const attemptedAt = new Date();
    const tokens = {
      agentId: profile.remoteIdentifier,
      deviceId: profile.remoteIdentifier,
      hostname: profile.device.hostname ?? profile.device.name,
      clientName: profile.device.client.name,
      siteName: profile.device.deviceGroupId ?? "",
      meshNodeId: profile.remoteIdentifier,
      agentPlatform: this.inferAgentPlatform(profile.device.operatingSystem)
    };
    const connectionUrl =
      mode === "background"
        ? this.buildConnectionUrl(settings?.remoteAccessBackgroundUrlTemplate ?? this.defaultBackgroundUrlTemplate(settings?.remoteAccessDashboardUrl), tokens)
        : this.buildConnectionUrl(settings?.remoteAccessControlUrlTemplate, tokens) ?? profile.connectionUrl;

    await this.prisma.remoteAccessProfile.update({
      where: { id: profile.id },
      data: { lastConnectionAttemptAt: attemptedAt }
    });

    await this.auditLogs.create({
      userId: user.id,
      entityType: "RemoteAccessProfile",
      entityId: profile.id,
      action: "remote_access.connection_attempted",
      metadata: {
        deviceId,
        provider: profile.provider,
        remoteIdentifier: profile.remoteIdentifier,
        mode
      }
    });

    return {
      id: profile.id,
      provider: profile.provider,
      remoteIdentifier: profile.remoteIdentifier,
      connectionUrl,
      lastConnectionAttemptAt: attemptedAt,
      deviceId
    };
  }

  private buildConnectionUrl(template: string | null | undefined, tokens: Record<string, string>) {
    const source = template?.trim();
    if (!source) return null;
    return Object.entries(tokens).reduce((url, [key, value]) => url.replaceAll(`{${key}}`, encodeURIComponent(value)), source);
  }

  private defaultBackgroundUrlTemplate(dashboardUrl: string | null | undefined) {
    const base = dashboardUrl?.trim();
    if (!base) return null;
    return `${base.replace(/\/+$/, "")}/remotebackground/{agentId}?agentPlatform={agentPlatform}`;
  }

  private inferAgentPlatform(operatingSystem?: string | null) {
    const source = (operatingSystem ?? "").toLowerCase();
    if (source.includes("linux") || source.includes("ubuntu") || source.includes("debian") || source.includes("centos") || source.includes("rhel") || source.includes("rocky") || source.includes("alma")) {
      return "linux";
    }
    if (source.includes("mac") || source.includes("darwin")) return "darwin";
    return "windows";
  }
}
