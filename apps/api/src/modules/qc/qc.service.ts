import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { emptyQcConfiguration, QcCriterion, QcProgramConfiguration } from "@avidity/shared/dist";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import * as D from "./dto/qc.dto";
import { requireValue, scoreReview, validatePolicy, validateProgram, validateRubric } from "./qc.rules";

export const qcUserSelect = { id: true, firstName: true, lastName: true } as const;
export const qcReviewInclude = {
  owner: { select: qcUserSelect }, reviewer: { select: qcUserSelect },
  ticket: { select: { id: true, ticketNumber: true, subject: true, clientId: true, client: { select: { id: true, name: true } } } },
  deliverable: { select: { id: true, name: true, projectId: true, project: { select: { id: true, name: true, clientId: true } } } },
  findings: true, rubric: true, policy: true
} satisfies Prisma.QcReviewInclude;
export const qcJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

@Injectable()
export class QcService {
  constructor(readonly prisma: PrismaService) {}
  requirePermission(user: AuthenticatedUser, permission: string) {
    if (!user.permissions.includes(permission)) throw new ForbiddenException("You do not have permission to perform this QC action.");
  }
  scope(user: AuthenticatedUser): Prisma.QcReviewWhereInput {
    return { organizationId: user.organizationId, ...(!user.permissions.includes("qc.view_all") ? { ownerId: user.id } : {}) };
  }
  async history(tx: Prisma.TransactionClient, user: AuthenticatedUser, action: string, metadata: unknown, reviewId?: string, deliverableId?: string) {
    await tx.qcHistory.create({ data: { organizationId: user.organizationId, actorId: user.id, action, metadata: qcJson(metadata), reviewId, deliverableId } });
    // General audit records contain identifiers only; private feedback stays in scoped QC history.
    await tx.auditLog.create({ data: { organizationId: user.organizationId, userId: user.id, entityType: "QC", entityId: reviewId ?? deliverableId, action: `qc.${action}` } });
  }
  async usersExist(ids: string[], organizationId: string) {
    const unique = [...new Set(ids)];
    const count = await this.prisma.user.count({ where: { organizationId, id: { in: unique }, isActive: true, deletedAt: null } });
    requireValue(count === unique.length, "Select active users from this organization.");
  }
  async program(user: AuthenticatedUser) {
    const record = await this.prisma.qcProgram.findUnique({ where: { organizationId: user.organizationId } });
    const configuration = { ...emptyQcConfiguration(), ...((record?.configuration ?? {}) as object) } as QcProgramConfiguration;
    return { lastProcessingAt: record?.lastProcessingAt ?? null, processingErrorCode: record?.processingErrorCode ?? null, version: record?.version ?? 0, captureEnabled: record?.captureEnabled ?? false, processingEnabled: record?.processingEnabled ?? false, deliveryEnabled: record?.deliveryEnabled ?? false, startedAt: record?.startedAt ?? null, configuration, readiness: this.readiness(configuration) };
  }
  readiness(config: QcProgramConfiguration) {
    const missing: string[] = [];
    if (!config.ownerId) missing.push("QC owner");
    if (config.samplingPercent === null || config.samplingPeriodDays === null || config.samplingMinimum === null || !config.samplingDimensions.length) missing.push("Sampling policy");
    if (!config.serviceRubricId) missing.push("Published service rubric");
    if (!config.queueAgingMinutes) missing.push("Review queue deadline");
    if (!config.laborThresholdMinutes) missing.push("Mandatory labor threshold");
    if (!config.failureConsequence) missing.push("Failure consequence");
    if (config.flags.some(flag => flag.enabled && ["REOPENED_TICKET", "OWNERSHIP_CHURN", "STALLED_TICKET", "SILENT_AGING"].includes(flag.code) && !flag.threshold)) missing.push("Enabled flag thresholds");
    if (config.flags.some(flag => flag.enabled && flag.code === "UNVERIFIED_RMM_CLOSE") && (!config.rmmVerificationMode || !config.rmmEvidenceFreshnessMinutes || config.rmmVerificationMode === "ALERT_CLEAR" && !config.rmmClearedStatuses.length)) missing.push("RMM evidence policy");
    if (config.flags.some(flag => flag.enabled && flag.code === "TIME_ENTRY_VARIANCE") && (!config.varianceBaselineMinimum || !config.varianceThresholdPercent)) missing.push("Labor variance baseline policy");
    if (!config.historicalMeasurement) missing.push("Historical measurement decision");
    return missing;
  }
  async saveProgram(input: D.QcProgramDto, user: AuthenticatedUser) {
    validateProgram(input.configuration);
    requireValue(input.reason.trim(), "Explain this configuration change.");
    const config = input.configuration;
    await this.usersExist([config.ownerId, ...config.leadershipIds].filter((id): id is string => Boolean(id)), user.organizationId);
    requireValue(await this.prisma.client.count({ where: { id: { in: [...new Set(config.anchorClientIds)] }, organizationId: user.organizationId, deletedAt: null } }) === new Set(config.anchorClientIds).size, "Invalid anchor clients.");
    for (const [id, kind] of [[config.serviceRubricId, "SERVICE"], [config.creativeRubricId, "CREATIVE"]]) if (id) requireValue(await this.prisma.qcRubric.findFirst({ where: { id, kind: kind!, organizationId: user.organizationId, publishedAt: { not: null } } }), "Choose a published rubric of the correct kind.");
    if (config.mailboxId) requireValue(await this.prisma.mailbox.findFirst({ where: { id: config.mailboxId, organizationId: user.organizationId, isActive: true } }), "Choose an active organization mailbox.");
    if (input.processingEnabled) requireValue(input.captureEnabled && this.readiness(config).length === 0, `Resolve configuration before processing: ${this.readiness(config).join(", ")}`);
    if (input.deliveryEnabled) {
      this.requirePermission(user, "qc.notifications_manage");
      requireValue(input.processingEnabled && config.routes.length && config.deliveryCalendar && config.maxNotificationsPerHour, "Configure processing, recipients, delivery calendar and rate limits before delivery.");
      requireValue(!config.routes.some(route => route.channel.startsWith("TEAMS")) || config.teamsTenantId && config.teamsAppId && config.teamsSecretReference && config.teamsTeamId && config.teamsChannelId, "Configure the internal Teams bot and channel before activation.");
      requireValue(!config.routes.some(route => route.channel === "OUTLOOK") || config.mailboxId, "Select an Outlook mailbox.");
    }
    return this.prisma.$transaction(async tx => {
      const previous = await tx.qcProgram.findUnique({ where: { organizationId: user.organizationId } });
      requireValue((previous?.version ?? 0) === input.version, "Configuration changed. Reload before saving.");
      const data = { configuration: qcJson(config), captureEnabled: input.captureEnabled, processingEnabled: input.processingEnabled, deliveryEnabled: input.deliveryEnabled, startedAt: previous?.startedAt ?? (input.captureEnabled ? new Date() : null), version: input.version + 1 };
      if (previous) {
        const result = await tx.qcProgram.updateMany({ where: { id: previous.id, version: input.version }, data });
        if (result.count !== 1) throw new ConflictException("Configuration changed. Reload before saving.");
      } else await tx.qcProgram.create({ data: { organizationId: user.organizationId, ...data } });
      await tx.qcConfigRevision.create({ data: { organizationId: user.organizationId, version: data.version, configuration: qcJson(data), reason: input.reason.trim(), createdById: user.id } });
      await this.history(tx, user, "program_updated", { version: data.version });
      return data;
    });
  }
  async configurationResources(user: AuthenticatedUser) {
    const organizationId = user.organizationId;
    const [program, users, clients, projects, categories, rubrics, policies, statuses, mailboxes, agreementTypes] = await Promise.all([
      this.program(user), this.prisma.user.findMany({ where: { organizationId, isActive: true, deletedAt: null }, select: qcUserSelect, orderBy: { firstName: "asc" } }),
      this.prisma.client.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      this.prisma.project.findMany({ where: { organizationId, deletedAt: null }, select: { id: true, name: true, clientId: true }, orderBy: { name: "asc" } }),
      this.prisma.qcCategory.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
      this.prisma.qcRubric.findMany({ where: { organizationId }, orderBy: [{ name: "asc" }, { revision: "desc" }] }),
      this.prisma.qcPolicy.findMany({ where: { organizationId }, include: { client: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } }),
      this.prisma.ticketStatusDefinition.findMany({ where: { organizationId }, select: { id: true, name: true, category: true } }),
      this.prisma.mailbox.findMany({ where: { organizationId, isActive: true }, select: { id: true, name: true, provider: true, outboundMode: true } }),
      this.prisma.qcAgreementType.findMany({ where: { organizationId, isActive: true }, orderBy: { name: "asc" } })
    ]);
    return { program, users, clients, projects, categories, rubrics, policies, statuses, mailboxes, agreementTypes };
  }
  async lookups(user: AuthenticatedUser) {
    const organizationId = user.organizationId;
    const all = user.permissions.includes("qc.view_all");
    const [users, clients, projects, categories, rubrics, reviewers] = await Promise.all([
      this.prisma.user.findMany({ where: { organizationId, isActive: true, deletedAt: null, ...(!all ? { id: user.id } : {}) }, select: qcUserSelect }),
      this.prisma.client.findMany({ where: { organizationId, deletedAt: null, ...(!all ? { tickets: { some: { assignedUserId: user.id } } } : {}) }, select: { id: true, name: true } }),
      this.prisma.project.findMany({ where: { organizationId, deletedAt: null, ...(!all ? { ownerId: user.id } : {}) }, select: { id: true, name: true, clientId: true } }),
      this.prisma.qcCategory.findMany({ where: { organizationId, isActive: true } }),
      this.prisma.qcRubric.findMany({ where: { organizationId, publishedAt: { not: null } }, orderBy: [{ name: "asc" }, { revision: "desc" }] }),
      all ? this.prisma.user.findMany({ where: { organizationId, isActive: true, deletedAt: null, AND: ["qc.view", "qc.view_all", "qc.reviews_perform"].map(name => ({ groups: { some: { group: { organizationId, roles: { some: { role: { organizationId, permissions: { some: { permission: { name } } } } } } } } } })) }, select: qcUserSelect }) : Promise.resolve([])
    ]);
    return { currentUserId: user.id, permissions: user.permissions.filter(permission => permission.startsWith("qc.") || ["tickets.view", "projects.view", "remote_access.connect"].includes(permission)), users, clients, projects, categories, rubrics, reviewers };
  }
  async createAgreementType(input: D.QcCategoryDto, user: AuthenticatedUser) {
    requireValue(input.name.trim(), "Agreement type name is required.");
    return this.prisma.$transaction(async tx => { const item = await tx.qcAgreementType.create({ data: { organizationId: user.organizationId, name: input.name.trim() } }); await this.history(tx, user, "agreement_type_created", { id: item.id }); return item; });
  }
  async createCategory(input: D.QcCategoryDto, user: AuthenticatedUser) {
    requireValue(input.name.trim(), "Category name is required.");
    return this.prisma.$transaction(async tx => { const item = await tx.qcCategory.create({ data: { organizationId: user.organizationId, name: input.name.trim() } }); await this.history(tx, user, "category_created", { id: item.id }); return item; });
  }
  async createPolicy(input: D.QcPolicyDto, user: AuthenticatedUser) {
    validatePolicy(input.configuration);
    requireValue(await this.prisma.qcAgreementType.findFirst({ where: { organizationId: user.organizationId, name: input.agreementType, isActive: true } }), "Choose a configured agreement type.");
    requireValue(input.name.trim(), "Policy name is required.");
    requireValue(await this.prisma.client.findFirst({ where: { id: input.clientId, organizationId: user.organizationId, deletedAt: null } }), "Client was not found.");
    if (input.projectId) requireValue(await this.prisma.project.findFirst({ where: { id: input.projectId, organizationId: user.organizationId, clientId: input.clientId, deletedAt: null } }), "Project must belong to the selected client.");
    if (input.categoryId) requireValue(await this.prisma.qcCategory.findFirst({ where: { id: input.categoryId, organizationId: user.organizationId, isActive: true } }), "Category was not found.");
    requireValue(!input.effectiveUntil || new Date(input.effectiveUntil) > new Date(input.effectiveFrom), "Policy end must follow its start.");
    requireValue(await this.prisma.ticketStatusDefinition.count({ where: { id: { in: [...new Set(input.configuration.pauseStatusIds)] }, organizationId: user.organizationId, category: { in: ["WAITING_CUSTOMER", "WAITING_THIRD_PARTY"] } } }) === new Set(input.configuration.pauseStatusIds).size, "Only approved customer/vendor waiting states can pause SLA clocks.");
    return this.prisma.$transaction(async tx => { const policy = await tx.qcPolicy.create({ data: { ...input, name: input.name.trim(), organizationId: user.organizationId, configuration: qcJson(input.configuration) } }); await this.history(tx, user, "policy_created", { id: policy.id }); return policy; });
  }
  async createRubric(input: D.QcRubricDto, user: AuthenticatedUser) {
    validateRubric(input.criteria, input.passThreshold, input.reinspectionCount);
    requireValue(input.name.trim(), "Rubric name is required.");
    return this.prisma.$transaction(async tx => { const rubric = await tx.qcRubric.create({ data: { ...input, name: input.name.trim(), organizationId: user.organizationId, criteria: qcJson(input.criteria) } }); await this.history(tx, user, "rubric_created", { id: rubric.id }); return rubric; });
  }
  async publish(kind: "policy" | "rubric", id: string, user: AuthenticatedUser) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${user.organizationId}), 71944)::text`;
      if (kind === "policy") {
        const draft = await tx.qcPolicy.findFirst({ where: { id, organizationId: user.organizationId, publishedAt: null } });
        requireValue(draft, "The policy draft is unavailable.");
        const overlaps = await tx.qcPolicy.findMany({ where: { organizationId: user.organizationId, clientId: draft.clientId, projectId: draft.projectId, categoryId: draft.categoryId, publishedAt: { not: null }, ...(draft.effectiveUntil ? { effectiveFrom: { lt: draft.effectiveUntil } } : {}), OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: draft.effectiveFrom } }] } });
        for (const other of overlaps) {
          if ((other.configuration as { priority: string | null }).priority !== (draft.configuration as { priority: string | null }).priority) continue;
          requireValue(other.name === draft.name && draft.revision > other.revision && draft.effectiveFrom > other.effectiveFrom, "An overlapping policy has the same applicability. Publish a later revision of that policy or use non-overlapping dates.");
        }
      }
      const where = { id, organizationId: user.organizationId, publishedAt: null };
      const result = kind === "policy" ? await tx.qcPolicy.updateMany({ where, data: { publishedAt: new Date() } }) : await tx.qcRubric.updateMany({ where, data: { publishedAt: new Date() } });
      if (result.count !== 1) throw new ConflictException("The draft was not found or is already published.");
      await this.history(tx, user, `${kind}_published`, { id });
      return { published: true };
    });
  }
  reviewWhere(user: AuthenticatedUser, query: D.QcQueryDto): Prisma.QcReviewWhereInput {
    if (query.ownerId && !user.permissions.includes("qc.view_all") && query.ownerId !== user.id) throw new ForbiddenException();
    return { ...this.scope(user), ...(query.ownerId ? { ownerId: query.ownerId } : {}), ...(query.status ? { status: query.status } : {}), ...(query.clientId ? { OR: [{ ticket: { clientId: query.clientId } }, { deliverable: { project: { clientId: query.clientId } } }] } : {}), ...(query.projectId ? { deliverable: { projectId: query.projectId } } : {}), ...(query.ticketId ? { ticket: { OR: [{ ticketNumber: query.ticketId }, ...(/^[0-9a-f-]{36}$/i.test(query.ticketId) ? [{ id: query.ticketId }] : [])] } } : {}), ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}) };
  }
  async listReviews(query: D.QcQueryDto, user: AuthenticatedUser) {
    const where = this.reviewWhere(user, query); const page = query.page ?? 1; const pageSize = query.pageSize ?? 25;
    const [items, total] = await Promise.all([this.prisma.qcReview.findMany({ where, include: qcReviewInclude, orderBy: { createdAt: "desc" }, take: pageSize, skip: (page - 1) * pageSize }), this.prisma.qcReview.count({ where })]);
    return { items, total, page, pageSize };
  }
  async review(id: string, user: AuthenticatedUser) {
    const review = await this.prisma.qcReview.findFirst({ where: { id, ...this.scope(user) }, include: { ...qcReviewInclude, actions: { orderBy: { createdAt: "asc" } }, history: { orderBy: { createdAt: "asc" }, include: { actor: { select: qcUserSelect } } } } });
    if (!review) throw new NotFoundException("QC review was not found.");
    return review;
  }
  async evidence(id: string, user: AuthenticatedUser, query: D.QcQueryDto = {}) {
    const review = await this.review(id, user);
    if (review.ticketId) {
      const page = query.page ?? 1, pageSize = query.pageSize ?? 100;
      const [ticket, events, timeEntries, cycle] = await Promise.all([
        this.prisma.ticket.findFirst({ where: { id: review.ticketId, organizationId: user.organizationId }, select: { id: true, ticketNumber: true, subject: true, status: true, priority: true, createdAt: true, closedAt: true, resolvedAt: true, qcProfile: { include: { category: true } }, attachments: { where: { deletedAt: null }, select: { id: true, originalFilename: true, fileSize: true, scanStatus: true } }, meetings: { select: { id: true, title: true, agenda: true, startAt: true, endAt: true, status: true } }, projectWorkItems: { select: { project: { select: { id: true, name: true } } } }, messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, bodyText: true, createdAt: true, direction: true, visibility: true, mailDeliveryStatus: true, authorUser: { select: qcUserSelect } } }, _count: { select: { messages: true, qcWorkEvents: true } } } }),
        this.prisma.qcWorkEvent.findMany({ where: { ticketId: review.ticketId, organizationId: user.organizationId }, orderBy: { sequence: "asc" }, skip: (page - 1) * pageSize, take: pageSize }),
        this.prisma.qcTimeEntry.findMany({ where: { ticketId: review.ticketId, organizationId: user.organizationId, correction: null }, include: { technician: { select: qcUserSelect } }, orderBy: { createdAt: "asc" } }),
        this.prisma.qcCycle.findFirst({ where: { organizationId: user.organizationId, cycleKey: review.cycleKey.split(":exception:")[0] }, select: { complete: true, measurement: true } })
      ]);
      const measured = cycle?.measurement as { reason?: string | null; clocks?: unknown[] } | undefined;
      return { serviceMeasurement: cycle ? { complete: cycle.complete, reason: measured?.reason, clocks: measured?.clocks ?? [] } : null, ticket, events: events.map(event => ({ ...event, sequence: String(event.sequence) })), timeEntries, page, pageSize, messagesTruncated: (ticket?._count.messages ?? 0) > page * pageSize, hasMore: Math.max(ticket?._count.messages ?? 0, ticket?._count.qcWorkEvents ?? 0) > page * pageSize };
    }
    return { deliverable: await this.prisma.qcDeliverable.findFirst({ where: { id: review.deliverableId!, organizationId: user.organizationId }, include: { attachments: { select: { id: true, createdAt: true, deliverableVersion: true, scanStatus: true, storedFile: { select: { originalFilename: true, fileSize: true, sha256Hash: true } } } }, history: { orderBy: { createdAt: "asc" } }, project: { select: { id: true, name: true } } } }) };
  }
  async createReview(input: D.QcReviewDto, user: AuthenticatedUser) {
    this.requirePermission(user, "qc.view_all");
    requireValue(Boolean(input.ticketId) !== Boolean(input.deliverableId), "Choose exactly one work source.");
    requireValue(input.reason.trim(), "A selection reason is required.");
    const ticket = input.ticketId ? await this.prisma.ticket.findFirst({ where: { id: input.ticketId, organizationId: user.organizationId, deletedAt: null } }) : null;
    const deliverable = input.deliverableId ? await this.prisma.qcDeliverable.findFirst({ where: { id: input.deliverableId, organizationId: user.organizationId } }) : null;
    requireValue(ticket || deliverable, "Work source was not found.");
    const captured = ticket ? await this.prisma.qcWorkEvent.findMany({ where: { ticketId: ticket.id, organizationId: user.organizationId }, orderBy: [{ occurredAt: "asc" }, { sequence: "asc" }] }) : [];
    const cycleStart = [...captured].reverse().find(event => event.kind === "REOPENED") ?? captured[0];
    const checkpoint = ticket ? cycleStart?.id ?? "uncaptured" : deliverable!.deliveredAt?.toISOString() ?? `proof-${deliverable!.version}`;
    return this.prisma.$transaction(async tx => {
      const item = await tx.qcReview.upsert({ where: { organizationId_cycleKey: { organizationId: user.organizationId, cycleKey: `${input.ticketId ?? input.deliverableId}:${checkpoint}` } }, create: { organizationId: user.organizationId, ticketId: input.ticketId, deliverableId: input.deliverableId, ownerId: ticket?.assignedUserId ?? deliverable?.ownerId, cycleKey: `${input.ticketId ?? input.deliverableId}:${checkpoint}`, selectionReasons: ["MANUAL"] }, update: {} });
      await this.history(tx, user, "review_requested", { reason: input.reason }, item.id); return item;
    });
  }
  async assign(id: string, input: D.QcAssignDto, user: AuthenticatedUser) {
    const review = await this.review(id, user);
    requireValue(review.version === input.version, "Review changed. Reload before continuing.");
    requireValue(["PENDING", "IN_REVIEW"].includes(review.status), "Only open reviews can be assigned.");
    await this.usersExist([input.reviewerId], user.organizationId);
    for (const permission of ["qc.view", "qc.view_all", "qc.reviews_perform"]) requireValue(await this.prisma.user.count({ where: { id: input.reviewerId, organizationId: user.organizationId, groups: { some: { group: { organizationId: user.organizationId, roles: { some: { role: { organizationId: user.organizationId, permissions: { some: { permission: { name: permission } } } } } } } } } } }), "Reviewer must have organization QC review permissions.");
    return this.changeReview(id, input.version, user, "review_assigned", { reviewerId: input.reviewerId });
  }
  async changeReview(id: string, version: number, user: AuthenticatedUser, action: string, data: Prisma.QcReviewUncheckedUpdateManyInput) {
    return this.prisma.$transaction(async tx => {
      const result = await tx.qcReview.updateMany({ where: { id, ...this.scope(user), version }, data: { ...data, version: { increment: 1 } } });
      if (result.count !== 1) throw new ConflictException("Review changed. Reload before continuing.");
      await this.history(tx, user, action, data, id); return { updated: true };
    });
  }
  async transition(id: string, input: D.QcTransitionDto, user: AuthenticatedUser) {
    const review = await this.review(id, user);
    requireValue(review.version === input.version, "Review changed. Reload before continuing.");
    if (input.action === "ACKNOWLEDGE") {
      requireValue(review.ownerId === user.id && review.finalizedAt && !review.acknowledgedAt, "Only the reviewed technician can acknowledge a finalized review.");
      return this.changeReview(id, input.version, user, "review_acknowledged", { acknowledgedAt: new Date() });
    }
    this.requirePermission(user, "qc.reviews_perform");
    if (input.action === "START") { requireValue(review.status === "PENDING" && (!review.reviewerId || review.reviewerId === user.id), "This review is not available to claim."); return this.changeReview(id, input.version, user, "review_started", { status: "IN_REVIEW", reviewerId: user.id }); }
    requireValue(["PASSED", "FAILED", "COACHING_ISSUED"].includes(review.status), "Finalize the inspection before closing it.");
    requireValue(!await this.prisma.qcAction.count({ where: { reviewId: id, status: { not: "VERIFIED" }, kind: { not: "RECOGNITION" } } }), "Verify all follow-up actions before closing this review.");
    return this.changeReview(id, input.version, user, "review_closed", { status: "CLOSED" });
  }
  async score(id: string, input: D.QcScoreDto, user: AuthenticatedUser) {
    const review = await this.review(id, user);
    requireValue(review.status === "IN_REVIEW" && review.reviewerId === user.id, "Claim this review before scoring it.");
    const rubric = await this.prisma.qcRubric.findFirst({ where: { id: input.rubricId, organizationId: user.organizationId, publishedAt: { not: null }, kind: review.ticketId ? "SERVICE" : "CREATIVE" } });
    requireValue(rubric, "Select a published rubric for this work type.");
    const program = await this.program(user);
    requireValue(program.configuration.failureConsequence, "Configure the failed-review consequence before scoring.");
    requireValue(!review.rubricId || input.rubricId === review.rubricId, "Use the rubric revision assigned to this review.");
    const result = scoreReview(rubric.criteria as unknown as QcCriterion[], input.results, rubric.passThreshold);
    return this.prisma.$transaction(async tx => {
      const changed = await tx.qcReview.updateMany({ where: { id, ...this.scope(user), version: input.version, status: "IN_REVIEW", reviewerId: user.id }, data: { ...result, billingState: result.status === "FAILED" && program.configuration.failureConsequence === "BILLING_HOLD" ? "HELD" : "NOT_HELD", selectionReasons: [...new Set([...review.selectionReasons, ...(result.status === "FAILED" ? ["FAILED_RESULT"] : [])])], rubricId: rubric.id, results: qcJson(input.results), finalizedAt: new Date(), version: { increment: 1 } } });
      if (changed.count !== 1) throw new ConflictException("Review changed. Reload before scoring.");
      if (result.status === "FAILED" && review.ownerId && rubric.reinspectionCount > 0) await tx.qcReinspection.create({ data: { organizationId: user.organizationId, technicianId: review.ownerId, reviewId: id, remaining: rubric.reinspectionCount } });
      await this.history(tx, user, "review_scored", { rubricId: rubric.id, configurationVersion: program.version, failureConsequence: program.configuration.failureConsequence, result, results: input.results }, id); return result;
    });
  }
  async releaseBilling(id: string, input: { version: number; reason: string }, user: AuthenticatedUser) {
    const review = await this.review(id, user);
    requireValue(input.reason.trim() && review.billingState === "HELD", "A held review and release reason are required.");
    return this.prisma.$transaction(async tx => {
      requireValue(!await tx.qcAction.count({ where: { reviewId: id, kind: { not: "RECOGNITION" }, status: { not: "VERIFIED" } } }), "Verify corrective actions before releasing billing.");
      const result = await tx.qcReview.updateMany({ where: { id, organizationId: user.organizationId, version: input.version, billingState: "HELD" }, data: { billingState: "RELEASED", billingReleasedAt: new Date(), billingReleaseReason: input.reason.trim(), version: { increment: 1 } } });
      if (result.count !== 1) throw new ConflictException("Billing hold changed. Reload before releasing.");
      await this.history(tx, user, "billing_released", { reason: input.reason }, id); return { released: true };
    });
  }
  async bulk(input: D.QcBulkDto, user: AuthenticatedUser) {
    this.requirePermission(user, "qc.view_all");
    requireValue(input.reason.trim() && input.items.length && input.items.every(item => item && /^[0-9a-f-]{36}$/i.test(item.id) && Number.isInteger(item.version) && item.version >= 0), "Select reviews and enter a disposition reason.");
    return this.prisma.$transaction(async tx => {
      for (const item of input.items) {
        const changed = await tx.qcReview.updateMany({ where: { id: item.id, organizationId: user.organizationId, version: item.version, status: "PENDING", findings: { none: {} }, selectionReasons: { equals: ["SAMPLE"] } }, data: { status: "BULK_CLEARED", version: { increment: 1 } } });
        if (changed.count !== 1) throw new ConflictException("A review changed or requires individual inspection. Nothing was cleared.");
        await this.history(tx, user, "review_bulk_cleared", { reason: input.reason }, item.id);
      }
      return { cleared: input.items.length };
    });
  }
  async override(id: string, input: D.QcOverrideDto, user: AuthenticatedUser) {
    const finding = await this.prisma.qcFinding.findFirst({ where: { id, organizationId: user.organizationId, review: this.scope(user) } });
    if (!finding) throw new NotFoundException();
    requireValue(input.reason.trim(), "Explain the flag override.");
    return this.prisma.$transaction(async tx => {
      const result = await tx.qcFinding.updateMany({ where: { id, overriddenAt: null }, data: { overrideReason: input.reason.trim(), overriddenAt: new Date(), overriddenById: user.id } });
      if (result.count !== 1) throw new ConflictException("The flag was already overridden.");
      await this.history(tx, user, "flag_overridden", { id, reason: input.reason }, finding.reviewId); return { updated: true };
    });
  }
  async actions(user: AuthenticatedUser, query: D.QcQueryDto = {}) {
    return this.prisma.qcAction.findMany({ where: { organizationId: user.organizationId, ...(!user.permissions.includes("qc.view_all") ? { ownerId: user.id } : {}) }, include: { owner: { select: qcUserSelect }, review: { select: { id: true, ownerId: true, ticket: { select: { ticketNumber: true } }, deliverable: { select: { name: true } } } } }, orderBy: [{ status: "asc" }, { dueAt: "asc" }, { id: "asc" }], take: query.pageSize ?? 100, skip: ((query.page ?? 1) - 1) * (query.pageSize ?? 100) });
  }
  async createAction(input: D.QcActionDto, user: AuthenticatedUser) {
    const review = await this.review(input.reviewId, user);
    requireValue(review.finalizedAt && review.status !== "CLOSED", "Follow-up requires a finalized, open review.");
    requireValue(input.title.trim() && input.note.trim(), "Title and feedback are required.");
    requireValue(input.kind !== "CORRECTIVE" || input.dueAt, "Corrective actions require a due date.");
    await this.usersExist([input.ownerId], user.organizationId);
    return this.prisma.$transaction(async tx => {
      const reserved = await tx.qcReview.updateMany({ where: { id: review.id, version: review.version, status: { not: "CLOSED" } }, data: { version: { increment: 1 } } });
      if (reserved.count !== 1) throw new ConflictException("Review changed. Reload before adding an action.");
      const item = await tx.qcAction.create({ data: { ...input, organizationId: user.organizationId, status: input.kind === "RECOGNITION" ? "VERIFIED" : "OPEN" } });
      if (input.kind === "COACHING") await tx.qcReview.update({ where: { id: review.id }, data: { status: "COACHING_ISSUED", version: { increment: 1 } } });
      await this.history(tx, user, "action_created", { id: item.id, kind: item.kind }, review.id); return item;
    });
  }
  async updateAction(id: string, input: D.QcActionUpdateDto, user: AuthenticatedUser) {
    const item = await this.prisma.qcAction.findFirst({ where: { id, organizationId: user.organizationId, ...(!user.permissions.includes("qc.view_all") ? { ownerId: user.id } : {}) } });
    if (!item) throw new NotFoundException();
    requireValue(item.version === input.version, "Action changed. Reload before continuing.");
    const data: Prisma.QcActionUpdateManyMutationInput = { version: { increment: 1 } };
    if (input.action === "VERIFY") { this.requirePermission(user, "qc.coaching_manage"); requireValue(item.status === "COMPLETED", "Complete the action before verification."); data.status = "VERIFIED"; data.verifiedAt = new Date(); }
    else {
      this.requirePermission(user, "qc.actions_complete_own");
      requireValue(item.ownerId === user.id, "Only the action owner can acknowledge or complete it.");
      if (input.action === "ACKNOWLEDGE") { requireValue(item.status === "OPEN", "The action is already acknowledged."); data.status = "ACKNOWLEDGED"; data.acknowledgedAt = new Date(); }
      else { requireValue(item.status === "ACKNOWLEDGED" && input.evidence?.trim(), "Acknowledge the action and provide completion evidence."); data.status = "COMPLETED"; data.completedAt = new Date(); data.completionEvidence = input.evidence; }
    }
    return this.prisma.$transaction(async tx => { const result = await tx.qcAction.updateMany({ where: { id, organizationId: user.organizationId, version: input.version }, data }); if (result.count !== 1) throw new ConflictException("Action changed. Reload before continuing."); await this.history(tx, user, `action_${input.action.toLowerCase()}`, { id, evidence: input.evidence }, item.reviewId); return { updated: true }; });
  }
}
