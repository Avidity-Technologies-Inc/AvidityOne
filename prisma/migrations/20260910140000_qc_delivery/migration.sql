-- CreateTable
CREATE TABLE "qc_teams_conversations" (
    "teamId" TEXT,
    "channelId" TEXT,
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "recipientId" UUID,
    "conversationId" TEXT NOT NULL,
    "serviceUrl" TEXT NOT NULL,
    "botAppId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_teams_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_teams_actions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "reviewId" UUID,
    "recipientId" UUID NOT NULL,
    "version" INTEGER,
    "verb" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_teams_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "qc_teams_conversations_organizationId_recipientId_idx" ON "qc_teams_conversations"("organizationId", "recipientId");

-- CreateIndex
CREATE UNIQUE INDEX "qc_teams_conversations_organizationId_conversationId_key" ON "qc_teams_conversations"("organizationId", "conversationId");

-- CreateIndex
CREATE INDEX "qc_teams_actions_organizationId_expiresAt_idx" ON "qc_teams_actions"("organizationId", "expiresAt");

-- AddForeignKey
ALTER TABLE "qc_teams_conversations" ADD CONSTRAINT "qc_teams_conversations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_teams_actions" ADD CONSTRAINT "qc_teams_actions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_teams_actions" ADD CONSTRAINT "qc_teams_actions_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "qc_deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO permissions (id,name,description,"createdAt","updatedAt") VALUES (gen_random_uuid(),'qc.billing_release','Release QC billing holds with documented verification',now(),now()) ON CONFLICT (name) DO NOTHING;
