// Read-only deployment gate: do not activate the API without its additive schema.
const {PrismaClient} = require('@prisma/client');
const db = new PrismaClient();
(async()=>{
  try {
    const organizationId='00000000-0000-0000-0000-000000000000';
    await db.deviceInstallation.findMany({where:{organizationId},take:1});
    await db.device.findMany({where:{client:{organizationId}},select:{previousHostnames:true},take:1});
    await db.systemSetting.findMany({where:{organizationId},select:{remoteAccessIdentityAutoLink:true,remoteAccessIdentityInactiveDays:true}});
    const indexes=await db.$queryRaw`SELECT indexname FROM pg_indexes WHERE schemaname=current_schema() AND indexname='device_installations_current_device_key'`;
    if(indexes.length!==1) throw new Error('Missing current-installation uniqueness constraint');
    console.log('Device identity schema and current-agent constraint verified.');
  } catch {
    console.error('Device identity schema is incomplete. Inspect migrations before starting services.');process.exitCode=1;
  } finally {await db.$disconnect();}
})();
