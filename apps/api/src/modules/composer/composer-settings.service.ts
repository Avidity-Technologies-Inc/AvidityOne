import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditLogsService } from "../audit-logs/audit-logs.service";
import { AuthenticatedUser } from "../auth/auth.types";

export const composerFonts = ["Arial", "Calibri", "Verdana", "Tahoma", "Georgia", "Times New Roman"];
export const composerDefaults = { fontFamily: "Arial", fontSize: 12, color: "#172033", lineHeight: 1.5, pasteMode: "adapt", allowPersonalFormatting: true };
const personalKeys = ["fontFamily", "fontSize", "color", "lineHeight", "pasteMode", "displayScale"];
const orgKeys = [...personalKeys.filter((key) => key !== "displayScale"), "allowPersonalFormatting"];

export function validateComposerPatch(input: Record<string, unknown>, organization: boolean) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BadRequestException("Invalid composer preferences.");
  const keys = organization ? orgKeys : personalKeys;
  for (const [key, value] of Object.entries(input)) {
    if (key === "reset" && value === true && Object.keys(input).length === 1) return { reset: true };
    if (!keys.includes(key)) throw new BadRequestException(`Unknown composer preference: ${key}`);
    if (value === null) continue;
    const valid = key === "fontFamily" ? composerFonts.includes(value as string)
      : key === "fontSize" ? typeof value === "number" && Number.isInteger(value) && value >= 10 && value <= 32
      : key === "color" ? typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
      : key === "lineHeight" ? [1, 1.15, 1.5, 2].includes(value as number)
      : key === "pasteMode" ? ["adapt", "keep", "text"].includes(value as string)
      : key === "displayScale" ? [100, 110, 125, 150].includes(value as number)
      : key === "allowPersonalFormatting" && typeof value === "boolean";
    if (!valid) throw new BadRequestException(`Invalid composer preference: ${key}`);
  }
  return input;
}

@Injectable()
export class ComposerSettingsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}
  async get(user: AuthenticatedUser) {
    const [organization, person] = await Promise.all([
      this.prisma.systemSetting.findUnique({ where: { organizationId: user.organizationId }, select: { composerDefaults: true } }),
      this.prisma.user.findFirst({ where: { id: user.id, organizationId: user.organizationId }, select: { composerPreferences: true } })
    ]);
    const defaults = { ...composerDefaults, ...(organization?.composerDefaults as object ?? {}) };
    const overrides = (person?.composerPreferences ?? {}) as Record<string, unknown>;
    const effective = { ...defaults, ...(defaults.allowPersonalFormatting ? overrides : {}), pasteMode: overrides.pasteMode ?? defaults.pasteMode, displayScale: overrides.displayScale ?? 100 };
    return { defaults, overrides, effective, fonts: composerFonts, canManage: user.permissions.includes("system_settings.update") };
  }
  async update(user: AuthenticatedUser, input: Record<string, unknown>, organization: boolean) {
    const patch = validateComposerPatch(input, organization);
    for (let attempt = 0; ; attempt++) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const row = organization
            ? await tx.systemSetting.findUnique({ where: { organizationId: user.organizationId }, select: { composerDefaults: true } })
            : await tx.user.findFirst({ where: { id: user.id, organizationId: user.organizationId }, select: { composerPreferences: true } });
          if (!row) throw new NotFoundException("Composer preference owner was not found.");
          const current = ("composerDefaults" in row ? row.composerDefaults : row.composerPreferences) as Record<string, unknown>;
          const next: Record<string, unknown> = patch.reset ? {} : { ...current, ...patch };
          for (const key of Object.keys(next)) if (next[key] === null) delete next[key];
          if (organization) await tx.systemSetting.update({ where: { organizationId: user.organizationId }, data: { composerDefaults: next as Prisma.InputJsonValue } });
          else await tx.user.update({ where: { id: user.id }, data: { composerPreferences: next as Prisma.InputJsonValue } });
        }, { isolationLevel: "Serializable" });
        break;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034" || attempt >= 2) throw error;
      }
    }
    if (organization) await this.audit.create({ userId: user.id, entityType: "SystemSetting", entityId: user.organizationId, action: "settings.composer_updated", metadata: { fields: Object.keys(patch) } });
    return this.get(user);
  }
}
