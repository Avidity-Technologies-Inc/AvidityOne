"use client";

import { ArrowLeft, Cpu, ExternalLink, HardDrive, Laptop, Monitor, Network, RefreshCcw, Server, ShieldCheck, Smartphone, TerminalSquare } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

interface DeviceRecord {
  id: string;
  name: string;
  hostname: string | null;
  previousHostnames?: string[];
  deviceGroupId: string | null;
  type: string;
  operatingSystem: string | null;
  osVersion: string | null;
  serialNumber: string | null;
  assetTag: string | null;
  primaryUser: string | null;
  status: string;
  remoteAccessProvider: string | null;
  remoteAccessId: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  client: { id: string; name: string; shortName: string | null };
  actionUrls: {
    systemInfoUrl: string | null;
    controlUrl: string | null;
    remoteBackgroundUrl: string | null;
  };
  remoteAccessProfile: {
    id: string;
    provider: string;
    remoteIdentifier: string;
    connectionUrl: string | null;
    lastConnectionAttemptAt: string | null;
    detailSyncedAt: string | null;
  } | null;
  remoteAccessDetails: RemoteAccessDetails | null;
}

interface RemoteAccessDetails {
  syncedAt: string;
  hardware: {
    manufacturer: string | null;
    model: string | null;
    cpu: string | null;
    cpuCores: string | null;
    memory: string | null;
    video: string | null;
    serialNumber: string | null;
  };
  network: {
    publicIp: string | null;
    localIps: string[];
    macAddresses?: string[];
  };
  storage: {
    disks: Array<{
      name: string;
      fileSystem: string | null;
      totalBytes: number | null;
      freeBytes: number | null;
      usedPercent: number | null;
    }>;
  };
  agent: {
    version: string | null;
    bootTime: string | null;
    uptime: string | null;
    lastResponse: string | null;
    lastSeen: string | null;
    loggedInUser: string | null;
  };
  checks: {
    status: string | null;
    summary: string | null;
  };
}

interface DeviceDetailResponse {
  installations?: Array<{id:string;remoteIdentifier:string;state:string;hostname:string;serialNumber:string|null;hardwareUuid:string|null;lastSeenAt:string|null;present:boolean;reviewReason:string|null}>;
  device: DeviceRecord;
  remoteAccess: {
    enabled: boolean;
    providerName: string;
  };
}

export function DeviceDetailWorkspace({ deviceId }: { deviceId: string }) {
  const [data, setData] = useState<DeviceDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadDevice() {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<DeviceDetailResponse>(`/devices/${deviceId}`);
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load device.");
    } finally {
      setLoading(false);
    }
  }

  async function openRemote(mode: "control" | "background" | "system") {
    const device = data?.device;
    if (!device) return;
    const url = mode === "control" ? device.actionUrls.controlUrl : mode === "background" ? device.actionUrls.remoteBackgroundUrl : device.actionUrls.systemInfoUrl;
    if (!url) {
      setError(
        mode === "control"
          ? "This device does not have a remote control URL configured."
          : mode === "background"
            ? "This device does not have a remote background URL configured."
            : "This device does not have a system info URL configured."
      );
      return;
    }

    setBusy(mode);
    setError(null);
    try {
      if (mode === "control" || mode === "background") {
        const response = await apiFetch<{ connectionUrl: string | null }>(`/devices/${device.id}/remote-access/connection-attempts`, {
          method: "POST",
          body: JSON.stringify({ mode })
        });
        window.open(response.connectionUrl ?? url, "_blank", "noopener,noreferrer");
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open remote access.");
    } finally {
      setBusy(null);
    }
  }

  async function refreshRmmDetails() {
    const device = data?.device;
    if (!device) return;
    setBusy("details");
    setError(null);
    try {
      const response = await apiFetch<DeviceDetailResponse>(`/devices/${device.id}/rmm-details/refresh`, { method: "POST" });
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to refresh RMM details.");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void loadDevice();
  }, [deviceId]);

  const device = data?.device;
  const DeviceIcon = device ? getDeviceIcon(device) : Monitor;
  const OsIcon = getOsIcon(device?.operatingSystem);
  const deviceStatusClass = device ? getDeviceStatusClass(device.status) : "";

  return (
    <>
      <div className="compact-page-header device-detail-page-header">
        <div className="device-detail-page-heading">
          <Link className="device-detail-back-link" href="/devices">
            <ArrowLeft size={15} aria-hidden="true" />
            <span>Back to Devices</span>
          </Link>
          <h1>{device?.name ?? "Device"}</h1>
          <p className="muted">{device ? `${device.client.name} - ${device.deviceGroupId ?? "No site"}` : "Loading device detail..."}</p>
        </div>
        <div className="button-row device-detail-header-actions">
          <button className="button secondary" type="button" onClick={loadDevice} disabled={loading}>
            <RefreshCcw size={16} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {loading && !device ? (
        <section className="panel device-detail-loading">
          <p className="muted">Loading device detail...</p>
        </section>
      ) : null}

      {device ? (
        <section className="panel device-detail-panel">
          <div className="device-detail-hero">
            <span className={`device-type-icon large ${deviceStatusClass}`}><DeviceIcon size={28} aria-hidden="true" /></span>
            <div className="device-detail-hero-copy">
              <span className={`status-pill ${device.status === "ACTIVE" ? "success" : "muted"}`}>{device.status}</span>
              <h2>{device.name}</h2>
              <p className="muted">{device.hostname ?? "No hostname"} - {device.remoteAccessProvider ?? "Manual device"}</p>
            </div>
            <div className="device-detail-actions">
              <button className="button primary device-connect-button" type="button" onClick={() => openRemote("control")} disabled={busy === "control" || !device.actionUrls.controlUrl}>
                <ExternalLink size={16} aria-hidden="true" />
                <span>{busy === "control" ? "Opening..." : "Connect"}</span>
              </button>
              <button className="button secondary device-background-button" type="button" onClick={() => openRemote("background")} disabled={busy === "background" || !device.actionUrls.remoteBackgroundUrl}>
                <TerminalSquare size={16} aria-hidden="true" />
                <span>{busy === "background" ? "Opening..." : "Remote BG"}</span>
              </button>
              <button className="button secondary device-sysinfo-button" type="button" onClick={() => openRemote("system")} disabled={busy === "system" || !device.actionUrls.systemInfoUrl}>
                <HardDrive size={16} aria-hidden="true" />
                <span>SysInfo</span>
              </button>
              <button className="button secondary" type="button" onClick={refreshRmmDetails} disabled={busy === "details" || !device.remoteAccessProfile}>
                <RefreshCcw size={16} aria-hidden="true" />
                <span>{busy === "details" ? "Refreshing..." : "Refresh RMM Details"}</span>
              </button>
            </div>
          </div>

          <div className="device-detail-grid">
            <DetailItem label="Client" value={device.client.name} />
            <DetailItem label="Site" value={device.deviceGroupId ?? "-"} />
            <DetailItem label="Device type" value={formatEnum(device.type)} />
            <DetailItem label="Operating system" value={device.operatingSystem ?? "-"} icon={<OsIcon size={16} aria-hidden="true" />} />
            <DetailItem label="OS version" value={device.osVersion ?? "-"} />
            <DetailItem label="Primary user" value={device.primaryUser ?? "-"} />
            <DetailItem label="Serial number" value={device.serialNumber ?? "-"} />
            <DetailItem label="Asset tag" value={device.assetTag ?? "-"} />
            <DetailItem label="Last seen" value={formatDate(device.lastSeenAt)} />
            <DetailItem label="Last remote action" value={formatDate(device.remoteAccessProfile?.lastConnectionAttemptAt ?? null)} />
            <DetailItem label="Remote ID" value={device.remoteAccessId ?? device.remoteAccessProfile?.remoteIdentifier ?? "-"} />
            <DetailItem label="Updated" value={formatDate(device.updatedAt)} />
          </div>

          <details className="device-identity-case"><summary>Identity and installation history ({data?.installations?.length ?? 0})</summary>
            <p>Previous names: {device.previousHostnames?.join(", ") || "None recorded"}</p>
            <p className="muted">Only the current installation supplies the equipment name and remote actions. Historical installations are retained without deleting anything in Tactical.</p>
            {data?.installations?.map(row=><div className="device-identity-evidence" key={row.id}><strong>{row.state} · {row.hostname}</strong><code>{row.remoteIdentifier}</code><span>Serial: {row.serialNumber ?? "Not reported"} · Hardware UUID: {row.hardwareUuid ?? "Not reported"}</span><span>Last seen: {formatDate(row.lastSeenAt)} · {row.present ? "In last inventory" : "Absent from last inventory"}</span>{row.reviewReason && <span role="alert">{row.reviewReason}</span>}</div>)}
          </details>
          <RemoteAccessDetailsPanel details={device.remoteAccessDetails} detailSyncedAt={device.remoteAccessProfile?.detailSyncedAt ?? null} />
        </section>
      ) : null}
    </>
  );
}

function RemoteAccessDetailsPanel({ details, detailSyncedAt }: { details: RemoteAccessDetails | null; detailSyncedAt: string | null }) {
  if (!details) {
    return (
      <div className="device-detail-empty">
        <strong>Extended RMM details</strong>
        <span>Refresh RMM details to load hardware, network, storage, and agent information from Tactical RMM.</span>
      </div>
    );
  }

  const localIps = details.network.localIps ?? [];
  const macAddresses = details.network.macAddresses ?? [];

  return (
    <div className="device-detail-section-grid">
      <DetailSection title="Hardware" icon={<Cpu size={16} aria-hidden="true" />}>
        <DetailRow label="Manufacturer" value={details.hardware.manufacturer} />
        <DetailRow label="Model" value={details.hardware.model} />
        <DetailRow label="CPU" value={details.hardware.cpu} />
        <DetailRow label="CPU cores" value={details.hardware.cpuCores} />
        <DetailRow label="Memory" value={details.hardware.memory} />
        <DetailRow label="Video" value={details.hardware.video} />
        <DetailRow label="Serial" value={details.hardware.serialNumber} />
      </DetailSection>

      <DetailSection title="Network" icon={<Network size={16} aria-hidden="true" />}>
        <DetailRow label="Public IP" value={details.network.publicIp} />
        <div className="device-detail-list-row">
          <span>LAN IPs</span>
          <div className="device-chip-list">
            {localIps.length ? localIps.map((ip) => <span className="device-detail-chip" key={ip}>{ip}</span>) : <strong>-</strong>}
          </div>
        </div>
        <div className="device-detail-list-row">
          <span>MAC addresses</span>
          <div className="device-chip-list">
            {macAddresses.length ? macAddresses.map((mac) => <span className="device-detail-chip" key={mac}>{mac}</span>) : <strong>-</strong>}
          </div>
        </div>
      </DetailSection>

      <DetailSection title="Storage" icon={<HardDrive size={16} aria-hidden="true" />}>
        <StorageList disks={details.storage.disks} />
      </DetailSection>

      <DetailSection title="Agent and checks" icon={<ShieldCheck size={16} aria-hidden="true" />}>
        <DetailRow label="Agent version" value={details.agent.version} />
        <DetailRow label="Logged in user" value={details.agent.loggedInUser} />
        <DetailRow label="Last response" value={formatDetailDate(details.agent.lastResponse)} />
        <DetailRow label="Boot time" value={formatDetailDate(details.agent.bootTime)} />
        <DetailRow label="Uptime" value={details.agent.uptime} />
        <DetailRow label="Checks" value={details.checks.summary ?? details.checks.status} />
        <DetailRow label="Detail synced" value={formatDate(detailSyncedAt ?? details.syncedAt)} />
      </DetailSection>
    </div>
  );
}

function DetailSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="device-detail-section">
      <h3>{icon}{title}</h3>
      <div className="device-detail-list">{children}</div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="device-detail-list-row">
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}

function StorageList({ disks }: { disks: RemoteAccessDetails["storage"]["disks"] }) {
  if (!disks.length) {
    return <DetailRow label="Disks" value="-" />;
  }

  return (
    <div className="device-storage-list">
      {disks.map((disk) => {
        const capacityLabel =
          disk.freeBytes !== null && disk.totalBytes !== null
            ? `${formatBytes(disk.freeBytes)} free of ${formatBytes(disk.totalBytes)}`
            : disk.totalBytes !== null
              ? `${formatBytes(disk.totalBytes)} total`
              : null;
        const diskLabel = disk.fileSystem ? `${disk.name} (${disk.fileSystem})` : disk.name;
        return (
          <div className="device-storage-row" key={`${disk.name}-${disk.fileSystem ?? ""}`}>
            <div className="device-storage-header">
              <strong>{diskLabel}</strong>
            </div>
            {disk.usedPercent !== null ? (
              <div className="device-storage-bar" aria-label={`${disk.name} used ${disk.usedPercent}%`}>
                <span style={{ width: `${disk.usedPercent}%` }} />
              </div>
            ) : null}
            <span className="device-storage-capacity">{capacityLabel ?? "No capacity reported"}</span>
          </div>
        );
      })}
    </div>
  );
}

function DetailItem({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="device-detail-item">
      <span>{label}</span>
      <strong>{icon}{value}</strong>
    </div>
  );
}

function getDeviceIcon(device: DeviceRecord) {
  const source = `${device.type} ${device.name} ${device.operatingSystem ?? ""}`.toLowerCase();
  if (source.includes("server")) return Server;
  if (source.includes("laptop") || source.includes("notebook")) return Laptop;
  if (source.includes("tablet") || source.includes("ios") || source.includes("android")) return Smartphone;
  return Monitor;
}

function getOsIcon(os?: string | null) {
  const source = (os ?? "").toLowerCase();
  if (source.includes("linux") || source.includes("ubuntu") || source.includes("debian")) return TerminalSquare;
  if (source.includes("server")) return Server;
  return Monitor;
}

function getDeviceStatusClass(status: string) {
  if (status === "ACTIVE") return "active";
  if (status === "INACTIVE") return "inactive";
  return "retired";
}

function formatEnum(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "-";
}

function formatDetailDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
