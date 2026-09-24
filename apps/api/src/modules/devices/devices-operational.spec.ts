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

  it("allows overdue inventory between mailbox runs but yields to a live mailbox lock", async () => {
    const prisma = { mailbox: { count: jest.fn().mockResolvedValue(0) }, reportSchedule: { count: jest.fn().mockResolvedValue(1) } };
    const service = create(prisma) as any;
    const now = new Date("2026-09-24T15:00:00Z");
    expect(await service.shouldDeferRemoteAccessAutoSync("org", now, new Date("2026-09-24T14:00:00Z"), 15)).toBe(false);
    prisma.mailbox.count.mockResolvedValue(1);
    expect(await service.shouldDeferRemoteAccessAutoSync("org", now, new Date("2026-09-24T14:00:00Z"), 15)).toBe(true);
    prisma.mailbox.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    expect(await service.shouldDeferRemoteAccessAutoSync("org", now, new Date("2026-09-24T14:50:00Z"), 15)).toBe(true);
  });
});
