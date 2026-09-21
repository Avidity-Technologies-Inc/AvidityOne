import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AttachmentScanStatus, AttachmentSource, Prisma } from "@prisma/client";
import { PassThrough } from "node:stream";
import { AuditLogsService } from "../audit-logs/audit-logs.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { FileStorageService } from "../file-storage/file-storage.service";
import { FileScanService } from "../file-storage/file-scan.service";
import { FileValidationService } from "../file-storage/file-validation.service";
import { PrismaService } from "../prisma/prisma.service";

const archiver = require("archiver") as (
  format: "zip",
  options?: { zlib?: { level?: number } }
) => {
  append: (source: NodeJS.ReadableStream | Buffer | string, data: { name: string }) => void;
  finalize: () => Promise<void>;
  on: (event: "error", listener: (error: Error) => void) => void;
  pipe: (destination: NodeJS.WritableStream) => void;
};

@Injectable()
export class TicketAttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileStorage: FileStorageService,
    private readonly fileScan: FileScanService,
    private readonly validation: FileValidationService,
    private readonly auditLogs: AuditLogsService
  ) {}

  async uploadForTicket(
    ticketId: string,
    user: AuthenticatedUser,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    inline?: { isInline: boolean; contentId?: string | null }
  ) {
    const ticket = await this.resolveTicket(ticketId, user);

    const attachment = await this.createAttachmentRecord({
      ticketId: ticket.id,
      ticketMessageId: null,
      uploadedByUserId: user.id,
      source: AttachmentSource.OUTBOUND_REPLY,
      originalFilename: file.originalname,
      mimeType: file.mimetype || "application/octet-stream",
      buffer: file.buffer,
      isInline: inline?.isInline ?? false,
      contentId: inline?.contentId ?? null,
      emailAttachmentId: null
    });

    await this.auditLogs.create({
      userId: user.id,
      entityType: "TicketAttachment",
      entityId: attachment.id,
      action: "attachment.uploaded",
      metadata: {
        ticketId,
        originalFilename: attachment.originalFilename,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize
      }
    });

    return attachment;
  }

  async createInboundEmailAttachment(input: {
    ticketId: string;
    ticketMessageId: string;
    originalFilename: string;
    mimeType: string;
    buffer: Buffer;
    isInline: boolean;
    contentId?: string | null;
    emailAttachmentId?: string | null;
  }) {
    if (input.emailAttachmentId) {
      const existing = await this.prisma.ticketAttachment.findFirst({
        where: {
          ticketMessageId: input.ticketMessageId,
          emailAttachmentId: input.emailAttachmentId,
          deletedAt: null
        }
      });

      if (existing) {
        return { attachment: existing, created: false };
      }
    }

    const attachment = await this.createAttachmentRecord({
      ticketId: input.ticketId,
      ticketMessageId: input.ticketMessageId,
      uploadedByUserId: null,
      source: AttachmentSource.INBOUND_EMAIL,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      buffer: input.buffer,
      isInline: input.isInline,
      contentId: input.contentId ?? null,
      emailAttachmentId: input.emailAttachmentId ?? null
    });

    return { attachment, created: true };
  }

  async getDownload(ticketId: string, attachmentId: string, user: AuthenticatedUser, preview: boolean) {
    const ticket = await this.resolveTicket(ticketId, user);
    const attachment = await this.prisma.ticketAttachment.findFirst({
      where: {
        id: attachmentId,
        ticketId: ticket.id,
        deletedAt: null
      },
      include: { storedFile: true }
    });

    if (!attachment) {
      throw new NotFoundException("Attachment was not found.");
    }

    if (
      attachment.scanStatus === AttachmentScanStatus.SUSPICIOUS ||
      attachment.scanStatus === AttachmentScanStatus.BLOCKED
    ) {
      throw new ForbiddenException("This attachment is blocked by scan status.");
    }

    if (preview && !this.validation.canPreview(attachment.mimeType)) {
      throw new ForbiddenException("Preview is not allowed for this attachment type.");
    }

    await this.auditLogs.create({
      userId: user.id,
      entityType: "TicketAttachment",
      entityId: attachment.id,
      action: preview ? "attachment.previewed" : "attachment.downloaded",
      metadata: {
        ticketId,
        originalFilename: attachment.originalFilename,
        mimeType: attachment.mimeType
      }
    });

    return {
      attachment,
      stream: await this.fileStorage.getFileStream(attachment.storageKey)
    };
  }

  async getBulkDownload(ticketId: string, user: AuthenticatedUser) {
    const ticket = await this.resolveTicket(ticketId, user);
    const attachments = await this.prisma.ticketAttachment.findMany({
      where: {
        ticketId: ticket.id,
        deletedAt: null,
        scanStatus: { notIn: [AttachmentScanStatus.SUSPICIOUS, AttachmentScanStatus.BLOCKED] }
      },
      orderBy: [{ isInline: "asc" }, { createdAt: "asc" }]
    });

    if (attachments.length === 0) {
      throw new NotFoundException("No downloadable attachments were found.");
    }

    const archive = archiver("zip", { zlib: { level: 9 } });
    const output = new PassThrough();
    archive.on("error", (error) => output.destroy(error));
    archive.pipe(output);

    const usedNames = new Map<string, number>();
    for (const attachment of attachments) {
      const entryName = this.uniqueZipEntryName(attachment.originalFilename, attachment.isInline ? "inline" : "files", usedNames);
      archive.append(await this.fileStorage.getFileStream(attachment.storageKey), { name: entryName });
    }

    void archive.finalize();

    await this.auditLogs.create({
      userId: user.id,
      entityType: "Ticket",
      entityId: ticket.id,
      action: "attachments.bulk_downloaded",
      metadata: {
        ticketId,
        attachmentCount: attachments.length
      }
    });

    return {
      filename: `${this.safeArchiveFilename(ticket.ticketNumber)}-attachments.zip`,
      stream: output
    };
  }

  async softDelete(ticketId: string, attachmentId: string, user: AuthenticatedUser) {
    const ticket = await this.resolveTicket(ticketId, user);
    const attachment = await this.prisma.ticketAttachment.findFirst({
      where: {
        id: attachmentId,
        ticketId: ticket.id,
        deletedAt: null
      }
    });

    if (!attachment) {
      throw new NotFoundException("Attachment was not found.");
    }

    const deleted = await this.prisma.ticketAttachment.update({
      where: { id: attachmentId },
      data: { deletedAt: new Date() }
    });

    await this.auditLogs.create({
      userId: user.id,
      entityType: "TicketAttachment",
      entityId: attachment.id,
      action: "attachment.deleted",
      metadata: { ticketId }
    });

    return deleted;
  }

  private async createAttachmentRecord(input: {
    ticketId: string;
    ticketMessageId: string | null;
    uploadedByUserId: string | null;
    source: AttachmentSource;
    originalFilename: string;
    mimeType: string;
    buffer: Buffer;
    isInline: boolean;
    contentId: string | null;
    emailAttachmentId: string | null;
  }) {
    const stored = await this.fileStorage.saveAttachmentFile({
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      buffer: input.buffer,
      folder: "attachments"
    });
    const scan = await this.fileScan.scanBuffer(input.buffer);

    return this.prisma.$transaction(async (tx) => {
      const storedFile = await tx.storedFile.create({
        data: {
          storageProvider: stored.storageProvider,
          storageKey: stored.storageKey,
          originalFilename: stored.originalFilename,
          storedFilename: stored.storedFilename,
          mimeType: stored.mimeType,
          fileExtension: stored.fileExtension,
          fileSize: stored.fileSize,
          sha256Hash: stored.sha256Hash
        }
      });

      return tx.ticketAttachment.create({
        data: {
          ticketId: input.ticketId,
          ticketMessageId: input.ticketMessageId,
          uploadedByUserId: input.uploadedByUserId,
          storedFileId: storedFile.id,
          source: input.source,
          originalFilename: stored.originalFilename,
          storedFilename: stored.storedFilename,
          storageProvider: stored.storageProvider,
          storageKey: stored.storageKey,
          mimeType: stored.mimeType,
          fileExtension: stored.fileExtension,
          fileSize: stored.fileSize,
          sha256Hash: stored.sha256Hash,
          isInline: input.isInline,
          contentId: input.contentId,
          emailAttachmentId: input.emailAttachmentId,
          scanStatus: scan.scanStatus,
          scanResult: scan.scanResult
        }
      });
    });
  }

  private async resolveTicket(ticketRef: string, user: AuthenticatedUser) {
    const ticket = await this.prisma.ticket.findFirst({
      where: this.ticketReferenceWhere(ticketRef, user.organizationId),
      select: { id: true, ticketNumber: true }
    });

    if (!ticket) {
      throw new NotFoundException("Ticket was not found.");
    }

    return ticket;
  }

  private uniqueZipEntryName(filename: string, folder: "files" | "inline", usedNames: Map<string, number>) {
    const safeName = this.safeArchiveFilename(filename) || "attachment";
    const slashIndex = safeName.lastIndexOf(".");
    const baseName = slashIndex > 0 ? safeName.slice(0, slashIndex) : safeName;
    const extension = slashIndex > 0 ? safeName.slice(slashIndex) : "";
    let candidate = safeName;
    let suffix = 2;

    while (usedNames.has(`${folder}/${candidate}`.toLowerCase())) {
      candidate = `${baseName}-${suffix}${extension}`;
      suffix += 1;
    }

    usedNames.set(`${folder}/${candidate}`.toLowerCase(), 1);
    return `${folder}/${candidate}`;
  }

  private safeArchiveFilename(value: string) {
    return value
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .replace(/^\.+|\.+$/g, "")
      .slice(0, 160);
  }

  private ticketReferenceWhere(ticketRef: string, organizationId: string): Prisma.TicketWhereInput {
    const normalized = ticketRef.trim();
    const matchers: Prisma.TicketWhereInput[] = [{ ticketNumber: normalized.toUpperCase() }];
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
      matchers.push({ id: normalized });
    }

    return {
      organizationId,
      deletedAt: null,
      OR: matchers
    };
  }
}
