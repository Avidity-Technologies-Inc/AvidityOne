-- CreateTable
CREATE TABLE "qc_attachments" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "deliverableId" UUID NOT NULL,
    "uploadedById" UUID NOT NULL,
    "storedFileId" UUID NOT NULL,
    "deliverableVersion" INTEGER NOT NULL,
    "scanStatus" "AttachmentScanStatus" NOT NULL,
    "scanResult" "AttachmentScanResult" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qc_attachments_storedFileId_key" ON "qc_attachments"("storedFileId");

-- CreateIndex
CREATE INDEX "qc_attachments_organizationId_deliverableId_createdAt_idx" ON "qc_attachments"("organizationId", "deliverableId", "createdAt");

-- AddForeignKey
ALTER TABLE "qc_attachments" ADD CONSTRAINT "qc_attachments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_attachments" ADD CONSTRAINT "qc_attachments_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "qc_deliverables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_attachments" ADD CONSTRAINT "qc_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_attachments" ADD CONSTRAINT "qc_attachments_storedFileId_fkey" FOREIGN KEY ("storedFileId") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE TRIGGER qc_attachments_immutable BEFORE UPDATE OR DELETE ON qc_attachments FOR EACH ROW EXECUTE FUNCTION qc_protect_history();
