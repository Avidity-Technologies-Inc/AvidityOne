-- AlterTable
ALTER TABLE "qc_work_events" ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'CAPTURED';

-- AlterTable
ALTER TABLE "qc_reviews" ADD COLUMN     "billingReleaseReason" TEXT,
ADD COLUMN     "billingReleasedAt" TIMESTAMP(3),
ADD COLUMN     "billingState" TEXT NOT NULL DEFAULT 'NOT_HELD';

-- CreateIndex
CREATE UNIQUE INDEX "qc_work_events_ticketId_sourceId_kind_key" ON "qc_work_events"("ticketId", "sourceId", "kind");
