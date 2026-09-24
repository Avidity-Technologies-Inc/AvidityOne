import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventServiceFieldType, EventServiceRequestStatus, EventServiceTaskStatus, MessageDirection, MessageVisibility, Prisma, TicketPriority } from "@prisma/client";
import { HtmlSanitizerService } from "../../common/html/html-sanitizer.service";
import { AuditLogsService } from "../audit-logs/audit-logs.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { AutoRepliesService } from "../auto-replies/auto-replies.service";
import { ExternalSpecialistsService } from "../external-specialists/external-specialists.service";
import { MailDeliveryService } from "../mailboxes/mail-delivery.service";
import { NotificationsService, NotificationEventType } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateEventServiceCommentDto } from "./dto/create-event-service-comment.dto";
import { CreateEventServiceMessageDto } from "./dto/create-event-service-message.dto";
import { CreateEventServiceRequestDto } from "./dto/create-event-service-request.dto";
import { CreateEventServiceTaskDto } from "./dto/create-event-service-task.dto";
import { AddEventServiceExternalSpecialistDto } from "./dto/add-event-service-external-specialist.dto";
import { SendEventServiceExternalInviteDto } from "./dto/send-event-service-external-invite.dto";
import { SyncEventServiceTaskCalendarDto } from "./dto/sync-event-service-task-calendar.dto";
import { CreatePublicEventServiceRequestDto } from "./dto/create-public-event-service-request.dto";
import { ListEventServiceCalendarDto } from "./dto/list-event-service-calendar.dto";
import { ListEventServiceRequestsDto } from "./dto/list-event-service-requests.dto";
import { UpdateEventServiceCalendarSettingsDto } from "./dto/update-event-service-calendar-settings.dto";
import { UpdateEventServicePortalSettingsDto } from "./dto/update-event-service-portal-settings.dto";
import { UpdateEventServiceTurnstileDto } from "./dto/update-event-service-turnstile.dto";
import { UpdateEventServiceRequestDto } from "./dto/update-event-service-request.dto";
import { UpdateEventServiceTaskDto } from "./dto/update-event-service-task.dto";
import { UpdateMyEventServiceTaskDto } from "./dto/update-my-event-service-task.dto";
import { UpsertEventServiceFormFieldDto } from "./dto/upsert-event-service-form-field.dto";
import { UpsertEventServiceServiceDto } from "./dto/upsert-event-service-service.dto";
import { EventServicesAttachmentsService } from "./event-services-attachments.service";
import { EventServicesCalendarService } from "./event-services-calendar.service";

const TIME_PATTERN = /^([01]\d|2[0-3]):(00|15|30|45)$/;
const DEFAULT_EVENT_TURNSTILE_SECRET_REFERENCE = "env:EVENT_TURNSTILE_SECRET_KEY";

@Injectable()
export class EventServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailDelivery: MailDeliveryService,
    private readonly auditLogs: AuditLogsService,
    private readonly notifications: NotificationsService,
    private readonly autoReplies: AutoRepliesService,
    private readonly externalSpecialists: ExternalSpecialistsService,
    private readonly htmlSanitizer: HtmlSanitizerService,
    private readonly attachments: EventServicesAttachmentsService,
    private readonly calendar: EventServicesCalendarService
  ) {}

  async getPublicForm() {
    const organization = await this.getPublicOrganization();
    await this.ensureDefaultCatalog(organization.id);
    const [settings, services, form] = await Promise.all([
      this.prisma.systemSetting.findUnique({
        where: { organizationId: organization.id },
        select: { companyName: true, supportEmail: true, eventPortalBrowserTitle: true, eventTurnstileEnabled: true, eventTurnstileSiteKey: true }
      }),
      this.prisma.eventServiceService.findMany({
        where: { organizationId: organization.id, isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }]
      }),
      this.getActiveForm(organization.id)
    ]);

    return {
      organization: {
        name: settings?.companyName ?? organization.name,
        supportEmail: settings?.supportEmail ?? "support@aviditytechnologies.com"
      },
      portal: {
        browserTitle: settings?.eventPortalBrowserTitle ?? "Schedule Event Support"
      },
      turnstileSiteKey: settings?.eventTurnstileEnabled ? settings.eventTurnstileSiteKey : null,
      services,
      form
    };
  }

  async createPublicRequest(input: CreatePublicEventServiceRequestDto, context: { ipAddress?: string; userAgent?: string }) {
    const organization = await this.getPublicOrganization();
    await this.ensureDefaultCatalog(organization.id);
    await this.verifyPublicTurnstile(organization.id, input.captchaToken, context.ipAddress);
    this.validateTimeRange(input.startTime, input.endTime);
    const activeForm = await this.getActiveForm(organization.id);
    this.validatePublicFormData(activeForm.fields, input);

    const services = await this.prisma.eventServiceService.findMany({
      where: { id: { in: [...new Set(input.serviceIds)] }, organizationId: organization.id, isActive: true }
    });
    if (!services.length) {
      throw new BadRequestException("Select at least one active service.");
    }

    const defaultUserIds = [...new Set(services.flatMap((service) => service.defaultUserIds))];
    const validUserIds = await this.validUserIds(organization.id, defaultUserIds);
    const trackingNumber = await this.nextTrackingNumber(organization.id);
    const clientMapping = await this.findClientMapping(input.requesterEmail, organization.id);

    const request = await this.prisma.eventServiceRequest.create({
      data: {
        organizationId: organization.id,
        trackingNumber,
        clientId: clientMapping.clientId,
        contactId: clientMapping.contactId,
        eventName: input.eventName.trim(),
        organizer: this.optionalTrim(input.organizer),
        venue: this.optionalTrim(input.venue),
        eventDate: input.eventDate ? new Date(input.eventDate) : null,
        startTime: this.optionalTrim(input.startTime),
        endTime: this.optionalTrim(input.endTime),
        requesterFirstName: input.requesterFirstName.trim(),
        requesterLastName: input.requesterLastName.trim(),
        requesterEmail: input.requesterEmail.trim().toLowerCase(),
        requesterPhone: this.optionalTrim(input.requesterPhone),
        status: validUserIds.length ? EventServiceRequestStatus.ASSIGNED : EventServiceRequestStatus.NEW,
        additionalInfo: this.optionalTrim(input.additionalInfo),
        formData: input.formData ? (input.formData as Prisma.InputJsonValue) : undefined,
        submittedFromIp: context.ipAddress,
        submittedUserAgent: context.userAgent,
        services: { create: services.map((service) => ({ serviceId: service.id })) },
        assignees: { create: validUserIds.map((userId) => ({ userId, role: "Auto-assigned" })) },
        activity: {
          create: {
            action: "event_service_request.created_public",
            metadata: { serviceIds: services.map((service) => service.id) }
          }
        }
      },
      include: this.requestInclude()
    });

    await Promise.all([
      this.notifications.notifyNewEventRequestCreated({ requestId: request.id, organizationId: organization.id }),
      this.notifyAssignedUsers(request.id, "New event request assigned", `${request.trackingNumber}: ${request.eventName}`, "eventAssignedToMe"),
      this.sendRequesterInitialResponse(request).catch((error) =>
        this.logActivity(request.id, null, "event_service_request.confirmation_email_failed", {
          message: error instanceof Error ? error.message : "Unknown email error"
        })
      )
    ]);

    return { trackingNumber: request.trackingNumber, request };
  }

  async create(user: AuthenticatedUser, input: CreateEventServiceRequestDto) {
    this.validateTimeRange(input.startTime, input.endTime);

    const services = await this.prisma.eventServiceService.findMany({
      where: { id: { in: [...new Set(input.serviceIds)] }, organizationId: user.organizationId, isActive: true }
    });
    if (!services.length) {
      throw new BadRequestException("Select at least one active service.");
    }

    const validUserIds = await this.validUserIds(user.organizationId, input.assignedUserIds ?? []);
    const trackingNumber = await this.nextTrackingNumber(user.organizationId);
    const clientMapping = await this.findClientMapping(input.requesterEmail, user.organizationId);

    const request = await this.prisma.eventServiceRequest.create({
      data: {
        organizationId: user.organizationId,
        trackingNumber,
        clientId: clientMapping.clientId,
        contactId: clientMapping.contactId,
        eventName: input.eventName.trim(),
        organizer: this.optionalTrim(input.organizer),
        venue: this.optionalTrim(input.venue),
        eventDate: input.eventDate ? new Date(input.eventDate) : null,
        startTime: this.optionalTrim(input.startTime),
        endTime: this.optionalTrim(input.endTime),
        requesterFirstName: input.requesterFirstName.trim(),
        requesterLastName: input.requesterLastName.trim(),
        requesterEmail: input.requesterEmail.trim().toLowerCase(),
        requesterPhone: this.optionalTrim(input.requesterPhone),
        priority: input.priority ?? TicketPriority.NORMAL,
        status: validUserIds.length ? EventServiceRequestStatus.ASSIGNED : EventServiceRequestStatus.NEW,
        additionalInfo: this.optionalTrim(input.additionalInfo),
        services: { create: services.map((service) => ({ serviceId: service.id })) },
        assignees: { create: validUserIds.map((userId) => ({ userId, role: "Manual assignment" })) },
        activity: {
          create: {
            userId: user.id,
            action: "event_service_request.created_internal",
            metadata: { serviceIds: services.map((service) => service.id), assignedUserIds: validUserIds }
          }
        }
      },
      include: this.requestInclude(true)
    });

    await Promise.all([
      this.notifications.notifyNewEventRequestCreated({ requestId: request.id, organizationId: user.organizationId }),
      this.notifyAssignedUsers(request.id, "New event request assigned", `${request.trackingNumber}: ${request.eventName}`, "eventAssignedToMe", user.id)
    ]);

    return request;
  }

  async list(user: AuthenticatedUser, query: ListEventServiceRequestsDto) {
    const where: Prisma.EventServiceRequestWhereInput = {
      organizationId: user.organizationId,
      deletedAt: null
    };
    if (query.status) {
      where.status = query.status as EventServiceRequestStatus;
    }
    if (query.assignedUserId) {
      where.assignees = { some: { userId: query.assignedUserId } };
    }
    if (query.externalSpecialistId) {
      where.OR = [
        ...(Array.isArray(where.OR) ? where.OR : []),
        { externalSpecialists: { some: { externalSpecialistId: query.externalSpecialistId } } },
        { tasks: { some: { externalSpecialistId: query.externalSpecialistId } } }
      ];
    }
    if (query.serviceId) {
      where.services = { some: { serviceId: query.serviceId } };
    }
    const search = query.search?.trim();
    if (search) {
      const searchFilter: Prisma.EventServiceRequestWhereInput = { OR: [
        { trackingNumber: { contains: search, mode: "insensitive" } },
        { eventName: { contains: search, mode: "insensitive" } },
        { requesterEmail: { contains: search, mode: "insensitive" } },
        { requesterFirstName: { contains: search, mode: "insensitive" } },
        { requesterLastName: { contains: search, mode: "insensitive" } },
        { venue: { contains: search, mode: "insensitive" } }
      ] };
      if (where.OR) {
        where.AND = [{ OR: where.OR }, searchFilter];
        delete where.OR;
      } else {
        where.AND = [...(Array.isArray(where.AND) ? where.AND : []), searchFilter];
      }
    }

    const sortBy = query.sortBy ?? "updatedAt";
    return this.prisma.eventServiceRequest.findMany({
      where,
      include: this.requestInclude(),
      orderBy: { [sortBy]: "desc" },
      take: 150
    });
  }

  async listCalendar(user: AuthenticatedUser, query: ListEventServiceCalendarDto) {
    const where: Prisma.EventServiceRequestWhereInput = {
      organizationId: user.organizationId,
      deletedAt: null
    };
    const start = this.parseOptionalDate(query.start);
    const end = this.parseOptionalDate(query.end);
    if (start || end) {
      where.eventDate = {
        ...(start ? { gte: start } : {}),
        ...(end ? { lte: end } : {})
      };
    }
    if (query.status) {
      where.status = query.status as EventServiceRequestStatus;
    }
    if (query.assignedUserId) {
      where.OR = [
        { assignees: { some: { userId: query.assignedUserId } } },
        { tasks: { some: { assignedUserId: query.assignedUserId } } }
      ];
    }
    if (query.externalSpecialistId) {
      where.OR = [
        ...(Array.isArray(where.OR) ? where.OR : []),
        { externalSpecialists: { some: { externalSpecialistId: query.externalSpecialistId } } },
        { tasks: { some: { externalSpecialistId: query.externalSpecialistId } } }
      ];
    }
    if (query.serviceId) {
      where.services = { some: { serviceId: query.serviceId } };
    }

    return this.prisma.eventServiceRequest.findMany({
      where,
      include: this.requestInclude(),
      orderBy: [{ eventDate: "asc" }, { startTime: "asc" }, { updatedAt: "desc" }],
      take: 250
    });
  }

  async get(requestRef: string, user: AuthenticatedUser) {
    const normalizedRef = requestRef.trim();
    const requestMatchers: Prisma.EventServiceRequestWhereInput[] = [{ trackingNumber: normalizedRef.toUpperCase() }];
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedRef)) {
      requestMatchers.push({ id: normalizedRef });
    }
    const request = await this.prisma.eventServiceRequest.findFirst({
      where: {
        organizationId: user.organizationId,
        deletedAt: null,
        OR: requestMatchers
      },
      include: this.requestInclude(true)
    });
    if (!request) {
      throw new NotFoundException("Event service request was not found.");
    }
    return request;
  }

  async listMyTasks(user: AuthenticatedUser) {
    return this.prisma.eventServiceTask.findMany({
      where: {
        assignedUserId: user.id,
        request: {
          organizationId: user.organizationId,
          deletedAt: null
        }
      },
      include: {
        assignedUser: { select: this.userSelect() },
        request: {
          include: this.requestInclude()
        }
      },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }, { id: "asc" }]
    });
  }

  async update(requestId: string, user: AuthenticatedUser, input: UpdateEventServiceRequestDto) {
    const existing = await this.get(requestId, user);
    const assignedUserIds = input.assignedUserIds === undefined ? null : await this.validUserIds(user.organizationId, input.assignedUserIds);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (assignedUserIds) {
        await tx.eventServiceAssignee.deleteMany({ where: { requestId } });
        if (assignedUserIds.length) {
          await tx.eventServiceAssignee.createMany({
            data: assignedUserIds.map((userId) => ({ requestId, userId })),
            skipDuplicates: true
          });
        }
      }

      return tx.eventServiceRequest.update({
        where: { id: requestId },
        data: {
          status: input.status,
          priority: input.priority,
          additionalInfo: input.additionalInfo === undefined ? undefined : this.optionalTrim(input.additionalInfo),
          completedAt: input.status === EventServiceRequestStatus.COMPLETED ? new Date() : undefined,
          cancelledAt: input.status === EventServiceRequestStatus.CANCELLED ? new Date() : undefined
        },
        include: this.requestInclude(true)
      });
    });

    await this.logActivity(requestId, user.id, "event_service_request.updated", {
      status: input.status,
      priority: input.priority,
      assignedUserIds: assignedUserIds ?? undefined
    });
    await this.notifyAssignedUsers(requestId, "Event request updated", `${updated.trackingNumber}: ${updated.eventName}`, "eventRequestUpdated", user.id);
    if (input.status && input.status !== existing.status) {
      const autoReply = await this.autoReplies.sendForEventStatusChange({
        organizationId: user.organizationId,
        requestId,
        status: input.status
      });
      if (autoReply.sent) {
        await this.logActivity(requestId, user.id, "event_service_request.status_auto_reply_sent", {
          status: input.status,
          templateId: autoReply.templateId,
          messageId: autoReply.messageId
        });
      }
    }

    return updated;
  }

  async listRecycleBin(user: AuthenticatedUser) {
    return this.prisma.eventServiceRequest.findMany({
      where: { organizationId: user.organizationId, deletedAt: { not: null } },
      include: this.requestInclude(),
      orderBy: { deletedAt: "desc" },
      take: 150
    });
  }

  async moveToRecycleBin(user: AuthenticatedUser, requestIds: string[]) {
    const ids = [...new Set(requestIds)];
    if (ids.length === 0) {
      return { deleted: 0 };
    }

    const result = await this.prisma.eventServiceRequest.updateMany({
      where: { id: { in: ids }, organizationId: user.organizationId, deletedAt: null },
      data: { deletedAt: new Date() }
    });

    await this.auditLogs.create({
      userId: user.id,
      entityType: "EventServiceRequest",
      entityId: null,
      action: "event_service_request.bulk_deleted",
      metadata: { requestIds: ids, deleted: result.count }
    });

    return { deleted: result.count };
  }

  async restoreFromRecycleBin(user: AuthenticatedUser, requestIds: string[]) {
    const ids = [...new Set(requestIds)];
    if (ids.length === 0) {
      return { restored: 0 };
    }

    const result = await this.prisma.eventServiceRequest.updateMany({
      where: { id: { in: ids }, organizationId: user.organizationId, deletedAt: { not: null } },
      data: { deletedAt: null }
    });

    await this.auditLogs.create({
      userId: user.id,
      entityType: "EventServiceRequest",
      entityId: null,
      action: "event_service_request.bulk_restored",
      metadata: { requestIds: ids, restored: result.count }
    });

    return { restored: result.count };
  }

  async createTask(requestId: string, user: AuthenticatedUser, input: CreateEventServiceTaskDto) {
    await this.get(requestId, user);
    this.ensureSingleTaskAssignee(input.assignedUserId, input.externalSpecialistId);
    if (input.assignedUserId) {
      await this.ensureUser(input.assignedUserId, user.organizationId);
    }
    if (input.externalSpecialistId) {
      await this.externalSpecialists.ensure(input.externalSpecialistId, user.organizationId);
    }
    const task = await this.prisma.eventServiceTask.create({
      data: {
        requestId,
        title: input.title.trim(),
        description: this.optionalTrim(input.description),
        assignedUserId: input.assignedUserId ?? null,
        externalSpecialistId: input.externalSpecialistId ?? null,
        dueAt: this.parseOptionalDate(input.dueAt)
      },
      include: { assignedUser: { select: this.userSelect() }, externalSpecialist: true }
    });
    await this.logActivity(requestId, user.id, "event_service_task.created", { taskId: task.id, title: task.title });
    if (task.assignedUserId) {
      await this.notifyTaskAssignee(task.assignedUserId, requestId, task.id, "Event task assigned", task.title, "eventTaskAssignedToMe");
    }
    return task;
  }

  async updateTask(requestId: string, taskId: string, user: AuthenticatedUser, input: UpdateEventServiceTaskDto) {
    await this.get(requestId, user);
    this.ensureSingleTaskAssignee(input.assignedUserId, input.externalSpecialistId);
    if (input.assignedUserId) {
      await this.ensureUser(input.assignedUserId, user.organizationId);
    }
    if (input.externalSpecialistId) {
      await this.externalSpecialists.ensure(input.externalSpecialistId, user.organizationId);
    }
    const task = await this.prisma.eventServiceTask.update({
      where: { id: taskId },
      data: {
        title: input.title?.trim(),
        description: input.description === undefined ? undefined : this.optionalTrim(input.description),
        status: input.status,
        assignedUserId: input.assignedUserId === undefined ? (input.externalSpecialistId ? null : undefined) : input.assignedUserId,
        externalSpecialistId: input.externalSpecialistId === undefined ? (input.assignedUserId ? null : undefined) : input.externalSpecialistId,
        dueAt: input.dueAt === undefined ? undefined : this.parseOptionalDate(input.dueAt)
      },
      include: { assignedUser: { select: this.userSelect() }, externalSpecialist: true }
    });
    await this.logActivity(requestId, user.id, "event_service_task.updated", { taskId, status: task.status });
    await this.notifyAssignedUsers(requestId, "Event task updated", `${task.title} is ${this.statusLabel(task.status)}`, "eventTaskUpdated", user.id, taskId);
    return task;
  }

  async addExternalSpecialist(requestId: string, user: AuthenticatedUser, input: AddEventServiceExternalSpecialistDto) {
    await this.get(requestId, user);
    await this.externalSpecialists.ensure(input.externalSpecialistId, user.organizationId);
    const assignment = await this.prisma.eventServiceExternalSpecialist.upsert({
      where: {
        requestId_externalSpecialistId: {
          requestId,
          externalSpecialistId: input.externalSpecialistId
        }
      },
      create: {
        requestId,
        externalSpecialistId: input.externalSpecialistId,
        role: this.optionalTrim(input.role)
      },
      update: {
        role: this.optionalTrim(input.role)
      },
      include: { externalSpecialist: true }
    });
    await this.logActivity(requestId, user.id, "event_service_external_specialist.assigned", { externalSpecialistId: input.externalSpecialistId });
    return assignment;
  }

  async removeExternalSpecialist(requestId: string, assignmentId: string, user: AuthenticatedUser) {
    await this.get(requestId, user);
    const assignment = await this.prisma.eventServiceExternalSpecialist.findFirst({
      where: { id: assignmentId, requestId }
    });
    if (!assignment) {
      throw new NotFoundException("External specialist assignment was not found.");
    }
    await this.prisma.eventServiceExternalSpecialist.delete({ where: { id: assignmentId } });
    await this.prisma.eventServiceTask.updateMany({
      where: { requestId, externalSpecialistId: assignment.externalSpecialistId },
      data: { externalSpecialistId: null }
    });
    await this.logActivity(requestId, user.id, "event_service_external_specialist.removed", { externalSpecialistId: assignment.externalSpecialistId });
    return { deleted: true };
  }

  async sendExternalTaskInvite(requestId: string, taskId: string, user: AuthenticatedUser, input: SendEventServiceExternalInviteDto) {
    const request = await this.get(requestId, user);
    const task = await this.prisma.eventServiceTask.findFirst({
      where: { id: taskId, requestId },
      include: { externalSpecialist: true }
    });
    if (!task) {
      throw new NotFoundException("Event task was not found.");
    }
    if (!task.externalSpecialist) {
      throw new BadRequestException("Assign this task to an external specialist before sending an external invite.");
    }

    const start = task.dueAt ?? this.requestStartDate(request);
    if (!start) {
      throw new BadRequestException("Set a task due date or event date before sending a calendar invite.");
    }
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const location = this.optionalTrim(input.location) ?? request.venue ?? "";
    const message = this.optionalTrim(input.message) ?? task.description ?? request.additionalInfo ?? "";
    const settings = await this.getCalendarSettings(user);
    const templateValues = {
      specialistName: task.externalSpecialist.name,
      specialistEmail: task.externalSpecialist.email,
      taskTitle: task.title,
      eventName: request.eventName,
      trackingNumber: request.trackingNumber,
      dateTime: start.toLocaleString(),
      location,
      notes: message
    };
    const subject = this.renderTemplate(settings.eventExternalInviteSubjectTemplate, templateValues) || `${request.trackingNumber}: ${task.title}`;
    const calendarLinks = this.calendarLinks(subject, start, end, location, message);
    const defaultBodyText = [
      `Hello ${task.externalSpecialist.name},`,
      "",
      "You have been assigned an event service task.",
      "",
      `Task: ${task.title}`,
      `Event: ${request.eventName}`,
      `Tracking: ${request.trackingNumber}`,
      `Date/time: ${start.toLocaleString()}`,
      location ? `Location: ${location}` : null,
      message ? `Notes: ${message}` : null,
      "",
      `Google Calendar: ${calendarLinks.google}`,
      `Outlook Calendar: ${calendarLinks.outlook}`,
      "",
      "A calendar file is attached."
    ].filter(Boolean).join("\n");
    const bodyText = this.renderTemplate(settings.eventExternalInviteBodyTemplate, { ...templateValues, googleCalendarLink: calendarLinks.google, outlookCalendarLink: calendarLinks.outlook }) || defaultBodyText;
    const bodyHtml = this.htmlSanitizer.sanitize(
      `<p>${this.escapeHtml(bodyText).replace(/\n/g, "<br>")}</p>`
    );

    const sendResult = await this.mailDelivery.sendTicketReply({
      organizationId: user.organizationId,
      to: [task.externalSpecialist.email],
      subject,
      bodyText,
      bodyHtml,
      rawAttachments: [
        {
          originalFilename: `${request.trackingNumber}-${task.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "event-task"}.ics`,
          mimeType: "text/calendar",
          sizeBytes: Buffer.byteLength(this.icsContent(subject, start, end, location, message)),
          contentBytes: Buffer.from(this.icsContent(subject, start, end, location, message), "utf8")
        }
      ]
    });
    if (!sendResult) {
      throw new BadRequestException("Outbound email is disabled for the active mailbox.");
    }

    const updated = await this.prisma.eventServiceTask.update({
      where: { id: task.id },
      data: {
        calendarUserEmail: task.externalSpecialist.email,
        calendarSyncedAt: new Date(),
        calendarSyncError: null
      },
      include: { assignedUser: { select: this.userSelect() }, externalSpecialist: true }
    });
    await this.logActivity(request.id, user.id, "event_service_task.external_invite_sent", {
      taskId: task.id,
      taskTitle: task.title,
      externalSpecialistId: task.externalSpecialist.id,
      externalSpecialistName: task.externalSpecialist.name,
      externalSpecialistEmail: task.externalSpecialist.email,
      calendarUserEmail: task.externalSpecialist.email
    });
    return updated;
  }

  async updateMyTask(taskId: string, user: AuthenticatedUser, input: UpdateMyEventServiceTaskDto) {
    const task = await this.prisma.eventServiceTask.findFirst({
      where: {
        id: taskId,
        assignedUserId: user.id,
        request: { organizationId: user.organizationId, deletedAt: null }
      },
      select: { id: true, requestId: true, title: true }
    });
    if (!task) {
      throw new NotFoundException("Assigned event task was not found.");
    }

    const updated = await this.prisma.eventServiceTask.update({
      where: { id: taskId },
      data: {
        status: input.status
      },
      include: {
        assignedUser: { select: this.userSelect() },
        request: { include: this.requestInclude() }
      }
    });
    if (input.comment?.trim()) {
      await this.prisma.eventServiceComment.create({
        data: { requestId: task.requestId, userId: user.id, body: input.comment.trim() }
      });
    }
    await this.logActivity(task.requestId, user.id, "event_service_task.self_updated", {
      taskId,
      status: input.status,
      commentAdded: Boolean(input.comment?.trim())
    });
    await this.notifyAssignedUsers(task.requestId, "Event task updated", `${task.title} was updated by ${user.email}`, "eventTaskUpdated", user.id, taskId);
    return updated;
  }

  async addComment(requestId: string, user: AuthenticatedUser, input: CreateEventServiceCommentDto) {
    await this.get(requestId, user);
    const comment = await this.prisma.eventServiceComment.create({
      data: { requestId, userId: user.id, body: input.body.trim() },
      include: { user: { select: this.userSelect() } }
    });
    await this.logActivity(requestId, user.id, "event_service_comment.created", { commentId: comment.id });
    await this.notifyAssignedUsers(requestId, "Event comment added", input.body.trim().slice(0, 240), "eventCommentAdded", user.id);
    return comment;
  }

  async sendMessage(requestId: string, user: AuthenticatedUser, input: CreateEventServiceMessageDto) {
    const request = await this.get(requestId, user);
    const bodyText = input.bodyText.trim();
    if (!bodyText) {
      throw new BadRequestException("Message body is required.");
    }
    const isInternal = input.visibility === "internal";
    const sanitizedBodyHtml = input.bodyHtml ? this.htmlSanitizer.sanitize(input.bodyHtml) : `<p>${this.escapeHtml(bodyText).replace(/\n/g, "<br>")}</p>`;
    const ccEmails = isInternal ? [] : await this.resolveCcEmails(input.ccEmails ?? [], input.ccUserIds ?? [], user.organizationId);
    const notifiedUserIds = [...new Set(input.notifyUserIds ?? [])];
    const attachmentIds = [...new Set(input.attachmentIds ?? [])];
    const rawAttachments = isInternal ? [] : await this.attachments.loadOutboundAttachments(request.id, attachmentIds);
    let sendResult = null;
    if (!isInternal) {
      const latestInboundMessage = await this.prisma.eventServiceMessage.findFirst({
        where: {
          requestId: request.id,
          direction: MessageDirection.INBOUND,
          visibility: MessageVisibility.PUBLIC,
          senderEmail: { not: null }
        },
        orderBy: { createdAt: "desc" }
      });
      const subject = `Re: Event request ${request.trackingNumber} - ${request.eventName}`;
      sendResult = await this.mailDelivery.sendTicketReply({
        organizationId: user.organizationId,
        to: [request.requesterEmail],
        cc: ccEmails,
        subject,
        bodyText,
        bodyHtml: sanitizedBodyHtml,
        inReplyTo: latestInboundMessage?.emailInternetMessageId ?? latestInboundMessage?.emailMessageId ?? null,
        references: latestInboundMessage?.emailReferences ?? latestInboundMessage?.emailInternetMessageId ?? null,
        replyToProviderMessageId: latestInboundMessage?.emailMessageId ?? undefined,
        rawAttachments
      });
      if (!sendResult) {
        throw new BadRequestException("Outbound email is disabled for the active mailbox.");
      }
    }

    const message = await this.prisma.eventServiceMessage.create({
      data: {
        requestId: request.id,
        authorUserId: user.id,
        direction: isInternal ? MessageDirection.INTERNAL : MessageDirection.OUTBOUND,
        visibility: isInternal ? MessageVisibility.INTERNAL : MessageVisibility.PUBLIC,
        bodyText,
        bodyHtml: input.bodyHtml ?? null,
        sanitizedBodyHtml,
        emailMessageId: sendResult?.providerMessageId ?? null,
        emailInternetMessageId: sendResult?.internetMessageId ?? null,
        emailConversationId: sendResult?.conversationId ?? null,
        ccEmails,
        notifiedUserIds,
        hasAttachments: Boolean(attachmentIds.length)
      },
      include: { authorUser: { select: this.userSelect() }, attachments: true }
    });

    if (attachmentIds.length) {
      await this.prisma.eventServiceAttachment.updateMany({
        where: {
          id: { in: attachmentIds },
          requestId: request.id,
          messageId: null,
          deletedAt: null
        },
        data: { messageId: message.id }
      });
    }

    await this.logActivity(request.id, user.id, "event_service_message.sent", { messageId: message.id });
    await Promise.all([
      this.notifyAssignedUsers(request.id, isInternal ? "Event internal note added" : "Event requester message sent", bodyText.slice(0, 240), "eventCommentAdded", user.id),
      ...notifiedUserIds
        .filter((userId) => userId !== user.id)
        .map((userId) =>
          this.notifyTaskAssignee(
            userId,
            request.id,
            null,
            isInternal ? "Event internal note added" : "Event requester message sent",
            bodyText.slice(0, 240),
            "eventCommentAdded",
            request.trackingNumber
          )
        )
    ]);
    return message;
  }

  async getCalendarSettings(user: AuthenticatedUser) {
    const settings = await this.prisma.systemSetting.findUnique({
      where: { organizationId: user.organizationId },
      select: {
        eventCalendarSyncEnabled: true,
        eventCalendarTenantId: true,
        eventCalendarClientId: true,
        eventCalendarClientSecretReference: true,
        eventCalendarDefaultTimeZone: true,
        eventExternalInviteSubjectTemplate: true,
        eventExternalInviteBodyTemplate: true
      }
    });
    return {
      eventCalendarSyncEnabled: settings?.eventCalendarSyncEnabled ?? false,
      eventCalendarTenantId: settings?.eventCalendarTenantId ?? null,
      eventCalendarClientId: settings?.eventCalendarClientId ?? null,
      eventCalendarClientSecretReference: settings?.eventCalendarClientSecretReference ?? "env:MICROSOFT_CLIENT_SECRET",
      eventCalendarDefaultTimeZone: settings?.eventCalendarDefaultTimeZone ?? "America/Chicago",
      eventExternalInviteSubjectTemplate: settings?.eventExternalInviteSubjectTemplate ?? null,
      eventExternalInviteBodyTemplate: settings?.eventExternalInviteBodyTemplate ?? null
    };
  }

  async updateCalendarSettings(user: AuthenticatedUser, input: UpdateEventServiceCalendarSettingsDto) {
    return this.prisma.systemSetting.update({
      where: { organizationId: user.organizationId },
      data: {
        eventCalendarSyncEnabled: input.eventCalendarSyncEnabled,
        eventCalendarTenantId: this.optionalTrim(input.eventCalendarTenantId),
        eventCalendarClientId: this.optionalTrim(input.eventCalendarClientId),
        eventCalendarClientSecretReference: this.optionalTrim(input.eventCalendarClientSecretReference),
        eventCalendarDefaultTimeZone: this.optionalTrim(input.eventCalendarDefaultTimeZone) ?? "America/Chicago",
        eventExternalInviteSubjectTemplate: this.optionalTrim(input.eventExternalInviteSubjectTemplate),
        eventExternalInviteBodyTemplate: this.optionalTrim(input.eventExternalInviteBodyTemplate)
      },
      select: {
        eventCalendarSyncEnabled: true,
        eventCalendarTenantId: true,
        eventCalendarClientId: true,
        eventCalendarClientSecretReference: true,
        eventCalendarDefaultTimeZone: true,
        eventExternalInviteSubjectTemplate: true,
        eventExternalInviteBodyTemplate: true
      }
    });
  }

  async syncTaskToCalendar(requestId: string, taskId: string, user: AuthenticatedUser, input: SyncEventServiceTaskCalendarDto) {
    const request = await this.get(requestId, user);
    const task = await this.prisma.eventServiceTask.findFirst({
      where: { id: taskId, requestId },
      include: { assignedUser: { select: this.userSelect() } }
    });
    if (!task) {
      throw new NotFoundException("Event task was not found.");
    }
    if (!task.assignedUser) {
      throw new BadRequestException("Assign the task to a specialist before syncing it to a calendar.");
    }
    const settings = await this.getCalendarSettings(user);
    if (!settings.eventCalendarSyncEnabled) {
      throw new BadRequestException("Event task calendar sync is disabled.");
    }

    const timeZone = settings.eventCalendarDefaultTimeZone || "America/Chicago";
    const { startDateTime, endDateTime } = this.resolveCalendarWindow(request, input);
    try {
      const event = await this.calendar.createEvent({
        tenantId: settings.eventCalendarTenantId,
        clientId: settings.eventCalendarClientId,
        clientSecretReference: settings.eventCalendarClientSecretReference,
        userEmail: task.assignedUser.email,
        subject: `${request.trackingNumber}: ${task.title}`,
        bodyHtml: this.htmlSanitizer.sanitize(
          `<p>${this.escapeHtml(task.description ?? input.notes ?? request.additionalInfo ?? request.eventName).replace(/\n/g, "<br>")}</p><p><strong>Event:</strong> ${this.escapeHtml(request.eventName)}<br><strong>Requester:</strong> ${this.escapeHtml(`${request.requesterFirstName} ${request.requesterLastName}`.trim())}<br><strong>Tracking:</strong> ${this.escapeHtml(request.trackingNumber)}</p>`
        ),
        startDateTime,
        endDateTime,
        timeZone,
        location: this.optionalTrim(input.location) ?? request.venue
      });
      const updated = await this.prisma.eventServiceTask.update({
        where: { id: task.id },
        data: {
          calendarEventId: event.id,
          calendarUserEmail: task.assignedUser.email,
          calendarSyncedAt: new Date(),
          calendarSyncError: null
        },
        include: { assignedUser: { select: this.userSelect() }, externalSpecialist: true }
      });
      await this.logActivity(request.id, user.id, "event_service_task.calendar_synced", { taskId: task.id, calendarEventId: event.id, calendarUserEmail: task.assignedUser.email });
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to sync task to Microsoft Calendar.";
      await this.prisma.eventServiceTask.update({
        where: { id: task.id },
        data: { calendarSyncError: message }
      });
      throw error;
    }
  }

  async listServices(user: AuthenticatedUser) {
    await this.ensureDefaultCatalog(user.organizationId);
    return this.prisma.eventServiceService.findMany({
      where: { organizationId: user.organizationId },
      orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { name: "asc" }]
    });
  }

  async getTurnstileConfig(user: AuthenticatedUser) {
    const settings = await this.prisma.systemSetting.findUnique({
      where: { organizationId: user.organizationId },
      select: {
        eventTurnstileEnabled: true,
        eventTurnstileSiteKey: true,
        eventTurnstileSecretReference: true
      }
    });

    return {
      eventTurnstileEnabled: settings?.eventTurnstileEnabled ?? false,
      eventTurnstileSiteKey: settings?.eventTurnstileSiteKey ?? null,
      eventTurnstileSecretReference: settings?.eventTurnstileSecretReference ?? DEFAULT_EVENT_TURNSTILE_SECRET_REFERENCE
    };
  }

  async getPortalConfig(user: AuthenticatedUser) {
    const settings = await this.prisma.systemSetting.findUnique({
      where: { organizationId: user.organizationId },
      select: { eventPortalBrowserTitle: true }
    });

    return {
      eventPortalBrowserTitle: settings?.eventPortalBrowserTitle ?? "Schedule Event Support"
    };
  }

  async updatePortalConfig(user: AuthenticatedUser, input: UpdateEventServicePortalSettingsDto) {
    const settings = await this.prisma.systemSetting.upsert({
      where: { organizationId: user.organizationId },
      create: {
        organizationId: user.organizationId,
        applicationName: this.config.get<string>("APP_NAME") ?? "Avidity IT Management Tool",
        companyName: this.config.get<string>("DEFAULT_COMPANY_NAME") ?? "Avidity Technologies",
        supportEmail: this.config.get<string>("DEFAULT_SUPPORT_EMAIL") ?? "support@aviditytechnologies.com",
        eventPortalBrowserTitle: input.eventPortalBrowserTitle.trim() || "Schedule Event Support"
      },
      update: {
        eventPortalBrowserTitle: input.eventPortalBrowserTitle.trim() || "Schedule Event Support"
      },
      select: {
        eventPortalBrowserTitle: true
      }
    });

    await this.auditLogs.create({
      userId: user.id,
      entityType: "EventServiceConfig",
      entityId: user.organizationId,
      action: "event_service.portal_updated",
      metadata: { eventPortalBrowserTitle: settings.eventPortalBrowserTitle }
    });

    return settings;
  }

  async updateTurnstileConfig(user: AuthenticatedUser, input: UpdateEventServiceTurnstileDto) {
    const eventTurnstileSecretReference = this.eventTurnstileSecretReference(input.eventTurnstileSecretReference);
    if (input.eventTurnstileEnabled && !eventTurnstileSecretReference.startsWith("env:")) {
      throw new BadRequestException("Event Turnstile secret reference must use an environment reference such as env:EVENT_TURNSTILE_SECRET_KEY.");
    }

    const settings = await this.prisma.systemSetting.upsert({
      where: { organizationId: user.organizationId },
      create: {
        organizationId: user.organizationId,
        applicationName: this.config.get<string>("APP_NAME") ?? "Avidity IT Management Tool",
        companyName: this.config.get<string>("DEFAULT_COMPANY_NAME") ?? "Avidity Technologies",
        supportEmail: this.config.get<string>("DEFAULT_SUPPORT_EMAIL") ?? "support@aviditytechnologies.com",
        eventTurnstileEnabled: input.eventTurnstileEnabled,
        eventTurnstileSiteKey: this.optionalTrim(input.eventTurnstileSiteKey),
        eventTurnstileSecretReference
      },
      update: {
        eventTurnstileEnabled: input.eventTurnstileEnabled,
        eventTurnstileSiteKey: this.optionalTrim(input.eventTurnstileSiteKey),
        eventTurnstileSecretReference
      },
      select: {
        eventTurnstileEnabled: true,
        eventTurnstileSiteKey: true,
        eventTurnstileSecretReference: true
      }
    });

    await this.auditLogs.create({
      userId: user.id,
      entityType: "EventServiceConfig",
      entityId: user.organizationId,
      action: "event_service.turnstile_updated",
      metadata: { eventTurnstileEnabled: settings.eventTurnstileEnabled }
    });

    return settings;
  }

  async createService(user: AuthenticatedUser, input: UpsertEventServiceServiceDto) {
    const service = await this.prisma.eventServiceService.create({
      data: this.serviceCreateData(user.organizationId, input)
    });
    await this.auditLogs.create({ userId: user.id, entityType: "EventServiceService", entityId: service.id, action: "event_service.service_created", metadata: { name: service.name } });
    return service;
  }

  async updateService(serviceId: string, user: AuthenticatedUser, input: UpsertEventServiceServiceDto) {
    await this.ensureService(serviceId, user.organizationId);
    const service = await this.prisma.eventServiceService.update({
      where: { id: serviceId },
      data: this.serviceUpdateData(input)
    });
    await this.auditLogs.create({ userId: user.id, entityType: "EventServiceService", entityId: service.id, action: "event_service.service_updated", metadata: { name: service.name } });
    return service;
  }

  async listFormFields(user: AuthenticatedUser) {
    await this.ensureDefaultCatalog(user.organizationId);
    const form = await this.prisma.eventServiceForm.findFirst({
      where: { organizationId: user.organizationId, slug: "default" },
      include: { fields: { orderBy: [{ sortOrder: "asc" }, { label: "asc" }] } }
    });
    if (!form) {
      throw new NotFoundException("Event services form is not configured.");
    }
    return form;
  }

  async createFormField(user: AuthenticatedUser, input: UpsertEventServiceFormFieldDto) {
    const form = await this.getActiveForm(user.organizationId);
    return this.prisma.eventServiceFormField.create({
      data: { formId: form.id, ...this.formFieldData(input) }
    });
  }

  async updateFormField(fieldId: string, user: AuthenticatedUser, input: UpsertEventServiceFormFieldDto) {
    const form = await this.getActiveForm(user.organizationId);
    const field = await this.prisma.eventServiceFormField.findFirst({ where: { id: fieldId, formId: form.id } });
    if (!field) {
      throw new NotFoundException("Form field was not found.");
    }
    return this.prisma.eventServiceFormField.update({
      where: { id: fieldId },
      data: this.formFieldData(input)
    });
  }

  private requestInclude(includeDetail = false) {
    return {
      client: { select: { id: true, name: true, shortName: true } },
      contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      linkedTicket: { select: { id: true, ticketNumber: true, subject: true } },
      services: { include: { service: true }, orderBy: { service: { name: "asc" } } },
      assignees: { include: { user: { select: this.userSelect() } }, orderBy: { createdAt: "asc" } },
      externalSpecialists: { include: { externalSpecialist: true }, orderBy: { createdAt: "asc" } },
      tasks: { include: { assignedUser: { select: this.userSelect() }, externalSpecialist: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      ...(includeDetail
        ? {
            comments: { include: { user: { select: this.userSelect() } }, orderBy: { createdAt: "desc" } },
            messages: {
              include: {
                authorUser: { select: this.userSelect() },
                attachments: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } }
              },
              orderBy: { createdAt: "desc" }
            },
            activity: { include: { user: { select: this.userSelect() } }, orderBy: { createdAt: "desc" }, take: 50 }
          }
        : {})
    } satisfies Prisma.EventServiceRequestInclude;
  }

  private userSelect() {
    return { id: true, firstName: true, lastName: true, email: true };
  }

  private async ensureDefaultCatalog(organizationId: string) {
    const serviceCount = await this.prisma.eventServiceService.count({ where: { organizationId } });
    if (serviceCount === 0) {
      await this.prisma.eventServiceService.createMany({
        data: [
          { organizationId, name: "Audio (Speakers & Microphone)", icon: "mic", description: "Audio setup, speakers, and microphones.", sortOrder: 10 },
          { organizationId, name: "Photography", icon: "camera", description: "Photography coverage for events.", sortOrder: 20 },
          { organizationId, name: "Videography", icon: "video", description: "Video recording and production support.", sortOrder: 30 }
        ],
        skipDuplicates: true
      });
    }

    let form = await this.prisma.eventServiceForm.findFirst({ where: { organizationId, slug: "default" } });
    if (!form) {
      form = await this.prisma.eventServiceForm.create({
        data: {
          organizationId,
          name: "Default Event Scheduling Request",
          slug: "default",
          introText: "Please ensure all fields are completed accurately so we can plan and provide the appropriate level of support for your event."
        }
      });
    }
    const fieldCount = await this.prisma.eventServiceFormField.count({ where: { formId: form.id } });
    if (fieldCount === 0) {
      await this.prisma.eventServiceFormField.createMany({
        data: [
          { formId: form.id, type: "TEXT", label: "Event Name", fieldKey: "eventName", isRequired: true, sortOrder: 10 },
          { formId: form.id, type: "TEXT", label: "Event Address and Venue Name", fieldKey: "venue", isRequired: true, sortOrder: 20 },
          { formId: form.id, type: "TEXT", label: "Organizer", fieldKey: "organizer", isRequired: true, sortOrder: 30 },
          { formId: form.id, type: "DATE", label: "Date", fieldKey: "eventDate", isRequired: true, sortOrder: 40 },
          { formId: form.id, type: "TEXTAREA", label: "Additional information", fieldKey: "additionalInfo", sortOrder: 50 }
        ]
      });
    }
  }

  private async getActiveForm(organizationId: string) {
    const form = await this.prisma.eventServiceForm.findFirst({
      where: { organizationId, slug: "default" },
      include: { fields: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } }
    });
    if (!form) {
      throw new NotFoundException("Event services form is not configured.");
    }
    return form;
  }

  private async getPublicOrganization() {
    const organization = await this.prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
    if (!organization) {
      throw new NotFoundException("Organization is not configured.");
    }
    return organization;
  }

  private async nextTrackingNumber(organizationId: string) {
    const key = `event-service:${organizationId}`;
    const sequence = await this.prisma.eventServiceSequence.upsert({
      where: { key },
      update: { currentValue: { increment: 1 } },
      create: { key, organizationId, prefix: "EVT", currentValue: 100001 }
    });
    return `${sequence.prefix}-${sequence.currentValue}`;
  }

  private async findClientMapping(email: string, organizationId: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const domain = normalizedEmail.split("@")[1] ?? "";
    const client = domain
      ? await this.prisma.client.findFirst({
          where: { organizationId, deletedAt: null, domains: { some: { domain, isActive: true } } },
          select: { id: true }
        })
      : null;
    if (!client) {
      return { clientId: null, contactId: null };
    }
    const contact = await this.prisma.contact.findFirst({
      where: { clientId: client.id, email: normalizedEmail, deletedAt: null },
      select: { id: true }
    });
    return { clientId: client.id, contactId: contact?.id ?? null };
  }

  private async verifyPublicTurnstile(organizationId: string, token: string | undefined, remoteIp?: string) {
    const settings = await this.prisma.systemSetting.findUnique({
      where: { organizationId },
      select: { eventTurnstileEnabled: true, eventTurnstileSecretReference: true, eventTurnstileSiteKey: true }
    });
    if (!settings?.eventTurnstileEnabled || !settings.eventTurnstileSiteKey) {
      return;
    }
    if (!token) {
      throw new UnauthorizedException("Security verification is required.");
    }
    const secret = this.resolveSecret(settings.eventTurnstileSecretReference ?? DEFAULT_EVENT_TURNSTILE_SECRET_REFERENCE);
    if (!secret) {
      throw new UnauthorizedException("Security verification is not configured.");
    }
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, ...(remoteIp ? { remoteip: remoteIp } : {}) })
    });
    const payload = (await response.json()) as { success?: boolean };
    if (!payload.success) {
      throw new UnauthorizedException("Security verification failed.");
    }
  }

  private resolveSecret(reference?: string | null) {
    if (!reference) return null;
    if (reference.startsWith("env:")) {
      return this.config.get<string>(reference.slice(4)) ?? null;
    }
    return null;
  }

  private eventTurnstileSecretReference(reference?: string | null) {
    return this.optionalTrim(reference) ?? DEFAULT_EVENT_TURNSTILE_SECRET_REFERENCE;
  }

  private validateTimeRange(startTime?: string, endTime?: string) {
    if (startTime && !TIME_PATTERN.test(startTime)) {
      throw new BadRequestException("Start time must use 15-minute intervals.");
    }
    if (endTime && !TIME_PATTERN.test(endTime)) {
      throw new BadRequestException("End time must use 15-minute intervals.");
    }
    if (startTime && endTime && startTime >= endTime) {
      throw new BadRequestException("End time must be later than start time.");
    }
  }

  private async validUserIds(organizationId: string, userIds: string[]) {
    const uniqueIds = [...new Set(userIds)];
    if (!uniqueIds.length) return [];
    const users = await this.prisma.user.findMany({
      where: { organizationId, id: { in: uniqueIds }, isActive: true, deletedAt: null },
      select: { id: true }
    });
    return users.map((user) => user.id);
  }

  private async ensureUser(userId: string, organizationId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, organizationId, isActive: true, deletedAt: null } });
    if (!user) throw new BadRequestException("Selected user was not found.");
  }

  private async ensureService(serviceId: string, organizationId: string) {
    const service = await this.prisma.eventServiceService.findFirst({ where: { id: serviceId, organizationId } });
    if (!service) throw new NotFoundException("Event service was not found.");
  }

  private serviceCreateData(organizationId: string, input: UpsertEventServiceServiceDto): Prisma.EventServiceServiceUncheckedCreateInput {
    return {
      organizationId,
      name: input.name.trim(),
      description: this.optionalTrim(input.description),
      icon: this.optionalTrim(input.icon),
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
      defaultUserIds: input.defaultUserIds ?? []
    };
  }

  private serviceUpdateData(input: UpsertEventServiceServiceDto): Prisma.EventServiceServiceUncheckedUpdateInput {
    return {
      name: input.name.trim(),
      description: this.optionalTrim(input.description),
      icon: this.optionalTrim(input.icon),
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
      defaultUserIds: input.defaultUserIds ?? []
    };
  }

  private formFieldData(input: UpsertEventServiceFormFieldDto) {
    const fieldKey = input.fieldKey.trim();
    const optionTypes: EventServiceFieldType[] = ["SELECT", "MULTI_SELECT", "CHECKBOX", "RADIO"];
    const options = input.options?.map((option) => option.trim()).filter(Boolean) ?? [];
    if (!/^[a-z][a-zA-Z0-9_]*$/.test(fieldKey)) {
      throw new BadRequestException("Field key must start with a lowercase letter and use only letters, numbers, or underscores.");
    }
    if (optionTypes.includes(input.type) && options.length === 0) {
      throw new BadRequestException("Selection fields require at least one option.");
    }
    return {
      type: input.type,
      label: input.label.trim(),
      fieldKey,
      placeholder: this.optionalTrim(input.placeholder),
      helpText: this.optionalTrim(input.helpText),
      isRequired: input.isRequired ?? false,
      options,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true
    };
  }

  private validatePublicFormData(fields: Array<{ fieldKey: string; label: string; isRequired: boolean; isActive: boolean }>, input: CreatePublicEventServiceRequestDto) {
    const fixedValues: Record<string, unknown> = {
      eventName: input.eventName,
      venue: input.venue,
      organizer: input.organizer,
      eventDate: input.eventDate,
      additionalInfo: input.additionalInfo
    };
    const data = (input.formData ?? {}) as Record<string, unknown>;
    for (const field of fields) {
      if (!field.isActive || !field.isRequired) continue;
      const value = Object.prototype.hasOwnProperty.call(fixedValues, field.fieldKey) ? fixedValues[field.fieldKey] : data[field.fieldKey];
      const missing = Array.isArray(value) ? value.length === 0 : value === undefined || value === null || String(value).trim() === "";
      if (missing) {
        throw new BadRequestException(`${field.label} is required.`);
      }
    }
  }

  private async notifyAssignedUsers(requestId: string, title: string, body: string, eventType: NotificationEventType, excludeUserId?: string, taskId?: string) {
    const assignees = await this.prisma.eventServiceAssignee.findMany({ where: { requestId }, select: { userId: true } });
    const request = await this.prisma.eventServiceRequest.findUnique({ where: { id: requestId }, select: { trackingNumber: true } });
    await Promise.all(
      assignees
        .map((assignee) => assignee.userId)
        .filter((userId) => userId !== excludeUserId)
        .map((userId) => this.notifyTaskAssignee(userId, requestId, taskId ?? null, title, body, eventType, request?.trackingNumber ?? null))
    );
  }

  private async notifyTaskAssignee(userId: string, requestId: string, taskId: string | null, title: string, body: string, eventType: NotificationEventType, trackingNumber?: string | null) {
    const resolvedTrackingNumber = trackingNumber ?? (await this.prisma.eventServiceRequest.findUnique({ where: { id: requestId }, select: { trackingNumber: true } }))?.trackingNumber ?? null;
    return this.notifications.notifyUser({
      userId,
      title,
      body,
      eventType,
      eventServiceRequestId: requestId,
      eventServiceTaskId: taskId,
      metadata: {
        entityType: "EventServiceRequest",
        requestId,
        ...(resolvedTrackingNumber ? { trackingNumber: resolvedTrackingNumber } : {}),
        ...(taskId ? { taskId } : {})
      }
    });
  }

  private async resolveCcEmails(ccEmails: string[], ccUserIds: string[], organizationId: string) {
    const manualEmails = ccEmails.map((email) => email.trim().toLowerCase()).filter(Boolean);
    if (!ccUserIds.length) {
      return [...new Set(manualEmails)];
    }

    const users = await this.prisma.user.findMany({
      where: {
        id: { in: [...new Set(ccUserIds)] },
        organizationId,
        isActive: true,
        deletedAt: null
      },
      select: { email: true }
    });

    return [...new Set([...manualEmails, ...users.map((item) => item.email.toLowerCase())])];
  }

  private async sendRequesterInitialResponse(request: { id: string; organizationId: string; trackingNumber: string; eventName: string; requesterEmail: string; requesterFirstName: string; eventDate: Date | null; startTime: string | null; endTime: string | null }) {
    const autoReply = await this.autoReplies.sendForNewEventRequest({
      organizationId: request.organizationId,
      requestId: request.id
    });
    if (autoReply.sent) {
      await this.logActivity(request.id, null, "event_service_request.auto_reply_sent", {
        templateId: autoReply.templateId,
        messageId: autoReply.messageId
      });
      return;
    }

    await this.sendRequesterConfirmation(request);
  }

  private async sendRequesterConfirmation(request: { organizationId: string; trackingNumber: string; eventName: string; requesterEmail: string; requesterFirstName: string; eventDate: Date | null; startTime: string | null; endTime: string | null }) {
    const settings = await this.prisma.systemSetting.findUnique({
      where: { organizationId: request.organizationId },
      select: { applicationName: true, companyName: true, supportEmail: true }
    });
    const subject = `Event request received: ${request.trackingNumber}`;
    const bodyText = `Hello ${request.requesterFirstName},\n\nWe received your event request.\n\nTracking number: ${request.trackingNumber}\nEvent: ${request.eventName}\nDate: ${request.eventDate ? request.eventDate.toDateString() : "Not provided"}\nTime: ${request.startTime ?? "Not provided"} - ${request.endTime ?? "Not provided"}\n\nKeep this tracking number for follow-up.\n\n${settings?.companyName ?? "Avidity Technologies"}`;
    const bodyHtml = `<p>Hello ${this.escapeHtml(request.requesterFirstName)},</p><p>We received your event request.</p><p><strong>Tracking number:</strong> ${this.escapeHtml(request.trackingNumber)}<br/><strong>Event:</strong> ${this.escapeHtml(request.eventName)}<br/><strong>Date:</strong> ${request.eventDate ? this.escapeHtml(request.eventDate.toDateString()) : "Not provided"}<br/><strong>Time:</strong> ${this.escapeHtml(request.startTime ?? "Not provided")} - ${this.escapeHtml(request.endTime ?? "Not provided")}</p><p>Keep this tracking number for follow-up.</p><p>${this.escapeHtml(settings?.companyName ?? "Avidity Technologies")}</p>`;
    await this.mailDelivery.sendTicketReply({
      organizationId: request.organizationId,
      to: [request.requesterEmail],
      subject,
      bodyText,
      bodyHtml
    });
  }

  private logActivity(requestId: string, userId: string | null, action: string, metadata?: Prisma.InputJsonValue) {
    return this.prisma.eventServiceActivity.create({
      data: { requestId, userId, action, metadata }
    });
  }

  private statusLabel(status: EventServiceTaskStatus) {
    return status.toLowerCase().replace(/_/g, " ");
  }

  private ensureSingleTaskAssignee(assignedUserId?: string | null, externalSpecialistId?: string | null) {
    if (assignedUserId && externalSpecialistId) {
      throw new BadRequestException("Assign a task to either an internal user or an external specialist, not both.");
    }
  }

  private optionalTrim(value: string | null | undefined) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private parseOptionalDate(value: string | null | undefined) {
    const trimmed = this.optionalTrim(value);
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private resolveCalendarWindow(request: { eventDate: Date | null; startTime: string | null; endTime: string | null }, input: SyncEventServiceTaskCalendarDto) {
    const baseDate = input.startDate ?? input.endDate ?? (request.eventDate ? request.eventDate.toISOString().slice(0, 10) : null);
    if (!baseDate) {
      throw new BadRequestException("Select a calendar date for this task.");
    }
    const startTime = input.startTime ?? request.startTime ?? "09:00";
    const endTime = input.endTime ?? request.endTime ?? this.addOneHour(startTime);
    const endDate = input.endDate ?? baseDate;
    return {
      startDateTime: `${baseDate}T${startTime}:00`,
      endDateTime: `${endDate}T${endTime}:00`
    };
  }

  private addOneHour(time: string) {
    const [hourValue, minuteValue] = time.split(":").map((part) => Number(part));
    const hour = Number.isFinite(hourValue) ? hourValue : 9;
    const minute = Number.isFinite(minuteValue) ? minuteValue : 0;
    return `${String((hour + 1) % 24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  private requestStartDate(request: { eventDate: Date | null; startTime: string | null }) {
    if (!request.eventDate) {
      return null;
    }
    const date = request.eventDate.toISOString().slice(0, 10);
    const time = request.startTime ?? "09:00";
    return new Date(`${date}T${time}:00`);
  }

  private calendarLinks(subject: string, start: Date, end: Date, location: string, details: string) {
    const dates = `${this.calendarStamp(start)}/${this.calendarStamp(end)}`;
    const params = new URLSearchParams({
      text: subject,
      dates,
      details,
      location
    });
    const outlookParams = new URLSearchParams({
      subject,
      startdt: start.toISOString(),
      enddt: end.toISOString(),
      body: details,
      location
    });
    return {
      google: `https://calendar.google.com/calendar/render?action=TEMPLATE&${params.toString()}`,
      outlook: `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&${outlookParams.toString()}`
    };
  }

  private icsContent(subject: string, start: Date, end: Date, location: string, description: string) {
    const now = this.calendarStamp(new Date());
    const uid = `${now}-${Math.random().toString(36).slice(2)}@avidity-one`;
    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Avidity One//Event Services//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${this.calendarStamp(start)}`,
      `DTEND:${this.calendarStamp(end)}`,
      `SUMMARY:${this.escapeCalendarText(subject)}`,
      location ? `LOCATION:${this.escapeCalendarText(location)}` : null,
      description ? `DESCRIPTION:${this.escapeCalendarText(description)}` : null,
      "END:VEVENT",
      "END:VCALENDAR"
    ].filter(Boolean).join("\r\n");
  }

  private calendarStamp(value: Date) {
    return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  }

  private escapeCalendarText(value: string) {
    return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  }

  private renderTemplate(template: string | null | undefined, values: Record<string, string>) {
    const source = this.optionalTrim(template);
    if (!source) return "";
    return source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => values[key] ?? "");
  }

  private escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);
  }
}
