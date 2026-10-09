import { compareHardware, extractHardwareIdentity, identityText, identityCandidate, identityMacs } from "./device-identity";
import { DevicesService } from "./devices.service";
import { DevicesController } from "./devices.controller";
import { REQUIRED_PERMISSIONS_KEY } from "../permissions/decorators/require-permissions.decorator";

describe("equipment hardware evidence",()=>{
  afterEach(()=>jest.restoreAllMocks());
  it.each([{unexpected:[]},{results:[{agent_id:"one"}],count:2},{results:[],next:"/agents/?page=2"}])("rejects incomplete inventories before reconciliation",async payload=>{
    jest.spyOn(global,"fetch").mockResolvedValue({ok:true,json:async()=>payload} as Response);
    const svc=new DevicesService({} as never,{} as never,{} as never) as any;
    await expect(svc.fetchAgents("https://rmm.example.test","/agents/","test-key")).rejects.toThrow("complete inventory");
  });
  it("blocks QC provider evidence when the current installation is disputed",async()=>{
    const prisma={device:{findFirst:jest.fn().mockResolvedValue({installations:[{reviewReason:"Hardware changed"}]})}};
    const svc=new DevicesService(prisma as never,{} as never,{} as never) as any;
    jest.spyOn(svc,"getSettingsRecord").mockResolvedValue({remoteAccessProviderEnabled:true});
    const provider=jest.spyOn(svc,"fetchAgentDetail");
    await expect(svc.qcObservation({organizationId:"org"},"device","check")).rejects.toThrow("Review the device identity");
    expect(provider).not.toHaveBeenCalled();
  });
  it("reads nested Tactical Windows hardware, not OS or disk serials",()=>{
    expect(extractHardwareIdentity({wmi_detail:{os:[[{SerialNumber:"OS-LICENSE"}]],disk:[[{SerialNumber:"DISK"}]],bios:[[{SerialNumber:"BOX-001"}]],comp_sys:[[{Manufacturer:"Vendor",Model:"Desktop"}]],comp_sys_prod:[[{UUID:"11111111-2222-3333-4444-555555555555"}]]}})).toEqual({serialNumber:"BOX-001",manufacturer:"VENDOR",model:"DESKTOP",hardwareUuid:"11111111-2222-3333-4444-555555555555"});
  });
  it("reads Apple serial without inventing a hardware UUID from the agent ID",()=>{
    expect(extractHardwareIdentity({agent_id:"11111111-2222-3333-4444-555555555555",wmi_detail:{serialnumber:"apple001",make_model:"Mac16,9\n"}})).toEqual({serialNumber:"APPLE001",model:"MAC16,9",manufacturer:"APPLE",hardwareUuid:null});
  });
  it.each(["", "Unknown", "To be filled by O.E.M.", "Default string", "000000", "123456789", "N/A"])("rejects unusable serial %s",value=>expect(identityText(value)).toBeNull());
  it("rejects absent UUIDs and generic VM identity as automatic matches",()=>{
    expect(extractHardwareIdentity({hardware_uuid:"00000000-0000-0000-0000-000000000000"}).hardwareUuid).toBeNull();
    const a={serialNumber:"BOX1",hardwareUuid:null,manufacturer:"VENDOR",model:"DESKTOP"};
    expect(compareHardware(a,a)).toBe("strong");
    expect(compareHardware(a,{...a,serialNumber:"BOX2"})).toBe("conflict");
    expect(compareHardware({...a,model:"VIRTUAL MACHINE"},{...a,model:"VIRTUAL MACHINE"})).toBe("unknown");
  });
  it("normalization retains real serial and UUID for the identity pipeline",()=>{
    const svc=new DevicesService({} as never,{} as never,{} as never) as any;
    const a=svc.normalizeAgent({agent_id:"agent",hostname:"new-name",wmi_detail:{bios:[[{SerialNumber:"SERIAL"}]],comp_sys_prod:[[{UUID:"11111111-2222-3333-4444-555555555555"}]]}},{});
    expect(a.serialNumber).toBe("SERIAL"); expect(a.detailSnapshot.hardware.hardwareUuid).toBe("11111111-2222-3333-4444-555555555555");
  });
  it("uses physical MACs for review only and excludes private/randomized addresses",()=>{
    const snapshot={detailSnapshot:{network:{macAddresses:["00:11:22:33:44:55","02:11:22:33:44:55","00:00:00:00:00:00"]}}};
    expect(identityMacs(snapshot)).toEqual(["001122334455"]);
    const a={serialNumber:null,hardwareUuid:null,manufacturer:null,model:null,hostname:"Before",snapshot};
    expect(identityCandidate(a,{...a,hostname:"After"})).toBe(true);
    expect(compareHardware(a,a)).toBe("unknown");
  });
  it("protects identity decisions with the existing RMM configuration permission",()=>{
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY,DevicesController.prototype.resolveIdentity)).toEqual(["remote_access.configure"]);
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY,DevicesController.prototype.reviewIdentity)).toEqual(["devices.view"]);
  });
});
