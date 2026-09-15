-- Existing meetings retain their provider state; modality is unknown until explicitly selected.
CREATE TYPE "TicketActivityType" AS ENUM ('MEETING', 'WORK_SESSION', 'SERVICE_VISIT');
CREATE TYPE "TicketActivityMode" AS ENUM ('REMOTE', 'ON_SITE', 'HYBRID');
ALTER TABLE "ticket_meetings"
  ADD COLUMN "activityType" "TicketActivityType" NOT NULL DEFAULT 'MEETING',
  ADD COLUMN "modality" "TicketActivityMode";
