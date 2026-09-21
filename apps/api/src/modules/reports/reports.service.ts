import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { REPORT_COLUMNS, REPORT_MAX_EXCLUSIONS, ReportKind } from "@avidity/shared/dist";
import { plainToInstance } from "class-transformer";
import { isUUID, validateSync } from "class-validator";
import sharp from "sharp";
import { LocalFileStorageProvider } from "../file-storage/providers/local-file-storage.provider";
import { renderReport, selectedColumns, reportSections, ReportDocument } from "./report-renderer";
import { localDay, nextReportRun, periodKey, reportRange, ScheduleTiming, shiftDay, validZone } from "./report-time";
import { EventServiceRequestStatus, EventServiceTaskStatus, Prisma, ProjectDecisionStatus, ProjectHealth, ProjectMilestoneStatus, ProjectStatus, TicketPriority, TicketSource, TicketStatus } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { MailDeliveryService } from "../mailboxes/mail-delivery.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateReportDefinitionDto, CreateReportScheduleDto, SendReportDto, UpdateReportDefinitionDto, UpdateReportScheduleDto } from "./dto/report-definition.dto";
import { EventServiceReportExportQueryDto, EventServiceReportQueryDto, ReportPresentationDto, TicketReportExportQueryDto, TicketReportQueryDto } from "./dto/ticket-report-query.dto";

const ACTIVE_STATUSES: TicketStatus[] = [
  TicketStatus.NEW,
  TicketStatus.OPEN,
  TicketStatus.IN_PROGRESS,
  TicketStatus.WAITING_ON_CUSTOMER,
  TicketStatus.WAITING_ON_TECHNICIAN,
  TicketStatus.WAITING_ON_THIRD_PARTY,
  TicketStatus.REOPENED
];

type ReportTicket = Prisma.TicketGetPayload<{
  select: ReturnType<ReportsService["ticketSelect"]>;
}>;
type ReportEventServiceRequest = Prisma.EventServiceRequestGetPayload<{
  select: ReturnType<ReportsService["eventServiceSelect"]>;
}>;

type ReportFormat = "csv" | "xlsx" | "pdf";
type ReportFilters = Partial<TicketReportQueryDto> & { statuses?: string | string[] };
type EventReportFilters = Partial<EventServiceReportQueryDto> & { statuses?: string | string[] };
type GeneratedReport = {
  filename: string;
  contentType: string;
  body: string | Buffer;
  format: ReportFormat;
  result: Awaited<ReturnType<ReportsService["ticketSummary"]>> | Awaited<ReturnType<ReportsService["eventServiceSummary"]>> | Awaited<ReturnType<ReportsService["executiveProjectSummary"]>>;
};
type TicketSummaryOptions = { detailMode?: "paged" | "all" };
type EventSummaryOptions = { detailMode?: "paged" | "all" };

@Injectable()
export class ReportsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReportsService.name);
  private scheduleTimer?: NodeJS.Timeout;
  private schedulesRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailDelivery: MailDeliveryService,
    private readonly brandingStorage: LocalFileStorageProvider
  ) {}

  onModuleInit() {
    this.scheduleTimer = setInterval(() => {
      void this.runDueSchedules().catch((error: unknown) => this.logger.error(error instanceof Error ? error.message : "Report scheduler failed."));
    }, 60_000);
  }

  onModuleDestroy() {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
    }
  }

  async listDefinitions(user: AuthenticatedUser, reportType = "ticket-report") {
    const definitions = await this.prisma.reportDefinition.findMany({
      where: { organizationId: user.organizationId, reportType, OR: [{ isShared: true }, { createdById: user.id }] },
      select: {
        id: true,
        name: true,
        description: true,
        reportType: true,
        filters: true,
        isShared: true,
        createdById: true,
        createdAt: true,
        updatedAt: true,
        createdBy: { select: { firstName: true, lastName: true } }
      },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }]
    });

    return definitions.map((definition) => ({
      ...definition,
      createdBy: definition.createdBy ? `${definition.createdBy.firstName} ${definition.createdBy.lastName}` : null
    }));
  }

  listTemplates(reportType = "ticket-report") {
    if (reportType === "project-executive-report") {
      return [{ id: "project-executive-review", name: "Executive Project Review", description: "Delivery health, overdue milestones, and decisions that need leadership attention.", filters: {} }];
    }
    if (reportType === "event-service-report") {
      return [
        {
          id: "event-operational-summary",
          name: "Event Operational Summary",
          description: "Event request volume, service mix, task workload, and completion trends.",
          filters: { groupBy: "month" }
        },
        {
          id: "event-service-workload",
          name: "Service Workload",
          description: "Requests grouped by requested services and assigned specialists.",
          filters: { groupBy: "week" }
        },
        {
          id: "event-completion-review",
          name: "Completion Review",
          description: "Completed and cancelled event requests for closeout review.",
          filters: {
            groupBy: "month",
            statuses: [EventServiceRequestStatus.COMPLETED, EventServiceRequestStatus.CANCELLED]
          }
        }
      ];
    }

    return [
      {
        id: "executive-summary",
        name: "Executive Summary",
        description: "High-level operational summary for management.",
        filters: { groupBy: "week", estimateMode: "none" }
      },
      {
        id: "client-report",
        name: "Client Report",
        description: "Client-focused activity, status, workload, and estimate view.",
        filters: { groupBy: "month", estimateMode: "none" }
      },
      {
        id: "technician-productivity",
        name: "Technician Workload",
        description: "Workload by assigned technician and operational team.",
        filters: { groupBy: "week", estimateMode: "none" }
      },
      {
        id: "aging-tickets",
        name: "Active Tickets",
        description: "Active tickets and tickets without recent closure.",
        filters: {
          groupBy: "day",
          statuses: ACTIVE_STATUSES,
          estimateMode: "none"
        }
      },
      {
        id: "billing-estimate",
        name: "Closed / Resolved Tickets",
        description: "Closed/resolved tickets with optional per-ticket value.",
        filters: {
          groupBy: "month",
          statuses: [TicketStatus.CLOSED, TicketStatus.RESOLVED],
          estimateMode: "none"
        }
      }
    ];
  }

  async listExportHistory(user: AuthenticatedUser, reportType = "ticket-report") {
    const exports = await this.prisma.reportExport.findMany({
      where: {
        reportType,
        organizationId: user.organizationId,
        requestedById: user.id
      },
      select: {
        id: true,
        reportType: true,
        format: true,
        recipientEmail: true,
        deliveryStatus: true,
        errorMessage: true,
        createdAt: true,
        definition: { select: { name: true } },
        requestedBy: { select: { firstName: true, lastName: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 50
    });

    return exports.map((item) => ({
      ...item,
      definitionName: item.definition?.name ?? null,
      requestedBy: item.requestedBy ? `${item.requestedBy.firstName} ${item.requestedBy.lastName}` : null,
      definition: undefined
    }));
  }

  async createDefinition(user: AuthenticatedUser, input: CreateReportDefinitionDto) {
    try {
      return await this.audited(user, "createDefinition", (db) => db.reportDefinition.create({
        data: {
          organizationId: user.organizationId,
          createdById: user.id,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          reportType: input.reportType?.trim() || "ticket-report",
          filters: this.validateFilters(input.reportType ?? "ticket-report", input.filters) as Prisma.InputJsonValue,
          isShared: input.isShared ?? false
        }
      }));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("A report with this name already exists.");
      }
      throw error;
    }
  }

  async updateDefinition(user: AuthenticatedUser, definitionId: string, input: UpdateReportDefinitionDto) {
    const existing = await this.ensureDefinitionAccess(user, definitionId);
    try {
      return await this.audited(user, "updateDefinition", (db) => db.reportDefinition.update({
        where: { id: definitionId },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined ? { description: input.description.trim() || null } : {}),
          ...(input.filters !== undefined ? { filters: this.validateFilters(existing.reportType, input.filters) as Prisma.InputJsonValue } : {}),
          ...(input.isShared !== undefined ? { isShared: input.isShared } : {})
        }
      }));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("A report with this name already exists.");
      }
      throw error;
    }
  }

  async deleteDefinition(user: AuthenticatedUser, definitionId: string) {
    await this.ensureDefinitionAccess(user, definitionId);
    await this.audited(user, "deleteDefinition", (db) => db.reportDefinition.delete({ where: { id: definitionId } }));
    return { deleted: true };
  }

  async listSchedules(user: AuthenticatedUser, reportType = "ticket-report") {
    return this.prisma.reportSchedule.findMany({
      where: {
        organizationId: user.organizationId,
        createdById: user.id,
        definition: { reportType, OR: [{ isShared: true }, { createdById: user.id }] }
      },
      include: {
        definition: { select: { name: true } },
        createdBy: { select: { firstName: true, lastName: true } }
      },
      orderBy: [{ isActive: "desc" }, { nextRunAt: "asc" }, { name: "asc" }]
    });
  }

  async createSchedule(user: AuthenticatedUser, input: CreateReportScheduleDto) {
    const definition = await this.ensureDefinitionAccess(user, input.definitionId);
    const frequency = input.frequency ?? "weekly";
    const timing = input.timing ?? await this.defaultTiming(user.organizationId);
    const nextRun = nextReportRun(frequency, timing);
    this.assertSchedulePermission(user, definition.reportType);
    return await this.audited(user, "createSchedule", (db) => db.reportSchedule.create({
      data: {
        organizationId: user.organizationId,
        definitionId: definition.id,
        createdById: user.id,
        name: input.name.trim(),
        frequency,
        timing,
        format: input.format ?? "pdf",
        recipientEmails: this.normalizeEmails(input.recipientEmails),
        isActive: input.isActive ?? true,
        nextRunAt: input.isActive === false ? null : nextRun
      }
    }));
  }

  async updateSchedule(user: AuthenticatedUser, scheduleId: string, input: UpdateReportScheduleDto) {
    const schedule = await this.ensureScheduleAccess(user, scheduleId);
    const frequency = input.frequency ?? schedule.frequency;
    const isActive = input.isActive ?? schedule.isActive;
    const definition = await this.ensureDefinitionAccess(user, schedule.definitionId);
    this.assertSchedulePermission(user, definition.reportType);
    const timing = input.timing ?? schedule.timing as ScheduleTiming | null ?? await this.defaultTiming(user.organizationId, schedule.nextRunAt ?? schedule.lastRunAt);
    nextReportRun(frequency, timing);
    return await this.audited(user, "updateSchedule", (db) => db.reportSchedule.update({
      where: { id: schedule.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.frequency !== undefined ? { frequency } : {}),
        ...(input.format !== undefined ? { format: input.format } : {}),
        ...(input.recipientEmails !== undefined ? { recipientEmails: this.normalizeEmails(input.recipientEmails) } : {}),
        ...(input.isActive !== undefined ? { isActive } : {}),
        timing,
        nextRunAt: isActive ? nextReportRun(frequency, timing) : null
      }
    }));
  }

  async deleteSchedule(user: AuthenticatedUser, scheduleId: string) {
    const schedule = await this.ensureScheduleAccess(user, scheduleId);
    await this.audited(user, "deleteSchedule", (db) => db.reportSchedule.delete({ where: { id: schedule.id } }));
    return { deleted: true };
  }

  ticketSummary(user: AuthenticatedUser, query: TicketReportQueryDto, options: TicketSummaryOptions = {}) {
    this.validatePresentation("ticket-report", query);
    return this.prisma.$transaction((db) => this.ticketSnapshot(user, query, options, db), { isolationLevel: "RepeatableRead", timeout: 60_000 });
  }
  eventServiceSummary(user: AuthenticatedUser, query: EventServiceReportQueryDto, options: EventSummaryOptions = {}) {
    this.validatePresentation("event-service-report", query);
    return this.prisma.$transaction((db) => this.eventSnapshot(user, query, options, db), { isolationLevel: "RepeatableRead", timeout: 60_000 });
  }

  private async ticketSnapshot(user: AuthenticatedUser, query: TicketReportQueryDto, options: TicketSummaryOptions = {}, db: Prisma.TransactionClient = this.prisma) {
    const settings = await db.systemSetting.findUnique({ where: { organizationId: user.organizationId }, select: { defaultTimezone: true } });
    const range = reportRange(query, query.timeZone ?? settings?.defaultTimezone ?? "UTC");
    const where = this.buildTicketWhere(user, query, range);
    const valuePerTicket = this.resolveValuePerTicket(query);
    if (query.estimateMode === "perTicket" && await db.qcReview.count({ where: { organizationId: user.organizationId, billingState: "HELD", ticket: where } })) {
      throw new ConflictException("This report includes work on a QC billing hold. Release the hold or narrow the report before generating a financial estimate.");
    }

    const [tickets, clients, users, teams] = await Promise.all([
      this.ticketRecords(db, where),
      db.client.findMany({
        where: { organizationId: user.organizationId, deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: "asc" }
      }),
      db.user.findMany({
        where: { organizationId: user.organizationId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }]
      }),
      db.ticketTeam.findMany({
        where: { organizationId: user.organizationId },
        select: { id: true, name: true },
        orderBy: { name: "asc" }
      })
    ]);

    const activeCount = tickets.filter((ticket) => ACTIVE_STATUSES.includes(ticket.status)).length;
    const closedCount = tickets.filter((ticket) => ticket.status === TicketStatus.CLOSED).length;
    const resolvedCount = tickets.filter((ticket) => ticket.status === TicketStatus.RESOLVED).length;
    const unassignedCount = tickets.filter((ticket) => !ticket.assignedUserId && !ticket.assignedTeamId && ticket.assignees.length === 0).length;
    const withAttachments = tickets.filter((ticket) => ticket._count.attachments > 0).length;
    const estimatedTotal = valuePerTicket !== null ? tickets.length * valuePerTicket : null;
    const totalMatched = tickets.length;
    const detailPage = this.resolveDetailPage(query, totalMatched, options);
    // Reuse the complete metadata snapshot: computed/display columns must sort
    // globally before pagination, not by an unrelated relation or enum ordinal.
    const ordered = this.sortRows(tickets.map((ticket) => this.toDetailRow(ticket, valuePerTicket)), "ticket-report", query);
    const detailRows = options.detailMode === "all" ? ordered : ordered.slice(detailPage.offset, detailPage.offset + detailPage.pageSize);
    const statusDefinitions = await db.ticketStatusDefinition.findMany({ where: { organizationId: user.organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } });

    return {
      generatedAt: new Date().toISOString(),
      filters: {
        startDate: range.startDay,
        endDate: range.endDay,
        timeZone: range.timeZone,
        dateBasis: query.dateBasis ?? "createdAt",
        period: query.period ?? "custom",
        currency: query.currency ?? null,
        groupBy: query.groupBy ?? "day",
        estimateMode: query.estimateMode ?? "none",
        valuePerTicket,
        page: detailPage.page,
        pageSize: detailPage.pageSize
      },
      options: {
        statusDefinitions,
        clients,
        users: users.map((item) => ({ id: item.id, name: `${item.firstName} ${item.lastName}` })),
        teams,
        statuses: Object.values(TicketStatus),
        priorities: Object.values(TicketPriority),
        sources: Object.values(TicketSource)
      },
      summary: {
        totalTickets: tickets.length,
        activeTickets: activeCount,
        closedTickets: closedCount,
        resolvedTickets: resolvedCount,
        unassignedTickets: unassignedCount,
        highPriorityTickets: tickets.filter((ticket) => ([TicketPriority.HIGH, TicketPriority.URGENT, TicketPriority.CRITICAL] as TicketPriority[]).includes(ticket.priority)).length,
        withAttachments,
        withoutAttachments: tickets.length - withAttachments,
        estimatedTotal
      },
      activity: this.buildActivity(tickets, range, query.groupBy ?? "day"),
      byStatus: this.groupBy(tickets, (ticket) => ticket.statusDefinition?.name ?? this.label(ticket.status)),
      byPriority: this.groupBy(tickets, (ticket) => ticket.priority),
      bySource: this.groupBy(tickets, (ticket) => ticket.source),
      byClient: this.groupEntities(tickets.map((ticket) => ({ id: ticket.client?.id ?? "unmapped", label: ticket.client?.name ?? "Unmapped / no client" }))),
      byTechnician: this.groupEntities(tickets.flatMap((ticket) => this.ticketPeople(ticket))),
      byTeam: this.groupBy(tickets, (ticket) => ticket.assignedTeam?.name ?? "No team"),
      detail: detailRows,
      detailLimit: detailPage.pageSize,
      page: detailPage.page,
      pageSize: detailPage.pageSize,
      totalPages: detailPage.totalPages,
      totalMatched
    };
  }

  private async eventSnapshot(user: AuthenticatedUser, query: EventServiceReportQueryDto, options: EventSummaryOptions = {}, db: Prisma.TransactionClient = this.prisma) {
    const settings = await db.systemSetting.findUnique({ where: { organizationId: user.organizationId }, select: { defaultTimezone: true } });
    const range = reportRange(query, query.timeZone ?? settings?.defaultTimezone ?? "UTC");
    const where = this.buildEventServiceWhere(user, query, range);

    const [requests, clients, users, services] = await Promise.all([
      this.eventRecords(db, where),
      db.client.findMany({
        where: { organizationId: user.organizationId, deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: "asc" }
      }),
      db.user.findMany({
        where: { organizationId: user.organizationId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }]
      }),
      db.eventServiceService.findMany({
        where: { organizationId: user.organizationId },
        select: { id: true, name: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
      })
    ]);

    const closedTaskStatuses: EventServiceTaskStatus[] = [EventServiceTaskStatus.DONE, EventServiceTaskStatus.CANCELLED];
    const totalTasks = requests.reduce((total, request) => total + request.tasks.length, 0);
    const completedTasks = requests.reduce((total, request) => total + request.tasks.filter((task) => task.status === EventServiceTaskStatus.DONE).length, 0);
    const openTasks = requests.reduce((total, request) => total + request.tasks.filter((task) => !closedTaskStatuses.includes(task.status)).length, 0);
    const assignedRequests = requests.filter((request) => request.assignees.length > 0 || request.tasks.some((task) => task.assignedUserId)).length;
    const totalMatched = requests.length;
    const detailPage = this.resolveDetailPage(query, totalMatched, options);
    const ordered = this.sortRows(requests.map((request) => this.toEventDetailRow(request)), "event-service-report", query);
    const detailRows = options.detailMode === "all" ? ordered : ordered.slice(detailPage.offset, detailPage.offset + detailPage.pageSize);

    return {
      generatedAt: new Date().toISOString(),
      filters: {
        startDate: range.startDay,
        endDate: range.endDay,
        timeZone: range.timeZone,
        dateBasis: query.dateBasis ?? "createdAt",
        period: query.period ?? "custom",
        currency: query.currency ?? null,
        groupBy: query.groupBy ?? "day",
        page: detailPage.page,
        pageSize: detailPage.pageSize
      },
      options: {
        clients,
        users: users.map((item) => ({ id: item.id, name: `${item.firstName} ${item.lastName}` })),
        services,
        statuses: Object.values(EventServiceRequestStatus),
        priorities: Object.values(TicketPriority)
      },
      summary: {
        totalRequests: requests.length,
        newRequests: requests.filter((request) => request.status === EventServiceRequestStatus.NEW).length,
        assignedRequests,
        completedRequests: requests.filter((request) => request.status === EventServiceRequestStatus.COMPLETED).length,
        cancelledRequests: requests.filter((request) => request.status === EventServiceRequestStatus.CANCELLED).length,
        totalTasks,
        openTasks,
        completedTasks
      },
      activity: this.buildEventActivity(requests, range, query.groupBy ?? "day"),
      byStatus: this.groupEventsBy(requests, (request) => this.label(request.status)),
      byPriority: this.groupEventsBy(requests, (request) => request.priority),
      byService: this.groupEventsBy(requests.flatMap((request) => request.services.map((item) => item.service.name))),
      byClient: this.groupEntities(requests.map((request) => ({ id: request.client?.id ?? "unmapped", label: request.client?.name ?? "Unmapped / no client" }))),
      byTechnician: this.groupEntities(requests.flatMap((request) => {
        const people = new Map([...request.assignees.map((a) => a.user), ...request.tasks.flatMap((t) => t.assignedUser ? [t.assignedUser] : [])].map((p) => [p.id, { id: p.id, label: `${p.firstName} ${p.lastName}`, disambiguator: p.email }]));
        return people.size ? [...people.values()] : [{ id: "unassigned", label: "Unassigned" }];
      })),
      byTaskStatus: this.groupEventsBy(requests.flatMap((request) => request.tasks.map((task) => task.status))),
      detail: detailRows,
      detailLimit: detailPage.pageSize,
      page: detailPage.page,
      pageSize: detailPage.pageSize,
      totalPages: detailPage.totalPages,
      totalMatched
    };
  }

  async executiveProjectSummary(user: AuthenticatedUser, query: ReportPresentationDto = {}) {
    this.validatePresentation("project-executive-report", query);
    const now = new Date();
    const projects = await this.prisma.project.findMany({
      where: { organizationId: user.organizationId, deletedAt: null, ...(query.excludedIds ? { id: { notIn: this.exclusions(query) } } : {}) },
      select: {
        id: true, name: true, status: true, health: true, targetDate: true, completedAt: true,
        client: { select: { name: true } }, owner: { select: { firstName: true, lastName: true } },
        milestones: { select: { status: true, dueAt: true } },
        decisions: { where: { status: { notIn: [ProjectDecisionStatus.RESOLVED, ProjectDecisionStatus.CANCELLED] } }, select: { title: true, dueAt: true, owner: { select: { firstName: true, lastName: true } } } }
      }, orderBy: [{ targetDate: "asc" }, { updatedAt: "desc" }]
    });
    const active = projects.filter((project) => project.status !== ProjectStatus.COMPLETED && project.status !== ProjectStatus.CANCELLED);
    const detail = active.map((project) => {
      const overdueMilestones = project.milestones.filter((milestone) => milestone.status !== ProjectMilestoneStatus.COMPLETED && milestone.dueAt && milestone.dueAt < now).length;
      const overdueDecisions = project.decisions.filter((decision) => decision.dueAt && decision.dueAt < now).length;
      const unassignedDecisions = project.decisions.filter((decision) => !decision.owner).length;
      const overdueTarget = Boolean(project.targetDate && project.targetDate < now);
      const risk = project.health !== ProjectHealth.ON_TRACK || overdueTarget || overdueMilestones > 0 || overdueDecisions > 0 || unassignedDecisions > 0;
      return { projectId: project.id, projectName: project.name, clientName: project.client?.name ?? "Internal", owner: project.owner ? `${project.owner.firstName} ${project.owner.lastName}` : "Unassigned", status: project.status, health: project.health, targetDate: project.targetDate, overdueTarget, overdueMilestones, openDecisions: project.decisions.length, overdueDecisions, unassignedDecisions, risk };
    });
    return {
      generatedAt: now,
      summary: { activeProjects: active.length, atRiskProjects: detail.filter((project) => project.risk).length, onTrackProjects: detail.filter((project) => !project.risk).length, overdueDecisions: detail.reduce((sum, project) => sum + project.overdueDecisions, 0), unassignedDecisions: detail.reduce((sum, project) => sum + project.unassignedDecisions, 0), overdueMilestones: detail.reduce((sum, project) => sum + project.overdueMilestones, 0), completedProjects: projects.filter((project) => project.status === ProjectStatus.COMPLETED).length },
      byHealth: [ProjectHealth.ON_TRACK, ProjectHealth.AT_RISK, ProjectHealth.OFF_TRACK].map((health) => ({ label: health, count: active.filter((project) => project.health === health).length })),
      detail: query.sortBy ? this.sortRows(detail, "project-executive-report", query) : detail.sort((left, right) => Number(right.risk) - Number(left.risk) || (left.targetDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (right.targetDate?.getTime() ?? Number.MAX_SAFE_INTEGER))
    };
  }

  async exportTickets(user: AuthenticatedUser, query: TicketReportExportQueryDto) {
    const format = query.format ?? "csv";
    const report = await this.generateTicketsReport(user, query, format);
    await this.logReportExport(user, query, format, "generated", undefined, undefined, undefined, "ticket-report");
    return report;
  }

  async exportEventServices(user: AuthenticatedUser, query: EventServiceReportExportQueryDto) {
    const format = query.format ?? "csv";
    const report = await this.generateEventServiceReport(user, query, format);
    await this.logReportExport(user, query, format, "generated", undefined, undefined, undefined, "event-service-report");
    return report;
  }

  async exportExecutiveProjects(user: AuthenticatedUser, query: ReportPresentationDto & { format?: ReportFormat }) {
    const format = query.format ?? "csv";
    const report = await this.generateExecutiveProjectReport(user, format, query);
    await this.logReportExport(user, query, format, "generated", undefined, undefined, undefined, "project-executive-report");
    return report;
  }

  sendTicketsReport(user: AuthenticatedUser, query: TicketReportExportQueryDto, input: SendReportDto, definitionId?: string) {
    return this.deliverReport(user, "ticket-report", query, input, definitionId);
  }
  sendEventServicesReport(user: AuthenticatedUser, query: EventServiceReportExportQueryDto, input: SendReportDto, definitionId?: string) {
    return this.deliverReport(user, "event-service-report", query, input, definitionId);
  }
  sendExecutiveProjects(user: AuthenticatedUser, query: ReportPresentationDto & { format?: ReportFormat }, input: SendReportDto, definitionId?: string) {
    return this.deliverReport(user, "project-executive-report", query, input, definitionId);
  }
  private async deliverReport(user: AuthenticatedUser, kind: ReportKind, query: TicketReportExportQueryDto | EventServiceReportExportQueryDto, input: SendReportDto, definitionId?: string) {
    const format = input.format ?? query.format ?? "pdf";
    const recipients = this.normalizeEmails(input.recipientEmails);
    if (!recipients.length) throw new BadRequestException("At least one recipient email is required.");
    let accepted = false;
    try {
      const report = kind === "ticket-report" ? await this.generateTicketsReport(user, query, format) : kind === "event-service-report" ? await this.generateEventServiceReport(user, query, format) : await this.generateExecutiveProjectReport(user, format, query);
      const message = input.message?.trim() || "Attached is the requested report.";
      const delivery = await this.mailDelivery.sendTicketReply({ organizationId: user.organizationId, to: recipients, subject: input.subject?.trim() || query.title?.trim() || report.filename, bodyText: message, bodyHtml: `<p>${this.escapeHtml(message).replace(/\n/g, "<br />")}</p>`, rawAttachments: [{ originalFilename: report.filename, mimeType: report.contentType, sizeBytes: Buffer.byteLength(report.body), contentBytes: Buffer.isBuffer(report.body) ? report.body : Buffer.from(report.body), isInline: false }] });
      if (!delivery) throw new ConflictException("Outbound delivery is disabled. No report email was sent.");
      accepted = true;
      const status = delivery.providerMessageId.startsWith("mock-") ? "simulated" : "accepted";
      await Promise.all(recipients.map((recipient) => this.logReportExport(user, query, format, status, recipient, definitionId, undefined, kind)));
      return { sent: status === "accepted", status, recipients, filename: report.filename };
    } catch (error) {
      // An accepted send must not be reported as safe to retry if history storage failed.
      if (accepted) throw new ConflictException("The provider accepted this report, but recording the history failed. Verify delivery before retrying.");
      await this.logReportExport(user, query, format, "failed", recipients.join(", "), definitionId, error instanceof Error ? error.message.slice(0, 1000) : "Report delivery failed.", kind);
      throw error;
    }
  }

  private async generateTicketsReport(user: AuthenticatedUser, query: TicketReportQueryDto, format: ReportFormat): Promise<GeneratedReport> {
    const result = await this.ticketSummary(user, query, { detailMode: query.scope === "page" ? "paged" : "all" });
    return this.render(user, "ticket-report", query, format, result);
  }
  private async generateEventServiceReport(user: AuthenticatedUser, query: EventServiceReportQueryDto, format: ReportFormat): Promise<GeneratedReport> {
    const result = await this.eventServiceSummary(user, query, { detailMode: query.scope === "page" ? "paged" : "all" });
    return this.render(user, "event-service-report", query, format, result);
  }
  private async generateExecutiveProjectReport(user: AuthenticatedUser, format: ReportFormat, query: ReportPresentationDto = {}): Promise<GeneratedReport> {
    return this.render(user, "project-executive-report", query, format, await this.executiveProjectSummary(user, query));
  }
  private async render(user: AuthenticatedUser, kind: ReportKind, query: ReportPresentationDto, format: ReportFormat, result: GeneratedReport["result"]): Promise<GeneratedReport> {
    this.validatePresentation(kind, query);
    const settings = await this.prisma.systemSetting.findUnique({ where: { organizationId: user.organizationId }, select: { applicationName: true, companyName: true, primaryColor: true, logoUrl: true, defaultTimezone: true, defaultLanguage: true } });
    const timeZone = query.timeZone ?? settings?.defaultTimezone ?? "UTC";
    const criteria: Array<[string, string]> = [["Timezone", timeZone], ["Scope", query.scope === "page" && "page" in result ? `Page ${result.page} of ${result.totalPages}` : "All matching records"]];
    if ("filters" in result) {
      criteria.unshift(["Period", `${result.filters.startDate} through ${result.filters.endDate} (inclusive)`], ["Date field", this.fieldLabel(query.dateBasis ?? "createdAt")]);
      const options = result.options;
      for (const [key, value] of Object.entries(query)) {
        if (!value || ["startDate", "endDate", "timeZone", "period", "page", "pageSize", "format", "title", "columns", "sections", "scope", "paper", "orientation", "dateBasis", "estimateMode", "valuePerTicket", "excludedIds"].includes(key)) continue;
        const candidates = Object.values(options).flat().filter((v): v is { id: string; name: string } => typeof v === "object" && v !== null && "id" in v && "name" in v);
        criteria.push([this.fieldLabel(key), candidates.find((item) => item.id === value)?.name ?? (key === "statuses" ? String(value).split(",").map((status) => this.label(status)).join(", ") : key === "sortBy" ? this.fieldLabel(String(value)) : this.label(String(value)))]);
      }
    } else criteria.push(["Period", "Current active projects; completed projects are counted separately"]);
    if (query.excludedIds) criteria.push(["Excluded records", `${this.exclusions(query).length} explicitly excluded; totals and charts use the remaining matching records.`]);
    if (kind === "ticket-report") criteria.push(["Files", "Active regular and inline attachments; deleted files are excluded."]);
    if ("estimatedTotal" in result.summary && result.summary.estimatedTotal !== null) criteria.push(["Estimate basis", `Manual estimate per ticket: ${(query as TicketReportQueryDto).valuePerTicket} ${query.currency}. This is not an invoice or recorded revenue.`]);
    let logo: Buffer | undefined;
    const prefix = "/api/system-settings/assets?";
    if (settings?.logoUrl?.startsWith(prefix)) {
      try {
        const key = new URLSearchParams(settings.logoUrl.slice(prefix.length)).get("key") ?? "";
        if (key.startsWith("branding/") && !key.split("/").includes("..")) {
          const stream = await this.brandingStorage.getFileStream(key); const parts: Buffer[] = []; let size = 0;
          for await (const part of stream) { size += part.length; if (size > 5_000_000) { stream.destroy(); throw new Error("Logo exceeds render limit"); } parts.push(Buffer.from(part)); }
          logo = await sharp(Buffer.concat(parts)).resize({ width: 600, height: 200, fit: "inside", withoutEnlargement: true }).png().toBuffer();
        }
      } catch { this.logger.warn("Report branding image could not be loaded; using company text."); }
    }
    const rows = result.detail.map((item) => {
      const row: Record<string, unknown> = { ...item };
      if ("statusDefinition" in item) row.status = item.statusDefinition?.name ?? this.label(item.status);
      else if ("status" in item) row.status = this.label(item.status);
      for (const key of ["priority", "source", "health"]) if (typeof row[key] === "string") row[key] = this.label(row[key] as string);
      if ("risk" in row) row.risk = row.risk ? "Needs attention" : "On track";
      return row;
    });
    const model: ReportDocument = {
      kind, query, title: query.title?.trim() || ({ "ticket-report": "Ticket report", "event-service-report": "Event & Services report", "project-executive-report": "Executive project report" })[kind],
      company: settings?.companyName ?? "", application: settings?.applicationName ?? "Reports", color: /^#[0-9a-f]{6}$/i.test(settings?.primaryColor ?? "") ? settings!.primaryColor : "#334155", logo,
      generatedAt: new Date(), timeZone, locale: settings?.defaultLanguage || "en", currency: query.currency,
      criteria, metrics: Object.entries(result.summary).filter(([key, value]) => key !== "estimatedTotal" || value !== null).map(([key, value]) => [this.fieldLabel(key), value, key]),
      distributions: Object.entries(result).filter(([key]) => key.startsWith("by")).map(([key, value]) => ({ key, title: this.fieldLabel(key.slice(2)), items: (value as Array<{ label: string; count: number }>).map((item) => ({ ...item, label: ["byPriority", "bySource", "byTaskStatus", "byHealth"].includes(key) ? this.label(item.label) : item.label })) })),
      activity: "activity" in result ? result.activity : [], rows, matched: "totalMatched" in result ? result.totalMatched : result.detail.length
    };
    return { filename: `${kind}-${localDay(new Date(), timeZone)}.${format}`, contentType: format === "pdf" ? "application/pdf" : format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv; charset=utf-8", body: await renderReport(model, format), format, result };
  }

  private resolveDetailPage(query: { page?: string; pageSize?: string }, totalMatched: number, options: TicketSummaryOptions | EventSummaryOptions) {
    if (options.detailMode === "all") {
      return {
        page: 1,
        pageSize: Math.max(totalMatched, 1),
        totalPages: 1,
        offset: 0
      };
    }

    const parsedPageSize = Number(query.pageSize ?? "25");
    const pageSize = Number.isFinite(parsedPageSize) ? Math.min(100, Math.max(10, Math.floor(parsedPageSize))) : 25;
    const totalPages = Math.max(1, Math.ceil(totalMatched / pageSize));
    const parsedPage = Number(query.page ?? "1");
    const page = Number.isFinite(parsedPage) ? Math.min(totalPages, Math.max(1, Math.floor(parsedPage))) : 1;

    return {
      page,
      pageSize,
      totalPages,
      offset: (page - 1) * pageSize
    };
  }

  private ticketSelect() {
    return {
      id: true,
      ticketNumber: true,
      subject: true,
      status: true,
      statusDefinition: { select: { id: true, name: true, color: true } },
      priority: true,
      source: true,
      senderEmail: true,
      assignedUserId: true,
      assignedTeamId: true,
      createdAt: true,
      updatedAt: true,
      closedAt: true,
      resolvedAt: true,
      client: { select: { id: true, name: true } },
      contact: { select: { firstName: true, lastName: true, email: true } },
      assignedUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      assignedTeam: { select: { name: true } },
      assignees: { select: { userId: true, user: { select: { id: true, firstName: true, lastName: true, email: true } } } },
      _count: { select: { attachments: { where: { deletedAt: null } } } }
    } satisfies Prisma.TicketSelect;
  }

  private eventServiceSelect() {
    return {
      id: true,
      trackingNumber: true,
      eventName: true,
      eventDate: true,
      startTime: true,
      endTime: true,
      requesterFirstName: true,
      requesterLastName: true,
      requesterEmail: true,
      status: true,
      priority: true,
      createdAt: true,
      updatedAt: true,
      completedAt: true,
      cancelledAt: true,
      client: { select: { id: true, name: true } },
      services: { select: { service: { select: { name: true } } } },
      assignees: { select: { user: { select: { id: true, firstName: true, lastName: true, email: true } } } },
      tasks: { select: { status: true, assignedUserId: true, assignedUser: { select: { id: true, firstName: true, lastName: true, email: true } } } }
    } satisfies Prisma.EventServiceRequestSelect;
  }

  private async ensureDefinitionAccess(user: AuthenticatedUser, definitionId: string) {
    const definition = await this.prisma.reportDefinition.findFirst({
      where: { id: definitionId, organizationId: user.organizationId, OR: [{ isShared: true }, { createdById: user.id }] },
      select: { id: true, filters: true, name: true, organizationId: true, reportType: true }
    });
    if (!definition) {
      throw new NotFoundException("Saved report was not found.");
    }
    return definition;
  }

  private async ensureScheduleAccess(user: AuthenticatedUser, scheduleId: string) {
    const schedule = await this.prisma.reportSchedule.findFirst({
      where: { id: scheduleId, organizationId: user.organizationId, createdById: user.id }
    });
    if (!schedule) {
      throw new NotFoundException("Report schedule was not found.");
    }
    return schedule;
  }

  private async logReportExport(user: AuthenticatedUser, query: TicketReportQueryDto | EventServiceReportQueryDto | { format?: ReportFormat }, format: ReportFormat, deliveryStatus: string, recipientEmail?: string, definitionId?: string | null, errorMessage?: string, reportType = "ticket-report") {
    await this.prisma.reportExport.create({
      data: {
        organizationId: user.organizationId,
        requestedById: user.id,
        definitionId: definitionId ?? null,
        reportType,
        filters: query as Prisma.InputJsonValue,
        format,
        recipientEmail,
        deliveryStatus,
        errorMessage
      }
    });
  }

  private async runDueSchedules() {
    if (this.schedulesRunning) return;
    this.schedulesRunning = true;
    try {
      const schedules = await this.prisma.reportSchedule.findMany({
        where: { isActive: true, nextRunAt: { lte: new Date() } },
        include: { definition: true, createdBy: { include: { groups: { include: { group: { include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } } } } } } },
        take: 10, orderBy: { nextRunAt: "asc" }
      });
      for (const schedule of schedules) {
        const timing = schedule.timing as ScheduleTiming | null ?? await this.defaultTiming(schedule.organizationId, schedule.nextRunAt);
        const nextRunAt = nextReportRun(schedule.frequency, timing);
        // Advance the due occurrence atomically before sending. A crashed/uncertain
        // delivery is never retried automatically, preventing duplicate emails.
        const claim = await this.prisma.reportSchedule.updateMany({ where: { id: schedule.id, isActive: true, nextRunAt: schedule.nextRunAt, updatedAt: schedule.updatedAt }, data: { nextRunAt, lastRunAt: new Date(), lastStatus: "running", lastError: null } });
        if (!claim.count) continue;
        const user = schedule.createdBy;
        let deliveryAttempted = false;
        try {
          if (!user || !user.isActive || user.deletedAt || user.organizationId !== schedule.organizationId) throw new ForbiddenException("The schedule owner is no longer an active organization user.");
          if (!schedule.definition.isShared && schedule.definition.createdById !== user.id) throw new ForbiddenException("The saved report is private to another user.");
          const permissions = [...new Set(user.groups.flatMap((g) => g.group.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.name))))];
          const authUser: AuthenticatedUser = { id: user.id, organizationId: schedule.organizationId, email: user.email, firstName: user.firstName, lastName: user.lastName, forcePasswordChange: user.forcePasswordChange, permissions };
          this.assertSchedulePermission(authUser, schedule.definition.reportType);
          const filters = this.validateFilters(schedule.definition.reportType, schedule.definition.filters as Record<string, unknown>);
          const input: SendReportDto = { recipientEmails: schedule.recipientEmails, format: schedule.format as ReportFormat, subject: schedule.name, message: `Attached is the scheduled report "${schedule.name}".` };
          deliveryAttempted = true;
          let deliveryResult: { status: string };
          if (schedule.definition.reportType === "event-service-report") deliveryResult = await this.sendEventServicesReport(authUser, this.eventFiltersToQuery(filters), input, schedule.definitionId);
          else if (schedule.definition.reportType === "project-executive-report") deliveryResult = await this.sendExecutiveProjects(authUser, filters, input, schedule.definitionId);
          else deliveryResult = await this.sendTicketsReport(authUser, this.filtersToQuery(filters), input, schedule.definitionId);
          await this.prisma.reportSchedule.update({ where: { id: schedule.id }, data: { lastStatus: deliveryResult.status, lastError: null } });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown scheduled report error.";
          this.logger.warn(`Scheduled report ${schedule.id} failed: ${message}`);
          await this.prisma.reportSchedule.update({ where: { id: schedule.id }, data: { lastStatus: "failed", lastError: message.slice(0, 1000) } });
          if (!deliveryAttempted) await this.prisma.reportExport.create({ data: { organizationId: schedule.organizationId, requestedById: user?.id, definitionId: schedule.definitionId, reportType: schedule.definition.reportType, filters: schedule.definition.filters as Prisma.InputJsonValue, format: schedule.format, deliveryStatus: "failed", errorMessage: message.slice(0, 1000) } });
        }
      }
    } finally { this.schedulesRunning = false; }
  }

  private audited<T extends { id: string }>(user: AuthenticatedUser, action: string, mutation: (db: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(async (db) => {
      const result = await mutation(db);
      await db.auditLog.create({ data: { organizationId: user.organizationId, userId: user.id, entityType: "report", entityId: result.id, action: `reports.${action}` } });
      return result;
    });
  }
  private validatePresentation(kind: ReportKind, query: ReportPresentationDto) {
    selectedColumns(kind, query); reportSections(query, kind); this.exclusions(query); this.validateSort(kind, query);
    if (query.timeZone) validZone(query.timeZone);
    if (kind === "project-executive-report" && query.scope === "page") throw new BadRequestException("Project reports export the full active portfolio.");
    const basis = query.dateBasis ?? "createdAt";
    const allowed = kind === "ticket-report" ? ["createdAt", "closedAt", "resolvedAt"] : ["createdAt", "eventDate"];
    if (kind !== "project-executive-report" && !allowed.includes(basis)) throw new BadRequestException("This date field is not available for the selected report.");
    if (query.currency && !Intl.supportedValuesOf("currency").includes(query.currency)) throw new BadRequestException("Choose a valid ISO currency code.");
    if ((query as TicketReportQueryDto).estimateMode === "perTicket" && !query.currency) throw new BadRequestException("Choose a currency before enabling the manual estimate.");
    if (query.columns?.split(",").includes("estimatedValue") && (query as TicketReportQueryDto).estimateMode !== "perTicket") throw new BadRequestException("Enable the optional estimate and choose a currency before selecting the estimate column.");
  }
  private validateFilters(kind: string, filters: Record<string, unknown>) {
    if (!["ticket-report", "event-service-report", "project-executive-report"].includes(kind)) throw new BadRequestException("Unknown report type.");
    const clean = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== "" && value !== null && value !== undefined));
    if (Array.isArray(clean.statuses)) clean.statuses = clean.statuses.join(",");
    if (!clean.statuses) delete clean.statuses;
    const dto = kind === "ticket-report" ? plainToInstance(TicketReportQueryDto, clean) : kind === "event-service-report" ? plainToInstance(EventServiceReportQueryDto, clean) : plainToInstance(ReportPresentationDto, clean);
    if (validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length) throw new BadRequestException("The saved report contains invalid filters. Review its dates and options.");
    this.validatePresentation(kind as ReportKind, dto);
    if (kind === "ticket-report") { this.parseStatuses((dto as TicketReportQueryDto).statuses); this.resolveValuePerTicket(dto as TicketReportQueryDto); }
    if (kind === "event-service-report") { this.parseEventStatuses((dto as EventServiceReportQueryDto).statuses); }
    if (kind !== "project-executive-report") reportRange(dto as TicketReportQueryDto, dto.timeZone ?? "UTC");
    return clean;
  }
  private exclusions(query: ReportPresentationDto) {
    if (!query.excludedIds) return [];
    const ids = query.excludedIds.split(",");
    if (ids.length > REPORT_MAX_EXCLUSIONS || ids.some((id) => !isUUID(id))) throw new BadRequestException(`Choose up to ${REPORT_MAX_EXCLUSIONS} valid record exclusions. Use filters for broader exclusions.`);
    return [...new Set(ids)];
  }
  private validateSort(kind: ReportKind, query: ReportPresentationDto) {
    if (query.sortBy && !REPORT_COLUMNS[kind].some((col) => col.key === query.sortBy)) throw new BadRequestException("This report column cannot be sorted.");
    if (query.sortDirection && !["asc", "desc"].includes(query.sortDirection)) throw new BadRequestException("Choose a valid sort direction.");
  }
  private sortRows<T extends Record<string, unknown>>(rows: T[], kind: ReportKind, query: ReportPresentationDto) {
    const key = query.sortBy ?? "createdAt", direction = query.sortDirection === "asc" ? 1 : -1;
    const column = REPORT_COLUMNS[kind].find((col) => col.key === key);
    const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
    const value = (row: T): string | number | null => {
      const raw = key === "status" && row.statusDefinition ? (row.statusDefinition as { name: string }).name : row[key];
      if (raw === null || raw === undefined || raw === "") return null;
      if (column?.type === "date" || column?.type === "dateOnly") return new Date(String(raw)).getTime();
      if (column?.type === "number" || column?.type === "currency") return Number(raw);
      if (key === "risk") return raw ? "Needs attention" : "On track";
      return this.label(String(raw));
    };
    return rows.sort((a, b) => {
      const left = value(a), right = value(b);
      const compared = left === null ? right === null ? 0 : 1 : right === null ? -1 : (typeof left === "number" && typeof right === "number" ? left - right : collator.compare(String(left), String(right))) * direction;
      return compared || collator.compare(String(a.id ?? a.projectId), String(b.id ?? b.projectId));
    });
  }
  private async ticketRecords(db: Prisma.TransactionClient, where: Prisma.TicketWhereInput, orderBy: Prisma.TicketOrderByWithRelationInput[] = [{ id: "asc" }]) {
    const rows: ReportTicket[] = [];
    for (let skip = 0; ; skip += 1000) {
      const batch = await db.ticket.findMany({ where, select: this.ticketSelect(), orderBy, skip, take: 1000 });
      rows.push(...batch); if (batch.length < 1000) return rows;
    }
  }
  private async eventRecords(db: Prisma.TransactionClient, where: Prisma.EventServiceRequestWhereInput, orderBy: Prisma.EventServiceRequestOrderByWithRelationInput[] = [{ id: "asc" }]) {
    const rows: ReportEventServiceRequest[] = [];
    for (let skip = 0; ; skip += 1000) {
      const batch = await db.eventServiceRequest.findMany({ where, select: this.eventServiceSelect(), orderBy, skip, take: 1000 });
      rows.push(...batch); if (batch.length < 1000) return rows;
    }
  }
  private ticketPeople(ticket: ReportTicket) {
    const users = new Map(ticket.assignees.map((a) => [a.userId, { id: a.userId, label: `${a.user.firstName} ${a.user.lastName}`, disambiguator: a.user.email }]));
    if (ticket.assignedUserId && ticket.assignedUser) users.set(ticket.assignedUserId, { id: ticket.assignedUserId, label: `${ticket.assignedUser.firstName} ${ticket.assignedUser.lastName}`, disambiguator: ticket.assignedUser.email });
    return users.size ? [...users.values()] : [{ id: "unassigned", label: "Unassigned" }];
  }
  private ticketAssignees(ticket: ReportTicket) { return this.ticketPeople(ticket).map((p) => p.label); }
  private groupEntities(items: Array<{ id: string; label: string; disambiguator?: string }>) {
    const groups = new Map<string, { id: string; label: string; disambiguator?: string; count: number }>();
    for (const item of items) groups.set(item.id, { ...item, count: (groups.get(item.id)?.count ?? 0) + 1 });
    const names = new Map<string, number>(); for (const item of groups.values()) names.set(item.label, (names.get(item.label) ?? 0) + 1);
    return [...groups.values()].map((item) => ({ label: (names.get(item.label) ?? 0) > 1 ? `${item.label} (${item.disambiguator ?? item.id.slice(0, 8)})` : item.label, count: item.count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }
  private async defaultTiming(organizationId: string, previous?: Date | null): Promise<ScheduleTiming> {
    const settings = await this.prisma.systemSetting.findUnique({ where: { organizationId }, select: { defaultTimezone: true } });
    const timeZone = settings?.defaultTimezone ?? "UTC";
    const date = previous ?? new Date();
    return { timeZone, time: new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date), weekDay: new Date(`${localDay(date, timeZone)}T12:00:00Z`).getUTCDay(), monthDay: Number(localDay(date, timeZone).slice(-2)) };
  }
  private assertSchedulePermission(user: AuthenticatedUser, kind: string) {
    const required = ["reports.view", "reports.manage", "reports.send", ...(kind === "project-executive-report" ? ["projects.view"] : [])];
    if (required.some((permission) => !user.permissions.includes(permission))) throw new ForbiddenException("Scheduling requires current report view, manage and send permissions, plus access to the report module.");
  }
  async configuration(user: AuthenticatedUser) {
    const settings = await this.prisma.systemSetting.findUnique({ where: { organizationId: user.organizationId }, select: { defaultTimezone: true, defaultLanguage: true } });
    return { timeZone: settings?.defaultTimezone ?? "UTC", locale: settings?.defaultLanguage ?? "en", currencies: Intl.supportedValuesOf("currency"), columns: REPORT_COLUMNS, permissions: user.permissions };
  }

  private normalizeEmails(emails: string[]) {
    return [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  }

  private filtersToQuery(filters: ReportFilters): TicketReportQueryDto {
    return {
      ...filters,
      statuses: Array.isArray(filters.statuses) ? filters.statuses.join(",") : filters.statuses
    } as TicketReportQueryDto;
  }

  private eventFiltersToQuery(filters: EventReportFilters): EventServiceReportQueryDto {
    return {
      ...filters,
      statuses: Array.isArray(filters.statuses) ? filters.statuses.join(",") : filters.statuses
    } as EventServiceReportQueryDto;
  }

  private escapeHtml(value: string) { return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c); }
  private label(value: string) { return /^[A-Z][A-Z_]*$/.test(value) && (value.includes("_") || ["NEW", "OPEN", "CLOSED", "RESOLVED", "CANCELLED", "NORMAL", "HIGH", "URGENT", "CRITICAL", "LOW", "EMAIL", "MANUAL", "PORTAL", "DONE", "COMPLETED"].includes(value)) ? value.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : value; }
  private fieldLabel(value: string) { return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()).replace(/Id$/, "").trim(); }

  private buildTicketWhere(user: AuthenticatedUser, query: TicketReportQueryDto, range: { start: Date; end: Date }) {
    const where: Prisma.TicketWhereInput = {
      organizationId: user.organizationId,
      deletedAt: null,
      status: { not: TicketStatus.MERGED },
      [query.dateBasis ?? "createdAt"]: { gte: range.start, lte: range.end }
    };
    if (query.excludedIds) where.id = { notIn: this.exclusions(query) };
    if (query.clientId) where.clientId = query.clientId;
    if (query.assignedUserId) {
      where.OR = [{ assignedUserId: query.assignedUserId }, { assignees: { some: { userId: query.assignedUserId } } }];
    }
    if (query.assignedTeamId) where.assignedTeamId = query.assignedTeamId;
    if (query.statusDefinitionId) where.statusDefinitionId = query.statusDefinitionId;
    if (query.search) where.AND = [{ OR: [{ subject: { contains: query.search, mode: "insensitive" } }, { ticketNumber: { contains: query.search, mode: "insensitive" } }] }];
    const statuses = this.parseStatuses(query.statuses);
    if (statuses.length) where.status = { in: statuses, not: TicketStatus.MERGED };
    if (query.priority) where.priority = query.priority;
    if (query.source) where.source = query.source;
    if (query.attachments === "with") where.attachments = { some: { deletedAt: null } };
    if (query.attachments === "without") where.attachments = { none: { deletedAt: null } };
    return where;
  }

  private buildEventServiceWhere(user: AuthenticatedUser, query: EventServiceReportQueryDto, range: ReturnType<typeof reportRange>) {
    const where: Prisma.EventServiceRequestWhereInput = {
      organizationId: user.organizationId,
      deletedAt: null,
      [query.dateBasis ?? "createdAt"]: { gte: range.start, lte: range.end }
    };
    if (query.excludedIds) where.id = { notIn: this.exclusions(query) };
    if (query.clientId) where.clientId = query.clientId;
    if (query.assignedUserId) {
      where.OR = [
        { assignees: { some: { userId: query.assignedUserId } } },
        { tasks: { some: { assignedUserId: query.assignedUserId } } }
      ];
    }
    if (query.search) where.AND = [{ OR: [{ eventName: { contains: query.search, mode: "insensitive" } }, { trackingNumber: { contains: query.search, mode: "insensitive" } }] }];
    if (query.dateBasis === "eventDate") where.eventDate = { gte: new Date(`${range.startDay}T00:00:00Z`), lt: new Date(`${shiftDay(range.endDay, 1)}T00:00:00Z`) };
    if (query.serviceId) where.services = { some: { serviceId: query.serviceId } };
    const statuses = this.parseEventStatuses(query.statuses);
    if (statuses.length) where.status = { in: statuses };
    if (query.priority) where.priority = query.priority;
    return where;
  }

  private parseStatuses(value?: string) {
    if (!value) return [];
    const allowed = new Set(Object.values(TicketStatus));
    const statuses = value.split(",").map((item) => item.trim().toUpperCase());
    if (statuses.some((item) => !allowed.has(item as TicketStatus))) throw new BadRequestException("Unknown report status.");
    return statuses as TicketStatus[];
  }

  private parseEventStatuses(value?: string) {
    if (!value) return [];
    const allowed = new Set(Object.values(EventServiceRequestStatus));
    const statuses = value.split(",").map((item) => item.trim().toUpperCase());
    if (statuses.some((item) => !allowed.has(item as EventServiceRequestStatus))) throw new BadRequestException("Unknown report status.");
    return statuses as EventServiceRequestStatus[];
  }

  private resolveValuePerTicket(query: TicketReportQueryDto) {
    if (query.estimateMode !== "perTicket") return null;
    if (query.valuePerTicket === undefined || query.valuePerTicket === "") throw new BadRequestException("Enter the manual estimate per ticket; zero is allowed.");
    const value = Number(query.valuePerTicket);
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException("Estimated value per ticket must be zero or a positive number.");
    }
    return value;
  }

  private buildActivity(tickets: ReportTicket[], range: ReturnType<typeof reportRange>, groupBy: string) {
    return this.activity(tickets, range, groupBy, { created: "createdAt", closed: "closedAt", resolved: "resolvedAt" });
  }
  private buildEventActivity(requests: ReportEventServiceRequest[], range: ReturnType<typeof reportRange>, groupBy: string) {
    return this.activity(requests, range, groupBy, { created: "createdAt", completed: "completedAt", cancelled: "cancelledAt" });
  }
  private activity<T>(records: T[], range: ReturnType<typeof reportRange>, groupBy: string, fields: Record<string, keyof T>) {
    const buckets = new Map<string, Record<string, string | number>>();
    const empty = (period: string): Record<string, string | number> => ({ period, label: period, ...Object.fromEntries(Object.keys(fields).map((key) => [key, 0])) });
    for (let day = range.startDay; day <= range.endDay; day = shiftDay(day, 1)) {
      const key = periodKey(new Date(`${day}T12:00:00Z`), groupBy, "UTC");
      if (!buckets.has(key)) buckets.set(key, empty(key));
    }
    for (const record of records) for (const [field, key] of Object.entries(fields)) {
      const date = record[key];
      if (!(date instanceof Date) || date < range.start || date > range.end) continue;
      const period = periodKey(date, groupBy, range.timeZone);
      const bucket = buckets.get(period) ?? empty(period); bucket[field] = Number(bucket[field]) + 1; buckets.set(period, bucket);
    }
    return [...buckets.values()];
  }

  private groupBy(tickets: ReportTicket[], getKey: (ticket: ReportTicket) => string) {
    const counts = new Map<string, number>();
    for (const ticket of tickets) {
      const key = getKey(ticket);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  private groupEventsBy<T>(items: T[], getKey?: (item: T) => string) {
    const counts = new Map<string, number>();
    for (const item of items) {
      const key = getKey ? getKey(item) : String(item);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  private toDetailRow(ticket: ReportTicket, valuePerTicket: number | null) {
    const requester = ticket.contact ? `${ticket.contact.firstName} ${ticket.contact.lastName}` : ticket.senderEmail ?? "Unknown";
    return {
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      clientName: ticket.client?.name ?? "Unmapped / no client",
      requester,
      status: ticket.status,
      statusDefinition: ticket.statusDefinition,
      priority: ticket.priority,
      source: ticket.source,
      assignedTo: this.ticketAssignees(ticket).join(", "),
      team: ticket.assignedTeam?.name ?? "No team",
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      closedAt: ticket.closedAt?.toISOString() ?? null,
      resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
      attachmentCount: ticket._count.attachments,
      estimatedValue: valuePerTicket
    };
  }

  private toEventDetailRow(request: ReportEventServiceRequest) {
    const assignees = [
      ...request.assignees.map((assignee) => `${assignee.user.firstName} ${assignee.user.lastName}`),
      ...request.tasks.flatMap((task) => task.assignedUser ? [`${task.assignedUser.firstName} ${task.assignedUser.lastName}`] : [])
    ];
    const uniqueAssignees = [...new Set(assignees)];
    const completedTaskCount = request.tasks.filter((task) => task.status === EventServiceTaskStatus.DONE).length;
    return {
      id: request.id,
      trackingNumber: request.trackingNumber,
      eventName: request.eventName,
      clientName: request.client?.name ?? "Unmapped / no client",
      requester: `${request.requesterFirstName} ${request.requesterLastName}`,
      requesterEmail: request.requesterEmail,
      eventDate: request.eventDate?.toISOString() ?? null,
      time: `${request.startTime ?? "Not set"} - ${request.endTime ?? "Not set"}`,
      services: request.services.map((item) => item.service.name).join(", ") || "No services",
      status: request.status,
      priority: request.priority,
      assignedTo: uniqueAssignees.length ? uniqueAssignees.join(", ") : "Unassigned",
      taskCount: request.tasks.length,
      completedTaskCount,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString()
    };
  }


}
