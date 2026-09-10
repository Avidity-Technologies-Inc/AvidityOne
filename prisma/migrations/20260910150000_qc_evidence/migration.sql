-- AlterTable
ALTER TABLE "qc_ticket_profiles" ADD COLUMN     "rmmAlertReference" TEXT,
ADD COLUMN     "rmmDeviceId" UUID,
ADD COLUMN     "rmmTriggeredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "qc_rmm_evidence" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "alertReference" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_rmm_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_delivery_attempts" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "errorCode" TEXT,
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "qc_rmm_evidence_organizationId_ticketId_createdAt_idx" ON "qc_rmm_evidence"("organizationId", "ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "qc_delivery_attempts_deliveryId_attempt_outcome_key" ON "qc_delivery_attempts"("deliveryId", "attempt", "outcome");

-- AddForeignKey
ALTER TABLE "qc_ticket_profiles" ADD CONSTRAINT "qc_ticket_profiles_rmmDeviceId_fkey" FOREIGN KEY ("rmmDeviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_rmm_evidence" ADD CONSTRAINT "qc_rmm_evidence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_rmm_evidence" ADD CONSTRAINT "qc_rmm_evidence_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_rmm_evidence" ADD CONSTRAINT "qc_rmm_evidence_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_delivery_attempts" ADD CONSTRAINT "qc_delivery_attempts_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "qc_deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER qc_rmm_immutable BEFORE UPDATE OR DELETE ON qc_rmm_evidence FOR EACH ROW EXECUTE FUNCTION qc_protect_history();
CREATE TRIGGER qc_attempt_immutable BEFORE UPDATE OR DELETE ON qc_delivery_attempts FOR EACH ROW EXECUTE FUNCTION qc_protect_history();
CREATE FUNCTION qc_capture_labor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."ticketId" IS NOT NULL AND EXISTS (SELECT 1 FROM qc_programs WHERE "organizationId"=NEW."organizationId" AND "captureEnabled") THEN
    INSERT INTO qc_work_events(id,"organizationId","ticketId","actorId",kind,"occurredAt","sourceId",snapshot,"updatedAt") VALUES(gen_random_uuid(),NEW."organizationId",NEW."ticketId",NEW."technicianId",'TECHNICAL_TOUCH',clock_timestamp(),NEW.id,jsonb_build_object('timeEntryId',NEW.id,'startedAt',NEW."startedAt",'minutes',NEW.minutes),clock_timestamp());
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER qc_labor_capture AFTER INSERT ON qc_time_entries FOR EACH ROW EXECUTE FUNCTION qc_capture_labor();
