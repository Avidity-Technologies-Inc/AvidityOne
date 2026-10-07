// Verify additive QC fields without reading or changing tenant data.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const organizationId = '00000000-0000-0000-0000-000000000000';
    await prisma.qcReview.findMany({ where: { organizationId }, select: { id: true, draftSavedAt: true, failureConsequence: true }, take: 1 });
    await prisma.qcAction.findMany({ where: { organizationId }, select: { id: true, criterionId: true, findingId: true, finding: { select: { id: true } } }, take: 1 });
    console.log('QC draft, follow-up and finding schema verified.');
  } catch {
    console.error('QC schema verification failed; inspect migration status before restarting.');
    process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
})();
