import { Injectable, Logger, Optional, NotFoundException } from "@nestjs/common";
import { TicketEmailService } from "../ticket-email/ticket-email.service";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { MailDeliveryService } from "../mailboxes/mail-delivery.service";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateNotificationPreferencesDto } from "./dto/update-notification-preferences.dto";

export type NotificationEventType =
  | "ticketAssignedToMe"
  | "ticketAssignedToMyTeam"
  | "ticketReplyOnAssignedTicket"
  | "internalNoteOnAssignedTicket"
  | "internalNoteMention"
  | "routingRuleMatched"
  | "ticketReopened"
  | "newTicketCreated"
  | "newEventRequestCreated"
  | "eventAssignedToMe"
  | "eventRequestUpdated"
  | "eventTaskAssignedToMe"
  | "eventTaskUpdated"
  | "eventCommentAdded"
  | "projectDecisionAlert"
  | "projectDecisionDigest";

interface NotifyUserInput {
  userId: string;
  messageId?: string;
  ticketId?: string | null;
  eventServiceRequestId?: string | null;
  eventServiceTaskId?: string | null;
  title: string;
  body?: string | null;
  eventType: NotificationEventType;
  metadata?: Prisma.InputJsonValue;
}

const EVENT_CHANNEL_FIELDS: Record<NotificationEventType, { inApp: keyof UpdateNotificationPreferencesDto; email: keyof UpdateNotificationPreferencesDto; legacy?: keyof UpdateNotificationPreferencesDto }> = {
  ticketAssignedToMe: { inApp: "inAppTicketAssignedToMe", email: "emailTicketAssignedToMe", legacy: "ticketAssignedToMe" },
  ticketAssignedToMyTeam: { inApp: "inAppTicketAssignedToMyTeam", email: "emailTicketAssignedToMyTeam", legacy: "ticketAssignedToMyTeam" },
  ticketReplyOnAssignedTicket: { inApp: "inAppTicketReplyOnAssignedTicket", email: "emailTicketReplyOnAssignedTicket", legacy: "ticketReplyOnAssignedTicket" },
  internalNoteOnAssignedTicket: { inApp: "inAppInternalNoteOnAssignedTicket", email: "emailInternalNoteOnAssignedTicket", legacy: "internalNoteOnAssignedTicket" },
  internalNoteMention: { inApp: "inAppInternalNoteMention", email: "emailInternalNoteMention", legacy: "internalNoteMention" },
  routingRuleMatched: { inApp: "inAppRoutingRuleMatched", email: "emailRoutingRuleMatched", legacy: "routingRuleMatched" },
  ticketReopened: { inApp: "inAppTicketReopened", email: "emailTicketReopened", legacy: "ticketReopened" },
  newTicketCreated: { inApp: "inAppNewTicketCreated", email: "emailNewTicketCreated", legacy: "newTicketCreated" },
  newEventRequestCreated: { inApp: "inAppNewEventRequestCreated", email: "emailNewEventRequestCreated" },
  eventAssignedToMe: { inApp: "inAppEventAssignedToMe", email: "emailEventAssignedToMe" },
  eventRequestUpdated: { inApp: "inAppEventRequestUpdated", email: "emailEventRequestUpdated" },
  eventTaskAssignedToMe: { inApp: "inAppEventTaskAssignedToMe", email: "emailEventTaskAssignedToMe" },
  eventTaskUpdated: { inApp: "inAppEventTaskUpdated", email: "emailEventTaskUpdated" },
  eventCommentAdded: { inApp: "inAppEventCommentAdded", email: "emailEventCommentAdded" },
  projectDecisionAlert: { inApp: "inAppEnabled", email: "emailEnabled" },
  projectDecisionDigest: { inApp: "inAppEnabled", email: "emailEnabled" }
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailDelivery: MailDeliveryService,
    private readonly config: ConfigService,
    @Optional() private readonly ticketEmail?: TicketEmailService
  ) {}

  async list(user: AuthenticatedUser) {
    return this.prisma.notification.findMany({
      where: { userId: user.id },
      include: {
        ticket: { select: { id: true, ticketNumber: true, subject: true, status: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 50
    });
  }

  async notifyUser(input: NotifyUserInput) {
    const [preferences, targetUser] = await Promise.all([
      this.getOrCreatePreference(input.userId),
      this.prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, organizationId: true, email: true, firstName: true, lastName: true, isActive: true, deletedAt: true }
      })
    ]);
    if (!targetUser || !targetUser.isActive || targetUser.deletedAt) {
      return null;
    }

    const inAppAllowed = preferences.inAppEnabled && this.isChannelEventEnabled(preferences, input.eventType, "inApp");
    const emailAllowed = preferences.emailEnabled && this.isChannelEventEnabled(preferences, input.eventType, "email");
    if (!inAppAllowed && !emailAllowed) {
      return null;
    }

    const notification = inAppAllowed
      ? await this.prisma.notification.create({
          data: {
            userId: input.userId,
            ticketId: input.ticketId ?? null,
            title: input.title,
            body: input.body ?? null,
            metadata: input.metadata ?? this.eventMetadata(input)
          }
        })
      : null;

    if (emailAllowed && !(input.ticketId && this.ticketEmail && await this.ticketEmail.enqueue({ organizationId: targetUser.organizationId, userId: input.userId, ticketId: input.ticketId, eventType: input.eventType, title: input.title, messageId: input.messageId }))) {
      await this.sendEmailNotification({
        organizationId: targetUser.organizationId,
        email: targetUser.email,
        title: input.title,
        body: input.body,
        ticketId: input.ticketId,
        eventServiceRequestId: input.eventServiceRequestId,
        eventServiceTaskId: input.eventServiceTaskId,
        eventType: input.eventType
      });
    }

    return notification;
  }

  async notifyNewTicketCreated(input: { ticketId: string; organizationId: string }) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: input.ticketId, organizationId: input.organizationId, deletedAt: null },
      select: {
        id: true,
        ticketNumber: true,
        subject: true,
        client: { select: { name: true } },
        contact: { select: { firstName: true, lastName: true, email: true } },
        senderEmail: true
      }
    });
    if (!ticket) {
      return { notified: 0 };
    }

    const preferences = await this.prisma.userNotificationPreference.findMany({
      where: {
        OR: [{ inAppNewTicketCreated: true }, { emailNewTicketCreated: true }, { newTicketCreated: true }],
        user: {
          organizationId: input.organizationId,
          isActive: true,
          deletedAt: null
        }
      },
      select: { userId: true }
    });
    const userIds = [...new Set(preferences.map((preference) => preference.userId))];
    const requester = ticket.contact
      ? `${ticket.contact.firstName} ${ticket.contact.lastName}`.trim()
      : ticket.senderEmail ?? "Unknown requester";
    const clientName = ticket.client?.name ?? "Unassigned client";

    await Promise.all(
      userIds.map((userId) =>
        this.notifyUser({
          userId,
          ticketId: ticket.id,
          eventType: "newTicketCreated",
          title: `New ticket created: ${ticket.ticketNumber}`,
          body: `${ticket.subject}\nRequester: ${requester}\nClient: ${clientName}`,
          metadata: { ticketNumber: ticket.ticketNumber }
        })
      )
    );

    return { notified: userIds.length };
  }

  async notifyNewEventRequestCreated(input: { requestId: string; organizationId: string }) {
    const request = await this.prisma.eventServiceRequest.findFirst({
      where: { id: input.requestId, organizationId: input.organizationId, deletedAt: null },
      select: {
        id: true,
        trackingNumber: true,
        eventName: true,
        requesterFirstName: true,
        requesterLastName: true,
        requesterEmail: true,
        client: { select: { name: true } }
      }
    });
    if (!request) {
      return { notified: 0 };
    }

    const preferences = await this.prisma.userNotificationPreference.findMany({
      where: {
        OR: [{ inAppNewEventRequestCreated: true }, { emailNewEventRequestCreated: true }],
        user: {
          organizationId: input.organizationId,
          isActive: true,
          deletedAt: null
        }
      },
      select: { userId: true }
    });
    const userIds = [...new Set(preferences.map((preference) => preference.userId))];
    const requester = `${request.requesterFirstName} ${request.requesterLastName}`.trim() || request.requesterEmail;
    const clientName = request.client?.name ?? "Unmapped / no client";

    await Promise.all(
      userIds.map((userId) =>
        this.notifyUser({
          userId,
          eventServiceRequestId: request.id,
          eventType: "newEventRequestCreated",
          title: `New event request: ${request.trackingNumber}`,
          body: `${request.eventName}\nRequester: ${requester}\nClient: ${clientName}`,
          metadata: {
            entityType: "EventServiceRequest",
            requestId: request.id,
            trackingNumber: request.trackingNumber
          }
        })
      )
    );

    return { notified: userIds.length };
  }

  async markRead(notificationId: string, user: AuthenticatedUser) {
    const notification = await this.prisma.notification.findFirst({ where: { id: notificationId, userId: user.id } });
    if (!notification) {
      throw new NotFoundException("Notification was not found.");
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { status: "READ", readAt: new Date() }
    });
  }

  async markAllRead(user: AuthenticatedUser) {
    const result = await this.prisma.notification.updateMany({
      where: { userId: user.id, status: "UNREAD" },
      data: { status: "READ", readAt: new Date() }
    });
    return { updated: result.count };
  }

  preferences(user: AuthenticatedUser) {
    return this.getOrCreatePreference(user.id);
  }

  updatePreferences(user: AuthenticatedUser, input: UpdateNotificationPreferencesDto) {
    return this.prisma.userNotificationPreference.upsert({
      where: { userId: user.id },
      update: input,
      create: {
        userId: user.id,
        ...input
      }
    });
  }

  async listUserPreferences(user: AuthenticatedUser) {
    const users = await this.prisma.user.findMany({
      where: { organizationId: user.organizationId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        isActive: true,
        notificationPreference: true
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }]
    });

    return users.map((targetUser) => ({
      ...targetUser,
      notificationPreference: targetUser.notificationPreference ?? this.defaultPreference(targetUser.id)
    }));
  }

  async updateUserPreferences(targetUserId: string, user: AuthenticatedUser, input: UpdateNotificationPreferencesDto) {
    const targetUser = await this.prisma.user.findFirst({
      where: { id: targetUserId, organizationId: user.organizationId, deletedAt: null },
      select: { id: true }
    });
    if (!targetUser) {
      throw new NotFoundException("User was not found.");
    }

    return this.prisma.userNotificationPreference.upsert({
      where: { userId: targetUserId },
      update: input,
      create: {
        userId: targetUserId,
        ...input
      }
    });
  }

  private getOrCreatePreference(userId: string) {
    return this.prisma.userNotificationPreference.upsert({
      where: { userId },
      update: {},
      create: { userId }
    });
  }

  private defaultPreference(userId: string) {
    return {
      id: "",
      userId,
      inAppEnabled: true,
      emailEnabled: false,
      ticketAssignedToMe: true,
      ticketAssignedToMyTeam: true,
      ticketReplyOnAssignedTicket: true,
      internalNoteOnAssignedTicket: true,
      internalNoteMention: true,
      routingRuleMatched: true,
      ticketReopened: true,
      newTicketCreated: false,
      inAppTicketAssignedToMe: true,
      inAppTicketAssignedToMyTeam: true,
      inAppTicketReplyOnAssignedTicket: true,
      inAppInternalNoteOnAssignedTicket: true,
      inAppInternalNoteMention: true,
      inAppRoutingRuleMatched: true,
      inAppTicketReopened: true,
      inAppNewTicketCreated: false,
      emailTicketAssignedToMe: false,
      emailTicketAssignedToMyTeam: false,
      emailTicketReplyOnAssignedTicket: false,
      emailInternalNoteOnAssignedTicket: false,
      emailInternalNoteMention: false,
      emailRoutingRuleMatched: false,
      emailTicketReopened: false,
      emailNewTicketCreated: false,
      inAppEventAssignedToMe: true,
      inAppEventRequestUpdated: true,
      inAppEventTaskAssignedToMe: true,
      inAppEventTaskUpdated: true,
      inAppEventCommentAdded: true,
      emailEventAssignedToMe: false,
      emailEventRequestUpdated: false,
      emailEventTaskAssignedToMe: false,
      emailEventTaskUpdated: false,
      emailEventCommentAdded: false,
      inAppNewEventRequestCreated: true,
      emailNewEventRequestCreated: false,
      dailyDigestEnabled: false,
      createdAt: null,
      updatedAt: null
    };
  }

  private isChannelEventEnabled(
    preferences: Partial<Record<string, unknown>>,
    eventType: NotificationEventType,
    channel: "inApp" | "email"
  ) {
    const fields = EVENT_CHANNEL_FIELDS[eventType];
    const channelValue = preferences[fields[channel] as string];
    if (typeof channelValue === "boolean") {
      return channelValue;
    }

    return fields.legacy ? Boolean(preferences[fields.legacy as string]) : false;
  }

  private async sendEmailNotification(input: {
    organizationId: string;
    email: string;
    title: string;
    body?: string | null;
    ticketId?: string | null;
    eventServiceRequestId?: string | null;
    eventServiceTaskId?: string | null;
    eventType: NotificationEventType;
  }) {
    try {
      const ticket = input.ticketId
        ? await this.prisma.ticket.findFirst({
            where: { id: input.ticketId, organizationId: input.organizationId, deletedAt: null },
            select: {
              id: true,
              ticketNumber: true,
              subject: true,
              status: true,
              priority: true,
              source: true,
              senderEmail: true,
              createdAt: true,
              updatedAt: true,
              client: { select: { name: true } },
              contact: { select: { firstName: true, lastName: true, email: true } },
              assignedUser: { select: { firstName: true, lastName: true, email: true } },
              assignees: { include: { user: { select: { firstName: true, lastName: true, email: true } } }, orderBy: { createdAt: "asc" } },
              assignedTeam: { select: { name: true } }
            }
          })
        : null;
      const eventRequest = input.eventServiceRequestId
        ? await this.prisma.eventServiceRequest.findFirst({
            where: { id: input.eventServiceRequestId, organizationId: input.organizationId, deletedAt: null },
            select: {
              id: true,
              trackingNumber: true,
              eventName: true,
              venue: true,
              eventDate: true,
              startTime: true,
              endTime: true,
              status: true,
              priority: true,
              progressPercent: true,
              requesterFirstName: true,
              requesterLastName: true,
              requesterEmail: true,
              requesterPhone: true,
              additionalInfo: true,
              createdAt: true,
              updatedAt: true,
              client: { select: { name: true } },
              assignedTeam: { select: { name: true } },
              services: { include: { service: { select: { name: true } } }, orderBy: { service: { name: "asc" } } },
              assignees: { include: { user: { select: { firstName: true, lastName: true, email: true } } }, orderBy: { createdAt: "asc" } },
              tasks: {
                where: input.eventServiceTaskId ? { id: input.eventServiceTaskId } : undefined,
                include: { assignedUser: { select: { firstName: true, lastName: true, email: true } } },
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
              }
            }
          })
        : null;
      const emailBody = ticket
        ? this.buildTicketEmailBody(input.title, input.body, ticket, input.eventType)
        : eventRequest
          ? this.buildEventEmailBody(input.title, input.body, eventRequest, input.eventType)
          : { text: input.body ?? input.title, html: `<p>${this.escapeHtml(input.body ?? input.title).replace(/\n/g, "<br>")}</p>` };

      await this.mailDelivery.sendTicketReply({
        organizationId: input.organizationId,
        to: [input.email],
        subject: input.title,
        bodyText: emailBody.text,
        bodyHtml: emailBody.html
      });
    } catch (error) {
      // Email notification failures must not block ticket workflows.
      const message = error instanceof Error ? error.message : "Unknown notification email failure";
      this.logger.warn(`Unable to send ${input.eventType} email notification to ${input.email}: ${message}`);
    }
  }

  private eventMetadata(input: NotifyUserInput) {
    if (!input.eventServiceRequestId) {
      return undefined;
    }
    return {
      entityType: "EventServiceRequest",
      requestId: input.eventServiceRequestId,
      ...(input.eventServiceTaskId ? { taskId: input.eventServiceTaskId } : {})
    } satisfies Prisma.InputJsonValue;
  }

  private buildEventEmailBody(
    title: string,
    body: string | null | undefined,
    request: {
      id: string;
      trackingNumber: string;
      eventName: string;
      venue: string | null;
      eventDate: Date | null;
      startTime: string | null;
      endTime: string | null;
      status: string;
      priority: string;
      progressPercent: number;
      requesterFirstName: string;
      requesterLastName: string;
      requesterEmail: string;
      requesterPhone: string | null;
      additionalInfo: string | null;
      createdAt: Date;
      updatedAt: Date;
      client: { name: string } | null;
      assignedTeam: { name: string } | null;
      services: Array<{ service: { name: string } }>;
      assignees: Array<{ user: { firstName: string; lastName: string; email: string } }>;
      tasks: Array<{ title: string; status: string; progressPercent: number; assignedUser: { firstName: string; lastName: string; email: string } | null }>;
    },
    eventType: NotificationEventType
  ) {
    const requester = `${request.requesterFirstName} ${request.requesterLastName}`.trim() || request.requesterEmail;
    const assignedTo = request.assignees.map((assignee) => this.userDisplay(assignee.user)).join(", ") || request.assignedTeam?.name || "Unassigned";
    const services = request.services.map((item) => item.service.name).join(", ") || "None";
    const task = request.tasks[0];
    const eventUrl = `${this.appUrl()}/event-services/${encodeURIComponent(request.trackingNumber)}`;
    const reason = body?.trim() || title;
    const details = [
      ["Tracking", request.trackingNumber],
      ["Event", request.eventName],
      ["Notification", this.eventLabel(eventType)],
      ["Reason", reason],
      ["Client", request.client?.name ?? "Unmapped / no client"],
      ["Requester", `${requester} (${request.requesterEmail})`],
      ["Phone", request.requesterPhone ?? "Not provided"],
      ["Venue", request.venue ?? "Not provided"],
      ["Date", request.eventDate ? request.eventDate.toLocaleDateString("en-US", { timeZone: "America/Chicago" }) : "Not provided"],
      ["Time", `${request.startTime ?? "--"} - ${request.endTime ?? "--"}`],
      ["Services", services],
      ["Status", this.label(request.status)],
      ["Priority", this.label(request.priority)],
      ["Progress", `${request.progressPercent}%`],
      ["Assigned to", assignedTo],
      ...(task ? [["Task", `${task.title} - ${this.label(task.status)} (${task.progressPercent}%)`]] : []),
      ["Updated", request.updatedAt.toLocaleString("en-US", { timeZone: "America/Chicago" })]
    ];
    const lines = [
      title,
      "",
      ...details.map(([key, value]) => `${key}: ${value}`),
      "",
      `Open event request: ${eventUrl}`
    ];

    return {
      text: lines.join("\n"),
      html: `
        <div>
          <p>${this.escapeHtml(title)}</p>
          <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;border:1px solid #d8dee9;">
            <tbody>
              ${details
                .map(
                  ([key, value]) =>
                    `<tr><th align="left" style="border:1px solid #d8dee9;background:#f5f7fb;">${this.escapeHtml(key)}</th><td style="border:1px solid #d8dee9;">${this.escapeHtml(value)}</td></tr>`
                )
                .join("")}
            </tbody>
          </table>
          <p><a href="${this.escapeHtml(eventUrl)}">Open event request ${this.escapeHtml(request.trackingNumber)}</a></p>
        </div>`
    };
  }

  private buildTicketEmailBody(
    title: string,
    body: string | null | undefined,
    ticket: {
      ticketNumber: string;
      subject: string;
      status: string;
      priority: string;
      source: string;
      senderEmail: string | null;
      createdAt: Date;
      updatedAt: Date;
      client: { name: string } | null;
      contact: { firstName: string; lastName: string; email: string } | null;
      assignedUser: { firstName: string; lastName: string; email: string } | null;
      assignees: Array<{ user: { firstName: string; lastName: string; email: string } }>;
      assignedTeam: { name: string } | null;
    },
    eventType: NotificationEventType
  ) {
    const requester = ticket.contact
      ? `${ticket.contact.firstName} ${ticket.contact.lastName}`.trim() || ticket.contact.email
      : ticket.senderEmail ?? "Unknown requester";
    const assignedUsers = ticket.assignees.map((assignee) => this.userDisplay(assignee.user));
    const assignedTo = assignedUsers.length > 0 ? assignedUsers.join(", ") : ticket.assignedUser ? this.userDisplay(ticket.assignedUser) : ticket.assignedTeam?.name ?? "Unassigned";
    const ticketUrl = `${this.appUrl()}/tickets/${encodeURIComponent(ticket.ticketNumber)}`;
    const reason = body?.trim() || title;
    const lines = [
      title,
      "",
      `Ticket: ${ticket.ticketNumber}`,
      `Subject: ${ticket.subject}`,
      `Event: ${this.eventLabel(eventType)}`,
      `Reason: ${reason}`,
      `Client: ${ticket.client?.name ?? "Unassigned client"}`,
      `Requester: ${requester}`,
      `Status: ${this.label(ticket.status)}`,
      `Priority: ${this.label(ticket.priority)}`,
      `Source: ${this.label(ticket.source)}`,
      `Assigned to: ${assignedTo}`,
      `Created: ${ticket.createdAt.toLocaleString("en-US", { timeZone: "America/Chicago" })}`,
      `Updated: ${ticket.updatedAt.toLocaleString("en-US", { timeZone: "America/Chicago" })}`,
      "",
      `Open ticket: ${ticketUrl}`
    ];
    const details = [
      ["Ticket", ticket.ticketNumber],
      ["Subject", ticket.subject],
      ["Event", this.eventLabel(eventType)],
      ["Reason", reason],
      ["Client", ticket.client?.name ?? "Unassigned client"],
      ["Requester", requester],
      ["Status", this.label(ticket.status)],
      ["Priority", this.label(ticket.priority)],
      ["Source", this.label(ticket.source)],
      ["Assigned to", assignedTo],
      ["Created", ticket.createdAt.toLocaleString("en-US", { timeZone: "America/Chicago" })],
      ["Updated", ticket.updatedAt.toLocaleString("en-US", { timeZone: "America/Chicago" })]
    ];

    return {
      text: lines.join("\n"),
      html: `
        <div>
          <p>${this.escapeHtml(title)}</p>
          <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;border:1px solid #d8dee9;">
            <tbody>
              ${details
                .map(
                  ([key, value]) =>
                    `<tr><th align="left" style="border:1px solid #d8dee9;background:#f5f7fb;">${this.escapeHtml(key)}</th><td style="border:1px solid #d8dee9;">${this.escapeHtml(value)}</td></tr>`
                )
                .join("")}
            </tbody>
          </table>
          <p><a href="${this.escapeHtml(ticketUrl)}">Open ticket ${this.escapeHtml(ticket.ticketNumber)}</a></p>
        </div>`
    };
  }

  private appUrl() {
    return (this.config.get<string>("APP_URL") ?? "https://helpdesk.aviditytechnologies.com").replace(/\/+$/, "");
  }

  private eventLabel(eventType: NotificationEventType) {
    const labels: Record<NotificationEventType, string> = {
      ticketAssignedToMe: "Assigned to me",
      ticketAssignedToMyTeam: "Assigned to my team",
      ticketReplyOnAssignedTicket: "Reply on assigned ticket",
      internalNoteOnAssignedTicket: "Internal note on assigned ticket",
      internalNoteMention: "Mentioned on internal note",
      routingRuleMatched: "Routing rule matched",
      ticketReopened: "Ticket reopened",
      newTicketCreated: "New ticket created",
      newEventRequestCreated: "New event request created",
      eventAssignedToMe: "Event assigned to me",
      eventRequestUpdated: "Event request updated",
      eventTaskAssignedToMe: "Event task assigned to me",
      eventTaskUpdated: "Event task updated",
      eventCommentAdded: "Event comment added",
      projectDecisionAlert: "Project decision alert",
      projectDecisionDigest: "Project decision summary"
    };
    return labels[eventType];
  }

  private userDisplay(user: { firstName: string; lastName: string; email: string }) {
    return `${user.firstName} ${user.lastName}`.trim() || user.email;
  }

  private label(value: string) {
    return value
      .toLowerCase()
      .split("_")
      .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
      .join(" ");
  }

  private escapeHtml(value: string) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
}
