import { ticketMailSubject, replyReferences } from "../mailboxes/providers/mail-threading";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AutoReplyScope, AutoReplyTemplateType, AutoReplyTrigger, MessageDirection, MessageVisibility } from "@prisma/client";
import { HtmlSanitizerService } from "../../common/html/html-sanitizer.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { MailDeliveryService } from "../mailboxes/mail-delivery.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateAutoReplyTemplateDto } from "./dto/create-auto-reply-template.dto";
import { UpdateAutoReplyTemplateDto } from "./dto/update-auto-reply-template.dto";

const AUTO_GENERATED_HEADERS = new Set(["auto-replied", "auto-generated", "bulk", "junk"]);
const NO_REPLY_PREFIXES = ["no-reply@", "noreply@", "do-not-reply@", "donotreply@"];

@Injectable()
export class AutoRepliesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailDelivery: MailDeliveryService,
    private readonly htmlSanitizer: HtmlSanitizerService
  ) {}

  list(user: AuthenticatedUser) {
    return this.prisma.autoReplyTemplate.findMany({
      where: { organizationId: user.organizationId },
      include: {
        client: { select: { id: true, name: true } },
        mailbox: { select: { id: true, name: true, emailAddress: true } }
      },
      orderBy: [{ scope: "asc" }, { name: "asc" }]
    });
  }

  async create(user: AuthenticatedUser, input: CreateAutoReplyTemplateDto) {
    await this.validateTemplateScope(user.organizationId, input.scope, input.clientId ?? null, input.mailboxId ?? null);

    return this.prisma.autoReplyTemplate.create({
      data: {
        organizationId: user.organizationId,
        name: input.name.trim(),
        scope: input.scope,
        templateType: input.templateType ?? AutoReplyTemplateType.TICKET,
        trigger: input.trigger ?? AutoReplyTrigger.TICKET_CREATED,
        clientId: input.scope === AutoReplyScope.CLIENT ? input.clientId ?? null : null,
        mailboxId: input.mailboxId ?? null,
        subject: input.subject.trim(),
        bodyText: input.bodyText.trim(),
        bodyHtml: this.htmlSanitizer.sanitize(input.bodyHtml),
        isActive: input.isActive ?? true
      }
    });
  }

  async update(templateId: string, user: AuthenticatedUser, input: UpdateAutoReplyTemplateDto) {
    const existing = await this.prisma.autoReplyTemplate.findFirst({
      where: { id: templateId, organizationId: user.organizationId }
    });

    if (!existing) {
      throw new NotFoundException("Auto-reply template was not found.");
    }

    const nextScope = input.scope ?? existing.scope;
    const nextClientId = input.clientId !== undefined ? input.clientId : existing.clientId;
    const nextMailboxId = input.mailboxId !== undefined ? input.mailboxId : existing.mailboxId;
    await this.validateTemplateScope(user.organizationId, nextScope, nextClientId, nextMailboxId);

    return this.prisma.autoReplyTemplate.update({
      where: { id: templateId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.scope !== undefined ? { scope: input.scope } : {}),
        ...(input.templateType !== undefined ? { templateType: input.templateType } : {}),
        ...(input.trigger !== undefined ? { trigger: input.trigger } : {}),
        ...(input.clientId !== undefined || input.scope !== undefined ? { clientId: nextScope === AutoReplyScope.CLIENT ? nextClientId : null } : {}),
        ...(input.mailboxId !== undefined ? { mailboxId: nextMailboxId } : {}),
        ...(input.subject !== undefined ? { subject: input.subject.trim() } : {}),
        ...(input.bodyText !== undefined ? { bodyText: input.bodyText.trim() } : {}),
        ...(input.bodyHtml !== undefined ? { bodyHtml: this.htmlSanitizer.sanitize(input.bodyHtml) } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
      }
    });
  }

  async remove(templateId: string, user: AuthenticatedUser) {
    const existing = await this.prisma.autoReplyTemplate.findFirst({
      where: { id: templateId, organizationId: user.organizationId },
      select: { id: true }
    });

    if (!existing) {
      throw new NotFoundException("Auto-reply template was not found.");
    }

    await this.prisma.autoReplyTemplate.update({
      where: { id: templateId },
      data: { isActive: false }
    });
    return { deactivated: true };
  }

  async sendForNewInboundTicket(input: {
    organizationId: string;
    ticketId: string;
    messageId: string;
    senderEmail: string;
    mailboxId?: string | null;
    autoSubmittedHeader?: string | null;
    threadKey?: string | null;
    inReplyTo?: string | null;
    references?: string | null;
    replyToProviderMessageId?: string | null;
  }) {
    try {
      const threadKey = input.threadKey ?? input.ticketId;
      if (this.shouldSuppressAutoReply({ senderEmail: input.senderEmail, autoSubmittedHeader: input.autoSubmittedHeader, threadKey })) {
        return { sent: false, reason: "suppressed" };
      }

      if (await this.hasRecentAutoReply(input.senderEmail, threadKey)) {
        return { sent: false, reason: "recent_auto_reply_exists" };
      }

      const ticket = await this.prisma.ticket.findFirst({
        where: { id: input.ticketId, organizationId: input.organizationId },
        include: {
          client: true,
          contact: true,
          mailbox: true
        }
      });

      if (!ticket) {
        return { sent: false, reason: "ticket_not_found" };
      }

      const template = await this.findTemplateForTicket(input.organizationId, ticket.clientId, input.mailboxId ?? ticket.mailboxId ?? null);
      if (!template) {
        return { sent: false, reason: "no_template" };
      }

      const settings = await this.prisma.systemSetting.findUnique({
        where: { organizationId: input.organizationId }
      });
      const variables = {
        "ticket.number": ticket.ticketNumber,
        "ticket.subject": ticket.subject,
        "client.name": ticket.client?.name ?? "your organization",
        "contact.firstName": ticket.contact?.firstName ?? "",
        "contact.lastName": ticket.contact?.lastName ?? "",
        "company.name": settings?.companyName ?? "Support",
        "support.email": settings?.supportEmail ?? ticket.mailbox?.publicEmailAddress ?? ticket.mailbox?.emailAddress ?? "support"
      };
      const bodyHtml = this.htmlSanitizer.sanitize(this.renderTemplate(template.bodyHtml, variables));
      const bodyText = this.renderTemplate(template.bodyText, variables);
      const subject = ticketMailSubject(this.renderTemplate(template.subject, variables), ticket.ticketNumber);
      const sendResult = await this.mailDelivery.sendTicketReply({
        organizationId: input.organizationId,
        mailboxId: input.mailboxId ?? ticket.mailboxId,
        to: [input.senderEmail],
        subject,
        bodyHtml: this.htmlSanitizer.sanitize(`${bodyHtml}<p>Ticket: ${ticket.ticketNumber}</p>`),
        bodyText: `${bodyText}\n\nTicket: ${ticket.ticketNumber}`,
        inReplyTo: input.inReplyTo,
        references: replyReferences(input.references, input.inReplyTo).join(" ") || null,
        replyToProviderMessageId: input.replyToProviderMessageId
      });

      if (!sendResult) {
        return { sent: false, reason: "outbound_disabled" };
      }

      const message = await this.prisma.ticketMessage.create({
        data: {
          ticketId: ticket.id,
          direction: MessageDirection.OUTBOUND,
          visibility: MessageVisibility.PUBLIC,
          bodyText,
          bodyHtml,
          sanitizedBodyHtml: bodyHtml,
          emailMessageId: sendResult.providerMessageId,
          emailInternetMessageId: sendResult.internetMessageId ?? null,
          emailConversationId: sendResult.conversationId ?? null,
          inReplyTo: input.inReplyTo ?? null,
          emailReferences: input.references ?? null,
          hasAttachments: false
        }
      });

      await this.prisma.autoReplyHistory.create({
        data: {
          templateId: template.id,
          ticketId: ticket.id,
          recipientEmail: input.senderEmail.toLowerCase(),
          threadKey,
          metadata: {
            ticketNumber: ticket.ticketNumber,
            ticketMessageId: message.id,
            providerMessageId: sendResult.providerMessageId
          }
        }
      });

      return { sent: true, templateId: template.id, messageId: message.id };
    } catch (error) {
      return { sent: false, reason: error instanceof Error ? error.message : "auto_reply_failed" };
    }
  }

  async sendForNewEventRequest(input: {
    organizationId: string;
    requestId: string;
  }) {
    try {
      const request = await this.prisma.eventServiceRequest.findFirst({
        where: { id: input.requestId, organizationId: input.organizationId },
        include: {
          client: true,
          services: { include: { service: true }, orderBy: { service: { name: "asc" } } }
        }
      });

      if (!request) {
        return { sent: false, reason: "event_request_not_found" };
      }

      const threadKey = request.trackingNumber;
      if (this.shouldSuppressAutoReply({ senderEmail: request.requesterEmail, threadKey })) {
        return { sent: false, reason: "suppressed" };
      }

      if (await this.hasRecentAutoReply(request.requesterEmail, threadKey)) {
        return { sent: false, reason: "recent_auto_reply_exists" };
      }

      const template = await this.findTemplateForEvent(input.organizationId, request.clientId, AutoReplyTrigger.EVENT_REQUEST_CREATED);
      if (!template) {
        return { sent: false, reason: "no_template" };
      }

      const settings = await this.prisma.systemSetting.findUnique({ where: { organizationId: input.organizationId } });
      const eventUrl = `${process.env.APP_URL ?? "https://helpdesk.aviditytechnologies.com"}/event-services/${encodeURIComponent(request.trackingNumber)}`;
      const services = request.services.map((item) => item.service.name).join(", ");
      const variables = {
        "event.trackingNumber": request.trackingNumber,
        "event.name": request.eventName,
        "event.date": request.eventDate ? request.eventDate.toLocaleDateString("en-US", { timeZone: settings?.defaultTimezone ?? "America/Chicago" }) : "",
        "event.time": `${request.startTime ?? ""}${request.endTime ? ` - ${request.endTime}` : ""}`.trim(),
        "event.venue": request.venue ?? "",
        "event.services": services,
        "event.url": eventUrl,
        "requester.firstName": request.requesterFirstName,
        "requester.lastName": request.requesterLastName,
        "client.name": request.client?.name ?? "your organization",
        "company.name": settings?.companyName ?? "Support",
        "support.email": settings?.supportEmail ?? "support"
      };
      const bodyHtml = this.htmlSanitizer.sanitize(this.renderTemplate(template.bodyHtml, variables));
      const bodyText = this.renderTemplate(template.bodyText, variables);
      const subject = this.renderTemplate(template.subject, variables);

      const sendResult = await this.mailDelivery.sendTicketReply({
        organizationId: input.organizationId,
        to: [request.requesterEmail],
        subject,
        bodyHtml,
        bodyText
      });

      if (!sendResult) {
        return { sent: false, reason: "outbound_disabled" };
      }

      const message = await this.prisma.eventServiceMessage.create({
        data: {
          requestId: request.id,
          direction: MessageDirection.OUTBOUND,
          visibility: MessageVisibility.PUBLIC,
          bodyText,
          bodyHtml,
          sanitizedBodyHtml: bodyHtml,
          emailMessageId: sendResult.providerMessageId,
          emailInternetMessageId: sendResult.internetMessageId ?? null,
          emailConversationId: sendResult.conversationId ?? null
        }
      });

      await this.prisma.autoReplyHistory.create({
        data: {
          templateId: template.id,
          eventServiceRequestId: request.id,
          recipientEmail: request.requesterEmail.toLowerCase(),
          threadKey,
          metadata: {
            trackingNumber: request.trackingNumber,
            eventServiceMessageId: message.id,
            providerMessageId: sendResult.providerMessageId
          }
        }
      });

      return { sent: true, templateId: template.id, messageId: message.id };
    } catch (error) {
      return { sent: false, reason: error instanceof Error ? error.message : "event_auto_reply_failed" };
    }
  }

  async sendForEventStatusChange(input: {
    organizationId: string;
    requestId: string;
    status: string;
  }) {
    try {
      const request = await this.prisma.eventServiceRequest.findFirst({
        where: { id: input.requestId, organizationId: input.organizationId },
        include: {
          client: true,
          services: { include: { service: true }, orderBy: { service: { name: "asc" } } }
        }
      });
      if (!request) {
        return { sent: false, reason: "event_request_not_found" };
      }

      const template = await this.findTemplateForEvent(input.organizationId, request.clientId, AutoReplyTrigger.EVENT_STATUS_CHANGED);
      if (!template) {
        return { sent: false, reason: "no_template" };
      }

      const settings = await this.prisma.systemSetting.findUnique({ where: { organizationId: input.organizationId } });
      const appUrl = (process.env.APP_URL ?? "https://helpdesk.aviditytechnologies.com").replace(/\/+$/, "");
      const variables = {
        "event.trackingNumber": request.trackingNumber,
        "event.name": request.eventName,
        "event.status": input.status.toLowerCase().replace(/_/g, " "),
        "event.date": request.eventDate ? request.eventDate.toLocaleDateString("en-US", { timeZone: settings?.defaultTimezone ?? "America/Chicago" }) : "",
        "event.time": `${request.startTime ?? ""}${request.endTime ? ` - ${request.endTime}` : ""}`.trim(),
        "event.venue": request.venue ?? "",
        "event.services": request.services.map((item) => item.service.name).join(", "),
        "event.url": `${appUrl}/event-services/${encodeURIComponent(request.trackingNumber)}`,
        "requester.firstName": request.requesterFirstName,
        "requester.lastName": request.requesterLastName,
        "client.name": request.client?.name ?? "your organization",
        "company.name": settings?.companyName ?? "Support",
        "support.email": settings?.supportEmail ?? "support"
      };
      const bodyHtml = this.htmlSanitizer.sanitize(this.renderTemplate(template.bodyHtml, variables));
      const bodyText = this.renderTemplate(template.bodyText, variables);
      const subject = this.renderTemplate(template.subject, variables);
      const sendResult = await this.mailDelivery.sendTicketReply({
        organizationId: input.organizationId,
        to: [request.requesterEmail],
        subject,
        bodyHtml,
        bodyText
      });
      if (!sendResult) {
        return { sent: false, reason: "outbound_disabled" };
      }
      const message = await this.prisma.eventServiceMessage.create({
        data: {
          requestId: request.id,
          direction: MessageDirection.OUTBOUND,
          visibility: MessageVisibility.PUBLIC,
          bodyText,
          bodyHtml,
          sanitizedBodyHtml: bodyHtml,
          emailMessageId: sendResult.providerMessageId,
          emailInternetMessageId: sendResult.internetMessageId ?? null,
          emailConversationId: sendResult.conversationId ?? null
        }
      });
      await this.prisma.autoReplyHistory.create({
        data: {
          templateId: template.id,
          eventServiceRequestId: request.id,
          recipientEmail: request.requesterEmail.toLowerCase(),
          threadKey: `${request.trackingNumber}:status:${input.status}`,
          metadata: { trackingNumber: request.trackingNumber, status: input.status, eventServiceMessageId: message.id }
        }
      });
      return { sent: true, templateId: template.id, messageId: message.id };
    } catch (error) {
      return { sent: false, reason: error instanceof Error ? error.message : "event_status_auto_reply_failed" };
    }
  }

  shouldSuppressAutoReply(input: { senderEmail: string; autoSubmittedHeader?: string | null; threadKey?: string | null }) {
    const sender = input.senderEmail.trim().toLowerCase();
    const header = input.autoSubmittedHeader?.trim().toLowerCase();

    if (NO_REPLY_PREFIXES.some((prefix) => sender.startsWith(prefix))) {
      return true;
    }

    if (header && AUTO_GENERATED_HEADERS.has(header)) {
      return true;
    }

    return false;
  }

  async hasRecentAutoReply(recipientEmail: string, threadKey: string | null) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const count = await this.prisma.autoReplyHistory.count({
      where: {
        recipientEmail: recipientEmail.toLowerCase(),
        threadKey,
        sentAt: { gte: since }
      }
    });

    return count > 0;
  }

  private async findTemplateForTicket(organizationId: string, clientId: string | null, mailboxId: string | null) {
    const templates = await this.prisma.autoReplyTemplate.findMany({
      where: {
        organizationId,
        isActive: true,
        templateType: AutoReplyTemplateType.TICKET,
        trigger: AutoReplyTrigger.TICKET_CREATED,
        OR: [
          ...(clientId ? [{ scope: AutoReplyScope.CLIENT, clientId }] : []),
          { scope: AutoReplyScope.GLOBAL, clientId: null }
        ]
      },
      orderBy: [{ scope: "desc" }, { updatedAt: "desc" }]
    });

    return (
      templates.find((template) => template.scope === AutoReplyScope.CLIENT && template.mailboxId === mailboxId) ??
      templates.find((template) => template.scope === AutoReplyScope.CLIENT && !template.mailboxId) ??
      templates.find((template) => template.scope === AutoReplyScope.GLOBAL && template.mailboxId === mailboxId) ??
      templates.find((template) => template.scope === AutoReplyScope.GLOBAL && !template.mailboxId) ??
      null
    );
  }

  private async findTemplateForEvent(organizationId: string, clientId: string | null, trigger: AutoReplyTrigger) {
    const templates = await this.prisma.autoReplyTemplate.findMany({
      where: {
        organizationId,
        isActive: true,
        templateType: AutoReplyTemplateType.EVENT_SERVICE,
        trigger,
        OR: [
          ...(clientId ? [{ scope: AutoReplyScope.CLIENT, clientId }] : []),
          { scope: AutoReplyScope.GLOBAL, clientId: null }
        ]
      },
      orderBy: [{ scope: "desc" }, { updatedAt: "desc" }]
    });

    return templates.find((template) => template.scope === AutoReplyScope.CLIENT) ?? templates.find((template) => template.scope === AutoReplyScope.GLOBAL) ?? null;
  }

  private renderTemplate(template: string, variables: Record<string, string>) {
    return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, key: string) => variables[key] ?? "");
  }

  private async validateTemplateScope(organizationId: string, scope: AutoReplyScope, clientId?: string | null, mailboxId?: string | null) {
    if (scope !== AutoReplyScope.GLOBAL && scope !== AutoReplyScope.CLIENT) {
      throw new BadRequestException("Only global and client auto-replies are configurable in this milestone.");
    }

    if (scope === AutoReplyScope.CLIENT && !clientId) {
      throw new BadRequestException("Client auto-replies require a client.");
    }

    if (clientId) {
      const client = await this.prisma.client.findFirst({
        where: { id: clientId, organizationId, deletedAt: null },
        select: { id: true }
      });
      if (!client) {
        throw new BadRequestException("Selected client was not found.");
      }
    }

    if (mailboxId) {
      const mailbox = await this.prisma.mailbox.findFirst({
        where: { id: mailboxId, organizationId },
        select: { id: true }
      });
      if (!mailbox) {
        throw new BadRequestException("Selected mailbox was not found.");
      }
    }
  }
}
