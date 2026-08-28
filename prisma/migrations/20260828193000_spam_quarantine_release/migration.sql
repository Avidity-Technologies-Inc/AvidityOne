CREATE TYPE "SpamRuleAction" AS ENUM ('BLOCK', 'ALLOW');
CREATE TYPE "SpamRuleScope" AS ENUM ('NEW_CONVERSATIONS_ONLY', 'ALL_INBOUND');
CREATE TYPE "BlockedInboundEmailStatus" AS ENUM ('QUARANTINED', 'PROCESSING', 'RELEASED', 'DISMISSED');
CREATE TYPE "SpamReleaseAction" AS ENUM ('KEEP_RULE', 'DEACTIVATE_RULE', 'ALLOW_SENDER', 'ALLOW_DOMAIN');

ALTER TABLE "spam_block_entries"
ADD COLUMN "action" "SpamRuleAction" NOT NULL DEFAULT 'BLOCK',
ADD COLUMN "scope" "SpamRuleScope" NOT NULL DEFAULT 'ALL_INBOUND',
ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "blocked_inbound_emails"
ADD COLUMN "senderName" TEXT,
ADD COLUMN "bodyText" TEXT,
ADD COLUMN "bodyHtml" TEXT,
ADD COLUMN "inReplyTo" TEXT,
ADD COLUMN "emailReferences" TEXT,
ADD COLUMN "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "internetMessageHeaders" JSONB,
ADD COLUMN "status" "BlockedInboundEmailStatus" NOT NULL DEFAULT 'QUARANTINED',
ADD COLUMN "resolutionAction" "SpamReleaseAction",
ADD COLUMN "resolvedAt" TIMESTAMP(3),
ADD COLUMN "resolvedByUserId" UUID,
ADD COLUMN "releasedTicketId" UUID,
ADD COLUMN "releasedMessageId" UUID,
ADD COLUMN "releaseFailureReason" TEXT;

CREATE INDEX "blocked_inbound_emails_organizationId_status_createdAt_idx"
ON "blocked_inbound_emails"("organizationId", "status", "createdAt");

CREATE INDEX "blocked_inbound_emails_releasedTicketId_idx"
ON "blocked_inbound_emails"("releasedTicketId");

ALTER TABLE "blocked_inbound_emails"
ADD CONSTRAINT "blocked_inbound_emails_resolvedByUserId_fkey"
FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
