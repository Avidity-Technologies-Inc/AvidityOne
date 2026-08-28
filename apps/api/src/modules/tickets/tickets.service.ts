import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import { MailDeliveryStatus, MessageDirection, MessageVisibility, Prisma, TicketPriority, TicketSource, TicketStatus, TicketWorkflowTrigger } from "@prisma/client";
import { AuditLogsService } from "../audit-logs/audit-logs.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { ContactsService } from "../contacts/contacts.service";
import { ExternalSpecialistsService } from "../external-specialists/external-specialists.service";
import { MailDeliveryService } from "../mailboxes/mail-delivery.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { AutoRepliesService } from "../auto-replies/auto-replies.service";
import { TicketRoutingService } from "../ticket-routing/ticket-routing.service";
import { TicketWorkflowService } from "../ticket-workflow/ticket-workflow.service";
import { HtmlSanitizerService } from "../../common/html/html-sanitizer.service";
import { BulkUpdateTicketsDto } from "./dto/bulk-update-tickets.dto";
import { CreateTicketDto } from "./dto/create-ticket.dto";
import { CreateTicketMessageDto } from "./dto/create-ticket-message.dto";
import { AddTicketExternalSpecialistDto } from "./dto/add-ticket-external-specialist.dto";
import { ListTicketsQueryDto } from "./dto/list-tickets-query.dto";
import { MergeTicketsDto } from "./dto/merge-tickets.dto";
import { UpdateTicketAssignmentDto } from "./dto/update-ticket-assignment.dto";
import { UpdateTicketPlanningDto } from "./dto/update-ticket-planning.dto";
import { UpdateTicketStateDto } from "./dto/update-ticket-state.dto";
import { UpsertTicketViewDto } from "./dto/upsert-ticket-view.dto";

export interface CreateInboundEmailTicketInput {
  organizationId: string;
  mailboxId?: string | null;
  senderEmail: string;
  senderName?: string | null;
  subject: string;
  bodyText?: string | null;
  bodyHtml?: string | null;
  emailMessageId?: string | null;
  emailInternetMessageId?: string | null;
  emailConversationId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  hasAttachments?: boolean;
  internetMessageHeaders?: Record<string, string>;
}

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly htmlSanitizer: HtmlSanitizerService,
    private readonly contactsService: ContactsService,
    private readonly ticketRouting: TicketRoutingService,
    private readonly mailDelivery: MailDeliveryService,
    private readonly notifications: NotificationsService,
    private readonly autoReplies: AutoRepliesService,
    private readonly externalSpecialists: ExternalSpecialistsService = { ensure: async () => { throw new NotFoundException("External specialist was not found."); } } as unknown as ExternalSpecialistsService,
    @Optional() private readonly ticketWorkflow?: TicketWorkflowService
  ) {}

  async assignmentOptions(user: AuthenticatedUser) {
    const [users, activeTickets] = await Promise.all([
      this.prisma.user.findMany({
        where: { organizationId: user.organizationId, deletedAt: null, isActive: true },
        select: { id: true, email: true, firstName: true, lastName: true },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { email: "asc" }],
        take: 250
      }),
      this.prisma.ticket.findMany({
        where: { organizationId: user.organizationId, deletedAt: null, status: { in: this.activeStatusFilter() } },
        select: { assignedUserId: true, assignees: { select: { userId: true } } }
      })
    ]);
    const counts = new Map<string, number>();
    for (const ticket of activeTickets) {
      const assignedIds = new Set([ticket.assignedUserId, ...ticket.assignees.map((assignment) => assignment.userId)].filter((userId): userId is string => Boolean(userId)));
      for (const userId of assignedIds) {
        counts.set(userId, (counts.get(userId) ?? 0) + 1);
      }
    }
    return users.map((assignableUser) => ({ ...assignableUser, activeTicketCount: counts.get(assignableUser.id) ?? 0 }));
  }

  async list(user: AuthenticatedUser, query: ListTicketsQueryDto = {}) {
    const where = this.buildTicketListWhere(user, query);
    const sortBy = query.sortBy ?? "updatedAt";
    const sortDirection = query.sortDirection ?? "desc";
    const page = this.parsePage(query.page);
    const pageSize = query.pageSize ?? "20";
    const take = pageSize === "all" ? undefined : Number(pageSize);
    const skip = take ? (page - 1) * take : undefined;
    const orderBy: Prisma.TicketOrderByWithRelationInput[] = sortBy === "client"
      ? [{ client: { name: sortDirection } }, { ticketNumber: "asc" }]
      : [{ [sortBy]: sortDirection }, { ticketNumber: "asc" }];
    const [items, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        include: {
          client: true,
          contact: true,
          statusDefinition: true,
          assignedUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true
            }
          },
          assignees: {
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true
                }
              }
            },
            orderBy: { createdAt: "asc" }
          },
          externalSpecialists: {
            include: { externalSpecialist: true },
            orderBy: { createdAt: "asc" }
          },
          firstReadBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true
            }
          },
          assignedGroup: true,
          assignedTeam: true,
          mergedIntoTicket: {
            select: {
              id: true,
              ticketNumber: true,
              subject: true
            }
          },
          mergedTickets: {
            select: {
              id: true,
              ticketNumber: true,
              subject: true,
              status: true,
              mergedAt: true
            },
            orderBy: { mergedAt: "desc" }
          },
          _count: {
            select: {
              messages: true,
              attachments: {
                where: {
                  deletedAt: null
                }
              }
            }
          }
        },
        orderBy,
        ...(take ? { take, skip } : {})
      }),
      this.prisma.ticket.count({ where })
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: take ? Math.max(1, Math.ceil(total / take)) : 1
    };
  }

  async statistics(user: AuthenticatedUser) {
    const activeStatuses = [
      TicketStatus.NEW,
      TicketStatus.OPEN,
      TicketStatus.IN_PROGRESS,
      TicketStatus.WAITING_ON_CUSTOMER,
      TicketStatus.WAITING_ON_TECHNICIAN,
      TicketStatus.WAITING_ON_THIRD_PARTY,
      TicketStatus.REOPENED
    ];
    const baseWhere: Prisma.TicketWhereInput = {
      organizationId: user.organizationId,
      deletedAt: null,
      status: { not: TicketStatus.MERGED }
    };
    const activeWhere: Prisma.TicketWhereInput = {
      organizationId: user.organizationId,
      deletedAt: null,
      status: { in: activeStatuses }
    };
    const recentSince = this.daysAgo(29);
    const staleCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const now = new Date();

    const [
      totalOpen,
      newTickets,
      closedTickets,
      unassignedTickets,
      highPriorityTickets,
      awaitingCustomer,
      awaitingTechnician,
      noRecentUpdate,
      byStatus,
      statusDefinitions,
      byPriority,
      byClient,
      bySource,
      activeUsers,
      recentCreatedTickets,
      recentClosedTickets,
      criticalTickets,
      unassignedTicketList,
      staleTicketList
    ] = await Promise.all([
      this.prisma.ticket.count({ where: activeWhere }),
      this.prisma.ticket.count({ where: { ...baseWhere, status: TicketStatus.NEW } }),
      this.prisma.ticket.count({ where: { ...baseWhere, status: TicketStatus.CLOSED } }),
      this.prisma.ticket.count({
        where: {
          ...activeWhere,
          assignedUserId: null,
          assignedTeamId: null,
          assignedGroupId: null,
          assignees: { none: {} }
        }
      }),
      this.prisma.ticket.count({ where: { ...activeWhere, priority: TicketPriority.HIGH } }),
      this.prisma.ticket.count({ where: { ...baseWhere, status: TicketStatus.WAITING_ON_CUSTOMER } }),
      this.prisma.ticket.count({ where: { ...baseWhere, status: TicketStatus.WAITING_ON_TECHNICIAN } }),
      this.prisma.ticket.count({ where: { ...activeWhere, updatedAt: { lt: staleCutoff } } }),
      this.prisma.ticket.groupBy({
        by: ["status", "statusDefinitionId"],
        where: baseWhere,
        _count: { _all: true },
        orderBy: { _count: { status: "desc" } }
      }),
      this.prisma.ticketStatusDefinition.findMany({
        where: { organizationId: user.organizationId },
        select: { id: true, name: true, color: true }
      }),
      this.prisma.ticket.groupBy({
        by: ["priority"],
        where: baseWhere,
        _count: { _all: true },
        orderBy: { _count: { priority: "desc" } }
      }),
      this.prisma.ticket.groupBy({
        by: ["clientId"],
        where: baseWhere,
        _count: { _all: true },
        orderBy: { _count: { clientId: "desc" } },
        take: 8
      }),
      this.prisma.ticket.groupBy({
        by: ["source"],
        where: baseWhere,
        _count: { _all: true },
        orderBy: { _count: { source: "desc" } }
      }),
      this.prisma.user.findMany({
        where: { organizationId: user.organizationId, deletedAt: null, isActive: true },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }]
      }),
      this.prisma.ticket.findMany({
        where: { ...baseWhere, createdAt: { gte: recentSince } },
        select: { createdAt: true },
        orderBy: { createdAt: "asc" }
      }),
      this.prisma.ticket.findMany({
        where: {
          ...baseWhere,
          status: TicketStatus.CLOSED,
          OR: [{ closedAt: { gte: recentSince } }, { closedAt: null, updatedAt: { gte: recentSince } }]
        },
        select: { closedAt: true, updatedAt: true },
        orderBy: { updatedAt: "asc" }
      }),
      this.prisma.ticket.findMany({
        where: { ...activeWhere, priority: { in: [TicketPriority.HIGH, TicketPriority.URGENT, TicketPriority.CRITICAL] } },
        select: this.dashboardTicketSelect(),
        orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
        take: 8
      }),
      this.prisma.ticket.findMany({
        where: {
          ...activeWhere,
          assignedUserId: null,
          assignedTeamId: null,
          assignedGroupId: null,
          assignees: { none: {} }
        },
        select: this.dashboardTicketSelect(),
        orderBy: { createdAt: "desc" },
        take: 8
      }),
      this.prisma.ticket.findMany({
        where: { ...activeWhere, updatedAt: { lt: staleCutoff } },
        select: this.dashboardTicketSelect(),
        orderBy: { updatedAt: "asc" },
        take: 8
      })
    ]);

    const clientIds = byClient.map((item) => item.clientId).filter((clientId): clientId is string => Boolean(clientId));
    const clients = clientIds.length
      ? await this.prisma.client.findMany({
          where: { id: { in: clientIds }, organizationId: user.organizationId },
          select: { id: true, name: true }
        })
      : [];
    const clientNames = new Map(clients.map((client) => [client.id, client.name]));

    const workload = await Promise.all(
      activeUsers.map(async (technician) => ({
        userId: technician.id,
        name: `${technician.firstName} ${technician.lastName}`,
        count: await this.prisma.ticket.count({
          where: {
            ...activeWhere,
            OR: [{ assignedUserId: technician.id }, { assignees: { some: { userId: technician.id } } }]
          }
        }),
        filter: { assignedUserId: technician.id }
      }))
    );
    const specialistPerformance = await this.buildSpecialistPerformance(activeUsers, activeWhere, baseWhere, recentSince);
    const specialistTrend = await this.buildSpecialistTrend(specialistPerformance.slice(0, 5), baseWhere, recentSince);
    const [agingBuckets, staleBySpecialist] = await Promise.all([
      this.buildTicketAgingBuckets(activeWhere, now),
      this.buildStaleBySpecialist(activeUsers, activeWhere, staleCutoff)
    ]);

    return {
      summary: {
        totalOpen,
        newTickets,
        closedTickets,
        unassignedTickets,
        highPriorityTickets,
        awaitingCustomer,
        awaitingTechnician,
        noRecentUpdate,
        slaBreached: null,
        slaAtRisk: null
      },
      byStatus: byStatus.map((item) => {
        const definition = statusDefinitions.find((status) => status.id === item.statusDefinitionId);
        return {
          status: item.status,
          statusDefinitionId: item.statusDefinitionId,
          label: definition?.name ?? this.humanizeTicketStatus(item.status),
          color: definition?.color ?? null,
          count: item._count._all,
          filter: item.statusDefinitionId ? { statusDefinitionIds: [item.statusDefinitionId] } : { statuses: [item.status] }
        };
      }),
      byPriority: byPriority.map((item) => ({ priority: item.priority, count: item._count._all, filter: { priority: item.priority } })),
      bySource: bySource.map((item) => ({ source: item.source, count: item._count._all, filter: { source: item.source } })),
      byClient: byClient.map((item) => ({
        clientId: item.clientId,
        name: item.clientId ? (clientNames.get(item.clientId) ?? "Unknown client") : "Unmapped / no client",
        count: item._count._all,
        filter: item.clientId ? { clientId: item.clientId } : {}
      })),
      workload: workload.filter((item) => item.count > 0).sort((a, b) => b.count - a.count).slice(0, 8),
      agingBuckets,
      staleBySpecialist,
      specialistPerformance,
      specialistTrend,
      activityByDay: this.buildActivityByDay(recentCreatedTickets, recentClosedTickets),
      createdByHour: this.buildCreatedByHour(recentCreatedTickets),
      insightTickets: {
        critical: criticalTickets.map((ticket) => this.toDashboardTicket(ticket)),
        unassigned: unassignedTicketList.map((ticket) => this.toDashboardTicket(ticket)),
        stale: staleTicketList.map((ticket) => this.toDashboardTicket(ticket))
      }
    };
  }

  private daysAgo(days: number) {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  private dashboardTicketSelect() {
    return {
      id: true,
      ticketNumber: true,
      subject: true,
      status: true,
      statusDefinitionId: true,
      statusDefinition: { select: { id: true, name: true, color: true } },
      priority: true,
      createdAt: true,
      updatedAt: true,
      client: { select: { name: true } },
      assignedUser: { select: { firstName: true, lastName: true } }
    } satisfies Prisma.TicketSelect;
  }

  private buildActivityByDay(createdTickets: Array<{ createdAt: Date }>, closedTickets: Array<{ closedAt: Date | null; updatedAt: Date }>) {
    const buckets = Array.from({ length: 30 }, (_, index) => {
      const date = this.daysAgo(29 - index);
      const key = this.dateBucketKey(date);
      return {
        date: key,
        label: date.toLocaleDateString("en-US", { month: "short", day: "2-digit" }),
        created: 0,
        closed: 0
      };
    });
    const bucketMap = new Map(buckets.map((bucket) => [bucket.date, bucket]));

    createdTickets.forEach((ticket) => {
      const bucket = bucketMap.get(this.dateBucketKey(ticket.createdAt));
      if (bucket) {
        bucket.created += 1;
      }
    });

    closedTickets.forEach((ticket) => {
      const bucket = bucketMap.get(this.dateBucketKey(ticket.closedAt ?? ticket.updatedAt));
      if (bucket) {
        bucket.closed += 1;
      }
    });

    return buckets;
  }

  private buildCreatedByHour(createdTickets: Array<{ createdAt: Date }>) {
    const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, label: `${hour.toString().padStart(2, "0")}:00`, count: 0 }));
    createdTickets.forEach((ticket) => {
      buckets[ticket.createdAt.getHours()].count += 1;
    });
    return buckets;
  }

  private async buildTicketAgingBuckets(activeWhere: Prisma.TicketWhereInput, now: Date) {
    const buckets = [
      {
        label: "0-1 days",
        count: 0
      },
      {
        label: "2-3 days",
        count: 0
      },
      {
        label: "4-7 days",
        count: 0
      },
      {
        label: "8+ days",
        count: 0
      }
    ];
    const [zeroToOne, twoToThree, fourToSeven, eightPlus] = await Promise.all([
      this.prisma.ticket.count({ where: { ...activeWhere, createdAt: { gte: this.daysAgoFrom(now, 1) } } }),
      this.prisma.ticket.count({ where: { ...activeWhere, createdAt: { lt: this.daysAgoFrom(now, 1), gte: this.daysAgoFrom(now, 3) } } }),
      this.prisma.ticket.count({ where: { ...activeWhere, createdAt: { lt: this.daysAgoFrom(now, 3), gte: this.daysAgoFrom(now, 7) } } }),
      this.prisma.ticket.count({ where: { ...activeWhere, createdAt: { lt: this.daysAgoFrom(now, 7) } } })
    ]);

    buckets[0].count = zeroToOne;
    buckets[1].count = twoToThree;
    buckets[2].count = fourToSeven;
    buckets[3].count = eightPlus;
    return buckets;
  }

  private async buildStaleBySpecialist(activeUsers: Array<{ id: string; firstName: string; lastName: string }>, activeWhere: Prisma.TicketWhereInput, staleCutoff: Date) {
    const staleBySpecialist = await Promise.all(
      activeUsers.map(async (technician) => ({
        userId: technician.id,
        name: `${technician.firstName} ${technician.lastName}`,
        count: await this.prisma.ticket.count({
          where: {
            ...activeWhere,
            updatedAt: { lt: staleCutoff },
            OR: [{ assignedUserId: technician.id }, { assignees: { some: { userId: technician.id } } }]
          }
        }),
        filter: { assignedUserId: technician.id, statuses: this.activeStatusFilter(), sortBy: "updatedAt", sortDirection: "asc" }
      }))
    );

    return staleBySpecialist.filter((item) => item.count > 0).sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)).slice(0, 8);
  }

  private activeStatusFilter(): TicketStatus[] {
    return [
      TicketStatus.NEW,
      TicketStatus.OPEN,
      TicketStatus.IN_PROGRESS,
      TicketStatus.WAITING_ON_CUSTOMER,
      TicketStatus.WAITING_ON_TECHNICIAN,
      TicketStatus.WAITING_ON_THIRD_PARTY,
      TicketStatus.REOPENED
    ];
  }

  private daysAgoFrom(date: Date, days: number) {
    return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
  }

  private async buildSpecialistPerformance(
    technicians: Array<{ id: string; firstName: string; lastName: string }>,
    activeWhere: Prisma.TicketWhereInput,
    baseWhere: Prisma.TicketWhereInput,
    recentSince: Date
  ) {
    const rows = await Promise.all(
      technicians.map(async (technician) => {
        const assignedWhere = this.assignedToUserWhere(technician.id);
        const [assignedActive, awaitingTechnician, closedLast30Days, totalAssigned] = await Promise.all([
          this.prisma.ticket.count({
            where: {
              ...activeWhere,
              ...assignedWhere
            }
          }),
          this.prisma.ticket.count({
            where: {
              ...baseWhere,
              status: TicketStatus.WAITING_ON_TECHNICIAN,
              ...assignedWhere
            }
          }),
          this.prisma.ticket.count({
            where: {
              ...baseWhere,
              status: TicketStatus.CLOSED,
              AND: [
                assignedWhere,
                {
                  OR: [{ closedAt: { gte: recentSince } }, { closedAt: null, updatedAt: { gte: recentSince } }]
                }
              ]
            }
          }),
          this.prisma.ticket.count({
            where: {
              ...baseWhere,
              ...assignedWhere
            }
          })
        ]);

        return {
          userId: technician.id,
          name: `${technician.firstName} ${technician.lastName}`,
          assignedActive,
          awaitingTechnician,
          closedLast30Days,
          totalAssigned,
          averageDailyClosed: Number((closedLast30Days / 30).toFixed(2)),
          filter: { assignedUserId: technician.id }
        };
      })
    );
    const teamAverageActive = rows.length ? Number((rows.reduce((sum, row) => sum + row.assignedActive, 0) / rows.length).toFixed(1)) : 0;

    return rows
      .filter((row) => row.assignedActive > 0 || row.closedLast30Days > 0 || row.awaitingTechnician > 0)
      .sort(
        (a, b) =>
          b.averageDailyClosed - a.averageDailyClosed ||
          b.closedLast30Days - a.closedLast30Days ||
          a.awaitingTechnician - b.awaitingTechnician ||
          a.assignedActive - b.assignedActive ||
          b.totalAssigned - a.totalAssigned ||
          a.name.localeCompare(b.name)
      )
      .slice(0, 8)
      .map((row) => ({ ...row, teamAverageActive }));
  }

  private async buildSpecialistTrend(
    specialists: Array<{ userId: string; name: string }>,
    baseWhere: Prisma.TicketWhereInput,
    recentSince: Date
  ) {
    return Promise.all(
      specialists.map(async (specialist) => {
        const assignedWhere = this.assignedToUserWhere(specialist.userId);
        const [assignedTickets, closedTickets] = await Promise.all([
          this.prisma.ticket.findMany({
            where: {
              ...baseWhere,
              createdAt: { gte: recentSince },
              ...assignedWhere
            },
            select: { createdAt: true },
            orderBy: { createdAt: "asc" }
          }),
          this.prisma.ticket.findMany({
            where: {
              ...baseWhere,
              status: TicketStatus.CLOSED,
              AND: [
                assignedWhere,
                {
                  OR: [{ closedAt: { gte: recentSince } }, { closedAt: null, updatedAt: { gte: recentSince } }]
                }
              ]
            },
            select: { closedAt: true, updatedAt: true },
            orderBy: { updatedAt: "asc" }
          })
        ]);
        const points = this.buildSpecialistTrendPoints(assignedTickets, closedTickets);

        return {
          userId: specialist.userId,
          name: specialist.name,
          points
        };
      })
    );
  }

  private buildSpecialistTrendPoints(createdTickets: Array<{ createdAt: Date }>, closedTickets: Array<{ closedAt: Date | null; updatedAt: Date }>) {
    const buckets = Array.from({ length: 30 }, (_, index) => {
      const date = this.daysAgo(29 - index);
      const key = this.dateBucketKey(date);
      return {
        date: key,
        label: date.toLocaleDateString("en-US", { month: "short", day: "2-digit" }),
        assigned: 0,
        closed: 0
      };
    });
    const bucketMap = new Map(buckets.map((bucket) => [bucket.date, bucket]));

    createdTickets.forEach((ticket) => {
      const bucket = bucketMap.get(this.dateBucketKey(ticket.createdAt));
      if (bucket) {
        bucket.assigned += 1;
      }
    });

    closedTickets.forEach((ticket) => {
      const bucket = bucketMap.get(this.dateBucketKey(ticket.closedAt ?? ticket.updatedAt));
      if (bucket) {
        bucket.closed += 1;
      }
    });

    return buckets;
  }

  private assignedToUserWhere(userId: string): Prisma.TicketWhereInput {
    return {
      OR: [{ assignedUserId: userId }, { assignees: { some: { userId } } }]
    };
  }

  private dateBucketKey(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private toDashboardTicket(ticket: {
    ticketNumber: string;
    subject: string;
    status: TicketStatus;
    statusDefinitionId: string | null;
    statusDefinition: { id: string; name: string; color: string } | null;
    priority: TicketPriority;
    createdAt: Date;
    updatedAt: Date;
    client: { name: string } | null;
    assignedUser: { firstName: string; lastName: string } | null;
  }) {
    return {
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      status: ticket.status,
      statusDefinitionId: ticket.statusDefinitionId,
      statusDefinition: ticket.statusDefinition,
      priority: ticket.priority,
      clientName: ticket.client?.name ?? "Unmapped / no client",
      assignedTo: ticket.assignedUser ? `${ticket.assignedUser.firstName} ${ticket.assignedUser.lastName}` : "Unassigned",
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      href: `/tickets/${ticket.ticketNumber}`
    };
  }

  private humanizeTicketStatus(status: TicketStatus) {
    return status.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  }

  async getById(ticketId: string, user: AuthenticatedUser) {
    let ticket = await this.prisma.ticket.findFirst({
      where: {
        ...this.ticketReferenceWhere(ticketId, user.organizationId)
      },
      include: {
        client: true,
        contact: true,
        statusDefinition: true,
        assignedUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
          assignedGroup: true,
          assignedTeam: true,
        mergedIntoTicket: {
          select: {
            id: true,
            ticketNumber: true,
            subject: true
          }
        },
        mergedTickets: {
          select: {
            id: true,
            ticketNumber: true,
            subject: true,
            status: true,
            mergedAt: true
          },
          orderBy: { mergedAt: "desc" }
        },
        assignees: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true } }
          },
          orderBy: { createdAt: "asc" }
        },
        externalSpecialists: {
          include: { externalSpecialist: true },
          orderBy: { createdAt: "asc" }
        },
        firstReadBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        watchers: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true } }
          }
        },
        conversationParticipants: {
          where: { isActive: true },
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
            contact: { select: { id: true, firstName: true, lastName: true, email: true } }
          },
          orderBy: { addedAt: "asc" }
        },
        messages: {
          include: {
            attachments: true,
            authorUser: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true
              }
            },
            authorContact: true
          },
          orderBy: { createdAt: "asc" }
        },
        attachments: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" }
        }
      }
    });

    if (!ticket) {
      throw new NotFoundException("Ticket was not found.");
    }

    if (!ticket.firstReadAt) {
      ticket = await this.prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          firstReadAt: new Date(),
          firstReadByUserId: user.id,
          updatedAt: ticket.updatedAt
        },
        include: {
          client: true,
          contact: true,
          statusDefinition: true,
          assignedUser: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true
            }
          },
        assignedGroup: true,
        assignedTeam: true,
          mergedIntoTicket: {
            select: {
              id: true,
              ticketNumber: true,
              subject: true
            }
          },
          mergedTickets: {
            select: {
              id: true,
              ticketNumber: true,
              subject: true,
              status: true,
              mergedAt: true
            },
            orderBy: { mergedAt: "desc" }
          },
        assignees: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true, email: true } }
            },
            orderBy: { createdAt: "asc" }
          },
          externalSpecialists: {
            include: { externalSpecialist: true },
            orderBy: { createdAt: "asc" }
          },
          firstReadBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true
            }
          },
          watchers: {
            include: {
              user: { select: { id: true, firstName: true, lastName: true, email: true } }
            }
          },
          conversationParticipants: {
            where: { isActive: true },
            include: {
              user: { select: { id: true, firstName: true, lastName: true, email: true } },
              contact: { select: { id: true, firstName: true, lastName: true, email: true } }
            },
            orderBy: { addedAt: "asc" }
          },
          messages: {
            include: {
              attachments: true,
              authorUser: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true
                }
              },
              authorContact: true
            },
            orderBy: { createdAt: "asc" }
          },
          attachments: {
            where: { deletedAt: null },
            orderBy: { createdAt: "desc" }
          }
        }
      });
    }

    return ticket;
  }

  async create(input: CreateTicketDto, user: AuthenticatedUser) {
    const assignedUserIds = this.normalizeAssignedUserIds(input.assignedUserIds ?? []);
    const includesAssignment = assignedUserIds.length > 0 || Boolean(input.assignedTeamId);
    if ((includesAssignment || input.statusDefinitionId) && !user.permissions.includes("tickets.assign")) {
      throw new ForbiddenException("You do not have permission to set the initial ticket assignment or status.");
    }
    await this.validateAssignmentTargets(assignedUserIds, input.assignedTeamId, user.organizationId);

    if (input.clientId) {
      const client = await this.prisma.client.findFirst({
        where: { id: input.clientId, organizationId: user.organizationId, deletedAt: null },
        select: { id: true }
      });
      if (!client) {
        throw new BadRequestException("The selected client is not available.");
      }
    }

    const contact = input.contactId
      ? await this.prisma.contact.findFirst({
          where: {
            id: input.contactId,
            deletedAt: null,
            client: { organizationId: user.organizationId }
          },
          select: { id: true, clientId: true, email: true }
        })
      : null;
    if (input.contactId && !contact) {
      throw new BadRequestException("The selected requester is not available.");
    }
    if (contact && input.clientId && contact.clientId !== input.clientId) {
      throw new BadRequestException("The selected requester does not belong to the selected client.");
    }

    const requestedStatus = input.statusDefinitionId
      ? await this.ticketWorkflow?.resolveTarget(user.organizationId, { statusDefinitionId: input.statusDefinitionId })
      : null;
    if (input.statusDefinitionId && !requestedStatus) {
      throw new BadRequestException("The selected ticket status is not available.");
    }
    const defaultStatus = requestedStatus ?? await this.ticketWorkflow?.getDefaultStatus(user.organizationId);
    const description = input.description?.trim() || null;
    const senderEmail = contact?.email.trim().toLowerCase() ?? null;
    const ticket = await this.prisma.$transaction(async (tx) => {
      const ticketNumber = await this.nextTicketNumber(tx);
      const createdTicket = await tx.ticket.create({
        data: {
          ticketNumber,
          organizationId: user.organizationId,
          clientId: input.clientId ?? contact?.clientId ?? null,
          contactId: contact?.id ?? null,
          senderEmail,
          senderDomain: senderEmail ? this.extractDomain(senderEmail) : null,
          subject: input.subject,
          description,
          priority: input.priority ?? TicketPriority.NORMAL,
          source: input.source ?? TicketSource.MANUAL,
          status: defaultStatus?.systemStatus ?? TicketStatus.NEW,
          ...(defaultStatus ? { statusDefinitionId: defaultStatus.id } : {}),
          assignedUserId: assignedUserIds[0] ?? null,
          assignedTeamId: input.assignedTeamId ?? null,
          ...(description ? { lastCustomerResponseAt: new Date() } : {})
        }
      });

      if (description) {
        await tx.ticketMessage.create({
          data: {
            ticketId: createdTicket.id,
            authorContactId: contact?.id ?? null,
            direction: MessageDirection.INBOUND,
            visibility: MessageVisibility.PUBLIC,
            bodyText: description,
            senderEmail,
            senderDomain: senderEmail ? this.extractDomain(senderEmail) : null
          }
        });
      }

      await Promise.all(
        assignedUserIds.map((userId) =>
          tx.ticketAssignee.create({
            data: { ticketId: createdTicket.id, userId, assignedById: user.id }
          })
        )
      );
      return createdTicket;
    });

    await this.auditLogs.create({
      userId: user.id,
      entityType: "Ticket",
      entityId: ticket.id,
      action: "ticket.created",
      metadata: { ticketNumber: ticket.ticketNumber }
    });

    await this.notifications.notifyNewTicketCreated({
      ticketId: ticket.id,
      organizationId: user.organizationId
    });

    if (includesAssignment) {
      await this.notifyTicketParticipants({
        ticketId: ticket.id,
        createdById: user.id,
        reason: "Ticket assigned during creation",
        title: "Ticket assigned",
        eventType: "ticketAssignedToMe",
        excludeUserIds: [user.id]
      });
    }

    return ticket;
  }

  listViews(user: AuthenticatedUser) {
    return this.prisma.userTicketView.findMany({
      where: { userId: user.id },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }]
    });
  }

  async saveView(input: UpsertTicketViewDto, user: AuthenticatedUser) {
    const name = input.name.trim();
    this.assertTicketViewState(input.state);
    return this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.userTicketView.findUnique({
        where: { userId_name: { userId: user.id, name } },
        select: { id: true }
      });
      if (duplicate) {
        throw new ConflictException("A ticket view with this name already exists.");
      }
      if (input.isDefault) {
        await tx.userTicketView.updateMany({
          where: { userId: user.id },
          data: { isDefault: false }
        });
      }

      return tx.userTicketView.create({
        data: {
          userId: user.id,
          name,
          state: input.state as Prisma.InputJsonValue,
          isDefault: input.isDefault ?? false
        }
      });
    });
  }

  async updateView(viewId: string, input: UpsertTicketViewDto, user: AuthenticatedUser) {
    const existing = await this.prisma.userTicketView.findFirst({
      where: { id: viewId, userId: user.id },
      select: { id: true, isDefault: true }
    });
    if (!existing) {
      throw new NotFoundException("Ticket view was not found.");
    }

    const name = input.name.trim();
    this.assertTicketViewState(input.state);
    return this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.userTicketView.findFirst({
        where: { userId: user.id, name, id: { not: viewId } },
        select: { id: true }
      });
      if (duplicate) {
        throw new ConflictException("A ticket view with this name already exists.");
      }
      if (input.isDefault) {
        await tx.userTicketView.updateMany({
          where: { userId: user.id, id: { not: viewId } },
          data: { isDefault: false }
        });
      }

      return tx.userTicketView.update({
        where: { id: viewId },
        data: {
          name,
          state: input.state as Prisma.InputJsonValue,
          isDefault: input.isDefault ?? existing.isDefault
        }
      });
    });
  }

  async deleteView(viewId: string, user: AuthenticatedUser) {
    const existing = await this.prisma.userTicketView.findFirst({
      where: { id: viewId, userId: user.id },
      select: { id: true }
    });
    if (!existing) {
      throw new NotFoundException("Ticket view was not found.");
    }

    await this.prisma.userTicketView.delete({ where: { id: viewId } });
    return { deleted: true };
  }

  private assertTicketViewState(state: UpsertTicketViewDto["state"]) {
    const serialized = JSON.stringify(state);
    if (serialized.length > 64_000) {
      throw new BadRequestException("Ticket view configuration is too large.");
    }

    const validColumns = new Set([
      "ticketNumber", "subject", "client", "requester", "readState", "assignees", "team",
      "status", "priority", "source", "createdAt", "updatedAt", "messages", "attachments"
    ]);
    for (const column of [...(state.columnOrder ?? []), ...(state.visibleColumns ?? [])]) {
      if (!validColumns.has(column)) {
        throw new BadRequestException("Ticket view contains an unsupported column.");
      }
    }

    for (const [column, width] of Object.entries(state.columnWidths ?? {})) {
      if (!validColumns.has(column) || typeof width !== "number" || !Number.isFinite(width) || width < 60 || width > 600) {
        throw new BadRequestException("Ticket view contains an invalid column width.");
      }
    }

    const legacyStatuses = new Set(Object.values(TicketStatus));
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if ((state.statuses ?? []).some((status) => !legacyStatuses.has(status as TicketStatus) && !uuidPattern.test(status))) {
      throw new BadRequestException("Ticket view contains an invalid ticket status.");
    }
  }

  async createFromInboundEmail(input: CreateInboundEmailTicketInput) {
    const senderEmail = input.senderEmail.trim().toLowerCase();
    const senderDomain = this.extractDomain(senderEmail);
    const requester = await this.contactsService.resolveRequesterFromEmail({
      emailAddress: input.senderEmail,
      displayName: input.senderName,
      organizationId: input.organizationId
    });
    const bodyText = input.bodyText?.trim() || "Inbound email did not include a plain text body.";
    const sanitizedBodyHtml = input.bodyHtml ? this.htmlSanitizer.sanitize(input.bodyHtml) : null;
    const existingTicket = await this.findExistingTicketForInbound(input);

    if (existingTicket) {
      const targetTicket =
        existingTicket.status === TicketStatus.MERGED && existingTicket.mergedIntoTicketId
          ? await this.prisma.ticket.findFirst({
              where: {
                id: existingTicket.mergedIntoTicketId,
                organizationId: input.organizationId,
                deletedAt: null
              }
            })
          : existingTicket;
      if (!targetTicket) {
        throw new NotFoundException("Merged primary ticket was not found.");
      }
      const mergeOrigin = targetTicket.id === existingTicket.id ? null : existingTicket;
      const shouldReopen = this.shouldReopenFromInbound(targetTicket.status);
      const shouldAwaitTechnician = await this.shouldMarkWaitingOnTechnicianFromInbound(targetTicket.id, targetTicket.status);
      const nextSystemStatus = shouldReopen
        ? (shouldAwaitTechnician ? TicketStatus.WAITING_ON_TECHNICIAN : TicketStatus.REOPENED)
        : (shouldAwaitTechnician ? TicketStatus.WAITING_ON_TECHNICIAN : null);
      const nextStatusDefinition = nextSystemStatus
        ? await this.ticketWorkflow?.resolveTarget(input.organizationId, { systemStatus: nextSystemStatus })
        : null;
      const result = await this.prisma.$transaction(async (tx) => {
        const ticket = await tx.ticket.update({
          where: { id: targetTicket.id },
          data: {
            ...(targetTicket.clientId ? {} : { clientId: requester?.client.id ?? null }),
            ...(targetTicket.contactId ? {} : { contactId: requester?.contact?.id ?? null }),
            lastCustomerResponseAt: new Date(),
            ...(shouldReopen
              ? {
                  status: nextStatusDefinition?.systemStatus ?? nextSystemStatus ?? TicketStatus.REOPENED,
                  ...(nextStatusDefinition ? { statusDefinitionId: nextStatusDefinition.id } : {}),
                  reopenedAt: new Date(),
                  resolvedAt: null,
                  closedAt: null
                }
              : {}),
            ...(!shouldReopen && shouldAwaitTechnician
              ? {
                  status: nextStatusDefinition?.systemStatus ?? TicketStatus.WAITING_ON_TECHNICIAN,
                  ...(nextStatusDefinition ? { statusDefinitionId: nextStatusDefinition.id } : {})
                }
              : {})
          }
        });

        const message = await tx.ticketMessage.create({
          data: {
            ticketId: ticket.id,
            authorContactId: requester?.contact?.id ?? null,
            direction: MessageDirection.INBOUND,
            visibility: MessageVisibility.PUBLIC,
            bodyText,
            bodyHtml: input.bodyHtml ?? null,
            sanitizedBodyHtml,
            senderEmail,
            senderDomain,
            emailMessageId: input.emailMessageId ?? null,
            emailInternetMessageId: input.emailInternetMessageId ?? null,
            emailConversationId: input.emailConversationId ?? null,
            inReplyTo: input.inReplyTo ?? null,
            emailReferences: input.references ?? null,
            mergedFromTicketId: mergeOrigin?.id ?? null,
            mergedFromTicketNumber: mergeOrigin?.ticketNumber ?? null,
            mergedFromTicketSubject: mergeOrigin?.subject ?? null,
            hasAttachments: input.hasAttachments ?? false
          }
        });

        return { ticket, message };
      });

      await this.ticketWorkflow?.applyRules({
        ticketId: result.ticket.id,
        organizationId: input.organizationId,
        trigger: TicketWorkflowTrigger.CUSTOMER_REPLIED,
        priorClosedAt: targetTicket.closedAt
      });
      await this.recordUnknownSenderDomain(input.organizationId, senderDomain, senderEmail, requester);
      await this.auditLogs.create({
        userId: null,
        entityType: "Ticket",
        entityId: result.ticket.id,
        action: shouldReopen ? "ticket.reopened_from_customer_reply" : "ticket.customer_reply_received",
        metadata: {
          ticketNumber: result.ticket.ticketNumber,
          status: result.ticket.status,
          senderEmail: input.senderEmail,
          emailMessageId: input.emailMessageId ?? null,
          emailInternetMessageId: input.emailInternetMessageId ?? null,
          emailConversationId: input.emailConversationId ?? null,
          matchedMergedTicketNumber: mergeOrigin?.ticketNumber ?? null
        }
      });

      await this.notifyTicketParticipants({
        ticketId: result.ticket.id,
        createdById: null,
        reason: `Customer replied to ${result.ticket.ticketNumber}`,
        title: `Customer replied: ${result.ticket.ticketNumber}`,
        eventType: "ticketReplyOnAssignedTicket"
      });
      if (shouldReopen) {
        await this.notifyTicketParticipants({
          ticketId: result.ticket.id,
          createdById: null,
          reason: `Customer activity reopened ${result.ticket.ticketNumber}`,
          title: `Ticket reopened: ${result.ticket.ticketNumber}`,
          eventType: "ticketReopened"
        });
      }

      return result;
    }

    const defaultStatus = await this.ticketWorkflow?.getDefaultStatus(input.organizationId);
    const result = await this.prisma.$transaction(async (tx) => {
      const ticketNumber = await this.nextTicketNumber(tx);
      const ticket = await tx.ticket.create({
        data: {
          ticketNumber,
          organizationId: input.organizationId,
          mailboxId: input.mailboxId ?? null,
          clientId: requester?.client.id ?? null,
          contactId: requester?.contact?.id ?? null,
          senderEmail,
          senderDomain,
          subject: input.subject.trim(),
          description: bodyText,
          priority: TicketPriority.NORMAL,
          source: TicketSource.EMAIL,
          status: defaultStatus?.systemStatus ?? TicketStatus.NEW,
          ...(defaultStatus ? { statusDefinitionId: defaultStatus.id } : {}),
          lastCustomerResponseAt: new Date()
        }
      });

      const message = await tx.ticketMessage.create({
        data: {
          ticketId: ticket.id,
          authorContactId: requester?.contact?.id ?? null,
          direction: MessageDirection.INBOUND,
          visibility: MessageVisibility.PUBLIC,
          bodyText,
          bodyHtml: input.bodyHtml ?? null,
          sanitizedBodyHtml,
          senderEmail,
          senderDomain,
          emailMessageId: input.emailMessageId ?? null,
          emailInternetMessageId: input.emailInternetMessageId ?? null,
          emailConversationId: input.emailConversationId ?? null,
          inReplyTo: input.inReplyTo ?? null,
          emailReferences: input.references ?? null,
          hasAttachments: input.hasAttachments ?? false
        }
      });

      return { ticket, message };
    });

    const matchedRule = await this.ticketRouting.applyInboundRules({
      ticketId: result.ticket.id,
      organizationId: input.organizationId,
      mailboxId: input.mailboxId ?? null,
      clientId: requester?.client.id ?? null,
      senderEmail,
      senderDomain,
      subject: result.ticket.subject,
      bodyText
    });

    await this.recordUnknownSenderDomain(input.organizationId, senderDomain, senderEmail, requester);

    await this.auditLogs.create({
      userId: null,
      entityType: "Ticket",
      entityId: result.ticket.id,
      action: "ticket.created_from_inbound_email",
      metadata: {
        ticketNumber: result.ticket.ticketNumber,
        senderEmail: input.senderEmail,
        clientId: result.ticket.clientId,
        contactId: result.ticket.contactId,
        routingRuleId: matchedRule?.id ?? null
      }
    });

    await this.notifications.notifyNewTicketCreated({
      ticketId: result.ticket.id,
      organizationId: input.organizationId
    });

    await this.autoReplies.sendForNewInboundTicket({
      organizationId: input.organizationId,
      ticketId: result.ticket.id,
      messageId: result.message.id,
      senderEmail,
      mailboxId: input.mailboxId ?? null,
      autoSubmittedHeader: input.internetMessageHeaders?.["auto-submitted"] ?? null,
      threadKey: input.emailConversationId ?? input.emailInternetMessageId ?? input.emailMessageId ?? result.ticket.ticketNumber,
      inReplyTo: input.emailInternetMessageId ?? input.emailMessageId ?? null,
      references: input.references ?? input.emailInternetMessageId ?? null,
      replyToProviderMessageId: input.emailMessageId ?? null
    });

    return result;
  }

  async updateAssignment(ticketId: string, input: UpdateTicketAssignmentDto, user: AuthenticatedUser) {
    const targetStatus = input.statusDefinitionId || input.status
      ? await this.ticketWorkflow?.resolveTarget(user.organizationId, {
          statusDefinitionId: input.statusDefinitionId,
          systemStatus: input.status
        })
      : null;
    if (input.statusDefinitionId && !targetStatus) {
      throw new BadRequestException("Configurable ticket statuses are not available.");
    }
    if ((targetStatus?.systemStatus ?? input.status) === TicketStatus.MERGED) {
      throw new BadRequestException("Use the merge workflow to mark tickets as merged.");
    }

    const existingTicket = await this.ensureTicketExists(ticketId, user);
    const internalTicketId = existingTicket.id;
    const assignedUserIds = this.normalizeAssignedUserIds(input.assignedUserIds ?? (input.assignedUserId ? [input.assignedUserId] : []));
    const primaryAssignedUserId = assignedUserIds[0] ?? input.assignedUserId ?? null;
    await this.validateAssignmentTargets(assignedUserIds, input.assignedTeamId, user.organizationId);
    const ticket = await this.prisma.ticket.update({
      where: { id: internalTicketId },
      data: {
        assignedUserId: primaryAssignedUserId,
        assignedGroupId: input.assignedTeamId ? null : input.assignedGroupId,
        assignedTeamId: input.assignedTeamId,
        priority: input.priority,
        status: targetStatus ? undefined : input.status
      }
    });
    if (targetStatus && this.ticketWorkflow) {
      await this.ticketWorkflow.transitionTicket({
        ticketId: internalTicketId,
        organizationId: user.organizationId,
        statusDefinitionId: targetStatus.id,
        userId: user.id,
        reason: "Assignment update"
      });
    }
    const addedAssignedUserIds = await this.syncTicketAssignees(internalTicketId, assignedUserIds, user.id);
    if (assignedUserIds.length > 0) {
      await this.ticketWorkflow?.applyRules({
        ticketId: internalTicketId,
        organizationId: user.organizationId,
        trigger: TicketWorkflowTrigger.TICKET_ASSIGNED,
        userId: user.id
      });
    }

    await Promise.all(
      addedAssignedUserIds.map((assignedUserId) =>
        this.addWatcherAndNotify(internalTicketId, assignedUserId, user.id, "Manual assignment", `Ticket assigned: ${ticket.ticketNumber}`, "ticketAssignedToMe")
      )
    );
    if (input.assignedGroupId && input.assignedGroupId !== existingTicket.assignedGroupId) {
      await this.notifyGroupMembers(internalTicketId, input.assignedGroupId, user.id, "Manual group assignment", `Ticket assigned to your group: ${ticket.ticketNumber}`);
    }
    if (input.assignedTeamId && input.assignedTeamId !== existingTicket.assignedTeamId) {
      await this.notifyTeamMembers(internalTicketId, input.assignedTeamId, user.id, "Manual team assignment", `Ticket assigned to your team: ${ticket.ticketNumber}`);
    }

    await this.auditLogs.create({
      userId: user.id,
      entityType: "Ticket",
      entityId: internalTicketId,
      action: "ticket.assignment_updated",
      metadata: {
        assignedUserId: primaryAssignedUserId,
        assignedUserIds,
        assignedGroupId: input.assignedGroupId ?? null,
        assignedTeamId: input.assignedTeamId ?? null,
        priority: input.priority ?? null,
        status: input.status ?? null
      }
    });

    return ticket;
  }

  async updatePlanning(ticketId: string, input: UpdateTicketPlanningDto, user: AuthenticatedUser) {
    const existingTicket = await this.ensureTicketExists(ticketId, user);
    const targetDate = input.targetDate ? new Date(input.targetDate) : null;
    const ticket = await this.prisma.ticket.update({
      where: { id: existingTicket.id },
      data: { targetDate }
    });

    await this.auditLogs.create({
      userId: user.id,
      entityType: "Ticket",
      entityId: ticket.id,
      action: "ticket.planning_updated",
      metadata: { targetDate: ticket.targetDate?.toISOString() ?? null }
    });

    return ticket;
  }

  async updateState(ticketId: string, input: UpdateTicketStateDto, user: AuthenticatedUser) {
    const targetStatus = input.statusDefinitionId || input.status
      ? await this.ticketWorkflow?.resolveTarget(user.organizationId, {
          statusDefinitionId: input.statusDefinitionId,
          systemStatus: input.status
        })
      : null;
    if (input.statusDefinitionId && !targetStatus) {
      throw new BadRequestException("Configurable ticket statuses are not available.");
    }
    const targetSystemStatus = targetStatus?.systemStatus ?? input.status;
    if (targetSystemStatus === TicketStatus.MERGED) {
      throw new BadRequestException("Use the merge workflow to mark tickets as merged.");
    }
    if (input.priority !== undefined && !user.permissions.includes("tickets.update")) {
      throw new ForbiddenException("You do not have permission to update ticket priority.");
    }
    if (targetSystemStatus !== undefined) {
      const requiredPermission = targetSystemStatus === TicketStatus.CLOSED
        ? "tickets.close"
        : targetSystemStatus === TicketStatus.REOPENED
          ? "tickets.reopen"
          : "tickets.update";
      if (!user.permissions.includes(requiredPermission)) {
        throw new ForbiddenException("You do not have permission to change this ticket status.");
      }
    }

    const existing = await this.ensureTicketExists(ticketId, user);
    if (targetStatus && this.ticketWorkflow) {
      await this.ticketWorkflow.transitionTicket({
        ticketId: existing.id,
        organizationId: user.organizationId,
        statusDefinitionId: targetStatus.id,
        userId: user.id,
        reason: "Manual status update"
      });
    } else if (input.status !== undefined) {
      const activeStatus = this.activeStatusFilter().includes(input.status);
      await this.prisma.ticket.update({
        where: { id: existing.id },
        data: {
          status: input.status,
          ...(input.status === TicketStatus.CLOSED ? { closedAt: new Date() } : {}),
          ...(input.status === TicketStatus.RESOLVED ? { resolvedAt: new Date() } : {}),
          ...(activeStatus ? { closedAt: null, resolvedAt: null } : {}),
          ...(input.status === TicketStatus.REOPENED ? { reopenedAt: new Date() } : {})
        }
      });
    }
    if (input.priority !== undefined) {
      await this.prisma.ticket.update({ where: { id: existing.id }, data: { priority: input.priority } });
    }
    if (targetSystemStatus === TicketStatus.REOPENED) {
      await this.ticketWorkflow?.applyRules({
        ticketId: existing.id,
        organizationId: user.organizationId,
        trigger: TicketWorkflowTrigger.MANUAL_REOPEN,
        userId: user.id
      });
    }
    await this.auditLogs.create({
      userId: user.id,
      entityType: "Ticket",
      entityId: existing.id,
      action: "ticket.state_updated",
      metadata: {
        status: targetSystemStatus ?? null,
        statusDefinitionId: targetStatus?.id ?? input.statusDefinitionId ?? null,
        priority: input.priority ?? null
      }
    });
    return this.getById(existing.id, user);
  }

  async bulkUpdate(input: BulkUpdateTicketsDto, user: AuthenticatedUser) {
    const ticketIds = [...new Set(input.ticketIds)];
    if (ticketIds.length === 0) {
      return { updated: 0 };
    }

    const targetStatus = input.statusDefinitionId || input.status
      ? await this.ticketWorkflow?.resolveTarget(user.organizationId, {
          statusDefinitionId: input.statusDefinitionId,
          systemStatus: input.status
        })
      : null;
    if (input.statusDefinitionId && !targetStatus) {
      throw new BadRequestException("Configurable ticket statuses are not available.");
    }
    if ((targetStatus?.systemStatus ?? input.status) === TicketStatus.MERGED) {
      throw new BadRequestException("Use the merge workflow to mark tickets as merged.");
    }
    const targetSystemStatus = targetStatus?.systemStatus ?? input.status;
    if (targetSystemStatus) {
      const requiredPermission = targetSystemStatus === TicketStatus.CLOSED
        ? "tickets.close"
        : targetSystemStatus === TicketStatus.REOPENED
          ? "tickets.reopen"
          : "tickets.update";
      if (!user.permissions.includes(requiredPermission)) {
        throw new ForbiddenException("You do not have permission to change ticket status.");
      }
    }
    if (input.priority !== undefined && !user.permissions.includes("tickets.update")) {
      throw new ForbiddenException("You do not have permission to update ticket priority.");
    }
    const updatesAssignment = input.assignedUserId !== undefined
      || input.assignedUserIds !== undefined
      || input.assignedGroupId !== undefined
      || input.assignedTeamId !== undefined;
    if (updatesAssignment && !user.permissions.includes("tickets.assign")) {
      throw new ForbiddenException("You do not have permission to assign tickets.");
    }

    const existingTickets = await this.prisma.ticket.findMany({
      where: { id: { in: ticketIds }, organizationId: user.organizationId, deletedAt: null },
      select: { id: true, ticketNumber: true }
    });
    const existingIds = existingTickets.map((ticket) => ticket.id);
    const assignedUserIds = this.normalizeAssignedUserIds(input.assignedUserIds ?? (input.assignedUserId ? [input.assignedUserId] : []));
    const primaryAssignedUserId = assignedUserIds[0] ?? input.assignedUserId ?? undefined;
    await this.validateAssignmentTargets(assignedUserIds, input.assignedTeamId, user.organizationId);

    await this.prisma.ticket.updateMany({
      where: { id: { in: existingIds }, organizationId: user.organizationId, deletedAt: null },
      data: {
        priority: input.priority,
        status: targetStatus ? undefined : input.status,
        assignedUserId: primaryAssignedUserId,
        assignedGroupId: input.assignedTeamId ? null : input.assignedGroupId,
        assignedTeamId: input.assignedTeamId,
        ...(input.status === "CLOSED" ? { closedAt: new Date() } : {}),
        ...(input.status === "REOPENED" || input.status === "OPEN" ? { reopenedAt: new Date(), closedAt: null } : {})
      }
    });

    await Promise.all(
      existingTickets.map(async (ticket) => {
        if (targetStatus && this.ticketWorkflow) {
          await this.ticketWorkflow.transitionTicket({
            ticketId: ticket.id,
            organizationId: user.organizationId,
            statusDefinitionId: targetStatus.id,
            userId: user.id,
            reason: "Bulk status update"
          });
        }
        if (input.assignedUserIds !== undefined || input.assignedUserId !== undefined) {
          const addedAssignedUserIds = await this.syncTicketAssignees(ticket.id, assignedUserIds, user.id);
          await Promise.all(addedAssignedUserIds.map((assignedUserId) =>
            this.addWatcherAndNotify(ticket.id, assignedUserId, user.id, "Bulk assignment", `Ticket assigned: ${ticket.ticketNumber}`, "ticketAssignedToMe")
          ));
          if (assignedUserIds.length > 0) {
            await this.ticketWorkflow?.applyRules({
              ticketId: ticket.id,
              organizationId: user.organizationId,
              trigger: TicketWorkflowTrigger.TICKET_ASSIGNED,
              userId: user.id
            });
          }
        }
        if (input.assignedGroupId) {
          await this.notifyGroupMembers(ticket.id, input.assignedGroupId, user.id, "Bulk group assignment", `Ticket assigned to your group: ${ticket.ticketNumber}`);
        }
        if (input.assignedTeamId) {
          await this.notifyTeamMembers(ticket.id, input.assignedTeamId, user.id, "Bulk team assignment", `Ticket assigned to your team: ${ticket.ticketNumber}`);
        }
      })
    );

    await this.auditLogs.create({
      userId: user.id,
      entityType: "Ticket",
      entityId: null,
      action: "ticket.bulk_updated",
      metadata: {
        ticketIds: existingIds,
        status: targetStatus?.systemStatus ?? input.status ?? null,
        statusDefinitionId: targetStatus?.id ?? input.statusDefinitionId ?? null,
        priority: input.priority ?? null,
        assignedUserId: primaryAssignedUserId ?? null,
        assignedUserIds,
        assignedGroupId: input.assignedGroupId ?? null,
        assignedTeamId: input.assignedTeamId ?? null
      }
    });

    return { updated: existingIds.length };
  }

  async bulkSoftDelete(ticketIds: string[], user: AuthenticatedUser) {
    const ids = [...new Set(ticketIds)];
    if (ids.length === 0) {
      return { deleted: 0 };
    }

    const result = await this.prisma.ticket.updateMany({
      where: { id: { in: ids }, organizationId: user.organizationId, deletedAt: null },
      data: { deletedAt: new Date() }
    });

    await this.auditLogs.create({
      userId: user.id,
      entityType: "Ticket",
      entityId: null,
      action: "ticket.bulk_deleted",
      metadata: { ticketIds: ids, deleted: result.count }
    });

    return { deleted: result.count };
  }

  async bulkRestore(ticketIds: string[], user: AuthenticatedUser) {
    const ids = [...new Set(ticketIds)];
    if (ids.length === 0) {
      return { restored: 0 };
    }

    const result = await this.prisma.ticket.updateMany({
      where: { id: { in: ids }, organizationId: user.organizationId, deletedAt: { not: null } },
      data: { deletedAt: null }
    });

    await this.auditLogs.create({
      userId: user.id,
      entityType: "Ticket",
      entityId: null,
      action: "ticket.bulk_restored",
      metadata: { ticketIds: ids, restored: result.count }
    });

    return { restored: result.count };
  }

  async mergeCandidates(primaryTicketId: string, user: AuthenticatedUser, search?: string) {
    const primary = await this.ensureTicketExists(primaryTicketId, user);
    const trimmedSearch = search?.trim();
    if (!trimmedSearch) {
      return [];
    }

    return this.prisma.ticket.findMany({
      where: {
        organizationId: user.organizationId,
        deletedAt: null,
        id: { not: primary.id },
        status: { not: TicketStatus.MERGED },
        OR: [
          { ticketNumber: { contains: trimmedSearch, mode: "insensitive" } },
          { subject: { contains: trimmedSearch, mode: "insensitive" } },
          { senderEmail: { contains: trimmedSearch, mode: "insensitive" } },
          { senderDomain: { contains: trimmedSearch, mode: "insensitive" } },
          { client: { name: { contains: trimmedSearch, mode: "insensitive" } } },
          { contact: { email: { contains: trimmedSearch, mode: "insensitive" } } },
          { contact: { firstName: { contains: trimmedSearch, mode: "insensitive" } } },
          { contact: { lastName: { contains: trimmedSearch, mode: "insensitive" } } }
        ]
      },
      select: {
        id: true,
        ticketNumber: true,
        subject: true,
        status: true,
        priority: true,
        createdAt: true,
        clientId: true,
        client: { select: { id: true, name: true } },
        contact: { select: { id: true, firstName: true, lastName: true, email: true } },
        senderEmail: true,
        _count: {
          select: {
            messages: true,
            attachments: {
              where: {
                deletedAt: null
              }
            }
          }
        }
      },
      orderBy: { updatedAt: "desc" },
      take: 12
    });
  }

  async mergeTickets(primaryTicketId: string, input: MergeTicketsDto, user: AuthenticatedUser) {
    const primary = await this.ensureTicketExists(primaryTicketId, user);
    const sourceTicketIds = [...new Set(input.sourceTicketIds)].filter((id) => id !== primary.id);
    if (sourceTicketIds.length === 0) {
      throw new BadRequestException("Choose at least one ticket to merge.");
    }

    const sourceTickets = await this.prisma.ticket.findMany({
      where: { id: { in: sourceTicketIds }, organizationId: user.organizationId, deletedAt: null },
      select: {
        id: true,
        ticketNumber: true,
        subject: true,
        clientId: true,
        status: true,
        mergedIntoTicketId: true
      }
    });

    if (primary.status === TicketStatus.MERGED) {
      throw new BadRequestException("A merged ticket cannot be used as the primary ticket.");
    }

    if (sourceTickets.length !== sourceTicketIds.length) {
      throw new BadRequestException("One or more selected tickets are not available.");
    }

    const alreadyMerged = sourceTickets.find((ticket) => ticket.status === TicketStatus.MERGED || ticket.mergedIntoTicketId);
    if (alreadyMerged) {
      throw new BadRequestException(`${alreadyMerged.ticketNumber} is already merged into another ticket.`);
    }

    const differentClient = sourceTickets.find((ticket) => ticket.clientId !== primary.clientId);
    if (differentClient && !input.allowDifferentClient) {
      throw new BadRequestException("One or more selected tickets belong to a different client. Confirm cross-client merge to continue.");
    }

    const reason = input.reason?.trim() || null;
    const now = new Date();
    const mergedStatus = await this.ticketWorkflow?.resolveTarget(user.organizationId, { systemStatus: TicketStatus.MERGED });

    await this.prisma.$transaction(async (tx) => {
      await tx.ticketMerge.create({
        data: {
          organizationId: user.organizationId,
          primaryTicketId: primary.id,
          mergedTicketIds: sourceTickets.map((ticket) => ticket.id),
          performedByUserId: user.id,
          reason
        }
      });

      const watcherRows = await tx.ticketWatcher.findMany({
        where: { ticketId: { in: sourceTicketIds } },
        select: { userId: true, reason: true }
      });

      for (const watcher of watcherRows) {
        await tx.ticketWatcher.upsert({
          where: {
            ticketId_userId: {
              ticketId: primary.id,
              userId: watcher.userId
            }
          },
          update: {},
          create: {
            ticketId: primary.id,
            userId: watcher.userId,
            createdById: user.id,
            reason: watcher.reason ?? "Merged ticket watcher"
          }
        });
      }

      for (const sourceTicket of sourceTickets) {
        await tx.ticketMessage.updateMany({
          where: { ticketId: sourceTicket.id },
          data: {
            ticketId: primary.id,
            mergedFromTicketId: sourceTicket.id,
            mergedFromTicketNumber: sourceTicket.ticketNumber,
            mergedFromTicketSubject: sourceTicket.subject
          }
        });

        await tx.ticketAttachment.updateMany({
          where: { ticketId: sourceTicket.id },
          data: { ticketId: primary.id }
        });

        await tx.ticket.update({
          where: { id: sourceTicket.id },
          data: {
            status: TicketStatus.MERGED,
            ...(mergedStatus ? { statusDefinitionId: mergedStatus.id } : {}),
            mergedIntoTicketId: primary.id,
            mergedAt: now,
            mergedByUserId: user.id,
            mergeReason: reason,
            closedAt: now,
            updatedAt: now
          }
        });
      }

      const summaryText = [
        `Tickets merged into ${primary.ticketNumber}: ${sourceTickets.map((ticket) => ticket.ticketNumber).join(", ")}.`,
        reason ? `Reason: ${reason}` : null
      ]
        .filter(Boolean)
        .join("\n");
      const summaryHtml = this.htmlSanitizer.sanitize(
        `<p><strong>Tickets merged into ${this.escapeHtml(primary.ticketNumber)}:</strong> ${this.escapeHtml(sourceTickets.map((ticket) => ticket.ticketNumber).join(", "))}</p>${
          reason ? `<p><strong>Reason:</strong> ${this.escapeHtml(reason)}</p>` : ""
        }`
      );

      await tx.ticketMessage.create({
        data: {
          ticketId: primary.id,
          authorUserId: user.id,
          direction: MessageDirection.INTERNAL,
          visibility: MessageVisibility.INTERNAL,
          bodyText: summaryText,
          bodyHtml: summaryHtml,
          sanitizedBodyHtml: summaryHtml,
          hasAttachments: false
        }
      });

      await tx.ticket.update({
        where: { id: primary.id },
        data: { updatedAt: now }
      });
    });

    await this.auditLogs.create({
      userId: user.id,
      entityType: "Ticket",
      entityId: primary.id,
      action: "ticket.merged",
      metadata: {
        primaryTicketNumber: primary.ticketNumber,
        mergedTicketIds: sourceTickets.map((ticket) => ticket.id),
        mergedTicketNumbers: sourceTickets.map((ticket) => ticket.ticketNumber),
        reason
      }
    });

    return this.getById(primary.id, user);
  }

  async updateWatchers(ticketId: string, userIds: string[], user: AuthenticatedUser) {
    const ticket = await this.ensureTicketExists(ticketId, user);
    const internalTicketId = ticket.id;
    const existing = await this.prisma.ticketWatcher.findMany({
      where: { ticketId: internalTicketId },
      select: { userId: true }
    });
    const existingIds = new Set(existing.map((watcher) => watcher.userId));
    const requestedIds = new Set(userIds);

    await Promise.all(
      [...requestedIds]
        .filter((userId) => !existingIds.has(userId))
        .map((userId) => this.addWatcherAndNotify(internalTicketId, userId, user.id, "Manual watcher", "You were added as a ticket watcher.", "internalNoteMention"))
    );
    await this.prisma.ticketWatcher.deleteMany({
      where: {
        ticketId: internalTicketId,
        userId: { in: [...existingIds].filter((userId) => !requestedIds.has(userId)) }
      }
    });

    return this.getById(ticketId, user);
  }

  async addExternalSpecialist(ticketId: string, input: AddTicketExternalSpecialistDto, user: AuthenticatedUser) {
    const ticket = await this.ensureTicketExists(ticketId, user);
    await this.externalSpecialists.ensure(input.externalSpecialistId, user.organizationId);
    await this.prisma.ticketExternalSpecialist.upsert({
      where: {
        ticketId_externalSpecialistId: {
          ticketId: ticket.id,
          externalSpecialistId: input.externalSpecialistId
        }
      },
      create: {
        ticketId: ticket.id,
        externalSpecialistId: input.externalSpecialistId,
        role: this.optionalTrim(input.role),
        createdByUserId: user.id
      },
      update: {
        role: this.optionalTrim(input.role)
      }
    });
    await this.auditLogs.create({
      userId: user.id,
      entityType: "Ticket",
      entityId: ticket.id,
      action: "ticket.external_specialist.assigned",
      metadata: { externalSpecialistId: input.externalSpecialistId }
    });
    return this.getById(ticketId, user);
  }

  async removeExternalSpecialist(ticketId: string, assignmentId: string, user: AuthenticatedUser) {
    const ticket = await this.ensureTicketExists(ticketId, user);
    const assignment = await this.prisma.ticketExternalSpecialist.findFirst({
      where: { id: assignmentId, ticketId: ticket.id }
    });
    if (!assignment) {
      throw new NotFoundException("External specialist assignment was not found.");
    }
    await this.prisma.ticketExternalSpecialist.delete({ where: { id: assignment.id } });
    await this.auditLogs.create({
      userId: user.id,
      entityType: "Ticket",
      entityId: ticket.id,
      action: "ticket.external_specialist.removed",
      metadata: { externalSpecialistId: assignment.externalSpecialistId }
    });
    return this.getById(ticketId, user);
  }

  async closeTicket(ticketId: string, user: AuthenticatedUser) {
    const ticket = await this.ensureTicketExists(ticketId, user);
    const internalTicketId = ticket.id;

    if (ticket.status !== TicketStatus.CLOSED) {
      if (this.ticketWorkflow) {
        await this.ticketWorkflow.transitionTicket({
          ticketId: internalTicketId,
          organizationId: user.organizationId,
          systemStatus: TicketStatus.CLOSED,
          userId: user.id,
          reason: "Close ticket"
        });
      } else {
        await this.prisma.ticket.update({
          where: { id: internalTicketId },
          data: {
            status: TicketStatus.CLOSED,
            closedAt: new Date(),
            updatedAt: new Date()
          }
        });
      }

      await this.auditLogs.create({
        userId: user.id,
        entityType: "Ticket",
        entityId: internalTicketId,
        action: "ticket.closed",
        metadata: { source: "reply_composer_action" }
      });
    }

    return this.getById(ticketId, user);
  }

  async createMessage(ticketId: string, input: CreateTicketMessageDto, user: AuthenticatedUser) {
    const ticket = await this.ensureTicketExists(ticketId, user);
    const internalTicketId = ticket.id;

    if (ticket.status === TicketStatus.MERGED) {
      throw new BadRequestException("This ticket was merged into another ticket. Reply from the primary ticket.");
    }

    const isInternal = input.visibility === "internal";
    const action = input.action ?? (isInternal ? "save_note" : "send");
    const sanitizedBodyHtml = input.bodyHtml ? this.htmlSanitizer.sanitize(input.bodyHtml) : null;
    const internalCcUsers = isInternal ? await this.resolveInternalCcUsers(input.ccUserIds ?? [], user.organizationId) : [];
    if (isInternal && (input.ccEmails?.length ?? 0) > 0) {
      throw new BadRequestException("Internal notes can only CC internal users.");
    }
    const explicitCcUsers = isInternal ? [] : await this.resolveInternalCcUsers(input.ccUserIds ?? [], user.organizationId);
    const explicitCcEmails = isInternal
      ? internalCcUsers.map((ccUser) => ccUser.email.toLowerCase())
      : await this.resolveCcEmails(input.ccEmails ?? [], input.ccUserIds ?? [], user.organizationId);
    const persistentParticipants = isInternal || input.includePersistentCc === false
      ? []
      : await this.prisma.ticketConversationParticipant.findMany({
          where: { ticketId: internalTicketId, isActive: true },
          select: { email: true, userId: true }
        });
    const ccEmails = isInternal
      ? explicitCcEmails
      : [...new Set([...explicitCcEmails, ...persistentParticipants.map((participant) => participant.email.trim().toLowerCase())])];
    const notifiedUserIds = isInternal ? internalCcUsers.map((ccUser) => ccUser.id) : [];
    const followUsers = await this.resolveInternalCcUsers(input.followUserIds ?? [], user.organizationId);
    const latestInboundMessage = isInternal
      ? null
      : await this.prisma.ticketMessage.findFirst({
          where: {
            ticketId: internalTicketId,
            direction: MessageDirection.INBOUND,
            visibility: MessageVisibility.PUBLIC,
            senderEmail: { not: null }
          },
          orderBy: { createdAt: "desc" }
        });
    let sendResult = null;
    const sendsPublicEmail = !isInternal && (action === "send" || action === "send_and_close");
    const requesterEmail = latestInboundMessage?.senderEmail?.trim().toLowerCase()
      || ticket.senderEmail?.trim().toLowerCase()
      || await this.resolveTicketContactEmail(ticket.contactId, user.organizationId);
    const deliveredCcEmails = requesterEmail ? ccEmails.filter((email) => email !== requesterEmail) : ccEmails;
    const deliveryAttemptedAt = sendsPublicEmail ? new Date() : null;
    if (sendsPublicEmail) {
      if (!requesterEmail) {
        throw new BadRequestException("A public reply requires a requester email address. Add a requester before sending.");
      }
      const hasProviderThread = Boolean(latestInboundMessage?.emailMessageId || latestInboundMessage?.emailInternetMessageId);
      try {
        sendResult = await this.mailDelivery.sendTicketReply({
          organizationId: user.organizationId,
          ticketId: internalTicketId,
          mailboxId: ticket.mailboxId,
          to: [requesterEmail],
          cc: deliveredCcEmails,
          subject: ticket.subject.startsWith("Re:")
            ? ticket.subject
            : hasProviderThread
              ? `Re: ${ticket.subject}`
              : `Re: [${ticket.ticketNumber}] ${ticket.subject}`,
          bodyHtml: sanitizedBodyHtml ?? `<p>${this.escapeHtml(input.bodyText).replace(/\n/g, "<br>")}</p>`,
          bodyText: input.bodyText,
          inReplyTo: latestInboundMessage?.emailInternetMessageId ?? latestInboundMessage?.emailMessageId ?? null,
          references: latestInboundMessage?.emailReferences ?? latestInboundMessage?.emailInternetMessageId ?? null,
          replyToProviderMessageId: latestInboundMessage?.emailMessageId ?? null,
          attachmentIds: input.attachmentIds
        });
      } catch (error) {
        await this.auditLogs.create({
          userId: user.id,
          entityType: "Ticket",
          entityId: internalTicketId,
          action: "ticket.reply_delivery_failed",
          metadata: {
            ticketNumber: ticket.ticketNumber,
            error: error instanceof Error ? error.message.slice(0, 500) : "Unknown delivery error"
          }
        });
        throw new ServiceUnavailableException("The email could not be delivered. No public reply was saved.");
      }
      if (!sendResult) {
        await this.auditLogs.create({
          userId: user.id,
          entityType: "Ticket",
          entityId: internalTicketId,
          action: "ticket.reply_delivery_skipped",
          metadata: { ticketNumber: ticket.ticketNumber, reason: "outbound_delivery_unavailable" }
        });
        throw new ServiceUnavailableException("Outbound email delivery is not enabled for this ticket mailbox.");
      }
    }

    const message = await this.prisma.ticketMessage.create({
      data: {
        ticketId: internalTicketId,
        authorUserId: user.id,
        direction: isInternal ? MessageDirection.INTERNAL : MessageDirection.OUTBOUND,
        visibility: isInternal ? MessageVisibility.INTERNAL : MessageVisibility.PUBLIC,
        bodyText: input.bodyText,
        bodyHtml: input.bodyHtml ?? null,
        sanitizedBodyHtml,
        emailMessageId: sendResult?.providerMessageId ?? null,
        emailInternetMessageId: sendResult?.internetMessageId ?? null,
        emailConversationId: sendResult?.conversationId ?? latestInboundMessage?.emailConversationId ?? null,
        ccEmails: deliveredCcEmails,
        notifiedUserIds,
        mailDeliveryStatus: sendsPublicEmail ? MailDeliveryStatus.ACCEPTED : MailDeliveryStatus.NOT_APPLICABLE,
        mailDeliveryAttemptedAt: deliveryAttemptedAt,
        mailDeliveryAcceptedAt: sendsPublicEmail ? new Date() : null,
        hasAttachments: Boolean(input.attachmentIds?.length)
      }
    });

    if (input.attachmentIds?.length) {
      await this.prisma.ticketAttachment.updateMany({
        where: {
          id: { in: input.attachmentIds },
          ticketId: internalTicketId,
          ticketMessageId: null,
          deletedAt: null
        },
        data: {
          ticketMessageId: message.id
        }
      });
    }

    if (!isInternal && input.persistCc && explicitCcEmails.length > 0) {
      await this.persistConversationParticipants(
        internalTicketId,
        explicitCcEmails.filter((email) => email !== requesterEmail),
        explicitCcUsers,
        user
      );
    }

    await this.prisma.ticket.update({
      where: { id: internalTicketId },
      data: {
        ...(isInternal
          ? { updatedAt: new Date() }
          : {
              lastTechnicianResponseAt: new Date(),
              firstResponseAt: ticket.firstResponseAt ?? new Date(),
              updatedAt: new Date()
            }),
        ...(!isInternal && action === "send" ? { status: TicketStatus.WAITING_ON_CUSTOMER, closedAt: null, resolvedAt: null } : {}),
        ...(action === "send_and_close" || action === "send_note_and_close" ? { status: TicketStatus.CLOSED, closedAt: new Date() } : {})
      }
    });
    if (!isInternal && action === "send") {
      await this.ticketWorkflow?.applyRules({
        ticketId: internalTicketId,
        organizationId: user.organizationId,
        trigger: TicketWorkflowTrigger.TECHNICIAN_REPLIED,
        userId: user.id
      });
    } else if (action === "send_and_close" || action === "send_note_and_close") {
      const closedStatus = await this.ticketWorkflow?.resolveTarget(user.organizationId, { systemStatus: TicketStatus.CLOSED });
      if (closedStatus) {
        await this.ticketWorkflow?.transitionTicket({
          ticketId: internalTicketId,
          organizationId: user.organizationId,
          statusDefinitionId: closedStatus.id,
          userId: user.id,
          reason: "Send and close"
        });
      }
    }

    await Promise.all(
      followUsers.map((followUser) =>
        this.addWatcher(internalTicketId, followUser.id, user.id, "Following ticket conversation")
      )
    );

    const shouldNotifyStaff = !isInternal || action === "send_note" || action === "send_note_and_close";
    if (notifiedUserIds.length) {
      await Promise.all(
        notifiedUserIds.map((userId) =>
          this.addWatcherAndNotify(
            internalTicketId,
            userId,
            user.id,
            "CC on internal note",
            "Internal note added",
            "internalNoteMention"
          )
        )
      );
    }
    if (shouldNotifyStaff) {
      const publicCcUserIds = isInternal
        ? []
        : [...new Set([...explicitCcUsers.map((ccUser) => ccUser.id), ...persistentParticipants.map((participant) => participant.userId).filter((userId): userId is string => Boolean(userId))])];
      await this.notifyTicketParticipants({
        ticketId: internalTicketId,
        createdById: user.id,
        reason: isInternal ? "Internal note added to an assigned ticket" : "Public reply added to an assigned ticket",
        title: isInternal ? "Internal note added" : "Ticket reply added",
        eventType: isInternal ? "internalNoteOnAssignedTicket" : "ticketReplyOnAssignedTicket",
        excludeUserIds: [user.id, ...notifiedUserIds, ...publicCcUserIds]
      });
    }

    await this.auditLogs.create({
      userId: user.id,
      entityType: "TicketMessage",
      entityId: message.id,
      action: isInternal ? "ticket.internal_note_created" : "ticket.reply_created",
      metadata: { ticketId: internalTicketId, attachmentCount: input.attachmentIds?.length ?? 0 }
    });

    return message;
  }

  private async findExistingTicketForInbound(input: CreateInboundEmailTicketInput) {
    const messageReferences = this.extractMessageReferences(input.references);
    if (input.inReplyTo?.trim()) {
      messageReferences.push(input.inReplyTo.trim());
    }

    const uniqueMessageReferences = [...new Set(messageReferences)];
    const ticketNumber = this.extractTicketNumber(`${input.subject}\n${input.bodyText ?? ""}`);
    const matchers: Prisma.TicketWhereInput[] = [];

    if (input.emailConversationId?.trim()) {
      matchers.push({
        messages: {
          some: {
            emailConversationId: input.emailConversationId.trim()
          }
        }
      });
    }

    if (uniqueMessageReferences.length > 0) {
      matchers.push({
        messages: {
          some: {
            emailInternetMessageId: { in: uniqueMessageReferences }
          }
        }
      });
    }

    if (ticketNumber) {
      matchers.push({ ticketNumber });
    }

    if (matchers.length === 0) {
      return null;
    }

    return this.prisma.ticket.findFirst({
      where: {
        organizationId: input.organizationId,
        deletedAt: null,
        OR: matchers
      },
      orderBy: { updatedAt: "desc" }
    });
  }

  private shouldReopenFromInbound(status: TicketStatus) {
    return status === TicketStatus.CLOSED || status === TicketStatus.RESOLVED || status === TicketStatus.CANCELLED;
  }

  private extractMessageReferences(value: string | null | undefined) {
    if (!value) {
      return [];
    }

    const references = new Set<string>();
    for (const match of value.match(/<[^>]+>/g) ?? []) {
      references.add(match.trim());
    }

    for (const token of value.split(/\s+/)) {
      const normalized = token.trim();
      if (normalized.includes("@")) {
        references.add(normalized);
      }
    }

    return [...references];
  }

  private extractTicketNumber(value: string) {
    return value.match(/\b[A-Z]{2,10}-\d{3,}\b/i)?.[0]?.toUpperCase() ?? null;
  }

  private async recordUnknownSenderDomain(
    organizationId: string,
    senderDomain: string | null,
    senderEmail: string,
    requester: Awaited<ReturnType<ContactsService["resolveRequesterFromEmail"]>>
  ) {
    if (requester || !senderDomain) {
      return;
    }

    await this.prisma.unmappedEmailDomain.upsert({
      where: {
        organizationId_domain: {
          organizationId,
          domain: senderDomain
        }
      },
      update: {
        lastSenderEmail: senderEmail,
        messageCount: { increment: 1 },
        lastSeenAt: new Date()
      },
      create: {
        organizationId,
        domain: senderDomain,
        firstSenderEmail: senderEmail,
        lastSenderEmail: senderEmail,
        messageCount: 1
      }
    });
  }

  private async ensureTicketExists(ticketId: string, user: AuthenticatedUser) {
    const ticket = await this.prisma.ticket.findFirst({
      where: this.ticketReferenceWhere(ticketId, user.organizationId)
    });

    if (!ticket) {
      throw new NotFoundException("Ticket was not found.");
    }

    return ticket;
  }

  private ticketReferenceWhere(ticketRef: string, organizationId: string): Prisma.TicketWhereInput {
    const normalized = ticketRef.trim();
    const matchers: Prisma.TicketWhereInput[] = [{ ticketNumber: normalized.toUpperCase() }];
    if (this.isUuid(normalized)) {
      matchers.push({ id: normalized });
    }

    return {
      organizationId,
      deletedAt: null,
      OR: matchers
    };
  }

  private isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private async validateAssignmentTargets(assignedUserIds: string[], assignedTeamId: string | null | undefined, organizationId: string) {
    if (assignedUserIds.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: assignedUserIds }, organizationId, deletedAt: null, isActive: true },
        select: { id: true }
      });
      if (users.length !== assignedUserIds.length) {
        throw new BadRequestException("One or more assigned technicians are not available.");
      }
    }

    if (assignedTeamId) {
      const team = await this.prisma.ticketTeam.findFirst({
        where: { id: assignedTeamId, organizationId, isActive: true },
        select: { id: true }
      });
      if (!team) {
        throw new BadRequestException("Assigned ticket team is not available.");
      }
    }
  }

  private normalizeAssignedUserIds(userIds: Array<string | null | undefined>) {
    return [...new Set(userIds.filter((userId): userId is string => Boolean(userId)))];
  }

  private async syncTicketAssignees(ticketId: string, assignedUserIds: string[], assignedById: string | null) {
    const current = await this.prisma.ticketAssignee.findMany({
      where: { ticketId },
      select: { userId: true }
    });
    const currentIds = new Set(current.map((assignment) => assignment.userId));
    const nextIds = new Set(assignedUserIds);

    await this.prisma.ticketAssignee.deleteMany({
      where: {
        ticketId,
        userId: { in: [...currentIds].filter((userId) => !nextIds.has(userId)) }
      }
    });

    const addedUserIds = [...nextIds].filter((userId) => !currentIds.has(userId));
    await Promise.all(
      addedUserIds
        .map((userId) =>
          this.prisma.ticketAssignee.create({
            data: {
              ticketId,
              userId,
              assignedById
            }
          })
        )
    );
    return addedUserIds;
  }

  private async resolveCcEmails(ccEmails: string[], ccUserIds: string[], organizationId: string) {
    const manualEmails = ccEmails.map((email) => email.trim().toLowerCase()).filter(Boolean);
    if (ccUserIds.length === 0) {
      return [...new Set(manualEmails)];
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(ccUserIds)] }, organizationId, deletedAt: null, isActive: true },
      select: { email: true }
    });

    return [...new Set([...manualEmails, ...users.map((user) => user.email.toLowerCase())])];
  }

  private async resolveInternalCcUsers(ccUserIds: string[], organizationId: string) {
    const uniqueUserIds = [...new Set(ccUserIds)];
    if (uniqueUserIds.length === 0) {
      return [];
    }

    return this.prisma.user.findMany({
      where: { id: { in: uniqueUserIds }, organizationId, deletedAt: null, isActive: true },
      select: { id: true, email: true, firstName: true, lastName: true }
    });
  }

  async removeConversationParticipant(ticketId: string, participantId: string, user: AuthenticatedUser) {
    const ticket = await this.ensureTicketExists(ticketId, user);
    const participant = await this.prisma.ticketConversationParticipant.findFirst({
      where: { id: participantId, ticketId: ticket.id, isActive: true },
      select: { id: true, email: true }
    });
    if (!participant) {
      throw new NotFoundException("Conversation participant was not found.");
    }

    await this.prisma.ticketConversationParticipant.update({
      where: { id: participant.id },
      data: { isActive: false, removedAt: new Date(), removedById: user.id }
    });
    await this.auditLogs.create({
      userId: user.id,
      entityType: "Ticket",
      entityId: ticket.id,
      action: "ticket.conversation_participant_removed",
      metadata: { email: participant.email }
    });
    return this.getById(ticketId, user);
  }

  async clearConversationParticipants(ticketId: string, user: AuthenticatedUser) {
    const ticket = await this.ensureTicketExists(ticketId, user);
    const participants = await this.prisma.ticketConversationParticipant.findMany({
      where: { ticketId: ticket.id, isActive: true },
      select: { email: true }
    });
    if (participants.length > 0) {
      await this.prisma.ticketConversationParticipant.updateMany({
        where: { ticketId: ticket.id, isActive: true },
        data: { isActive: false, removedAt: new Date(), removedById: user.id }
      });
      await this.auditLogs.create({
        userId: user.id,
        entityType: "Ticket",
        entityId: ticket.id,
        action: "ticket.conversation_participants_cleared",
        metadata: { emails: participants.map((participant) => participant.email) }
      });
    }
    return this.getById(ticketId, user);
  }

  private async persistConversationParticipants(
    ticketId: string,
    emails: string[],
    users: Array<{ id: string; email: string; firstName: string; lastName: string }>,
    actor: AuthenticatedUser
  ) {
    const normalizedEmails = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
    if (normalizedEmails.length === 0) {
      return;
    }
    const userByEmail = new Map(users.map((participant) => [participant.email.trim().toLowerCase(), participant]));
    const contacts = await this.prisma.contact.findMany({
      where: {
        email: { in: normalizedEmails, mode: "insensitive" },
        deletedAt: null,
        client: { organizationId: actor.organizationId }
      },
      select: { id: true, email: true, firstName: true, lastName: true }
    });
    const contactByEmail = new Map(contacts.map((contact) => [contact.email.trim().toLowerCase(), contact]));

    await Promise.all(normalizedEmails.map((email) => {
      const participantUser = userByEmail.get(email);
      const contact = contactByEmail.get(email);
      const displayName = participantUser
        ? `${participantUser.firstName} ${participantUser.lastName}`.trim()
        : contact
          ? `${contact.firstName} ${contact.lastName}`.trim()
          : null;
      return this.prisma.ticketConversationParticipant.upsert({
        where: { ticketId_email: { ticketId, email } },
        update: {
          userId: participantUser?.id ?? null,
          contactId: contact?.id ?? null,
          displayName,
          isActive: true,
          removedAt: null,
          removedById: null
        },
        create: {
          ticketId,
          userId: participantUser?.id ?? null,
          contactId: contact?.id ?? null,
          email,
          displayName,
          addedById: actor.id
        }
      });
    }));
    await this.auditLogs.create({
      userId: actor.id,
      entityType: "Ticket",
      entityId: ticketId,
      action: "ticket.conversation_participants_added",
      metadata: { emails: normalizedEmails }
    });
  }

  private async resolveTicketContactEmail(contactId: string | null, organizationId: string) {
    if (!contactId) {
      return null;
    }
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, deletedAt: null, client: { organizationId } },
      select: { email: true }
    });
    return contact?.email.trim().toLowerCase() ?? null;
  }

  private async shouldMarkWaitingOnTechnicianFromInbound(ticketId: string, status: TicketStatus) {
    const customerReplyStatuses: TicketStatus[] = [
      TicketStatus.NEW,
      TicketStatus.OPEN,
      TicketStatus.IN_PROGRESS,
      TicketStatus.WAITING_ON_CUSTOMER,
      TicketStatus.WAITING_ON_TECHNICIAN,
      TicketStatus.WAITING_ON_THIRD_PARTY,
      TicketStatus.REOPENED,
      TicketStatus.CLOSED,
      TicketStatus.RESOLVED,
      TicketStatus.CANCELLED
    ];

    if (!customerReplyStatuses.includes(status)) {
      return false;
    }

    const staffMessageCount = await this.prisma.ticketMessage.count({
      where: {
        ticketId,
        direction: MessageDirection.OUTBOUND,
        visibility: MessageVisibility.PUBLIC
      }
    });

    return staffMessageCount > 0;
  }

  private parsePage(value: string | undefined) {
    const parsed = Number(value ?? "1");
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
  }

  private async addWatcherAndNotify(
    ticketId: string,
    userId: string,
    createdById: string | null,
    reason: string,
    title: string,
    eventType: "ticketAssignedToMe" | "ticketReplyOnAssignedTicket" | "internalNoteOnAssignedTicket" | "internalNoteMention" | "ticketReopened" = "ticketAssignedToMe"
  ) {
    await this.addWatcher(ticketId, userId, createdById, reason);
    await this.notifications.notifyUser({
      userId,
      ticketId,
      title,
      body: reason,
      eventType
    });
  }

  private async addWatcher(ticketId: string, userId: string, createdById: string | null, reason: string) {
    await this.prisma.ticketWatcher.upsert({
      where: {
        ticketId_userId: {
          ticketId,
          userId
        }
      },
      update: {},
      create: {
        ticketId,
        userId,
        createdById,
        reason
      }
    });
  }

  private async notifyTicketParticipants(input: {
    ticketId: string;
    createdById: string | null;
    reason: string;
    title: string;
    eventType: "ticketAssignedToMe" | "ticketReplyOnAssignedTicket" | "internalNoteOnAssignedTicket" | "ticketReopened";
    excludeUserIds?: string[];
  }) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: input.ticketId },
      select: { assignedUserId: true, assignedTeamId: true, assignedGroupId: true }
    });
    if (!ticket) {
      return;
    }

    const [assignees, watchers, teamMembers, groupMembers] = await Promise.all([
      this.prisma.ticketAssignee.findMany({ where: { ticketId: input.ticketId }, select: { userId: true } }),
      this.prisma.ticketWatcher.findMany({ where: { ticketId: input.ticketId }, select: { userId: true } }),
      ticket.assignedTeamId
        ? this.prisma.ticketTeamMember.findMany({ where: { ticketTeamId: ticket.assignedTeamId }, select: { userId: true } })
        : Promise.resolve([]),
      ticket.assignedGroupId
        ? this.prisma.userGroup.findMany({ where: { groupId: ticket.assignedGroupId }, select: { userId: true } })
        : Promise.resolve([])
    ]);
    const excluded = new Set(input.excludeUserIds ?? []);
    const recipientIds = new Set<string>([
      ...(ticket.assignedUserId ? [ticket.assignedUserId] : []),
      ...assignees.map((item) => item.userId),
      ...watchers.map((item) => item.userId),
      ...teamMembers.map((item) => item.userId),
      ...groupMembers.map((item) => item.userId)
    ]);

    await Promise.all(
      [...recipientIds]
        .filter((userId) => !excluded.has(userId))
        .map((userId) => this.addWatcherAndNotify(
          input.ticketId,
          userId,
          input.createdById,
          input.reason,
          input.title,
          input.eventType
        ))
    );
  }

  private async notifyGroupMembers(ticketId: string, groupId: string, createdById: string | null, reason: string, title: string) {
    const members = await this.prisma.userGroup.findMany({
      where: { groupId },
      select: { userId: true }
    });

    await Promise.all(members.map((member) => this.addWatcherAndNotify(ticketId, member.userId, createdById, reason, title)));
  }

  private async notifyTeamMembers(ticketId: string, teamId: string, createdById: string | null, reason: string, title: string) {
    const members = await this.prisma.ticketTeamMember.findMany({
      where: { ticketTeamId: teamId },
      select: { userId: true }
    });

    await Promise.all(
      members.map(async (member) => {
        await this.prisma.ticketWatcher.upsert({
          where: {
            ticketId_userId: {
              ticketId,
              userId: member.userId
            }
          },
          update: {},
          create: {
            ticketId,
            userId: member.userId,
            createdById,
            reason
          }
        });
        await this.notifications.notifyUser({
          userId: member.userId,
          ticketId,
          title,
          body: reason,
          eventType: reason.toLowerCase().includes("assignment") ? "ticketAssignedToMyTeam" : "ticketReplyOnAssignedTicket"
        });
      })
    );
  }

  private async nextTicketNumber(tx: Prisma.TransactionClient) {
    const sequence = await tx.ticketSequence.upsert({
      where: { key: "ticket" },
      update: { currentValue: { increment: 1 } },
      create: { key: "ticket", prefix: "AIT", currentValue: 100001 }
    });

    return `${sequence.prefix}-${sequence.currentValue}`;
  }

  private extractDomain(emailAddress: string): string | null {
    const atIndex = emailAddress.lastIndexOf("@");
    if (atIndex === -1 || atIndex === emailAddress.length - 1) {
      return null;
    }

    return emailAddress.slice(atIndex + 1).trim().toLowerCase().replace(/\.$/, "") || null;
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  private buildTicketListWhere(user: AuthenticatedUser, query: ListTicketsQueryDto): Prisma.TicketWhereInput {
    const filters: Prisma.TicketWhereInput[] = [];
    const search = query.search?.trim();
    const requester = query.requester?.trim();

    if (search) {
      filters.push({
        OR: [
          { ticketNumber: { contains: search, mode: "insensitive" } },
          { subject: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
          { senderEmail: { contains: search, mode: "insensitive" } },
          { senderDomain: { contains: search, mode: "insensitive" } },
          { client: { name: { contains: search, mode: "insensitive" } } },
          { contact: { email: { contains: search, mode: "insensitive" } } },
          { contact: { firstName: { contains: search, mode: "insensitive" } } },
          { contact: { lastName: { contains: search, mode: "insensitive" } } },
          { messages: { some: { bodyText: { contains: search, mode: "insensitive" } } } }
        ]
      });
    }

    if (query.clientId) {
      filters.push({ clientId: query.clientId });
    }

    if (query.scope === "assigned_to_me") {
      filters.push({
        OR: [{ assignedUserId: user.id }, { assignees: { some: { userId: user.id } } }]
      });
    }

    if (query.scope === "my_teams") {
      filters.push({ assignedTeam: { members: { some: { userId: user.id } } } });
    }

    if (query.scope === "unassigned") {
      filters.push({ assignedUserId: null, assignedTeamId: null, assignedGroupId: null });
    }

    if (query.assignedUserId) {
      filters.push({
        OR: [{ assignedUserId: query.assignedUserId }, { assignees: { some: { userId: query.assignedUserId } } }]
      });
    }

    if (query.assignedTeamId) {
      filters.push({ assignedTeamId: query.assignedTeamId });
    }

    if (query.externalSpecialistId) {
      filters.push({ externalSpecialists: { some: { externalSpecialistId: query.externalSpecialistId } } });
    }

    if (requester) {
      filters.push({
        OR: [
          { senderEmail: { contains: requester, mode: "insensitive" } },
          { contact: { email: { contains: requester, mode: "insensitive" } } },
          { contact: { firstName: { contains: requester, mode: "insensitive" } } },
          { contact: { lastName: { contains: requester, mode: "insensitive" } } }
        ]
      });
    }

    const selectedStatusDefinitionIds = this.normalizeUuidList(query.statusDefinitionIds);
    const selectedStatuses = this.normalizeTicketStatuses(query.statuses);
    if (selectedStatusDefinitionIds.length > 0) {
      filters.push({ statusDefinitionId: { in: selectedStatusDefinitionIds } });
    } else if (selectedStatuses.length > 0) {
      filters.push({ status: { in: selectedStatuses } });
    } else if (query.status) {
      filters.push({ status: query.status });
    } else {
      filters.push({ status: { not: TicketStatus.MERGED } });
    }

    if (query.priority) {
      filters.push({ priority: query.priority });
    }

    if (query.source) {
      filters.push({ source: query.source });
    }

    return {
      organizationId: user.organizationId,
      deletedAt: query.deletedScope === "deleted" ? { not: null } : null,
      ...(filters.length ? { AND: filters } : {})
    };
  }

  private normalizeTicketStatuses(value?: string): TicketStatus[] {
    if (!value?.trim()) {
      return [];
    }

    const allowed = new Set(Object.values(TicketStatus));
    return [
      ...new Set(
        value
          .split(",")
          .map((status) => status.trim())
          .filter((status): status is TicketStatus => allowed.has(status as TicketStatus))
      )
    ];
  }

  private normalizeUuidList(value?: string) {
    if (!value?.trim()) return [];
    return [...new Set(value.split(",").map((item) => item.trim()).filter((item) => this.isUuid(item)))];
  }

  private optionalTrim(value: string | null | undefined) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }
}
