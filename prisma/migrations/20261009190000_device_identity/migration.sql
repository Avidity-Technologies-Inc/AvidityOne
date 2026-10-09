-- AlterTable
ALTER TABLE "system_settings" ADD COLUMN     "remoteAccessIdentityAutoLink" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "remoteAccessIdentityInactiveDays" INTEGER NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "previousHostnames" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "device_installations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "deviceId" UUID,
    "provider" "RemoteAccessProvider" NOT NULL DEFAULT 'TACTICAL_RMM',
    "remoteIdentifier" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "hostname" TEXT NOT NULL,
    "serialNumber" TEXT,
    "hardwareUuid" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "present" BOOLEAN NOT NULL DEFAULT true,
    "reviewReason" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_installations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_installations_organizationId_state_idx" ON "device_installations"("organizationId", "state");

-- CreateIndex
CREATE INDEX "device_installations_deviceId_idx" ON "device_installations"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "device_installations_organizationId_provider_remoteIdentifi_key" ON "device_installations"("organizationId", "provider", "remoteIdentifier");

-- AddForeignKey
ALTER TABLE "device_installations" ADD CONSTRAINT "device_installations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_installations" ADD CONSTRAINT "device_installations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_installations" ADD CONSTRAINT "device_installations_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Exactly one current installation can supply remote actions for an equipment record.
CREATE UNIQUE INDEX "device_installations_current_device_key" ON "device_installations" ("deviceId") WHERE "state" = 'CURRENT';
ALTER TABLE "device_installations" ADD CONSTRAINT "device_installations_state_check" CHECK (("state" = 'PENDING' AND "deviceId" IS NULL) OR ("state" IN ('CURRENT', 'HISTORICAL') AND "deviceId" IS NOT NULL));
