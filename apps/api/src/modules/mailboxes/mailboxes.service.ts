import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from "@nestjs/common";
import { TicketEmailService } from "../ticket-email/ticket-email.service";
import { ConfigService } from "@nestjs/config";
import { BlockedInboundEmailStatus, Mailbox, MessageDirection, MessageVisibility, Prisma, SpamReleaseAction } from "@prisma/client";
import { HtmlSanitizerService } from "../../common/html/html-sanitizer.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { SpamManagementService } from "../spam-management/spam-management.service";
import { TicketAttachmentsService } from "../ticket-attachments/ticket-attachments.service";
import { TicketsService } from "../tickets/tickets.service";
import { UpdateMailboxDto } from "./dto/update-mailbox.dto";
import { InboundMailMessage, MailProvider } from "./providers/mail-provider.interface";
import { MicrosoftGraphMailProvider } from "./providers/microsoft-graph-mail.provider";
import { MockMailProvider } from "./providers/mock-mail.provider";

export interface SyncMailboxResult {
  mailboxId: string;
  provider: "mock" | "microsoft365";
  receivedMessages: number;
  createdTickets: number;
  skippedDuplicates: number;
  operationalEmailsHandled?: number;
  blockedSpamMessages: number;
  attachmentBackfilled?: number;
  attachmentBackfillFailures?: number;
  attachmentBackfillErrors?: string[];
  nextSyncCursor?: string | null;
}

interface SyncMailboxOptions {
  broadAttachmentBackfill?: boolean;
  initialSyncFromOverride?: Date | null;
  preserveSyncState?: boolean;
}

interface EmailOperationalSchedule {
  enabled: boolean;
  timezone: string;
  days: string[];
  startTime: string;
  endTime: string;
  skipUsFederalHolidays: boolean;
  customClosedDates: string[];
}

interface AttachmentImportFailure {
  attachmentId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  reason: string;
  rejectedAt: string;
}

const DEFAULT_EMAIL_OPERATIONAL_SCHEDULE: EmailOperationalSchedule = {
  enabled: false,
  timezone: "America/Chicago",
  days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
  startTime: "06:00",
  endTime: "17:00",
  skipUsFederalHolidays: false,
  customClosedDates: []
};

const CURRENT_INBOUND_PROJECTION_VERSION = 2;

const WEEKDAY_KEYS: Record<string, string> = {
  Sunday: "SUNDAY",
  Monday: "MONDAY",
  Tuesday: "TUESDAY",
  Wednesday: "WEDNESDAY",
  Thursday: "THURSDAY",
  Friday: "FRIDAY",
  Saturday: "SATURDAY"
};

@Injectable()
export class MailboxesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailboxesService.name);
  private readonly runningAutoSyncs = new Set<string>();
  private readonly runningAttachmentBackfills = new Set<string>();
  private autoSyncTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly ticketsService: TicketsService,
    private readonly ticketAttachmentsService: TicketAttachmentsService,
    private readonly spamManagement: SpamManagementService,
    private readonly mockMailProvider: MockMailProvider,
    private readonly microsoftGraphMailProvider: MicrosoftGraphMailProvider,
    private readonly htmlSanitizer: HtmlSanitizerService = new HtmlSanitizerService(),
    @Optional() private readonly ticketEmail?: TicketEmailService
  ) {}

  onModuleInit() {
    this.autoSyncTimer = setInterval(() => {
      void this.runDueAutoSyncs();
    }, 15_000);
  }

  onModuleDestroy() {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
    }
  }

  list(user: AuthenticatedUser) {
    return this.prisma.mailbox.findMany({
      where: {
        organizationId: user.organizationId
      },
      orderBy: { emailAddress: "asc" }
    });
  }

  async update(mailboxId: string, input: UpdateMailboxDto, user: AuthenticatedUser) {
    await this.getMailboxForUser(mailboxId, user);

    return this.prisma.mailbox.update({
      where: { id: mailboxId },
      data: {
        name: input.name?.trim(),
        emailAddress: input.emailAddress?.trim().toLowerCase(),
        provider: input.provider,
        connectionMode: input.connectionMode,
        publicEmailAddress: input.publicEmailAddress === undefined ? undefined : this.optionalEmail(input.publicEmailAddress),
        ingestionEmailAddress: input.ingestionEmailAddress === undefined ? undefined : this.optionalEmail(input.ingestionEmailAddress),
        outboundMode: input.outboundMode,
        outboundFromAddress: input.outboundFromAddress === undefined ? undefined : this.optionalEmail(input.outboundFromAddress),
        outboundReplyToAddress: input.outboundReplyToAddress === undefined ? undefined : this.optionalEmail(input.outboundReplyToAddress),
        preserveOriginalSenderHeaders: input.preserveOriginalSenderHeaders,
        tenantId: input.tenantId === undefined ? undefined : this.optionalTrim(input.tenantId),
        microsoftClientId: input.microsoftClientId === undefined ? undefined : this.optionalTrim(input.microsoftClientId),
        encryptedClientSecretReference:
          input.encryptedClientSecretReference === undefined ? undefined : this.optionalTrim(input.encryptedClientSecretReference),
        isActive: input.isActive,
        autoSyncEnabled: input.autoSyncEnabled,
        autoSyncIntervalSeconds: input.autoSyncIntervalSeconds === undefined ? undefined : input.autoSyncIntervalSeconds,
        nextAutoSyncAt:
          input.autoSyncEnabled === false
            ? null
            : input.autoSyncIntervalSeconds
              ? new Date(Date.now() + input.autoSyncIntervalSeconds * 1000)
              : undefined,
        lastSyncError: null
      }
    });
  }

  async syncInbound(mailboxId: string, user: AuthenticatedUser): Promise<SyncMailboxResult> {
    const mailbox = await this.getMailboxForUser(mailboxId, user);
    const result = await this.syncMailbox(mailbox);
    this.scheduleBroadAttachmentBackfill(mailbox);
    return result;
  }

  async backfillInbound(mailboxId: string, initialSyncFrom: string, user: AuthenticatedUser): Promise<SyncMailboxResult> {
    const mailbox = await this.getMailboxForUser(mailboxId, user);
    const backfillFrom = new Date(initialSyncFrom);
    if (!initialSyncFrom || Number.isNaN(backfillFrom.getTime())) {
      throw new BadRequestException("A valid backfill start date is required.");
    }

    const result = await this.syncMailbox(mailbox, {
      initialSyncFromOverride: backfillFrom,
      preserveSyncState: true
    });

    await this.prisma.mailbox.update({
      where: { id: mailbox.id },
      data: {
        initialSyncFrom: backfillFrom,
        lastSyncError: null
      }
    });

    return result;
  }

  async releaseQuarantinedEmail(entryId: string, action: SpamReleaseAction, user: AuthenticatedUser) {
    const entry = await this.spamManagement.getQuarantinedEmail(entryId, user.organizationId);
    if (entry.status === BlockedInboundEmailStatus.RELEASED && entry.releasedTicketId && entry.releasedMessageId) {
      return { ticketId: entry.releasedTicketId, messageId: entry.releasedMessageId, alreadyReleased: true };
    }
    if (entry.status !== BlockedInboundEmailStatus.QUARANTINED) {
      throw new ConflictException("This quarantined message has already been resolved.");
    }
    if (!entry.mailbox) {
      throw new BadRequestException("The source mailbox is no longer available.");
    }
    const claimed = await this.spamManagement.claimQuarantineRelease(entry.id, user);
    if (!claimed) {
      throw new ConflictException("This quarantined message is already being processed or has been resolved.");
    }

    try {
      const duplicate = await this.prisma.ticketMessage.findFirst({
        where: {
          ticket: { organizationId: user.organizationId },
          OR: [
            ...(entry.emailMessageId ? [{ emailMessageId: entry.emailMessageId }] : []),
            ...(entry.emailInternetMessageId ? [{ emailInternetMessageId: entry.emailInternetMessageId }] : [])
          ]
        },
        select: { id: true, ticketId: true }
      });
      if (duplicate) {
        await this.spamManagement.applyReleaseRuleAction(entry.id, action, user);
        await this.spamManagement.markReleased(entry.id, action, duplicate.ticketId, duplicate.id, user);
        return { ticketId: duplicate.ticketId, messageId: duplicate.id, alreadyReleased: true };
      }

      const { provider } = this.resolveProvider(entry.mailbox);
      const message = await this.resolveQuarantinedInboundMessage(entry, provider);
      const result = await this.ticketsService.createFromInboundEmail({
        organizationId: entry.organizationId,
        mailboxId: entry.mailbox.id,
        senderEmail: message.from.email,
        senderName: message.from.name,
        subject: message.subject,
        bodyText: message.bodyText,
        bodyHtml: message.bodyHtml,
        emailMessageId: message.providerMessageId,
        emailInternetMessageId: message.internetMessageId,
        emailConversationId: message.conversationId,
        inReplyTo: message.inReplyTo,
        references: message.references,
        hasAttachments: message.hasAttachments,
        ccRecipients: message.cc,
        internetMessageHeaders: message.internetMessageHeaders,
        suppressAutoReply: true
      });
      if (message.hasAttachments) {
        await this.storeInboundAttachments(provider, entry.mailbox, message.providerMessageId, result.ticket.id, result.message.id);
      }
      await this.spamManagement.applyReleaseRuleAction(entry.id, action, user);
      await this.spamManagement.markReleased(entry.id, action, result.ticket.id, result.message.id, user);
      return { ticketId: result.ticket.id, ticketNumber: result.ticket.ticketNumber, messageId: result.message.id, alreadyReleased: false };
    } catch (error) {
      await this.spamManagement.markReleaseFailed(entry.id, error, user);
      throw error;
    }
  }

  private async resolveQuarantinedInboundMessage(
    entry: Awaited<ReturnType<SpamManagementService["getQuarantinedEmail"]>>,
    provider: MailProvider
  ): Promise<InboundMailMessage> {
    if (entry.bodyText || entry.bodyHtml) {
      return {
        providerMessageId: entry.emailMessageId ?? `quarantine-${entry.id}`,
        internetMessageId: entry.emailInternetMessageId,
        conversationId: entry.emailConversationId,
        from: { email: entry.senderEmail, name: entry.senderName },
        subject: entry.subject,
        bodyText: entry.bodyText,
        bodyHtml: entry.bodyHtml,
        inReplyTo: entry.inReplyTo,
        references: entry.emailReferences,
        hasAttachments: entry.hasAttachments,
        cc: this.jsonInboundMailAddresses(entry.ccRecipients),
        internetMessageHeaders: this.jsonStringRecord(entry.internetMessageHeaders)
      };
    }
    if (!entry.emailMessageId || !provider.getInboundMessage || !entry.mailbox) {
      throw new ServiceUnavailableException("The original message content is no longer available for release.");
    }
    const message = await provider.getInboundMessage({
      mailboxId: entry.mailbox.id,
      mailboxEmailAddress: this.getMailboxReadAddress(entry.mailbox),
      publicEmailAddress: entry.mailbox.publicEmailAddress ?? entry.mailbox.emailAddress,
      connectionMode: entry.mailbox.connectionMode,
      preserveOriginalSenderHeaders: entry.mailbox.preserveOriginalSenderHeaders,
      providerMessageId: entry.emailMessageId,
      tenantId: entry.mailbox.tenantId,
      microsoftClientId: entry.mailbox.microsoftClientId,
      encryptedClientSecretReference: entry.mailbox.encryptedClientSecretReference
    });
    if (!message) throw new ServiceUnavailableException("Microsoft Graph no longer has the original quarantined message.");
    return message;
  }

  private async runDueAutoSyncs() {
    try {
      const now = new Date();
      const mailboxes = await this.prisma.mailbox.findMany({
        where: {
          isActive: true,
          autoSyncEnabled: true,
          autoSyncIntervalSeconds: { not: null },
          OR: [{ nextAutoSyncAt: null }, { nextAutoSyncAt: { lte: now } }]
        },
        take: 10,
        orderBy: { nextAutoSyncAt: "asc" }
      });
      const schedulesByOrganizationId = await this.getEmailOperationalSchedules(mailboxes);

      await Promise.all(
        mailboxes.map(async (mailbox) => {
          if (this.runningAutoSyncs.has(mailbox.id)) {
            return;
          }

          this.runningAutoSyncs.add(mailbox.id);
          try {
            const nextAllowedSyncAt = this.nextAllowedEmailSyncAt(now, schedulesByOrganizationId.get(mailbox.organizationId));
            if (nextAllowedSyncAt.getTime() > now.getTime()) {
              await this.prisma.mailbox.update({
                where: { id: mailbox.id },
                data: {
                  nextAutoSyncAt: nextAllowedSyncAt,
                  autoSyncLockedAt: null
                }
              });
              return;
            }

            await this.prisma.mailbox.update({
              where: { id: mailbox.id },
              data: { autoSyncLockedAt: new Date() }
            });
            await this.syncMailbox(mailbox);
          } catch (error) {
            this.logger.warn(`Mailbox auto sync failed for ${mailbox.emailAddress}: ${error instanceof Error ? error.message : "Unknown error"}`);
            await this.prisma.mailbox.update({
              where: { id: mailbox.id },
              data: {
                lastSyncError: error instanceof Error ? error.message.slice(0, 1000) : "Mailbox auto sync failed.",
                nextAutoSyncAt: new Date(Date.now() + (mailbox.autoSyncIntervalSeconds ?? 300) * 1000),
                autoSyncLockedAt: null
              }
            });
          } finally {
            this.runningAutoSyncs.delete(mailbox.id);
          }
        })
      );
    } catch (error) {
      this.logger.warn(`Mailbox auto sync scan failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  private async getEmailOperationalSchedules(mailboxes: Mailbox[]) {
    const organizationIds = Array.from(new Set(mailboxes.map((mailbox) => mailbox.organizationId)));
    if (organizationIds.length === 0) {
      return new Map<string, EmailOperationalSchedule>();
    }

    const settingsRows = await this.prisma.systemSetting.findMany({
      where: { organizationId: { in: organizationIds } },
      select: {
        organizationId: true,
        emailOperationalHoursEnabled: true,
        emailOperationalTimezone: true,
        emailOperationalDays: true,
        emailOperationalStartTime: true,
        emailOperationalEndTime: true,
        emailSkipUsFederalHolidays: true,
        emailCustomClosedDates: true
      }
    });

    return new Map(
      settingsRows.map((settings) => [
        settings.organizationId,
        {
          enabled: settings.emailOperationalHoursEnabled,
          timezone: settings.emailOperationalTimezone || DEFAULT_EMAIL_OPERATIONAL_SCHEDULE.timezone,
          days: settings.emailOperationalDays.length > 0 ? settings.emailOperationalDays : DEFAULT_EMAIL_OPERATIONAL_SCHEDULE.days,
          startTime: settings.emailOperationalStartTime || DEFAULT_EMAIL_OPERATIONAL_SCHEDULE.startTime,
          endTime: settings.emailOperationalEndTime || DEFAULT_EMAIL_OPERATIONAL_SCHEDULE.endTime,
          skipUsFederalHolidays: settings.emailSkipUsFederalHolidays,
          customClosedDates: settings.emailCustomClosedDates
        }
      ])
    );
  }

  private nextAllowedEmailSyncAt(now: Date, schedule = DEFAULT_EMAIL_OPERATIONAL_SCHEDULE) {
    if (!schedule.enabled || this.isEmailSyncAllowedAt(now, schedule)) {
      return now;
    }

    for (let offsetMinutes = 1; offsetMinutes <= 370 * 24 * 60; offsetMinutes += 1) {
      const candidate = new Date(now.getTime() + offsetMinutes * 60_000);
      if (this.isEmailSyncAllowedAt(candidate, schedule)) {
        return candidate;
      }
    }

    return new Date(now.getTime() + 60 * 60_000);
  }

  private isEmailSyncAllowedAt(date: Date, schedule: EmailOperationalSchedule) {
    const parts = this.getZonedParts(date, schedule.timezone);
    const closedDates = new Set(schedule.customClosedDates);
    if (!schedule.days.includes(parts.weekday) || closedDates.has(parts.dateKey)) {
      return false;
    }
    if (schedule.skipUsFederalHolidays && this.isUsFederalHoliday(parts.dateKey)) {
      return false;
    }

    const minutes = parts.hour * 60 + parts.minute;
    const start = this.timeToMinutes(schedule.startTime, DEFAULT_EMAIL_OPERATIONAL_SCHEDULE.startTime);
    const end = this.timeToMinutes(schedule.endTime, DEFAULT_EMAIL_OPERATIONAL_SCHEDULE.endTime);
    if (start === end) {
      return true;
    }
    return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  }

  private getZonedParts(date: Date, timezone: string): { weekday: string; dateKey: string; hour: number; minute: number } {
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        weekday: "long",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
      const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
      const hour = Number(values.hour === "24" ? "0" : values.hour);
      return {
        weekday: WEEKDAY_KEYS[values.weekday] ?? values.weekday?.toUpperCase() ?? "MONDAY",
        dateKey: `${values.year}-${values.month}-${values.day}`,
        hour,
        minute: Number(values.minute)
      };
    } catch {
      if (timezone !== DEFAULT_EMAIL_OPERATIONAL_SCHEDULE.timezone) {
        return this.getZonedParts(date, DEFAULT_EMAIL_OPERATIONAL_SCHEDULE.timezone);
      }
      throw new Error("Invalid email operational timezone.");
    }
  }

  private timeToMinutes(value: string, fallback: string) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value) ?? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(fallback);
    return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
  }

  private isUsFederalHoliday(dateKey: string) {
    const year = Number(dateKey.slice(0, 4));
    return [year - 1, year, year + 1].some((holidayYear) => this.usFederalHolidayKeys(holidayYear).has(dateKey));
  }

  private usFederalHolidayKeys(year: number) {
    const keys = new Set<string>();
    const add = (monthIndex: number, day: number, observed = true) => {
      keys.add(this.utcDateKey(year, monthIndex, day));
      if (observed) {
        keys.add(this.observedDateKey(year, monthIndex, day));
      }
    };

    add(0, 1);
    keys.add(this.utcDateKey(year, 0, this.nthWeekdayOfMonth(year, 0, 1, 3)));
    keys.add(this.utcDateKey(year, 1, this.nthWeekdayOfMonth(year, 1, 1, 3)));
    keys.add(this.utcDateKey(year, 4, this.lastWeekdayOfMonth(year, 4, 1)));
    add(5, 19);
    add(6, 4);
    keys.add(this.utcDateKey(year, 8, this.nthWeekdayOfMonth(year, 8, 1, 1)));
    keys.add(this.utcDateKey(year, 9, this.nthWeekdayOfMonth(year, 9, 1, 2)));
    add(10, 11);
    keys.add(this.utcDateKey(year, 10, this.nthWeekdayOfMonth(year, 10, 4, 4)));
    add(11, 25);

    return keys;
  }

  private nthWeekdayOfMonth(year: number, monthIndex: number, weekday: number, occurrence: number) {
    const firstDay = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
    const offset = (weekday - firstDay + 7) % 7;
    return 1 + offset + (occurrence - 1) * 7;
  }

  private lastWeekdayOfMonth(year: number, monthIndex: number, weekday: number) {
    const lastDate = new Date(Date.UTC(year, monthIndex + 1, 0));
    const offset = (lastDate.getUTCDay() - weekday + 7) % 7;
    return lastDate.getUTCDate() - offset;
  }

  private observedDateKey(year: number, monthIndex: number, day: number) {
    const holiday = new Date(Date.UTC(year, monthIndex, day));
    const observed = new Date(holiday);
    if (holiday.getUTCDay() === 6) observed.setUTCDate(holiday.getUTCDate() - 1);
    if (holiday.getUTCDay() === 0) observed.setUTCDate(holiday.getUTCDate() + 1);
    return observed.toISOString().slice(0, 10);
  }

  private utcDateKey(year: number, monthIndex: number, day: number) {
    return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
  }

  private async syncMailbox(mailbox: Mailbox, options: SyncMailboxOptions = {}): Promise<SyncMailboxResult> {
    const { providerName, provider } = this.resolveProvider(mailbox);
    const requiresProjectionRefresh = !options.initialSyncFromOverride
      && mailbox.inboundProjectionVersion < CURRENT_INBOUND_PROJECTION_VERSION;
    const projectionRefreshFrom = requiresProjectionRefresh && mailbox.lastSyncedAt
      ? new Date(mailbox.lastSyncedAt.getTime() - 24 * 60 * 60 * 1000)
      : null;
    const syncResult = await provider.syncInboundMessages({
      mailboxId: mailbox.id,
      mailboxEmailAddress: this.getMailboxReadAddress(mailbox),
      publicEmailAddress: mailbox.publicEmailAddress ?? mailbox.emailAddress,
      connectionMode: mailbox.connectionMode,
      preserveOriginalSenderHeaders: mailbox.preserveOriginalSenderHeaders,
      lastSyncCursor: options.initialSyncFromOverride || requiresProjectionRefresh ? null : mailbox.lastSyncCursor,
      initialSyncFrom: options.initialSyncFromOverride ?? projectionRefreshFrom ?? mailbox.initialSyncFrom,
      tenantId: mailbox.tenantId,
      microsoftClientId: mailbox.microsoftClientId,
      encryptedClientSecretReference: mailbox.encryptedClientSecretReference
    });
    let createdTickets = 0;
    let skippedDuplicates = 0;
    let operationalEmailsHandled = 0;
    let blockedSpamMessages = 0;
    let attachmentBackfilled = 0;
    let attachmentBackfillFailures = 0;
    const attachmentBackfillErrors: string[] = [];

    for (const message of syncResult.messages) {
      const eventMessageExists = await this.prisma.eventServiceMessage.findFirst({
        where: {
          OR: [
            { emailMessageId: message.providerMessageId },
            ...(message.internetMessageId ? [{ emailInternetMessageId: message.internetMessageId }] : [])
          ]
        },
        select: { id: true }
      });
      if (eventMessageExists) {
        skippedDuplicates += 1;
        continue;
      }

      const exists = await this.prisma.ticketMessage.findFirst({
        where: {
          OR: [
            { emailMessageId: message.providerMessageId },
            ...(message.internetMessageId ? [{ emailInternetMessageId: message.internetMessageId }] : [])
          ]
        },
        select: {
          id: true,
          ticketId: true,
          attachmentsProcessedAt: true,
          attachmentImportFailures: true
        }
      });

      if (exists) {
        if (this.shouldFetchInboundAttachments(providerName, { ...message, attachmentsProcessedAt: exists.attachmentsProcessedAt })) {
          const stored = await this.storeInboundAttachments(
            provider,
            mailbox,
            message.providerMessageId,
            exists.ticketId,
            exists.id,
            exists.attachmentImportFailures
          );
          attachmentBackfilled += stored.stored;
          attachmentBackfillFailures += stored.failed;
          attachmentBackfillErrors.push(...stored.errors);
        }
        skippedDuplicates += 1;
        continue;
      }

      if (this.ticketEmail && await this.ticketEmail.inbound(mailbox, message,
        (providerMessageId) => provider.getMessageAttachments({ mailboxId: mailbox.id, mailboxEmailAddress: this.getMailboxReadAddress(mailbox), providerMessageId, tenantId: mailbox.tenantId, microsoftClientId: mailbox.microsoftClientId, encryptedClientSecretReference: mailbox.encryptedClientSecretReference }),
        (input) => this.ticketsService.executeEmailReply(input))) {
        operationalEmailsHandled += 1;
        continue;
      }
      const eventRequest = await this.findEventRequestForMessage(mailbox.organizationId, message.subject, message.conversationId ?? null);
      if (eventRequest) {
        await this.prisma.eventServiceMessage.create({
          data: {
            requestId: eventRequest.id,
            direction: MessageDirection.INBOUND,
            visibility: MessageVisibility.PUBLIC,
            bodyText: message.bodyText ?? message.bodyHtml ?? "",
            bodyHtml: message.bodyHtml ?? null,
            sanitizedBodyHtml: message.bodyHtml ? this.htmlSanitizer.sanitizeEmail(message.bodyHtml) : null,
            senderEmail: message.from.email,
            emailMessageId: message.providerMessageId,
            emailInternetMessageId: message.internetMessageId ?? null,
            emailConversationId: message.conversationId ?? null,
            inReplyTo: message.inReplyTo ?? null,
            emailReferences: message.references ?? null
          }
        });
        await this.prisma.eventServiceActivity.create({
          data: {
            requestId: eventRequest.id,
            action: "event_service_message.received",
            metadata: { senderEmail: message.from.email, subject: message.subject }
          }
        });
        skippedDuplicates += 1;
        continue;
      }
      const senderDomain = this.extractDomain(message.from.email);
      let spamBlock = await this.spamManagement.findBlockForSender(mailbox.organizationId, message.from.email, senderDomain);
      if (spamBlock?.scope === "NEW_CONVERSATIONS_ONLY") {
        const existingTicketConversation = this.ticketsService.hasExistingInboundConversation
          ? await this.ticketsService.hasExistingInboundConversation({
              organizationId: mailbox.organizationId,
              subject: message.subject,
              bodyText: message.bodyText,
              emailConversationId: message.conversationId,
              inReplyTo: message.inReplyTo,
              references: message.references
            })
          : false;
        if (existingTicketConversation) spamBlock = null;
      }
      if (spamBlock) {
        await this.spamManagement.logBlockedInboundEmail({
          organizationId: mailbox.organizationId,
          mailboxId: mailbox.id,
          spamBlockEntryId: spamBlock.id,
          senderEmail: message.from.email,
          senderName: message.from.name,
          senderDomain,
          subject: message.subject,
          bodyText: message.bodyText,
          bodyHtml: message.bodyHtml,
          emailMessageId: message.providerMessageId,
          emailInternetMessageId: message.internetMessageId,
          emailConversationId: message.conversationId,
          inReplyTo: message.inReplyTo,
          references: message.references,
          hasAttachments: message.hasAttachments,
          ccRecipients: message.cc ?? undefined,
          internetMessageHeaders: message.internetMessageHeaders,
          reason: `Blocked by ${spamBlock.type.toLowerCase()} rule: ${spamBlock.normalizedValue}`
        });
        blockedSpamMessages += 1;
        continue;
      }
      const result = await this.ticketsService.createFromInboundEmail({
        organizationId: mailbox.organizationId,
        mailboxId: mailbox.id,
        senderEmail: message.from.email,
        senderName: message.from.name,
        subject: message.subject,
        bodyText: message.bodyText,
        bodyHtml: message.bodyHtml,
        emailMessageId: message.providerMessageId,
        emailInternetMessageId: message.internetMessageId,
        emailConversationId: message.conversationId,
        inReplyTo: message.inReplyTo,
        references: message.references,
        hasAttachments: message.hasAttachments,
        ccRecipients: message.cc,
        internetMessageHeaders: message.internetMessageHeaders
      });

      if (this.shouldFetchInboundAttachments(providerName, message)) {
        const stored = await this.storeInboundAttachments(provider, mailbox, message.providerMessageId, result.ticket.id, result.message.id);
        attachmentBackfilled += stored.stored;
        attachmentBackfillFailures += stored.failed;
        attachmentBackfillErrors.push(...stored.errors);
      }
      createdTickets += 1;
    }

    const backfill = await this.backfillExistingMessageAttachments(provider, mailbox, {
      broad: providerName === "microsoft365" && options.broadAttachmentBackfill
    });
    attachmentBackfilled += backfill.stored;
    attachmentBackfillFailures += backfill.failed;
    attachmentBackfillErrors.push(...backfill.errors);

    if (!options.preserveSyncState) {
      await this.prisma.mailbox.update({
        where: { id: mailbox.id },
        data: {
          ...(syncResult.nextSyncCursor !== undefined ? { lastSyncCursor: syncResult.nextSyncCursor } : {}),
          inboundProjectionVersion: CURRENT_INBOUND_PROJECTION_VERSION,
          lastSyncedAt: new Date(),
          lastSyncError: null,
          nextAutoSyncAt: mailbox.autoSyncEnabled && mailbox.autoSyncIntervalSeconds ? new Date(Date.now() + mailbox.autoSyncIntervalSeconds * 1000) : mailbox.nextAutoSyncAt,
          autoSyncLockedAt: null
        }
      });
    }

    return {
      mailboxId: mailbox.id,
      provider: providerName,
      receivedMessages: syncResult.messages.length,
      createdTickets,
      skippedDuplicates,
      ...(operationalEmailsHandled ? { operationalEmailsHandled } : {}),
      blockedSpamMessages,
      attachmentBackfilled,
      attachmentBackfillFailures,
      attachmentBackfillErrors: attachmentBackfillErrors.slice(0, 10),
      nextSyncCursor: syncResult.nextSyncCursor
    };
  }

  private jsonStringRecord(value: Prisma.JsonValue | null): Record<string, string> | undefined {
    if (!value || Array.isArray(value) || typeof value !== "object") return undefined;
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  }

  private jsonInboundMailAddresses(value: Prisma.JsonValue | null): InboundMailMessage["cc"] {
    if (!Array.isArray(value)) return undefined;
    return value.flatMap((entry) => {
      if (!entry || Array.isArray(entry) || typeof entry !== "object") return [];
      const email = typeof entry.email === "string" ? entry.email.trim() : "";
      if (!email) return [];
      return [{ email, name: typeof entry.name === "string" ? entry.name : null }];
    });
  }

  private scheduleBroadAttachmentBackfill(mailbox: Mailbox) {
    const { providerName } = this.resolveProvider(mailbox);
    if (providerName !== "microsoft365" || this.runningAttachmentBackfills.has(mailbox.id)) {
      return;
    }

    this.runningAttachmentBackfills.add(mailbox.id);
    void this.runBroadAttachmentBackfill(mailbox).finally(() => {
      this.runningAttachmentBackfills.delete(mailbox.id);
    });
  }

  private async runBroadAttachmentBackfill(mailbox: Mailbox) {
    try {
      const { providerName, provider } = this.resolveProvider(mailbox);
      if (providerName !== "microsoft365") {
        return;
      }

      const result = await this.backfillExistingMessageAttachments(provider, mailbox, { broad: true });
      if (result.failed > 0) {
        this.logger.warn(
          `Mailbox attachment backfill completed for ${mailbox.emailAddress} with ${result.failed} failure${result.failed === 1 ? "" : "s"}.`
        );
      } else if (result.stored > 0) {
        this.logger.log(`Mailbox attachment backfill stored ${result.stored} attachment${result.stored === 1 ? "" : "s"} for ${mailbox.emailAddress}.`);
      }
    } catch (error) {
      this.logger.warn(`Mailbox attachment backfill failed for ${mailbox.emailAddress}: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  private async findEventRequestForMessage(organizationId: string, subject: string, conversationId: string | null) {
    if (conversationId) {
      const existingMessage = await this.prisma.eventServiceMessage.findFirst({
        where: {
          emailConversationId: conversationId,
          request: { organizationId, deletedAt: null }
        },
        select: { requestId: true }
      });
      if (existingMessage) {
        return this.prisma.eventServiceRequest.findFirst({
          where: { id: existingMessage.requestId, organizationId, deletedAt: null },
          select: { id: true }
        });
      }
    }

    const trackingNumber = subject.match(/\bEVT-\d+\b/i)?.[0]?.toUpperCase();
    if (!trackingNumber) {
      return null;
    }

    return this.prisma.eventServiceRequest.findFirst({
      where: { organizationId, trackingNumber, deletedAt: null },
      select: { id: true }
    });
  }

  private async getMailboxForUser(mailboxId: string, user: AuthenticatedUser) {
    const mailbox = await this.prisma.mailbox.findFirst({
      where: {
        id: mailboxId,
        organizationId: user.organizationId
      }
    });

    if (!mailbox) {
      throw new NotFoundException("Mailbox was not found.");
    }

    return mailbox;
  }

  private resolveProvider(mailbox: Mailbox): { providerName: "mock" | "microsoft365"; provider: MailProvider } {
    const configuredProvider = this.config.get<string>("MAIL_PROVIDER")?.trim().toLowerCase();

    if (configuredProvider === "mock") {
      return { providerName: "mock", provider: this.mockMailProvider };
    }

    if (configuredProvider === "microsoft365") {
      return { providerName: "microsoft365", provider: this.microsoftGraphMailProvider };
    }

    if (mailbox.connectionMode === "MOCK" || mailbox.provider === "MOCK") {
      return { providerName: "mock", provider: this.mockMailProvider };
    }

    if (mailbox.provider === "MICROSOFT365") {
      return { providerName: "microsoft365", provider: this.microsoftGraphMailProvider };
    }

    const hasGraphConfiguration = Boolean(mailbox.tenantId && mailbox.microsoftClientId && mailbox.encryptedClientSecretReference);
    return hasGraphConfiguration
      ? { providerName: "microsoft365", provider: this.microsoftGraphMailProvider }
      : { providerName: "mock", provider: this.mockMailProvider };
  }

  private optionalTrim(value: string | null | undefined) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private optionalEmail(value: string | null | undefined) {
    return this.optionalTrim(value)?.toLowerCase() ?? null;
  }

  private extractDomain(emailAddress: string) {
    const atIndex = emailAddress.lastIndexOf("@");
    if (atIndex === -1 || atIndex === emailAddress.length - 1) {
      return null;
    }
    return emailAddress.slice(atIndex + 1).trim().toLowerCase().replace(/\.$/, "") || null;
  }

  private getMailboxReadAddress(mailbox: Mailbox) {
    if (mailbox.connectionMode === "GRAPH_FORWARDED_MAILBOX" && mailbox.ingestionEmailAddress) {
      return mailbox.ingestionEmailAddress;
    }

    return mailbox.emailAddress;
  }

  private async storeInboundAttachments(
    provider: MailProvider,
    mailbox: Mailbox,
    providerMessageId: string,
    ticketId: string,
    ticketMessageId: string,
    existingFailures: unknown = []
  ) {
    let attachments;
    try {
      attachments = await provider.getMessageAttachments({
        mailboxId: mailbox.id,
        mailboxEmailAddress: this.getMailboxReadAddress(mailbox),
        providerMessageId,
        tenantId: mailbox.tenantId,
        microsoftClientId: mailbox.microsoftClientId,
        encryptedClientSecretReference: mailbox.encryptedClientSecretReference
      });
    } catch (error) {
      const message = `Unable to retrieve attachments for message ${providerMessageId}: ${this.errorMessage(error)}`;
      this.logger.warn(message);
      return { stored: 0, failed: 1, errors: [message] };
    }

    let stored = 0;
    let failed = 0;
    const errors: string[] = [];
    let hasTransientFailure = false;
    const importFailures = this.normalizeAttachmentImportFailures(existingFailures);
    const rejectedAttachmentIds = new Set(importFailures.map((failure) => failure.attachmentId));

    for (const attachment of attachments) {
      if (!attachment.contentBytes || rejectedAttachmentIds.has(attachment.id)) {
        continue;
      }

      try {
        const result = await this.ticketAttachmentsService.createInboundEmailAttachment({
          ticketId,
          ticketMessageId,
          originalFilename: attachment.originalFilename,
          mimeType: attachment.mimeType,
          buffer: attachment.contentBytes,
          isInline: attachment.isInline,
          contentId: attachment.contentId,
          emailAttachmentId: attachment.id
        });
        if (result.created) {
          stored += 1;
        }
      } catch (error) {
        failed += 1;
        const message = `Unable to store attachment ${attachment.originalFilename} from message ${providerMessageId}: ${this.errorMessage(error)}`;
        errors.push(message);
        this.logger.warn(message);
        if (error instanceof BadRequestException) {
          importFailures.push({
            attachmentId: attachment.id,
            originalFilename: attachment.originalFilename,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            reason: this.errorMessage(error),
            rejectedAt: new Date().toISOString()
          });
          rejectedAttachmentIds.add(attachment.id);
        } else {
          hasTransientFailure = true;
        }
      }
    }

    await this.prisma.ticketMessage.update({
      where: { id: ticketMessageId },
      data: {
        hasAttachments: attachments.length > 0 ? true : undefined,
        attachmentImportFailures: importFailures as unknown as Prisma.InputJsonValue,
        attachmentsProcessedAt: hasTransientFailure ? undefined : new Date()
      }
    });

    return { stored, failed, errors };
  }

  private shouldFetchInboundAttachments(
    providerName: "mock" | "microsoft365",
    message: {
      hasAttachments?: boolean;
      bodyHtml?: string | null;
      bodyText?: string | null;
      attachmentsProcessedAt?: Date | string | null;
    }
  ) {
    if (message.attachmentsProcessedAt) {
      return false;
    }

    if (message.hasAttachments) {
      return true;
    }

    if (this.containsInlineAttachmentReference(message.bodyHtml) || this.containsInlineAttachmentReference(message.bodyText)) {
      return true;
    }

    return providerName === "microsoft365";
  }

  private containsInlineAttachmentReference(value: string | null | undefined) {
    return Boolean(value && /cid:/i.test(value));
  }

  private async backfillExistingMessageAttachments(provider: MailProvider, mailbox: Mailbox, options: { broad?: boolean } = {}) {
    const baseWhere = {
      direction: MessageDirection.INBOUND,
      emailMessageId: { not: null },
      attachmentsProcessedAt: null,
      ticket: {
        organizationId: mailbox.organizationId,
        mailboxId: mailbox.id,
        deletedAt: null
      }
    };
    const candidates = await this.prisma.ticketMessage.findMany({
      where: options.broad
        ? baseWhere
        : {
            ...baseWhere,
            OR: [
              { hasAttachments: true },
              { bodyHtml: { contains: "cid:", mode: "insensitive" } },
              { sanitizedBodyHtml: { contains: "cid:", mode: "insensitive" } }
            ]
          },
      select: {
        id: true,
        ticketId: true,
        emailMessageId: true,
        attachmentImportFailures: true
      },
      orderBy: { createdAt: "desc" },
      take: options.broad ? 200 : 100
    });
    let storedCount = 0;
    let failures = 0;
    const errors: string[] = [];

    for (const message of candidates) {
      if (message.emailMessageId) {
        const stored = await this.storeInboundAttachments(
          provider,
          mailbox,
          message.emailMessageId,
          message.ticketId,
          message.id,
          message.attachmentImportFailures
        );
        storedCount += stored.stored;
        failures += stored.failed;
        errors.push(...stored.errors);
      }
    }

    return { stored: storedCount, failed: failures, errors };
  }

  private normalizeAttachmentImportFailures(value: unknown): AttachmentImportFailure[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is AttachmentImportFailure => {
      if (!item || typeof item !== "object") {
        return false;
      }
      const failure = item as Partial<AttachmentImportFailure>;
      return (
        typeof failure.attachmentId === "string" &&
        typeof failure.originalFilename === "string" &&
        typeof failure.mimeType === "string" &&
        typeof failure.sizeBytes === "number" &&
        typeof failure.reason === "string" &&
        typeof failure.rejectedAt === "string"
      );
    });
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message.slice(0, 500) : "Unknown error";
  }
}
