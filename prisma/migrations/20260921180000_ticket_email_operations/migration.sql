-- AlterTable
ALTER TABLE "ticket_messages" ADD COLUMN     "suppressOperationalEmail" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ticket_email_policies" (
    "organizationId" UUID NOT NULL,
    "settings" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_email_policies_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "ticket_email_deliveries" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "messageId" UUID,
    "replyKey" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'PUBLIC',
    "subject" TEXT NOT NULL,
    "bodyText" TEXT,
    "cutoff" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "error" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_email_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_email_actions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "mailboxId" UUID NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "recipientSnapshot" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "originalBodyText" TEXT,
    "originalBodyHtml" TEXT,
    "bodyText" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "closeTicket" BOOLEAN NOT NULL DEFAULT false,
    "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "confirmationHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
    "resultMessageId" UUID,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ticket_email_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_email_events" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "messageId" UUID,
    "userId" UUID,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "ticket_email_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_email_deliveries_replyKey_key" ON "ticket_email_deliveries"("replyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_email_deliveries_dedupeKey_key" ON "ticket_email_deliveries"("dedupeKey");

-- CreateIndex
CREATE INDEX "ticket_email_deliveries_status_availableAt_idx" ON "ticket_email_deliveries"("status", "availableAt");

-- CreateIndex
CREATE INDEX "ticket_email_deliveries_organizationId_createdAt_idx" ON "ticket_email_deliveries"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ticket_email_deliveries_ticketId_userId_idx" ON "ticket_email_deliveries"("ticketId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_email_actions_sourceKey_key" ON "ticket_email_actions"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_email_actions_confirmationHash_key" ON "ticket_email_actions"("confirmationHash");

-- CreateIndex
CREATE INDEX "ticket_email_actions_organizationId_createdAt_idx" ON "ticket_email_actions"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ticket_email_events_processedAt_createdAt_idx" ON "ticket_email_events"("processedAt", "createdAt");

-- Capture source changes in the same transaction as the ticket/message. Disabled organizations
-- retain the legacy path. No historical message is enqueued by this additive migration.
CREATE FUNCTION avidity_capture_ticket_email() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tid uuid; oid uuid; mid uuid; uid uuid; event_kind text;
BEGIN
  IF TG_TABLE_NAME = 'tickets' THEN
    tid := NEW.id; oid := NEW."organizationId"; event_kind := CASE WHEN TG_OP = 'INSERT' THEN 'CREATED' ELSE 'ASSIGNMENT' END;
  ELSE
    tid := NEW."ticketId";
    SELECT "organizationId" INTO oid FROM tickets WHERE id = tid;
    IF TG_TABLE_NAME = 'ticket_messages' THEN mid := NEW.id; event_kind := 'MESSAGE';
    ELSE uid := NEW."userId"; event_kind := 'ASSIGNMENT'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM ticket_email_policies WHERE "organizationId" = oid AND settings->>'enabled' = 'true') THEN
    INSERT INTO ticket_email_events (id, "organizationId", "ticketId", "messageId", "userId", kind)
    VALUES (gen_random_uuid(), oid, tid, mid, uid, event_kind);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ticket_email_message_capture AFTER INSERT ON ticket_messages FOR EACH ROW EXECUTE FUNCTION avidity_capture_ticket_email();
CREATE TRIGGER ticket_email_assignee_capture AFTER INSERT ON ticket_assignees FOR EACH ROW EXECUTE FUNCTION avidity_capture_ticket_email();
CREATE TRIGGER ticket_email_assignment_capture AFTER UPDATE OF "assignedUserId", "assignedTeamId", "assignedGroupId" ON tickets FOR EACH ROW
WHEN (OLD."assignedUserId" IS DISTINCT FROM NEW."assignedUserId" OR OLD."assignedTeamId" IS DISTINCT FROM NEW."assignedTeamId" OR OLD."assignedGroupId" IS DISTINCT FROM NEW."assignedGroupId") EXECUTE FUNCTION avidity_capture_ticket_email();

CREATE TRIGGER ticket_email_created_capture AFTER INSERT ON tickets FOR EACH ROW EXECUTE FUNCTION avidity_capture_ticket_email();
