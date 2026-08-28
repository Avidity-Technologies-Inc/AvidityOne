CREATE TYPE "MailDeliveryStatus" AS ENUM ('NOT_APPLICABLE', 'ACCEPTED', 'SKIPPED');

ALTER TABLE "ticket_messages"
ADD COLUMN "mailDeliveryStatus" "MailDeliveryStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
ADD COLUMN "mailDeliveryAttemptedAt" TIMESTAMP(3),
ADD COLUMN "mailDeliveryAcceptedAt" TIMESTAMP(3);

UPDATE "ticket_messages"
SET
  "mailDeliveryStatus" = 'ACCEPTED',
  "mailDeliveryAttemptedAt" = "createdAt",
  "mailDeliveryAcceptedAt" = "createdAt"
WHERE "direction" = 'OUTBOUND'
  AND "visibility" = 'PUBLIC'
  AND "emailMessageId" IS NOT NULL;

UPDATE "ticket_messages"
SET "mailDeliveryStatus" = 'SKIPPED'
WHERE "direction" = 'OUTBOUND'
  AND "visibility" = 'PUBLIC'
  AND "emailMessageId" IS NULL;
