-- Existing schedules retain their next run. Timing is resolved from organization
-- settings until an explicit local time and day are saved.
ALTER TABLE "report_schedules" ADD COLUMN "timing" JSONB;
