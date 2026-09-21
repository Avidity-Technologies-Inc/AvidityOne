import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, TicketEmailDelivery } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { AuthenticatedUser } from "../auth/auth.types";
import { AuditLogsService } from "../audit-logs/audit-logs.service";
import { PrismaService } from "../prisma/prisma.service";
import { FileStorageService } from "../file-storage/file-storage.service";
import { MailDeliveryError } from "../mailboxes/providers/mail-delivery.error";
import { MailDeliveryService } from "../mailboxes/mail-delivery.service";
import { InboundMailMessage, MailAttachment, OutboundMailAttachment } from "../mailboxes/providers/mail-provider.interface";
import { HtmlSanitizerService } from "../../common/html/html-sanitizer.service";
import { UpdateTicketEmailPolicyDto } from "./ticket-email.dto";
import { authoredEmailText, emailText, escapeEmail, isAutomaticEmail, parseStaffReply, REPLY_SEPARATOR, ticketEmailDefaults, TicketEmailPolicy } from "./ticket-email.policy";

class AttachmentImportPendingError extends Error {}

type ExecuteReply = (input: { ticketId: string; user: AuthenticatedUser; bodyText: string; bodyHtml: string; mode: string; close: boolean; attachments: MailAttachment[]; operationId: string }) => Promise<{ id: string }>;
@Injectable()
export class TicketEmailService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly logger = new Logger(TicketEmailService.name);
  constructor(private readonly prisma: PrismaService, private readonly mail: MailDeliveryService,
    private readonly storage: FileStorageService, private readonly config: ConfigService,
    private readonly audit: AuditLogsService, private readonly sanitizer: HtmlSanitizerService) {}

  onModuleInit() { this.timer = setInterval(() => { void this.dispatch().catch(() => this.logger.warn("Ticket email dispatch needs attention.")); }, 5_000); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async policy(organizationId: string): Promise<TicketEmailPolicy> {
    const row = await this.prisma.ticketEmailPolicy.findUnique({ where: { organizationId } });
    return { ...ticketEmailDefaults, ...(row?.settings as Partial<TicketEmailPolicy> ?? {}) };
  }
  async updatePolicy(user: AuthenticatedUser, input: UpdateTicketEmailPolicyDto) {
    const settings = { ...await this.policy(user.organizationId), ...input };
    if (settings.closeEnabled && !settings.repliesEnabled) throw new BadRequestException("Enable email replies before close commands.");
    await this.prisma.ticketEmailPolicy.upsert({ where: { organizationId: user.organizationId }, create: { organizationId: user.organizationId, settings }, update: { settings } });
    await this.audit.create({ organizationId: user.organizationId, userId: user.id, entityType: "TicketEmailPolicy", action: "ticket.email_policy_updated", metadata: settings });
    return settings;
  }
  async overview(user: AuthenticatedUser, own = false) {
    const where = { organizationId: user.organizationId, ...(own ? { userId: user.id } : {}) };
    const [policy, deliveries, actions] = await Promise.all([
      this.policy(user.organizationId),
      this.prisma.ticketEmailDelivery.findMany({ where, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, ticketId: true, userId: true, subject: true, eventType: true, status: true, attempts: true, error: true, createdAt: true, acceptedAt: true } }),
      this.prisma.ticketEmailAction.findMany({ where, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, ticketId: true, userId: true, mode: true, closeTicket: true, status: true, error: true, createdAt: true, expiresAt: true } })
    ]);
    const [tickets, users] = await Promise.all([
      this.prisma.ticket.findMany({ where: { id: { in: [...new Set([...deliveries, ...actions].map((row) => row.ticketId))] }, organizationId: user.organizationId }, select: { id: true, ticketNumber: true } }),
      this.prisma.user.findMany({ where: { id: { in: [...new Set([...deliveries, ...actions].map((row) => row.userId))] }, organizationId: user.organizationId }, select: { id: true, firstName: true, lastName: true, email: true } })
    ]);
    const label = (row: { ticketId: string; userId: string }) => { const person = users.find((u) => u.id === row.userId); return { ticketNumber: tickets.find((t) => t.id === row.ticketId)?.ticketNumber ?? "Unavailable ticket", userName: person ? `${person.firstName} ${person.lastName}` : "Unavailable user", userEmail: person?.email ?? "" }; };
    return { policy, deliveries: deliveries.map((row) => ({ ...row, ...label(row) })), actions: actions.map((row) => ({ ...row, ...label(row) })) };
  }
  async retry(user: AuthenticatedUser, id: string) {
    const row = await this.prisma.ticketEmailDelivery.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!row) throw new NotFoundException("Delivery not found.");
    const result = await this.prisma.ticketEmailDelivery.updateMany({ where: { id, status: { in: ["FAILED", "REVIEW_REQUIRED"] } }, data: { status: "PENDING", attempts: 0, availableAt: new Date(), claimedAt: null, error: null } });
    if (!result.count) throw new BadRequestException("This delivery cannot be retried.");
    await this.audit.create({ organizationId: user.organizationId, userId: user.id, entityType: "TicketEmailDelivery", entityId: id, action: "ticket.email_retry_requested" });
    return { queued: true };
  }
  async actor(userId: string, organizationId: string): Promise<AuthenticatedUser | null> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, organizationId, isActive: true, deletedAt: null }, include: { groups: { include: { group: { include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } } } } } });
    if (!user) return null;
    return { id: user.id, organizationId, email: user.email, firstName: user.firstName, lastName: user.lastName, forcePasswordChange: user.forcePasswordChange,
      permissions: [...new Set(user.groups.flatMap((g) => g.group.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.name))))] };
  }
  private async eligible(ticketId: string, user: AuthenticatedUser, policy: TicketEmailPolicy, allSubscribers = false) {
    if (!user.permissions.includes("tickets.view") || !user.permissions.includes("ticket_messages.view")) return false;
    const ticket = await this.prisma.ticket.findFirst({ where: { id: ticketId, organizationId: user.organizationId, deletedAt: null }, include: { assignees: true, watchers: true } });
    if (!ticket) return false;
    if (allSubscribers || ticket.assignedUserId === user.id || ticket.assignees.some((a) => a.userId === user.id)) return true;
    if (policy.includeWatchers && ticket.watchers.some((w) => w.userId === user.id && !/assignment|assigned|routing rule/i.test(w.reason ?? ""))) return true;
    if (policy.includeTeams && ticket.assignedTeamId && await this.prisma.ticketTeamMember.count({ where: { ticketTeamId: ticket.assignedTeamId, userId: user.id } })) return true;
    return Boolean(policy.includeGroups && ticket.assignedGroupId && await this.prisma.userGroup.count({ where: { groupId: ticket.assignedGroupId, userId: user.id } }));
  }
  async enqueue(input: { organizationId: string; userId: string; ticketId: string; eventType: string; title: string; messageId?: string | null }) {
    const policy = await this.policy(input.organizationId);
    if (!policy.enabled) return false;
    const user = await this.actor(input.userId, input.organizationId);
    if (!user || !await this.eligible(input.ticketId, user, policy, input.eventType === "newTicketCreated")) return true;
    const internal = input.eventType.startsWith("internalNote");
    if (internal && !policy.includeInternal) return true;
    const message = await this.prisma.ticketMessage.findFirst({ where: { ticketId: input.ticketId, ...(input.messageId ? { id: input.messageId } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const mode = internal ? "INTERNAL" : "PUBLIC";
    const snapshot = ["ticketAssignedToMe", "ticketAssignedToMyTeam", "routingRuleMatched", "newTicketCreated"].includes(input.eventType);
    const assignment = snapshot ? await this.prisma.ticketAssignee.findUnique({ where: { ticketId_userId: { ticketId: input.ticketId, userId: input.userId } }, select: { id: true } }) : null;
    if (!snapshot && message && policy.includeHistory && await this.prisma.ticketEmailDelivery.count({ where: { ticketId: input.ticketId, userId: input.userId, mode, messageId: null, cutoff: { gte: message.createdAt }, status: { in: ["PENDING", "PREPARING", "SENDING", "ACCEPTED", "SIMULATED"] } } })) return true;
    const dedupeKey = `${input.ticketId}:${input.userId}:${snapshot ? `snapshot:${assignment?.id ?? "subscriber"}` : "message"}:${message?.id ?? input.eventType}:${mode}`;
    await this.prisma.ticketEmailDelivery.createMany({ skipDuplicates: true, data: {
      organizationId: input.organizationId, ticketId: input.ticketId, userId: input.userId, eventType: input.eventType,
      messageId: snapshot ? null : message?.id, replyKey: randomBytes(24).toString("hex"), mode, subject: input.title, cutoff: new Date(), dedupeKey,
      // Assignments are ready immediately; only incomplete attachment imports wait.
      availableAt: new Date()
    } });
    return true;
  }
  private async notice(input: { organizationId: string; ticketId: string; userId: string }, subject: string, bodyText: string, key: string, db: Prisma.TransactionClient = this.prisma) {
    await db.ticketEmailDelivery.createMany({ skipDuplicates: true, data: { ...input, eventType: "operationReceipt", mode: "NOTICE", subject, bodyText, replyKey: randomBytes(24).toString("hex"), dedupeKey: key } });
  }
  async dispatch() {
    if (this.running) return;
    this.running = true;
    try {
      await this.prisma.ticketEmailDelivery.updateMany({ where: { status: "PREPARING", claimedAt: { lt: new Date(Date.now() - 15 * 60_000) } }, data: { status: "PENDING", availableAt: new Date() } });
      await this.captureEvents();
      await this.prisma.ticketEmailDelivery.updateMany({ where: { status: "SENDING", claimedAt: { lt: new Date(Date.now() - 15 * 60_000) } }, data: { status: "REVIEW_REQUIRED", error: "Interrupted send. Verify the mailbox before retrying; delivery may already have been accepted." } });
      await this.prisma.ticketEmailAction.updateMany({ where: { status: "AWAITING_CONFIRMATION", expiresAt: { lt: new Date() } }, data: { status: "EXPIRED" } });
      await this.prisma.ticketEmailAction.updateMany({ where: { status: "PROCESSING", expiresAt: { lt: new Date(Date.now() - 15 * 60_000) } }, data: { status: "REVIEW_REQUIRED", error: "Interrupted action. Inspect the ticket before submitting another reply." } });
      const rows = await this.prisma.ticketEmailDelivery.findMany({ where: { status: "PENDING", availableAt: { lte: new Date() } }, orderBy: { createdAt: "asc" }, take: 20 });
      // Independent recipients can progress together; deliver still enforces each
      // ticket/user/channel order and claims every row atomically.
      for (let offset = 0; offset < rows.length; offset += 4) {
        const results = await Promise.allSettled(rows.slice(offset, offset + 4).map((row) => this.deliver(row)));
        if (results.some((result) => result.status === "rejected")) this.logger.warn("Ticket email queue update failed; recovery will inspect pending leases.");
      }
    } finally { this.running = false; }
  }
  private async captureEvents() {
    const events = await this.prisma.ticketEmailEvent.findMany({ where: { processedAt: null }, orderBy: { createdAt: "asc" }, take: 100 });
    for (const event of events) {
      const ticket = await this.prisma.ticket.findFirst({ where: { id: event.ticketId, organizationId: event.organizationId, deletedAt: null }, include: { assignees: true, watchers: true } });
      const policy = await this.policy(event.organizationId);
      if (ticket && policy.enabled) {
        const message = event.messageId ? await this.prisma.ticketMessage.findUnique({ where: { id: event.messageId } }) : null;
        if (message?.suppressOperationalEmail) { await this.prisma.ticketEmailEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } }); continue; }
        if (event.kind === "CREATED") {
          const subscribers = await this.prisma.user.findMany({ where: { organizationId: event.organizationId, isActive: true, deletedAt: null, notificationPreference: { emailEnabled: true, emailNewTicketCreated: true } }, select: { id: true } });
          for (const subscriber of subscribers) await this.enqueue({ organizationId: event.organizationId, ticketId: event.ticketId, userId: subscriber.id, eventType: "newTicketCreated", title: `New ticket: ${ticket.ticketNumber}` });
        }
        const recipients = new Set([...(ticket.assignedUserId ? [ticket.assignedUserId] : []), ...ticket.assignees.map((a) => a.userId), ...ticket.watchers.map((w) => w.userId)]);
        if (policy.includeTeams && ticket.assignedTeamId) (await this.prisma.ticketTeamMember.findMany({ where: { ticketTeamId: ticket.assignedTeamId } })).forEach((m) => recipients.add(m.userId));
        if (policy.includeGroups && ticket.assignedGroupId) (await this.prisma.userGroup.findMany({ where: { groupId: ticket.assignedGroupId } })).forEach((m) => recipients.add(m.userId));
        for (const userId of event.userId ? [event.userId] : recipients) {
          const eventType = event.kind !== "MESSAGE" ? (userId === ticket.assignedUserId || ticket.assignees.some((a) => a.userId === userId) ? "ticketAssignedToMe" : ticket.assignedTeamId ? "ticketAssignedToMyTeam" : "ticketAssignedToMe") : message?.visibility === "INTERNAL" ? "internalNoteOnAssignedTicket" : "ticketReplyOnAssignedTicket";
          const pref = await this.prisma.userNotificationPreference.findUnique({ where: { userId } });
          const field = `email${eventType[0].toUpperCase()}${eventType.slice(1)}`;
          if (pref?.emailEnabled && (pref as unknown as Record<string, unknown>)[field]) await this.enqueue({ organizationId: event.organizationId, ticketId: event.ticketId, userId, eventType, title: `${event.kind === "ASSIGNMENT" ? "Ticket assigned" : "Ticket conversation"}: ${ticket.ticketNumber}`, messageId: message?.id });
        }
      }
      await this.prisma.ticketEmailEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    }
  }

  private async deliver(row: TicketEmailDelivery) {
    const first = await this.prisma.ticketEmailDelivery.findFirst({ where: { ticketId: row.ticketId, userId: row.userId, mode: row.mode, status: { in: ["PENDING", "PREPARING", "SENDING"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
    if (first?.id !== row.id) return;
    const claim = await this.prisma.ticketEmailDelivery.updateMany({ where: { id: row.id, status: "PENDING" }, data: { status: "PREPARING", claimedAt: new Date(), attempts: { increment: 1 } } });
    if (!claim.count) return;
    let sending = false;
    try {
      const policy = await this.policy(row.organizationId);
      const user = await this.actor(row.userId, row.organizationId);
      const receipt = row.mode === "NOTICE";
      if (receipt && row.subject === "Confirm your ticket email action") {
        await this.prisma.ticketEmailDelivery.update({ where: { id: row.id }, data: { status: "CANCELLED", error: "Legacy confirmation retired. Submit a new email reply for direct processing." } });
        return;
      }
      if (!user || !policy.enabled || !await this.eligible(row.ticketId, user, policy, receipt || row.eventType === "newTicketCreated") || (row.mode === "INTERNAL" && !policy.includeInternal)) {
        await this.prisma.ticketEmailDelivery.update({ where: { id: row.id }, data: { status: "CANCELLED", error: "Feature disabled or recipient no longer eligible." } }); return;
      }
      if (!receipt) {
        const pref = await this.prisma.userNotificationPreference.findUnique({ where: { userId: user.id } });
        const field = `email${row.eventType[0].toUpperCase()}${row.eventType.slice(1)}`;
        if (!pref?.emailEnabled || !(pref as unknown as Record<string, unknown>)[field]) {
          await this.prisma.ticketEmailDelivery.update({ where: { id: row.id }, data: { status: "CANCELLED", error: "Recipient disabled this email event." } }); return;
        }
      }
      const ticket = await this.prisma.ticket.findFirstOrThrow({ where: { id: row.ticketId, organizationId: row.organizationId, deletedAt: null }, include: { statusDefinition: true } });
      const mailbox = await this.prisma.mailbox.findFirst({ where: { organizationId: row.organizationId, isActive: true, ...(ticket.mailboxId ? { id: ticket.mailboxId } : {}) }, orderBy: { createdAt: "asc" } });
      if (!mailbox || mailbox.outboundMode === "NONE") throw new Error("The ticket mailbox has no enabled outbound delivery.");
      const settings = await this.prisma.systemSetting.findUnique({ where: { organizationId: row.organizationId }, select: { applicationName: true, emailOperationalTimezone: true } });
      const timezone = settings?.emailOperationalTimezone || "UTC";
      let html = `<p>${escapeEmail(REPLY_SEPARATOR)}</p><h2>${escapeEmail(settings?.applicationName ?? "Ticket")}: ${escapeEmail(ticket.ticketNumber)}</h2><p>${escapeEmail(ticket.subject)}</p><p>Status: ${escapeEmail(ticket.statusDefinition?.name ?? ticket.status)} · ${escapeEmail(row.mode)}</p>`;
      const attachments: OutboundMailAttachment[] = [];
      if (receipt) html += `<p>${escapeEmail(row.bodyText ?? "").replace(/\n/g, "<br>")}</p>`;
      else {
        const messages = await this.prisma.ticketMessage.findMany({ where: { ticketId: row.ticketId, createdAt: { lte: row.cutoff }, ...(row.messageId ? { id: row.messageId } : {}), visibility: row.mode === "INTERNAL" ? undefined : "PUBLIC" }, include: { authorUser: true, authorContact: true, attachments: { where: { deletedAt: null } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
        const selected = row.messageId || policy.includeHistory ? messages : messages.slice(-1);
        if (selected.some((m) => (m.hasAttachments || /cid:/i.test(m.bodyHtml ?? "")) && m.direction === "INBOUND" && !m.attachmentsProcessedAt)) throw new AttachmentImportPendingError("Waiting for inbound attachments to finish importing.");
        let remaining = policy.attachmentBudgetMb * 1024 * 1024;
        const downloadableImages: OutboundMailAttachment[] = [];
        for (const m of selected) {
          const author = m.authorUser ? `${m.authorUser.firstName} ${m.authorUser.lastName}` : m.senderEmail ?? "Requester";
          html += `<hr><p><strong>${escapeEmail(author)}</strong> · ${escapeEmail(m.createdAt.toLocaleString("en-US", { timeZone: timezone }))} (${escapeEmail(timezone)}) · ${escapeEmail(m.visibility)}</p>`;
          const inlineIds = new Map(m.attachments.filter((file) => file.contentId).map((file) => [file.contentId!.replace(/^<|>$/g, "").toLowerCase(), `file-${file.id}@ticket`]));
          const sourceHtml = m.bodyHtml ?? m.sanitizedBodyHtml ?? `<p>${escapeEmail(m.bodyText).replace(/\n/g, "<br>")}</p>`;
          const messageHtml = this.sanitizer.sanitizeEmail(sourceHtml.replace(/cid:([^"'\s>]+)/gi, (match, cid: string) => inlineIds.has(cid.toLowerCase()) ? `cid:${inlineIds.get(cid.toLowerCase())}` : match));
          html += messageHtml;
          if (Array.isArray(m.attachmentImportFailures) && m.attachmentImportFailures.length) html += `<p>Some source attachments could not be imported. Review the ticket for the recorded failures.</p>`;
          for (const file of m.attachments) {
            let includedAs = "attached file";
            let omission = !policy.includeAttachments ? "attachment copies disabled" : !user.permissions.includes("ticket_attachments.download") ? "download permission required" : ["SUSPICIOUS", "BLOCKED"].includes(file.scanStatus) ? "not cleared for delivery" : file.fileSize > remaining ? "email attachment budget exceeded" : null;
            if (!omission) {
              try {
                const chunks: Buffer[] = [];
                for await (const chunk of await this.storage.getFileStream(file.storageKey)) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                const contentBytes = Buffer.concat(chunks);
                if (contentBytes.length > remaining) omission = "email attachment budget exceeded";
                else {
                  const contentId = file.contentId ? inlineIds.get(file.contentId.replace(/^<|>$/g, "").toLowerCase()) : null;
                  const embedded = Boolean(contentId && messageHtml.toLowerCase().includes(`cid:${contentId}`.toLowerCase()));
                  const copy = { originalFilename: file.originalFilename, mimeType: file.mimeType, sizeBytes: contentBytes.length, contentBytes };
                  attachments.push({ ...copy, contentId: embedded ? contentId : null, isInline: embedded });
                  remaining -= contentBytes.length;
                  if (embedded) {
                    // Keep the image in place; add a downloadable copy after original
                    // files so duplicate image bytes cannot displace other attachments.
                    downloadableImages.push({ ...copy, contentId: null, isInline: false });
                    includedAs = "embedded image; see downloadable image copies below";
                  }
                }
              } catch { omission = "file could not be read; open the ticket to retrieve it"; }
            }
            html += `<p>Attachment: ${escapeEmail(file.originalFilename)} — ${omission ? escapeEmail(omission) : includedAs}</p>`;
          }
        }
        if (downloadableImages.length) {
          html += "<h3>Downloadable image copies</h3>";
          for (const copy of downloadableImages) {
            const fits = copy.sizeBytes <= remaining;
            if (fits) { attachments.push(copy); remaining -= copy.sizeBytes; }
            html += `<p>${escapeEmail(copy.originalFilename)} — ${fits ? "attached file (also displayed in the message)" : "downloadable copy omitted: email attachment budget exceeded; image remains embedded in the message"}</p>`;
          }
        }
        if (Buffer.byteLength(html) > 1024 * 1024) throw new Error("Conversation exceeds the safe email size. Disable assignment history or retrieve the full ticket in the platform.");
        html += `<hr><p>${policy.repliesEnabled ? `Reply above the separator to submit a ${row.mode === "INTERNAL" ? "staff-only note" : "public reply to the requester and current ticket CCs"}. Authorized replies are processed directly; no confirmation is required.${policy.closeEnabled ? " Place [Closed] on the first line to also close the ticket." : " Email close commands are disabled."}` : "Replies from email are disabled. Use the platform to respond."}</p>`;
      }
      const appUrl = this.config.get<string>("APP_URL") ?? this.config.get<string>("WEB_URL");
      if (appUrl && /^https?:\/\//.test(appUrl)) html += `<p><a href="${escapeEmail(appUrl.replace(/\/$/, ""))}/tickets/${encodeURIComponent(ticket.ticketNumber)}">Open ticket</a></p>`;
      await this.prisma.ticketEmailDelivery.update({ where: { id: row.id }, data: { status: "SENDING" } });
      sending = true;
      const result = await this.mail.sendTicketReply({ organizationId: row.organizationId, ticketId: ticket.id, mailboxId: mailbox.id, to: [user.email], subject: `[${ticket.ticketNumber}] ${row.subject} [AO:${row.replyKey}]`, bodyHtml: html, bodyText: emailText(html), rawAttachments: attachments, trackDelivery: true });
      if (!result) throw new Error("Outbound delivery was not accepted.");
      const mock = this.config.get<string>("MAIL_PROVIDER")?.toLowerCase() === "mock" || (this.config.get<string>("MAIL_PROVIDER")?.toLowerCase() !== "microsoft365" && (mailbox.provider === "MOCK" || mailbox.connectionMode === "MOCK"));
      await this.prisma.ticketEmailDelivery.update({ where: { id: row.id }, data: { status: mock ? "SIMULATED" : "ACCEPTED", acceptedAt: new Date(), providerMessageId: result.providerMessageId, error: null } });
      await this.audit.create({ organizationId: row.organizationId, entityType: "TicketEmailDelivery", entityId: row.id, action: mock ? "ticket.email_simulated" : "ticket.email_accepted", metadata: { ticketId: row.ticketId, recipientUserId: user.id, recipientEmail: user.email, providerMessageId: result.providerMessageId, mode: row.mode } });
    } catch (error) {
      if (error instanceof AttachmentImportPendingError && Date.now() - row.createdAt.getTime() < 15 * 60_000) {
        await this.prisma.ticketEmailDelivery.update({ where: { id: row.id }, data: {
          status: "PENDING", attempts: { decrement: 1 }, availableAt: new Date(Date.now() + 5_000), error: error.message
        } });
        return;
      }
      const transport = error instanceof MailDeliveryError ? error : null;
      const uncertain = transport ? transport.outcome === "UNKNOWN" : sending;
      const retryable = transport ? transport.retryable : !sending;
      const status = uncertain ? "REVIEW_REQUIRED" : !retryable || row.attempts >= 4 ? "FAILED" : "PENDING";
      const detail = transport?.message ?? (uncertain ? "Provider acceptance is uncertain. Inspect sent mail before retrying to avoid duplicate delivery." : error instanceof Error ? error.message : "Unable to prepare email");
      await this.prisma.ticketEmailDelivery.update({ where: { id: row.id }, data: {
        status, availableAt: new Date(Date.now() + Math.max(transport?.retryAfterMs ?? 0, 5_000 * Math.pow(2, row.attempts))),
        error: (status === "FAILED" && retryable ? `${detail} Automatic retry limit reached; review and retry manually.` : detail).slice(0, 300)
      } });
    }
  }

  async inbound(mailbox: { id: string; organizationId: string }, message: InboundMailMessage, loadAttachments: (providerMessageId: string) => Promise<MailAttachment[]>, execute: ExecuteReply): Promise<boolean> {
    const key = message.subject.match(/\[AO:([a-f0-9]{48})\]/i)?.[1]?.toLowerCase();
    const confirmationText = authoredEmailText(message.bodyText, message.bodyHtml);
    const confirm = confirmationText.trim().split(/\r?\n/)[0]?.trim().match(/^\[Confirm ([a-f0-9]{48})\]$/i)?.[1]?.toLowerCase();
    if (!key && !confirm) return this.handleUnlinkedStaffReply(mailbox, message);
    // Operational messages must never fall back to customer ingestion, even after disablement.
    if (isAutomaticEmail(message.internetMessageHeaders)) return true;
    const policy = await this.policy(mailbox.organizationId);
    if (!policy.enabled || !policy.repliesEnabled) return true;
    // Confirmation emails from the retired workflow never execute old proposals.
    if (confirm) return true;
    const delivery = await this.prisma.ticketEmailDelivery.findFirst({ where: { replyKey: key, organizationId: mailbox.organizationId, status: { in: ["ACCEPTED", "SIMULATED"] }, mode: { in: ["PUBLIC", "INTERNAL"] } } });
    if (!delivery) return true;
    const user = await this.actor(delivery.userId, delivery.organizationId);
    if (!user || user.email.toLowerCase() !== message.from.email.toLowerCase()) return true;
    const ticket = await this.prisma.ticket.findFirst({ where: { id: delivery.ticketId, organizationId: mailbox.organizationId, deletedAt: null } });
    if (!ticket || (ticket.mailboxId && ticket.mailboxId !== mailbox.id)) return true;
    const sourceKey = `${mailbox.organizationId}:${message.internetMessageId ?? `${mailbox.id}:${message.providerMessageId}`}`;
    if (await this.prisma.ticketEmailAction.findUnique({ where: { sourceKey } })) return true;
    const invalidKey = `invalid:${this.hash(sourceKey)}`;
    if (await this.prisma.ticketEmailDelivery.findUnique({ where: { dedupeKey: invalidKey } })) return true;
    const context = { organizationId: delivery.organizationId, ticketId: delivery.ticketId, userId: delivery.userId };
    let operationId: string | null = null;
    let executionStarted = false;
    try {
      if (message.rawFrom && message.rawFrom.email.toLowerCase() !== user.email.toLowerCase()) throw new BadRequestException("Reply directly from your registered account, not a forwarded sender identity.");
      const parsed = parseStaffReply(message.bodyText, message.bodyHtml, Boolean(message.hasAttachments));
      await this.assertAction(user, delivery.ticketId, delivery.mode, parsed.close, policy);
      const recipientSnapshot = delivery.mode === "PUBLIC" && (parsed.bodyText || message.hasAttachments) ? await this.publicRecipients(ticket.id, mailbox.organizationId) : [];
      // The unique source key atomically claims the incoming email before any send
      // or ticket mutation. Legacy schema fields remain for historical records.
      const action = await this.prisma.ticketEmailAction.create({ data: {
        ...context, mailboxId: mailbox.id, sourceKey, providerMessageId: message.providerMessageId,
        recipientSnapshot, originalBodyText: message.bodyText, originalBodyHtml: message.bodyHtml,
        bodyText: parsed.bodyText, bodyHtml: parsed.bodyHtml, closeTicket: parsed.close, mode: delivery.mode,
        hasAttachments: Boolean(message.hasAttachments || /cid:/i.test(message.bodyHtml ?? "")),
        confirmationHash: this.hash(randomBytes(24).toString("hex")), expiresAt: new Date(), status: "PROCESSING"
      } });
      operationId = action.id;
      const originals = action.hasAttachments ? await loadAttachments(action.providerMessageId) : [];
      if (action.hasAttachments && !originals.length) throw new BadRequestException("The original email attachments could not be retrieved. Send a new reply after verifying the files.");
      const attachments = originals.filter((file) => !file.isInline || Boolean(file.contentId && parsed.bodyHtml.toLowerCase().includes(`cid:${file.contentId.replace(/^<|>$/g, "").toLowerCase()}`)));
      const currentUser = await this.actor(user.id, user.organizationId);
      if (!currentUser) throw new BadRequestException("Your account is no longer available for ticket email actions.");
      await this.assertAction(currentUser, ticket.id, delivery.mode, parsed.close, await this.policy(mailbox.organizationId));
      if (delivery.mode === "PUBLIC" && JSON.stringify(recipientSnapshot) !== JSON.stringify(await this.publicRecipients(ticket.id, mailbox.organizationId)) && (parsed.bodyText || message.hasAttachments)) throw new BadRequestException("Ticket recipients changed while processing. Send a new reply to use the current recipients.");
      executionStarted = true;
      const result = await execute({ ticketId: action.ticketId, user: currentUser, bodyText: parsed.bodyText, bodyHtml: parsed.bodyHtml, mode: action.mode, close: parsed.close, attachments, operationId: action.id });
      await this.prisma.ticketEmailAction.update({ where: { id: action.id }, data: { status: "COMPLETED", resultMessageId: result.id, completedAt: new Date() } });
      // A failed informational receipt must not turn a completed reply into a retry.
      try {
        await this.audit.create({ ...context, entityType: "Ticket", entityId: action.ticketId, action: "ticket.email_action_completed", metadata: { operationId: action.id, messageId: result.id, close: parsed.close, mode: action.mode } });
        await this.notice(context, "Ticket email action completed", `${action.mode === "INTERNAL" ? "Internal note recorded." : parsed.bodyText || attachments.length ? "Public reply recorded and accepted for delivery." : "No new public message was requested."}${parsed.close ? " Ticket closed." : ""} No confirmation is required. Reference: ${action.id}`, `completed:${action.id}`);
      } catch { this.logger.warn("Ticket email action completed; its informational receipt needs review."); }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && !operationId) return true;
      const detail = error instanceof BadRequestException ? error.message : "Check your assignment, reply/close permissions and the first-line command. No action was executed.";
      if (operationId) await this.prisma.ticketEmailAction.update({ where: { id: operationId }, data: { status: executionStarted ? "REVIEW_REQUIRED" : "REJECTED", error: executionStarted ? "Action interrupted. Inspect the ticket and sent mail before retrying; part of the action may have completed." : detail } });
      await this.notice(context, executionStarted ? "Ticket email action needs review" : "Ticket email reply was not accepted", executionStarted ? "The operation did not finish normally. Review the ticket and sent mail before submitting it again; part of the action may have completed." : detail, invalidKey);
    }
    return true;
  }
  private async assertAction(user: AuthenticatedUser, ticketId: string, mode: string, close: boolean, policy: TicketEmailPolicy) {
    if (!policy.enabled || !policy.repliesEnabled) throw new BadRequestException("Email replies are disabled in the organization settings.");
    if (user.forcePasswordChange) throw new BadRequestException("Change your Avidity One password in Profile > Password, then send a new reply. No action was executed.");
    if (!await this.eligible(ticketId, user, policy) || !user.permissions.includes("tickets.reply") || !user.permissions.includes(mode === "INTERNAL" ? "ticket_messages.create_internal" : "ticket_messages.create_public")) throw new BadRequestException("Current ticket assignment and reply permissions are required.");
    if (mode === "INTERNAL" && !policy.includeInternal) throw new Error("Internal email is disabled.");
    if (close && (!policy.closeEnabled || !user.permissions.includes("tickets.close"))) throw new BadRequestException("Email closure is disabled or your account lacks ticket close permission.");
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.status === "MERGED") throw new Error("Use the primary ticket in the platform.");
  }
  private async handleUnlinkedStaffReply(mailbox: { id: string; organizationId: string }, message: InboundMailMessage) {
    const policy = await this.policy(mailbox.organizationId);
    if (!policy.enabled || isAutomaticEmail(message.internetMessageHeaders)) return false;
    const account = await this.prisma.user.findFirst({ where: { organizationId: mailbox.organizationId, email: { equals: message.from.email, mode: "insensitive" }, isActive: true, deletedAt: null } });
    if (!account) return false;
    const number = message.subject.match(/\b[A-Z]{2,10}-\d{3,}\b/i)?.[0]?.toUpperCase();
    const refs = [message.inReplyTo, ...(message.references?.match(/<[^>]+>/g) ?? [])].filter((s): s is string => Boolean(s));
    const matchers: Prisma.TicketWhereInput[] = [];
    if (number) matchers.push({ ticketNumber: number });
    if (message.conversationId) matchers.push({ messages: { some: { emailConversationId: message.conversationId } } });
    if (refs.length) matchers.push({ messages: { some: { emailInternetMessageId: { in: refs } } } });
    if (!matchers.length) return false;
    const ticket = await this.prisma.ticket.findFirst({ where: { organizationId: mailbox.organizationId, deletedAt: null, OR: matchers } });
    const user = await this.actor(account.id, mailbox.organizationId);
    if (!ticket || !user || !await this.eligible(ticket.id, user, policy)) return false;
    await this.notice({ organizationId: mailbox.organizationId, ticketId: ticket.id, userId: user.id }, "Reply using your operational ticket email", "This message was not posted as a customer reply. Reply to your own full ticket notification (keep its subject), or use the platform. Authorized replies are processed directly without a separate confirmation.", `unlinked:${this.hash(`${mailbox.organizationId}:${message.internetMessageId ?? message.providerMessageId}`)}`);
    return true;
  }

  private async publicRecipients(ticketId: string, organizationId: string) {
    const ticket = await this.prisma.ticket.findFirstOrThrow({ where: { id: ticketId, organizationId, deletedAt: null }, include: { contact: true, conversationParticipants: { where: { isActive: true } } } });
    const latest = await this.prisma.ticketMessage.findFirst({ where: { ticketId, direction: "INBOUND", visibility: "PUBLIC", senderEmail: { not: null } }, orderBy: { createdAt: "desc" } });
    return [...new Set([latest?.senderEmail || ticket.senderEmail || ticket.contact?.email, ticket.senderEmail, ...ticket.conversationParticipants.map((p) => p.email)].filter((email): email is string => Boolean(email)).map((email) => email.trim().toLowerCase()))].sort();
  }
    private hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
}
