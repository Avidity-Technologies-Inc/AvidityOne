"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCcw } from "lucide-react";
import { apiFetch } from "@/lib/api";

type Status = "ok" | "warning" | "error" | "unknown" | "disabled";
type Range = "daily" | "weekly" | "monthly" | "yearly";
interface Component {key: string; name: string; status: Status; message: string; checkedAt: string; metadata?: Record<string, unknown>}
export interface HealthSummary {
  status: Status; severity: "green" | "orange" | "red" | "gray"; checkedAt: string; serverTime: string;
  timezone: string; dateFormat: string; timeFormat: "12h" | "24h"; components: Component[];
  recorded: boolean; recordingError?: string | null; automaticCheckIntervalMinutes: number;
  links?: {devices: boolean; rmm: boolean};
}
interface Snapshot {id: string; name: string; component: string; status: Status; source: string; message: string; checkedAt: string}
interface History {total: number; page: number; totalPages: number; totals: Record<Status, number>; snapshots: Snapshot[]}
interface Timeline {from: string; to: string; components: Array<{key: string; name: string; healthyPercent: number | null; coveragePercent: number; buckets: Array<{id: string; start: string; end: string; status: Status; message: string}>}>}
const labels: Record<Status, string> = {ok: "OK", warning: "Warning", error: "Error", unknown: "Unknown", disabled: "Disabled / manual"};
const sourceLabels: Record<string, string> = {automatic: "Automatic check", manual: "Manual check", rmm_auto: "Automatic RMM run", rmm_manual: "Manual RMM run", rmm_deferred: "RMM postponed"};
const evidence: Record<string, string> = {database: "Live database query", storage: "Storage path accessibility", mail: "Recorded mailbox state; delivery not tested", support_portal: "Configuration check", event_services: "Configuration check", ai: "Configuration check", antivirus: "Live scanner and attachment records", audit_logs: "Recorded audit activity", devices: "Recorded synchronization outcomes"};

export function SystemHealthPanel({refreshToken, onSummary}: {refreshToken: number; onSummary: (value: HealthSummary) => void}) {
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [range, setRange] = useState<Range>("daily");
  const [component, setComponent] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const manual = useRef(false);
  const load = useCallback(async (record = false) => {
    const id = ++sequence.current;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    if (record) manual.current = true;
    setBusy(true); setError("");
    try {
      const next = await apiFetch<HealthSummary>(record ? "/system-health/check" : "/system-health/summary", {method: record ? "POST" : "GET", signal: abort.signal});
      if (id !== sequence.current) return;
      setSummary(next); onSummary(next);
      const query = new URLSearchParams({range, page: String(page), ...(component ? {component} : {}), ...(status ? {status} : {})});
      const [nextHistory, nextTimeline] = await Promise.all([
        apiFetch<History>(`/system-health/history?${query}`, {signal: abort.signal}),
        apiFetch<Timeline>(`/system-health/timeline?range=${range}`, {signal: abort.signal})
      ]);
      if (id !== sequence.current) return;
      setHistory(nextHistory); setTimeline(nextTimeline);
      if (nextHistory.page !== page) setPage(nextHistory.page);
      if (next.recordingError) setError(next.recordingError);
    } catch (err) {
      if (!abort.signal.aborted && id === sequence.current) setError(err instanceof Error ? err.message : "Health information could not be refreshed. Previous values may be stale.");
    } finally {
      if (record) manual.current = false;
      if (id === sequence.current) setBusy(false);
    }
  }, [range, page, component, status, onSummary]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {if (document.visibilityState === "visible" && !manual.current) void load();}, 60_000);
    return () => {clearInterval(timer); ++sequence.current; controller.current?.abort();};
  }, [load, refreshToken]);
  const date = (value: unknown) => typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? new Intl.DateTimeFormat("en-US", {timeZone: summary?.timezone ?? "UTC", dateStyle: "medium", timeStyle: "short", hour12: summary?.timeFormat !== "24h"}).format(new Date(value)) : "Not recorded";
  const selectHistory = (key: string) => {if (busy) return; setComponent(key); setPage(1); document.getElementById("health-history")?.scrollIntoView({behavior: "smooth", block: "start"});};
  const ordered = [...(summary?.components ?? [])].sort((a,b) => ({error:0, warning:1, unknown:2, ok:3, disabled:4}[a.status] - {error:0, warning:1, unknown:2, ok:3, disabled:4}[b.status]) || Number(b.key === "devices") - Number(a.key === "devices"));
  return <section className="health-workspace" aria-label="System Health" aria-busy={busy}>
    <div className="panel health-overview">
      <div className="section-heading compact-heading"><div><h2>System Health</h2><p className="muted">Current checks and recorded integration activity. No test emails or RMM syncs are triggered here.</p></div>
        <button className="button secondary" type="button" onClick={() => void load(true)} disabled={busy}><RefreshCcw size={15} />Run Check</button></div>
      {error ? <div className="error-banner" role="alert">{error} Displayed history may be stale.</div> : null}
      <div className="health-summary-strip">
        <strong className={`system-health-inline-status ${error ? "warning" : summary?.status ?? "unknown"}`}>{error ? "Refresh needs attention" : summary ? labels[summary.status] : "Loading"}</strong>
        <span>Updated: {date(summary?.checkedAt)}</span><span>{summary?.timezone ?? "Timezone pending"}</span>
        <span>{summary?.components.filter(c => c.status === "warning").length ?? 0} warnings · {summary?.components.filter(c => c.status === "error").length ?? 0} errors</span>
        <span>Automatic snapshots: {summary?.automaticCheckIntervalMinutes ?? "—"} min · view refresh: 1 min</span>
      </div>
      <div className="system-health-component-grid">
        {ordered.map(item => <article className={`system-health-card ${item.status}`} key={item.key}>
          <div><span className={`system-health-led ${item.status}`} aria-hidden="true" /><strong>{item.name}</strong><span className="health-state">{item.key === "devices" && typeof item.metadata?.state === "string" ? item.metadata.state : labels[item.status]}</span></div>
          <p>{item.message}</p><small className="muted">{evidence[item.key]}</small>
          {item.key === "devices" ? <><dl className="health-sync-facts">
            <dt>Interval</dt><dd>{typeof item.metadata?.intervalMinutes === "number" ? `${item.metadata.intervalMinutes} minutes` : "Not configured"}</dd>
            <dt>Last attempt</dt><dd>{date(item.metadata?.lastAttemptAt)}{typeof item.metadata?.ageMinutes === "number" ? ` · ${item.metadata.ageMinutes} min ago` : ""}</dd><dt>Last successful inventory sync</dt><dd>{date(item.metadata?.lastSuccessAt)}</dd>
            <dt>Next automatic run</dt><dd>{date(item.metadata?.nextRunAt)}</dd>
            {typeof item.metadata?.runningSince === "string" ? <><dt>Running since</dt><dd>{date(item.metadata.runningSince)}</dd></> : null}
          </dl><RmmOutcome value={item.metadata?.latestOutcome} date={date} />
          <div className="button-row">{summary?.links?.devices ? <a className="button secondary compact" href="/devices">Devices</a> : null}{summary?.links?.rmm ? <a className="button secondary compact" href="/settings?section=rmm">RMM settings</a> : null}<button className="button secondary compact" type="button" onClick={() => selectHistory("devices")}>Sync history</button></div></> : null}
          {item.key === "antivirus" ? <ScannerDetails metadata={item.metadata} /> : null}
          <small className="muted">Checked {date(item.checkedAt)}</small>
        </article>)}
      </div>
    </div>
    <div className="panel health-timeline-panel">
      <div className="section-heading compact-heading"><div><h3>Observation timeline</h3><p className="muted">OK applies to assessed intervals; coverage shows intervals with any recorded observation. This is not an uptime measurement.</p></div>
        <select className="input" aria-label="Health period" value={range} disabled={busy} onChange={e => {setRange(e.target.value as Range); setPage(1);}}>{(["daily","weekly","monthly","yearly"] as Range[]).map(r => <option key={r} value={r}>{r}</option>)}</select></div>
      <p className="muted">{date(timeline?.from)} – {date(timeline?.to)} · Green: OK · Orange: warning · Red: error · Gray: unknown or disabled</p>
      <div className="system-health-timeline">{timeline?.components.map(item => <div className="system-health-timeline-row" key={item.key}>
        <div className="system-health-timeline-meta"><strong>{item.name}</strong><small>{item.healthyPercent === null ? "Not assessed" : `${item.healthyPercent}% OK in assessed intervals`} · {item.coveragePercent}% coverage</small></div>
        <div className="system-health-timeline-bars">{item.buckets.map(bucket => <button type="button" key={bucket.id} className={`system-health-timeline-bar ${bucket.status}`} aria-label={`${item.name}: ${bucket.status}. ${date(bucket.start)} – ${date(bucket.end)}. ${bucket.message}`} title={`${date(bucket.start)} – ${date(bucket.end)}. ${bucket.message}`} onClick={() => selectHistory(item.key)} />)}</div>
      </div>)}</div>
    </div>
    <div className="panel" id="health-history">
      <div className="section-heading compact-heading"><div><h3>Health history</h3><p className="muted">New observations are scoped to your organization. Older unscoped records are preserved separately and excluded here.</p></div>
        <div className="health-history-filters"><select className="input" aria-label="Health component" disabled={busy} value={component} onChange={e => {setComponent(e.target.value);setPage(1);}}><option value="">All components</option>{summary?.components.map(c => <option value={c.key} key={c.key}>{c.name}</option>)}</select>
          <select className="input" aria-label="Health status" disabled={busy} value={status} onChange={e => {setStatus(e.target.value);setPage(1);}}><option value="">All states</option>{Object.entries(labels).map(([key,label]) => <option value={key} key={key}>{label}</option>)}</select></div></div>
      <div className="health-summary-strip"><strong>{history?.total ?? 0} matching observations</strong>{history ? Object.entries(history.totals).map(([key,count]) => <span key={key}>{labels[key as Status]}: {count}</span>) : null}</div>
      <div className="table-scroll"><table className="tickets-table system-health-table"><thead><tr><th>Time ({summary?.timezone ?? "UTC"})</th><th>Component</th><th>Source</th><th>State</th><th>Result</th></tr></thead><tbody>
        {history?.snapshots.map(row => <tr key={row.id}><td>{date(row.checkedAt)}</td><td>{row.name}</td><td>{sourceLabels[row.source] ?? row.source}</td><td><span className={`system-health-inline-status ${row.status}`}>{labels[row.status]}</span></td><td>{row.message}</td></tr>)}
        {!history?.snapshots.length ? <tr><td colSpan={5}>{busy ? "Loading observations…" : "No observations match this period and filters."}</td></tr> : null}
      </tbody></table></div>
      <div className="system-health-history-pagination"><span>Page {history?.page ?? 1} of {history?.totalPages ?? 1}</span><div className="button-row"><button className="button secondary compact" type="button" disabled={busy || (history?.page ?? 1) <= 1} onClick={() => setPage(p => p-1)}>Previous</button><button className="button secondary compact" type="button" disabled={busy || !history || history.page >= history.totalPages} onClick={() => setPage(p => p+1)}>Next</button></div></div>
    </div>
  </section>;
}
function RmmOutcome({value, date}: {value: unknown; date: (value: unknown) => string}) {
  if (!value || typeof value !== "object") return null;
  const outcome = value as {metadata?: {total?: number; created?: number; updated?: number; durationMs?: number}; checkedAt?: string};
  const counts = outcome.metadata;
  return <p className="muted">Latest recorded run: {date(outcome.checkedAt)}{typeof counts?.total === "number" ? ` · ${counts.total} processed · ${counts.created ?? 0} created · ${counts.updated ?? 0} updated` : ""}{typeof counts?.durationMs === "number" ? ` · ${(counts.durationMs/1000).toFixed(1)} seconds` : ""}</p>;
}
function ScannerDetails({metadata}: {metadata?: Record<string, unknown>}) {
  const counts = metadata?.counts as Record<string, number> | undefined;
  return <div className="system-health-card-metadata">{counts ? ["clean","quarantined","pending","skipped","restored"].map(key => <span key={key}>{key}: {counts[key] ?? 0}</span>) : null}{typeof metadata?.version === "string" ? <small>{metadata.version}</small> : null}</div>;
}
