-- AlterTable
ALTER TABLE "qc_programs" ADD COLUMN     "lastProcessingAt" TIMESTAMP(3),
ADD COLUMN     "processingErrorCode" TEXT;


CREATE OR REPLACE FUNCTION qc_capture_ticket() RETURNS trigger LANGUAGE plpgsql AS $$
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
  snapshot := snapshot || jsonb_build_object('rmmDeviceId',(SELECT "rmmDeviceId" FROM qc_ticket_profiles WHERE "ticketId"=NEW.id),'rmmAlertReference',(SELECT "rmmAlertReference" FROM qc_ticket_profiles WHERE "ticketId"=NEW.id),'categoryId',(SELECT "categoryId" FROM qc_ticket_profiles WHERE "ticketId"=NEW.id),'resolutionNotePresent',coalesce((SELECT length(trim("resolutionNote")) > 0 FROM qc_ticket_profiles WHERE "ticketId"=NEW.id),false));
  INSERT INTO qc_work_events(id,"organizationId","ticketId",kind,"occurredAt",snapshot,"updatedAt") VALUES(gen_random_uuid(),NEW."organizationId",NEW.id,kind,clock_timestamp(),snapshot,clock_timestamp());
  RETURN NEW;
END;
$$;
