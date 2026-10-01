import { DevicesService } from "./devices.service";

describe("RMM operational accuracy", () => {
  const create = (prisma = {}) => new DevicesService(prisma as never, {} as never, {} as never);
  const normalize = (record: Record<string, unknown>) => (create() as any).normalizeAgent({ agent_id: "synthetic", hostname: "test", ...record }, {});

  it("does not confuse inactive with active or agent version with OS version", () => {
    expect(normalize({ status: "inactive", version: "2.9" })).toMatchObject({ status: "INACTIVE", osVersion: null, detailSnapshot: { agent: { version: "2.9" } } });
    expect(normalize({ status: "online", online: false, os_version: "24H2", agent_version: "2.9" })).toMatchObject({ status: "INACTIVE", osVersion: "24H2", detailSnapshot: { agent: { version: "2.9" } } });
    expect(normalize({ status: " online " }).status).toBe("ACTIVE");
    expect(normalize({ online: true, status: "offline" }).status).toBe("ACTIVE");
  });

  it("runs when due despite future mailbox/report schedules, but yields to an active mailbox", async () => {
    const prisma = { mailbox: { count: jest.fn().mockResolvedValue(0) }, reportSchedule: { count: jest.fn().mockResolvedValue(1) } };
    const service = create(prisma) as any;
    const now = new Date("2026-10-01T15:00:00Z");
    expect(await service.shouldDeferRemoteAccessAutoSync("org", now)).toBe(false);
    expect(prisma.reportSchedule.count).not.toHaveBeenCalled();
    expect(prisma.mailbox.count.mock.calls[0][0].where).toMatchObject({autoSyncLockedAt:{gte:new Date("2026-10-01T14:50:00Z")}});
    prisma.mailbox.count.mockResolvedValue(1);
    expect(await service.shouldDeferRemoteAccessAutoSync("org", now)).toBe(true);
  });

  it("defaults to 30 minutes while preserving explicitly configured intervals", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-01T15:00:00Z"));
    try {
      const service = create() as any;
      expect(service.nextAutoSyncAt(null).toISOString()).toBe("2026-10-01T15:30:00.000Z");
      expect(service.nextAutoSyncAt(45).toISOString()).toBe("2026-10-01T15:45:00.000Z");
    } finally { jest.useRealTimers(); }
  });

  it("keeps rich hardware but refreshes network/agent values from list synchronization", () => {
    const service = create() as any;
    const incoming = normalize({local_ips:["10.2.0.9"], public_ip:"203.0.113.20", agent_version:"3.0"}).detailSnapshot;
    const old = {syncedAt:"2026-09-29T12:00:00Z", hardware:{memory:"16 GB"}, network:{localIps:["10.1.0.1"], publicIp:"203.0.113.1",macAddresses:["AA:BB"]}, agent:{version:"2.9", uptime:"old evidence"}};
    const merged = service.pickBestRemoteAccessDetailSnapshot(incoming, old);
    expect(merged).toMatchObject({syncedAt:old.syncedAt, hardware:old.hardware, network:{localIps:["10.2.0.9"],publicIp:"203.0.113.20",macAddresses:["AA:BB"]}, agent:{version:"3.0",uptime:"old evidence"}});
    expect(service.pickBestRemoteAccessDetailSnapshot(normalize({}).detailSnapshot, old).network).toEqual(old.network);
  });

  const scheduler = (claimCount = 1, mailboxCount = 0) => {
    const settings = {organizationId:"org",remoteAccessNextAutoSyncAt:new Date("2026-10-01T14:00:00Z"),remoteAccessAutoSyncIntervalMinutes:30};
    const prisma = {systemSetting:{findMany:jest.fn().mockResolvedValue([settings]), updateMany:jest.fn().mockResolvedValue({count:claimCount}), update:jest.fn().mockResolvedValue({})},mailbox:{count:jest.fn().mockResolvedValue(mailboxCount)}};
    const service = create(prisma) as any;
    const sync = jest.spyOn(service,"syncRemoteAccessForOrganization").mockResolvedValue({});
    return {service,prisma,sync};
  };
  it("atomically claims due work and does not run a lost claim", async () => {
    const {service,prisma,sync} = scheduler(0);
    await service.runDueRemoteAccessAutoSyncs();
    expect(sync).not.toHaveBeenCalled();
    expect(prisma.systemSetting.update).not.toHaveBeenCalled();
    expect(prisma.systemSetting.updateMany.mock.calls[0][0].where).toMatchObject({organizationId:"org",remoteAccessAutoSyncEnabled:true,remoteAccessProviderEnabled:true,OR:expect.any(Array)});
  });
  it("avoids overlapping scheduler scans while a sync is running", async () => {
    const {service,prisma,sync} = scheduler();
    let finish!: () => void;
    let started!: () => void;
    const didStart = new Promise<void>(resolve => { started = resolve; });
    sync.mockImplementation(() => { started(); return new Promise<void>(resolve => {finish = resolve;}); });
    const first = service.runDueRemoteAccessAutoSyncs();
    await didStart;
    await service.runDueRemoteAccessAutoSyncs();
    expect(prisma.systemSetting.findMany).toHaveBeenCalledTimes(1);
    finish(); await first;
    expect(service.autoSyncScanRunning).toBe(false);
  });
  it("postpones active mailbox work and releases its claim", async () => {
    const {service,prisma,sync} = scheduler(1,1);
    await service.runDueRemoteAccessAutoSyncs();
    expect(sync).not.toHaveBeenCalled();
    expect(prisma.systemSetting.update.mock.calls[0][0].data).toMatchObject({remoteAccessLastSyncStatus:"deferred", remoteAccessAutoSyncLockedAt:null});
    expect(service.autoSyncScanRunning).toBe(false);
  });
});
