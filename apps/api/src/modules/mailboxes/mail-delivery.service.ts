import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AttachmentScanStatus, Mailbox } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { FileStorageService } from "../file-storage/file-storage.service";
import { MailProvider, OutboundMailAttachment, SendMessageResult } from "./providers/mail-provider.interface";
import { MicrosoftGraphMailProvider } from "./providers/microsoft-graph-mail.provider";
import { MockMailProvider } from "./providers/mock-mail.provider";

export interface SendTicketReplyInput {
  organizationId: string;
  ticketId?: string | null;
  mailboxId?: string | null;
  to: string[];
  cc?: string[];
  subject: string;
  bodyHtml: string;
  bodyText: string;
  inReplyTo?: string | null;
  references?: string | null;
  replyToProviderMessageId?: string | null;
  attachmentIds?: string[];
  trackDelivery?: boolean;
  rawAttachments?: OutboundMailAttachment[];
}

@Injectable()
export class MailDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileStorage: FileStorageService,
    private readonly config: ConfigService,
    private readonly mockMailProvider: MockMailProvider,
    private readonly microsoftGraphMailProvider: MicrosoftGraphMailProvider
  ) {}

  async sendTicketReply(input: SendTicketReplyInput): Promise<SendMessageResult | null> {
    const mailbox = await this.resolveMailbox(input.organizationId, input.mailboxId ?? null);
    const { provider } = this.resolveProvider(mailbox);

    if (mailbox.outboundMode === "NONE") {
      return null;
    }

    const attachmentIds = [...new Set(input.attachmentIds ?? [])];
    const ticketAttachments = attachmentIds.length
      ? await this.loadOutboundAttachments(attachmentIds, input.ticketId ?? null)
      : [];
    const attachments = [...ticketAttachments, ...(input.rawAttachments ?? [])];

    return provider.sendMessage({
      trackDelivery: input.trackDelivery,
      mailboxId: mailbox.id,
      mailboxEmailAddress: this.getMailboxReadAddress(mailbox),
      fromAddress: mailbox.outboundFromAddress || mailbox.publicEmailAddress || mailbox.emailAddress,
      replyToAddress: mailbox.outboundReplyToAddress || mailbox.publicEmailAddress || mailbox.emailAddress,
      outboundMode: mailbox.outboundMode,
      tenantId: mailbox.tenantId,
      microsoftClientId: mailbox.microsoftClientId,
      encryptedClientSecretReference: mailbox.encryptedClientSecretReference,
      to: input.to,
      cc: input.cc,
      subject: input.subject,
      bodyHtml: input.bodyHtml,
      bodyText: input.bodyText,
      inReplyTo: input.inReplyTo,
      references: input.references,
      replyToProviderMessageId: input.replyToProviderMessageId,
      attachmentIds: input.attachmentIds,
      attachments
    });
  }

  private async loadOutboundAttachments(attachmentIds: string[], ticketId: string | null) {
    const attachments = await this.prisma.ticketAttachment.findMany({
      where: {
        id: { in: attachmentIds },
        ...(ticketId ? { ticketId } : {}),
        ticketMessageId: null,
        deletedAt: null,
        scanStatus: { notIn: ["SUSPICIOUS", "BLOCKED"] }
      },
      orderBy: { createdAt: "asc" }
    });

    if (attachments.length !== attachmentIds.length) {
      await this.rejectUnavailableTicketAttachments(attachmentIds, ticketId);
    }

    return Promise.all(
      attachments.map(async (attachment) => ({
        originalFilename: attachment.originalFilename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.fileSize,
        contentBytes: await this.streamToBuffer(await this.fileStorage.getFileStream(attachment.storageKey)),
        isInline: attachment.isInline,
        contentId: attachment.contentId
      }))
    );
  }

  private async rejectUnavailableTicketAttachments(attachmentIds: string[], ticketId: string | null): Promise<never> {
    const requestedAttachments = await this.prisma.ticketAttachment.findMany({
      where: {
        id: { in: attachmentIds },
        ...(ticketId ? { ticketId } : {})
      },
      select: {
        id: true,
        scanStatus: true,
        deletedAt: true,
        ticketMessageId: true
      }
    });
    const foundIds = new Set(requestedAttachments.map((attachment) => attachment.id));
    const hasMissing = attachmentIds.some((attachmentId) => !foundIds.has(attachmentId));
    const hasBlocked = requestedAttachments.some((attachment) =>
      attachment.scanStatus === AttachmentScanStatus.SUSPICIOUS ||
      attachment.scanStatus === AttachmentScanStatus.BLOCKED
    );
    const hasUnavailable = requestedAttachments.some((attachment) => attachment.deletedAt || attachment.ticketMessageId);

    if (hasBlocked) {
      throw new BadRequestException("One or more attachments were blocked by antivirus scanning and cannot be sent.");
    }
    if (hasMissing || hasUnavailable) {
      throw new BadRequestException("One or more attachments are no longer available for outbound email.");
    }

    throw new BadRequestException("One or more attachments could not be prepared for outbound email.");
  }

  private async streamToBuffer(stream: NodeJS.ReadableStream) {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  private async resolveMailbox(organizationId: string, mailboxId: string | null) {
    const mailbox = await this.prisma.mailbox.findFirst({
      where: {
        organizationId,
        isActive: true,
        ...(mailboxId ? { id: mailboxId } : {})
      },
      orderBy: { createdAt: "asc" }
    });

    if (!mailbox) {
      throw new NotFoundException("No active mailbox is configured for outbound ticket replies.");
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

    return { providerName: "microsoft365", provider: this.microsoftGraphMailProvider };
  }

  private getMailboxReadAddress(mailbox: Mailbox) {
    if (mailbox.connectionMode === "GRAPH_FORWARDED_MAILBOX" && mailbox.ingestionEmailAddress) {
      return mailbox.ingestionEmailAddress;
    }

    return mailbox.emailAddress;
  }
}
