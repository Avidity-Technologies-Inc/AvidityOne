"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CalendarClock, Check, Download, FileText, Filter, History, Mail, Pencil, RefreshCw, Save, Trash2, X } from "lucide-react";
import { REPORT_COLUMNS, REPORT_DEFAULT_COLUMNS, REPORT_PERIODS, REPORT_SECTIONS, REPORT_MAX_EXCLUSIONS, resolveReportSections, ReportColumn, ReportKind } from "@avidity/shared";
import { QcContextLink } from "@/components/qc/QcContextLink";
import { subscribeAccessRefresh } from "@/lib/access-refresh";
import { apiFetch, getApiBaseUrl } from "@/lib/api";

type Option = { id: string; name: string };
type Filters = Record<string, string>;
type Breakdown = { label: string; count: number };
type Report = {
  generatedAt: string;
  filters?: Filters;
  options?: Record<string, Array<Option | string>>;
  summary: Record<string, number | null>;
  activity?: Array<Record<string, string | number>>;
  detail: Array<Record<string, unknown>>;
  totalMatched?: number; page?: number; pageSize?: number; totalPages?: number;
  [key: string]: unknown;
};
type Definition = { id: string; name: string; description: string | null; isShared: boolean; filters: Record<string, unknown>; createdBy: string | null };
type Timing = { timeZone: string; time: string; weekDay: number; monthDay: number };
type Schedule = { id: string; definitionId: string; name: string; frequency: string; format: string; recipientEmails: string[]; isActive: boolean; timing: Timing | null; nextRunAt: string | null; lastRunAt: string | null; lastStatus: string | null; lastError: string | null; definition: { name: string } };
type ExportHistory = { id: string; format: string; deliveryStatus: string; recipientEmail: string | null; errorMessage: string | null; createdAt: string; definitionName: string | null };
type Configuration = { timeZone: string; locale: string; currencies: string[]; permissions: string[] };
type Presentation = { columns: string; sections: string; title: string; paper: string; orientation: string; scope: string };
const endpoints: Record<ReportKind, string> = { "ticket-report": "tickets", "event-service-report": "event-services", "project-executive-report": "projects" };
const names: Record<ReportKind, string> = { "ticket-report": "Tickets", "event-service-report": "Events & Services", "project-executive-report": "Projects" };
const initialFilters = (): Filters => ({ period: "last30", dateBasis: "createdAt", groupBy: "day", page: "1", pageSize: "25", sortBy: "createdAt", sortDirection: "desc" });
const initialPresentation = (kind: ReportKind): Presentation => ({ columns: REPORT_DEFAULT_COLUMNS[kind].join(","), sections: resolveReportSections(kind).filter((key) => key !== "metric:estimatedTotal").join(","), title: "", paper: "LETTER", orientation: "landscape", scope: "all" });
function label(value: string) {
  if (/^[A-Z][A-Z_]*$/.test(value) && (value.includes("_") || ["NEW", "OPEN", "CLOSED", "RESOLVED", "CANCELLED", "NORMAL", "HIGH", "URGENT", "CRITICAL", "LOW", "EMAIL", "MANUAL", "PORTAL", "DONE", "COMPLETED"].includes(value))) return value.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}
function params(filters: Filters) { return new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== "")); }
function localDate(value: string, zone?: string, time = true) {
  if (!value) return "Not recorded";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value); if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString(undefined, { timeZone: zone || undefined, year: "numeric", month: "short", day: "2-digit", ...(time ? { hour: "2-digit", minute: "2-digit" } : {}) });
}
function cellValue(row: Record<string, unknown>, column: ReportColumn, zone: string, currency?: string) {
  const value = row[column.key];
  if (column.key === "status" && row.statusDefinition) return (row.statusDefinition as { name: string }).name;
  if (value === null || value === undefined) return "Not recorded";
  if (column.type === "date") return localDate(String(value), zone);
  if (column.type === "dateOnly") return String(value).slice(0, 10);
  if (column.type === "currency") return currency ? new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value)) : "Not configured";
  if (column.key === "risk") return value ? "Needs attention" : "On track";
  return ["status", "priority", "source", "health"].includes(column.key) ? label(String(value)) : String(value);
}
function Breakdowns({ report, sections }: { report: Report; sections: string[] }) {
  return <div className="report-breakdowns">{Object.entries(report).filter(([key, value]) => key.startsWith("by") && sections.includes(key) && Array.isArray(value)).map(([key, value]) => {
    const items = value as Breakdown[]; const max = Math.max(1, ...items.map((i) => i.count));
    return <section className="panel report-breakdown" key={key}><h3>{label(key.slice(2))}</h3><p className="muted">{key === "byTechnician" ? "Matching records per technician. Shared assignments count once per person." : key === "byService" ? "Matching requests per service. Requests can include multiple services." : "Current distribution of matching records."}</p><div className="report-breakdown-list">{items.length ? items.map((item, index) => <div className="report-bar-item" key={`${item.label}-${index}`}><span>{["byPriority", "bySource", "byTaskStatus", "byHealth"].includes(key) ? label(item.label) : item.label}</span><strong>{item.count.toLocaleString()}</strong><div className="report-bar-track"><i style={{ width: `${item.count / max * 100}%` }} /></div></div>) : <p className="muted">No matching records.</p>}</div></section>;
  })}</div>;
}
function Activity({ report }: { report: Report }) {
  const items = report.activity ?? []; if (!items.length) return null;
  const keys = Object.keys(items[0]).filter((key) => key !== "period" && key !== "label");
  const max = Math.max(1, ...items.flatMap((item) => keys.map((key) => Number(item[key]))));
  return <section className="panel report-trend"><h3>Activity within the selected period</h3><p className="muted">Events from the matching records only. Events outside the selected dates are excluded. Weekly buckets start on Monday.</p><div className="report-series-legend">{keys.map((key, i) => <span key={key}><i className={`report-series-${i}`} />{label(key)}</span>)}</div><div className="report-trend-scroll"><div className="report-trend-bars" style={{ minWidth: Math.max(500, items.length * 34) }}>{items.map((item) => <div className="report-trend-period" key={String(item.period)} title={`${item.period}: ${keys.map((key) => `${label(key)} ${item[key]}`).join(", ")}`}><div>{keys.map((key, i) => <i key={key} data-value={item[key]} className={`report-series-${i}`} style={{ height: `${Number(item[key]) / max * 100}%` }} />)}</div><small>{String(item.period)}</small></div>)}</div></div><details><summary>View activity values</summary><div className="report-table-scroll"><table><thead><tr><th>Period</th>{keys.map((key) => <th key={key}>{label(key)}</th>)}</tr></thead><tbody>{items.map((item) => <tr key={String(item.period)}><td>{String(item.period)}</td>{keys.map((key) => <td key={key}>{item[key]}</td>)}</tr>)}</tbody></table></div></details></section>;
}

function SectionPicker({ kind, sections, onChange, estimate }: { kind: ReportKind; sections: string[]; onChange: (value: string) => void; estimate: boolean }) {
  const available = REPORT_SECTIONS[kind].filter((s) => s.key !== "metric:estimatedTotal" || estimate);
  const toggle = (key: string) => {
    const next = sections.includes(key) ? sections.filter((s) => s !== key) : [...sections, key];
    if (next.length) onChange(next.join(","));
  };
  return <div className="report-content-picker"><div className="report-actions"><button className="button secondary" onClick={() => onChange(available.map((s) => s.key).join(","))}>Include all sections</button><button className="button secondary" onClick={() => onChange("detail")}>Detail only</button></div><p className="muted">Choose each indicator and chart. The same selection is used on screen, in PDF/Excel and in saved reports. Keep at least one section.</p><div className="report-section-options">{(["Summary indicators", "Charts and breakdowns", "Supporting sections"] as const).map((group) => <fieldset key={group}><legend>{group}</legend>{available.filter((s) => s.group === group).map((section) => <label className="report-checkbox" key={section.key}><input type="checkbox" checked={sections.includes(section.key)} disabled={sections.length === 1 && sections.includes(section.key)} onChange={() => toggle(section.key)} />{section.label}</label>)}</fieldset>)}</div></div>;
}

export function ReportsWorkspace() {
  const [kind, setKind] = useState<ReportKind>("ticket-report");
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [draft, setDraft] = useState<Filters>(initialFilters);
  const [applied, setApplied] = useState<Filters>(initialFilters);
  const [presentation, setPresentation] = useState<Presentation>(initialPresentation("ticket-report"));
  const [report, setReport] = useState<Report | null>(null);
  const [loadedQuery, setLoadedQuery] = useState("");
  const [tab, setTab] = useState<"overview" | "saved" | "schedules" | "history">("overview");
  const [advanced, setAdvanced] = useState(false);
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [format, setFormat] = useState("pdf");
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; description: string; filters: Filters }>>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [history, setHistory] = useState<ExportHistory[]>([]);
  const [selected, setSelected] = useState("");
  const [saveName, setSaveName] = useState("");
  const [description, setDescription] = useState("");
  const [shared, setShared] = useState(false);
  const [recipients, setRecipients] = useState("");
  const [scheduleId, setScheduleId] = useState("");
  const [scheduleName, setScheduleName] = useState("");
  const [frequency, setFrequency] = useState("weekly");
  const [scheduleFormat, setScheduleFormat] = useState("pdf");
  const [timing, setTiming] = useState<Timing>({ timeZone: "", time: "09:00", weekDay: 1, monthDay: 1 });
  const [scheduleRecipients, setScheduleRecipients] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const requestVersion = useRef(0);
  const dialogRef = useRef<HTMLElement>(null);
  const query = useMemo(() => params(applied).toString(), [applied]);
  const dirty = params(draft).toString() !== query;
  const isProject = kind === "project-executive-report";
  const isTicket = kind === "ticket-report";
  const grants = configuration?.permissions ?? [];
  const canManage = grants.includes("reports.manage");
  const canSend = grants.includes("reports.send");
  const canExport = grants.includes("reports.export");
  const fresh = Boolean(report && !loading && loadedQuery === `${kind}?${query}`);
  const zone = report?.filters?.timeZone || configuration?.timeZone || "UTC";
  const columns = presentation.columns.split(",").map((key) => REPORT_COLUMNS[kind].find((c) => c.key === key)).filter((c): c is ReportColumn => Boolean(c));
  const chosenSections = resolveReportSections(kind, presentation.sections).filter((key) => key !== "metric:estimatedTotal" || applied.estimateMode === "perTicket");
  const sections = chosenSections.length ? chosenSections : ["detail"];
  const excluded = (applied.excludedIds ?? "").split(",").filter(Boolean);
  const total = report?.totalMatched ?? report?.detail.length ?? 0;
  const options = report?.options ?? {};
  const selectedDefinition = definitions.find((d) => d.id === selected);

  useEffect(() => {
    if (!exportOpen) return;
    const prior = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    const controls = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]') ?? []);
    controls()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setExportOpen(false);
      if (event.key !== "Tab") return;
      const items = controls(); const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", key); prior?.focus(); };
  }, [exportOpen, busy]);
  useEffect(() => {
    let active = true;
    const refresh = () => { void apiFetch<Configuration>("/reports/configuration").then((value) => { if (active) { setConfiguration(value); setTiming((t) => ({ ...t, timeZone: t.timeZone || value.timeZone })); } }).catch((e: Error) => { if (active) setError(e.message); }); };
    refresh(); const unsubscribe = subscribeAccessRefresh(refresh);
    return () => { active = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!configuration) return;
    const controller = new AbortController(); const version = ++requestVersion.current;
    setLoading(true); setError("");
    const suffix = isProject ? "executive-summary" : "summary";
    void apiFetch<Report>(`/reports/${endpoints[kind]}/${suffix}?${query}`, { signal: controller.signal }).then((value) => {
      if (version === requestVersion.current) { setReport(value); setLoadedQuery(`${kind}?${query}`); }
    }).catch((e: Error) => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted && version === requestVersion.current) setLoading(false); });
    return () => controller.abort();
  }, [kind, query, reload, configuration, isProject]);
  const loadMeta = useCallback(async (signal?: AbortSignal) => {
    const [saved, presets, planned, exports] = await Promise.all([
      apiFetch<Definition[]>(`/reports/definitions?reportType=${kind}`, { signal }),
      apiFetch<typeof templates>(`/reports/templates?reportType=${kind}`, { signal }),
      apiFetch<Schedule[]>(`/reports/schedules?reportType=${kind}`, { signal }),
      apiFetch<ExportHistory[]>(`/reports/exports?reportType=${kind}`, { signal })
    ]);
    if (!signal?.aborted) { setDefinitions(saved); setTemplates(presets); setSchedules(planned); setHistory(exports); }
  }, [kind]);
  useEffect(() => { const controller = new AbortController(); void loadMeta(controller.signal).catch((e: Error) => { if (!controller.signal.aborted) setError(e.message); }); return () => controller.abort(); }, [loadMeta]);
  function changeKind(value: ReportKind) {
    ++requestVersion.current; setKind(value); setReport(null); setDraft(value === "project-executive-report" ? {} : initialFilters()); setApplied(value === "project-executive-report" ? {} : initialFilters()); setPresentation(initialPresentation(value)); setSelected(""); setSaveName(""); setDescription(""); setScheduleId(""); setError(""); setNotice("");
  }
  function change(key: string, value: string) { setDraft((current) => ({ ...current, [key]: value })); }
  function apply() {
    const next: Filters = { ...draft, page: "1" };
    if (next.estimateMode !== "perTicket") { delete next.valuePerTicket; delete next.currency; setPresentation((p) => ({ ...p, columns: p.columns.split(",").filter((key) => key !== "estimatedValue").join(",") })); }
    setDraft(next); setApplied(next); setNotice("");
  }
  function reset() { const next = initialFilters(); setDraft(next); setApplied(next); setPresentation(initialPresentation(kind)); }
  function page(value: number) { const next = { ...applied, page: String(value) }; setApplied(next); setDraft(next); }
  function selectDefinition(id: string) {
    setSelected(id); const item = definitions.find((d) => d.id === id); if (!item) return;
    const filters: Filters = isProject ? {} : initialFilters(); const view = initialPresentation(kind);
    for (const [key, value] of Object.entries(item.filters)) {
      if (key in view) view[key as keyof Presentation] = String(value ?? "");
      else filters[key] = Array.isArray(value) ? value.join(",") : String(value ?? "");
    }
    if (!item.filters.period && item.filters.startDate) filters.period = "custom";
    setDraft(filters); setApplied(filters); setPresentation(view); setSaveName(item.name); setDescription(item.description ?? ""); setShared(item.isShared); setTab("overview");
  }
  function selectTemplate(id: string) {
    const item = templates.find((t) => t.id === id); if (!item) return;
    const filters = { ...initialFilters(), ...Object.fromEntries(Object.entries(item.filters).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : String(value)])) };
    setDraft(filters); setApplied(filters); setSaveName(item.name); setDescription(item.description); setSelected(""); setPresentation(initialPresentation(kind)); setTab("overview");
  }
  async function action(work: () => Promise<void>, message: string) {
    setBusy(true); setError(""); setNotice("");
    try { await work(); setNotice(message); } catch (e) { setError(e instanceof Error ? e.message : "The operation failed."); } finally { setBusy(false); }
  }
  async function save(update: boolean) {
    if (!saveName.trim()) { setError("Enter a report name."); return; }
    await action(async () => {
      const filters: Filters = { ...applied, ...presentation, sections: sections.join(",") }; if (presentation.scope !== "page") delete filters.page;
      const saved = await apiFetch<Definition>(`/reports/definitions${update ? `/${selected}` : ""}`, { method: update ? "PATCH" : "POST", body: JSON.stringify({ name: saveName.trim(), description, isShared: shared, ...(!update ? { reportType: kind } : {}), filters }) });
      setSelected(saved.id); await loadMeta();
    }, "Report saved with its filters and export layout.");
  }
  function toggleColumn(key: string) {
    const current = presentation.columns.split(",");
    if (current.includes(key) && current.length === 1) return;
    setPresentation((p) => ({ ...p, columns: (current.includes(key) ? current.filter((c) => c !== key) : [...current, key]).join(",") }));
  }
  function moveColumn(index: number, delta: number) {
    const current = presentation.columns.split(","); [current[index], current[index + delta]] = [current[index + delta], current[index]];
    setPresentation((p) => ({ ...p, columns: current.join(",") }));
  }
  function exportQuery() {
    const frozen = { ...applied, ...presentation, sections: format === "csv" ? "detail" : sections.join(","), format, timeZone: zone };
    // Relative periods are resolved to the dates already displayed for this export.
    if (report?.filters?.startDate) Object.assign(frozen, { period: "custom", startDate: report.filters.startDate, endDate: report.filters.endDate });
    if (isProject) return params(Object.fromEntries(Object.entries(frozen).filter(([key]) => ["columns", "sections", "title", "paper", "orientation", "scope", "timeZone", "format", "sortBy", "sortDirection", "excludedIds"].includes(key))));
    return params(frozen);
  }
  async function download() {
    await action(async () => {
      const suffix = isProject ? "executive-export" : "export";
      const response = await fetch(`${getApiBaseUrl()}/reports/${endpoints[kind]}/${suffix}?${exportQuery()}`, { credentials: "include" });
      if (!response.ok) { const payload = await response.json().catch(() => null); throw new Error(payload?.message || `Export failed (${response.status}).`); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `${kind}.${format}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000);
      await loadMeta();
    }, "The export was generated and handed to your browser.");
  }
  const emails = (value: string) => value.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean);
  async function send() {
    if (!emails(recipients).length) { setError("Enter at least one recipient email."); return; }
    if (!window.confirm(`Send this ${format.toUpperCase()} report to ${emails(recipients).join(", ")}?`)) return;
    await action(async () => { const result = await apiFetch<{ status: string }>(`/reports/${endpoints[kind]}/${isProject ? "executive-send" : "send"}?${exportQuery()}`, { method: "POST", body: JSON.stringify({ recipientEmails: emails(recipients), format }) }); await loadMeta(); if (result.status === "simulated") throw new Error("The configured mail provider simulated this send. No email was delivered."); }, "The mail provider accepted the report. Recipient delivery is not independently confirmed.");
  }
  function editSchedule(item: Schedule) {
    setScheduleId(item.id); setSelected(item.definitionId); setScheduleName(item.name); setFrequency(item.frequency); setScheduleFormat(item.format); setScheduleRecipients(item.recipientEmails.join(", ")); setTiming(item.timing ?? { ...timing, timeZone: configuration?.timeZone ?? zone });
  }
  async function saveSchedule() {
    if (!selected || !scheduleName.trim() || !emails(scheduleRecipients).length) { setError("Choose a saved report and enter the schedule name and recipients."); return; }
    await action(async () => {
      await apiFetch(`/reports/schedules${scheduleId ? `/${scheduleId}` : ""}`, { method: scheduleId ? "PATCH" : "POST", body: JSON.stringify({ ...(!scheduleId ? { definitionId: selected, isActive: true } : {}), name: scheduleName, frequency, format: scheduleFormat, recipientEmails: emails(scheduleRecipients), timing }) });
      setScheduleId(""); setScheduleName(""); setScheduleRecipients(""); await loadMeta();
    }, "Schedule saved. It uses the saved report's filters and layout at each run.");
  }
  function optionSelect(key: string, title: string, optionKey: string) {
    if (key === "statuses") return <label>{title}<select multiple aria-label={title} value={(draft[key] ?? "").split(",").filter(Boolean)} onChange={(e) => change(key, Array.from(e.target.selectedOptions).map((o) => o.value).join(","))}>{(options[optionKey] ?? []).map((o) => typeof o === "string" ? <option key={o} value={o}>{label(o)}</option> : null)}</select><small className="muted">No selection includes all. Ctrl / Command selects multiple.</small></label>;
    return <label>{title}<select value={draft[key] ?? ""} onChange={(e) => change(key, e.target.value)}><option value="">All</option>{(options[optionKey] ?? []).map((o) => <option key={typeof o === "string" ? o : o.id} value={typeof o === "string" ? o : o.id}>{typeof o === "string" ? label(o) : o.name}</option>)}</select></label>;
  }
  function updateResultFilters(next: Filters) { if (isProject) { delete next.page; delete next.pageSize; } setApplied(next); setDraft(next); }
  function sort(key: string) { const next = { ...applied, sortBy: key, sortDirection: applied.sortBy === key && applied.sortDirection === "asc" ? "desc" : "asc", page: "1" }; updateResultFilters(next); }
  function excludeRecord(row: Record<string, unknown>) {
    const id = String(row.id ?? row.projectId);
    const next = { ...applied, excludedIds: [...new Set([...excluded, id])].join(","), page: "1" };
    updateResultFilters(next); setNotice(`${String(row.ticketNumber ?? row.trackingNumber ?? row.projectName)} excluded from this report. The original record is unchanged.`);
  }
  function restoreExcluded() { const next = { ...applied, excludedIds: "", page: "1" }; updateResultFilters(next); setNotice(""); }
  const activeCriteria = Object.entries(applied).filter(([key, value]) => value && !["page", "pageSize", "sortBy", "sortDirection"].includes(key)).map(([key, value]) => {
    const all = Object.values(options).flat(); const name = all.find((o) => typeof o === "object" && o.id === value);
    if (key === "excludedIds") return `Excluded records: ${value.split(",").length}`;
    return `${label(key)}: ${typeof name === "object" ? name.name : key === "period" ? REPORT_PERIODS.find((p) => p.value === value)?.label ?? value : label(value)}`;
  });
  return <div className="reports-workspace reports-v2">
    <div className="report-toolbar"><h1 className="report-page-title">Reports</h1><div className="report-kind-tabs" aria-label="Report type">{(Object.keys(names) as ReportKind[]).filter((k) => k !== "project-executive-report" || grants.includes("projects.view")).map((k) => <button key={k} className={kind === k ? "button" : "button secondary"} aria-pressed={kind === k} onClick={() => changeKind(k)}>{names[k]}</button>)}</div><div className="report-actions"><QcContextLink label="Quality reports" permissions={grants} /><button className="button secondary" disabled={loading || busy} onClick={() => setReload((n) => n + 1)}><RefreshCw size={15} />Refresh</button>{canExport || canSend ? <button className="button" disabled={!fresh || dirty || busy} onClick={() => setExportOpen(true)}><Download size={15} />Export / send</button> : null}</div></div>
    <nav className="report-nav" aria-label="Report sections">{([['overview', 'Overview'], ['saved', 'Saved reports'], ['schedules', 'Schedules'], ['history', 'Export history']] as const).map(([key, title]) => <button key={key} className={tab === key ? "active" : ""} aria-current={tab === key ? "page" : undefined} onClick={() => setTab(key)}>{title}</button>)}</nav>
    {error ? <div role="alert" className="error-banner">{error}</div> : null}{notice ? <div role="status" className="report-notice"><Check size={16} /><span>{notice}</span><button className="report-dismiss" aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={14} /></button></div> : null}
    {tab === "overview" ? <>
      {!isProject ? <section className="panel report-filter-panel"><div className="report-section-heading"><div><h2>Report criteria</h2></div><div className="report-actions"><button className="button secondary" aria-expanded={!filtersCollapsed} onClick={() => setFiltersCollapsed(!filtersCollapsed)}>{filtersCollapsed ? "Show filters" : "Collapse filters"}</button><button className="button secondary" aria-expanded={advanced} onClick={() => { setAdvanced(!advanced); setFiltersCollapsed(false); }}><Filter size={15} />{advanced ? "Fewer filters" : "More filters"}</button></div></div>{!filtersCollapsed ? <><div className="report-form-grid">
        <label>Period<select value={draft.period} onChange={(e) => { change("period", e.target.value); if (e.target.value === "custom") setDraft((d) => ({ ...d, period: "custom", startDate: d.startDate || report?.filters?.startDate || "", endDate: d.endDate || report?.filters?.endDate || "" })); }}>{REPORT_PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
        {draft.period === "custom" ? <><label>Start date<input type="date" value={draft.startDate ?? report?.filters?.startDate ?? ""} onChange={(e) => change("startDate", e.target.value)} /></label><label>End date<input type="date" value={draft.endDate ?? report?.filters?.endDate ?? ""} onChange={(e) => change("endDate", e.target.value)} /></label></> : null}
        <label>Date field<select value={draft.dateBasis} onChange={(e) => change("dateBasis", e.target.value)}><option value="createdAt">Created date</option>{isTicket ? <><option value="resolvedAt">Last resolution date</option><option value="closedAt">Last closure date</option></> : <option value="eventDate">Event date</option>}</select></label>
        {optionSelect("clientId", "Client", "clients")}<label>Search<input value={draft.search ?? ""} placeholder={isTicket ? "Ticket number or subject" : "Request number or event"} onChange={(e) => change("search", e.target.value)} /></label>
        {advanced ? <>{optionSelect("assignedUserId", "Technician", "users")}{isTicket ? optionSelect("assignedTeamId", "Team", "teams") : optionSelect("serviceId", "Service", "services")}{optionSelect("priority", "Priority", "priorities")}{optionSelect("statuses", "Base status", "statuses")}{isTicket ? <>{optionSelect("statusDefinitionId", "Configured status", "statusDefinitions")}{optionSelect("source", "Source", "sources")}<label>Attachments<select value={draft.attachments ?? "all"} onChange={(e) => change("attachments", e.target.value)}><option value="all">With or without files</option><option value="with">With files</option><option value="without">Without files</option></select></label></> : null}<label>Activity grouping<select value={draft.groupBy} onChange={(e) => change("groupBy", e.target.value)}>{["day", "week", "month", "year"].map((v) => <option key={v} value={v}>By {v}</option>)}</select></label><label>Timezone<input value={draft.timeZone ?? configuration?.timeZone ?? ""} placeholder="Organization timezone" onChange={(e) => change("timeZone", e.target.value)} /></label>
        {isTicket ? <><label>Optional estimate<select value={draft.estimateMode ?? "none"} onChange={(e) => change("estimateMode", e.target.value)}><option value="none">Not included</option><option value="perTicket">Manual value per ticket</option></select></label>{draft.estimateMode === "perTicket" ? <><label>Value per ticket<input type="number" min="0" step="0.01" value={draft.valuePerTicket ?? ""} onChange={(e) => change("valuePerTicket", e.target.value)} /></label><label>Currency<select value={draft.currency ?? ""} onChange={(e) => change("currency", e.target.value)}><option value="">Choose currency</option>{configuration?.currencies.map((c) => <option key={c}>{c}</option>)}</select></label><p className="muted report-estimate-note">This optional estimate is not recorded revenue or an invoice. QC billing holds still apply.</p></> : null}</> : null}</> : null}
      </div><div className="report-filter-footer"><span className="muted">{dirty ? "Filters changed. Apply them to refresh the results." : "Filters applied."}</span><button className="button secondary" onClick={reset}>Reset</button><button className="button" disabled={loading || busy} onClick={apply}>Apply filters</button></div></> : <small className="muted">{dirty ? "Unapplied filter changes" : "Filters applied"} · {report?.filters?.startDate} – {report?.filters?.endDate}</small>}</section> : null}
      {loading ? <p role="status">Loading report…</p> : null}
      {report ? <div aria-busy={loading} className={fresh ? "" : "report-stale"}>
        <div className="report-result-heading"><div><h2>{names[kind]} report</h2><p>{report.filters ? `${report.filters.startDate} – ${report.filters.endDate} · ${label(report.filters.dateBasis)} · ${zone}` : "Current active project portfolio"}</p><small className="muted">Updated {localDate(report.generatedAt, zone)}. Current status of matching records; not a historical status snapshot.</small></div><strong>{total.toLocaleString()} records</strong></div>
        {sections.includes("criteria") ? <details className="report-criteria"><summary>Applied criteria</summary><ul>{activeCriteria.map((text) => <li key={text}>{text}</li>)}</ul></details> : null}
        <details className="report-customize"><summary>Customize report content · {sections.filter((key) => key !== "metric:estimatedTotal" || applied.estimateMode === "perTicket").length} sections selected</summary><SectionPicker kind={kind} sections={sections} estimate={applied.estimateMode === "perTicket"} onChange={(value) => setPresentation({ ...presentation, sections: value })} /></details>
        {excluded.length ? <div className="report-exclusions"><span>{excluded.length} records excluded. Totals, charts and exports use the remaining records.</span><button className="button secondary" disabled={!fresh || dirty} onClick={restoreExcluded}>Restore excluded records</button></div> : null}
        <div className="report-metrics">{Object.entries(report.summary).filter(([key, value]) => sections.includes(`metric:${key}`) && (key !== "estimatedTotal" || value !== null)).map(([key, value]) => <div className="panel report-metric" key={key}><span>{label(key)}</span><strong>{value === null ? "Not configured" : key === "estimatedTotal" && report.filters?.currency ? new Intl.NumberFormat(undefined, { style: "currency", currency: report.filters.currency }).format(value) : value.toLocaleString()}</strong><small>{key === "estimatedTotal" ? "Manual estimate; not revenue" : key === "totalTickets" || key === "totalRequests" ? "All matching records" : key === "unassignedTickets" ? "No technician or team" : key === "completedProjects" ? "Completed projects, outside active detail" : "Within the matching records"}</small></div>)}</div>
        {sections.includes("activity") ? <Activity report={report} /> : null}<Breakdowns report={report} sections={sections} />
        {sections.includes("detail") ? <section className="panel report-detail"><div className="report-section-heading"><div><h2>Report detail</h2><p className="muted">{isProject ? `${total} active projects` : `${total ? ((report.page ?? 1) - 1) * (report.pageSize ?? 25) + 1 : 0}–${Math.min(total, (report.page ?? 1) * (report.pageSize ?? 25))} of ${total} records`}. Column selection also controls the export. Files include active regular and inline attachments.</p></div><button className="button secondary" onClick={() => setExportOpen(true)}>Choose columns</button></div><div className="report-sort-controls"><label>Sort column<select value={applied.sortBy ?? (isProject ? "" : "createdAt")} disabled={!fresh || dirty} onChange={(e) => { const next = { ...applied, sortBy: e.target.value, sortDirection: "asc", page: "1" }; updateResultFilters(next); }}>{isProject ? <option value="">Delivery priority (default)</option> : null}{REPORT_COLUMNS[kind].filter((col) => col.key !== "estimatedValue" || applied.estimateMode === "perTicket").map((col) => <option key={col.key} value={col.key}>{col.label}</option>)}</select></label><label>Sort direction<select value={applied.sortDirection ?? "desc"} disabled={!fresh || dirty || (isProject && !applied.sortBy)} onChange={(e) => { const next = { ...applied, sortDirection: e.target.value, page: "1" }; updateResultFilters(next); }}><option value="asc">Ascending · A–Z / smallest / earliest</option><option value="desc">Descending · Z–A / largest / latest</option></select></label><small className="muted">Sorts all matching records before pagination and export. Exclude up to {REPORT_MAX_EXCLUSIONS} individual records; use filters for broader selection.</small></div><div className="report-table-scroll"><table><thead><tr>{columns.map((col) => <th key={col.key} aria-sort={applied.sortBy === col.key ? applied.sortDirection === "asc" ? "ascending" : "descending" : "none"} style={{ minWidth: (col.width ?? 20) * 7 }}><button disabled={!fresh || dirty} onClick={() => sort(col.key)}>{col.label}{applied.sortBy === col.key ? applied.sortDirection === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : null}</button></th>)}<th>Exclude</th></tr></thead><tbody>{report.detail.length ? report.detail.map((row, index) => <tr key={String(row.id ?? row.projectId ?? index)}>{columns.map((col, c) => <td key={col.key} style={{ minWidth: (col.width ?? 20) * 7 }}>{c === 0 && ((isTicket && grants.includes("tickets.view")) || (!isTicket && !isProject && grants.includes("event_services.view"))) ? <a href={isTicket ? `/tickets/${row.id}` : `/event-services/${encodeURIComponent(String(row.trackingNumber))}`}>{cellValue(row, col, zone, report.filters?.currency)}</a> : cellValue(row, col, zone, report.filters?.currency)}</td>)}<td><button className="button secondary" aria-label={`Exclude ${String(row.ticketNumber ?? row.trackingNumber ?? row.projectName)}`} title="Exclude from this report only" disabled={!fresh || dirty || excluded.length >= REPORT_MAX_EXCLUSIONS} onClick={() => excludeRecord(row)}><X size={14} /></button></td></tr>) : <tr><td colSpan={columns.length + 1}>No matching records. Adjust the filters to broaden the report.</td></tr>}</tbody></table></div>{!isProject ? <div className="report-pagination"><label>Rows<select value={applied.pageSize} disabled={!fresh || dirty} onChange={(e) => { const next = { ...applied, pageSize: e.target.value, page: "1" }; updateResultFilters(next); }}>{[25, 50, 100].map((n) => <option key={n}>{n}</option>)}</select></label><span>Page {report.page} of {report.totalPages}</span><button className="button secondary" disabled={!fresh || dirty || report.page === 1} onClick={() => page((report.page ?? 1) - 1)}>Previous</button><button className="button secondary" disabled={!fresh || dirty || report.page === report.totalPages} onClick={() => page((report.page ?? 1) + 1)}>Next</button></div> : null}</section> : null}
      </div> : null}
    </> : null}
    {tab === "saved" ? <section className="panel report-management"><h2>Saved reports</h2><p className="muted">Save filters, relative periods, ordered columns and document layout. Private reports are visible only to their creator. Shared reports are available to report users in this organization.</p><div className="report-form-grid"><label>Load saved report<select value={selected} onChange={(e) => selectDefinition(e.target.value)}><option value="">Choose a report</option>{definitions.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.isShared ? "Shared" : "Private"}</option>)}</select></label><label>Start from a template<select value="" onChange={(e) => selectTemplate(e.target.value)}><option value="">Choose a template</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label></div>{canManage ? <><div className="report-form-grid"><label>Report name<input value={saveName} maxLength={120} onChange={(e) => setSaveName(e.target.value)} /></label><label>Description<input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} /></label><label>Visibility<select value={shared ? "shared" : "private"} onChange={(e) => setShared(e.target.value === "shared")}><option value="private">Private to me</option><option value="shared">Shared within organization</option></select></label></div><div className="report-actions"><button className="button" disabled={busy || dirty || !fresh} onClick={() => void save(false)}><Save size={15} />Save as new</button><button className="button secondary" disabled={busy || dirty || !fresh || !selected} onClick={() => void save(true)}>Update selected</button><button className="button secondary" disabled={busy || !selected} onClick={() => { if (window.confirm("Delete this saved report and its schedules?")) void action(async () => { await apiFetch(`/reports/definitions/${selected}`, { method: "DELETE" }); setSelected(""); await loadMeta(); }, "Saved report deleted."); }}><Trash2 size={15} />Delete selected</button></div><p className="muted">Save uses the applied report criteria and current export options. Apply pending filters first.</p></> : null}</section> : null}
    {tab === "schedules" ? <section className="panel report-management"><h2><CalendarClock size={20} />Scheduled reports</h2><p className="muted">Relative periods are recalculated at each run. Monthly days 29–31 use the last available day in shorter months. Nonexistent daylight-saving times move forward to a valid local hour. Only your schedules are shown.</p>{canManage && canSend ? <><div className="report-form-grid"><label>Saved report<select disabled={Boolean(scheduleId)} value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">Choose saved report</option>{definitions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label>Schedule name<input value={scheduleName} maxLength={120} onChange={(e) => setScheduleName(e.target.value)} /></label><label>Frequency<select value={frequency} onChange={(e) => setFrequency(e.target.value)}>{["daily", "weekly", "monthly"].map((f) => <option key={f} value={f}>{label(f)}</option>)}</select></label><label>Local time<input type="time" value={timing.time} onChange={(e) => setTiming({ ...timing, time: e.target.value })} /></label><label>Schedule timezone<input value={timing.timeZone} onChange={(e) => setTiming({ ...timing, timeZone: e.target.value })} /></label>{frequency === "weekly" ? <label>Weekday<select value={timing.weekDay} onChange={(e) => setTiming({ ...timing, weekDay: Number(e.target.value) })}>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, i) => <option key={day} value={i}>{day}</option>)}</select></label> : frequency === "monthly" ? <label>Day of month<input type="number" min={1} max={31} value={timing.monthDay} onChange={(e) => setTiming({ ...timing, monthDay: Number(e.target.value) })} /></label> : null}<label>File format<select value={scheduleFormat} onChange={(e) => setScheduleFormat(e.target.value)}>{["pdf", "xlsx", "csv"].map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}</select></label><label>Recipient emails<input value={scheduleRecipients} placeholder="Separate addresses with commas" onChange={(e) => setScheduleRecipients(e.target.value)} /></label></div>{selectedDefinition ? <p className="report-criteria">Uses “{selectedDefinition.name}”: {String(selectedDefinition.filters.period ?? "custom dates")}. Saved dates: {String(selectedDefinition.filters.startDate ?? "relative")}–{String(selectedDefinition.filters.endDate ?? "relative")}. Unsaved changes are not included.</p> : null}<div className="report-actions"><button className="button" disabled={busy || !selected} onClick={() => void saveSchedule()}>{scheduleId ? "Save schedule changes" : "Create schedule"}</button>{scheduleId ? <button className="button secondary" onClick={() => setScheduleId("")}>Cancel edit</button> : null}</div></> : null}
      <div className="report-record-list">{schedules.length ? schedules.map((item) => <article key={item.id}><div><strong>{item.name}</strong><p>{item.definition.name} · {item.format.toUpperCase()} · {item.frequency} · {item.isActive ? "Active" : "Paused"}</p><p>{item.recipientEmails.join(", ")}</p><small>Next: {item.nextRunAt ? localDate(item.nextRunAt, item.timing?.timeZone ?? zone) : "Not scheduled"} ({item.timing?.timeZone ?? zone}) · Last: {item.lastStatus === "accepted" ? "Accepted by mail provider" : item.lastStatus === "running" ? "Delivery in progress or awaiting verification" : item.lastStatus ?? "Not run"}</small>{item.lastError ? <p className="error-banner">{item.lastError}</p> : null}</div>{canManage && canSend ? <div className="report-actions"><button className="button secondary" disabled={busy} onClick={() => editSchedule(item)}><Pencil size={14} />Edit</button><button className="button secondary" disabled={busy} onClick={() => void action(async () => { await apiFetch(`/reports/schedules/${item.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !item.isActive }) }); await loadMeta(); }, "Schedule updated.")}>{item.isActive ? "Pause" : "Resume"}</button><button className="button secondary" disabled={busy} onClick={() => { if (window.confirm("Delete this schedule?")) void action(async () => { await apiFetch(`/reports/schedules/${item.id}`, { method: "DELETE" }); await loadMeta(); }, "Schedule deleted."); }} aria-label={`Delete ${item.name}`}><Trash2 size={14} /></button></div> : null}</article>) : <p className="muted">No schedules created by you.</p>}</div>
    </section> : null}
    {tab === "history" ? <section className="panel report-management"><h2><History size={20} />Export history</h2><p className="muted">Your latest 50 export and delivery attempts. “Generated” confirms file generation. “Accepted” confirms provider acceptance, not delivery to the recipient.</p><div className="report-record-list">{history.length ? history.map((item) => <article key={item.id}><div><strong>{item.definitionName ?? names[kind]} · {item.format.toUpperCase()}</strong><p>{item.deliveryStatus === "accepted" ? "Accepted by mail provider" : item.deliveryStatus === "downloaded" || item.deliveryStatus === "emailed" ? `Legacy record: ${item.deliveryStatus}` : label(item.deliveryStatus)}{item.recipientEmail ? ` · ${item.recipientEmail}` : ""}</p>{item.errorMessage ? <p className="error-banner">{item.errorMessage}</p> : null}</div><time>{localDate(item.createdAt, zone)}</time></article>) : <p className="muted">No exports recorded for this user.</p>}</div></section> : null}
    {exportOpen ? <div className="report-dialog-backdrop" onClick={(e) => { if (e.target === e.currentTarget && !busy) setExportOpen(false); }}><section ref={dialogRef} className="report-dialog panel" role="dialog" aria-modal="true" aria-labelledby="report-export-title"><div className="report-dialog-heading"><div><h2 id="report-export-title"><FileText size={20} />Export options</h2><p className="muted">Choose the content and layout. These choices can be saved with a report.</p></div><button className="button secondary" disabled={busy} aria-label="Close export options" onClick={() => setExportOpen(false)}><X size={18} /></button></div><div className="report-dialog-body"><div className="report-form-grid"><label>Format<select value={format} onChange={(e) => setFormat(e.target.value)}>{["pdf", "xlsx", "csv"].map((f) => <option key={f} value={f}>{f === "xlsx" ? "Excel (.xlsx)" : f.toUpperCase()}</option>)}</select></label><label>Export scope<select value={presentation.scope} onChange={(e) => setPresentation({ ...presentation, scope: e.target.value })}><option value="all">All matching records ({total})</option>{!isProject ? <option value="page">Current page ({report?.detail.length ?? 0})</option> : null}</select></label><label>Report title<input value={presentation.title} maxLength={120} placeholder={`${names[kind]} report`} onChange={(e) => setPresentation({ ...presentation, title: e.target.value })} /></label>{format !== "csv" ? <><label>Paper<select value={presentation.paper} onChange={(e) => setPresentation({ ...presentation, paper: e.target.value })}><option value="LETTER">Letter</option><option value="A4">A4</option></select></label><label>Orientation<select value={presentation.orientation} onChange={(e) => setPresentation({ ...presentation, orientation: e.target.value })}><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></label></> : null}</div>{format !== "csv" ? <SectionPicker kind={kind} sections={sections} estimate={applied.estimateMode === "perTicket"} onChange={(value) => setPresentation({ ...presentation, sections: value })} /> : <p className="muted">CSV contains the selected detail columns and remaining records as a flat table. Use Excel or PDF for selected indicators and charts.</p>}<div className="report-columns-grid"><fieldset><legend>Available columns</legend>{REPORT_COLUMNS[kind].filter((col) => col.key !== "estimatedValue" || applied.estimateMode === "perTicket").map((col) => <label className="report-checkbox" key={col.key}><input type="checkbox" checked={presentation.columns.split(",").includes(col.key)} onChange={() => toggleColumn(col.key)} />{col.label}</label>)}</fieldset><fieldset><legend>Selected column order</legend>{columns.map((col, i) => <div className="report-column-order" key={col.key}><span>{i + 1}. {col.label}</span><button className="button secondary" disabled={i === 0} aria-label={`Move ${col.label} up`} onClick={() => moveColumn(i, -1)}><ArrowUp size={14} /></button><button className="button secondary" disabled={i === columns.length - 1} aria-label={`Move ${col.label} down`} onClick={() => moveColumn(i, 1)}><ArrowDown size={14} /></button></div>)}</fieldset></div><div className="report-export-preview"><strong>Export preview</strong><p>{report?.filters?.startDate} – {report?.filters?.endDate} · {zone}</p><p>{(format === "csv" || presentation.sections.includes("detail")) ? presentation.scope === "all" ? total : report?.detail.length ?? 0 : 0} detail records · {columns.length} columns · {(format === "csv" ? ["detail"] : sections).map((key) => REPORT_SECTIONS[kind].find((s) => s.key === key)?.label ?? key).join(", ")}</p><p className="muted">Summary and breakdowns cover all matching records, even when exporting only the current detail page. Wide PDFs repeat the first selected column in each table section. Data is refreshed when the export is generated.</p><div className="report-table-scroll"><table><thead><tr>{columns.map((col) => <th key={col.key} style={{ minWidth: (col.width ?? 20) * 7 }}>{col.label}</th>)}</tr></thead><tbody>{report?.detail.slice(0, 2).map((row, i) => <tr key={i}>{columns.map((col) => <td key={col.key} style={{ minWidth: (col.width ?? 20) * 7 }}>{cellValue(row, col, zone, report.filters?.currency)}</td>)}</tr>)}</tbody></table></div></div>{canSend ? <label>Email recipients<input value={recipients} placeholder="Separate addresses with commas" onChange={(e) => setRecipients(e.target.value)} /></label> : null}{error ? <div role="alert" className="error-banner">{error}</div> : null}{notice ? <p role="status">{notice}</p> : null}</div><div className="report-dialog-footer"><span className="muted">{busy ? "Preparing report…" : dirty ? "Apply changed filters before exporting." : "Layout uses organization branding."}</span>{canSend ? <button className="button secondary" disabled={!fresh || dirty || busy || !recipients.trim()} onClick={() => void send()}><Mail size={15} />Send email</button> : null}{canExport ? <button className="button" disabled={!fresh || dirty || busy} onClick={() => void download()}><Download size={15} />Download {format.toUpperCase()}</button> : null}</div></section></div> : null}
  </div>;
}
