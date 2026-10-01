BEGIN;
-- Legacy snapshots remain unscoped; do not infer ownership from their contents.
ALTER TABLE "system_health_snapshots" ADD COLUMN "organizationId" UUID,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "system_health_snapshots" ADD CONSTRAINT "system_health_snapshots_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "system_health_snapshots_organizationId_checkedAt_idx" ON "system_health_snapshots"("organizationId", "checkedAt");
CREATE INDEX "system_health_snapshots_organizationId_component_checkedAt_idx" ON "system_health_snapshots"("organizationId", "component", "checkedAt");
ALTER TABLE "system_settings" ADD COLUMN "remoteAccessLastSuccessAt" TIMESTAMP(3);
COMMIT;
