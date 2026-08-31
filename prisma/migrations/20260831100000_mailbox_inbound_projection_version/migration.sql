ALTER TABLE "mailboxes"
ADD COLUMN "inboundProjectionVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "mailboxes"
ALTER COLUMN "inboundProjectionVersion" SET DEFAULT 2;
