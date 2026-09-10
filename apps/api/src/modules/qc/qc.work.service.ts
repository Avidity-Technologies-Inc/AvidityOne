import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import * as D from "./dto/qc.dto";
import { QcService, qcJson, qcUserSelect } from "./qc.service";
import { requireValue } from "./qc.rules";

@Injectable()
export class QcWorkService {
  constructor(private readonly qc: QcService) {}
  async searchTickets(query: D.QcQueryDto, user: AuthenticatedUser) {
    requireValue(query.ticketId?.trim(), "Enter a ticket reference or subject.");
    return this.qc.prisma.ticket.findMany({ where: { organizationId: user.organizationId, deletedAt: null, ...(!user.permissions.includes("qc.view_all") ? { assignedUserId: user.id } : {}), OR: [{ ticketNumber: { contains: query.ticketId, mode: "insensitive" } }, { subject: { contains: query.ticketId, mode: "insensitive" } }] }, select: { id: true, ticketNumber: true, subject: true }, take: 25, orderBy: { updatedAt: "desc" } });
  }
  async ticket(id: string, user: AuthenticatedUser) {
    const ticket = await this.qc.prisma.ticket.findFirst({ where: { id, organizationId: user.organizationId, deletedAt: null, ...(!user.permissions.includes("qc.view_all") ? { assignedUserId: user.id } : {}) }, include: { qcProfile: { include: { category: true } }, qcTimeEntries: { where: { correction: null }, include: { technician: { select: qcUserSelect } }, orderBy: { startedAt: "desc" } } } });
    if (!ticket) throw new NotFoundException("Ticket is unavailable in your QC scope.");
    return { id: ticket.id, ticketNumber: ticket.ticketNumber, subject: ticket.subject, profile: ticket.qcProfile, timeEntries: ticket.qcTimeEntries };
  }
  async profile(id: string, input: D.QcProfileDto, user: AuthenticatedUser) {
    const ticket = await this.ticket(id, user);
    if (input.categoryId) requireValue(await this.qc.prisma.qcCategory.findFirst({ where: { id: input.categoryId, organizationId: user.organizationId, isActive: true } }), "Category is unavailable.");
    return this.qc.prisma.$transaction(async tx => {
      if (ticket.profile) {
        const result = await tx.qcTicketProfile.updateMany({ where: { ticketId: id, version: input.version }, data: { categoryId: input.categoryId, resolutionNote: input.resolutionNote?.trim(), version: { increment: 1 } } });
        if (result.count !== 1) throw new ConflictException("Ticket QC details changed. Reload before saving.");
      } else {
        requireValue(input.version === 0, "Reload ticket QC details.");
        await tx.qcTicketProfile.create({ data: { ticketId: id, organizationId: user.organizationId, categoryId: input.categoryId, resolutionNote: input.resolutionNote?.trim(), version: 1 } });
      }
      await this.qc.history(tx, user, "ticket_profile_updated", { ticketId: id });
      return { updated: true };
    });
  }
  async time(input: D.QcTimeDto, user: AuthenticatedUser) {
    requireValue(Boolean(input.ticketId) !== Boolean(input.deliverableId), "Select exactly one work source.");
    requireValue(input.description.trim(), "Describe the work performed.");
    const start = new Date(input.startedAt);
    requireValue(start.getTime() + input.minutes * 60000 <= Date.now(), "Time entries must describe completed work.");
    if (input.ticketId) await this.ticket(input.ticketId, user); else await this.deliverable(input.deliverableId!, user);
    return this.qc.prisma.$transaction(async tx => {
      if (input.correctionOfId) {
        const previous = await tx.qcTimeEntry.findFirst({ where: { id: input.correctionOfId, organizationId: user.organizationId, technicianId: user.id, ticketId: input.ticketId ?? null, deliverableId: input.deliverableId ?? null, correction: null } });
        requireValue(previous, "Only your current entry for this work can be corrected.");
      }
      const entry = await tx.qcTimeEntry.create({ data: { ...input, description: input.description.trim(), organizationId: user.organizationId, technicianId: user.id } });
      await this.qc.history(tx, user, "time_recorded", { id: entry.id, ticketId: entry.ticketId, correctionOfId: entry.correctionOfId }, undefined, entry.deliverableId ?? undefined);
      return entry;
    });
  }
  async deliverables(query: D.QcQueryDto, user: AuthenticatedUser) {
    const where: Prisma.QcDeliverableWhereInput = { organizationId: user.organizationId, ...(!user.permissions.includes("qc.view_all") ? { ownerId: user.id } : {}), ...(query.projectId ? { projectId: query.projectId } : {}), ...(query.clientId ? { project: { clientId: query.clientId } } : {}), ...(query.status ? { status: query.status } : {}) };
    const page = query.page ?? 1, pageSize = query.pageSize ?? 25;
    const [items, total] = await Promise.all([this.qc.prisma.qcDeliverable.findMany({ where, take: pageSize, skip: (page - 1) * pageSize, orderBy: { dueAt: "asc" }, include: { owner: { select: qcUserSelect }, project: { select: { id: true, name: true, client: { select: { id: true, name: true } } } } } }), this.qc.prisma.qcDeliverable.count({ where })]);
    return { items, total, page, pageSize };
  }
  async deliverable(id: string, user: AuthenticatedUser) {
    const item = await this.qc.prisma.qcDeliverable.findFirst({ where: { id, organizationId: user.organizationId, ...(!user.permissions.includes("qc.view_all") ? { ownerId: user.id } : {}) }, include: { attachments: { select: { id: true, createdAt: true, deliverableVersion: true, scanStatus: true, storedFile: { select: { originalFilename: true, fileSize: true, sha256Hash: true } } } }, owner: { select: qcUserSelect }, history: { orderBy: { createdAt: "asc" }, include: { actor: { select: qcUserSelect } } }, timeEntries: { where: { correction: null } }, project: { select: { id: true, name: true } } } });
    if (!item) throw new NotFoundException("Deliverable is unavailable in your QC scope.");
    return item;
  }
  async creativeOptions(projectId: string, user: AuthenticatedUser) {
    requireValue(await this.qc.prisma.project.count({ where: { id: projectId, organizationId: user.organizationId, deletedAt: null, ...(!user.permissions.includes("qc.view_all") ? { ownerId: user.id } : {}) } }), "Project is unavailable in your QC scope.");
    const links = await this.qc.prisma.projectWorkItem.findMany({ where: { projectId, eventServiceRequestId: { not: null } }, select: { eventServiceRequest: { select: { id: true, trackingNumber: true, eventName: true } } } });
    const articles = user.permissions.includes("knowledge_base.view") ? await this.qc.prisma.knowledgeArticle.findMany({ where: { organizationId: user.organizationId, deletedAt: null }, select: { id: true, title: true }, orderBy: { title: "asc" }, take: 500 }) : [];
    return { events: links.flatMap(item => item.eventServiceRequest ? [item.eventServiceRequest] : []), articles };
  }
  async createDeliverable(input: D.QcDeliverableDto, user: AuthenticatedUser) {
    const project = await this.qc.prisma.project.findFirst({ where: { id: input.projectId, organizationId: user.organizationId, deletedAt: null } });
    requireValue(project, "Project is unavailable.");
    requireValue(user.permissions.includes("qc.view_all") || (project.ownerId === user.id && input.ownerId === user.id), "You can only create deliverables for your own projects.");
    await this.qc.usersExist([input.ownerId], user.organizationId);
    requireValue(input.name.trim() && input.kind.trim(), "Name and deliverable type are required.");
    if (input.eventId) requireValue(await this.qc.prisma.projectWorkItem.findFirst({ where: { projectId: project.id, eventServiceRequestId: input.eventId } }), "The event must be linked to this project.");
    return this.qc.prisma.$transaction(async tx => {
      const item = await tx.qcDeliverable.create({ data: { ...input, organizationId: user.organizationId } });
      await this.qc.history(tx, user, "deliverable_created", { dueAt: input.dueAt }, undefined, item.id);
      return item;
    });
  }
  async updateDeliverable(id: string, input: D.QcDeliverableUpdateDto, user: AuthenticatedUser) {
    const item = await this.deliverable(id, user);
    const program = await this.qc.program(user);
    requireValue(item.version === input.version, "Deliverable changed. Reload before saving.");
    requireValue(input.note.trim(), "Record evidence for this change.");
    if (input.knowledgeArticleId) {
      this.qc.requirePermission(user, "knowledge_base.view");
      requireValue(await this.qc.prisma.knowledgeArticle.findFirst({ where: { id: input.knowledgeArticleId, organizationId: user.organizationId, deletedAt: null } }), "Evidence article is unavailable.");
    }
    const data: Prisma.QcDeliverableUpdateManyMutationInput = { version: { increment: 1 } };
    if (input.action === "RESCHEDULE") { requireValue(input.dueAt && item.status !== "DELIVERED", "Set a due date for an undelivered item."); data.dueAt = new Date(input.dueAt); }
    if (input.action === "PROOF_SENT") { requireValue(["DRAFT", "REVISION"].includes(item.status), "The deliverable is not ready for another proof."); data.status = "PROOF_SENT"; }
    if (input.action === "APPROVED") { requireValue(item.status === "PROOF_SENT", "A proof must be recorded before approval."); data.status = "APPROVED"; }
    if (input.action === "REVISION") { requireValue(["PROOF_SENT", "APPROVED"].includes(item.status), "Revision requires a proof or approval."); data.status = "REVISION"; }
    if (input.action === "DELIVER") { requireValue(item.status === "APPROVED", "Approve the proof before final delivery."); data.status = "DELIVERED"; data.deliveredAt = new Date(); }
    return this.qc.prisma.$transaction(async tx => {
      const changed = await tx.qcDeliverable.updateMany({ where: { id, organizationId: user.organizationId, version: input.version }, data });
      if (changed.count !== 1) throw new ConflictException("Deliverable changed. Reload before saving.");
      await this.qc.history(tx, user, `deliverable_${input.action.toLowerCase()}`, { note: input.note, knowledgeArticleId: input.knowledgeArticleId, previousDueAt: item.dueAt, dueAt: input.dueAt }, undefined, id);
      if (program.configuration.creativeCheckpoints.includes(input.action as "PROOF_SENT" | "DELIVER")) await tx.qcReview.create({ data: { organizationId: user.organizationId, deliverableId: id, ownerId: item.ownerId, rubricId: program.configuration.creativeRubricId, cycleKey: `${id}:${input.action}:${input.version + 1}`, selectionReasons: ["CREATIVE_CHECKPOINT"] } });
      return { updated: true };
    });
  }
}
