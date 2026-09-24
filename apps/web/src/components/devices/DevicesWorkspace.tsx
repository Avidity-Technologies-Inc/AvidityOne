"use client";

import {
  ChevronDown,
  ExternalLink,
  Grid3X3,
  HardDrive,
  Laptop,
  LayoutList,
  Monitor,
  MoreVertical,
  RefreshCcw,
  Save,
  Search,
  Server,
  ShieldCheck,
  Smartphone,
  Star,
  Table2,
  Trash2,
  TerminalSquare
} from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";

type DeviceView = "table" | "cards" | "tree";
type DeviceTab = "all" | "servers" | "workstations";

interface RemoteAccessDetails {
  network?: {
    publicIp?: string | null;
    localIps?: string[];
    macAddresses?: string[];
  };
}

interface DeviceRecord {
  id: string;
  name: string;
  hostname: string | null;
  deviceGroupId: string | null;
  type: string;
  operatingSystem: string | null;
  osVersion: string | null;
  primaryUser: string | null;
  status: string;
  remoteAccessProvider: string | null;
  remoteAccessId: string | null;
  isFavorite: boolean;
  lastSeenAt: string | null;
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
  } | null;
  remoteAccessDetails: RemoteAccessDetails | null;
}

interface DevicesResponse {
  devices: DeviceRecord[];
  totalDevices: number;
  clients: Array<{ id: string; name: string }>;
  remoteAccess: {
    enabled: boolean;
    providerName: string;
    lastSyncAt: string | null;
    lastSyncStatus: string | null;
    lastSyncMessage: string | null;
  };
}

interface DeviceSavedViewState {
  search?: string;
  clientId?: string;
  status?: string;
  type?: string;
  view?: DeviceView;
  deviceTab?: DeviceTab;
  pageSize?: number;
  cardColumns?: number;
}

interface DeviceSavedViewRecord {
  id: string;
  name: string;
  state: DeviceSavedViewState;
  scope: "PRIVATE" | "ADMINISTRATORS";
  isDefault: boolean;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100];
const CARD_COLUMN_OPTIONS = [2, 3, 4, 5, 6];

export function DevicesWorkspace() {
  const [data, setData] = useState<DevicesResponse | null>(null);
  const [search, setSearch] = useState("");
  const [clientId, setClientId] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [view, setView] = useState<DeviceView>("table");
  const [deviceTab, setDeviceTab] = useState<DeviceTab>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [cardColumns, setCardColumns] = useState(3);
  const [savedViews, setSavedViews] = useState<DeviceSavedViewRecord[]>([]);
  const [selectedViewId, setSelectedViewId] = useState("");
  const [viewName, setViewName] = useState("");
  const [viewScope, setViewScope] = useState<"PRIVATE" | "ADMINISTRATORS">("PRIVATE");
  const [viewIsDefault, setViewIsDefault] = useState(false);
  const [savedViewPanelOpen, setSavedViewPanelOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (clientId) params.set("clientId", clientId);
    if (status) params.set("status", status);
    if (type) params.set("type", type);
    const value = params.toString();
    return value ? `?${value}` : "";
  }, [clientId, search, status, type]);

  const devices = data?.devices ?? [];
  const activeDevices = useMemo(() => filterDevicesByTab(devices, deviceTab), [deviceTab, devices]);
  const deviceTabCounts = useMemo(() => getDeviceTabCounts(devices), [devices]);
  const totalPages = Math.max(1, Math.ceil(activeDevices.length / pageSize));
  const pageDevices = useMemo(() => activeDevices.slice((page - 1) * pageSize, page * pageSize), [activeDevices, page, pageSize]);
  const deviceGroups = useMemo(() => groupDevices(activeDevices), [activeDevices]);
  const totalDeviceCount = data?.totalDevices ?? devices.length;
  const lastSyncMessage = data?.remoteAccess.lastSyncMessage ?? "Never";

  async function loadDevices() {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<DevicesResponse>(`/devices${query}`);
      setData(response);
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load devices.");
    } finally {
      setLoading(false);
    }
  }

  async function loadSavedViews() {
    try {
      const response = await apiFetch<DeviceSavedViewRecord[]>("/devices/views");
      setSavedViews(response);
      const defaultView = response.find((item) => item.isDefault);
      if (defaultView && !selectedViewId && !["search", "clientId", "status", "type", "deviceTab"].some((key) => new URLSearchParams(window.location.search).has(key))) {
        applySavedView(defaultView);
      }
    } catch {
      setSavedViews([]);
    }
  }

  async function syncDevices() {
    setBusy("sync");
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch<{ total: number; created: number; updated: number; settings?: DevicesResponse["remoteAccess"] }>("/devices/rmm-sync", { method: "POST" });
      setNotice(response.settings?.lastSyncMessage ?? `Synced ${response.total} device${response.total === 1 ? "" : "s"} (${response.created} created, ${response.updated} updated).`);
      await loadDevices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sync RMM devices.");
    } finally {
      setBusy(null);
    }
  }

  async function saveCurrentView() {
    const name = viewName.trim();
    if (!name) {
      setError("Enter a saved view name before saving.");
      return;
    }
    setBusy("view");
    setError(null);
    setNotice(null);
    const body = {
      name,
      state: { search, clientId, status, type, view, deviceTab, pageSize, cardColumns },
      scope: viewScope,
      isDefault: viewIsDefault
    };
    try {
      if (selectedViewId) {
        await apiFetch(`/devices/views/${selectedViewId}`, {
          method: "PATCH",
          body: JSON.stringify(body)
        });
      } else {
        await apiFetch("/devices/views", {
          method: "POST",
          body: JSON.stringify(body)
        });
      }
      setNotice(`Saved device view "${name}".`);
      await loadSavedViews();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save device view.");
    } finally {
      setBusy(null);
    }
  }

  async function deleteCurrentView() {
    if (!selectedViewId) return;
    const current = savedViews.find((item) => item.id === selectedViewId);
    if (!current || !window.confirm(`Delete saved view "${current.name}"?`)) return;
    setBusy("view");
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/devices/views/${selectedViewId}`, { method: "DELETE" });
      setSelectedViewId("");
      setViewName("");
      setNotice(`Deleted device view "${current.name}".`);
      await loadSavedViews();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete device view.");
    } finally {
      setBusy(null);
    }
  }

  async function toggleFavorite(device: DeviceRecord) {
    const nextValue = !device.isFavorite;
    setBusy(`favorite:${device.id}`);
    setError(null);
    try {
      await apiFetch(`/devices/${device.id}/favorite`, { method: nextValue ? "PUT" : "DELETE" });
      setData((current) => {
        if (!current) return current;
        const nextDevices = current.devices
          .map((item) => (item.id === device.id ? { ...item, isFavorite: nextValue } : item))
          .sort((left, right) => Number(right.isFavorite) - Number(left.isFavorite));
        return { ...current, devices: nextDevices };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update device favorite.");
    } finally {
      setBusy(null);
    }
  }

  async function openRemote(device: DeviceRecord, mode: "control" | "background" | "system") {
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

    setBusy(`${mode}:${device.id}`);
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

  function toggleGroup(key: string) {
    setExpandedGroups((current) => ({ ...current, [key]: !(current[key] ?? true) }));
  }

  function selectSavedView(viewId: string) {
    setSelectedViewId(viewId);
    const savedView = savedViews.find((item) => item.id === viewId);
    if (!savedView) {
      setViewName("");
      setViewScope("PRIVATE");
      setViewIsDefault(false);
      return;
    }
    setViewName(savedView.name);
    setViewScope(savedView.scope);
    setViewIsDefault(savedView.isDefault);
  }

  function applySavedView(savedView: DeviceSavedViewRecord) {
    const state = savedView.state ?? {};
    setSearch(state.search ?? "");
    setClientId(state.clientId ?? "");
    setStatus(state.status ?? "");
    const nextDeviceTab = state.deviceTab === "servers" || state.deviceTab === "workstations" ? state.deviceTab : "all";
    setType(nextDeviceTab === "all" ? (state.type ?? "") : "");
    setDeviceTab(nextDeviceTab);
    if (state.view === "table" || state.view === "cards" || state.view === "tree") {
      setView(state.view);
    }
    if (typeof state.pageSize === "number" && PAGE_SIZE_OPTIONS.includes(state.pageSize)) {
      setPageSize(state.pageSize);
    }
    if (typeof state.cardColumns === "number" && CARD_COLUMN_OPTIONS.includes(state.cardColumns)) {
      setCardColumns(state.cardColumns);
    }
    setSelectedViewId(savedView.id);
    setViewName(savedView.name);
    setViewScope(savedView.scope);
    setViewIsDefault(savedView.isDefault);
    setPage(1);
  }

  function selectDeviceTab(nextTab: DeviceTab) {
    setDeviceTab(nextTab);
    if (nextTab !== "all") setType("");
    setPage(1);
  }

  useEffect(() => {
    void loadDevices();
  }, [query]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSearch(params.get("search") ?? "");
    setClientId(params.get("clientId") ?? "");
    const initialStatus = params.get("status");
    if (["ACTIVE", "INACTIVE", "RETIRED"].includes(initialStatus ?? "")) setStatus(initialStatus!);
    const initialTab = params.get("deviceTab");
    if (initialTab === "servers" || initialTab === "workstations") setDeviceTab(initialTab);
    void loadSavedViews();
  }, []);

  return (
    <>
      <div className="compact-page-header device-page-header">
        <div className="device-page-heading">
          <div className="device-page-title-block">
            <span className="device-page-eyebrow">RMM Inventory</span>
            <h1>Devices</h1>
          </div>
          <div className="device-header-summary" aria-label="Device inventory summary">
            <span><strong>Devices:</strong> {totalDeviceCount}</span>
            <span><strong>Devices in this view:</strong> {loading ? "Loading..." : activeDevices.length}</span>
            <span><strong>Inventory status:</strong> {data?.remoteAccess.lastSyncStatus ?? "Not checked"} · Last sync attempt: {data?.remoteAccess.lastSyncAt ? new Date(data.remoteAccess.lastSyncAt).toLocaleString() : "No recorded sync"}</span><span className="muted">{lastSyncMessage} Device status reflects the last observation, not a live availability check.</span>
          </div>
        </div>
        <div className="button-row device-header-actions">
          <span className={`status-pill device-rmm-pill ${data?.remoteAccess.enabled ? "success" : "muted"}`}>
            <ShieldCheck size={14} aria-hidden="true" />
            {data?.remoteAccess.enabled ? data.remoteAccess.providerName : "RMM disabled"}
          </span>
          <button className="button secondary" type="button" onClick={loadDevices} disabled={loading}>
            <RefreshCcw size={16} aria-hidden="true" />
            <span>Refresh</span>
          </button>
          <button className="button primary" type="button" onClick={syncDevices} disabled={Boolean(busy) || !data?.remoteAccess.enabled}>
            <Monitor size={16} aria-hidden="true" />
            <span>{busy === "sync" ? "Syncing..." : "Sync RMM"}</span>
          </button>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}

      <section className={`panel device-toolbar-panel ${view === "cards" ? "has-card-columns" : ""}`}>
        <div className="device-search-field">
          <Search size={16} aria-hidden="true" />
          <input className="input" placeholder="Search device, hostname, client, OS, or user" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <select className="input" value={clientId} onChange={(event) => setClientId(event.target.value)}>
          <option value="">All clients</option>
          {data?.clients.map((client) => (
            <option key={client.id} value={client.id}>{client.name}</option>
          ))}
        </select>
        <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="RETIRED">Retired</option>
        </select>
        <select className="input" value={type} onChange={(event) => { setType(event.target.value); setDeviceTab("all"); setPage(1); }}>
          <option value="">All types</option>
          <option value="SERVER">Servers</option>
          <option value="DESKTOP">Desktops</option>
          <option value="LAPTOP">Laptops</option>
          <option value="PHONE">Phones</option>
          <option value="TABLET">Tablets</option>
          <option value="OTHER">Other</option>
        </select>
        <div className="segmented-control device-view-toggle" aria-label="Device view">
          <button type="button" className={view === "table" ? "active" : ""} onClick={() => setView("table")} title="Table view">
            <Table2 size={16} aria-hidden="true" />
            <span>Table</span>
          </button>
          <button type="button" className={view === "cards" ? "active" : ""} onClick={() => setView("cards")} title="Card view">
            <Grid3X3 size={16} aria-hidden="true" />
            <span>Cards</span>
          </button>
          <button type="button" className={view === "tree" ? "active" : ""} onClick={() => setView("tree")} title="Tree view">
            <LayoutList size={16} aria-hidden="true" />
            <span>Tree</span>
          </button>
        </div>
        {view === "cards" ? (
          <select className="input compact-select device-card-column-select" value={cardColumns} onChange={(event) => setCardColumns(Number(event.target.value))} aria-label="Card columns">
            {CARD_COLUMN_OPTIONS.map((columns) => (
              <option key={columns} value={columns}>{columns} columns</option>
            ))}
          </select>
        ) : null}
        <button
          className={`button icon-button device-view-menu-button ${savedViewPanelOpen ? "active" : ""}`}
          type="button"
          onClick={() => setSavedViewPanelOpen((current) => !current)}
          title="Saved views"
          aria-label="Saved views"
          aria-expanded={savedViewPanelOpen}
        >
          <MoreVertical size={18} aria-hidden="true" />
        </button>
      </section>

      {savedViewPanelOpen ? (
        <section className="panel device-saved-view-panel">
          <select className="input" value={selectedViewId} onChange={(event) => selectSavedView(event.target.value)}>
            <option value="">Saved views</option>
            {savedViews.map((savedView) => (
              <option key={savedView.id} value={savedView.id}>
                {savedView.name}{savedView.scope === "ADMINISTRATORS" ? " (Admins)" : ""}{savedView.isDefault ? " - Default" : ""}
              </option>
            ))}
          </select>
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              const savedView = savedViews.find((item) => item.id === selectedViewId);
              if (savedView) applySavedView(savedView);
            }}
            disabled={!selectedViewId}
          >
            Apply View
          </button>
          <input className="input" placeholder="View name" value={viewName} onChange={(event) => setViewName(event.target.value)} />
          <select className="input" value={viewScope} onChange={(event) => setViewScope(event.target.value as "PRIVATE" | "ADMINISTRATORS")}>
            <option value="PRIVATE">Private</option>
            <option value="ADMINISTRATORS">Administrators</option>
          </select>
          <label className="device-default-view-toggle">
            <input type="checkbox" checked={viewIsDefault} onChange={(event) => setViewIsDefault(event.target.checked)} />
            <span>Default</span>
          </label>
          <button className="button primary" type="button" onClick={saveCurrentView} disabled={busy === "view"}>
            <Save size={16} aria-hidden="true" />
            <span>{selectedViewId ? "Update View" : "Save View"}</span>
          </button>
          <button className="button secondary danger-soft" type="button" onClick={deleteCurrentView} disabled={!selectedViewId || busy === "view"}>
            <Trash2 size={16} aria-hidden="true" />
            <span>Delete</span>
          </button>
        </section>
      ) : null}

      <section className="panel device-results-panel">
        {loading && activeDevices.length === 0 ? (
          <div className="empty-state device-empty-state">
            <h3>Loading devices...</h3>
            <p className="muted">Refreshing the RMM inventory view.</p>
          </div>
        ) : null}

        {!loading && activeDevices.length === 0 ? (
          <div className="empty-state device-empty-state">
            <h3>No devices found</h3>
            <p className="muted">
              {devices.length === 0
                ? "Configure RMM Integration in Settings, then run a manual sync to populate the inventory."
                : "No devices match this category. Try another tab or adjust the filters."}
            </p>
          </div>
        ) : null}

        {activeDevices.length > 0 && view !== "tree" ? (
          <DevicePagination
            page={page}
            totalPages={totalPages}
            pageSize={pageSize}
            total={activeDevices.length}
            tabs={<DeviceCategoryTabs activeTab={deviceTab} counts={deviceTabCounts} onChange={selectDeviceTab} />}
            onPageChange={setPage}
            onPageSizeChange={(nextSize) => { setPageSize(nextSize); setPage(1); }}
          />
        ) : activeDevices.length > 0 ? (
          <div className="device-tree-tab-row">
            <DeviceCategoryTabs activeTab={deviceTab} counts={deviceTabCounts} onChange={selectDeviceTab} />
          </div>
        ) : null}

        {view === "table" && pageDevices.length > 0 ? (
          <div className="device-table-wrapper device-table-shell">
            <table className="device-table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Client / Site</th>
                  <th>OS</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pageDevices.map((device) => (
                  <DeviceTableRow key={device.id} device={device} busy={busy} onFavorite={toggleFavorite} onOpenRemote={openRemote} />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {view === "cards" && pageDevices.length > 0 ? (
          <div className="device-card-grid" style={{ "--device-card-columns": cardColumns } as CSSProperties}>
            {pageDevices.map((device) => (
              <DeviceCard key={device.id} device={device} busy={busy} onFavorite={toggleFavorite} onOpenRemote={openRemote} />
            ))}
          </div>
        ) : null}

        {view === "tree" && activeDevices.length > 0 ? (
          <div className="device-tree-list">
            {deviceGroups.map((clientGroup) => (
              <div className="device-tree-client" key={clientGroup.key}>
                <button type="button" className="device-tree-toggle" onClick={() => toggleGroup(clientGroup.key)}>
                  <ChevronDown size={16} aria-hidden="true" className={expandedGroups[clientGroup.key] === false ? "collapsed" : ""} />
                  <strong>{clientGroup.name}</strong>
                  <span>{clientGroup.count} devices</span>
                </button>
                {expandedGroups[clientGroup.key] === false ? null : (
                  <div className="device-tree-sites">
                    {clientGroup.sites.map((site) => (
                      <div className="device-tree-site" key={site.key}>
                        <div className="device-tree-site-title">
                          <span>{site.name}</span>
                          <small>{site.devices.length} devices</small>
                        </div>
                        <div className="device-tree-devices">
                          {site.devices.map((device) => (
                            <DeviceTreeRow key={device.id} device={device} busy={busy} onFavorite={toggleFavorite} onOpenRemote={openRemote} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}

function DeviceTableRow({
  device,
  busy,
  onFavorite,
  onOpenRemote
}: {
  device: DeviceRecord;
  busy: string | null;
  onFavorite: (device: DeviceRecord) => void;
  onOpenRemote: (device: DeviceRecord, mode: "control" | "background" | "system") => void;
}) {
  const DeviceIcon = getDeviceIcon(device);
  const OsIcon = getOsIcon(device.operatingSystem);
  const statusClass = getDeviceStatusClass(device);
  const network = getDeviceNetworkInfo(device);
  return (
    <tr>
      <td className="device-table-device-cell">
        <div className="device-name-cell">
          <FavoriteButton device={device} busy={busy} onFavorite={onFavorite} />
          <span className={`device-type-icon ${statusClass}`}><DeviceIcon size={18} aria-hidden="true" /></span>
          <div>
            <div className="device-title-row">
              <Link href={`/devices/${device.id}`}><strong>{device.name}</strong></Link>
            </div>
            <span>{device.hostname ?? device.remoteAccessId ?? device.type}</span>
          </div>
        </div>
      </td>
      <td>
        <strong>{device.client.name}</strong>
        <span>{device.deviceGroupId ?? "No site"}</span>
      </td>
      <td className="device-table-os-cell">
        <div className="device-os-cell">
          <OsIcon size={16} aria-hidden="true" />
          <div>
            <strong>{device.operatingSystem ?? "Unknown"}</strong>
            <span className="device-os-meta">
              {device.osVersion ? <span>Agent {device.osVersion}</span> : null}
              {network.localIp ? <span>IP {network.localIp}</span> : null}
              {network.macAddress ? <span>MAC {network.macAddress}</span> : null}
              {!device.osVersion && !network.localIp && !network.macAddress ? <span>{device.primaryUser ?? "-"}</span> : null}
            </span>
          </div>
        </div>
      </td>
      <td><span className={`status-pill ${device.status === "ACTIVE" ? "success" : "muted"}`}>{device.status}</span></td>
      <td className="device-table-action-cell">
        <DeviceActions device={device} busy={busy} onOpenRemote={onOpenRemote} />
      </td>
    </tr>
  );
}

function DeviceCard({
  device,
  busy,
  onFavorite,
  onOpenRemote
}: {
  device: DeviceRecord;
  busy: string | null;
  onFavorite: (device: DeviceRecord) => void;
  onOpenRemote: (device: DeviceRecord, mode: "control" | "background" | "system") => void;
}) {
  const DeviceIcon = getDeviceIcon(device);
  const OsIcon = getOsIcon(device.operatingSystem);
  const statusClass = getDeviceStatusClass(device);
  const network = getDeviceNetworkInfo(device);
  return (
    <article className={`device-card ${statusClass}`}>
      <div className="device-card-header">
        <span className={`device-type-icon large ${statusClass}`}><DeviceIcon size={22} aria-hidden="true" /></span>
        <div>
          <div className="device-title-row">
            <Link href={`/devices/${device.id}`}><h3>{device.name}</h3></Link>
            <FavoriteButton device={device} busy={busy} onFavorite={onFavorite} />
          </div>
          <p>{device.client.name} - {device.deviceGroupId ?? "No site"}</p>
          <p className="device-card-hostname">{device.hostname ?? device.remoteAccessId ?? device.type}</p>
        </div>
        <span className={`status-pill ${device.status === "ACTIVE" ? "success" : "muted"}`}>{device.status}</span>
      </div>
      <div className="device-card-meta">
        <div>
          <span>OS</span>
          <strong><OsIcon size={15} aria-hidden="true" /> {device.operatingSystem ?? "Unknown"}</strong>
        </div>
        <div>
          <span>Last seen</span>
          <strong>{formatDate(device.lastSeenAt)}</strong>
        </div>
        <div>
          <span>IP / MAC</span>
          <strong className="device-card-network-value">{formatNetworkSummary(network)}</strong>
        </div>
      </div>
      <DeviceActions device={device} busy={busy} onOpenRemote={onOpenRemote} />
    </article>
  );
}

function DeviceTreeRow({
  device,
  busy,
  onFavorite,
  onOpenRemote
}: {
  device: DeviceRecord;
  busy: string | null;
  onFavorite: (device: DeviceRecord) => void;
  onOpenRemote: (device: DeviceRecord, mode: "control" | "background" | "system") => void;
}) {
  const DeviceIcon = getDeviceIcon(device);
  const statusClass = getDeviceStatusClass(device);
  const network = getDeviceNetworkInfo(device);
  return (
    <div className="device-tree-row">
      <span className={`device-type-icon ${statusClass}`}><DeviceIcon size={17} aria-hidden="true" /></span>
      <div className="device-title-row">
        <div className="device-tree-title-stack">
          <Link href={`/devices/${device.id}`}><strong>{device.name}</strong></Link>
          <span>{device.hostname ?? device.remoteAccessId ?? device.type}</span>
        </div>
        <FavoriteButton device={device} busy={busy} onFavorite={onFavorite} />
      </div>
      <div className="device-tree-network">
        <strong>{network.localIp ?? "-"}</strong>
        <span>{network.macAddress ?? "-"}</span>
      </div>
      <span>{device.operatingSystem ?? "Unknown OS"}</span>
      <span className={`status-pill ${device.status === "ACTIVE" ? "success" : "muted"}`}>{device.status}</span>
      <DeviceActions device={device} busy={busy} onOpenRemote={onOpenRemote} />
    </div>
  );
}

function FavoriteButton({ device, busy, onFavorite }: { device: DeviceRecord; busy: string | null; onFavorite: (device: DeviceRecord) => void }) {
  return (
    <button
      className={`device-favorite-button ${device.isFavorite ? "active" : ""}`}
      type="button"
      title={device.isFavorite ? "Remove favorite" : "Mark as favorite"}
      aria-label={device.isFavorite ? `Remove ${device.name} from favorites` : `Mark ${device.name} as favorite`}
      onClick={() => onFavorite(device)}
      disabled={busy === `favorite:${device.id}`}
    >
      <Star size={15} aria-hidden="true" />
    </button>
  );
}

function DeviceActions({ device, busy, onOpenRemote }: { device: DeviceRecord; busy: string | null; onOpenRemote: (device: DeviceRecord, mode: "control" | "background" | "system") => void }) {
  return (
    <div className="device-action-row">
      <button className="button primary compact device-connect-button" type="button" onClick={() => onOpenRemote(device, "control")} disabled={busy === `control:${device.id}` || !device.actionUrls.controlUrl} title="Open remote control" aria-label={`Open remote control for ${device.name}`}>
        <ExternalLink size={14} aria-hidden="true" />
        <span>Connect</span>
      </button>
      <button className="button secondary compact device-background-button" type="button" onClick={() => onOpenRemote(device, "background")} disabled={busy === `background:${device.id}` || !device.actionUrls.remoteBackgroundUrl} title="Open remote background" aria-label={`Open remote background for ${device.name}`}>
        <TerminalSquare size={14} aria-hidden="true" />
        <span>Remote BG</span>
      </button>
      <button className="button secondary compact device-sysinfo-button" type="button" onClick={() => onOpenRemote(device, "system")} disabled={busy === `system:${device.id}` || !device.actionUrls.systemInfoUrl} title="Open system information" aria-label={`Open system information for ${device.name}`}>
        <HardDrive size={14} aria-hidden="true" />
        <span>SysInfo</span>
      </button>
    </div>
  );
}

function DevicePagination({
  page,
  totalPages,
  pageSize,
  total,
  tabs,
  onPageChange,
  onPageSizeChange
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  total: number;
  tabs?: ReactNode;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  return (
    <div className="device-pagination">
      <div className="device-pagination-leading">
        {tabs}
      </div>
      <div className="button-row">
        <span className="muted device-pagination-count">Showing {Math.min(total, (page - 1) * pageSize + 1)}-{Math.min(total, page * pageSize)} of {total}</span>
        <select className="input compact-select" value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>{size} rows</option>
          ))}
        </select>
        <button className="button secondary compact" type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Previous</button>
        <span className="muted">Page {page} of {totalPages}</span>
        <button className="button secondary compact" type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>Next</button>
      </div>
    </div>
  );
}

function DeviceCategoryTabs({
  activeTab,
  counts,
  onChange
}: {
  activeTab: DeviceTab;
  counts: Record<DeviceTab, number>;
  onChange: (tab: DeviceTab) => void;
}) {
  const tabs: Array<{ value: DeviceTab; label: string }> = [
    { value: "all", label: "All" },
    { value: "servers", label: "Servers" },
    { value: "workstations", label: "Workstations" }
  ];
  return (
    <div className="segmented-control device-category-tabs" aria-label="Device category">
      {tabs.map((tab) => (
        <button key={tab.value} type="button" className={activeTab === tab.value ? "active" : ""} onClick={() => onChange(tab.value)} aria-pressed={activeTab === tab.value}>
          <span className="device-category-label">{tab.label}</span>
          <small>{counts[tab.value]}</small>
        </button>
      ))}
    </div>
  );
}

function groupDevices(devices: DeviceRecord[]) {
  const clients = new Map<string, { key: string; name: string; count: number; sites: Map<string, { key: string; name: string; devices: DeviceRecord[] }> }>();
  for (const device of devices) {
    const clientKey = device.client.id;
    if (!clients.has(clientKey)) {
      clients.set(clientKey, { key: clientKey, name: device.client.name, count: 0, sites: new Map() });
    }
    const client = clients.get(clientKey)!;
    client.count += 1;
    const siteName = device.deviceGroupId ?? "No site";
    const siteKey = `${clientKey}:${siteName}`;
    if (!client.sites.has(siteKey)) {
      client.sites.set(siteKey, { key: siteKey, name: siteName, devices: [] });
    }
    client.sites.get(siteKey)!.devices.push(device);
  }
  return Array.from(clients.values()).map((client) => ({
    key: client.key,
    name: client.name,
    count: client.count,
    sites: Array.from(client.sites.values())
  }));
}

function filterDevicesByTab(devices: DeviceRecord[], tab: DeviceTab) {
  if (tab === "servers") return devices.filter((device) => isServerDevice(device));
  if (tab === "workstations") return devices.filter((device) => isWorkstationDevice(device));
  return devices;
}

function getDeviceTabCounts(devices: DeviceRecord[]): Record<DeviceTab, number> {
  return {
    all: devices.length,
    servers: devices.filter((device) => isServerDevice(device)).length,
    workstations: devices.filter((device) => isWorkstationDevice(device)).length
  };
}

function isServerDevice(device: DeviceRecord) {
  return device.type === "SERVER" || getDeviceIcon(device) === Server;
}

function isWorkstationDevice(device: DeviceRecord) {
  return device.type === "DESKTOP" || device.type === "LAPTOP";
}

function getDeviceStatusClass(device: DeviceRecord) {
  if (device.status === "ACTIVE") return "active";
  if (device.status === "INACTIVE") return "inactive";
  return "retired";
}

function getDeviceIcon(device: DeviceRecord) {
  const source = `${device.type} ${device.name} ${device.operatingSystem ?? ""}`.toLowerCase();
  if (source.includes("server")) return Server;
  if (source.includes("laptop") || source.includes("notebook")) return Laptop;
  if (source.includes("tablet") || source.includes("ios") || source.includes("android")) return Smartphone;
  if (looksLikeLinuxServer(source)) return Server;
  return Monitor;
}

function looksLikeLinuxServer(source: string) {
  const linuxServerSignals = ["linux", "ubuntu", "debian", "centos", "red hat", "rhel", "rocky", "alma", "fedora", "suse", "pve", "proxmox", "esxi"];
  const workstationSignals = ["desktop", "workstation", "laptop", "notebook", "tablet", "phone"];
  return linuxServerSignals.some((signal) => source.includes(signal)) && !workstationSignals.some((signal) => source.includes(signal));
}

function getDeviceNetworkInfo(device: DeviceRecord) {
  const network = device.remoteAccessDetails?.network;
  return {
    localIp: network?.localIps?.find(Boolean) ?? null,
    macAddress: network?.macAddresses?.find(Boolean) ?? null
  };
}

function formatNetworkSummary(network: { localIp: string | null; macAddress: string | null }) {
  if (!network.localIp && !network.macAddress) return "-";
  return [network.localIp ? `IP: ${network.localIp}` : null, network.macAddress ? `MAC: ${network.macAddress}` : null].filter(Boolean).join(" / ");
}

function getOsIcon(os?: string | null) {
  const source = (os ?? "").toLowerCase();
  if (source.includes("linux") || source.includes("ubuntu") || source.includes("debian")) return TerminalSquare;
  if (source.includes("server")) return Server;
  return Monitor;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "-";
}
