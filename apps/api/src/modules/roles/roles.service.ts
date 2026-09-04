import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditLogsService } from "../audit-logs/audit-logs.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { CreateRoleDto } from "./dto/create-role.dto";
import { UpdateRoleDto } from "./dto/update-role.dto";

const KNOWN_PERMISSION_NAMES = new Set([
  "users.view", "users.create", "users.update", "users.delete",
  "groups.view", "groups.create", "groups.update", "groups.delete",
  "roles.view", "roles.create", "roles.update", "roles.delete",
  "permissions.view",
  "clients.view", "clients.create", "clients.update", "clients.delete",
  "client_domains.view", "client_domains.create", "client_domains.update", "client_domains.delete",
  "contacts.view", "contacts.create", "contacts.update", "contacts.delete",
  "tickets.view", "tickets.create", "tickets.update", "tickets.assign", "tickets.reply", "tickets.close", "tickets.reopen", "tickets.merge", "tickets.delete",
  "ticket_meetings.view", "ticket_meetings.create", "ticket_meetings.update", "ticket_meetings.cancel",
  "ticket_statuses.view", "ticket_statuses.manage", "ticket_workflows.manage",
  "event_services.view", "event_services.create", "event_services.update", "event_services.assign", "event_services.manage_forms", "event_services.delete",
  "external_specialists.view", "external_specialists.manage",
  "ticket_messages.view", "ticket_messages.create_internal", "ticket_messages.create_public",
  "ticket_attachments.view", "ticket_attachments.upload", "ticket_attachments.download", "ticket_attachments.delete",
  "mailboxes.view", "mailboxes.create", "mailboxes.update", "mailboxes.delete",
  "spam.view", "spam.manage",
  "maintenance.view", "maintenance.manage",
  "auto_replies.view", "auto_replies.create", "auto_replies.update", "auto_replies.delete",
  "signatures.view", "signatures.update",
  "ai_assistant.use", "ai_assistant.configure",
  "knowledge_base.view", "knowledge_base.create", "knowledge_base.update", "knowledge_base.delete", "knowledge_base.publish",
  "reports.view", "reports.export", "reports.manage", "reports.send",
  "devices.view", "devices.create", "devices.update", "devices.delete",
  "remote_access.view", "remote_access.connect", "remote_access.configure",
  "audit_logs.view", "audit_logs.export",
  "system_settings.view", "system_settings.update"
]);

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService
  ) {}

  list(user: AuthenticatedUser) {
    return this.prisma.role.findMany({
      where: { organizationId: user.organizationId },
      include: this.roleInclude(),
      orderBy: { name: "asc" }
    });
  }

  async create(user: AuthenticatedUser, input: CreateRoleDto) {
    const permissionIds = await this.resolvePermissionIds(input.permissionIds ?? []);
    try {
      const role = await this.prisma.role.create({
        data: {
          organizationId: user.organizationId,
          name: input.name.trim(),
          description: this.optionalTrim(input.description),
          permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) }
        },
        include: this.roleInclude()
      });

      await this.auditLogs.create({
        userId: user.id,
        entityType: "Role",
        entityId: role.id,
        action: "role.created",
        metadata: { name: role.name, permissionIds }
      });

      return role;
    } catch (error) {
      if (this.isUniqueConstraint(error)) {
        throw new ConflictException("A role with this name already exists.");
      }
      throw error;
    }
  }

  async update(roleId: string, user: AuthenticatedUser, input: UpdateRoleDto) {
    const existing = await this.ensureRole(roleId, user.organizationId);
    const permissionIds = input.permissionIds ? await this.resolvePermissionIds(input.permissionIds) : undefined;

    try {
      const role = await this.prisma.$transaction(async (tx) => {
        if (permissionIds) {
          await tx.rolePermission.deleteMany({ where: { roleId } });
          if (permissionIds.length > 0) {
            await tx.rolePermission.createMany({
              data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
              skipDuplicates: true
            });
          }
        }

        return tx.role.update({
          where: { id: roleId },
          data: {
            name: input.name?.trim(),
            description: input.description === undefined ? undefined : this.optionalTrim(input.description)
          },
          include: this.roleInclude()
        });
      });

      await this.auditLogs.create({
        userId: user.id,
        entityType: "Role",
        entityId: role.id,
        action: "role.updated",
        metadata: { previousName: existing.name, name: role.name, permissionIds }
      });

      return role;
    } catch (error) {
      if (this.isUniqueConstraint(error)) {
        throw new ConflictException("A role with this name already exists.");
      }
      throw error;
    }
  }

  async delete(roleId: string, user: AuthenticatedUser) {
    const role = await this.ensureRole(roleId, user.organizationId);
    if (role.isSystem) {
      throw new BadRequestException("System roles cannot be deleted.");
    }

    await this.prisma.role.delete({ where: { id: roleId } });
    await this.auditLogs.create({
      userId: user.id,
      entityType: "Role",
      entityId: roleId,
      action: "role.deleted",
      metadata: { name: role.name }
    });

    return { deleted: true };
  }

  private async ensureRole(roleId: string, organizationId: string) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, organizationId } });
    if (!role) {
      throw new NotFoundException("Role was not found.");
    }
    return role;
  }

  private async resolvePermissionIds(permissionValues: string[]) {
    const uniqueValues = [...new Set(permissionValues.map((value) => value.trim()).filter(Boolean))];
    if (uniqueValues.length === 0) {
      return [];
    }

    const uuidValues = uniqueValues.filter((value) => this.isUuid(value));
    const nameValues = uniqueValues.filter((value) => !this.isUuid(value));
    const permissions = await this.prisma.permission.findMany({
      where: {
        OR: [
          ...(uuidValues.length > 0 ? [{ id: { in: uuidValues } }] : []),
          ...(nameValues.length > 0 ? [{ name: { in: nameValues } }] : [])
        ]
      },
      select: { id: true, name: true }
    });
    const permissionById = new Map(permissions.map((permission) => [permission.id, permission.id]));
    const permissionByName = new Map(permissions.map((permission) => [permission.name, permission.id]));
    const missingKnownNames = nameValues.filter((value) => !permissionByName.has(value) && this.isKnownPermissionName(value));
    for (const permissionName of missingKnownNames) {
      const permission = await this.prisma.permission.upsert({
        where: { name: permissionName },
        update: {},
        create: {
          name: permissionName,
          description: `Allows ${permissionName.replace(".", " ")}`
        },
        select: { id: true, name: true }
      });
      permissionByName.set(permission.name, permission.id);
    }

    const resolvedIds = uniqueValues.map((value) => permissionById.get(value) ?? permissionByName.get(value)).filter((value): value is string => Boolean(value));

    if (resolvedIds.length !== uniqueValues.length) {
      throw new BadRequestException("One or more selected permissions do not exist. Refresh permissions and try again.");
    }
    return [...new Set(resolvedIds)];
  }

  private roleInclude() {
    return {
      permissions: {
        select: {
          permission: {
            select: {
              id: true,
              name: true,
              description: true
            }
          }
        }
      },
      groups: { select: { groupId: true } }
    } as const;
  }

  private optionalTrim(value: string | null | undefined) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private isUniqueConstraint(error: unknown) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
  }

  private isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  private isKnownPermissionName(value: string) {
    return KNOWN_PERMISSION_NAMES.has(value);
  }
}
