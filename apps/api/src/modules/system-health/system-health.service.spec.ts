import { SystemHealthService } from "./system-health.service";
import { rmmHealth, RmmHealthSettings } from "./rmm-health";
import { DevicesService } from "../devices/devices.service";

const now = new Date("2026-10-01T15:00:00Z");
const settings: RmmHealthSettings = {
  remoteAccessProviderEnabled: true, remoteAccessAutoSyncEnabled: true, remoteAccessAutoSyncIntervalMinutes: 30,
  remoteAccessLastSyncAt: new Date("2026-10-01T14:45:00Z"), remoteAccessLastSuccessAt: new Date("2026-10-01T14:45:00Z"),
  remoteAccessLastSyncStatus: "success", remoteAccessNextAutoSyncAt: new Date("2026-10-01T15:15:00Z"), remoteAccessAutoSyncLockedAt: null
};
const create = (prisma: unknown) => new SystemHealthService(prisma as never, {} as never);
describe("System Health evidence", () => {
  it.each([
    [{}, "ok", "current"],
    [{remoteAccessProviderEnabled:false},"disabled","disabled"],
    [{remoteAccessAutoSyncEnabled:false},"disabled","manual"],
    [{remoteAccessLastSyncStatus:"error"},"error","error"],
    [{remoteAccessLastSyncStatus:"deferred"},"warning","deferred"],
    [{remoteAccessLastSyncStatus:"warning"},"warning","warning"],
    [{remoteAccessLastSyncAt:null},"unknown","never"],
    [{remoteAccessNextAutoSyncAt:null},"warning","unscheduled"],
    [{remoteAccessNextAutoSyncAt:new Date("2026-10-01T14:00:00Z")},"warning","overdue"],
    [{remoteAccessLastSyncAt:new Date("2026-10-01T13:00:00Z"),remoteAccessLastSyncStatus:"deferred"},"warning","overdue"],
    [{remoteAccessAutoSyncLockedAt:new Date("2026-10-01T14:59:00Z")},"ok","running"],
    [{remoteAccessAutoSyncLockedAt:new Date("2026-10-01T14:00:00Z")},"warning","stalled"]
  ])("classifies RMM evidence %j", (override, status, state) => {
    expect(rmmHealth({...settings,...override},now)).toMatchObject({status,metadata:{state}});
  });
  it.each([
    [{pending:3,detailFailures:0}, "identity_review", "3 pending identity reviews"],
    [{pending:0,detailFailures:2}, "partial", "2 device detail failures"],
    [{pending:3,detailFailures:2}, "partial_identity_review", "2 device detail failures and 3 pending identity reviews"],
    [{pending:0,detailFailures:0}, "warning", "completed with warnings"],
    [{pending:-1,detailFailures:"2"}, "warning", "completed with warnings"],
    [null, "warning", "completed with warnings"]
  ])("explains the actual synchronization warning %j", (metadata, state, message) => {
    const result = rmmHealth({...settings,remoteAccessLastSyncStatus:"warning"}, now, {checkedAt:now,metadata});
    expect(result).toMatchObject({status:"warning",metadata:{state}});
    expect(result.message).toContain(message);
  });
  it("does not attribute a previous outcome to the latest attempt", () => {
    expect(rmmHealth({...settings,remoteAccessLastSyncStatus:"warning"}, now, {
      checkedAt:new Date("2026-10-01T14:00:00Z"),metadata:{pending:3,detailFailures:0}
    })).toMatchObject({metadata:{state:"warning"}});
  });
  it("prioritizes scheduler delays over identity review warnings", () => {
    expect(rmmHealth({...settings,remoteAccessLastSyncStatus:"warning",remoteAccessNextAutoSyncAt:new Date("2026-10-01T14:00:00Z")}, now, {
      checkedAt:now,metadata:{pending:3,detailFailures:0}
    })).toMatchObject({metadata:{state:"overdue"}});
  });
  it("reports low coverage instead of implying a full day of monitoring", async () => {
    const service = create({$queryRaw:jest.fn().mockResolvedValue([{component:"devices",bucket:1,status:"ok",count:1n}])});
    const timeline = await service.getTimeline("org","daily");
    expect(timeline.components.find(c=>c.key==="devices")).toMatchObject({healthyPercent:100,coveragePercent:4.2,unknownCount:23});
  });
  it("uses full filtered counts and server pagination scoped to organization", async () => {
    const prisma={systemHealthSnapshot:{groupBy:jest.fn().mockResolvedValue([{status:"ok",_count:{_all:701}}]),findMany:jest.fn().mockResolvedValue([])}};
    const result=await create(prisma).getHistory("org","yearly","2","devices","ok");
    expect(result).toMatchObject({total:701,totalPages:29,page:2,totals:{ok:701}});
    expect(prisma.systemHealthSnapshot.findMany.mock.calls[0][0]).toMatchObject({where:{organizationId:"org",component:"devices",status:"ok"},skip:25,take:25});
    expect(prisma.systemHealthSnapshot.groupBy.mock.calls[0][0].where.organizationId).toBe("org");
  });
  it("rejects inherited property names and invalid pagination", async () => {
    const service=create({});
    await expect(service.getHistory("org","constructor")).rejects.toThrow("Invalid health range");
    await expect(service.getHistory("org","daily","0")).rejects.toThrow("Invalid history page");
    await expect(service.getHistory("org","daily","1","toString")).rejects.toThrow("Invalid health component");
  });
  it("returns database failure even when recording the check fails", async () => {
    const service=create({$queryRawUnsafe:jest.fn().mockRejectedValue(Error("offline")),systemHealthSnapshot:{createMany:jest.fn().mockRejectedValue(Error("offline"))}});
    const result=await service.getSummary({organizationId:"org",permissions:["system_settings.view"]} as never,true);
    expect(result).toMatchObject({status:"error",recorded:false,recordingError:expect.any(String)});
  });
  it("checks every organization and continues after a failed organization",async()=>{
    const service=create({organization:{findMany:jest.fn().mockResolvedValue([{id:"a"},{id:"b"}])}}) as any;
    const check=jest.spyOn(service,"getSummaryForOrganization").mockRejectedValueOnce(Error("offline")).mockResolvedValueOnce({});
    await service.runAutomaticCheck();
    expect(check.mock.calls).toEqual([["a",true,"automatic"],["b",true,"automatic"]]);
  });
  it("redacts diagnostics from the general authenticated clock endpoint",async()=>{
    const service=create({}) as any;
    jest.spyOn(service,"getSummaryForOrganization").mockResolvedValue({components:[{key:"storage",name:"Storage",status:"ok",metadata:{path:"private"},message:"sensitive"}]});
    const result=await service.getSummary({organizationId:"a",permissions:[]});
    expect(result.components).toEqual([{key:"storage",name:"Storage",status:"ok"}]);
  });
  it("shows navigation only for the matching permissions",async()=>{
    const service=create({}) as any;
    jest.spyOn(service,"getSummaryForOrganization").mockResolvedValue({components:[]});
    expect((await service.getSummary({organizationId:"a",permissions:["system_settings.view"]})).links).toEqual({devices:false,rmm:false});
    expect((await service.getSummary({organizationId:"a",permissions:["system_settings.view","devices.view","remote_access.configure"]})).links).toEqual({devices:true,rmm:true});
  });
  it("does not fail an inventory update if monitoring persistence fails",async()=>{
    const service=new DevicesService({systemHealthSnapshot:{create:jest.fn().mockRejectedValue(Error("offline"))}} as never,{} as never,{} as never) as any;
    await expect(service.recordSyncHealth("org","rmm_auto","ok","Done",{total:3})).resolves.toBeUndefined();
  });
});
