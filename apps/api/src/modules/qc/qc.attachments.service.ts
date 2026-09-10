import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { FileStorageService } from "../file-storage/file-storage.service";
import { FileScanService } from "../file-storage/file-scan.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { QcService } from "./qc.service";
import { QcWorkService } from "./qc.work.service";
export const qcAttachmentSelect = { id: true, createdAt: true, deliverableVersion: true, scanStatus: true, storedFile: { select: { originalFilename: true, fileSize: true, sha256Hash: true } } } as const;
@Injectable()
export class QcAttachmentsService {
  constructor(private readonly qc: QcService, private readonly work: QcWorkService, private readonly storage: FileStorageService, private readonly scan: FileScanService) {}
  async upload(deliverableId: string, user: AuthenticatedUser, file: { originalname: string; mimetype: string; buffer: Buffer }) {
    const deliverable = await this.work.deliverable(deliverableId, user);
    const stored = await this.storage.saveAttachmentFile({ originalFilename: file.originalname, mimeType: file.mimetype || "application/octet-stream", buffer: file.buffer, folder: "attachments" });
    try {
      const scanned = await this.scan.scanBuffer(file.buffer);
      return await this.qc.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM qc_deliverables WHERE id = ${deliverableId}::uuid FOR UPDATE`;
        const current = await tx.qcDeliverable.findUniqueOrThrow({ where: { id: deliverableId } });
        if (current.version !== deliverable.version) throw new ConflictException("The deliverable changed during upload. Reload its evidence and upload again.");
        const record = await tx.storedFile.create({ data: stored });
        const attachment = await tx.qcAttachment.create({ data: { organizationId: user.organizationId, deliverableId, uploadedById: user.id, deliverableVersion: deliverable.version, storedFileId: record.id, ...scanned }, select: qcAttachmentSelect });
        await this.qc.history(tx, user, "creative_evidence_uploaded", { attachmentId: attachment.id, originalFilename: stored.originalFilename, sha256Hash: stored.sha256Hash, deliverableVersion: deliverable.version }, undefined, deliverableId);
        return attachment;
      });
    } catch (error) { await this.storage.deleteFile(stored.storageKey); throw error; }
  }
  async download(deliverableId: string, attachmentId: string, user: AuthenticatedUser, reviewId?: string) {
    if (reviewId) { const review = await this.qc.review(reviewId, user); if (review.deliverableId !== deliverableId) throw new NotFoundException(); }
    else await this.work.deliverable(deliverableId, user);
    const attachment = await this.qc.prisma.qcAttachment.findFirst({ where: { id: attachmentId, deliverableId, organizationId: user.organizationId }, include: { storedFile: true } });
    if (!attachment) throw new NotFoundException("QC evidence was not found.");
    if (["BLOCKED", "SUSPICIOUS"].includes(attachment.scanStatus)) throw new ForbiddenException("This evidence is blocked by file scanning.");
    await this.qc.prisma.$transaction(tx => this.qc.history(tx, user, "creative_evidence_downloaded", { attachmentId }, reviewId, deliverableId));
    return { filename: attachment.storedFile.originalFilename, stream: await this.storage.getFileStream(attachment.storedFile.storageKey) };
  }
}
