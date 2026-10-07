-- Additive fields: published rubrics, finalized scores and audit history remain intact.
ALTER TABLE qc_reviews ADD COLUMN "draftSavedAt" TIMESTAMP(3), ADD COLUMN "failureConsequence" TEXT;
ALTER TABLE qc_actions ADD COLUMN "criterionId" TEXT, ADD COLUMN "findingId" UUID;
ALTER TABLE qc_actions ADD CONSTRAINT "qc_actions_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES qc_findings(id) ON DELETE RESTRICT ON UPDATE CASCADE;
