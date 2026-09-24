import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditLogsService } from "../audit-logs/audit-logs.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { CreateClientDto } from "./dto/create-client.dto";
import { UpdateClientDto } from "./dto/update-client.dto";

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService
  ) {}

  async list(user: AuthenticatedUser) {
    return this.prisma.client.findMany({
      where: {
        organizationId: user.organizationId,
        deletedAt: null
      },
      include: {
        domains: {
          orderBy: { domain: "asc" }
        },
        contacts: {
          where: { deletedAt: null },
          take: 5,
          orderBy: { createdAt: "desc" }
        },
        _count: {
          select: {
            contacts: { where: { deletedAt: null } }
          }
        }
      },
      orderBy: [{ name: "asc" }, { id: "asc" }]
    });
  }

  async getById(clientId: string, user: AuthenticatedUser) {
    const client = await this.prisma.client.findFirst({
      where: {
        id: clientId,
        organizationId: user.organizationId,
        deletedAt: null
      },
      include: {
        domains: {
          orderBy: { domain: "asc" }
        },
        contacts: {
          where: { deletedAt: null },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }]
        },
        _count: {
          select: {
            tickets: true,
            devices: true
          }
        }
      }
    });

    if (!client) {
      throw new NotFoundException("Client was not found.");
    }

    return client;
  }

  async create(input: CreateClientDto, user: AuthenticatedUser) {
    const domains = this.normalizeDomainList(input.domains ?? []);
    const client = await this.prisma.$transaction(async (tx) => {
      for (const domain of domains) {
        const existingDomain = await tx.clientDomain.findUnique({
          where: { domain }
        });

        if (existingDomain?.isActive) {
          throw new ConflictException(`Domain ${domain} already belongs to an active client.`);
        }
      }

      const createdClient = await tx.client.create({
        data: {
          organizationId: user.organizationId,
          name: input.name.trim(),
          shortName: this.optionalTrim(input.shortName),
          status: input.status ?? "ACTIVE",
          notes: this.optionalTrim(input.notes),
          slaProfile: this.optionalTrim(input.slaProfile),
          billingProfile: this.optionalTrim(input.billingProfile)
        }
      });

      for (const domain of domains) {
        await tx.clientDomain.upsert({
          where: { domain },
          update: {
            clientId: createdClient.id,
            isActive: true,
            isVerified: false
          },
          create: {
            clientId: createdClient.id,
            domain,
            isActive: true,
            isVerified: false
          }
        });
      }

      return createdClient;
    });

    await this.auditLogs.create({
      userId: user.id,
      entityType: "Client",
      entityId: client.id,
      action: "client.created",
      metadata: { name: client.name }
    });

    return client;
  }

  async update(clientId: string, input: UpdateClientDto, user: AuthenticatedUser) {
    await this.ensureClientExists(clientId, user);

    const client = await this.prisma.client.update({
      where: { id: clientId },
      data: {
        name: input.name?.trim(),
        shortName: input.shortName === undefined ? undefined : this.optionalTrim(input.shortName),
        status: input.status,
        notes: input.notes === undefined ? undefined : this.optionalTrim(input.notes),
        slaProfile: input.slaProfile === undefined ? undefined : this.optionalTrim(input.slaProfile),
        billingProfile: input.billingProfile === undefined ? undefined : this.optionalTrim(input.billingProfile)
      }
    });

    await this.auditLogs.create({
      userId: user.id,
      entityType: "Client",
      entityId: client.id,
      action: "client.updated",
      metadata: { name: client.name }
    });

    return client;
  }

  async softDelete(clientId: string, user: AuthenticatedUser) {
    await this.ensureClientExists(clientId, user);

    const client = await this.prisma.client.update({
      where: { id: clientId },
      data: {
        deletedAt: new Date(),
        status: "INACTIVE",
        domains: {
          updateMany: {
            where: { isActive: true },
            data: { isActive: false }
          }
        }
      }
    });

    await this.auditLogs.create({
      userId: user.id,
      entityType: "Client",
      entityId: client.id,
      action: "client.deleted",
      metadata: { name: client.name }
    });

    return client;
  }

  async ensureClientExists(clientId: string, user: AuthenticatedUser) {
    const client = await this.prisma.client.findFirst({
      where: {
        id: clientId,
        organizationId: user.organizationId,
        deletedAt: null
      }
    });

    if (!client) {
      throw new NotFoundException("Client was not found.");
    }

    return client;
  }

  private optionalTrim(value: string | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private normalizeDomainList(values: string[]): string[] {
    const normalized = values.map((value) => this.normalizeDomain(value)).filter(Boolean);
    return [...new Set(normalized)];
  }

  private normalizeDomain(value: string): string {
    const normalized = value.trim().toLowerCase().replace(/\.$/, "");

    if (!normalized) {
      return "";
    }

    if (
      normalized.includes("://") ||
      normalized.includes("/") ||
      normalized.includes("@") ||
      !/^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(normalized)
    ) {
      throw new BadRequestException("Domain must be a valid DNS domain such as example.com.");
    }

    return normalized;
  }
}
