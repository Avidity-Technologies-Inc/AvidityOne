-- CreateTable
CREATE TABLE "qc_programs" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "captureEnabled" BOOLEAN NOT NULL DEFAULT false,
    "processingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "deliveryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_config_revisions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "configuration" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_config_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_categories" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_policies" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "projectId" UUID,
    "categoryId" UUID,
    "name" TEXT NOT NULL,
    "agreementType" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveUntil" TIMESTAMP(3),
    "configuration" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_rubrics" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "criteria" JSONB NOT NULL,
    "passThreshold" DOUBLE PRECISION NOT NULL,
    "reinspectionCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_rubrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_ticket_profiles" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "categoryId" UUID,
    "resolutionNote" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_ticket_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_deliverables" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "eventId" UUID,
    "ownerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_deliverables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_time_entries" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "ticketId" UUID,
    "deliverableId" UUID,
    "technicianId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "correctionOfId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_work_events" (
    "id" UUID NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "organizationId" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "actorId" UUID,
    "kind" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceId" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_work_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_event_receipts" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_event_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_reviews" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "ticketId" UUID,
    "deliverableId" UUID,
    "ownerId" UUID,
    "reviewerId" UUID,
    "rubricId" UUID,
    "policyId" UUID,
    "cycleKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 0,
    "selectionReasons" TEXT[],
    "score" DOUBLE PRECISION,
    "results" JSONB,
    "finalizedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_findings" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "overrideReason" TEXT,
    "overriddenById" UUID,
    "overriddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_actions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 0,
    "acknowledgedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "completionEvidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_reinspections" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "technicianId" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "remaining" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_reinspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_history" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "reviewId" UUID,
    "deliverableId" UUID,
    "actorId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_deliveries" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "reviewId" UUID,
    "recipientId" UUID NOT NULL,
    "deduplicationKey" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_cycles" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "cycleKey" TEXT NOT NULL,
    "ownerId" UUID,
    "clientId" UUID,
    "categoryId" UUID,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "policyId" UUID,
    "complete" BOOLEAN NOT NULL,
    "measurement" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_sampling_runs" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "configurationVersion" INTEGER NOT NULL,
    "population" JSONB NOT NULL,
    "selection" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_sampling_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_agreement_types" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_agreement_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qc_programs_organizationId_key" ON "qc_programs"("organizationId");

-- CreateIndex
CREATE INDEX "qc_programs_organizationId_createdAt_idx" ON "qc_programs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "qc_config_revisions_organizationId_createdAt_idx" ON "qc_config_revisions"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "qc_config_revisions_organizationId_version_key" ON "qc_config_revisions"("organizationId", "version");

-- CreateIndex
CREATE INDEX "qc_categories_organizationId_createdAt_idx" ON "qc_categories"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "qc_categories_organizationId_name_key" ON "qc_categories"("organizationId", "name");

-- CreateIndex
CREATE INDEX "qc_policies_organizationId_createdAt_idx" ON "qc_policies"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "qc_policies_organizationId_name_revision_key" ON "qc_policies"("organizationId", "name", "revision");

-- CreateIndex
CREATE INDEX "qc_rubrics_organizationId_createdAt_idx" ON "qc_rubrics"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "qc_rubrics_organizationId_name_revision_key" ON "qc_rubrics"("organizationId", "name", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "qc_ticket_profiles_ticketId_key" ON "qc_ticket_profiles"("ticketId");

-- CreateIndex
CREATE INDEX "qc_ticket_profiles_organizationId_createdAt_idx" ON "qc_ticket_profiles"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "qc_deliverables_organizationId_createdAt_idx" ON "qc_deliverables"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "qc_time_entries_correctionOfId_key" ON "qc_time_entries"("correctionOfId");

-- CreateIndex
CREATE INDEX "qc_time_entries_organizationId_createdAt_idx" ON "qc_time_entries"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "qc_work_events_sequence_key" ON "qc_work_events"("sequence");

-- CreateIndex
CREATE INDEX "qc_work_events_organizationId_createdAt_idx" ON "qc_work_events"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "qc_work_events_ticketId_sequence_idx" ON "qc_work_events"("ticketId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "qc_event_receipts_eventId_key" ON "qc_event_receipts"("eventId");

-- CreateIndex
CREATE INDEX "qc_reviews_organizationId_createdAt_idx" ON "qc_reviews"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "qc_reviews_organizationId_ownerId_status_idx" ON "qc_reviews"("organizationId", "ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "qc_reviews_organizationId_cycleKey_key" ON "qc_reviews"("organizationId", "cycleKey");

-- CreateIndex
CREATE INDEX "qc_findings_organizationId_createdAt_idx" ON "qc_findings"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "qc_findings_reviewId_code_key" ON "qc_findings"("reviewId", "code");

-- CreateIndex
CREATE INDEX "qc_actions_organizationId_createdAt_idx" ON "qc_actions"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "qc_reinspections_reviewId_key" ON "qc_reinspections"("reviewId");

-- CreateIndex
CREATE INDEX "qc_reinspections_organizationId_createdAt_idx" ON "qc_reinspections"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "qc_history_organizationId_createdAt_idx" ON "qc_history"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "qc_deliveries_deduplicationKey_key" ON "qc_deliveries"("deduplicationKey");

-- CreateIndex
CREATE INDEX "qc_deliveries_organizationId_createdAt_idx" ON "qc_deliveries"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "qc_deliveries_state_nextAttemptAt_idx" ON "qc_deliveries"("state", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "qc_cycles_cycleKey_key" ON "qc_cycles"("cycleKey");

-- CreateIndex
CREATE INDEX "qc_cycles_organizationId_closedAt_idx" ON "qc_cycles"("organizationId", "closedAt");

-- CreateIndex
CREATE INDEX "qc_cycles_organizationId_ownerId_startedAt_idx" ON "qc_cycles"("organizationId", "ownerId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "qc_sampling_runs_organizationId_periodStart_key" ON "qc_sampling_runs"("organizationId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "qc_agreement_types_organizationId_name_key" ON "qc_agreement_types"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "qc_programs" ADD CONSTRAINT "qc_programs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_config_revisions" ADD CONSTRAINT "qc_config_revisions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_config_revisions" ADD CONSTRAINT "qc_config_revisions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_categories" ADD CONSTRAINT "qc_categories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_policies" ADD CONSTRAINT "qc_policies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_policies" ADD CONSTRAINT "qc_policies_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_policies" ADD CONSTRAINT "qc_policies_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_policies" ADD CONSTRAINT "qc_policies_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "qc_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_rubrics" ADD CONSTRAINT "qc_rubrics_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_ticket_profiles" ADD CONSTRAINT "qc_ticket_profiles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_ticket_profiles" ADD CONSTRAINT "qc_ticket_profiles_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_ticket_profiles" ADD CONSTRAINT "qc_ticket_profiles_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "qc_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_deliverables" ADD CONSTRAINT "qc_deliverables_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_deliverables" ADD CONSTRAINT "qc_deliverables_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_deliverables" ADD CONSTRAINT "qc_deliverables_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "event_service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_deliverables" ADD CONSTRAINT "qc_deliverables_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_time_entries" ADD CONSTRAINT "qc_time_entries_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "qc_time_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_time_entries" ADD CONSTRAINT "qc_time_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_time_entries" ADD CONSTRAINT "qc_time_entries_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_time_entries" ADD CONSTRAINT "qc_time_entries_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "qc_deliverables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_time_entries" ADD CONSTRAINT "qc_time_entries_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_work_events" ADD CONSTRAINT "qc_work_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_work_events" ADD CONSTRAINT "qc_work_events_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_event_receipts" ADD CONSTRAINT "qc_event_receipts_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "qc_work_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "qc_deliverables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "qc_rubrics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_reviews" ADD CONSTRAINT "qc_reviews_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "qc_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_findings" ADD CONSTRAINT "qc_findings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_findings" ADD CONSTRAINT "qc_findings_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "qc_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_findings" ADD CONSTRAINT "qc_findings_overriddenById_fkey" FOREIGN KEY ("overriddenById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_actions" ADD CONSTRAINT "qc_actions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_actions" ADD CONSTRAINT "qc_actions_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "qc_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_actions" ADD CONSTRAINT "qc_actions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_reinspections" ADD CONSTRAINT "qc_reinspections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_reinspections" ADD CONSTRAINT "qc_reinspections_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_reinspections" ADD CONSTRAINT "qc_reinspections_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "qc_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_history" ADD CONSTRAINT "qc_history_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_history" ADD CONSTRAINT "qc_history_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "qc_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_history" ADD CONSTRAINT "qc_history_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "qc_deliverables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_history" ADD CONSTRAINT "qc_history_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_deliveries" ADD CONSTRAINT "qc_deliveries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_deliveries" ADD CONSTRAINT "qc_deliveries_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "qc_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_deliveries" ADD CONSTRAINT "qc_deliveries_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_cycles" ADD CONSTRAINT "qc_cycles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_cycles" ADD CONSTRAINT "qc_cycles_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_cycles" ADD CONSTRAINT "qc_cycles_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "qc_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_sampling_runs" ADD CONSTRAINT "qc_sampling_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_agreement_types" ADD CONSTRAINT "qc_agreement_types_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Published definitions and source evidence are append-only. Corrections create new revisions.
CREATE FUNCTION qc_protect_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'QC historical evidence cannot be changed or deleted';
END;
$$;
CREATE TRIGGER qc_events_immutable BEFORE UPDATE OR DELETE ON qc_work_events FOR EACH ROW EXECUTE FUNCTION qc_protect_history();
CREATE TRIGGER qc_time_immutable BEFORE UPDATE OR DELETE ON qc_time_entries FOR EACH ROW EXECUTE FUNCTION qc_protect_history();
CREATE TRIGGER qc_history_immutable BEFORE UPDATE OR DELETE ON qc_history FOR EACH ROW EXECUTE FUNCTION qc_protect_history();
CREATE TRIGGER qc_config_immutable BEFORE UPDATE OR DELETE ON qc_config_revisions FOR EACH ROW EXECUTE FUNCTION qc_protect_history();
CREATE TRIGGER qc_sampling_immutable BEFORE UPDATE OR DELETE ON qc_sampling_runs FOR EACH ROW EXECUTE FUNCTION qc_protect_history();
CREATE FUNCTION qc_protect_published() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."publishedAt" IS NOT NULL THEN RAISE EXCEPTION 'Create a new QC definition revision'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER qc_rubric_immutable BEFORE UPDATE OR DELETE ON qc_rubrics FOR EACH ROW EXECUTE FUNCTION qc_protect_published();
CREATE TRIGGER qc_policy_immutable BEFORE UPDATE OR DELETE ON qc_policies FOR EACH ROW EXECUTE FUNCTION qc_protect_published();
ALTER TABLE qc_time_entries ADD CONSTRAINT qc_time_source CHECK (("ticketId" IS NULL) <> ("deliverableId" IS NULL)), ADD CONSTRAINT qc_time_positive CHECK (minutes BETWEEN 1 AND 1440);
ALTER TABLE qc_reviews ADD CONSTRAINT qc_review_source CHECK (("ticketId" IS NULL) <> ("deliverableId" IS NULL)), ADD CONSTRAINT qc_review_score CHECK (score IS NULL OR score BETWEEN 0 AND 100);
ALTER TABLE qc_rubrics ADD CONSTRAINT qc_rubric_threshold CHECK ("passThreshold" BETWEEN 0 AND 100 AND "reinspectionCount" >= 0);
ALTER TABLE qc_reinspections ADD CONSTRAINT qc_reinspection_count CHECK (remaining >= 0);

-- Capture at the database boundary so manual, bulk, workflow and mailbox writes agree.
-- Viewing a ticket (firstReadAt/updatedAt) never creates technical activity.
CREATE FUNCTION qc_capture_ticket() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  snapshot jsonb;
  previous_snapshot jsonb;
  kind text;
  category text;
  previous_category text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM qc_programs WHERE "organizationId" = NEW."organizationId" AND "captureEnabled") THEN RETURN NEW; END IF;
  SELECT d.category::text INTO category FROM ticket_status_definitions d WHERE d.id = NEW."statusDefinitionId";
  snapshot := jsonb_build_object('status',NEW.status,'category',coalesce(category,NEW.status::text),'statusDefinitionId',NEW."statusDefinitionId",'assignedUserId',NEW."assignedUserId",'clientId',NEW."clientId",'priority',NEW.priority,'closedAt',NEW."closedAt",'createdAt',NEW."createdAt");
  IF TG_OP = 'INSERT' THEN kind := 'CREATED';
  ELSE
    IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW."statusDefinitionId" IS NOT DISTINCT FROM OLD."statusDefinitionId" AND NEW."assignedUserId" IS NOT DISTINCT FROM OLD."assignedUserId" AND NEW."clientId" IS NOT DISTINCT FROM OLD."clientId" AND NEW.priority IS NOT DISTINCT FROM OLD.priority AND NEW."closedAt" IS NOT DISTINCT FROM OLD."closedAt" AND NEW."resolvedAt" IS NOT DISTINCT FROM OLD."resolvedAt" THEN RETURN NEW; END IF;
    SELECT d.category::text INTO previous_category FROM ticket_status_definitions d WHERE d.id = OLD."statusDefinitionId";
    previous_snapshot := jsonb_build_object('status',OLD.status,'category',coalesce(previous_category,OLD.status::text),'assignedUserId',OLD."assignedUserId",'clientId',OLD."clientId",'priority',OLD.priority,'closedAt',OLD."closedAt");
    snapshot := snapshot || jsonb_build_object('previous',previous_snapshot);
    kind := CASE WHEN coalesce(previous_category,OLD.status::text) IN ('CLOSED','RESOLVED') AND coalesce(category,NEW.status::text) NOT IN ('CLOSED','RESOLVED','CANCELLED','MERGED') THEN 'REOPENED' ELSE 'TICKET_CHANGED' END;
  END IF;
  snapshot := snapshot || jsonb_build_object('categoryId',(SELECT "categoryId" FROM qc_ticket_profiles WHERE "ticketId"=NEW.id),'resolutionNotePresent',coalesce((SELECT length(trim("resolutionNote")) > 0 FROM qc_ticket_profiles WHERE "ticketId"=NEW.id),false));
  INSERT INTO qc_work_events(id,"organizationId","ticketId",kind,"occurredAt",snapshot,"updatedAt") VALUES(gen_random_uuid(),NEW."organizationId",NEW.id,kind,clock_timestamp(),snapshot,clock_timestamp());
  RETURN NEW;
END;
$$;
CREATE TRIGGER qc_ticket_capture AFTER INSERT OR UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION qc_capture_ticket();
CREATE FUNCTION qc_capture_message() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org uuid; kind text;
BEGIN
  SELECT "organizationId" INTO org FROM tickets WHERE id=NEW."ticketId";
  IF NOT EXISTS (SELECT 1 FROM qc_programs WHERE "organizationId"=org AND "captureEnabled") THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND (OLD."mailDeliveryStatus"='ACCEPTED' OR NEW."mailDeliveryStatus"<>'ACCEPTED') THEN RETURN NEW; END IF;
  IF NEW.direction='INBOUND' AND TG_OP='INSERT' THEN kind:='CUSTOMER_MESSAGE';
  ELSIF NEW."authorUserId" IS NOT NULL AND NEW.visibility='PUBLIC' AND NEW.direction='OUTBOUND' AND NEW."mailDeliveryStatus"='ACCEPTED' THEN kind:='PUBLIC_RESPONSE';
  ELSIF NEW."authorUserId" IS NOT NULL AND NEW.direction='INTERNAL' AND TG_OP='INSERT' THEN kind:='TECHNICAL_TOUCH';
  ELSE RETURN NEW; END IF;
  INSERT INTO qc_work_events(id,"organizationId","ticketId","actorId",kind,"occurredAt","sourceId",snapshot,"updatedAt") VALUES(gen_random_uuid(),org,NEW."ticketId",NEW."authorUserId",kind,clock_timestamp(),NEW.id,jsonb_build_object('messageId',NEW.id,'sourceCreatedAt',NEW."createdAt",'deliveryAcceptedAt',NEW."mailDeliveryAcceptedAt"),clock_timestamp());
  RETURN NEW;
END;
$$;
CREATE TRIGGER qc_message_capture AFTER INSERT OR UPDATE OF "mailDeliveryStatus" ON ticket_messages FOR EACH ROW EXECUTE FUNCTION qc_capture_message();

-- Catalog only: existing role memberships and grants are unchanged.
INSERT INTO permissions (id,name,description,"createdAt","updatedAt") VALUES (gen_random_uuid(),'qc.view','Quality Control: view',now(),now()) ON CONFLICT (name) DO NOTHING;
INSERT INTO permissions (id,name,description,"createdAt","updatedAt") VALUES (gen_random_uuid(),'qc.view_all','Quality Control: view all',now(),now()) ON CONFLICT (name) DO NOTHING;
INSERT INTO permissions (id,name,description,"createdAt","updatedAt") VALUES (gen_random_uuid(),'qc.reviews_perform','Quality Control: reviews perform',now(),now()) ON CONFLICT (name) DO NOTHING;
INSERT INTO permissions (id,name,description,"createdAt","updatedAt") VALUES (gen_random_uuid(),'qc.reviews_assign','Quality Control: reviews assign',now(),now()) ON CONFLICT (name) DO NOTHING;
INSERT INTO permissions (id,name,description,"createdAt","updatedAt") VALUES (gen_random_uuid(),'qc.reviews_bulk','Quality Control: reviews bulk',now(),now()) ON CONFLICT (name) DO NOTHING;
INSERT INTO permissions (id,name,description,"createdAt","updatedAt") VALUES (gen_random_uuid(),'qc.rubrics_manage','Quality Control: rubrics manage',now(),now()) ON CONFLICT (name) DO NOTHING;
INSERT INTO permissions (id,name,description,"createdAt","updatedAt") VALUES (gen_random_uuid(),'qc.coaching_manage','Quality Control: coaching manage',now(),now()) ON CONFLICT (name) DO NOTHING;
INSERT INTO permissions (id,name,description,"createdAt","updatedAt") VALUES (gen_random_uuid(),'qc.actions_complete_own','Quality Control: actions complete own',now(),now()) ON CONFLICT (name) DO NOTHING;
INSERT INTO permissions (id,name,description,"createdAt","updatedAt") VALUES (gen_random_uuid(),'qc.flags_override','Quality Control: flags override',now(),now()) ON CONFLICT (name) DO NOTHING;
INSERT INTO permissions (id,name,description,"createdAt","updatedAt") VALUES (gen_random_uuid(),'qc.settings_manage','Quality Control: settings manage',now(),now()) ON CONFLICT (name) DO NOTHING;
INSERT INTO permissions (id,name,description,"createdAt","updatedAt") VALUES (gen_random_uuid(),'qc.notifications_manage','Quality Control: notifications manage',now(),now()) ON CONFLICT (name) DO NOTHING;
INSERT INTO permissions (id,name,description,"createdAt","updatedAt") VALUES (gen_random_uuid(),'qc.export_internal','Quality Control: export internal',now(),now()) ON CONFLICT (name) DO NOTHING;
INSERT INTO permissions (id,name,description,"createdAt","updatedAt") VALUES (gen_random_uuid(),'qc.export_client','Quality Control: export client',now(),now()) ON CONFLICT (name) DO NOTHING;
INSERT INTO permissions (id,name,description,"createdAt","updatedAt") VALUES (gen_random_uuid(),'qc.work_record','Quality Control: work record',now(),now()) ON CONFLICT (name) DO NOTHING;
