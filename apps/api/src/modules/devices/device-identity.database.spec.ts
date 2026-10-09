import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { DevicesService } from "./devices.service";
import { DeviceIdentityService } from "./device-identity.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { AuditLogsService } from "../audit-logs/audit-logs.service";
import { RemoteAccessService } from "../remote-access/remote-access.service";
const url=process.env.DEVICE_IDENTITY_TEST_DATABASE_URL;
(url ? describe : describe.skip)("equipment identity in disposable PostgreSQL",()=>{
  let db:PrismaService, service:DeviceIdentityService, user:AuthenticatedUser, clientId:string;
  const agent=(id:string,name="PC",extra:object={})=>(new DevicesService({} as never,{} as never,{} as never) as any).normalizeAgent({agent_id:id,hostname:name,client_name:"Synthetic",online:false,last_seen:"2026-01-01T00:00:00Z",serial_number:"SERIAL-01",manufacturer:"Vendor",model:"Model1",...extra},{});
  const ingest=(agents: ReturnType<typeof agent>[],auto=false)=>service.ingest({organizationId:user.organizationId,userId:user.id},agents.map(a=>({agent:a,clientId})),true,auto,7);
  const rows=()=>db.deviceInstallation.findMany({where:{organizationId:user.organizationId},orderBy:{remoteIdentifier:"asc"}});
  beforeAll(async()=>{
    const target=new URL(url!);if(target.hostname!=="127.0.0.1"||target.port!=="55474"||target.pathname!=="/device_identity")throw new Error("Dedicated synthetic database required");
    db=new PrismaService({datasources:{db:{url}}});await db.$connect();service=new DeviceIdentityService(db);
  });
  beforeEach(async()=>{
    const org=await db.organization.create({data:{name:`Identity ${randomUUID()}`}});
    user={...await db.user.create({data:{organizationId:org.id,email:`${randomUUID()}@example.invalid`,firstName:"Synthetic",lastName:"Reviewer",passwordHash:"unusable"}}),permissions:["devices.view","remote_access.configure"]};
    clientId=(await db.client.create({data:{organizationId:org.id,name:"Synthetic"}})).id;
  });
  afterAll(async()=>{await db?.$disconnect();});
  it("keeps two same-name agents pending instead of overwriting the current record",async()=>{
    await ingest([agent("new","PC",{last_seen:"2026-10-09T12:00:00Z"})]);
    await ingest([agent("old"),agent("new","PC",{last_seen:"2026-10-09T12:00:00Z"})]);
    const r=await rows();expect(r.map(x=>x.state)).toEqual(["CURRENT","PENDING"]);
    expect(await db.device.count({where:{clientId}})).toBe(1);
    expect((await service.summary(user.organizationId)).pendingReviews).toBe(1);
    const pending=r.find(x=>x.state==="PENDING")!;
    await service.resolve(user,pending.id,{action:"historical",deviceId:r[0].deviceId!,reason:"Verified serial and manufacturer"});
    await ingest([agent("old"),agent("new","Current name",{last_seen:"2026-10-10T12:00:00Z"})]);
    const d=await db.device.findUniqueOrThrow({where:{id:r[0].deviceId!}});
    expect(d.name).toBe("Current name");expect(d.previousHostnames).toContain("PC");expect(d.remoteAccessId).toBe("new");
    expect((await service.summary(user.organizationId)).historicalInstallations).toBe(1);
  });
  it("preserves existing device IDs and favorites during bootstrap",async()=>{
    const d=await db.device.create({data:{name:"Legacy",hostname:"PC",clientId,remoteAccessProvider:"TACTICAL_RMM",remoteAccessId:"current"}});
    await db.userDeviceFavorite.create({data:{deviceId:d.id,userId:user.id}});
    await ingest([agent("current")]);
    expect((await rows())[0].deviceId).toBe(d.id);expect(await db.device.count({where:{clientId}})).toBe(1);
    expect(await db.userDeviceFavorite.count({where:{deviceId:d.id}})).toBe(1);
  });
  it("links verified reinstallations only with opt-in and an inactive older installation",async()=>{
    await ingest([agent("old")]);
    await ingest([agent("old"),agent("new","Renamed",{last_seen:new Date().toISOString(),online:true})],true);
    const r=await rows();expect(r.find(x=>x.remoteIdentifier==="old")?.state).toBe("HISTORICAL");expect(r.find(x=>x.remoteIdentifier==="new")?.state).toBe("CURRENT");
    expect(await db.device.count({where:{clientId}})).toBe(1);
  });
  it("does not autolink two active agents or conflicting serial numbers",async()=>{
    await ingest([agent("old","PC",{online:true})]);
    await ingest([agent("old","PC",{online:true}),agent("new","PC",{online:true,last_seen:new Date().toISOString()})],true);
    expect((await rows()).find(x=>x.remoteIdentifier==="new")?.state).toBe("PENDING");
    await ingest([agent("other","PC",{serial_number:"OTHER"})],true);
    const r=await rows();const other=r.find(x=>x.remoteIdentifier==="other")!;
    await expect(service.resolve(user,other.id,{action:"current",deviceId:r.find(x=>x.state==="CURRENT")!.deviceId!,reason:"Not verified yet"})).rejects.toThrow("Conflicting");
  });
  it("requires explicit handling across clients and prevents cross-tenant review",async()=>{
    await ingest([agent("old")]);const current=(await rows())[0];
    const client2=await db.client.create({data:{organizationId:user.organizationId,name:"Other client"}});
    await service.ingest({organizationId:user.organizationId,userId:user.id},[{clientId:client2.id,agent:agent("new")}],false,true,7);
    const pending=(await rows()).find(r=>r.remoteIdentifier==="new")!;
    await expect(service.resolve(user,pending.id,{action:"historical",deviceId:current.deviceId!,reason:"Same hardware"})).rejects.toThrow("same client");
    await expect(service.resolve({...user,organizationId:randomUUID()},pending.id,{action:"separate",reason:"Separate equipment"})).rejects.toThrow("not found");
  });
  it("allows separate equipment after comparing an ambiguous hostname",async()=>{
    await ingest([agent("a")]);await ingest([agent("b","PC",{serial_number:"OTHER"})]);
    const pending=(await rows()).find(r=>r.state==="PENDING")!;
    await service.resolve(user,pending.id,{action:"separate",reason:"Different serial numbers"});
    expect(await db.device.count({where:{clientId}})).toBe(2);
  });
  it("is idempotent and serializes concurrent inventory runs",async()=>{
    await Promise.all([ingest([agent("a")]),ingest([agent("a")])]);
    expect(await db.device.count({where:{clientId}})).toBe(1);expect((await rows()).length).toBe(1);
  });
  it("preserves rich details through list observations and rejects stale renames",async()=>{
    await ingest([agent("a","PC",{last_seen:"2026-10-09T12:00:00Z",total_ram:"16 GB",local_ips:["10.0.0.1"]})]);
    await ingest([agent("a","PC",{last_seen:"2026-10-09T13:00:00Z",local_ips:["10.0.0.2"]})]);
    const r=(await rows())[0];const snap=(r.snapshot as any).detailSnapshot;
    expect(snap.hardware.memory).toBeTruthy();expect(snap.network.localIps).toEqual(["10.0.0.2"]);
    await ingest([agent("a","Stale",{last_seen:"2026-10-08T12:00:00Z"})]);
    expect((await db.device.findUniqueOrThrow({where:{id:r.deviceId!}})).hostname).toBe("PC");
  });
  it("records hardware conflicts without silently changing the equipment",async()=>{
    await ingest([agent("a")]);await ingest([agent("a","Changed",{serial_number:"OTHER",last_seen:new Date().toISOString()})]);
    const r=(await rows())[0];expect(r.reviewReason).toBeTruthy();
    expect((await db.device.findUniqueOrThrow({where:{id:r.deviceId!}})).serialNumber).toBe("SERIAL-01");
    await service.resolve(user,r.id,{action:"current",deviceId:r.deviceId!,reason:"Verified motherboard replacement"});
    expect((await db.device.findUniqueOrThrow({where:{id:r.deviceId!}})).serialNumber).toBe("OTHER");
    expect(await db.auditLog.count({where:{organizationId:user.organizationId,action:"device.identity_change_accepted"}})).toBe(1);
  });
  it("marks absent agents without deleting equipment or historical records",async()=>{
    await ingest([agent("a")]);await ingest([]);expect((await rows())[0].present).toBe(false);
    expect(await db.device.count({where:{clientId}})).toBe(1);
  });
  it("integrates sync, review counters, detail refresh and name history using the real services",async()=>{
    await db.systemSetting.create({data:{organizationId:user.organizationId,applicationName:"Synthetic",companyName:"Synthetic",supportEmail:"support@example.invalid",remoteAccessProviderEnabled:true,remoteAccessApiBaseUrl:"https://rmm.example.invalid",remoteAccessApiKeyReference:"env:SYNTHETIC",remoteAccessAgentsPath:"/agents/"}});
    const svc=new DevicesService(db,{get:()=>"synthetic-test-value"} as never,new AuditLogsService(db));
    let raw={agent_id:"current",hostname:"Original",client_name:"Synthetic",serial_number:"SN",manufacturer:"Vendor",model:"Desktop",last_seen:"2026-10-09T12:00:00Z"};
    jest.spyOn(svc as any,"fetchAgents").mockImplementation(async()=>[raw]);
    jest.spyOn(svc as any,"fetchAgentDetail").mockImplementation(async()=>raw);
    const sync=await svc.syncFromRemoteAccessProvider(user);expect(sync.created).toBe(1);expect(sync.total).toBe(1);
    let inventory=await svc.list(user,{});expect(inventory.identitySummary.observedAgents).toBe(1);
    const id=inventory.devices[0].id;
    raw={...raw,hostname:"Renamed",last_seen:"2026-10-09T13:00:00Z"};
    const result=await svc.refreshRemoteAccessDetails(user,id);
    expect(result.device.name).toBe("Renamed");expect(result.device.previousHostnames).toContain("Original");expect(result.installations[0].state).toBe("CURRENT");
    raw={...raw,serial_number:"CHANGED",last_seen:"2026-10-09T14:00:00Z"};await svc.syncFromRemoteAccessProvider(user);
    inventory=await svc.list(user,{});expect(inventory.identitySummary.pendingReviews).toBe(1);
    expect(inventory.devices[0].actionUrls).toEqual({systemInfoUrl:null,controlUrl:null,remoteBackgroundUrl:null});
    await expect(new RemoteAccessService(db,new AuditLogsService(db)).auditConnectionAttempt(id,user)).rejects.toThrow("Review this device identity");
  });
  it("accounts for 253 agents and 250 equipment records with three reviewed reinstallations",async()=>{
    const current=Array.from({length:250},(_,i)=>agent(`current-${i}`,`PC-${i}`,{serial_number:`SERIAL-${i}`,last_seen:"2026-10-09T12:00:00Z"}));
    await ingest(current);
    const historical=Array.from({length:3},(_,i)=>agent(`old-${i}`,`PC-${i}`,{serial_number:`SERIAL-${i}`}));
    await ingest([...historical,...current]);
    let summary=await service.summary(user.organizationId);expect(summary).toMatchObject({observedAgents:253,pendingReviews:3});
    for(const row of (await service.review(user)).items){
      expect(row.candidates).toHaveLength(1);expect(row.candidates[0].match).toBe("strong");
      await service.resolve(user,row.id,{action:"historical",deviceId:row.candidates[0].deviceId!,reason:"Synthetic hardware comparison verified"});
    }
    await ingest([...current,...historical]);
    summary=await service.summary(user.organizationId);
    expect(summary).toMatchObject({observedAgents:253,pendingReviews:0,historicalInstallations:3});
    expect(await db.device.count({where:{clientId}})).toBe(250);
    expect(await db.deviceInstallation.count({where:{organizationId:user.organizationId,state:"CURRENT"}})).toBe(250);
  },30000);
});
