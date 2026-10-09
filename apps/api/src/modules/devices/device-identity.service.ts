import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DeviceInstallation, Prisma, RemoteAccessProvider } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../auth/auth.types";
import { compareHardware, extractHardwareIdentity, identityCandidate, identityMacs } from "./device-identity";
import type { NormalizedRmmAgent } from "./devices.service";

type Entry = { agent: NormalizedRmmAgent; clientId: string };
type Context = { organizationId: string; userId: string | null };
type Tx = Prisma.TransactionClient;
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));
const payload = (row: DeviceInstallation) => row.snapshot as unknown as NormalizedRmmAgent;

@Injectable()
export class DeviceIdentityService {
  constructor(private readonly prisma: PrismaService) {}

  private async lock(tx: Tx, organizationId: string) {
    // Shared by sync and operator decisions; IDs and current-agent selection commit together.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`device-identity:${organizationId}`}))`;
  }

  private async audit(tx: Tx, context: Context, action: string, entityId: string, metadata: unknown) {
    await tx.auditLog.create({ data: { organizationId:context.organizationId, userId:context.userId, action, entityType: "Device", entityId, metadata: json(metadata) } });
  }

  async ingest(context: Context, entries: Entry[], completeInventory: boolean, autoLink: boolean, inactiveDays: number) {
    return this.prisma.$transaction(async tx => {
      await this.lock(tx, context.organizationId);
      const scope = { organizationId: context.organizationId, provider: RemoteAccessProvider.TACTICAL_RMM };
      const devices = await tx.device.findMany({ where: { deletedAt: null, client: { organizationId: context.organizationId }, remoteAccessProvider: "TACTICAL_RMM" }, include: { remoteAccessProfile: true } });
      const existing = await tx.deviceInstallation.findMany({ where: scope });
      const byRemote = new Map(existing.map(row => [row.remoteIdentifier, row]));
      const counts = new Map<string, number>();
      for (const d of devices) { const id = d.remoteAccessProfile?.remoteIdentifier ?? d.remoteAccessId; if (id) counts.set(id, (counts.get(id) ?? 0) + 1); }
      // Preserve legacy device IDs and their relations using exact provider IDs only.
      for (const d of devices) {
        const remoteIdentifier = d.remoteAccessProfile?.remoteIdentifier ?? d.remoteAccessId;
        if (!remoteIdentifier || byRemote.has(remoteIdentifier) || counts.get(remoteIdentifier) !== 1) continue;
        const identity = extractHardwareIdentity({ hardware: (d.remoteAccessProfile?.detailSnapshot as any)?.hardware, serialNumber: d.serialNumber });
        const row = await tx.deviceInstallation.create({ data: { ...scope, clientId: d.clientId, deviceId: d.id, remoteIdentifier,
          state: "CURRENT", hostname: d.hostname ?? d.name, ...identity, lastSeenAt: d.lastSeenAt, present: false,
          snapshot: json({ ...d, detailSnapshot: d.remoteAccessProfile?.detailSnapshot }) } });
        byRemote.set(remoteIdentifier, row);
      }
      if (completeInventory) await tx.deviceInstallation.updateMany({ where: scope, data: { present: false } });
      const now = new Date();
      for (const {agent, clientId} of entries) {
        const old = byRemote.get(agent.remoteIdentifier);
        const incomingIdentity = extractHardwareIdentity({ hardware: agent.detailSnapshot.hardware });
        const identity = {
          serialNumber: incomingIdentity.serialNumber ?? old?.serialNumber ?? null,
          hardwareUuid: incomingIdentity.hardwareUuid ?? old?.hardwareUuid ?? null,
          manufacturer: incomingIdentity.manufacturer ?? old?.manufacturer ?? null,
          model: incomingIdentity.model ?? old?.model ?? null
        };
        const conflict = old?.deviceId && (old.clientId !== clientId || compareHardware(identity, old) === "conflict");
        // A stale provider observation must not rename the current equipment backwards.
        const stale = old?.lastSeenAt && agent.lastSeenAt && new Date(agent.lastSeenAt) < old.lastSeenAt;
        const before = old && payload(old)?.detailSnapshot;
        const details = agent.detailSnapshot;
        const nonEmpty = (v: object) => Object.fromEntries(Object.entries(v).filter(([,x])=>x !== null && x !== "" && x !== undefined));
        const merged = before ? {...details,
          hardware:{...before.hardware,...nonEmpty(details.hardware)},
          network:{publicIp:details.network.publicIp ?? before.network?.publicIp ?? null,
            localIps:details.network.localIps.length ? details.network.localIps : before.network?.localIps ?? [],
            macAddresses:details.network.macAddresses.length ? details.network.macAddresses : before.network?.macAddresses ?? []},
          storage:details.storage.disks.length ? details.storage : before.storage,
          agent:{...before.agent,...nonEmpty(details.agent)}
        } : details;
        const data = { ...identity, clientId, hostname: agent.hostname ?? agent.name, lastSeenAt: agent.lastSeenAt ?? old?.lastSeenAt,
          snapshot: json({...agent,detailSnapshot:merged}), observedAt: now, present: true, reviewReason: conflict ? "Client or hardware changed on a linked agent. Review before updating equipment." : old?.reviewReason ?? null };
        const row = old
          ? await tx.deviceInstallation.update({ where: {id: old.id}, data: stale ? {present: true, observedAt: now} : data })
          : await tx.deviceInstallation.create({ data: {...scope, remoteIdentifier: agent.remoteIdentifier, ...data} });
        byRemote.set(agent.remoteIdentifier, row);
        if(conflict && !stale && !old?.reviewReason) await this.audit(tx,context,"device.identity_conflict",old!.deviceId!,{installationId:row.id,previous:{clientId:old!.clientId,serialNumber:old!.serialNumber,hardwareUuid:old!.hardwareUuid},observed:{clientId,...identity}});
      }
      let rows = await tx.deviceInstallation.findMany({ where: scope });
      const created = new Set<string>();
      // Process newer observations first so a legacy record cannot become the primary by list order.
      const pending = rows.filter(r => r.state === "PENDING" && r.present).sort((a,b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0));
      for (const row of pending) {
        const candidates = rows.filter(r => r.deviceId && r.state === "CURRENT" && identityCandidate(row, r));
        if (counts.get(row.remoteIdentifier)! > 1) {
          await tx.deviceInstallation.update({where:{id:row.id},data:{reviewReason:"Provider ID is already linked to multiple legacy devices. Manual repair required."}});
          continue;
        }
        if (!candidates.length && !row.reviewReason) {
          const d = await tx.device.create({ data: {clientId: row.clientId, name: row.hostname, hostname: row.hostname, remoteAccessProvider: "TACTICAL_RMM"} });
          row.deviceId = d.id; row.state = "CURRENT"; created.add(d.id);
          await tx.deviceInstallation.update({where:{id:row.id},data:{deviceId:d.id,state:"CURRENT"}});
          await this.audit(tx, context, "device.identity_created", d.id, {installationId: row.id});
        } else {
          const candidate = candidates.length === 1 ? candidates[0] : null;
          const candidateDevice = candidate && devices.find(d => d.id === candidate.deviceId);
          const strong = candidate && candidate.clientId === row.clientId && candidateDevice?.clientId === row.clientId && !candidate.reviewReason && compareHardware(row, candidate) === "strong";
          const currentTime = candidate?.lastSeenAt?.getTime();
          const incomingTime = row.lastSeenAt?.getTime();
          const older = currentTime && incomingTime ? Math.min(currentTime, incomingTime) : null;
          const inactive = older !== null && older < now.getTime() - inactiveDays * 86400000;
          const olderRow = currentTime && incomingTime && currentTime < incomingTime ? candidate : row;
          const olderOnline = olderRow && payload(olderRow)?.status === "ACTIVE";
          if (autoLink && strong && inactive && !olderOnline && currentTime !== incomingTime) {
            const replace = incomingTime! > currentTime!;
            if (replace) { candidate!.state = "HISTORICAL"; await tx.deviceInstallation.update({where:{id:candidate!.id},data:{state:"HISTORICAL"}}); }
            row.deviceId = candidate!.deviceId; row.state = replace ? "CURRENT" : "HISTORICAL"; row.reviewReason = null;
            await tx.deviceInstallation.update({where:{id:row.id},data:{deviceId:row.deviceId,state:row.state,reviewReason:null}});
            await this.audit(tx, context, "device.installation_auto_linked", row.deviceId!, {installationId:row.id, previousInstallationId:candidate!.id, state:row.state, evidence:"hardware", inactiveDays});
          } else {
            row.reviewReason = strong ? "Matching hardware. Review which installation is current." : "Possible equipment match or conflicting identity. Review required.";
            await tx.deviceInstallation.update({where:{id:row.id},data:{reviewReason:row.reviewReason}});
          }
        }
      }
      rows = await tx.deviceInstallation.findMany({where:scope});
      const updated = new Set<string>();
      for (const row of rows.filter(r => r.state === "CURRENT" && !r.reviewReason && entries.some(e => e.agent.remoteIdentifier === r.remoteIdentifier))) {
        if (await this.project(tx, context, row)) updated.add(row.deviceId!);
      }
      for (const id of created) updated.delete(id);
      return {created:created.size, updated:updated.size, agents:rows.filter(r=>r.present).length,
        historical:rows.filter(r=>r.state === "HISTORICAL").length, pending:rows.filter(r=>r.state === "PENDING" || r.reviewReason).length};
    }, {maxWait:10000, timeout:60000});
  }

  private async project(tx: Tx, context: Context, row: DeviceInstallation) {
    if (!row.deviceId) return false;
    const d = await tx.device.findFirst({where:{id:row.deviceId,deletedAt:null,clientId:row.clientId,client:{organizationId:context.organizationId}}});
    if (!d) return false;
    const a = payload(row);
    if (!a?.detailSnapshot) return false;
    const oldName = d.hostname ?? d.name;
    const changed = oldName !== row.hostname;
    await tx.device.update({where:{id:d.id},data:{name:row.hostname,hostname:row.hostname,
      previousHostnames: changed ? [...new Set([...d.previousHostnames,oldName])] : d.previousHostnames,
      deviceGroupId:a.siteName ?? null, type:a.type ?? d.type, operatingSystem:a.operatingSystem ?? d.operatingSystem,
      osVersion:a.osVersion ?? d.osVersion, serialNumber:row.serialNumber ?? d.serialNumber, assetTag:a.assetTag ?? d.assetTag,
      primaryUser:a.primaryUser ?? d.primaryUser,remoteAccessProvider:"TACTICAL_RMM",remoteAccessId:row.remoteIdentifier,
      lastSeenAt:row.lastSeenAt,status:a.status ?? d.status}});
    const profile = {provider:RemoteAccessProvider.TACTICAL_RMM,remoteIdentifier:row.remoteIdentifier,
      connectionUrl:a.controlUrl ?? a.systemInfoUrl ?? null,detailSnapshot:json(a.detailSnapshot),detailSyncedAt:new Date(a.detailSnapshot.syncedAt)};
    await tx.remoteAccessProfile.upsert({where:{deviceId:d.id},create:{deviceId:d.id,...profile},update:profile});
    if (changed) await this.audit(tx,context,"device.renamed",d.id,{from:oldName,to:row.hostname,installationId:row.id});
    return true;
  }

  async summary(organizationId: string) {
    const rows = await this.prisma.deviceInstallation.findMany({where:{organizationId},select:{state:true,present:true,reviewReason:true}});
    return {observedAgents:rows.filter(r=>r.present).length, historicalInstallations:rows.filter(r=>r.state === "HISTORICAL").length,
      pendingReviews:rows.filter(r=>r.state === "PENDING" || r.reviewReason).length, trackedInstallations:rows.length};
  }

  async review(user: AuthenticatedUser) {
    const rows = await this.prisma.deviceInstallation.findMany({where:{organizationId:user.organizationId},include:{client:{select:{id:true,name:true}},device:{select:{id:true,name:true,clientId:true,deletedAt:true}}},orderBy:{hostname:"asc"}});
    const safe = (r: typeof rows[number]) => { const {snapshot,...rest}=r; return {...rest,site:payload(r)?.siteName ?? null,status:payload(r)?.status ?? null, macAddresses:identityMacs(r.snapshot)}; };
    return {items:rows.filter(r=>r.state === "PENDING" || r.reviewReason).map(r=>({...safe(r),candidates:rows.filter(c=>c.state === "CURRENT" && c.device && !c.device.deletedAt && c.deviceId!==r.deviceId && identityCandidate(r,c)).map(c=>({...safe(c),match:compareHardware(r,c)}))}))};
  }

  async resolve(user: AuthenticatedUser, installationId: string, input: {action:"separate"|"historical"|"current";deviceId?:string;reason:string}) {
    return this.prisma.$transaction(async tx=>{
      await this.lock(tx,user.organizationId);
      const row = await tx.deviceInstallation.findFirst({where:{id:installationId,organizationId:user.organizationId}});
      if (!row) throw new NotFoundException("Installation not found.");
      if (input.reason.trim().length < 5) throw new BadRequestException("Explain the identity decision.");
      if (input.action !== "separate" && !input.deviceId) throw new BadRequestException("Choose the existing equipment record.");
      const context = {organizationId:user.organizationId,userId:user.id};
      if (row.state !== "PENDING") {
        const device = row.deviceId && await tx.device.findFirst({where:{id:row.deviceId,deletedAt:null,clientId:row.clientId,client:{organizationId:user.organizationId}}});
        if (row.state !== "CURRENT" || !row.reviewReason || input.action !== "current" || input.deviceId !== row.deviceId || !device) throw new BadRequestException("Already linked, or client transfer required. Refresh the queue and verify the client assignment.");
        const resolved = await tx.deviceInstallation.update({where:{id:row.id},data:{reviewReason:null}});
        await this.project(tx,context,resolved);
        await this.audit(tx,context,"device.identity_change_accepted",row.deviceId!,{installationId:row.id,reason:input.reason.trim(),previousSerial:device.serialNumber,observedSerial:row.serialNumber});
        return {deviceId:row.deviceId,state:row.state};
      }
      let deviceId: string;
      if(input.action === "separate") {
        const d = await tx.device.create({data:{clientId:row.clientId,name:row.hostname,hostname:row.hostname,remoteAccessProvider:"TACTICAL_RMM"}}); deviceId=d.id;
      } else {
        const d = await tx.device.findFirst({where:{id:input.deviceId ?? "",deletedAt:null,clientId:row.clientId,client:{organizationId:user.organizationId}}});
        if(!d) throw new BadRequestException("Choose an existing device in the same client. Client transfers are not automatic.");
        deviceId=d.id;
        const current = await tx.deviceInstallation.findFirst({where:{deviceId,state:"CURRENT",organizationId:user.organizationId}});
        if(!current || current.reviewReason || compareHardware(row,current) === "conflict") throw new BadRequestException("Conflicting hardware or missing current identity. Keep separate until the hardware is verified.");
        if(input.action === "current") await tx.deviceInstallation.update({where:{id:current.id},data:{state:"HISTORICAL"}});
      }
      const state=input.action === "historical" ? "HISTORICAL" : "CURRENT";
      const resolved=await tx.deviceInstallation.update({where:{id:row.id},data:{deviceId,state,reviewReason:null}});
      if(state === "CURRENT") await this.project(tx,context,resolved);
      await this.audit(tx,context,"device.installation_reviewed",deviceId,{installationId:row.id,action:input.action,reason:input.reason.trim()});
      return {deviceId,state};
    },{maxWait:10000,timeout:30000});
  }
}
