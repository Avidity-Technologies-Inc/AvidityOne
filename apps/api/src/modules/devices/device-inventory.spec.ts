import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { InventoryDevice, inventoryMatches, selectInventory } from "./device-inventory";
import { DeviceQueryDto } from "./dto/device-query.dto";
import { DevicesService } from "./devices.service";

const user = { id: "reader", organizationId: "organization-a", permissions: ["devices.view"] };
function device(id: number, overrides: Partial<InventoryDevice> = {}): InventoryDevice {
  return { id: String(id), name: `PC${id}`, hostname: `host${id}`, deviceGroupId: "Main office", operatingSystem: "Windows 11",
    osVersion: "24H2", primaryUser: null, remoteAccessId: `rmm-${id}`, serialNumber: `serial-${id}`, assetTag: null,
    status: "ACTIVE", type: "DESKTOP", client: { name: "Client", shortName: "CL" }, favorites: [],
    remoteAccessProfile: { detailSnapshot: { network: { localIps: ["10.0.0.1", "192.168.40.156", "fe80::abcd"], publicIp: "203.0.113.9", macAddresses: ["AA:BB:CC:DD:EE:FF"] } } }, ...overrides };
}

describe("Device inventory search and ordering", () => {
  it.each(["192.168.40.156", "192.168.40.", "FE80::AB", "203.0.113.9", "aa:bb", "office", "serial-2", "24h2"])("matches stored inventory value %s", search => {
    expect(inventoryMatches(device(2), search)).toBe(true);
  });
  it("handles empty or missing network data and nonmatches", () => {
    expect(inventoryMatches(device(2, { remoteAccessProfile: null }), "192.168")).toBe(false);
    expect(inventoryMatches(device(2, { remoteAccessProfile: { detailSnapshot: { network: { localIps: null } } } }), "missing")).toBe(false);
  });
  it("orders names naturally in both directions without favorites overriding explicit choice", () => {
    const devices = [device(10, { favorites: [{ userId: "reader" }] }), device(2), device(1)];
    expect(selectInventory(devices, { sortBy: "name", favoritesFirst: "false" }).selected.map(d => d.name)).toEqual(["PC1", "PC2", "PC10"]);
    expect(selectInventory(devices, { sortBy: "name", favoritesFirst: "false", sortDirection: "desc" }).selected.map(d => d.name)).toEqual(["PC10", "PC2", "PC1"]);
    expect(selectInventory(devices, { sortBy: "name" }).selected[0].name).toBe("PC10");
  });
  it.each(["client", "site", "os", "status"] as const)("supports %s ordering and stable ties", sortBy => {
    const devices = [device(1, { client: {name: "Zulu", shortName: null}, deviceGroupId: "West", operatingSystem: "Windows", status: "RETIRED" }),
      device(2, { client: {name: "Alpha", shortName: null}, deviceGroupId: "East", operatingSystem: "Linux", status: "ACTIVE" })];
    expect(selectInventory(devices, { sortBy, favoritesFirst: "false" }).selected[0].id).toBe("2");
    expect(selectInventory(devices, { sortBy, sortDirection: "desc" }).selected[0].id).toBe("1");
  });
  it("keeps null OS last and tie order deterministic", () => {
    const items = [device(3, { operatingSystem: null }), device(2, { name: "same" }), device(1, { name: "same" })];
    expect(selectInventory(items, { sortBy: "os", sortDirection: "desc" }).selected.map(d => d.id)).toEqual(["1", "2", "3"]);
  });
  it("computes category counts across matching inventory before category selection", () => {
    const { selected, counts } = selectInventory([device(1), device(2, {type: "SERVER"}), device(3, {type: "OTHER", operatingSystem:"Debian 12"})], {deviceTab:"servers"});
    expect(counts).toEqual({ all:3, servers:2, workstations:1 });
    expect(selected).toHaveLength(2);
  });
  it("rejects invalid query controls instead of passing arbitrary ordering or limits", async () => {
    const invalid = plainToInstance(DeviceQueryDto, {sortBy:"password", page:"-1", pageSize:"100000", favoritesFirst:"anything"});
    expect((await validate(invalid)).map(error => error.property).sort()).toEqual(["favoritesFirst", "page", "pageSize", "sortBy"]);
    expect(await validate(plainToInstance(DeviceQueryDto, {page:"2", pageSize:"25", sortBy:"site"}))).toEqual([]);
  });
});

describe("DevicesService complete inventory pagination", () => {
  const setup = () => {
    const rows = Array.from({length: 525}, (_, index) => device(index + 1));
    const prisma = {
      deviceInstallation: {findMany:jest.fn().mockResolvedValue([])},
      device: { count: jest.fn().mockResolvedValue(rows.length), findMany: jest.fn().mockImplementation(async args => {
        if (args.distinct) return [{deviceGroupId:"Main office"}];
        if (args.include) return rows.filter(row => args.where.id.in.includes(row.id));
        return rows;
      }) }, client: {findMany:jest.fn().mockResolvedValue([])}
    };
    const service = new DevicesService(prisma as never, {} as never, {} as never);
    jest.spyOn(service as any, "getSettingsRecord").mockResolvedValue({});
    jest.spyOn(service as any, "toRmmSettingsResponse").mockReturnValue({});
    jest.spyOn(service as any, "toDeviceResponse").mockImplementation((row: unknown) => row);
    return {rows, prisma, service};
  };
  it("sorts beyond 500 before paging and hydrates only the requested page", async () => {
    const {service, prisma} = setup();
    const result = await service.list(user as never, {page: 21, pageSize:25, sortBy:"name", favoritesFirst:"false"});
    expect(result.filteredTotal).toBe(525);
    expect(result.devices).toHaveLength(25);
    expect(result.devices[0].id).toBe("501");
    expect(result.categoryCounts.workstations).toBe(525);
    expect(prisma.device.findMany.mock.calls.find(call => call[0].include)?.[0].where.id.in).toHaveLength(25);
    for (const [args] of prisma.device.findMany.mock.calls) {
      expect(args.where.client.organizationId).toBe("organization-a");
      expect(args.where.deletedAt).toBeNull();
      expect(args.take).toBeUndefined();
    }
  });
  it("searches a later interface beyond 500 and returns the matched address", async () => {
    const {service, rows} = setup();
    rows[524].remoteAccessProfile = {detailSnapshot:{network:{localIps:["10.1.0.1", "198.51.100.90"]}}};
    const result = await service.list(user as never, {search:"198.51.100.", page:9, pageSize:50});
    expect(result.page).toBe(1);
    expect(result.filteredTotal).toBe(1);
    expect(result.devices[0]).toMatchObject({id:"525", matchedNetwork:["198.51.100.90"]});
  });
  it("retains client/status/type/site and per-user favorite restrictions in the candidate query", async () => {
    const {service, prisma} = setup();
    await service.list(user as never, {clientId:"client-a", status:"ACTIVE", type:"SERVER", site:"Main office", favoritesOnly:"true", page:1});
    expect(prisma.device.findMany.mock.calls[0][0].where).toMatchObject({clientId:"client-a", status:"ACTIVE", type:"SERVER", deviceGroupId:"Main office", favorites:{some:{userId:"reader"}}});
    expect(prisma.device.findMany.mock.calls[0][0].select.favorites.where).toEqual({userId:"reader"});
  });
  it("preserves unpaged callers and handles empty results", async () => {
    const {service} = setup();
    expect((await service.list(user as never, {})).devices).toHaveLength(525);
    const empty = await service.list(user as never, {search:"no matching device", page:3});
    expect(empty).toMatchObject({devices:[], filteredTotal:0, page:1, totalPages:1});
  });
});
