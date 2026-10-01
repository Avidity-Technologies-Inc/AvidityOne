"use client";

import { Monitor, RefreshCcw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

interface RmmSettings {
  enabled: boolean;
  providerName: string;
  apiBaseUrl: string | null;
  apiKeyReference: string | null;
  hasResolvedApiKey: boolean;
  agentsPath: string;
  dashboardUrl: string | null;
  deviceUrlTemplate: string | null;
  controlUrlTemplate: string | null;
  backgroundUrlTemplate: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncMessage: string | null;
  autoSyncEnabled: boolean;
  autoSyncIntervalMinutes: number | null;
  nextAutoSyncAt: string | null;
}

const defaultDraft = {
  enabled: false,
  providerName: "Tactical RMM",
  apiBaseUrl: "https://api-rmm.aviditytechnologies.com",
  apiKeyReference: "env:TACTICAL_RMM_API_KEY",
  agentsPath: "/agents/",
  dashboardUrl: "https://rmm.aviditytechnologies.com",
  deviceUrlTemplate: "https://rmm.aviditytechnologies.com/agents/{agentId}",
  controlUrlTemplate: "https://rmm.aviditytechnologies.com/takecontrol/{agentId}",
  backgroundUrlTemplate: "https://rmm.aviditytechnologies.com/remotebackground/{agentId}?agentPlatform={agentPlatform}",
  autoSyncEnabled: false,
  autoSyncIntervalMinutes: 30
};

export function RmmConfigPanel() {
  const [draft, setDraft] = useState(defaultDraft);
  const [settings, setSettings] = useState<RmmSettings | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | "sync" | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadSettings() {
    setBusy("load");
    setError(null);
    try {
      const response = await apiFetch<RmmSettings>("/devices/rmm-settings");
      setSettings(response);
      setDraft({
        enabled: response.enabled,
        providerName: response.providerName || defaultDraft.providerName,
        apiBaseUrl: response.apiBaseUrl || defaultDraft.apiBaseUrl,
        apiKeyReference: response.apiKeyReference || defaultDraft.apiKeyReference,
        agentsPath: response.agentsPath || defaultDraft.agentsPath,
        dashboardUrl: response.dashboardUrl || defaultDraft.dashboardUrl,
        deviceUrlTemplate: response.deviceUrlTemplate || defaultDraft.deviceUrlTemplate,
        controlUrlTemplate: response.controlUrlTemplate || defaultDraft.controlUrlTemplate,
        backgroundUrlTemplate: response.backgroundUrlTemplate || defaultDraft.backgroundUrlTemplate,
        autoSyncEnabled: response.autoSyncEnabled,
        autoSyncIntervalMinutes: response.autoSyncIntervalMinutes ?? defaultDraft.autoSyncIntervalMinutes
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load RMM settings.");
    } finally {
      setBusy(null);
    }
  }

  async function saveSettings() {
    setBusy("save");
    setError(null);
    setNotice(null);
    try {
      const autoSyncIntervalMinutes = Math.min(1440, Math.max(15, draft.autoSyncIntervalMinutes));
      const response = await apiFetch<RmmSettings>("/devices/rmm-settings", {
        method: "PATCH",
        body: JSON.stringify({
          ...draft,
          autoSyncEnabled: draft.enabled && draft.autoSyncEnabled,
          autoSyncIntervalMinutes: draft.enabled && draft.autoSyncEnabled ? autoSyncIntervalMinutes : null
        })
      });
      setSettings(response);
      setNotice("RMM integration settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save RMM settings.");
    } finally {
      setBusy(null);
    }
  }

  async function syncDevices() {
    setBusy("sync");
    setError(null);
    setNotice(null);
    try {
      const response = await apiFetch<{ total: number; created: number; updated: number; settings: RmmSettings }>("/devices/rmm-sync", { method: "POST" });
      setSettings(response.settings);
      const message =
        response.settings.lastSyncMessage ||
        `Synced ${response.total} device${response.total === 1 ? "" : "s"} (${response.created} created, ${response.updated} updated).`;
      if (response.settings.lastSyncStatus === "warning") setError(message);
      else setNotice(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sync RMM devices.");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>RMM Integration</h2>
          <p className="muted">Connect Tactical RMM inventory to Devices and open remote access sessions from Avidity One.</p>
        </div>
        <span className={`status-pill ${settings?.enabled ? "success" : "muted"}`}>{settings?.enabled ? "Enabled" : "Disabled"}</span>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}

      <div className="rmm-settings-grid">
        <label className="checkbox-row full-span">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                enabled: event.target.checked,
                autoSyncEnabled: event.target.checked ? current.autoSyncEnabled : false
              }))
            }
          />
          Enable Tactical RMM integration
        </label>
        <label className="field">
          <span>Provider name</span>
          <input className="input" value={draft.providerName} onChange={(event) => setDraft((current) => ({ ...current, providerName: event.target.value }))} />
        </label>
        <label className="field">
          <span>API base URL</span>
          <input className="input" value={draft.apiBaseUrl} onChange={(event) => setDraft((current) => ({ ...current, apiBaseUrl: event.target.value }))} />
        </label>
        <label className="field">
          <span>API key reference</span>
          <input className="input" value={draft.apiKeyReference} onChange={(event) => setDraft((current) => ({ ...current, apiKeyReference: event.target.value }))} />
        </label>
        <label className="field">
          <span>Agent endpoint path</span>
          <input className="input" value={draft.agentsPath} onChange={(event) => setDraft((current) => ({ ...current, agentsPath: event.target.value }))} />
        </label>
        <label className="field">
          <span>Dashboard URL</span>
          <input className="input" value={draft.dashboardUrl} onChange={(event) => setDraft((current) => ({ ...current, dashboardUrl: event.target.value }))} />
        </label>
        <label className="field">
          <span>System info URL template</span>
          <input className="input" value={draft.deviceUrlTemplate} onChange={(event) => setDraft((current) => ({ ...current, deviceUrlTemplate: event.target.value }))} />
        </label>
        <label className="field">
          <span>Remote control URL template</span>
          <input className="input" value={draft.controlUrlTemplate} onChange={(event) => setDraft((current) => ({ ...current, controlUrlTemplate: event.target.value }))} />
        </label>
        <label className="field">
          <span>Remote background URL template</span>
          <input className="input" value={draft.backgroundUrlTemplate} onChange={(event) => setDraft((current) => ({ ...current, backgroundUrlTemplate: event.target.value }))} />
        </label>
        <label className="checkbox-row full-span">
          <input
            type="checkbox"
            checked={draft.autoSyncEnabled}
            disabled={!draft.enabled}
            onChange={(event) => setDraft((current) => ({ ...current, autoSyncEnabled: event.target.checked }))}
          />
          Enable automatic RMM sync
        </label>
        <label className="field">
          <span>Auto-sync interval (minutes)</span>
          <input
            className="input"
            min={15}
            max={1440}
            step={5}
            type="number"
            value={draft.autoSyncIntervalMinutes}
            disabled={!draft.enabled || !draft.autoSyncEnabled}
            onChange={(event) => {
              const nextValue = Number(event.target.value);
              setDraft((current) => ({
                ...current,
                autoSyncIntervalMinutes: Number.isFinite(nextValue) ? nextValue : defaultDraft.autoSyncIntervalMinutes
              }));
            }}
          />
        </label>
      </div>

      <p className="muted">For a 30-minute schedule, enable automatic RMM sync, set the interval to 30 and save. The summary below shows the saved schedule.</p>
      <div className="rmm-help-panel">
        <Monitor size={18} aria-hidden="true" />
        <div>
          <strong>Supported URL tokens</strong>
          <p className="muted">Use {"{agentId}"}, {"{hostname}"}, {"{clientName}"}, {"{siteName}"}, {"{meshNodeId}"}, or {"{agentPlatform}"} in URL templates. Secrets must stay in environment variables, not in the database.</p>
          <p className="muted">API key resolved: {settings?.hasResolvedApiKey ? "Yes" : "No"}</p>
          <p className="muted">The scheduler checks every minute. A running mailbox sync can postpone inventory by five minutes; future mail or report schedules do not block it. The interval is measured after each completed attempt.</p>
        </div>
      </div>

      <div className="rmm-sync-summary">
        <div>
          <span className="muted">Last sync</span>
          <strong>{settings?.lastSyncAt ? new Date(settings.lastSyncAt).toLocaleString() : "Never"}</strong>
        </div>
        <div>
          <span className="muted">Status</span>
          <strong>{settings?.lastSyncStatus ?? "Not synced"}</strong>
        </div>
        <div>
          <span className="muted">Auto sync</span>
          <strong>
            {settings?.autoSyncEnabled
              ? `Every ${settings.autoSyncIntervalMinutes ?? defaultDraft.autoSyncIntervalMinutes} min`
              : "Off"}
          </strong>
        </div>
        <div>
          <span className="muted">Next auto sync</span>
          <strong>{settings?.nextAutoSyncAt ? new Date(settings.nextAutoSyncAt).toLocaleString() : "Not scheduled"}</strong>
        </div>
        <div className="full-span">
          <span className="muted">Message</span>
          <strong>{settings?.lastSyncMessage ?? "No RMM sync has been recorded yet."}</strong>
        </div>
      </div>

      <div className="button-row">
        <button className="button primary" type="button" onClick={saveSettings} disabled={Boolean(busy)}>
          <Save size={16} aria-hidden="true" />
          <span>{busy === "save" ? "Saving..." : "Save RMM Settings"}</span>
        </button>
        <button className="button secondary" type="button" onClick={syncDevices} disabled={Boolean(busy) || !settings?.enabled}>
          <RefreshCcw size={16} aria-hidden="true" />
          <span>{busy === "sync" ? "Syncing..." : "Sync Devices"}</span>
        </button>
      </div>
    </section>
  );
}
