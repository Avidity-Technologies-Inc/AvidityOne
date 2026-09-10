import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DeviceStatus, DeviceType, DeviceViewScope, Prisma, RemoteAccessProvider } from "@prisma/client";
import { AuditLogsService } from "../audit-logs/audit-logs.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { validateIntegrationUrl } from "../../common/integration-url-policy";
import { PrismaService } from "../prisma/prisma.service";
import { DeviceQueryDto } from "./dto/device-query.dto";
import { UpdateRmmSettingsDto } from "./dto/update-rmm-settings.dto";
import { UpsertDeviceViewDto } from "./dto/upsert-device-view.dto";

type RmmAgentRecord = Record<string, unknown>;

interface NormalizedRmmAgent {
  remoteIdentifier: string;
  remoteIdentifiers: string[];
  name: string;
  hostname: string | null;
  clientName: string;
  siteName: string | null;
  operatingSystem: string | null;
  osVersion: string | null;
  serialNumber: string | null;
  assetTag: string | null;
  primaryUser: string | null;
  status: DeviceStatus;
  type: DeviceType;
  lastSeenAt: Date | null;
  systemInfoUrl: string | null;
  controlUrl: string | null;
  detailSnapshot: RemoteAccessDetailSnapshot;
}

interface RemoteAccessDiskSummary {
  name: string;
  fileSystem: string | null;
  totalBytes: number | null;
  freeBytes: number | null;
  usedPercent: number | null;
}

interface RemoteAccessDetailSnapshot {
  syncedAt: string;
  hardware: {
    manufacturer: string | null;
    model: string | null;
    cpu: string | null;
    cpuCores: string | null;
    memory: string | null;
    video: string | null;
    serialNumber: string | null;
  };
  network: {
    publicIp: string | null;
    localIps: string[];
    macAddresses: string[];
  };
  storage: {
    disks: RemoteAccessDiskSummary[];
  };
  agent: {
    version: string | null;
    bootTime: string | null;
    uptime: string | null;
    lastResponse: string | null;
    lastSeen: string | null;
    loggedInUser: string | null;
  };
  checks: {
    status: string | null;
    summary: string | null;
  };
}

type RmmSettingsRecord = {
  id: string;
  organizationId: string;
  remoteAccessProviderEnabled: boolean;
  remoteAccessProviderName: string;
  remoteAccessApiBaseUrl: string | null;
  remoteAccessApiKeyReference: string | null;
  remoteAccessAgentsPath: string;
  remoteAccessDashboardUrl: string | null;
  remoteAccessDeviceUrlTemplate: string | null;
  remoteAccessControlUrlTemplate: string | null;
  remoteAccessBackgroundUrlTemplate: string | null;
  remoteAccessLastSyncAt: Date | null;
  remoteAccessLastSyncStatus: string | null;
  remoteAccessLastSyncMessage: string | null;
  remoteAccessAutoSyncEnabled: boolean;
  remoteAccessAutoSyncIntervalMinutes: number | null;
  remoteAccessNextAutoSyncAt: Date | null;
  remoteAccessAutoSyncLockedAt: Date | null;
};

type DeviceWithRemoteProfile = Prisma.DeviceGetPayload<{
  include: {
    client: { select: { id: true; name: true; shortName: true } };
    remoteAccessProfile: true;
    favorites: { select: { userId: true } };
  };
}>;

export interface DeviceActionUrls {
  systemInfoUrl: string | null;
  controlUrl: string | null;
  remoteBackgroundUrl: string | null;
}

type RemoteAccessSyncContext = {
  organizationId: string;
  userId: string | null;
  refreshDetails: boolean;
  trigger: "manual" | "auto";
};

const RMM_AUTO_SYNC_SCAN_INTERVAL_MS = 60_000;
const RMM_AUTO_SYNC_DEFER_MINUTES = 5;
const RMM_AUTO_SYNC_LOCK_STALE_MINUTES = 30;
const RMM_AUTO_SYNC_DEFAULT_INTERVAL_MINUTES = 60;
const RMM_SYNC_PRIORITY_WINDOW_MS = 2 * 60 * 1000;

@Injectable()
export class DevicesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DevicesService.name);
  private readonly runningAutoSyncs = new Set<string>();
  private autoSyncTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditLogs: AuditLogsService
  ) {}

  onModuleInit() {
    this.autoSyncTimer = setInterval(() => {
      void this.runDueRemoteAccessAutoSyncs();
    }, RMM_AUTO_SYNC_SCAN_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
    }
  }

  async list(user: AuthenticatedUser, query: DeviceQueryDto) {
    const where: Prisma.DeviceWhereInput = {
      deletedAt: null,
      client: { organizationId: user.organizationId }
    };
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { hostname: { contains: search, mode: "insensitive" } },
        { operatingSystem: { contains: search, mode: "insensitive" } },
        { primaryUser: { contains: search, mode: "insensitive" } },
        { remoteAccessId: { contains: search, mode: "insensitive" } },
        { client: { name: { contains: search, mode: "insensitive" } } }
      ];
    }
    if (query.clientId) {
      where.clientId = query.clientId;
    }
    if (this.isDeviceStatus(query.status)) {
      where.status = query.status;
    }
    if (this.isDeviceType(query.type)) {
      where.type = query.type;
    }

    const totalDevicesWhere: Prisma.DeviceWhereInput = {
      deletedAt: null,
      client: { organizationId: user.organizationId }
    };

    const [devices, totalDevices, clients, settings] = await Promise.all([
      this.prisma.device.findMany({
        where,
        include: {
          client: { select: { id: true, name: true, shortName: true } },
          remoteAccessProfile: true,
          favorites: { where: { userId: user.id }, select: { userId: true } }
        },
        orderBy: [{ client: { name: "asc" } }, { name: "asc" }],
        take: 500
      }),
      this.prisma.device.count({ where: totalDevicesWhere }),
      this.prisma.client.findMany({
        where: { organizationId: user.organizationId, deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: "asc" }
      }),
      this.getSettingsRecord(user.organizationId)
    ]);

    const mappedDevices = devices
      .map((device) => this.toDeviceResponse(device, settings))
      .sort((left, right) => Number(right.isFavorite) - Number(left.isFavorite));

    return {
      devices: mappedDevices,
      totalDevices,
      clients,
      remoteAccess: this.toRmmSettingsResponse(settings)
    };
  }

  async getById(user: AuthenticatedUser, deviceId: string) {
    const [device, settings] = await Promise.all([
      this.prisma.device.findFirst({
        where: {
          id: deviceId,
          deletedAt: null,
          client: { organizationId: user.organizationId }
        },
        include: {
          client: { select: { id: true, name: true, shortName: true } },
          remoteAccessProfile: true,
          favorites: { where: { userId: user.id }, select: { userId: true } }
        }
      }),
      this.getSettingsRecord(user.organizationId)
    ]);

    if (!device) {
      throw new BadRequestException("Device was not found.");
    }

    return {
      device: this.toDeviceResponse(device, settings),
      remoteAccess: this.toRmmSettingsResponse(settings)
    };
  }

  async listViews(user: AuthenticatedUser) {
    return this.prisma.userDeviceView.findMany({
      where: {
        organizationId: user.organizationId,
        OR: [{ userId: user.id }, { scope: DeviceViewScope.ADMINISTRATORS }]
      },
      orderBy: [{ scope: "asc" }, { name: "asc" }]
    });
  }

  async saveView(user: AuthenticatedUser, input: UpsertDeviceViewDto) {
    const name = input.name.trim();
    const scope = this.normalizeViewScope(input.scope);
    this.assertCanUseViewScope(user, scope);
    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.userDeviceView.updateMany({
          where: { userId: user.id },
          data: { isDefault: false }
        });
      }

      return tx.userDeviceView.upsert({
        where: {
          userId_name: {
            userId: user.id,
            name
          }
        },
        update: {
          state: input.state as Prisma.InputJsonValue,
          scope,
          isDefault: input.isDefault ?? false
        },
        create: {
          organizationId: user.organizationId,
          userId: user.id,
          name,
          state: input.state as Prisma.InputJsonValue,
          scope,
          isDefault: input.isDefault ?? false
        }
      });
    });
  }

  async updateView(user: AuthenticatedUser, viewId: string, input: UpsertDeviceViewDto) {
    const existing = await this.prisma.userDeviceView.findFirst({
      where: {
        id: viewId,
        organizationId: user.organizationId,
        OR: [{ userId: user.id }, { scope: DeviceViewScope.ADMINISTRATORS }]
      },
      select: { id: true, userId: true, scope: true }
    });
    if (!existing) {
      throw new NotFoundException("Device view was not found.");
    }

    const name = input.name.trim();
    const scope = this.normalizeViewScope(input.scope);
    this.assertCanManageView(user, existing.userId, existing.scope);
    this.assertCanUseViewScope(user, scope);
    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.userDeviceView.updateMany({
          where: { userId: existing.userId, id: { not: viewId } },
          data: { isDefault: false }
        });
      }

      return tx.userDeviceView.update({
        where: { id: viewId },
        data: {
          name,
          state: input.state as Prisma.InputJsonValue,
          scope,
          isDefault: input.isDefault ?? false
        }
      });
    });
  }

  async deleteView(user: AuthenticatedUser, viewId: string) {
    const existing = await this.prisma.userDeviceView.findFirst({
      where: {
        id: viewId,
        organizationId: user.organizationId,
        OR: [{ userId: user.id }, { scope: DeviceViewScope.ADMINISTRATORS }]
      },
      select: { id: true, userId: true, scope: true }
    });
    if (!existing) {
      throw new NotFoundException("Device view was not found.");
    }
    this.assertCanManageView(user, existing.userId, existing.scope);

    await this.prisma.userDeviceView.delete({ where: { id: viewId } });
    return { deleted: true };
  }

  async setFavorite(user: AuthenticatedUser, deviceId: string, isFavorite: boolean) {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, deletedAt: null, client: { organizationId: user.organizationId } },
      select: { id: true }
    });
    if (!device) {
      throw new NotFoundException("Device was not found.");
    }

    if (isFavorite) {
      await this.prisma.userDeviceFavorite.upsert({
        where: { userId_deviceId: { userId: user.id, deviceId } },
        update: {},
        create: { userId: user.id, deviceId }
      });
      return { isFavorite: true };
    }

    await this.prisma.userDeviceFavorite.deleteMany({ where: { userId: user.id, deviceId } });
    return { isFavorite: false };
  }

  async getRemoteAccessSettings(user: AuthenticatedUser) {
    const settings = await this.getSettingsRecord(user.organizationId);
    return this.toRmmSettingsResponse(settings);
  }

  async updateRemoteAccessSettings(user: AuthenticatedUser, input: UpdateRmmSettingsDto) {
    if (input.enabled && input.apiKeyReference && !input.apiKeyReference.trim().startsWith("env:")) {
      throw new BadRequestException("Use an environment variable reference such as env:TACTICAL_RMM_API_KEY.");
    }

    const currentSettings = await this.getSettingsRecord(user.organizationId);
    const apiBaseUrl = validateIntegrationUrl(input.apiBaseUrl, this.config, {
      label: "RMM API base URL",
      allowedHostsEnv: "RMM_ALLOWED_HOSTS"
    });
    const dashboardUrl = validateIntegrationUrl(input.dashboardUrl, this.config, {
      label: "RMM dashboard URL",
      allowedHostsEnv: "RMM_ALLOWED_HOSTS"
    });
    const deviceUrlTemplate = validateIntegrationUrl(input.deviceUrlTemplate, this.config, {
      label: "RMM device URL template",
      allowedHostsEnv: "RMM_ALLOWED_HOSTS"
    });
    const controlUrlTemplate = validateIntegrationUrl(input.controlUrlTemplate, this.config, {
      label: "RMM control URL template",
      allowedHostsEnv: "RMM_ALLOWED_HOSTS"
    });
    const backgroundUrlTemplate = validateIntegrationUrl(input.backgroundUrlTemplate, this.config, {
      label: "RMM remote background URL template",
      allowedHostsEnv: "RMM_ALLOWED_HOSTS"
    });
    const autoSyncEnabled = input.enabled && Boolean(input.autoSyncEnabled);
    const autoSyncIntervalMinutes = autoSyncEnabled
      ? (input.autoSyncIntervalMinutes ?? currentSettings.remoteAccessAutoSyncIntervalMinutes ?? RMM_AUTO_SYNC_DEFAULT_INTERVAL_MINUTES)
      : null;
    const autoSyncScheduleChanged =
      autoSyncEnabled !== currentSettings.remoteAccessAutoSyncEnabled ||
      autoSyncIntervalMinutes !== currentSettings.remoteAccessAutoSyncIntervalMinutes;

    const settings = await this.prisma.systemSetting.update({
      where: { organizationId: user.organizationId },
      data: {
        remoteAccessProviderEnabled: input.enabled,
        remoteAccessProviderName: this.optionalTrim(input.providerName) ?? "Tactical RMM",
        remoteAccessApiBaseUrl: apiBaseUrl,
        remoteAccessApiKeyReference: this.optionalTrim(input.apiKeyReference),
        remoteAccessAgentsPath: this.normalizePath(input.agentsPath) ?? "/agents/",
        remoteAccessDashboardUrl: dashboardUrl,
        remoteAccessDeviceUrlTemplate: deviceUrlTemplate,
        remoteAccessControlUrlTemplate: controlUrlTemplate,
        remoteAccessBackgroundUrlTemplate: backgroundUrlTemplate,
        remoteAccessAutoSyncEnabled: autoSyncEnabled,
        remoteAccessAutoSyncIntervalMinutes: autoSyncIntervalMinutes,
        remoteAccessNextAutoSyncAt: autoSyncEnabled
          ? autoSyncScheduleChanged || !currentSettings.remoteAccessNextAutoSyncAt
            ? this.nextAutoSyncAt(autoSyncIntervalMinutes)
            : currentSettings.remoteAccessNextAutoSyncAt
          : null,
        remoteAccessAutoSyncLockedAt: null
      }
    });

    await this.auditLogs.create({
      userId: user.id,
      entityType: "SystemSetting",
      entityId: settings.id,
      action: "remote_access.settings_updated",
      metadata: {
        enabled: settings.remoteAccessProviderEnabled,
        providerName: settings.remoteAccessProviderName,
        apiBaseUrl: settings.remoteAccessApiBaseUrl,
        agentsPath: settings.remoteAccessAgentsPath,
        hasApiKeyReference: Boolean(settings.remoteAccessApiKeyReference),
        autoSyncEnabled: settings.remoteAccessAutoSyncEnabled,
        autoSyncIntervalMinutes: settings.remoteAccessAutoSyncIntervalMinutes
      }
    });

    return this.toRmmSettingsResponse(settings);
  }

  async syncFromRemoteAccessProvider(user: AuthenticatedUser) {
    return this.syncRemoteAccessForOrganization({
      organizationId: user.organizationId,
      userId: user.id,
      refreshDetails: true,
      trigger: "manual"
    });
  }

  private async syncRemoteAccessForOrganization(context: RemoteAccessSyncContext) {
    const settings = await this.getSettingsRecord(context.organizationId);
    if (!settings.remoteAccessProviderEnabled) {
      throw new BadRequestException("RMM integration is disabled.");
    }

    const apiBaseUrl = settings.remoteAccessApiBaseUrl?.trim();
    const apiKey = this.resolveSecret(settings.remoteAccessApiKeyReference);
    if (!apiBaseUrl || !apiKey) {
      throw new BadRequestException("RMM API base URL and env API key reference are required before syncing.");
    }

    try {
      const records = await this.fetchAgents(apiBaseUrl, settings.remoteAccessAgentsPath, apiKey);
      const agents: NormalizedRmmAgent[] = [];
      let detailsRefreshed = 0;
      let detailFailures = 0;

      for (const record of records) {
        const normalized = this.normalizeAgent(record, settings);
        if (!normalized) continue;

        const enriched = context.refreshDetails
          ? await this.enrichRemoteAccessAgentDetails(normalized, record, settings, apiBaseUrl, apiKey)
          : { agent: normalized, refreshed: false, failed: false };
        agents.push(enriched.agent);
        if (enriched.refreshed) detailsRefreshed += 1;
        if (enriched.failed) detailFailures += 1;
      }

      let created = 0;
      let updated = 0;

      for (const agent of agents) {
        const client = await this.findOrCreateClient(context, agent.clientName);
        const identifierMatches: Prisma.DeviceWhereInput[] = [
          { remoteAccessId: { in: agent.remoteIdentifiers } },
          { remoteAccessProfile: { is: { provider: RemoteAccessProvider.TACTICAL_RMM, remoteIdentifier: { in: agent.remoteIdentifiers } } } }
        ];
        if (agent.hostname) {
          identifierMatches.push({
            clientId: client.id,
            hostname: { equals: agent.hostname, mode: "insensitive" }
          });
        }

        const existingDevice = await this.prisma.device.findFirst({
          where: {
            client: { organizationId: context.organizationId },
            remoteAccessProvider: RemoteAccessProvider.TACTICAL_RMM,
            deletedAt: null,
            OR: identifierMatches
          },
          include: { remoteAccessProfile: true }
        });

        const data = {
          clientId: client.id,
          deviceGroupId: agent.siteName,
          name: agent.name,
          hostname: agent.hostname,
          type: agent.type,
          operatingSystem: agent.operatingSystem,
          osVersion: agent.osVersion,
          serialNumber: agent.serialNumber,
          assetTag: agent.assetTag,
          primaryUser: agent.primaryUser,
          remoteAccessProvider: RemoteAccessProvider.TACTICAL_RMM,
          remoteAccessId: agent.remoteIdentifier,
          lastSeenAt: agent.lastSeenAt,
          status: agent.status
        };

        const device = existingDevice
          ? await this.prisma.device.update({ where: { id: existingDevice.id }, data })
          : await this.prisma.device.create({ data });

        const detailSnapshot = this.pickBestRemoteAccessDetailSnapshot(
          agent.detailSnapshot,
          existingDevice?.remoteAccessProfile?.detailSnapshot
        );
        const detailSyncedAt =
          detailSnapshot === agent.detailSnapshot
            ? new Date(agent.detailSnapshot.syncedAt)
            : (existingDevice?.remoteAccessProfile?.detailSyncedAt ?? new Date(agent.detailSnapshot.syncedAt));

        await this.prisma.remoteAccessProfile.upsert({
          where: { deviceId: device.id },
          update: {
            provider: RemoteAccessProvider.TACTICAL_RMM,
            remoteIdentifier: agent.remoteIdentifier,
            connectionUrl: agent.controlUrl ?? agent.systemInfoUrl,
            notes: agent.siteName ? `Site: ${agent.siteName}` : null,
            detailSnapshot: detailSnapshot as unknown as Prisma.InputJsonValue,
            detailSyncedAt
          },
          create: {
            deviceId: device.id,
            provider: RemoteAccessProvider.TACTICAL_RMM,
            remoteIdentifier: agent.remoteIdentifier,
            connectionUrl: agent.controlUrl ?? agent.systemInfoUrl,
            notes: agent.siteName ? `Site: ${agent.siteName}` : null,
            detailSnapshot: detailSnapshot as unknown as Prisma.InputJsonValue,
            detailSyncedAt
          }
        });

        if (existingDevice) updated += 1;
        else created += 1;
      }

      const detailMessage =
        detailsRefreshed > 0 || detailFailures > 0
          ? ` Refreshed details for ${detailsRefreshed} device${detailsRefreshed === 1 ? "" : "s"}${detailFailures > 0 ? `; ${detailFailures} detail refresh failed` : ""}.`
          : "";
      const message = `Synced ${agents.length} RMM device${agents.length === 1 ? "" : "s"} (${created} created, ${updated} updated).${detailMessage}`;
      const updatedSettings = await this.prisma.systemSetting.update({
        where: { organizationId: context.organizationId },
        data: {
          remoteAccessLastSyncAt: new Date(),
          remoteAccessLastSyncStatus: detailFailures > 0 ? "warning" : "success",
          remoteAccessLastSyncMessage: message,
          ...(context.trigger === "auto"
            ? {
                remoteAccessNextAutoSyncAt:
                  settings.remoteAccessAutoSyncEnabled && settings.remoteAccessAutoSyncIntervalMinutes
                    ? this.nextAutoSyncAt(settings.remoteAccessAutoSyncIntervalMinutes)
                    : null,
                remoteAccessAutoSyncLockedAt: null
              }
            : {})
        }
      });

      await this.auditLogs.create({
        organizationId: context.organizationId,
        userId: context.userId,
        entityType: "Device",
        action: "remote_access.devices_synced",
        metadata: { provider: "TACTICAL_RMM", trigger: context.trigger, total: agents.length, created, updated, detailsRefreshed, detailFailures }
      });

      return { created, updated, total: agents.length, settings: this.toRmmSettingsResponse(updatedSettings) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown RMM sync failure.";
      await this.prisma.systemSetting.update({
        where: { organizationId: context.organizationId },
        data: {
          remoteAccessLastSyncAt: new Date(),
          remoteAccessLastSyncStatus: "error",
          remoteAccessLastSyncMessage: message.slice(0, 500),
          ...(context.trigger === "auto"
            ? {
                remoteAccessNextAutoSyncAt:
                  settings.remoteAccessAutoSyncEnabled && settings.remoteAccessAutoSyncIntervalMinutes
                    ? this.nextAutoSyncAt(settings.remoteAccessAutoSyncIntervalMinutes)
                    : null,
                remoteAccessAutoSyncLockedAt: null
              }
            : {})
        }
      });
      throw new BadRequestException(`RMM sync failed: ${message}`);
    }
  }

  async refreshRemoteAccessDetails(user: AuthenticatedUser, deviceId: string) {
    const [device, settings] = await Promise.all([
      this.prisma.device.findFirst({
        where: { id: deviceId, deletedAt: null, client: { organizationId: user.organizationId } },
        include: {
          client: { select: { id: true, name: true, shortName: true } },
          remoteAccessProfile: true,
          favorites: { where: { userId: user.id }, select: { userId: true } }
        }
      }),
      this.getSettingsRecord(user.organizationId)
    ]);

    if (!device) {
      throw new NotFoundException("Device was not found.");
    }
    if (!settings.remoteAccessProviderEnabled) {
      throw new BadRequestException("RMM integration is disabled.");
    }

    const apiBaseUrl = settings.remoteAccessApiBaseUrl?.trim();
    const apiKey = this.resolveSecret(settings.remoteAccessApiKeyReference);
    const remoteIdentifier = device.remoteAccessProfile?.remoteIdentifier ?? device.remoteAccessId;
    if (!apiBaseUrl || !apiKey || !remoteIdentifier) {
      throw new BadRequestException("RMM API settings and remote identifier are required before refreshing device details.");
    }

    let record: RmmAgentRecord;
    try {
      record = await this.fetchAgentDetail(apiBaseUrl, settings.remoteAccessAgentsPath, remoteIdentifier, apiKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Tactical RMM detail refresh failure.";
      throw new BadRequestException(`RMM detail refresh failed: ${message}`);
    }
    const normalized = this.normalizeAgent(record, settings);
    const snapshot = this.buildRemoteAccessDetailSnapshot(record, normalized);

    const updateData: Prisma.DeviceUpdateInput = {
      hostname: normalized?.hostname ?? device.hostname,
      type: normalized?.type ?? device.type,
      operatingSystem: normalized?.operatingSystem ?? device.operatingSystem,
      osVersion: normalized?.osVersion ?? device.osVersion,
      serialNumber: normalized?.serialNumber ?? device.serialNumber,
      assetTag: normalized?.assetTag ?? device.assetTag,
      primaryUser: normalized?.primaryUser ?? device.primaryUser,
      remoteAccessProvider: RemoteAccessProvider.TACTICAL_RMM,
      remoteAccessId: normalized?.remoteIdentifier ?? remoteIdentifier,
      lastSeenAt: normalized?.lastSeenAt ?? device.lastSeenAt,
      status: normalized?.status ?? device.status
    };

    await this.prisma.$transaction([
      this.prisma.device.update({ where: { id: device.id }, data: updateData }),
      this.prisma.remoteAccessProfile.upsert({
        where: { deviceId: device.id },
        update: {
          provider: RemoteAccessProvider.TACTICAL_RMM,
          remoteIdentifier: normalized?.remoteIdentifier ?? remoteIdentifier,
          connectionUrl: normalized?.controlUrl ?? normalized?.systemInfoUrl ?? device.remoteAccessProfile?.connectionUrl,
          detailSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          detailSyncedAt: new Date(snapshot.syncedAt)
        },
        create: {
          deviceId: device.id,
          provider: RemoteAccessProvider.TACTICAL_RMM,
          remoteIdentifier: normalized?.remoteIdentifier ?? remoteIdentifier,
          connectionUrl: normalized?.controlUrl ?? normalized?.systemInfoUrl,
          detailSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          detailSyncedAt: new Date(snapshot.syncedAt)
        }
      })
    ]);

    await this.auditLogs.create({
      userId: user.id,
      entityType: "Device",
      entityId: device.id,
      action: "remote_access.device_details_refreshed",
      metadata: { provider: "TACTICAL_RMM", remoteIdentifier }
    });

    return this.getById(user, device.id);
  }

  async qcObservation(user: AuthenticatedUser, deviceId: string, alertReference: string) {
    const [device, settings] = await Promise.all([
      this.prisma.device.findFirst({ where: { id: deviceId, deletedAt: null, client: { organizationId: user.organizationId } }, include: { remoteAccessProfile: true } }),
      this.getSettingsRecord(user.organizationId)
    ]);
    if (!device || !settings.remoteAccessProviderEnabled) throw new BadRequestException("The RMM device or integration is unavailable.");
    const identifier = device.remoteAccessProfile?.remoteIdentifier ?? device.remoteAccessId;
    const apiKey = this.resolveSecret(settings.remoteAccessApiKeyReference);
    if (!identifier || !apiKey || !settings.remoteAccessApiBaseUrl) throw new BadRequestException("Configure RMM before verifying QC evidence.");
    const record = await this.fetchAgentDetail(settings.remoteAccessApiBaseUrl, settings.remoteAccessAgentsPath, identifier, apiKey);
    const normalized = this.normalizeAgent(record, settings);
    // Agent detail exposes aggregate check counts; query the agent-scoped check results.
    const checksUrl = this.joinUrl(settings.remoteAccessApiBaseUrl, `${this.buildAgentDetailPath(settings.remoteAccessAgentsPath, identifier).replace(/\/$/, "")}/checks/`);
    let match: Record<string, unknown> | undefined;
    try {
      const response = await fetch(checksUrl, { headers: this.buildTacticalHeaders(apiKey), redirect: "error", signal: AbortSignal.timeout(10000) });
      if (response.ok) {
        const checks: unknown = await response.json();
        if (Array.isArray(checks)) match = checks.find((item: unknown): item is Record<string, unknown> => !!item && typeof item === "object" && "id" in item && String(item.id) === alertReference);
      }
    } catch { /* Missing provider check results remain unverified; check-in evidence is independent. */ }
    const result = match?.check_result && typeof match.check_result === "object" && !Array.isArray(match.check_result) ? match.check_result as Record<string, unknown> : match;
    const rawTime = result?.last_run;
    const updated = typeof rawTime === "string" && Number.isFinite(Date.parse(rawTime)) ? new Date(rawTime) : null;
    return { provider: "TACTICAL_RMM", remoteIdentifier: identifier, observedAt: new Date(), lastSeenAt: normalized?.lastSeenAt ?? null, alertReference, alertMatched: Boolean(match), alertStatus: typeof result?.status === "string" ? result.status : null, alertUpdatedAt: updated };
  }

  private async fetchAgents(apiBaseUrl: string, agentsPath: string, apiKey: string) {
    const url = this.joinUrl(apiBaseUrl, agentsPath);
    const response = await fetch(url, {
      headers: this.buildTacticalHeaders(apiKey)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Tactical RMM returned ${response.status}: ${text.slice(0, 300)}`);
    }

    const payload = (await response.json()) as unknown;
    return this.extractAgentRecords(payload);
  }

  private async fetchAgentDetail(apiBaseUrl: string, agentsPath: string, remoteIdentifier: string, apiKey: string) {
    const url = this.joinUrl(apiBaseUrl, this.buildAgentDetailPath(agentsPath, remoteIdentifier));
    const response = await fetch(url, {
      headers: this.buildTacticalHeaders(apiKey)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Tactical RMM device detail returned ${response.status}: ${text.slice(0, 300)}`);
    }

    const payload = (await response.json()) as unknown;
    return this.extractAgentRecord(payload);
  }

  private buildTacticalHeaders(apiKey: string) {
    return {
      Accept: "application/json",
      "X-API-KEY": apiKey,
      Authorization: `Bearer ${apiKey}`
    };
  }

  private async enrichRemoteAccessAgentDetails(
    agent: NormalizedRmmAgent,
    listRecord: RmmAgentRecord,
    settings: RmmSettingsRecord,
    apiBaseUrl: string,
    apiKey: string
  ) {
    try {
      const detailRecord = await this.fetchAgentDetail(apiBaseUrl, settings.remoteAccessAgentsPath, agent.remoteIdentifier, apiKey);
      const normalizedDetail = this.normalizeAgent(detailRecord, settings);
      const mergedAgent = normalizedDetail
        ? {
            ...agent,
            ...normalizedDetail,
            clientName: normalizedDetail.clientName || agent.clientName,
            siteName: normalizedDetail.siteName ?? agent.siteName,
            systemInfoUrl: normalizedDetail.systemInfoUrl ?? agent.systemInfoUrl,
            controlUrl: normalizedDetail.controlUrl ?? agent.controlUrl
          }
        : agent;

      return {
        agent: {
          ...mergedAgent,
          detailSnapshot: this.buildRemoteAccessDetailSnapshot({ ...listRecord, ...detailRecord }, mergedAgent)
        },
        refreshed: true,
        failed: false
      };
    } catch {
      return { agent, refreshed: false, failed: true };
    }
  }

  private extractAgentRecords(payload: unknown): RmmAgentRecord[] {
    if (Array.isArray(payload)) return payload.filter(this.isRecord);
    if (!this.isRecord(payload)) return [];
    for (const key of ["results", "data", "agents", "devices"]) {
      const value = payload[key];
      if (Array.isArray(value)) return value.filter(this.isRecord);
    }
    return [];
  }

  private extractAgentRecord(payload: unknown): RmmAgentRecord {
    if (this.isRecord(payload)) {
      for (const key of ["data", "agent", "device", "result"]) {
        const value = payload[key];
        if (this.isRecord(value)) return { ...payload, ...value };
      }
      return payload;
    }
    throw new Error("Tactical RMM returned an unexpected device detail payload.");
  }

  private normalizeAgent(record: RmmAgentRecord, settings: RmmSettingsRecord): NormalizedRmmAgent | null {
    const remoteIdentifier =
      this.pickString(record, ["agent_id", "agentId", "guid"]) ??
      this.pickString(record, ["id", "pk", "mesh_node_id", "meshNodeId"]);
    const remoteIdentifiers = this.uniqueStrings(
      [
        remoteIdentifier,
        this.pickString(record, ["agent_id", "agentId"]),
        this.pickString(record, ["id", "pk"]),
        this.pickString(record, ["guid"]),
        this.pickString(record, ["mesh_node_id", "meshNodeId"])
      ].filter((value): value is string => Boolean(value))
    );
    const hostname = this.pickString(record, ["hostname", "computer_name", "computerName", "host", "description"]);
    const name = this.pickString(record, ["name", "hostname", "computer_name", "computerName", "description"]) ?? remoteIdentifier;
    if (!remoteIdentifier || !name) return null;

    const siteRecord = this.pickRecord(record, ["site"]);
    const clientRecord = this.pickRecord(record, ["client", "customer", "organization", "company", "tenant"]);
    const siteClientRecord = this.pickRecord(siteRecord ?? {}, ["client", "customer", "organization", "company", "tenant"]);
    const clientName =
      this.pickDisplayName(record, ["client_name", "clientName", "customer_name", "customerName", "client", "customer", "organization", "company", "tenant"]) ??
      this.pickDisplayName(clientRecord ?? {}, ["name", "client_name", "clientName", "customer_name", "customerName", "company_name", "companyName"]) ??
      this.pickDisplayName(siteRecord ?? {}, ["client_name", "clientName", "customer_name", "customerName", "client", "customer", "organization", "company", "tenant"]) ??
      this.pickDisplayName(siteClientRecord ?? {}, ["name", "client_name", "clientName", "customer_name", "customerName", "company_name", "companyName"]) ??
      "Unmapped RMM Devices";
    const siteName =
      this.pickString(record, ["site_name", "siteName", "location"]) ??
      this.pickString(siteRecord ?? {}, ["name", "site_name"]);
    const operatingSystem = this.pickString(record, ["operating_system", "operatingSystem", "os", "platform", "plat"]);
    const osVersion = this.pickString(record, ["os_version", "osVersion", "version", "build"]);
    const statusSource = this.pickString(record, ["status", "agent_status", "monitoring_status"]) ?? "";
    const online = this.pickBoolean(record, ["online", "is_online", "isOnline"]);
    const status = online === true || /online|active|ok/i.test(statusSource) ? DeviceStatus.ACTIVE : DeviceStatus.INACTIVE;
    const lastSeenAt = this.pickDate(record, ["last_seen", "lastSeen", "last_checkin", "lastCheckin", "updated_at", "updatedAt"]);
    const serialNumber = this.pickString(record, ["serial_number", "serialNumber", "serial"]);
    const assetTag = this.pickString(record, ["asset_tag", "assetTag", "asset"]);
    const primaryUser = this.pickString(record, ["logged_in_user", "loggedInUser", "primary_user", "primaryUser", "last_user"]);
    const urlTokens = {
      agentId: remoteIdentifier,
      deviceId: remoteIdentifier,
      hostname: hostname ?? name,
      clientName,
      siteName: siteName ?? "",
      meshNodeId: this.pickString(record, ["mesh_node_id", "meshNodeId"]) ?? remoteIdentifier,
      agentPlatform: this.inferAgentPlatform(operatingSystem)
    };
    const systemInfoUrl = this.buildConnectionUrl(settings.remoteAccessDeviceUrlTemplate, settings.remoteAccessDashboardUrl, urlTokens);
    const controlUrl = this.buildConnectionUrl(settings.remoteAccessControlUrlTemplate, null, urlTokens);

    return {
      remoteIdentifier,
      remoteIdentifiers,
      name,
      hostname,
      clientName,
      siteName,
      operatingSystem,
      osVersion,
      serialNumber,
      assetTag,
      primaryUser,
      status,
      type: this.inferDeviceType(name, operatingSystem),
      lastSeenAt,
      systemInfoUrl,
      controlUrl,
      detailSnapshot: this.buildRemoteAccessDetailSnapshot(record)
    };
  }

  private async findOrCreateClient(context: Pick<RemoteAccessSyncContext, "organizationId" | "userId">, clientName: string) {
    const normalizedName = clientName.trim() || "Unmapped RMM Devices";
    const existing = await this.prisma.client.findFirst({
      where: {
        organizationId: context.organizationId,
        deletedAt: null,
        name: { equals: normalizedName, mode: "insensitive" }
      }
    });
    if (existing) return existing;

    const created = await this.prisma.client.create({
      data: {
        organizationId: context.organizationId,
        name: normalizedName,
        shortName: normalizedName.slice(0, 24),
        notes: "Created from Tactical RMM sync."
      }
    });

    await this.auditLogs.create({
      organizationId: context.organizationId,
      userId: context.userId,
      entityType: "Client",
      entityId: created.id,
      action: "remote_access.client_created_from_sync",
      metadata: { source: "TACTICAL_RMM", name: normalizedName }
    });

    return created;
  }

  private async runDueRemoteAccessAutoSyncs() {
    try {
      const now = new Date();
      const staleLockCutoff = new Date(now.getTime() - RMM_AUTO_SYNC_LOCK_STALE_MINUTES * 60_000);
      const settingsRecords = await this.prisma.systemSetting.findMany({
        where: {
          remoteAccessProviderEnabled: true,
          remoteAccessAutoSyncEnabled: true,
          remoteAccessAutoSyncIntervalMinutes: { not: null },
          OR: [{ remoteAccessNextAutoSyncAt: null }, { remoteAccessNextAutoSyncAt: { lte: now } }],
          AND: [
            {
              OR: [{ remoteAccessAutoSyncLockedAt: null }, { remoteAccessAutoSyncLockedAt: { lt: staleLockCutoff } }]
            }
          ]
        },
        orderBy: { remoteAccessNextAutoSyncAt: "asc" },
        take: 1
      });

      for (const settings of settingsRecords) {
        if (this.runningAutoSyncs.has(settings.organizationId)) {
          continue;
        }

        if (await this.shouldDeferRemoteAccessAutoSync(settings.organizationId, now)) {
          await this.deferRemoteAccessAutoSync(settings.organizationId, "Automatic RMM sync deferred to avoid overlapping priority sync work.");
          continue;
        }

        this.runningAutoSyncs.add(settings.organizationId);
        try {
          await this.prisma.systemSetting.update({
            where: { organizationId: settings.organizationId },
            data: { remoteAccessAutoSyncLockedAt: new Date() }
          });
          await this.syncRemoteAccessForOrganization({
            organizationId: settings.organizationId,
            userId: null,
            refreshDetails: false,
            trigger: "auto"
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown RMM auto sync failure.";
          await this.prisma.systemSetting.update({
            where: { organizationId: settings.organizationId },
            data: {
              remoteAccessLastSyncAt: new Date(),
              remoteAccessLastSyncStatus: "error",
              remoteAccessLastSyncMessage: message.slice(0, 500),
              remoteAccessNextAutoSyncAt: this.nextAutoSyncAt(settings.remoteAccessAutoSyncIntervalMinutes),
              remoteAccessAutoSyncLockedAt: null
            }
          });
          this.logger.warn(
            `RMM auto sync failed for organization ${settings.organizationId}: ${message}`
          );
        } finally {
          this.runningAutoSyncs.delete(settings.organizationId);
        }
      }
    } catch (error) {
      this.logger.warn(`RMM auto sync scan failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  private async shouldDeferRemoteAccessAutoSync(organizationId: string, now: Date) {
    const priorityWindowEnd = new Date(now.getTime() + RMM_SYNC_PRIORITY_WINDOW_MS);
    const recentMailboxLockCutoff = new Date(now.getTime() - 10 * 60_000);
    const [priorityMailboxes, dueReports] = await Promise.all([
      this.prisma.mailbox.count({
        where: {
          organizationId,
          isActive: true,
          autoSyncEnabled: true,
          OR: [
            { autoSyncLockedAt: { gte: recentMailboxLockCutoff } },
            { nextAutoSyncAt: null },
            { nextAutoSyncAt: { lte: priorityWindowEnd } }
          ]
        }
      }),
      this.prisma.reportSchedule.count({
        where: {
          organizationId,
          isActive: true,
          nextRunAt: { lte: priorityWindowEnd }
        }
      })
    ]);
    return priorityMailboxes > 0 || dueReports > 0;
  }

  private async deferRemoteAccessAutoSync(organizationId: string, reason: string) {
    await this.prisma.systemSetting.update({
      where: { organizationId },
      data: {
        remoteAccessNextAutoSyncAt: new Date(Date.now() + RMM_AUTO_SYNC_DEFER_MINUTES * 60_000),
        remoteAccessAutoSyncLockedAt: null,
        remoteAccessLastSyncStatus: "deferred",
        remoteAccessLastSyncMessage: reason
      }
    });
  }

  private async getSettingsRecord(organizationId: string) {
    const settings = await this.prisma.systemSetting.findUnique({ where: { organizationId } });
    if (!settings) {
      throw new BadRequestException("System settings are not configured.");
    }
    return settings;
  }

  private toRmmSettingsResponse(settings: RmmSettingsRecord) {
    return {
      enabled: settings.remoteAccessProviderEnabled,
      providerName: settings.remoteAccessProviderName,
      apiBaseUrl: settings.remoteAccessApiBaseUrl,
      apiKeyReference: settings.remoteAccessApiKeyReference,
      hasResolvedApiKey: Boolean(this.resolveSecret(settings.remoteAccessApiKeyReference)),
      agentsPath: settings.remoteAccessAgentsPath,
      dashboardUrl: settings.remoteAccessDashboardUrl,
      deviceUrlTemplate: settings.remoteAccessDeviceUrlTemplate,
      controlUrlTemplate: settings.remoteAccessControlUrlTemplate,
      backgroundUrlTemplate: settings.remoteAccessBackgroundUrlTemplate,
      lastSyncAt: settings.remoteAccessLastSyncAt,
      lastSyncStatus: settings.remoteAccessLastSyncStatus,
      lastSyncMessage: settings.remoteAccessLastSyncMessage,
      autoSyncEnabled: settings.remoteAccessAutoSyncEnabled,
      autoSyncIntervalMinutes: settings.remoteAccessAutoSyncIntervalMinutes,
      nextAutoSyncAt: settings.remoteAccessNextAutoSyncAt
    };
  }

  private nextAutoSyncAt(intervalMinutes: number | null) {
    const minutes = intervalMinutes ?? RMM_AUTO_SYNC_DEFAULT_INTERVAL_MINUTES;
    return new Date(Date.now() + minutes * 60_000);
  }

  private toDeviceResponse(device: DeviceWithRemoteProfile, settings: RmmSettingsRecord) {
    const actionUrls = this.buildDeviceActionUrls(device, settings);
    const { favorites, ...deviceRecord } = device;
    const detailSnapshot = device.remoteAccessProfile?.detailSnapshot ?? null;
    return {
      ...deviceRecord,
      isFavorite: favorites.length > 0,
      actionUrls,
      remoteAccessDetails: detailSnapshot,
      remoteAccessProfile: device.remoteAccessProfile
        ? {
            ...device.remoteAccessProfile,
            connectionUrl: actionUrls.controlUrl ?? device.remoteAccessProfile.connectionUrl
          }
        : null
    };
  }

  private buildDeviceActionUrls(device: DeviceWithRemoteProfile, settings: RmmSettingsRecord): DeviceActionUrls {
    const remoteIdentifier = device.remoteAccessProfile?.remoteIdentifier ?? device.remoteAccessId ?? device.id;
    const tokens = {
      agentId: remoteIdentifier,
      deviceId: remoteIdentifier,
      hostname: device.hostname ?? device.name,
      clientName: device.client.name,
      siteName: device.deviceGroupId ?? "",
      meshNodeId: remoteIdentifier,
      agentPlatform: this.inferAgentPlatform(device.operatingSystem)
    };
    const backgroundTemplate = settings.remoteAccessBackgroundUrlTemplate ?? this.defaultBackgroundUrlTemplate(settings.remoteAccessDashboardUrl);
    return {
      systemInfoUrl: this.buildConnectionUrl(settings.remoteAccessDeviceUrlTemplate, settings.remoteAccessDashboardUrl, tokens),
      controlUrl:
        this.buildConnectionUrl(settings.remoteAccessControlUrlTemplate, null, tokens) ??
        device.remoteAccessProfile?.connectionUrl ??
        null,
      remoteBackgroundUrl: this.buildConnectionUrl(backgroundTemplate, null, tokens)
    };
  }

  private pickBestRemoteAccessDetailSnapshot(
    incoming: RemoteAccessDetailSnapshot,
    existing?: Prisma.JsonValue | null
  ): RemoteAccessDetailSnapshot | Prisma.JsonValue {
    if (this.hasRichRemoteAccessDetails(incoming)) return incoming;
    return existing !== undefined && existing !== null && this.hasRichRemoteAccessDetails(existing) ? existing : incoming;
  }

  private hasRichRemoteAccessDetails(snapshot: unknown) {
    if (!this.isRecord(snapshot)) return false;

    const hardware = this.pickRecord(snapshot, ["hardware"]);
    const storage = this.pickRecord(snapshot, ["storage"]);
    const disks = this.pickRecordList(storage ?? {}, ["disks"]);
    const hasMemory = Boolean(this.pickString(hardware ?? {}, ["memory"]));
    const hasDiskUsage = disks.some((disk) => {
      const totalBytes = this.pickUnknown(disk, ["totalBytes", "total_bytes"]);
      const freeBytes = this.pickUnknown(disk, ["freeBytes", "free_bytes"]);
      const usedPercent = this.pickUnknown(disk, ["usedPercent", "used_percent"]);
      return totalBytes !== null && totalBytes !== undefined && (freeBytes !== null || usedPercent !== null) && (freeBytes !== undefined || usedPercent !== undefined);
    });

    return hasMemory || hasDiskUsage;
  }

  private buildRemoteAccessDetailSnapshot(record: RmmAgentRecord, normalized?: NormalizedRmmAgent | null): RemoteAccessDetailSnapshot {
    const hardwareRecord = this.pickRecord(record, ["hardware", "hardware_details", "hardwareDetails", "system"]);
    const wmiRecord = this.pickRecord(record, ["wmi_detail", "wmiDetail", "wmi"]);
    const cpuRecord = this.pickRecord(record, ["cpu", "processor"]);
    const memoryRecord = this.pickRecord(record, ["memory", "ram"]);
    const networkRecord = this.pickRecord(record, ["network", "networking", "net"]);
    const wmiCpuRecord = this.findRecordWithAnyKey(this.pickRecordList(wmiRecord ?? {}, ["cpu"]), ["Name", "name", "Caption", "caption"]);
    const wmiMemoryRecord = this.findRecordWithAnyKey(this.pickRecordList(wmiRecord ?? {}, ["mem", "memory"]), ["Capacity", "capacity"]);
    const wmiComputerRecord = this.findRecordWithAnyKey(this.pickRecordList(wmiRecord ?? {}, ["comp_sys", "computerSystem", "computer_system"]), [
      "TotalPhysicalMemory",
      "Model",
      "model"
    ]);
    const wmiGraphicsRecord = this.findRecordWithAnyKey(this.pickRecordList(wmiRecord ?? {}, ["graphics", "video"]), [
      "Name",
      "name",
      "Caption",
      "caption",
      "VideoProcessor",
      "videoProcessor"
    ]);
    const networkRecords = this.extractNetworkRecords(record, networkRecord, wmiRecord);
    const checksRecord = this.pickRecord(record, ["checks", "checks_status", "checksStatus"]);
    const cpu = this.pickString(record, ["cpu", "processor", "cpu_model", "cpuModel"]) ?? this.pickString(cpuRecord ?? {}, ["name", "model", "description"]) ?? this.pickString(wmiCpuRecord ?? {}, ["Name", "name", "Caption", "caption"]);

    return {
      syncedAt: new Date().toISOString(),
      hardware: {
        manufacturer:
          this.pickString(record, ["make", "manufacturer", "vendor"]) ??
          this.pickString(hardwareRecord ?? {}, ["make", "manufacturer", "vendor"]),
        model:
          this.pickString(record, ["model", "make_model", "makeModel", "product_name", "productName"]) ??
          this.pickString(hardwareRecord ?? {}, ["model", "make_model", "makeModel", "product_name", "productName"]),
        cpu,
        cpuCores:
          this.pickString(record, ["total_cores", "totalCores", "cores", "cpu_cores", "cpuCores"]) ??
          this.pickString(cpuRecord ?? {}, ["total_cores", "totalCores", "cores", "threads"]) ??
          this.formatCpuCores(cpu, wmiCpuRecord, wmiComputerRecord),
        memory:
          this.formatMemoryValue(this.pickUnknown(record, ["total_ram", "totalRam"])) ??
          this.formatBytesValue(this.pickUnknown(record, ["ram", "memory", "memory_total", "memoryTotal"])) ??
          this.formatBytesValue(this.pickUnknown(memoryRecord ?? {}, ["total", "total_bytes", "totalBytes", "size"])) ??
          this.formatBytesValue(this.pickUnknown(wmiComputerRecord ?? {}, ["TotalPhysicalMemory"])) ??
          this.formatBytesValue(this.pickUnknown(wmiMemoryRecord ?? {}, ["Capacity", "capacity"])),
        video:
          this.pickString(record, ["video", "gpu", "graphics", "display_adapter", "displayAdapter"]) ??
          this.pickString(hardwareRecord ?? {}, ["video", "gpu", "graphics", "display_adapter", "displayAdapter"]) ??
          this.pickString(wmiGraphicsRecord ?? {}, ["Name", "name", "Caption", "caption", "VideoProcessor", "videoProcessor"]),
        serialNumber: normalized?.serialNumber ?? this.pickString(record, ["serial_number", "serialNumber", "serial"])
      },
      network: {
        publicIp: this.pickString(record, ["public_ip", "publicIp", "wan_ip", "wanIp"]) ?? this.pickString(networkRecord ?? {}, ["public_ip", "publicIp", "wan_ip", "wanIp"]),
        localIps: this.uniqueStrings(
          this.pickStringList(record, ["local_ips", "localIps", "lan_ips", "lanIps", "ips", "ip_addresses", "ipAddresses"])
            .concat(this.pickStringList(networkRecord ?? {}, ["local_ips", "localIps", "lan_ips", "lanIps", "ips", "ip_addresses", "ipAddresses"]))
            .concat(this.extractLocalIps(networkRecords))
        )
          .map((value) => value.replace(/\/\d+$/, ""))
          .filter((value) => this.isLikelyIp(value) && !this.isLikelyMac(value)),
        macAddresses: this.uniqueStrings(
          this.pickStringList(record, ["mac", "mac_address", "macAddress", "mac_addresses", "macAddresses"])
            .concat(this.pickStringList(networkRecord ?? {}, ["mac", "mac_address", "macAddress", "mac_addresses", "macAddresses"]))
            .concat(this.extractMacAddresses(networkRecords))
        ).filter((value) => this.isLikelyMac(value))
      },
      storage: {
        disks: this.normalizeDisks(record)
      },
      agent: {
        version: normalized?.osVersion ?? this.pickString(record, ["agent_version", "agentVersion", "version", "agentver"]),
        bootTime: this.pickString(record, ["boot_time", "bootTime", "boot_time_utc", "bootTimeUtc"]),
        uptime: this.pickString(record, ["uptime", "uptime_text", "uptimeText"]),
        lastResponse:
          this.pickString(record, ["last_response", "lastResponse", "last_seen", "lastSeen", "last_checkin", "lastCheckin"]) ??
          (normalized?.lastSeenAt ? normalized.lastSeenAt.toISOString() : null),
        lastSeen: normalized?.lastSeenAt?.toISOString() ?? this.pickString(record, ["last_seen", "lastSeen", "last_checkin", "lastCheckin"]),
        loggedInUser: normalized?.primaryUser ?? this.pickString(record, ["logged_in_user", "loggedInUser", "last_user", "lastUser"])
      },
      checks: {
        status:
          this.pickString(record, ["checks_status", "checksStatus", "monitoring_status", "monitoringStatus"]) ??
          this.pickString(checksRecord ?? {}, ["status", "state"]),
        summary:
          this.pickString(record, ["checks_summary", "checksSummary", "checks", "alerts"]) ??
          this.pickString(checksRecord ?? {}, ["summary", "description", "status"])
      }
    };
  }

  private normalizeDisks(record: RmmAgentRecord): RemoteAccessDiskSummary[] {
    const wmiRecord = this.pickRecord(record, ["wmi_detail", "wmiDetail", "wmi"]);
    const diskRecords = this.pickRecordList(record, ["disks", "drives", "volumes", "logical_disks", "logicalDisks", "storage"]);
    const wmiDiskRecords = this.pickRecordList(wmiRecord ?? {}, ["disk", "logical_disk", "logicalDisk"]);
    const parsedDisks = diskRecords
      .concat(wmiDiskRecords)
      .map((disk, index) => {
        const totalBytes = this.coerceBytes(this.pickUnknown(disk, ["total_bytes", "totalBytes", "total", "size", "capacity", "Size"]));
        const freeBytes = this.coerceBytes(this.pickUnknown(disk, ["free_bytes", "freeBytes", "free", "available", "free_space", "freeSpace", "FreeSpace"]));
        const usedBytes = this.coerceBytes(this.pickUnknown(disk, ["used_bytes", "usedBytes", "used", "UsedSpace"]));
        const usedPercent =
          this.pickNumber(disk, ["used_percent", "usedPercent", "percent_used", "percentUsed", "percent", "PercentUsed"]) ??
          (totalBytes && freeBytes !== null ? Math.max(0, Math.min(100, Math.round(((totalBytes - freeBytes) / totalBytes) * 100))) : null) ??
          (totalBytes && usedBytes !== null ? Math.max(0, Math.min(100, Math.round((usedBytes / totalBytes) * 100))) : null);
        return {
          name: this.pickString(disk, ["name", "device", "drive", "letter", "mount", "label", "DeviceID", "Caption", "Name"]) ?? `Disk ${index + 1}`,
          fileSystem: this.pickString(disk, ["file_system", "fileSystem", "filesystem", "fstype", "fs", "type", "FileSystem"]),
          totalBytes,
          freeBytes,
          usedPercent
        };
      })
      .filter((disk) => disk.totalBytes !== null || disk.freeBytes !== null || disk.usedPercent !== null);
    if (parsedDisks.length > 0) {
      return parsedDisks.slice(0, 12);
    }
    const physicalDisks = this.pickStringList(record, ["physical_disks", "physicalDisks"]).map((name) => ({
      name,
      fileSystem: null,
      totalBytes: this.parseDiskSizeFromLabel(name),
      freeBytes: null,
      usedPercent: null
    }));
    return physicalDisks.slice(0, 12);
  }

  private extractNetworkRecords(record: RmmAgentRecord, networkRecord: RmmAgentRecord | null, wmiRecord?: RmmAgentRecord | null) {
    const keys = ["network_adapters", "networkAdapters", "adapters", "interfaces", "nics", "network_interfaces", "networkInterfaces"];
    return this.pickRecordList(record, keys)
      .concat(this.pickRecordList(networkRecord ?? {}, keys))
      .concat(this.pickRecordList(wmiRecord ?? {}, ["network_config", "networkConfig", "network_adapter", "networkAdapter"]));
  }

  private extractLocalIps(records: RmmAgentRecord[]) {
    const keys = ["ip", "ips", "ipv4", "ipv4_address", "ipv4Address", "address", "addresses", "ip_address", "ipAddress", "ip_addresses", "ipAddresses", "local_ip", "localIp"];
    return records
      .flatMap((record) => this.pickStringList(record, keys))
      .map((value) => value.replace(/\/\d+$/, ""))
      .filter((value) => this.isLikelyIp(value) && !this.isLikelyMac(value));
  }

  private extractMacAddresses(records: RmmAgentRecord[]) {
    const keys = ["mac", "mac_address", "macAddress", "MACAddress", "physical_address", "physicalAddress", "hwaddr", "hardware_address", "hardwareAddress"];
    return records.flatMap((record) => this.pickStringList(record, keys)).filter((value) => this.isLikelyMac(value));
  }

  private uniqueStrings(values: string[]) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }

  private buildAgentDetailPath(agentsPath: string, remoteIdentifier: string) {
    const basePath = this.normalizePath(agentsPath.split(/[?#]/)[0]) ?? "/agents/";
    return `${basePath.replace(/\/+$/, "")}/${encodeURIComponent(remoteIdentifier)}/`;
  }

  private resolveSecret(reference?: string | null) {
    const trimmed = reference?.trim();
    if (!trimmed) return "";
    if (!trimmed.startsWith("env:")) return "";
    return this.config.get<string>(trimmed.slice(4)) ?? "";
  }

  private buildConnectionUrl(template: string | null | undefined, dashboardUrl: string | null | undefined, tokens: Record<string, string>) {
    const source = template?.trim() || dashboardUrl?.trim();
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

  private joinUrl(baseUrl: string, path: string) {
    return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  }

  private normalizePath(value?: string | null) {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  }

  private optionalTrim(value?: string | null) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private pickUnknown(record: RmmAgentRecord, keys: string[]) {
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null) return record[key];
    }
    return null;
  }

  private pickString(record: RmmAgentRecord, keys: string[]) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
      if (Array.isArray(value)) {
        const first = value.find((item) => (typeof item === "string" && Boolean(item.trim())) || (typeof item === "number" && Number.isFinite(item)));
        if (typeof first === "string") return first.trim();
        if (typeof first === "number") return String(first);
      }
    }
    return null;
  }

  private pickDisplayName(record: RmmAgentRecord, keys: string[]): string | null {
    for (const key of keys) {
      const value = record[key];
      const directName = this.normalizeDisplayName(value);
      if (directName) return directName;
      if (this.isRecord(value)) {
        const nestedName: string | null = this.pickDisplayName(value, ["name", "display_name", "displayName", "client_name", "clientName", "customer_name", "customerName"]);
        if (nestedName) return nestedName;
      }
    }
    return null;
  }

  private normalizeDisplayName(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed || /^(none|null|undefined|unknown|n\/a|-+)$/i.test(trimmed)) return null;
    if (/^https?:\/\//i.test(trimmed)) return null;
    if (/^\d+$/.test(trimmed)) return null;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return null;
    if (/^[0-9a-f]{24,}$/i.test(trimmed)) return null;
    return trimmed;
  }

  private pickNumber(record: RmmAgentRecord, keys: string[]) {
    for (const key of keys) {
      const value = this.coerceNumber(record[key]);
      if (value !== null) return value;
    }
    return null;
  }

  private pickStringList(record: RmmAgentRecord, keys: string[]) {
    const values: string[] = [];
    for (const key of keys) {
      const value = record[key];
      if (Array.isArray(value)) {
        values.push(
          ...value
            .flat(Number.POSITIVE_INFINITY)
            .filter((item): item is string | number => (typeof item === "string" && Boolean(item.trim())) || (typeof item === "number" && Number.isFinite(item)))
            .map((item) => String(item).trim())
        );
      } else if (typeof value === "string" && value.trim()) {
        values.push(...value.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean));
      } else if (typeof value === "number" && Number.isFinite(value)) {
        values.push(String(value));
      }
    }
    return [...new Set(values)];
  }

  private pickBoolean(record: RmmAgentRecord, keys: string[]) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "boolean") return value;
    }
    return null;
  }

  private pickDate(record: RmmAgentRecord, keys: string[]) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" || typeof value === "number") {
        const date = new Date(value);
        if (!Number.isNaN(date.valueOf())) return date;
      }
    }
    return null;
  }

  private pickRecord(record: RmmAgentRecord, keys: string[]) {
    for (const key of keys) {
      const value = record[key];
      if (this.isRecord(value)) return value;
    }
    return null;
  }

  private pickRecordList(record: RmmAgentRecord, keys: string[]) {
    for (const key of keys) {
      const value = record[key];
      if (Array.isArray(value)) return this.toRecordList(value);
      if (this.isRecord(value)) return this.toRecordList(Object.values(value));
    }
    return [];
  }

  private toRecordList(values: unknown[]): RmmAgentRecord[] {
    const records: RmmAgentRecord[] = [];
    for (const value of values) {
      if (this.isRecord(value)) {
        records.push(value);
      } else if (Array.isArray(value)) {
        const nestedRecords = this.toRecordList(value);
        if (nestedRecords.length > 0) records.push(Object.assign({}, ...nestedRecords));
      }
    }
    return records;
  }

  private findRecordWithAnyKey(records: RmmAgentRecord[], keys: string[]) {
    return records.find((record) => keys.some((key) => record[key] !== undefined && record[key] !== null)) ?? null;
  }

  private formatBytesValue(value: unknown) {
    if (typeof value === "string" && value.trim()) return value.trim();
    const bytes = this.coerceBytes(value);
    if (bytes === null) return null;
    return this.formatBytes(bytes);
  }

  private formatMemoryValue(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1024) {
      return `${value} GB`;
    }
    if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())) {
      const amount = Number(value);
      if (Number.isFinite(amount) && amount > 0 && amount < 1024) return `${amount} GB`;
    }
    return this.formatBytesValue(value);
  }

  private coerceBytes(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    const match = trimmed.match(/^([\d.]+)\s*(b|k|kb|kib|m|mb|mib|g|gb|gib|t|tb|tib)?$/i);
    if (!match) return this.coerceNumber(value);
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return null;
    const unit = (match[2] ?? "b").toLowerCase();
    const multiplier =
      unit === "t" || unit === "tb" || unit === "tib"
        ? 1024 ** 4
        : unit === "g" || unit === "gb" || unit === "gib"
          ? 1024 ** 3
          : unit === "m" || unit === "mb" || unit === "mib"
            ? 1024 ** 2
            : unit === "k" || unit === "kb" || unit === "kib"
              ? 1024
              : 1;
    return Math.round(amount * multiplier);
  }

  private coerceNumber(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return null;
    const number = Number(value.replace(/[^\d.-]/g, ""));
    return Number.isFinite(number) ? number : null;
  }

  private parseDiskSizeFromLabel(value: string) {
    const matches = [...value.matchAll(/(\d+(?:\.\d+)?)\s*(tb|gb|mb)\b/gi)];
    const match = matches.at(-1);
    if (!match) return null;
    return this.coerceBytes(`${match[1]} ${match[2]}`);
  }

  private formatCpuCores(cpu: string | null, cpuRecord: RmmAgentRecord | null, computerRecord: RmmAgentRecord | null) {
    const cpuCoreMatch = cpu?.match(/(\d+)\s*C\s*\/\s*(\d+)\s*T/i);
    if (cpuCoreMatch) return `${cpuCoreMatch[1]} cores / ${cpuCoreMatch[2]} threads`;
    const cores = this.pickNumber(cpuRecord ?? {}, ["NumberOfCores", "numberOfCores", "cores"]);
    const logicalProcessors =
      this.pickNumber(cpuRecord ?? {}, ["NumberOfLogicalProcessors", "numberOfLogicalProcessors", "threads"]) ??
      this.pickNumber(computerRecord ?? {}, ["NumberOfLogicalProcessors", "numberOfLogicalProcessors"]);
    if (cores !== null && logicalProcessors !== null) return `${cores} cores / ${logicalProcessors} threads`;
    if (logicalProcessors !== null) return `${logicalProcessors} logical processors`;
    return null;
  }

  private isLikelyIp(value: string) {
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(value) || /^[0-9a-f:]{3,}$/i.test(value);
  }

  private isLikelyMac(value: string) {
    return /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(value) || /^[0-9a-f]{12}$/i.test(value);
  }

  private formatBytes(bytes: number) {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }

  private inferDeviceType(name: string, operatingSystem: string | null) {
    const source = `${name} ${operatingSystem ?? ""}`.toLowerCase();
    if (source.includes("server")) return DeviceType.SERVER;
    if (source.includes("laptop") || source.includes("notebook")) return DeviceType.LAPTOP;
    if (source.includes("tablet") || source.includes("ipad")) return DeviceType.TABLET;
    if (source.includes("phone") || source.includes("ios") || source.includes("android")) return DeviceType.PHONE;
    if (this.looksLikeLinuxServer(source)) return DeviceType.SERVER;
    if (source.includes("windows") || source.includes("mac") || source.includes("linux")) return DeviceType.DESKTOP;
    return DeviceType.OTHER;
  }

  private looksLikeLinuxServer(source: string) {
    const linuxServerSignals = ["linux", "ubuntu", "debian", "centos", "red hat", "rhel", "rocky", "alma", "fedora", "suse", "pve", "proxmox", "esxi"];
    const workstationSignals = ["desktop", "workstation", "laptop", "notebook", "tablet", "phone"];
    return linuxServerSignals.some((signal) => source.includes(signal)) && !workstationSignals.some((signal) => source.includes(signal));
  }

  private isDeviceStatus(value?: string): value is DeviceStatus {
    return Boolean(value && Object.values(DeviceStatus).includes(value as DeviceStatus));
  }

  private isDeviceType(value?: string): value is DeviceType {
    return Boolean(value && Object.values(DeviceType).includes(value as DeviceType));
  }

  private normalizeViewScope(value?: string) {
    return value === DeviceViewScope.ADMINISTRATORS ? DeviceViewScope.ADMINISTRATORS : DeviceViewScope.PRIVATE;
  }

  private assertCanUseViewScope(user: AuthenticatedUser, scope: DeviceViewScope) {
    if (scope === DeviceViewScope.ADMINISTRATORS && !this.canManageSharedViews(user)) {
      throw new BadRequestException("Shared device views require administrator access.");
    }
  }

  private assertCanManageView(user: AuthenticatedUser, ownerId: string, scope: DeviceViewScope) {
    if (ownerId !== user.id && scope === DeviceViewScope.ADMINISTRATORS && !this.canManageSharedViews(user)) {
      throw new BadRequestException("Shared device views require administrator access.");
    }
  }

  private canManageSharedViews(user: AuthenticatedUser) {
    return user.permissions.includes("remote_access.configure");
  }

  private isRecord(value: unknown): value is RmmAgentRecord {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }
}
