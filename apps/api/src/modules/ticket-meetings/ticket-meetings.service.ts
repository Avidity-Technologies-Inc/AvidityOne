import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { CalendarSyncStatus, MeetingAttendeeSource, MeetingAttendeeType, Prisma, TicketMeetingStatus } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { AuditLogsService } from "../audit-logs/audit-logs.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { MicrosoftCalendarService } from "../microsoft-calendar/microsoft-calendar.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTicketMeetingDto, TicketMeetingAttendeeDto, UpdateTicketMeetingDto } from "./dto/ticket-meeting.dto";

@Injectable()
export class TicketMeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly calendar: MicrosoftCalendarService,
    private readonly config: ConfigService
  ) {}

  async list(ticketReference: string, user: AuthenticatedUser) {
    const ticket = await this.ensureTicket(ticketReference, user.organizationId);
    const [meetings, activity, defaults] = await Promise.all([
      this.prisma.ticketMeeting.findMany({
        where: { ticketId: ticket.id },
        include: this.meetingInclude(),
        orderBy: [{ startAt: "asc" }, { createdAt: "asc" }]
      }),
      this.prisma.ticketActivity.findMany({
        where: { ticketId: ticket.id, action: { startsWith: "ticket.meeting." } },
        include: { user: { select: this.userSelect() } },
        orderBy: { createdAt: "asc" }
      }),
      this.buildDefaults(ticket, user)
    ]);
    return { meetings, activity, defaults };
  }

  async create(ticketReference: string, input: CreateTicketMeetingDto, user: AuthenticatedUser) {
    const ticket = await this.ensureTicket(ticketReference, user.organizationId);
    const organizer = await this.resolveOrganizer(input.organizerUserId || user.id, user.organizationId);
    const dates = this.validateWindow(input.startAt, input.endAt, input.timeZone);
    const defaults = await this.buildDefaults(ticket, user, organizer);
    const attendees = await this.prepareAttendees(
      input.attendees ?? defaults.attendees,
      organizer.calendarEmail,
      ticket,
      user.organizationId
    );
    const meeting = await this.prisma.$transaction(async (tx) => {
      const created = await tx.ticketMeeting.create({
        data: {
          organizationId: user.organizationId,
          ticketId: ticket.id,
          organizerUserId: organizer.id,
          organizerCalendarEmail: organizer.calendarEmail,
          createdByUserId: user.id,
          updatedByUserId: user.id,
          title: input.title.trim(),
          agenda: this.optionalTrim(input.agenda),
          startAt: dates.startAt,
          endAt: dates.endAt,
          timeZone: input.timeZone.trim(),
          location: this.optionalTrim(input.location),
          isOnlineMeeting: input.isOnlineMeeting ?? false,
          attendees: { create: attendees }
        },
        include: this.meetingInclude()
      });
      await tx.ticketActivity.create({
        data: {
          ticketId: ticket.id,
          userId: user.id,
          ticketMeetingId: created.id,
          action: "ticket.meeting.draft_created",
          metadata: this.activityMetadata(created)
        }
      });
      return created;
    });
    await this.audit(user, meeting, "ticket_meeting.created");
    return meeting;
  }

  async update(ticketReference: string, meetingId: string, input: UpdateTicketMeetingDto, user: AuthenticatedUser) {
    const { ticket, meeting } = await this.ensureMeeting(ticketReference, meetingId, user.organizationId);
    if (meeting.status === TicketMeetingStatus.CANCELLED || meeting.status === TicketMeetingStatus.COMPLETED) {
      throw new BadRequestException("Cancelled or completed meetings cannot be edited.");
    }
    if (meeting.providerEventId && input.organizerUserId && input.organizerUserId !== meeting.organizerUserId) {
      throw new BadRequestException("The organizer cannot be changed after invitations have been sent.");
    }
    if (meeting.providerEventId && meeting.isOnlineMeeting && input.isOnlineMeeting === false) {
      throw new BadRequestException("A Microsoft Teams meeting cannot be converted to an offline meeting after it is created.");
    }
    const organizer = input.organizerUserId
      ? await this.resolveOrganizer(input.organizerUserId, user.organizationId)
      : await this.resolveOrganizer(meeting.organizerUserId || user.id, user.organizationId);
    const dates = this.validateWindow(
      input.startAt ?? meeting.startAt.toISOString(),
      input.endAt ?? meeting.endAt.toISOString(),
      input.timeZone ?? meeting.timeZone
    );
    const attendees = input.attendees
      ? await this.prepareAttendees(input.attendees, organizer.calendarEmail, ticket, user.organizationId)
      : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (attendees) {
        await tx.ticketMeetingAttendee.deleteMany({ where: { meetingId } });
      }
      const saved = await tx.ticketMeeting.update({
        where: { id: meetingId },
        data: {
          organizerUserId: organizer.id,
          organizerCalendarEmail: organizer.calendarEmail,
          updatedByUserId: user.id,
          title: input.title?.trim(),
          agenda: input.agenda === undefined ? undefined : this.optionalTrim(input.agenda),
          startAt: dates.startAt,
          endAt: dates.endAt,
          timeZone: input.timeZone?.trim(),
          location: input.location === undefined ? undefined : this.optionalTrim(input.location),
          isOnlineMeeting: input.isOnlineMeeting,
          syncStatus: meeting.providerEventId ? CalendarSyncStatus.PENDING : CalendarSyncStatus.NOT_SYNCED,
          syncError: null,
          attendees: attendees ? { create: attendees } : undefined
        },
        include: this.meetingInclude()
      });
      await tx.ticketActivity.create({
        data: {
          ticketId: ticket.id,
          userId: user.id,
          ticketMeetingId: meetingId,
          action: "ticket.meeting.updated",
          metadata: this.activityMetadata(saved)
        }
      });
      return saved;
    });
    await this.audit(user, updated, "ticket_meeting.updated");
    return meeting.providerEventId ? this.syncMeeting(updated.id, user) : updated;
  }

  async schedule(ticketReference: string, meetingId: string, user: AuthenticatedUser) {
    const { meeting } = await this.ensureMeeting(ticketReference, meetingId, user.organizationId);
    if (meeting.status === TicketMeetingStatus.CANCELLED || meeting.status === TicketMeetingStatus.COMPLETED) {
      throw new BadRequestException("Cancelled or completed meetings cannot be scheduled.");
    }
    return this.syncMeeting(meeting.id, user);
  }

  async cancel(ticketReference: string, meetingId: string, comment: string | null | undefined, user: AuthenticatedUser) {
    const { ticket, meeting } = await this.ensureMeeting(ticketReference, meetingId, user.organizationId);
    if (meeting.status === TicketMeetingStatus.CANCELLED) return meeting;
    if (meeting.status === TicketMeetingStatus.COMPLETED) throw new BadRequestException("A completed meeting cannot be cancelled.");

    if (meeting.providerEventId && meeting.organizerCalendarEmail) {
      const settings = await this.calendarSettings(user.organizationId);
      await this.prisma.ticketMeeting.update({
        where: { id: meeting.id },
        data: { syncStatus: CalendarSyncStatus.PENDING, syncAttemptedAt: new Date(), syncError: null }
      });
      try {
        await this.calendar.cancelEvent({
          ...settings,
          organizerEmail: meeting.organizerCalendarEmail,
          eventId: meeting.providerEventId,
          comment
        });
      } catch (error) {
        await this.recordSyncFailure(meeting.id, ticket.id, user.id, error);
        throw error;
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.ticketMeeting.update({
        where: { id: meeting.id },
        data: {
          status: TicketMeetingStatus.CANCELLED,
          syncStatus: meeting.providerEventId ? CalendarSyncStatus.SYNCED : CalendarSyncStatus.NOT_SYNCED,
          syncError: null,
          syncedAt: meeting.providerEventId ? new Date() : meeting.syncedAt,
          cancelledAt: new Date(),
          updatedByUserId: user.id
        },
        include: this.meetingInclude()
      });
      await tx.ticketActivity.create({
        data: { ticketId: ticket.id, userId: user.id, ticketMeetingId: meeting.id, action: "ticket.meeting.cancelled", metadata: { ...this.activityMetadata(saved), comment: this.optionalTrim(comment) } }
      });
      return saved;
    });
    await this.audit(user, updated, "ticket_meeting.cancelled");
    return updated;
  }

  async complete(ticketReference: string, meetingId: string, user: AuthenticatedUser) {
    const { ticket, meeting } = await this.ensureMeeting(ticketReference, meetingId, user.organizationId);
    if (meeting.status === TicketMeetingStatus.CANCELLED) throw new BadRequestException("A cancelled meeting cannot be completed.");
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.ticketMeeting.update({
        where: { id: meeting.id },
        data: { status: TicketMeetingStatus.COMPLETED, completedAt: new Date(), updatedByUserId: user.id },
        include: this.meetingInclude()
      });
      await tx.ticketActivity.create({
        data: { ticketId: ticket.id, userId: user.id, ticketMeetingId: meeting.id, action: "ticket.meeting.completed", metadata: this.activityMetadata(saved) }
      });
      return saved;
    });
    await this.audit(user, updated, "ticket_meeting.completed");
    return updated;
  }

  private async syncMeeting(meetingId: string, user: AuthenticatedUser) {
    const meeting = await this.prisma.ticketMeeting.findFirst({
      where: { id: meetingId, organizationId: user.organizationId },
      include: { ticket: true, attendees: { orderBy: { email: "asc" } } }
    });
    if (!meeting) throw new NotFoundException("Meeting was not found.");
    const settings = await this.calendarSettings(user.organizationId);
    await this.prisma.ticketMeeting.update({
      where: { id: meeting.id },
      data: { syncStatus: CalendarSyncStatus.PENDING, syncAttemptedAt: new Date(), syncError: null }
    });
    const graphInput = {
      ...settings,
      organizerEmail: meeting.organizerCalendarEmail || user.email,
      subject: meeting.title,
      bodyHtml: this.calendarBody(meeting.ticket.ticketNumber, meeting.agenda),
      startDateTime: this.zonedDateTime(meeting.startAt, meeting.timeZone),
      endDateTime: this.zonedDateTime(meeting.endAt, meeting.timeZone),
      timeZone: meeting.timeZone,
      location: meeting.location,
      isOnlineMeeting: meeting.isOnlineMeeting,
      transactionId: meeting.transactionId,
      attendees: meeting.attendees.map((attendee) => ({
        email: attendee.email,
        name: attendee.displayName,
        type: attendee.type === MeetingAttendeeType.OPTIONAL ? "optional" as const : "required" as const
      }))
    };
    try {
      const event = meeting.providerEventId
        ? await this.calendar.updateEvent({ ...graphInput, eventId: meeting.providerEventId })
        : await this.calendar.createEvent(graphInput);
      const saved = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.ticketMeeting.update({
          where: { id: meeting.id },
          data: {
            status: TicketMeetingStatus.SCHEDULED,
            syncStatus: CalendarSyncStatus.SYNCED,
            providerEventId: event.id,
            providerChangeKey: event.changeKey ?? null,
            providerICalUId: event.iCalUId ?? null,
            providerWebLink: event.webLink ?? meeting.providerWebLink,
            onlineMeetingJoinUrl: event.onlineMeeting?.joinUrl ?? meeting.onlineMeetingJoinUrl,
            syncError: null,
            syncedAt: new Date(),
            updatedByUserId: user.id
          },
          include: this.meetingInclude()
        });
        await tx.ticketActivity.create({
          data: {
            ticketId: meeting.ticketId,
            userId: user.id,
            ticketMeetingId: meeting.id,
            action: meeting.providerEventId ? "ticket.meeting.calendar_updated" : "ticket.meeting.scheduled",
            metadata: this.activityMetadata(updated)
          }
        });
        return updated;
      });
      await this.audit(user, saved, meeting.providerEventId ? "ticket_meeting.calendar_updated" : "ticket_meeting.scheduled");
      return saved;
    } catch (error) {
      await this.recordSyncFailure(meeting.id, meeting.ticketId, user.id, error);
      throw error;
    }
  }

  private async buildDefaults(
    ticket: Awaited<ReturnType<TicketMeetingsService["ensureTicket"]>>,
    user: AuthenticatedUser,
    organizerOverride?: { id: string; calendarEmail: string; firstName: string; lastName: string }
  ) {
    const organizer = organizerOverride ?? await this.resolveOrganizer(user.id, user.organizationId);
    const settings = await this.prisma.systemSetting.findUnique({
      where: { organizationId: user.organizationId },
      select: { eventCalendarDefaultTimeZone: true, defaultTimezone: true }
    });
    const attendees = new Map<string, TicketMeetingAttendeeDto>();
    const add = (email: string | null | undefined, displayName: string | null | undefined, source: MeetingAttendeeSource) => {
      const normalized = email?.trim().toLowerCase();
      if (!normalized || normalized === organizer.calendarEmail.toLowerCase()) return;
      if (!attendees.has(normalized)) attendees.set(normalized, { email: normalized, displayName: displayName?.trim() || null, type: MeetingAttendeeType.REQUIRED, source });
    };
    add(ticket.contact?.email ?? ticket.senderEmail, ticket.contact ? `${ticket.contact.firstName} ${ticket.contact.lastName}`.trim() : null, MeetingAttendeeSource.REQUESTER);
    for (const participant of ticket.conversationParticipants) {
      add(participant.email, participant.displayName, MeetingAttendeeSource.CONVERSATION_PARTICIPANT);
    }
    const start = new Date(Date.now() + 60 * 60 * 1000);
    start.setUTCMinutes(Math.ceil(start.getUTCMinutes() / 15) * 15, 0, 0);
    return {
      title: `[${ticket.ticketNumber}] ${ticket.subject}`,
      timeZone: settings?.eventCalendarDefaultTimeZone || settings?.defaultTimezone || "America/Chicago",
      organizer,
      attendees: [...attendees.values()],
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 30 * 60 * 1000).toISOString()
    };
  }

  private async prepareAttendees(
    input: TicketMeetingAttendeeDto[],
    organizerEmail: string,
    ticket: Awaited<ReturnType<TicketMeetingsService["ensureTicket"]>>,
    organizationId: string
  ) {
    const excluded = new Set([
      organizerEmail,
      ticket.mailbox?.emailAddress,
      ticket.mailbox?.publicEmailAddress,
      ticket.mailbox?.ingestionEmailAddress,
      ticket.mailbox?.outboundFromAddress,
      ticket.mailbox?.outboundReplyToAddress
    ].filter((email): email is string => Boolean(email)).map((email) => email.toLowerCase()));
    const normalized = new Map<string, TicketMeetingAttendeeDto>();
    for (const attendee of input) {
      const email = attendee.email.trim().toLowerCase();
      if (!excluded.has(email) && !normalized.has(email)) normalized.set(email, { ...attendee, email });
    }
    const emails = [...normalized.keys()];
    const [users, contacts] = await Promise.all([
      this.prisma.user.findMany({ where: { organizationId, email: { in: emails, mode: "insensitive" }, deletedAt: null }, select: { id: true, email: true, firstName: true, lastName: true } }),
      this.prisma.contact.findMany({ where: { client: { organizationId }, email: { in: emails, mode: "insensitive" }, deletedAt: null }, select: { id: true, email: true, firstName: true, lastName: true } })
    ]);
    const userByEmail = new Map(users.map((item) => [item.email.toLowerCase(), item]));
    const contactByEmail = new Map(contacts.map((item) => [item.email.toLowerCase(), item]));
    return emails.map((email) => {
      const item = normalized.get(email)!;
      const linkedUser = userByEmail.get(email);
      const linkedContact = contactByEmail.get(email);
      return {
        email,
        displayName: this.optionalTrim(item.displayName) || (linkedUser ? `${linkedUser.firstName} ${linkedUser.lastName}`.trim() : linkedContact ? `${linkedContact.firstName} ${linkedContact.lastName}`.trim() : null),
        type: item.type ?? MeetingAttendeeType.REQUIRED,
        source: linkedUser ? MeetingAttendeeSource.INTERNAL_USER : item.source ?? (linkedContact ? MeetingAttendeeSource.CONTACT : MeetingAttendeeSource.MANUAL),
        userId: linkedUser?.id ?? null,
        contactId: linkedContact?.id ?? null
      };
    });
  }

  private async calendarSettings(organizationId: string) {
    const settings = await this.prisma.systemSetting.findUnique({
      where: { organizationId },
      select: { eventCalendarSyncEnabled: true, eventCalendarTenantId: true, eventCalendarClientId: true, eventCalendarClientSecretReference: true }
    });
    if (!settings?.eventCalendarSyncEnabled) throw new BadRequestException("Microsoft Calendar sync is disabled in Settings.");
    return {
      tenantId: settings.eventCalendarTenantId,
      clientId: settings.eventCalendarClientId,
      clientSecretReference: settings.eventCalendarClientSecretReference
    };
  }

  private async resolveOrganizer(userId: string, organizationId: string) {
    const organizer = await this.prisma.user.findFirst({
      where: { id: userId, organizationId, isActive: true, deletedAt: null },
      select: { id: true, email: true, microsoftPrincipalName: true, firstName: true, lastName: true }
    });
    if (!organizer) throw new BadRequestException("The selected organizer is not an active user.");
    return { ...organizer, calendarEmail: organizer.microsoftPrincipalName || organizer.email };
  }

  private async ensureTicket(reference: string, organizationId: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { organizationId, deletedAt: null, ...(this.isUuid(reference) ? { id: reference } : { ticketNumber: reference }) },
      include: {
        contact: true,
        mailbox: true,
        conversationParticipants: { where: { isActive: true }, orderBy: { addedAt: "asc" } }
      }
    });
    if (!ticket) throw new NotFoundException("Ticket was not found.");
    return ticket;
  }

  private async ensureMeeting(ticketReference: string, meetingId: string, organizationId: string) {
    const ticket = await this.ensureTicket(ticketReference, organizationId);
    const meeting = await this.prisma.ticketMeeting.findFirst({ where: { id: meetingId, ticketId: ticket.id, organizationId }, include: this.meetingInclude() });
    if (!meeting) throw new NotFoundException("Meeting was not found.");
    return { ticket, meeting };
  }

  private validateWindow(startValue: string, endValue: string, timeZone: string) {
    const startAt = new Date(startValue);
    const endAt = new Date(endValue);
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())) throw new BadRequestException("Meeting dates are invalid.");
    if (endAt <= startAt) throw new BadRequestException("Meeting end time must be after its start time.");
    if (endAt.getTime() - startAt.getTime() > 24 * 60 * 60 * 1000) throw new BadRequestException("A meeting cannot be longer than 24 hours.");
    try {
      new Intl.DateTimeFormat("en-US", { timeZone }).format(startAt);
    } catch {
      throw new BadRequestException("Meeting timezone is invalid.");
    }
    return { startAt, endAt };
  }

  private zonedDateTime(date: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
    return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}:${value("second")}`;
  }

  private calendarBody(ticketNumber: string, agenda: string | null) {
    const appUrl = (this.config.get<string>("APP_URL") || "http://localhost:3000").replace(/\/$/, "");
    const ticketUrl = `${appUrl}/tickets/${encodeURIComponent(ticketNumber)}`;
    const content = agenda ? `<p>${this.escapeHtml(agenda).replace(/\n/g, "<br>")}</p>` : "<p>Meeting related to this support ticket.</p>";
    return `<!-- avidity-ticket-meeting:start --><div id="avidity-ticket-meeting-content">${content}<p><strong>Ticket:</strong> ${this.escapeHtml(ticketNumber)}<br><a href="${this.escapeHtml(ticketUrl)}">Open ticket in Avidity One</a></p></div><!-- avidity-ticket-meeting:end -->`;
  }

  private async recordSyncFailure(meetingId: string, ticketId: string, userId: string, error: unknown) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Unable to synchronize this meeting with Microsoft Calendar.";
    await this.prisma.$transaction([
      this.prisma.ticketMeeting.update({ where: { id: meetingId }, data: { syncStatus: CalendarSyncStatus.FAILED, syncError: message, syncAttemptedAt: new Date() } }),
      this.prisma.ticketActivity.create({ data: { ticketId, userId, ticketMeetingId: meetingId, action: "ticket.meeting.sync_failed", metadata: { meetingId, error: message } } })
    ]);
  }

  private audit(user: AuthenticatedUser, meeting: { id: string; ticketId: string; status: TicketMeetingStatus; syncStatus: CalendarSyncStatus }, action: string) {
    return this.auditLogs.create({ organizationId: user.organizationId, userId: user.id, entityType: "TicketMeeting", entityId: meeting.id, action, metadata: { ticketId: meeting.ticketId, status: meeting.status, syncStatus: meeting.syncStatus } });
  }

  private activityMetadata(meeting: { id: string; title: string; startAt: Date; endAt: Date; timeZone: string; status: TicketMeetingStatus; syncStatus: CalendarSyncStatus; organizerCalendarEmail: string | null; attendees?: Array<unknown> }) {
    return { meetingId: meeting.id, title: meeting.title, startAt: meeting.startAt.toISOString(), endAt: meeting.endAt.toISOString(), timeZone: meeting.timeZone, status: meeting.status, syncStatus: meeting.syncStatus, organizerCalendarEmail: meeting.organizerCalendarEmail, attendeeCount: meeting.attendees?.length ?? 0 };
  }

  private meetingInclude() {
    return {
      attendees: { orderBy: { email: "asc" as const } },
      organizer: { select: this.userSelect() },
      createdBy: { select: this.userSelect() }
    };
  }

  private userSelect() {
    return { id: true, firstName: true, lastName: true, email: true } as const;
  }

  private optionalTrim(value: string | null | undefined) {
    const trimmed = value?.trim();
    return trimmed || null;
  }

  private escapeHtml(value: string) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  private isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }
}
