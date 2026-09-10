import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Workbook } from "exceljs";
import PDFDocument from "pdfkit";
import { EventServiceRequestStatus, EventServiceTaskStatus, Prisma, ProjectDecisionStatus, ProjectHealth, ProjectMilestoneStatus, ProjectStatus, TicketPriority, TicketSource, TicketStatus } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { MailDeliveryService } from "../mailboxes/mail-delivery.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateReportDefinitionDto, CreateReportScheduleDto, SendReportDto, UpdateReportDefinitionDto, UpdateReportScheduleDto } from "./dto/report-definition.dto";
import { EventServiceReportExportQueryDto, EventServiceReportQueryDto, TicketReportExportQueryDto, TicketReportQueryDto } from "./dto/ticket-report-query.dto";

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailDelivery: MailDeliveryService
  ) {}

  onModuleInit() {
    this.scheduleTimer = setInterval(() => {
      void this.runDueSchedules();
    }, 60_000);
  }

  onModuleDestroy() {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
    }
  }

  async listDefinitions(user: AuthenticatedUser, reportType = "ticket-report") {
    const definitions = await this.prisma.reportDefinition.findMany({
      where: { organizationId: user.organizationId, reportType },
      select: {
        id: true,
        name: true,
        description: true,
        reportType: true,
        filters: true,
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
        filters: { groupBy: "month", estimateMode: "perTicket", valuePerTicket: "0" }
      },
      {
        id: "technician-productivity",
        name: "Technician Productivity",
        description: "Workload by assigned technician and operational team.",
        filters: { groupBy: "week", estimateMode: "none" }
      },
      {
        id: "aging-tickets",
        name: "Aging Tickets",
        description: "Active tickets and tickets without recent closure.",
        filters: {
          groupBy: "day",
          statuses: ACTIVE_STATUSES,
          estimateMode: "none"
        }
      },
      {
        id: "billing-estimate",
        name: "Closed Tickets Billing Estimate",
        description: "Closed/resolved tickets with optional per-ticket value.",
        filters: {
          groupBy: "month",
          statuses: [TicketStatus.CLOSED, TicketStatus.RESOLVED],
          estimateMode: "perTicket",
          valuePerTicket: "0"
        }
      }
    ];
  }

  async listExportHistory(user: AuthenticatedUser, reportType = "ticket-report") {
    const exports = await this.prisma.reportExport.findMany({
      where: {
        reportType,
        OR: [
          { organizationId: user.organizationId },
          { requestedBy: { organizationId: user.organizationId } }
        ]
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
      return await this.prisma.reportDefinition.create({
        data: {
          organizationId: user.organizationId,
          createdById: user.id,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          reportType: input.reportType?.trim() || "ticket-report",
          filters: input.filters as Prisma.InputJsonValue,
          isShared: input.isShared ?? true
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("A report with this name already exists.");
      }
      throw error;
    }
  }

  async updateDefinition(user: AuthenticatedUser, definitionId: string, input: UpdateReportDefinitionDto) {
    await this.ensureDefinitionAccess(user, definitionId);
    try {
      return await this.prisma.reportDefinition.update({
        where: { id: definitionId },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined ? { description: input.description.trim() || null } : {}),
          ...(input.filters !== undefined ? { filters: input.filters as Prisma.InputJsonValue } : {}),
          ...(input.isShared !== undefined ? { isShared: input.isShared } : {})
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("A report with this name already exists.");
      }
      throw error;
    }
  }

  async deleteDefinition(user: AuthenticatedUser, definitionId: string) {
    await this.ensureDefinitionAccess(user, definitionId);
    await this.prisma.reportDefinition.delete({ where: { id: definitionId } });
    return { deleted: true };
  }

  async listSchedules(user: AuthenticatedUser, reportType = "ticket-report") {
    return this.prisma.reportSchedule.findMany({
      where: {
        organizationId: user.organizationId,
        definition: { reportType }
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
    return this.prisma.reportSchedule.create({
      data: {
        organizationId: user.organizationId,
        definitionId: definition.id,
        createdById: user.id,
        name: input.name.trim(),
        frequency,
        format: input.format ?? "pdf",
        recipientEmails: this.normalizeEmails(input.recipientEmails),
        isActive: input.isActive ?? true,
        nextRunAt: input.isActive === false ? null : this.nextScheduleRun(frequency)
      }
    });
  }

  async updateSchedule(user: AuthenticatedUser, scheduleId: string, input: UpdateReportScheduleDto) {
    const schedule = await this.ensureScheduleAccess(user, scheduleId);
    const frequency = input.frequency ?? schedule.frequency;
    const isActive = input.isActive ?? schedule.isActive;
    return this.prisma.reportSchedule.update({
      where: { id: schedule.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.frequency !== undefined ? { frequency } : {}),
        ...(input.format !== undefined ? { format: input.format } : {}),
        ...(input.recipientEmails !== undefined ? { recipientEmails: this.normalizeEmails(input.recipientEmails) } : {}),
        ...(input.isActive !== undefined ? { isActive } : {}),
        nextRunAt: isActive ? this.nextScheduleRun(frequency) : null
      }
    });
  }

  async deleteSchedule(user: AuthenticatedUser, scheduleId: string) {
    const schedule = await this.ensureScheduleAccess(user, scheduleId);
    await this.prisma.reportSchedule.delete({ where: { id: schedule.id } });
    return { deleted: true };
  }

  async ticketSummary(user: AuthenticatedUser, query: TicketReportQueryDto, options: TicketSummaryOptions = {}) {
    const range = this.resolveDateRange(query);
    const where = this.buildTicketWhere(user, query, range);
    const valuePerTicket = this.resolveValuePerTicket(query);
    if (query.estimateMode === "perTicket" && await this.prisma.qcReview.count({ where: { organizationId: user.organizationId, billingState: "HELD", ticket: where } })) {
      throw new ConflictException("This report includes work on a QC billing hold. Release the hold or narrow the report before generating a financial estimate.");
    }

    const [tickets, clients, users, teams] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        select: this.ticketSelect(),
        orderBy: { createdAt: "desc" },
        take: 2000
      }),
      this.prisma.client.findMany({
        where: { organizationId: user.organizationId, deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: "asc" }
      }),
      this.prisma.user.findMany({
        where: { organizationId: user.organizationId, deletedAt: null, isActive: true },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }]
      }),
      this.prisma.ticketTeam.findMany({
        where: { organizationId: user.organizationId, isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" }
      })
    ]);

    const activeCount = tickets.filter((ticket) => ACTIVE_STATUSES.includes(ticket.status)).length;
    const closedCount = tickets.filter((ticket) => ticket.status === TicketStatus.CLOSED).length;
    const resolvedCount = tickets.filter((ticket) => ticket.status === TicketStatus.RESOLVED).length;
    const unassignedCount = tickets.filter((ticket) => !ticket.assignedUserId && !ticket.assignedTeamId && ticket.assignees.length === 0).length;
    const withAttachments = tickets.filter((ticket) => ticket._count.attachments > 0).length;
    const estimatedTotal = valuePerTicket ? tickets.length * valuePerTicket : null;
    const totalMatched = tickets.length;
    const detailPage = this.resolveDetailPage(query, totalMatched, options);
    const detailRows = tickets
      .slice(detailPage.offset, detailPage.offset + detailPage.pageSize)
      .map((ticket) => this.toDetailRow(ticket, valuePerTicket));

    return {
      filters: {
        startDate: range.start.toISOString(),
        endDate: range.end.toISOString(),
        groupBy: query.groupBy ?? "day",
        estimateMode: query.estimateMode ?? "none",
        valuePerTicket,
        page: detailPage.page,
        pageSize: detailPage.pageSize
      },
      options: {
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
      byClient: this.groupBy(tickets, (ticket) => ticket.client?.name ?? "Unmapped / no client").slice(0, 12),
      byTechnician: this.groupBy(tickets, (ticket) => ticket.assignedUser ? `${ticket.assignedUser.firstName} ${ticket.assignedUser.lastName}` : "Unassigned").slice(0, 12),
      byTeam: this.groupBy(tickets, (ticket) => ticket.assignedTeam?.name ?? "No team").slice(0, 12),
      detail: detailRows,
      detailLimit: detailPage.pageSize,
      page: detailPage.page,
      pageSize: detailPage.pageSize,
      totalPages: detailPage.totalPages,
      totalMatched
    };
  }

  async eventServiceSummary(user: AuthenticatedUser, query: EventServiceReportQueryDto, options: EventSummaryOptions = {}) {
    const range = this.resolveDateRange(query);
    const where = this.buildEventServiceWhere(user, query, range);

    const [requests, clients, users, services] = await Promise.all([
      this.prisma.eventServiceRequest.findMany({
        where,
        select: this.eventServiceSelect(),
        orderBy: [{ eventDate: "desc" }, { createdAt: "desc" }],
        take: 2000
      }),
      this.prisma.client.findMany({
        where: { organizationId: user.organizationId, deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: "asc" }
      }),
      this.prisma.user.findMany({
        where: { organizationId: user.organizationId, deletedAt: null, isActive: true },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }]
      }),
      this.prisma.eventServiceService.findMany({
        where: { organizationId: user.organizationId, isActive: true },
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
    const detailRows = requests
      .slice(detailPage.offset, detailPage.offset + detailPage.pageSize)
      .map((request) => this.toEventDetailRow(request));

    return {
      filters: {
        startDate: range.start.toISOString(),
        endDate: range.end.toISOString(),
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
      byStatus: this.groupEventsBy(requests, (request) => request.status),
      byPriority: this.groupEventsBy(requests, (request) => request.priority),
      byService: this.groupEventsBy(requests.flatMap((request) => request.services.map((item) => item.service.name))),
      byClient: this.groupEventsBy(requests, (request) => request.client?.name ?? "Unmapped / no client").slice(0, 12),
      byTechnician: this.groupEventsBy(requests.flatMap((request) => [
        ...request.assignees.map((assignee) => `${assignee.user.firstName} ${assignee.user.lastName}`),
        ...request.tasks.flatMap((task) => task.assignedUser ? [`${task.assignedUser.firstName} ${task.assignedUser.lastName}`] : [])
      ])).slice(0, 12),
      byTaskStatus: this.groupEventsBy(requests.flatMap((request) => request.tasks.map((task) => task.status))),
      detail: detailRows,
      detailLimit: detailPage.pageSize,
      page: detailPage.page,
      pageSize: detailPage.pageSize,
      totalPages: detailPage.totalPages,
      totalMatched
    };
  }

  async executiveProjectSummary(user: AuthenticatedUser) {
    const now = new Date();
    const projects = await this.prisma.project.findMany({
      where: { organizationId: user.organizationId, deletedAt: null },
      select: {
        id: true, name: true, status: true, health: true, targetDate: true, completedAt: true,
        client: { select: { name: true } }, owner: { select: { firstName: true, lastName: true } },
        milestones: { select: { status: true, dueAt: true } },
        decisions: { where: { status: { notIn: [ProjectDecisionStatus.RESOLVED, ProjectDecisionStatus.CANCELLED] } }, select: { title: true, dueAt: true, owner: { select: { firstName: true, lastName: true } } } }
      }, orderBy: [{ targetDate: "asc" }, { updatedAt: "desc" }], take: 500
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
      detail: detail.sort((left, right) => Number(right.risk) - Number(left.risk) || (left.targetDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (right.targetDate?.getTime() ?? Number.MAX_SAFE_INTEGER))
    };
  }

  async exportTickets(user: AuthenticatedUser, query: TicketReportExportQueryDto) {
    const format = query.format ?? "csv";
    const report = await this.generateTicketsReport(user, query, format);
    await this.logReportExport(user, query, format, "downloaded", undefined, undefined, undefined, "ticket-report");
    return report;
  }

  async exportEventServices(user: AuthenticatedUser, query: EventServiceReportExportQueryDto) {
    const format = query.format ?? "csv";
    const report = await this.generateEventServiceReport(user, query, format);
    await this.logReportExport(user, query, format, "downloaded", undefined, undefined, undefined, "event-service-report");
    return report;
  }

  async exportExecutiveProjects(user: AuthenticatedUser, query: { format?: ReportFormat }) {
    const format = query.format ?? "csv";
    const report = await this.generateExecutiveProjectReport(user, format);
    await this.logReportExport(user, query, format, "downloaded", undefined, undefined, undefined, "project-executive-report");
    return report;
  }

  async sendTicketsReport(user: AuthenticatedUser, query: TicketReportExportQueryDto, input: SendReportDto) {
    const format = input.format ?? query.format ?? "pdf";
    const report = await this.generateTicketsReport(user, query, format);
    const subject = input.subject?.trim() || `Ticket report - ${new Date().toLocaleDateString()}`;
    const message = input.message?.trim() || "Attached is the requested ticket report.";
    const recipients = this.normalizeEmails(input.recipientEmails);
    if (!recipients.length) {
      throw new BadRequestException("At least one recipient email is required.");
    }

    await this.mailDelivery.sendTicketReply({
      organizationId: user.organizationId,
      to: recipients,
      subject,
      bodyText: message,
      bodyHtml: `<p>${this.escapeHtml(message).replace(/\n/g, "<br />")}</p>`,
      rawAttachments: [{
        originalFilename: report.filename,
        mimeType: report.contentType,
        sizeBytes: Buffer.byteLength(report.body),
        contentBytes: Buffer.isBuffer(report.body) ? report.body : Buffer.from(report.body),
        isInline: false
      }]
    });

    await Promise.all(recipients.map((recipient) => this.logReportExport(user, query, format, "emailed", recipient, undefined, undefined, "ticket-report")));
    return { sent: true, recipients, filename: report.filename };
  }

  async sendEventServicesReport(user: AuthenticatedUser, query: EventServiceReportExportQueryDto, input: SendReportDto) {
    const format = input.format ?? query.format ?? "pdf";
    const report = await this.generateEventServiceReport(user, query, format);
    const subject = input.subject?.trim() || `Event services report - ${new Date().toLocaleDateString()}`;
    const message = input.message?.trim() || "Attached is the requested Event & Services report.";
    const recipients = this.normalizeEmails(input.recipientEmails);
    if (!recipients.length) {
      throw new BadRequestException("At least one recipient email is required.");
    }

    await this.mailDelivery.sendTicketReply({
      organizationId: user.organizationId,
      to: recipients,
      subject,
      bodyText: message,
      bodyHtml: `<p>${this.escapeHtml(message).replace(/\n/g, "<br />")}</p>`,
      rawAttachments: [{
        originalFilename: report.filename,
        mimeType: report.contentType,
        sizeBytes: Buffer.byteLength(report.body),
        contentBytes: Buffer.isBuffer(report.body) ? report.body : Buffer.from(report.body),
        isInline: false
      }]
    });

    await Promise.all(recipients.map((recipient) => this.logReportExport(user, query, format, "emailed", recipient, undefined, undefined, "event-service-report")));
    return { sent: true, recipients, filename: report.filename };
  }

  async sendExecutiveProjects(user: AuthenticatedUser, query: { format?: ReportFormat }, input: SendReportDto) {
    const format = input.format ?? query.format ?? "pdf";
    const report = await this.generateExecutiveProjectReport(user, format);
    const recipients = this.normalizeEmails(input.recipientEmails);
    if (!recipients.length) throw new BadRequestException("At least one recipient email is required.");
    const subject = input.subject?.trim() || `Executive project report - ${new Date().toLocaleDateString()}`;
    const message = input.message?.trim() || "Attached is the requested executive project report.";
    await this.mailDelivery.sendTicketReply({ organizationId: user.organizationId, to: recipients, subject, bodyText: message, bodyHtml: `<p>${this.escapeHtml(message).replace(/\n/g, "<br />")}</p>`, rawAttachments: [{ originalFilename: report.filename, mimeType: report.contentType, sizeBytes: Buffer.byteLength(report.body), contentBytes: Buffer.isBuffer(report.body) ? report.body : Buffer.from(report.body), isInline: false }] });
    await Promise.all(recipients.map((recipient) => this.logReportExport(user, query, format, "emailed", recipient, undefined, undefined, "project-executive-report")));
    return { sent: true, recipients, filename: report.filename };
  }

  private async generateTicketsReport(user: AuthenticatedUser, query: TicketReportQueryDto, format: ReportFormat): Promise<GeneratedReport> {
    if (format === "xlsx") return this.exportTicketsXlsx(user, query);
    if (format === "pdf") return this.exportTicketsPdf(user, query);
    return this.exportTicketsCsv(user, query);
  }

  private async generateEventServiceReport(user: AuthenticatedUser, query: EventServiceReportQueryDto, format: ReportFormat): Promise<GeneratedReport> {
    if (format === "xlsx") return this.exportEventServicesXlsx(user, query);
    if (format === "pdf") return this.exportEventServicesPdf(user, query);
    return this.exportEventServicesCsv(user, query);
  }

  private async generateExecutiveProjectReport(user: AuthenticatedUser, format: ReportFormat): Promise<GeneratedReport> {
    const result = await this.executiveProjectSummary(user);
    const rows = result.detail.map((project) => [project.projectName, project.clientName, project.owner, project.status, project.health, project.targetDate?.toISOString().slice(0, 10) ?? "", project.overdueMilestones, project.openDecisions, project.overdueDecisions, project.unassignedDecisions, project.risk ? "Needs attention" : "On track"]);
    const headers = ["Project", "Client", "Owner", "Status", "Health", "Target", "Overdue milestones", "Open decisions", "Overdue decisions", "Unassigned decisions", "Delivery signal"];
    if (format === "xlsx") {
      const workbook = new Workbook();
      const summary = workbook.addWorksheet("Executive summary");
      summary.addRows([["Executive Project Report"], ["Generated", result.generatedAt.toISOString()], ["Active projects", result.summary.activeProjects], ["At risk", result.summary.atRiskProjects], ["Overdue decisions", result.summary.overdueDecisions], ["Overdue milestones", result.summary.overdueMilestones]]);
      const detail = workbook.addWorksheet("Projects"); detail.addRow(headers); detail.addRows(rows); detail.getRow(1).font = { bold: true }; detail.views = [{ state: "frozen", ySplit: 1 }]; detail.columns.forEach((column) => { column.width = 22; });
      return { filename: `executive-project-report-${new Date().toISOString().slice(0, 10)}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", body: Buffer.from(await workbook.xlsx.writeBuffer()), format, result };
    }
    if (format === "pdf") {
      const doc = new PDFDocument({ margin: 42, size: "LETTER" }); const chunks: Buffer[] = []; doc.on("data", (chunk: Buffer) => chunks.push(chunk)); const done = new Promise<void>((resolve) => doc.on("end", resolve));
      doc.font("Helvetica-Bold").fontSize(20).text("Executive Project Report"); doc.moveDown(0.3); doc.font("Helvetica").fontSize(10).text(`Generated ${result.generatedAt.toLocaleString()}`); doc.moveDown();
      doc.font("Helvetica-Bold").fontSize(11).text(`Active: ${result.summary.activeProjects}   At risk: ${result.summary.atRiskProjects}   Overdue decisions: ${result.summary.overdueDecisions}`); doc.moveDown();
      for (const project of result.detail.slice(0, 45)) { doc.font("Helvetica-Bold").fontSize(10).text(project.projectName); doc.font("Helvetica").fontSize(9).text(`${project.clientName} | ${project.owner} | ${project.health.replace("_", " ")} | Target: ${project.targetDate?.toLocaleDateString() ?? "Not scheduled"}`); doc.text(`${project.overdueMilestones} overdue milestones, ${project.openDecisions} open decisions, ${project.overdueDecisions} overdue decisions`); doc.moveDown(0.45); }
      doc.end(); await done;
      return { filename: `executive-project-report-${new Date().toISOString().slice(0, 10)}.pdf`, contentType: "application/pdf", body: Buffer.concat(chunks), format, result };
    }
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const body = [["Executive Project Report"], ["Generated", result.generatedAt.toISOString()], [], headers, ...rows].map((row) => row.map(escape).join(",")).join("\n");
    return { filename: `executive-project-report-${new Date().toISOString().slice(0, 10)}.csv`, contentType: "text/csv; charset=utf-8", body, format, result };
  }

  private async exportTicketsCsv(user: AuthenticatedUser, query: TicketReportQueryDto): Promise<GeneratedReport> {
    const result = await this.ticketSummary(user, query, { detailMode: "all" });
    const rows = result.detail.map((ticket) => [
      ticket.ticketNumber,
      ticket.subject,
      ticket.clientName,
      ticket.requester,
      ticket.statusDefinition?.name ?? this.label(ticket.status),
      ticket.priority,
      ticket.source,
      ticket.assignedTo,
      ticket.team,
      ticket.createdAt,
      ticket.updatedAt,
      ticket.closedAt ?? "",
      String(ticket.attachmentCount),
      ticket.estimatedValue === null ? "" : ticket.estimatedValue.toFixed(2)
    ]);
    const csv = this.toCsv([
      ["Ticket", "Subject", "Client", "Requester", "Status", "Priority", "Source", "Assigned To", "Team", "Created", "Modified", "Closed", "Attachments", "Estimated Value"],
      ...rows
    ]);

    return {
      filename: `ticket-report-${new Date().toISOString().slice(0, 10)}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: csv,
      format: "csv",
      result
    };
  }

  private async exportTicketsXlsx(user: AuthenticatedUser, query: TicketReportQueryDto): Promise<GeneratedReport> {
    const result = await this.ticketSummary(user, query, { detailMode: "all" });
    const workbook = new Workbook();
    workbook.creator = "Avidity IT Management Tool";
    workbook.created = new Date();

    const summary = workbook.addWorksheet("Summary");
    summary.columns = [
      { header: "Metric", key: "metric", width: 28 },
      { header: "Value", key: "value", width: 22 }
    ];
    summary.addRows([
      { metric: "Total tickets", value: result.summary.totalTickets },
      { metric: "Active tickets", value: result.summary.activeTickets },
      { metric: "Closed tickets", value: result.summary.closedTickets },
      { metric: "Resolved tickets", value: result.summary.resolvedTickets },
      { metric: "Unassigned tickets", value: result.summary.unassignedTickets },
      { metric: "High priority tickets", value: result.summary.highPriorityTickets },
      { metric: "Tickets with attachments", value: result.summary.withAttachments },
      { metric: "Estimated total", value: result.summary.estimatedTotal ?? "" }
    ]);

    const detail = workbook.addWorksheet("Tickets");
    detail.columns = [
      { header: "Ticket", key: "ticketNumber", width: 14 },
      { header: "Subject", key: "subject", width: 42 },
      { header: "Client", key: "clientName", width: 28 },
      { header: "Requester", key: "requester", width: 28 },
      { header: "Status", key: "status", width: 18 },
      { header: "Priority", key: "priority", width: 14 },
      { header: "Source", key: "source", width: 14 },
      { header: "Assigned To", key: "assignedTo", width: 26 },
      { header: "Team", key: "team", width: 24 },
      { header: "Created", key: "createdAt", width: 24 },
      { header: "Modified", key: "updatedAt", width: 24 },
      { header: "Closed", key: "closedAt", width: 24 },
      { header: "Attachments", key: "attachmentCount", width: 14 },
      { header: "Estimated Value", key: "estimatedValue", width: 18 }
    ];
    detail.addRows(result.detail.map((ticket) => ({ ...ticket, estimatedValue: ticket.estimatedValue ?? "" })));

    for (const sheet of [summary, detail]) {
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.autoFilter = { from: "A1", to: `${sheet.getColumn(sheet.columnCount).letter}1` };
    }

    const body = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      filename: `ticket-report-${new Date().toISOString().slice(0, 10)}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body,
      format: "xlsx",
      result
    };
  }

  private async exportTicketsPdf(user: AuthenticatedUser, query: TicketReportQueryDto): Promise<GeneratedReport> {
    const result = await this.ticketSummary(user, query, { detailMode: "all" });
    const doc = new PDFDocument({ margin: 42, size: "LETTER", bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<void>((resolve) => doc.on("end", resolve));

    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(20).text("Ticket Report");
    doc.moveDown(0.25);
    doc.fillColor("#64748b").font("Helvetica").fontSize(9).text(`Generated ${new Date().toLocaleString()}`);
    doc.text(`Range ${this.formatShortDate(result.filters.startDate)} - ${this.formatShortDate(result.filters.endDate)} | Grouped by ${this.label(result.filters.groupBy)}`);
    doc.moveDown(0.8);

    this.drawPdfSummaryGrid(doc, [
      ["Total", String(result.summary.totalTickets)],
      ["Active", String(result.summary.activeTickets)],
      ["Closed", String(result.summary.closedTickets)],
      ["Resolved", String(result.summary.resolvedTickets)],
      ["Unassigned", String(result.summary.unassignedTickets)],
      ["High Priority", String(result.summary.highPriorityTickets)],
      ["With Files", String(result.summary.withAttachments)],
      ["Estimate", result.summary.estimatedTotal === null ? "-" : `$${result.summary.estimatedTotal.toFixed(2)}`]
    ]);

    this.drawPdfSection(doc, "Ticket Activity");
    this.drawPdfGroupedBars(doc, result.activity.slice(-18).map((item) => ({
      label: item.label,
      values: [
        { label: "Created", value: item.created, color: "#2563eb" },
        { label: "Resolved", value: item.resolved, color: "#16a34a" },
        { label: "Closed", value: item.closed, color: "#64748b" }
      ]
    })));

    this.drawPdfSection(doc, "Operational Distribution");
    this.drawPdfBarChart(doc, "Tickets by Status", result.byStatus.slice(0, 8));
    this.drawPdfBarChart(doc, "Top Clients", result.byClient.slice(0, 8));
    this.drawPdfBarChart(doc, "Technician Workload", result.byTechnician.slice(0, 8));

    this.drawPdfSection(doc, "Report Detail");
    doc.fillColor("#64748b").font("Helvetica").fontSize(8).text(`Showing ${Math.min(result.detail.length, 80)} of ${result.totalMatched} tickets in this PDF. CSV and Excel exports include the full detail table.`);
    doc.moveDown(0.5);
    this.drawPdfTicketTable(doc, result.detail.slice(0, 80));

    this.drawPdfPageNumbers(doc);

    doc.end();
    await done;
    return {
      filename: `ticket-report-${new Date().toISOString().slice(0, 10)}.pdf`,
      contentType: "application/pdf",
      body: Buffer.concat(chunks),
      format: "pdf",
      result
    };
  }

  private async exportEventServicesCsv(user: AuthenticatedUser, query: EventServiceReportQueryDto): Promise<GeneratedReport> {
    const result = await this.eventServiceSummary(user, query, { detailMode: "all" });
    const rows = result.detail.map((request) => [
      request.trackingNumber,
      request.eventName,
      request.clientName,
      request.requester,
      request.eventDate,
      request.time,
      request.services,
      request.status,
      request.priority,
      request.assignedTo,
      String(request.taskCount),
      String(request.completedTaskCount),
      request.updatedAt
    ]);
    const csv = this.toCsv([
      ["Tracking", "Event", "Client", "Requester", "Date", "Time", "Services", "Status", "Priority", "Assigned To", "Tasks", "Completed Tasks", "Updated"],
      ...rows
    ]);

    return {
      filename: `event-services-report-${new Date().toISOString().slice(0, 10)}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: csv,
      format: "csv",
      result
    };
  }

  private async exportEventServicesXlsx(user: AuthenticatedUser, query: EventServiceReportQueryDto): Promise<GeneratedReport> {
    const result = await this.eventServiceSummary(user, query, { detailMode: "all" });
    const workbook = new Workbook();
    workbook.creator = "Avidity IT Management Tool";
    workbook.created = new Date();

    const summary = workbook.addWorksheet("Summary");
    summary.columns = [
      { header: "Metric", key: "metric", width: 30 },
      { header: "Value", key: "value", width: 18 }
    ];
    summary.addRows([
      { metric: "Total requests", value: result.summary.totalRequests },
      { metric: "New requests", value: result.summary.newRequests },
      { metric: "Assigned requests", value: result.summary.assignedRequests },
      { metric: "Completed requests", value: result.summary.completedRequests },
      { metric: "Cancelled requests", value: result.summary.cancelledRequests },
      { metric: "Total tasks", value: result.summary.totalTasks },
      { metric: "Open tasks", value: result.summary.openTasks },
      { metric: "Completed tasks", value: result.summary.completedTasks }
    ]);

    const detail = workbook.addWorksheet("Event Requests");
    detail.columns = [
      { header: "Tracking", key: "trackingNumber", width: 16 },
      { header: "Event", key: "eventName", width: 36 },
      { header: "Client", key: "clientName", width: 28 },
      { header: "Requester", key: "requester", width: 28 },
      { header: "Date", key: "eventDate", width: 18 },
      { header: "Time", key: "time", width: 18 },
      { header: "Services", key: "services", width: 38 },
      { header: "Status", key: "status", width: 20 },
      { header: "Priority", key: "priority", width: 14 },
      { header: "Assigned To", key: "assignedTo", width: 32 },
      { header: "Tasks", key: "taskCount", width: 10 },
      { header: "Completed Tasks", key: "completedTaskCount", width: 16 },
      { header: "Updated", key: "updatedAt", width: 24 }
    ];
    detail.addRows(result.detail);

    for (const sheet of [summary, detail]) {
      sheet.getRow(1).font = { bold: true };
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.autoFilter = { from: "A1", to: `${sheet.getColumn(sheet.columnCount).letter}1` };
    }

    const body = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      filename: `event-services-report-${new Date().toISOString().slice(0, 10)}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body,
      format: "xlsx",
      result
    };
  }

  private async exportEventServicesPdf(user: AuthenticatedUser, query: EventServiceReportQueryDto): Promise<GeneratedReport> {
    const result = await this.eventServiceSummary(user, query, { detailMode: "all" });
    const doc = new PDFDocument({ margin: 42, size: "LETTER", bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<void>((resolve) => doc.on("end", resolve));

    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(20).text("Event & Services Report");
    doc.moveDown(0.25);
    doc.fillColor("#64748b").font("Helvetica").fontSize(9).text(`Generated ${new Date().toLocaleString()}`);
    doc.text(`Range ${this.formatShortDate(result.filters.startDate)} - ${this.formatShortDate(result.filters.endDate)} | Grouped by ${this.label(result.filters.groupBy)}`);
    doc.moveDown(0.8);

    this.drawPdfSummaryGrid(doc, [
      ["Total", String(result.summary.totalRequests)],
      ["New", String(result.summary.newRequests)],
      ["Assigned", String(result.summary.assignedRequests)],
      ["Completed", String(result.summary.completedRequests)],
      ["Cancelled", String(result.summary.cancelledRequests)],
      ["Tasks", String(result.summary.totalTasks)],
      ["Open Tasks", String(result.summary.openTasks)],
      ["Done Tasks", String(result.summary.completedTasks)]
    ]);

    this.drawPdfSection(doc, "Event Activity");
    this.drawPdfGroupedBars(doc, result.activity.slice(-18).map((item) => ({
      label: item.label,
      values: [
        { label: "Created", value: item.created, color: "#2563eb" },
        { label: "Completed", value: item.completed, color: "#16a34a" },
        { label: "Cancelled", value: item.cancelled, color: "#ef4444" }
      ]
    })), "Blue: Created   Green: Completed   Red: Cancelled");

    this.drawPdfSection(doc, "Operational Distribution");
    this.drawPdfBarChart(doc, "Requests by Status", result.byStatus.slice(0, 8));
    this.drawPdfBarChart(doc, "Requests by Service", result.byService.slice(0, 8));
    this.drawPdfBarChart(doc, "Specialist Workload", result.byTechnician.slice(0, 8));
    this.drawPdfBarChart(doc, "Tasks by Status", result.byTaskStatus.slice(0, 8));

    this.drawPdfSection(doc, "Report Detail");
    doc.fillColor("#64748b").font("Helvetica").fontSize(8).text(`Showing ${Math.min(result.detail.length, 80)} of ${result.totalMatched} event requests in this PDF. CSV and Excel exports include the full detail table.`);
    doc.moveDown(0.5);
    this.drawPdfEventTable(doc, result.detail.slice(0, 80));

    this.drawPdfPageNumbers(doc);

    doc.end();
    await done;
    return {
      filename: `event-services-report-${new Date().toISOString().slice(0, 10)}.pdf`,
      contentType: "application/pdf",
      body: Buffer.concat(chunks),
      format: "pdf",
      result
    };
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
      assignedUser: { select: { firstName: true, lastName: true } },
      assignedTeam: { select: { name: true } },
      assignees: { select: { userId: true } },
      _count: { select: { attachments: true } }
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
      assignees: { select: { user: { select: { firstName: true, lastName: true } } } },
      tasks: { select: { status: true, assignedUserId: true, assignedUser: { select: { firstName: true, lastName: true } } } }
    } satisfies Prisma.EventServiceRequestSelect;
  }

  private async ensureDefinitionAccess(user: AuthenticatedUser, definitionId: string) {
    const definition = await this.prisma.reportDefinition.findFirst({
      where: { id: definitionId, organizationId: user.organizationId },
      select: { id: true, filters: true, name: true, organizationId: true, reportType: true }
    });
    if (!definition) {
      throw new NotFoundException("Saved report was not found.");
    }
    return definition;
  }

  private async ensureScheduleAccess(user: AuthenticatedUser, scheduleId: string) {
    const schedule = await this.prisma.reportSchedule.findFirst({
      where: { id: scheduleId, organizationId: user.organizationId }
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
    const schedules = await this.prisma.reportSchedule.findMany({
      where: {
        isActive: true,
        nextRunAt: { lte: new Date() }
      },
      include: {
        definition: true,
        createdBy: true
      },
      take: 10,
      orderBy: { nextRunAt: "asc" }
    });

    for (const schedule of schedules) {
      const user = schedule.createdBy;
      if (!user) continue;
      const authUser: AuthenticatedUser = {
        id: user.id,
        organizationId: schedule.organizationId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        forcePasswordChange: user.forcePasswordChange,
        permissions: ["reports.view"]
      };
      const reportType = schedule.definition.reportType;
      try {
        if (reportType === "event-service-report") {
          const query = this.eventFiltersToQuery(schedule.definition.filters as EventReportFilters);
          await this.sendEventServicesReport(authUser, { ...query, format: schedule.format as ReportFormat }, {
            recipientEmails: schedule.recipientEmails,
            format: schedule.format as ReportFormat,
            subject: `${schedule.name} - Event & Services report`,
            message: `Attached is the scheduled report "${schedule.name}".`
          });
        } else if (reportType === "project-executive-report") {
          await this.sendExecutiveProjects(authUser, { format: schedule.format as ReportFormat }, {
            recipientEmails: schedule.recipientEmails,
            format: schedule.format as ReportFormat,
            subject: `${schedule.name} - Executive project report`,
            message: `Attached is the scheduled report "${schedule.name}".`
          });
        } else {
          const query = this.filtersToQuery(schedule.definition.filters as ReportFilters);
          await this.sendTicketsReport(authUser, { ...query, format: schedule.format as ReportFormat }, {
            recipientEmails: schedule.recipientEmails,
            format: schedule.format as ReportFormat,
            subject: `${schedule.name} - Ticket report`,
            message: `Attached is the scheduled report "${schedule.name}".`
          });
        }
        await this.prisma.reportSchedule.update({
          where: { id: schedule.id },
          data: {
            lastRunAt: new Date(),
            lastStatus: "sent",
            lastError: null,
            nextRunAt: this.nextScheduleRun(schedule.frequency)
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown scheduled report error.";
        this.logger.warn(`Scheduled report ${schedule.id} failed: ${message}`);
        await this.prisma.reportSchedule.update({
          where: { id: schedule.id },
          data: {
            lastRunAt: new Date(),
            lastStatus: "failed",
            lastError: message.slice(0, 1000),
            nextRunAt: this.nextScheduleRun(schedule.frequency)
          }
        });
        await this.prisma.reportExport.create({
          data: {
            organizationId: schedule.organizationId,
            requestedById: user.id,
            definitionId: schedule.definitionId,
            reportType,
            filters: schedule.definition.filters as Prisma.InputJsonValue,
            format: schedule.format,
            deliveryStatus: "failed",
            errorMessage: message.slice(0, 1000)
          }
        });
      }
    }
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

  private nextScheduleRun(frequency: string) {
    const next = new Date();
    next.setSeconds(0, 0);
    if (frequency === "daily") {
      next.setDate(next.getDate() + 1);
    } else if (frequency === "monthly") {
      next.setMonth(next.getMonth() + 1);
    } else {
      next.setDate(next.getDate() + 7);
    }
    return next;
  }

  private drawPdfSection(doc: PDFKit.PDFDocument, title: string) {
    this.ensurePdfSpace(doc, 80);
    doc.moveDown(0.8);
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(12).text(title);
    doc.moveDown(0.3);
  }

  private drawPdfSummaryGrid(doc: PDFKit.PDFDocument, rows: Array<[string, string]>) {
    const startX = 42;
    const cardWidth = 122;
    const cardHeight = 42;
    const gap = 10;
    rows.forEach(([label, value], index) => {
      const column = index % 4;
      const row = Math.floor(index / 4);
      const x = startX + column * (cardWidth + gap);
      const y = doc.y + row * (cardHeight + gap);
      doc.roundedRect(x, y, cardWidth, cardHeight, 6).fillAndStroke("#f8fafc", "#dbe3ef");
      doc.fillColor("#64748b").font("Helvetica").fontSize(7).text(label, x + 10, y + 8, { width: cardWidth - 20 });
      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(15).text(value, x + 10, y + 21, { width: cardWidth - 20 });
    });
    doc.y += 2 * (cardHeight + gap);
  }

  private drawPdfGroupedBars(doc: PDFKit.PDFDocument, groups: Array<{ label: string; values: Array<{ label: string; value: number; color: string }> }>, legend = "Blue: Created   Green: Resolved   Gray: Closed") {
    this.ensurePdfSpace(doc, 170);
    const chartX = 42;
    const chartY = doc.y;
    const chartWidth = 520;
    const chartHeight = 120;
    const maxValue = Math.max(1, ...groups.flatMap((group) => group.values.map((value) => value.value)));
    const groupWidth = chartWidth / Math.max(1, groups.length);

    doc.strokeColor("#dbe3ef").moveTo(chartX, chartY + chartHeight).lineTo(chartX + chartWidth, chartY + chartHeight).stroke();

    groups.forEach((group, groupIndex) => {
      const baseX = chartX + groupIndex * groupWidth + 3;
      const barWidth = Math.max(3, Math.min(8, (groupWidth - 8) / group.values.length));
      group.values.forEach((value, valueIndex) => {
        const height = Math.max(2, (value.value / maxValue) * chartHeight);
        doc.rect(baseX + valueIndex * (barWidth + 2), chartY + chartHeight - height, barWidth, height).fill(value.color);
      });
      if (groupIndex % Math.ceil(groups.length / 6 || 1) === 0) {
        doc.fillColor("#64748b").font("Helvetica").fontSize(6).text(group.label, baseX, chartY + chartHeight + 4, { width: groupWidth + 10, align: "left" });
      }
    });

    doc.y = chartY + chartHeight + 22;
    doc.fillColor("#64748b").font("Helvetica").fontSize(7).text(legend);
  }

  private drawPdfBarChart(doc: PDFKit.PDFDocument, title: string, items: Array<{ label: string; count: number }>) {
    this.ensurePdfSpace(doc, 96);
    doc.fillColor("#334155").font("Helvetica-Bold").fontSize(9).text(title);
    doc.moveDown(0.2);
    const maxValue = Math.max(1, ...items.map((item) => item.count));
    const x = 42;
    const barX = 220;
    const barWidth = 250;
    for (const item of items) {
      this.ensurePdfSpace(doc, 18);
      const y = doc.y;
      doc.fillColor("#475569").font("Helvetica").fontSize(8).text(this.label(item.label), x, y, { width: 170, ellipsis: true });
      doc.roundedRect(barX, y + 1, barWidth, 8, 4).fill("#e2e8f0");
      doc.roundedRect(barX, y + 1, Math.max(8, (item.count / maxValue) * barWidth), 8, 4).fill("#2563eb");
      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(8).text(String(item.count), barX + barWidth + 12, y, { width: 50, align: "right" });
      doc.y = y + 17;
    }
    doc.moveDown(0.3);
  }

  private drawPdfTicketTable(doc: PDFKit.PDFDocument, tickets: Awaited<ReturnType<ReportsService["ticketSummary"]>>["detail"]) {
    const columns = [
      { label: "Ticket", x: 42, width: 62 },
      { label: "Subject", x: 110, width: 165 },
      { label: "Client", x: 282, width: 100 },
      { label: "Status", x: 390, width: 72 },
      { label: "Assigned", x: 468, width: 94 }
    ];
    const drawHeader = () => {
      this.ensurePdfSpace(doc, 34);
      const y = doc.y;
      doc.roundedRect(42, y, 520, 20, 4).fill("#f1f5f9");
      columns.forEach((column) => {
        doc.fillColor("#334155").font("Helvetica-Bold").fontSize(7).text(column.label, column.x, y + 6, { width: column.width });
      });
      doc.y = y + 24;
    };

    drawHeader();
    tickets.forEach((ticket) => {
      if (doc.y > 705) {
        doc.addPage();
        drawHeader();
      }
      const y = doc.y;
      const rowHeight = 28;
      doc.strokeColor("#e2e8f0").moveTo(42, y + rowHeight).lineTo(562, y + rowHeight).stroke();
      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(7).text(ticket.ticketNumber, 42, y + 4, { width: 62 });
      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(7).text(ticket.subject, 110, y + 4, { width: 165, ellipsis: true });
      doc.fillColor("#64748b").font("Helvetica").fontSize(6).text(ticket.requester, 110, y + 14, { width: 165, ellipsis: true });
      doc.fillColor("#0f172a").font("Helvetica").fontSize(7).text(ticket.clientName, 282, y + 4, { width: 100, ellipsis: true });
      doc.fillColor("#0f172a").font("Helvetica").fontSize(7).text(ticket.statusDefinition?.name ?? this.label(ticket.status), 390, y + 4, { width: 72, ellipsis: true });
      doc.fillColor("#0f172a").font("Helvetica").fontSize(7).text(ticket.assignedTo, 468, y + 4, { width: 94, ellipsis: true });
      doc.fillColor("#64748b").font("Helvetica").fontSize(6).text(this.formatShortDate(ticket.createdAt), 468, y + 14, { width: 94 });
      doc.y = y + rowHeight + 2;
    });
  }

  private drawPdfEventTable(doc: PDFKit.PDFDocument, requests: Awaited<ReturnType<ReportsService["eventServiceSummary"]>>["detail"]) {
    const columns = [
      { label: "Tracking", x: 42, width: 64 },
      { label: "Event", x: 112, width: 150 },
      { label: "Date", x: 270, width: 76 },
      { label: "Status", x: 352, width: 82 },
      { label: "Assigned", x: 440, width: 122 }
    ];
    const drawHeader = () => {
      this.ensurePdfSpace(doc, 34);
      const y = doc.y;
      doc.roundedRect(42, y, 520, 20, 4).fill("#f1f5f9");
      columns.forEach((column) => {
        doc.fillColor("#334155").font("Helvetica-Bold").fontSize(7).text(column.label, column.x, y + 6, { width: column.width });
      });
      doc.y = y + 24;
    };

    drawHeader();
    requests.forEach((request) => {
      if (doc.y > 705) {
        doc.addPage();
        drawHeader();
      }
      const y = doc.y;
      const rowHeight = 30;
      doc.strokeColor("#e2e8f0").moveTo(42, y + rowHeight).lineTo(562, y + rowHeight).stroke();
      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(7).text(request.trackingNumber, 42, y + 4, { width: 64 });
      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(7).text(request.eventName, 112, y + 4, { width: 150, ellipsis: true });
      doc.fillColor("#64748b").font("Helvetica").fontSize(6).text(request.requester, 112, y + 14, { width: 150, ellipsis: true });
      doc.fillColor("#0f172a").font("Helvetica").fontSize(7).text(request.eventDate, 270, y + 4, { width: 76 });
      doc.fillColor("#64748b").font("Helvetica").fontSize(6).text(request.time, 270, y + 14, { width: 76 });
      doc.fillColor("#0f172a").font("Helvetica").fontSize(7).text(this.label(request.status), 352, y + 4, { width: 82, ellipsis: true });
      doc.fillColor("#0f172a").font("Helvetica").fontSize(7).text(request.assignedTo, 440, y + 4, { width: 122, ellipsis: true });
      doc.fillColor("#64748b").font("Helvetica").fontSize(6).text(`${request.taskCount} tasks, ${request.completedTaskCount} done`, 440, y + 14, { width: 122 });
      doc.y = y + rowHeight + 2;
    });
  }

  private drawPdfPageNumbers(doc: PDFKit.PDFDocument) {
    const pages = doc.bufferedPageRange();
    for (let index = 0; index < pages.count; index += 1) {
      doc.switchToPage(pages.start + index);
      doc.font("Helvetica").fontSize(8).fillColor("#94a3b8").text(`Page ${index + 1} of ${pages.count}`, 42, 734, {
        align: "right",
        width: 528,
        lineBreak: false
      });
    }
  }

  private ensurePdfSpace(doc: PDFKit.PDFDocument, requiredHeight: number) {
    if (doc.y + requiredHeight > 730) {
      doc.addPage();
    }
  }

  private drawPdfKeyValue(doc: PDFKit.PDFDocument, key: string, value: string) {
    const y = doc.y;
    doc.fillColor("#475569").font("Helvetica").fontSize(9).text(key, 42, y, { width: 260 });
    doc.fillColor("#0f172a").font("Helvetica-Bold").text(value, 330, y, { width: 220, align: "right" });
    doc.moveDown(0.45);
  }

  private escapeHtml(value: string) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  private label(value: string) {
    return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  }

  private formatShortDate(value: string) {
    return new Date(value).toLocaleDateString();
  }

  private buildTicketWhere(user: AuthenticatedUser, query: TicketReportQueryDto, range: { start: Date; end: Date }) {
    const where: Prisma.TicketWhereInput = {
      organizationId: user.organizationId,
      deletedAt: null,
      status: { not: TicketStatus.MERGED },
      createdAt: { gte: range.start, lte: range.end }
    };
    if (query.clientId) where.clientId = query.clientId;
    if (query.assignedUserId) {
      where.OR = [{ assignedUserId: query.assignedUserId }, { assignees: { some: { userId: query.assignedUserId } } }];
    }
    if (query.assignedTeamId) where.assignedTeamId = query.assignedTeamId;
    const statuses = this.parseStatuses(query.statuses);
    if (statuses.length) where.status = { in: statuses };
    if (query.priority) where.priority = query.priority;
    if (query.source) where.source = query.source;
    if (query.attachments === "with") where.attachments = { some: { deletedAt: null } };
    if (query.attachments === "without") where.attachments = { none: { deletedAt: null } };
    return where;
  }

  private buildEventServiceWhere(user: AuthenticatedUser, query: EventServiceReportQueryDto, range: { start: Date; end: Date }) {
    const where: Prisma.EventServiceRequestWhereInput = {
      organizationId: user.organizationId,
      deletedAt: null,
      createdAt: { gte: range.start, lte: range.end }
    };
    if (query.clientId) where.clientId = query.clientId;
    if (query.assignedUserId) {
      where.OR = [
        { assignees: { some: { userId: query.assignedUserId } } },
        { tasks: { some: { assignedUserId: query.assignedUserId } } }
      ];
    }
    if (query.serviceId) where.services = { some: { serviceId: query.serviceId } };
    const statuses = this.parseEventStatuses(query.statuses);
    if (statuses.length) where.status = { in: statuses };
    if (query.priority) where.priority = query.priority;
    return where;
  }

  private resolveDateRange(query: TicketReportQueryDto) {
    const end = query.endDate ? new Date(query.endDate) : new Date();
    const start = query.startDate ? new Date(query.startDate) : new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException("Invalid report date range.");
    }
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    if (start > end) {
      throw new BadRequestException("Report start date must be before end date.");
    }
    return { start, end };
  }

  private parseStatuses(value?: string) {
    if (!value) return [];
    const allowed = new Set(Object.values(TicketStatus));
    return value.split(",").map((item) => item.trim().toUpperCase()).filter((item): item is TicketStatus => allowed.has(item as TicketStatus));
  }

  private parseEventStatuses(value?: string) {
    if (!value) return [];
    const allowed = new Set(Object.values(EventServiceRequestStatus));
    return value.split(",").map((item) => item.trim().toUpperCase()).filter((item): item is EventServiceRequestStatus => allowed.has(item as EventServiceRequestStatus));
  }

  private resolveValuePerTicket(query: TicketReportQueryDto) {
    if (query.estimateMode !== "perTicket") return null;
    const value = Number(query.valuePerTicket ?? "0");
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException("Estimated value per ticket must be a positive number.");
    }
    return value;
  }

  private buildActivity(tickets: ReportTicket[], range: { start: Date; end: Date }, groupBy: "day" | "week" | "month" | "year") {
    const buckets = new Map<string, { label: string; created: number; closed: number; resolved: number }>();
    for (const ticket of tickets) {
      this.incrementBucket(buckets, ticket.createdAt, groupBy, "created");
      if (ticket.closedAt) this.incrementBucket(buckets, ticket.closedAt, groupBy, "closed");
      if (ticket.resolvedAt) this.incrementBucket(buckets, ticket.resolvedAt, groupBy, "resolved");
    }
    if (buckets.size === 0) {
      const key = this.bucketKey(range.start, groupBy);
      buckets.set(key, { label: key, created: 0, closed: 0, resolved: 0 });
    }
    return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, value]) => ({ period, ...value }));
  }

  private buildEventActivity(requests: ReportEventServiceRequest[], range: { start: Date; end: Date }, groupBy: "day" | "week" | "month" | "year") {
    const buckets = new Map<string, { label: string; created: number; completed: number; cancelled: number }>();
    for (const request of requests) {
      this.incrementEventBucket(buckets, request.createdAt, groupBy, "created");
      if (request.completedAt) this.incrementEventBucket(buckets, request.completedAt, groupBy, "completed");
      if (request.cancelledAt) this.incrementEventBucket(buckets, request.cancelledAt, groupBy, "cancelled");
    }
    if (buckets.size === 0) {
      const key = this.bucketKey(range.start, groupBy);
      buckets.set(key, { label: key, created: 0, completed: 0, cancelled: 0 });
    }
    return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, value]) => ({ period, ...value }));
  }

  private incrementEventBucket(buckets: Map<string, { label: string; created: number; completed: number; cancelled: number }>, date: Date, groupBy: "day" | "week" | "month" | "year", field: "created" | "completed" | "cancelled") {
    const key = this.bucketKey(date, groupBy);
    const bucket = buckets.get(key) ?? { label: key, created: 0, completed: 0, cancelled: 0 };
    bucket[field] += 1;
    buckets.set(key, bucket);
  }

  private incrementBucket(buckets: Map<string, { label: string; created: number; closed: number; resolved: number }>, date: Date, groupBy: "day" | "week" | "month" | "year", field: "created" | "closed" | "resolved") {
    const key = this.bucketKey(date, groupBy);
    const bucket = buckets.get(key) ?? { label: key, created: 0, closed: 0, resolved: 0 };
    bucket[field] += 1;
    buckets.set(key, bucket);
  }

  private bucketKey(date: Date, groupBy: "day" | "week" | "month" | "year") {
    const year = date.getFullYear();
    if (groupBy === "year") return String(year);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    if (groupBy === "month") return `${year}-${month}`;
    if (groupBy === "week") {
      const firstDay = new Date(year, 0, 1);
      const week = Math.ceil((((date.getTime() - firstDay.getTime()) / 86400000) + firstDay.getDay() + 1) / 7);
      return `${year}-W${String(week).padStart(2, "0")}`;
    }
    return `${year}-${month}-${String(date.getDate()).padStart(2, "0")}`;
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
      ticketNumber: ticket.ticketNumber,
      subject: ticket.subject,
      clientName: ticket.client?.name ?? "Unmapped / no client",
      requester,
      status: ticket.status,
      statusDefinition: ticket.statusDefinition,
      priority: ticket.priority,
      source: ticket.source,
      assignedTo: ticket.assignedUser ? `${ticket.assignedUser.firstName} ${ticket.assignedUser.lastName}` : "Unassigned",
      team: ticket.assignedTeam?.name ?? "No team",
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      closedAt: ticket.closedAt?.toISOString() ?? null,
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
      trackingNumber: request.trackingNumber,
      eventName: request.eventName,
      clientName: request.client?.name ?? "Unmapped / no client",
      requester: `${request.requesterFirstName} ${request.requesterLastName}`,
      requesterEmail: request.requesterEmail,
      eventDate: request.eventDate ? this.formatShortDate(request.eventDate.toISOString()) : "Not scheduled",
      time: `${request.startTime ?? "Not set"} - ${request.endTime ?? "Not set"}`,
      services: request.services.map((item) => item.service.name).join(", ") || "No services",
      status: request.status,
      priority: request.priority,
      assignedTo: uniqueAssignees.length ? uniqueAssignees.join(", ") : "Unassigned",
      taskCount: request.tasks.length,
      completedTaskCount,
      updatedAt: request.updatedAt.toISOString()
    };
  }

  private toCsv(rows: string[][]) {
    return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, "\"\"")}"`).join(",")).join("\r\n");
  }
}
