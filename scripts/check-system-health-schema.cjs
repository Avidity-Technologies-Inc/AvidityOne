// Read-only deployment check: exercise the new history queries without reading tenant records.
const { PrismaClient } = require('@prisma/client');
const { SystemHealthService } = require('../apps/api/dist/modules/system-health/system-health.service.js');
const prisma = new PrismaClient();
(async () => {
  try {
    const health = new SystemHealthService(prisma, {});
    const emptyScope = '00000000-0000-0000-0000-000000000000';
    await health.getHistory(emptyScope, 'daily');
    await health.getTimeline(emptyScope, 'yearly');
    console.log('System Health schema and history queries verified.');
  } catch {
    console.error('System Health schema verification failed; inspect the migration before restarting.');
    process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
})();
