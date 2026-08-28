import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { BlockedInboundEmailStatus, Prisma, SpamBlockType, SpamReleaseAction, SpamRuleAction, SpamRuleScope } from "@prisma/client";
import { AuditLogsService } from "../audit-logs/audit-logs.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { CreateSpamBlockEntryDto } from "./dto/create-spam-block-entry.dto";
import { UpdateSpamBlockEntryDto } from "./dto/update-spam-block-entry.dto";

@Injectable()
export class SpamManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService
  ) {}

  async list(user: AuthenticatedUser, query: { search?: string; type?: SpamBlockType; active?: string }) {
    const filters: Prisma.SpamBlockEntryWhereInput[] = [{ organizationId: user.organizationId, archivedAt: null }];
    const search = query.search?.trim();

    if (query.type) {
      filters.push({ type: query.type });
    }

    if (query.active === "true") {
      filters.push({ isActive: true });
    } else if (query.active === "false") {
      filters.push({ isActive: false });
    }

    if (search) {
      filters.push({
        OR: [
          { value: { contains: search, mode: "insensitive" } },
          { normalizedValue: { contains: search.toLowerCase(), mode: "insensitive" } },
          { notes: { contains: search, mode: "insensitive" } }
        ]
      });
    }

    return this.prisma.spamBlockEntry.findMany({
      where: { AND: filters },
      include: { createdBy: { select: { id: true, firstName: true, lastName: true, email: true } } },
      orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }]
    });
  }

  async create(input: CreateSpamBlockEntryDto, user: AuthenticatedUser) {
    const normalizedValue = this.normalizeValue(input.type, input.value);
    const existing = await this.prisma.spamBlockEntry.findUnique({
      where: { organizationId_type_normalizedValue: { organizationId: user.organizationId, type: input.type, normalizedValue } }
    });
    if (existing?.archivedAt) {
      const restored = await this.prisma.spamBlockEntry.update({
        where: { id: existing.id },
        data: {
          value: input.value.trim(),
          action: input.action ?? SpamRuleAction.BLOCK,
          scope: input.action === SpamRuleAction.ALLOW ? SpamRuleScope.ALL_INBOUND : input.scope ?? SpamRuleScope.ALL_INBOUND,
          notes: input.notes?.trim() || null,
          isActive: true,
          archivedAt: null,
          createdByUserId: user.id
        },
        include: { createdBy: { select: { id: true, firstName: true, lastName: true, email: true } } }
      });
      await this.auditLogs.create({ userId: user.id, entityType: "SpamBlockEntry", entityId: restored.id, action: "spam_block_entry.restored", metadata: { type: restored.type, value: restored.normalizedValue } });
      return restored;
    }
    if (existing) throw new ConflictException("This mail rule already exists. Edit the existing rule instead.");

    try {
      const entry = await this.prisma.spamBlockEntry.create({
        data: {
          organizationId: user.organizationId,
          type: input.type,
          value: input.value.trim(),
          normalizedValue,
          action: input.action ?? SpamRuleAction.BLOCK,
          scope: input.action === SpamRuleAction.ALLOW ? SpamRuleScope.ALL_INBOUND : input.scope ?? SpamRuleScope.ALL_INBOUND,
          notes: input.notes?.trim() || null,
          createdByUserId: user.id
        },
        include: { createdBy: { select: { id: true, firstName: true, lastName: true, email: true } } }
      });

      await this.auditLogs.create({
        userId: user.id,
        entityType: "SpamBlockEntry",
        entityId: entry.id,
        action: "spam_block_entry.created",
        metadata: { type: entry.type, value: entry.normalizedValue }
      });

      return entry;
    } catch (error) {
      if (this.isUniqueConstraint(error)) {
        throw new ConflictException("This spam block entry already exists.");
      }
      throw error;
    }
  }

  async update(entryId: string, input: UpdateSpamBlockEntryDto, user: AuthenticatedUser) {
    await this.ensureEntry(entryId, user.organizationId);
    const entry = await this.prisma.spamBlockEntry.update({
      where: { id: entryId },
      data: {
        action: input.action,
        scope: input.action === SpamRuleAction.ALLOW ? SpamRuleScope.ALL_INBOUND : input.scope,
        isActive: input.isActive,
        notes: input.notes === undefined ? undefined : input.notes.trim() || null
      },
      include: { createdBy: { select: { id: true, firstName: true, lastName: true, email: true } } }
    });

    await this.auditLogs.create({
      userId: user.id,
      entityType: "SpamBlockEntry",
      entityId: entry.id,
      action: "spam_block_entry.updated",
      metadata: { action: entry.action, scope: entry.scope, isActive: entry.isActive }
    });

    return entry;
  }

  async delete(entryId: string, user: AuthenticatedUser) {
    const entry = await this.ensureEntry(entryId, user.organizationId);
    await this.prisma.spamBlockEntry.update({ where: { id: entryId }, data: { isActive: false, archivedAt: new Date() } });
    await this.auditLogs.create({
      userId: user.id,
      entityType: "SpamBlockEntry",
      entityId: entry.id,
      action: "spam_block_entry.archived",
      metadata: { type: entry.type, value: entry.normalizedValue }
    });
    return { archived: true };
  }

  async findBlockForSender(
    organizationId: string,
    senderEmail: string,
    senderDomain?: string | null,
    options: { isExistingConversation?: boolean } = {}
  ) {
    const normalizedEmail = this.normalizeEmail(senderEmail);
    const normalizedDomain = senderDomain ? this.normalizeDomain(senderDomain) : this.domainFromEmail(normalizedEmail);

    const entries = await this.prisma.spamBlockEntry.findMany({
      where: {
        organizationId,
        isActive: true,
        archivedAt: null,
        OR: [
          { type: SpamBlockType.EMAIL, normalizedValue: normalizedEmail },
          ...(normalizedDomain ? [{ type: SpamBlockType.DOMAIN, normalizedValue: normalizedDomain }] : [])
        ]
      },
      orderBy: { updatedAt: "desc" }
    });
    const exactEmailRule = entries.find((entry) => entry.type === SpamBlockType.EMAIL && entry.normalizedValue === normalizedEmail);
    const domainRule = entries.find((entry) => entry.type === SpamBlockType.DOMAIN && entry.normalizedValue === normalizedDomain);
    const effectiveRule = exactEmailRule ?? domainRule;
    if (!effectiveRule || effectiveRule.action === SpamRuleAction.ALLOW) {
      return null;
    }
    if (effectiveRule.scope === SpamRuleScope.NEW_CONVERSATIONS_ONLY && options.isExistingConversation) {
      return null;
    }
    return effectiveRule;
  }

  async logBlockedInboundEmail(input: {
    organizationId: string;
    mailboxId?: string | null;
    spamBlockEntryId?: string | null;
    senderEmail: string;
    senderName?: string | null;
    senderDomain?: string | null;
    subject: string;
    bodyText?: string | null;
    bodyHtml?: string | null;
    emailMessageId?: string | null;
    emailInternetMessageId?: string | null;
    emailConversationId?: string | null;
    inReplyTo?: string | null;
    references?: string | null;
    hasAttachments?: boolean;
    internetMessageHeaders?: Record<string, string>;
    reason: string;
  }) {
    const normalizedSender = this.normalizeEmail(input.senderEmail);
    const existing = await this.prisma.blockedInboundEmail.findFirst({
      where: {
        organizationId: input.organizationId,
        OR: [
          ...(input.emailMessageId ? [{ emailMessageId: input.emailMessageId }] : []),
          ...(input.emailInternetMessageId ? [{ emailInternetMessageId: input.emailInternetMessageId }] : [])
        ]
      },
      orderBy: { createdAt: "desc" }
    });
    if (existing) {
      return existing;
    }
    return this.prisma.blockedInboundEmail.create({
      data: {
        organizationId: input.organizationId,
        mailboxId: input.mailboxId ?? null,
        spamBlockEntryId: input.spamBlockEntryId ?? null,
        senderEmail: normalizedSender,
        senderName: input.senderName?.trim() || null,
        senderDomain: input.senderDomain ? this.normalizeDomain(input.senderDomain) : this.domainFromEmail(input.senderEmail),
        subject: input.subject.slice(0, 500),
        bodyText: input.bodyText ?? null,
        bodyHtml: input.bodyHtml ?? null,
        emailMessageId: input.emailMessageId ?? null,
        emailInternetMessageId: input.emailInternetMessageId ?? null,
        emailConversationId: input.emailConversationId ?? null,
        inReplyTo: input.inReplyTo ?? null,
        emailReferences: input.references ?? null,
        hasAttachments: input.hasAttachments ?? false,
        internetMessageHeaders: input.internetMessageHeaders as Prisma.InputJsonValue | undefined,
        reason: input.reason
      }
    });
  }

  async listQuarantine(user: AuthenticatedUser, query: { search?: string; status?: BlockedInboundEmailStatus; page?: string; pageSize?: string }) {
    const page = this.positiveInt(query.page, 1);
    const pageSize = Math.min(this.positiveInt(query.pageSize, 20), 100);
    const search = query.search?.trim();
    const where: Prisma.BlockedInboundEmailWhereInput = {
      organizationId: user.organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(search ? { OR: [
        { senderEmail: { contains: search, mode: "insensitive" } },
        { senderDomain: { contains: search, mode: "insensitive" } },
        { subject: { contains: search, mode: "insensitive" } },
        { reason: { contains: search, mode: "insensitive" } }
      ] } : {})
    };
    const [items, total] = await Promise.all([
      this.prisma.blockedInboundEmail.findMany({
        where,
        select: {
          id: true,
          senderEmail: true,
          senderName: true,
          senderDomain: true,
          subject: true,
          bodyText: true,
          reason: true,
          status: true,
          resolutionAction: true,
          releasedTicketId: true,
          releaseFailureReason: true,
          createdAt: true,
          resolvedAt: true,
          mailbox: { select: { id: true, name: true, emailAddress: true } },
          spamBlockEntry: { select: { id: true, type: true, value: true, normalizedValue: true, action: true, scope: true, isActive: true } },
          resolvedBy: { select: { id: true, firstName: true, lastName: true, email: true } }
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      this.prisma.blockedInboundEmail.count({ where })
    ]);
    return { items, total, page, pageSize };
  }

  async getQuarantinedEmail(entryId: string, organizationId: string) {
    const entry = await this.prisma.blockedInboundEmail.findFirst({
      where: { id: entryId, organizationId },
      include: { mailbox: true, spamBlockEntry: true }
    });
    if (!entry) throw new NotFoundException("Quarantined message was not found.");
    return entry;
  }

  async dismissQuarantinedEmail(entryId: string, user: AuthenticatedUser) {
    const entry = await this.getQuarantinedEmail(entryId, user.organizationId);
    const resolvedAt = new Date();
    const dismissed = await this.prisma.blockedInboundEmail.updateMany({
      where: { id: entry.id, organizationId: user.organizationId, status: BlockedInboundEmailStatus.QUARANTINED },
      data: { status: BlockedInboundEmailStatus.DISMISSED, resolvedAt, resolvedByUserId: user.id }
    });
    if (dismissed.count !== 1) {
      throw new ConflictException("This quarantined message has already been resolved.");
    }
    await this.auditLogs.create({
      userId: user.id,
      entityType: "BlockedInboundEmail",
      entityId: entry.id,
      action: "spam_quarantine.dismissed",
      metadata: { senderEmail: entry.senderEmail, subject: entry.subject }
    });
    return { ...entry, status: BlockedInboundEmailStatus.DISMISSED, resolvedAt, resolvedByUserId: user.id };
  }

  async claimQuarantineRelease(entryId: string, user: AuthenticatedUser) {
    const staleProcessingBefore = new Date(Date.now() - 15 * 60 * 1000);
    const claimed = await this.prisma.blockedInboundEmail.updateMany({
      where: {
        id: entryId,
        organizationId: user.organizationId,
        OR: [
          { status: BlockedInboundEmailStatus.QUARANTINED },
          { status: BlockedInboundEmailStatus.PROCESSING, resolvedAt: { lt: staleProcessingBefore } }
        ]
      },
      data: {
        status: BlockedInboundEmailStatus.PROCESSING,
        resolvedAt: new Date(),
        resolvedByUserId: user.id,
        releaseFailureReason: null
      }
    });
    return claimed.count === 1;
  }

  async applyReleaseRuleAction(entryId: string, action: SpamReleaseAction, user: AuthenticatedUser) {
    const entry = await this.getQuarantinedEmail(entryId, user.organizationId);
    if (action === SpamReleaseAction.DEACTIVATE_RULE && entry.spamBlockEntryId) {
      await this.prisma.spamBlockEntry.update({ where: { id: entry.spamBlockEntryId }, data: { isActive: false } });
    } else if (action === SpamReleaseAction.ALLOW_SENDER || action === SpamReleaseAction.ALLOW_DOMAIN) {
      const type = action === SpamReleaseAction.ALLOW_SENDER ? SpamBlockType.EMAIL : SpamBlockType.DOMAIN;
      const value = type === SpamBlockType.EMAIL ? entry.senderEmail : entry.senderDomain;
      if (!value) throw new BadRequestException("The message does not contain the requested sender value.");
      if (action === SpamReleaseAction.ALLOW_DOMAIN && entry.spamBlockEntry?.type === SpamBlockType.EMAIL) {
        await this.prisma.spamBlockEntry.update({ where: { id: entry.spamBlockEntry.id }, data: { isActive: false } });
      }
      const normalizedValue = this.normalizeValue(type, value);
      await this.prisma.spamBlockEntry.upsert({
        where: { organizationId_type_normalizedValue: { organizationId: user.organizationId, type, normalizedValue } },
        update: { value, action: SpamRuleAction.ALLOW, scope: SpamRuleScope.ALL_INBOUND, isActive: true, archivedAt: null, notes: `Allowed after releasing quarantined message ${entry.subject}` },
        create: { organizationId: user.organizationId, type, value, normalizedValue, action: SpamRuleAction.ALLOW, scope: SpamRuleScope.ALL_INBOUND, createdByUserId: user.id, notes: `Allowed after releasing quarantined message ${entry.subject}` }
      });
    }
  }

  async markReleased(entryId: string, action: SpamReleaseAction, ticketId: string, messageId: string, user: AuthenticatedUser) {
    const updated = await this.prisma.blockedInboundEmail.update({
      where: { id: entryId },
      data: { status: BlockedInboundEmailStatus.RELEASED, resolutionAction: action, resolvedAt: new Date(), resolvedByUserId: user.id, releasedTicketId: ticketId, releasedMessageId: messageId, releaseFailureReason: null }
    });
    await this.auditLogs.create({ userId: user.id, entityType: "BlockedInboundEmail", entityId: entryId, action: "spam_quarantine.released", metadata: { action, ticketId, messageId } });
    return updated;
  }

  async markReleaseFailed(entryId: string, error: unknown, user: AuthenticatedUser) {
    const reason = error instanceof Error ? error.message.slice(0, 1000) : "Unable to release quarantined message.";
    await this.prisma.blockedInboundEmail.update({
      where: { id: entryId },
      data: {
        status: BlockedInboundEmailStatus.QUARANTINED,
        resolvedAt: null,
        resolvedByUserId: null,
        releaseFailureReason: reason
      }
    });
    await this.auditLogs.create({ userId: user.id, entityType: "BlockedInboundEmail", entityId: entryId, action: "spam_quarantine.release_failed", metadata: { reason } });
  }

  private async ensureEntry(entryId: string, organizationId: string) {
    const entry = await this.prisma.spamBlockEntry.findFirst({ where: { id: entryId, organizationId, archivedAt: null } });
    if (!entry) {
      throw new NotFoundException("Spam block entry was not found.");
    }
    return entry;
  }

  private normalizeValue(type: SpamBlockType, value: string) {
    return type === SpamBlockType.EMAIL ? this.normalizeEmail(value) : this.normalizeDomain(value);
  }

  private normalizeEmail(value: string) {
    const normalized = value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new BadRequestException("Enter a valid email address.");
    }
    return normalized;
  }

  private normalizeDomain(value: string) {
    const normalized = value.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
    if (!/^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(normalized)) {
      throw new BadRequestException("Enter a valid domain.");
    }
    return normalized;
  }

  private domainFromEmail(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const atIndex = normalizedEmail.lastIndexOf("@");
    return atIndex === -1 ? null : normalizedEmail.slice(atIndex + 1).replace(/\.$/, "") || null;
  }

  private isUniqueConstraint(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  }

  private positiveInt(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
  }
}
