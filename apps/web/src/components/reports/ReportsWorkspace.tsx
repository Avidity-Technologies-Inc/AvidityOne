"use client";
import { QcContextLink } from "@/components/qc/QcContextLink";

import { CalendarClock, ChevronDown, ChevronUp, Download, FileSpreadsheet, FileText, Filter, History, Mail, RefreshCw, Save, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiBaseUrl, apiFetch } from "@/lib/api";

interface ReportOption {
  id: string;
  name: string;
}

type ReportType = "ticket-report" | "event-service-report";

interface TicketReportSummary {
  filters: {
    startDate: string;
    endDate: string;
    groupBy: "day" | "week" | "month" | "year";
    estimateMode: "none" | "perTicket";
    valuePerTicket: number | null;
    page: number;
    pageSize: number;
  };
  options: {
    clients: ReportOption[];
    users: ReportOption[];
    teams: ReportOption[];
    statuses: string[];
    priorities: string[];
    sources: string[];
  };
  summary: {
    totalTickets: number;
    activeTickets: number;
    closedTickets: number;
    resolvedTickets: number;
    unassignedTickets: number;
    highPriorityTickets: number;
    withAttachments: number;
    withoutAttachments: number;
    estimatedTotal: number | null;
  };
  activity: Array<{ period: string; label: string; created: number; closed: number; resolved: number }>;
  byStatus: Array<{ label: string; count: number }>;
  byPriority: Array<{ label: string; count: number }>;
  bySource: Array<{ label: string; count: number }>;
  byClient: Array<{ label: string; count: number }>;
  byTechnician: Array<{ label: string; count: number }>;
  byTeam: Array<{ label: string; count: number }>;
  detail: Array<{
    ticketNumber: string;
    subject: string;
    clientName: string;
    requester: string;
    status: string;
    statusDefinition: { id: string; name: string; color: string } | null;
    priority: string;
    source: string;
    assignedTo: string;
    team: string;
    createdAt: string;
    updatedAt: string;
    closedAt: string | null;
    attachmentCount: number;
    estimatedValue: number | null;
  }>;
  detailLimit: number;
  page: number;
  pageSize: number;
  totalPages: number;
  totalMatched: number;
}

interface EventReportSummary {
  filters: {
    startDate: string;
    endDate: string;
    groupBy: "day" | "week" | "month" | "year";
    page: number;
    pageSize: number;
  };
  options: {
    clients: ReportOption[];
    users: ReportOption[];
    services: ReportOption[];
    statuses: string[];
    priorities: string[];
  };
  summary: {
    totalRequests: number;
    newRequests: number;
    assignedRequests: number;
    completedRequests: number;
    cancelledRequests: number;
    totalTasks: number;
    openTasks: number;
    completedTasks: number;
  };
  activity: Array<{ period: string; label: string; created: number; completed: number; cancelled: number }>;
  byStatus: Array<{ label: string; count: number }>;
  byPriority: Array<{ label: string; count: number }>;
  byService: Array<{ label: string; count: number }>;
  byClient: Array<{ label: string; count: number }>;
  byTechnician: Array<{ label: string; count: number }>;
  byTaskStatus: Array<{ label: string; count: number }>;
  detail: Array<{
    trackingNumber: string;
    eventName: string;
    clientName: string;
    requester: string;
    requesterEmail: string;
    eventDate: string;
    time: string;
    services: string;
    status: string;
    priority: string;
    assignedTo: string;
    taskCount: number;
    completedTaskCount: number;
    updatedAt: string;
  }>;
  detailLimit: number;
  page: number;
  pageSize: number;
  totalPages: number;
  totalMatched: number;
}

type ReportSummary = TicketReportSummary | EventReportSummary;

interface SavedReport {
  id: string;
  name: string;
  description: string | null;
  reportType: string;
  filters: Partial<{
    startDate: string;
    endDate: string;
    groupBy: "day" | "week" | "month" | "year";
    clientId: string;
    assignedUserId: string;
    assignedTeamId: string;
    serviceId: string;
    statuses: string[];
    priority: string;
    source: string;
    attachments: "all" | "with" | "without";
    estimateMode: "none" | "perTicket";
    valuePerTicket: string;
  }>;
  updatedAt: string;
  createdBy: string | null;
}

interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  filters: SavedReport["filters"];
}

interface ReportSchedule {
  id: string;
  name: string;
  frequency: "daily" | "weekly" | "monthly";
  format: "csv" | "xlsx" | "pdf";
  recipientEmails: string[];
  isActive: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  definition: { name: string };
}

interface ReportExportHistory {
  id: string;
  reportType: string;
  format: string;
  recipientEmail: string | null;
  deliveryStatus: string;
  errorMessage: string | null;
  createdAt: string;
  definitionName: string | null;
  requestedBy: string | null;
}

const chartColors = ["#4f7cff", "#16a34a", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#64748b", "#ec4899"];

function defaultStartDate() {
  const date = new Date();
  date.setDate(date.getDate() - 29);
  return date.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function label(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" });
}

function currency(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(value);
}

function isTicketReportSummary(value: ReportSummary | null): value is TicketReportSummary {
  return Boolean(value && "totalTickets" in value.summary);
}

function isEventReportSummary(value: ReportSummary | null): value is EventReportSummary {
  return Boolean(value && "totalRequests" in value.summary);
}

function SummaryCard({ title, value, note }: { title: string; value: string | number; note: string }) {
  return (
    <div className="dashboard-kpi-card report-kpi-card">
      <span className="muted">{title}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function ActivityChart({ items }: { items: TicketReportSummary["activity"] }) {
  const maxValue = Math.max(1, ...items.flatMap((item) => [item.created, item.closed, item.resolved]));
  return (
    <div className="panel dashboard-chart-card dashboard-wide-card report-chart-card">
      <div className="report-card-heading">
        <h2>Ticket Activity</h2>
        <p className="muted">Created, resolved, and closed tickets in the selected period.</p>
      </div>
      <div className="report-activity-chart">
        {items.map((item, index) => (
          <div className="report-activity-day" key={item.period} title={`${item.period}: ${item.created} created, ${item.resolved} resolved, ${item.closed} closed`}>
            <div className="report-activity-bars">
              <span className="created" style={{ height: `${Math.max(5, (item.created / maxValue) * 100)}%` }} />
              <span className="resolved" style={{ height: `${Math.max(5, (item.resolved / maxValue) * 100)}%` }} />
              <span className="closed" style={{ height: `${Math.max(5, (item.closed / maxValue) * 100)}%` }} />
            </div>
            {index % 4 === 0 || index === items.length - 1 ? <small>{item.label}</small> : <small />}
          </div>
        ))}
      </div>
      <div className="dashboard-chart-legend">
        <span><i className="created" /> Created</span>
        <span><i className="resolved" /> Resolved</span>
        <span><i className="closed" /> Closed</span>
      </div>
    </div>
  );
}

function EventActivityChart({ items }: { items: EventReportSummary["activity"] }) {
  const maxValue = Math.max(1, ...items.flatMap((item) => [item.created, item.completed, item.cancelled]));
  return (
    <div className="panel dashboard-chart-card dashboard-wide-card report-chart-card">
      <div className="report-card-heading">
        <h2>Event Activity</h2>
        <p className="muted">Created, completed, and cancelled event requests in the selected period.</p>
      </div>
      <div className="report-activity-chart">
        {items.map((item, index) => (
          <div className="report-activity-day" key={item.period} title={`${item.period}: ${item.created} created, ${item.completed} completed, ${item.cancelled} cancelled`}>
            <div className="report-activity-bars">
              <span className="created" style={{ height: `${Math.max(5, (item.created / maxValue) * 100)}%` }} />
              <span className="resolved" style={{ height: `${Math.max(5, (item.completed / maxValue) * 100)}%` }} />
              <span className="cancelled" style={{ height: `${Math.max(5, (item.cancelled / maxValue) * 100)}%` }} />
            </div>
            {index % 4 === 0 || index === items.length - 1 ? <small>{item.label}</small> : <small />}
          </div>
        ))}
      </div>
      <div className="dashboard-chart-legend">
        <span><i className="created" /> Created</span>
        <span><i className="resolved" /> Completed</span>
        <span><i className="cancelled" /> Cancelled</span>
      </div>
    </div>
  );
}

function HorizontalBars({ title, subtitle, items }: { title: string; subtitle: string; items: Array<{ label: string; count: number }> }) {
  const maxValue = Math.max(1, ...items.map((item) => item.count));
  return (
    <div className="panel dashboard-chart-card report-chart-card">
      <div className="report-card-heading">
        <h2>{title}</h2>
        <p className="muted">{subtitle}</p>
      </div>
      <div className="dashboard-horizontal-bars">
        {items.length ? items.map((item, index) => (
          <div className="dashboard-horizontal-row" key={item.label}>
            <span>{label(item.label)}</span>
            <strong>{item.count}</strong>
            <i style={{ width: `${Math.max(8, (item.count / maxValue) * 100)}%`, backgroundColor: chartColors[index % chartColors.length] }} />
          </div>
        )) : <p className="muted">No data for this range.</p>}
      </div>
    </div>
  );
}

export function ReportsWorkspace() {
  const [reportType, setReportType] = useState<ReportType>("ticket-report");
  const [startDate, setStartDate] = useState(defaultStartDate());
  const [endDate, setEndDate] = useState(today());
  const [groupBy, setGroupBy] = useState<"day" | "week" | "month" | "year">("day");
  const [clientId, setClientId] = useState("");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [assignedTeamId, setAssignedTeamId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [priority, setPriority] = useState("");
  const [source, setSource] = useState("");
  const [attachments, setAttachments] = useState<"all" | "with" | "without">("all");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [estimateMode, setEstimateMode] = useState<"none" | "perTicket">("none");
  const [valuePerTicket, setValuePerTicket] = useState("0");
  const [detailPage, setDetailPage] = useState(1);
  const [detailPageSize, setDetailPageSize] = useState("25");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showReportTools, setShowReportTools] = useState(false);
  const [data, setData] = useState<ReportSummary | null>(null);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [exportHistory, setExportHistory] = useState<ReportExportHistory[]>([]);
  const [selectedSavedReportId, setSelectedSavedReportId] = useState("");
  const [saveName, setSaveName] = useState("");
  const [saveDescription, setSaveDescription] = useState("");
  const [emailRecipients, setEmailRecipients] = useState("");
  const [emailFormat, setEmailFormat] = useState<"csv" | "xlsx" | "pdf">("pdf");
  const [scheduleName, setScheduleName] = useState("");
  const [scheduleFrequency, setScheduleFrequency] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [scheduleFormat, setScheduleFormat] = useState<"csv" | "xlsx" | "pdf">("pdf");
  const [scheduleRecipients, setScheduleRecipients] = useState("");
  const [savedBusy, setSavedBusy] = useState(false);
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("startDate", startDate);
    params.set("endDate", endDate);
    params.set("groupBy", groupBy);
    if (clientId) params.set("clientId", clientId);
    if (assignedUserId) params.set("assignedUserId", assignedUserId);
    if (reportType === "ticket-report" && assignedTeamId) params.set("assignedTeamId", assignedTeamId);
    if (reportType === "event-service-report" && serviceId) params.set("serviceId", serviceId);
    if (statuses.length) params.set("statuses", statuses.join(","));
    if (priority) params.set("priority", priority);
    if (source) params.set("source", source);
    if (attachments !== "all") params.set("attachments", attachments);
    if (estimateMode === "perTicket") {
      params.set("estimateMode", estimateMode);
      params.set("valuePerTicket", valuePerTicket || "0");
    }
    params.set("page", String(detailPage));
    params.set("pageSize", detailPageSize);
    return params;
  }, [assignedTeamId, assignedUserId, attachments, clientId, detailPage, detailPageSize, endDate, estimateMode, groupBy, priority, reportType, serviceId, source, startDate, statuses, valuePerTicket]);

  useEffect(() => {
    setDetailPage(1);
  }, [assignedTeamId, assignedUserId, attachments, clientId, endDate, estimateMode, groupBy, priority, reportType, serviceId, source, startDate, statuses, valuePerTicket]);

  async function loadReport() {
    setLoading(true);
    setError("");
    try {
      const endpoint = reportType === "ticket-report" ? "/reports/tickets/summary" : "/reports/event-services/summary";
      const result = await apiFetch<ReportSummary>(`${endpoint}?${query.toString()}`);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load report.");
    } finally {
      setLoading(false);
    }
  }

  async function loadSavedReports() {
    try {
      const reports = await apiFetch<SavedReport[]>(`/reports/definitions?reportType=${reportType}`);
      setSavedReports(reports);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load saved reports.");
    }
  }

  async function loadReportMeta() {
    try {
      const [templateResult, scheduleResult, exportResult] = await Promise.all([
        apiFetch<ReportTemplate[]>(`/reports/templates?reportType=${reportType}`),
        apiFetch<ReportSchedule[]>(`/reports/schedules?reportType=${reportType}`),
        apiFetch<ReportExportHistory[]>(`/reports/exports?reportType=${reportType}`)
      ]);
      setTemplates(templateResult);
      setSchedules(scheduleResult);
      setExportHistory(exportResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load report metadata.");
    }
  }

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    void loadSavedReports();
    void loadReportMeta();
    setSelectedSavedReportId("");
    setSaveName("");
    setSaveDescription("");
    setStatuses([]);
    setData(null);
    setLoading(true);
  }, [reportType]);

  function currentFilters(): SavedReport["filters"] {
    if (reportType === "event-service-report") {
      return {
        startDate,
        endDate,
        groupBy,
        clientId,
        assignedUserId,
        serviceId,
        statuses,
        priority
      };
    }

    return {
      startDate,
      endDate,
      groupBy,
      clientId,
      assignedUserId,
      assignedTeamId,
      statuses,
      priority,
      source,
      attachments,
      estimateMode,
      valuePerTicket
    };
  }

  function applyFilters(filters: SavedReport["filters"]) {
    setStartDate(filters.startDate ?? defaultStartDate());
    setEndDate(filters.endDate ?? today());
    setGroupBy(filters.groupBy ?? "day");
    setClientId(filters.clientId ?? "");
    setAssignedUserId(filters.assignedUserId ?? "");
    setAssignedTeamId(filters.assignedTeamId ?? "");
    setServiceId(filters.serviceId ?? "");
    setStatuses(Array.isArray(filters.statuses) ? filters.statuses : []);
    setPriority(filters.priority ?? "");
    setSource(filters.source ?? "");
    setAttachments(filters.attachments ?? "all");
    setEstimateMode(filters.estimateMode ?? "none");
    setValuePerTicket(filters.valuePerTicket ?? "0");
  }

  function applySavedReport(reportId: string) {
    setSelectedSavedReportId(reportId);
    const report = savedReports.find((item) => item.id === reportId);
    if (!report) return;
    applyFilters(report.filters);
    setSaveName(report.name);
    setSaveDescription(report.description ?? "");
  }

  function applyTemplate(templateId: string) {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    applyFilters({ ...currentFilters(), ...template.filters });
    setSaveName(template.name);
    setSaveDescription(template.description);
  }

  async function saveReport() {
    const name = saveName.trim();
    if (!name) {
      setError("Enter a report name before saving.");
      return;
    }
    setSavedBusy(true);
    setError("");
    try {
      const report = await apiFetch<SavedReport>("/reports/definitions", {
        method: "POST",
        body: JSON.stringify({ name, description: saveDescription.trim() || undefined, reportType, filters: currentFilters() })
      });
      await loadSavedReports();
      setSelectedSavedReportId(report.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save report.");
    } finally {
      setSavedBusy(false);
    }
  }

  async function updateSavedReport() {
    if (!selectedSavedReportId) return;
    setSavedBusy(true);
    setError("");
    try {
      await apiFetch<SavedReport>(`/reports/definitions/${selectedSavedReportId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: saveName.trim(), description: saveDescription.trim(), filters: currentFilters() })
      });
      await loadSavedReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update saved report.");
    } finally {
      setSavedBusy(false);
    }
  }

  async function deleteSavedReport() {
    if (!selectedSavedReportId || !window.confirm("Delete this saved report?")) return;
    setSavedBusy(true);
    setError("");
    try {
      await apiFetch(`/reports/definitions/${selectedSavedReportId}`, { method: "DELETE" });
      setSelectedSavedReportId("");
      setSaveName("");
      setSaveDescription("");
      await loadSavedReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete saved report.");
    } finally {
      setSavedBusy(false);
    }
  }

  function splitEmails(value: string) {
    return value.split(/[,\n;]/).map((item) => item.trim()).filter(Boolean);
  }

  async function sendReport() {
    const recipients = splitEmails(emailRecipients);
    if (!recipients.length) {
      setError("Enter at least one email recipient.");
      return;
    }
    setDeliveryBusy(true);
    setError("");
    try {
      const endpoint = reportType === "ticket-report" ? "/reports/tickets/send" : "/reports/event-services/send";
      await apiFetch(`${endpoint}?${query.toString()}&format=${emailFormat}`, {
        method: "POST",
        body: JSON.stringify({ recipientEmails: recipients, format: emailFormat })
      });
      setEmailRecipients("");
      await loadReportMeta();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send report.");
    } finally {
      setDeliveryBusy(false);
    }
  }

  async function createSchedule() {
    if (!selectedSavedReportId) {
      setError("Select a saved report before scheduling.");
      return;
    }
    const recipients = splitEmails(scheduleRecipients);
    if (!recipients.length) {
      setError("Enter at least one schedule recipient.");
      return;
    }
    setDeliveryBusy(true);
    setError("");
    try {
      await apiFetch("/reports/schedules", {
        method: "POST",
        body: JSON.stringify({
          definitionId: selectedSavedReportId,
          name: scheduleName.trim() || saveName.trim() || (reportType === "ticket-report" ? "Scheduled Ticket Report" : "Scheduled Event Services Report"),
          frequency: scheduleFrequency,
          format: scheduleFormat,
          recipientEmails: recipients,
          isActive: true
        })
      });
      setScheduleName("");
      setScheduleRecipients("");
      await loadReportMeta();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create report schedule.");
    } finally {
      setDeliveryBusy(false);
    }
  }

  async function toggleSchedule(schedule: ReportSchedule) {
    setDeliveryBusy(true);
    setError("");
    try {
      await apiFetch(`/reports/schedules/${schedule.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !schedule.isActive })
      });
      await loadReportMeta();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update report schedule.");
    } finally {
      setDeliveryBusy(false);
    }
  }

  async function deleteSchedule(scheduleId: string) {
    if (!window.confirm("Delete this report schedule?")) return;
    setDeliveryBusy(true);
    setError("");
    try {
      await apiFetch(`/reports/schedules/${scheduleId}`, { method: "DELETE" });
      await loadReportMeta();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete report schedule.");
    } finally {
      setDeliveryBusy(false);
    }
  }

  function toggleStatus(status: string) {
    setStatuses((current) => current.includes(status) ? current.filter((item) => item !== status) : [...current, status]);
  }

  function exportReport(format: "csv" | "xlsx" | "pdf") {
    const endpoint = reportType === "ticket-report" ? "/reports/tickets/export" : "/reports/event-services/export";
    window.location.href = `${apiBaseUrl}${endpoint}?${query.toString()}&format=${format}`;
    setTimeout(() => void loadReportMeta(), 1000);
  }

  const isTicketReport = reportType === "ticket-report";
  const ticketData = isTicketReport && isTicketReportSummary(data) ? data : null;
  const eventData = !isTicketReport && isEventReportSummary(data) ? data : null;
  const activeData = ticketData ?? eventData;
  const options = activeData?.options;
  const totalPages = activeData?.totalPages ?? 1;
  const firstDetailRow = activeData && activeData.totalMatched > 0 ? ((activeData.page - 1) * activeData.pageSize) + 1 : 0;
  const lastDetailRow = activeData ? Math.min(activeData.totalMatched, activeData.page * activeData.pageSize) : 0;

  return (
    <div className="reports-workspace">
      {error ? <div className="error-banner">{error}</div> : null}
      <section className="panel reports-filter-panel">
        <div className="section-heading compact-heading reports-filter-heading">
          <div>
            <h2>{isTicketReport ? "Ticket Reports" : "Event & Services Reports"}</h2>
            <p className="muted">{isTicketReport ? "Operational ticket performance, workload, status, and export reporting." : "Event request volume, service workload, task status, and export reporting."}</p>
          </div>
          <div className="form-actions reports-header-actions"><QcContextLink href="/qc/scorecards" label="Quality reports" />
            <div className="segmented-control reports-type-tabs">
              <button className={isTicketReport ? "active" : ""} type="button" aria-pressed={isTicketReport} onClick={() => setReportType("ticket-report")}>Tickets</button>
              <button className={!isTicketReport ? "active" : ""} type="button" aria-pressed={!isTicketReport} onClick={() => setReportType("event-service-report")}>Events & Services</button>
            </div>
            <button className="button secondary" type="button" onClick={() => void loadReport()}>
              <RefreshCw size={16} aria-hidden="true" />
              <span>Refresh</span>
            </button>
            <button className="button" type="button" onClick={() => exportReport("csv")} disabled={!activeData}>
              <Download size={16} aria-hidden="true" />
              <span>Export CSV</span>
            </button>
            <button className="button secondary" type="button" onClick={() => exportReport("xlsx")} disabled={!activeData}>
              <FileSpreadsheet size={16} aria-hidden="true" />
              <span>Excel</span>
            </button>
            <button className="button secondary" type="button" onClick={() => exportReport("pdf")} disabled={!activeData}>
              <FileText size={16} aria-hidden="true" />
              <span>PDF</span>
            </button>
            <button className="button secondary" type="button" onClick={() => setShowReportTools((current) => !current)}>
              {showReportTools ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
              <span>Report Tools</span>
            </button>
          </div>
        </div>
        {showReportTools ? (
          <div className="reports-tools-panel">
            <div className="reports-saved-row">
              <select className="input" defaultValue="" onChange={(event) => applyTemplate(event.target.value)}>
                <option value="">Report templates</option>
                {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
              <select className="input" value={selectedSavedReportId} onChange={(event) => applySavedReport(event.target.value)}>
                <option value="">Saved reports</option>
                {savedReports.map((report) => <option key={report.id} value={report.id}>{report.name}</option>)}
              </select>
              <input className="input" value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="Report name" />
              <input className="input" value={saveDescription} onChange={(event) => setSaveDescription(event.target.value)} placeholder="Optional description" />
              <button className="button secondary" type="button" onClick={saveReport} disabled={savedBusy}>
                <Save size={16} aria-hidden="true" />
                <span>Save</span>
              </button>
              <button className="button secondary" type="button" onClick={updateSavedReport} disabled={savedBusy || !selectedSavedReportId}>
                <span>Update</span>
              </button>
              <button className="button secondary danger-soft" type="button" onClick={deleteSavedReport} disabled={savedBusy || !selectedSavedReportId}>
                <Trash2 size={16} aria-hidden="true" />
                <span>Delete</span>
              </button>
            </div>
            <div className="reports-delivery-grid">
              <div className="reports-delivery-card">
                <h3><Mail size={16} aria-hidden="true" /> Send Report</h3>
                <div className="reports-inline-controls">
                  <input className="input" value={emailRecipients} onChange={(event) => setEmailRecipients(event.target.value)} placeholder="email@domain.com, manager@domain.com" />
                  <select className="input" value={emailFormat} onChange={(event) => setEmailFormat(event.target.value as typeof emailFormat)}>
                    <option value="pdf">PDF</option>
                    <option value="xlsx">Excel</option>
                    <option value="csv">CSV</option>
                  </select>
                  <button className="button" type="button" onClick={sendReport} disabled={deliveryBusy || !activeData}>
                    Send
                  </button>
                </div>
              </div>
              <div className="reports-delivery-card">
                <h3><CalendarClock size={16} aria-hidden="true" /> Schedule Saved Report</h3>
                <div className="reports-inline-controls">
                  <input className="input" value={scheduleName} onChange={(event) => setScheduleName(event.target.value)} placeholder="Schedule name" />
                  <select className="input" value={scheduleFrequency} onChange={(event) => setScheduleFrequency(event.target.value as typeof scheduleFrequency)}>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                  <select className="input" value={scheduleFormat} onChange={(event) => setScheduleFormat(event.target.value as typeof scheduleFormat)}>
                    <option value="pdf">PDF</option>
                    <option value="xlsx">Excel</option>
                    <option value="csv">CSV</option>
                  </select>
                  <input className="input" value={scheduleRecipients} onChange={(event) => setScheduleRecipients(event.target.value)} placeholder="Recipients" />
                  <button className="button secondary" type="button" onClick={createSchedule} disabled={deliveryBusy || !selectedSavedReportId}>
                    Create
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        <div className="reports-filter-grid">
          <label className="report-filter-field">
            <span>Start date</span>
            <input className="input" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </label>
          <label className="report-filter-field">
            <span>End date</span>
            <input className="input" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </label>
          <label className="report-filter-field">
            <span>Grouping</span>
            <select className="input" value={groupBy} onChange={(event) => setGroupBy(event.target.value as typeof groupBy)}>
              <option value="day">By day</option>
              <option value="week">By week</option>
              <option value="month">By month</option>
              <option value="year">By year</option>
            </select>
          </label>
          <label className="report-filter-field">
            <span>Client</span>
            <select className="input" value={clientId} onChange={(event) => setClientId(event.target.value)}>
              <option value="">All clients</option>
              {options?.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
          </label>
        </div>
        <button className="button secondary reports-advanced-toggle" type="button" onClick={() => setShowAdvancedFilters((current) => !current)}>
          <SlidersHorizontal size={16} aria-hidden="true" />
          <span>{showAdvancedFilters ? "Hide Advanced Filters" : "Show Advanced Filters"}</span>
          {showAdvancedFilters ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
        </button>
        {showAdvancedFilters ? (
          <div className="reports-advanced-panel">
            <div className="reports-filter-grid reports-advanced-grid">
              <label className="report-filter-field">
                <span>{isTicketReport ? "Technician" : "Specialist"}</span>
                <select className="input" value={assignedUserId} onChange={(event) => setAssignedUserId(event.target.value)}>
                  <option value="">{isTicketReport ? "All technicians" : "All specialists"}</option>
                  {options?.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                </select>
              </label>
              {isTicketReport ? (
                <label className="report-filter-field">
                  <span>Team</span>
                  <select className="input" value={assignedTeamId} onChange={(event) => setAssignedTeamId(event.target.value)}>
                    <option value="">All teams</option>
                    {ticketData?.options.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                  </select>
                </label>
              ) : (
                <label className="report-filter-field">
                  <span>Service</span>
                  <select className="input" value={serviceId} onChange={(event) => setServiceId(event.target.value)}>
                    <option value="">All services</option>
                    {eventData?.options.services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
                  </select>
                </label>
              )}
              <label className="report-filter-field">
                <span>Priority</span>
                <select className="input" value={priority} onChange={(event) => setPriority(event.target.value)}>
                  <option value="">All priorities</option>
                  {options?.priorities.map((item) => <option key={item} value={item}>{label(item)}</option>)}
                </select>
              </label>
              {isTicketReport ? (
                <>
                  <label className="report-filter-field">
                    <span>Source</span>
                    <select className="input" value={source} onChange={(event) => setSource(event.target.value)}>
                      <option value="">All sources</option>
                      {ticketData?.options.sources.map((item) => <option key={item} value={item}>{label(item)}</option>)}
                    </select>
                  </label>
                  <label className="report-filter-field">
                    <span>Attachments</span>
                    <select className="input" value={attachments} onChange={(event) => setAttachments(event.target.value as typeof attachments)}>
                      <option value="all">All attachments</option>
                      <option value="with">With attachments</option>
                      <option value="without">Without attachments</option>
                    </select>
                  </label>
                  <label className="report-filter-field">
                    <span>Estimate</span>
                    <select className="input" value={estimateMode} onChange={(event) => setEstimateMode(event.target.value as typeof estimateMode)}>
                      <option value="none">No estimate</option>
                      <option value="perTicket">Value per ticket</option>
                    </select>
                  </label>
                  <label className="report-filter-field">
                    <span>Value</span>
                    <input className="input" type="number" min="0" step="0.01" value={valuePerTicket} onChange={(event) => setValuePerTicket(event.target.value)} disabled={estimateMode === "none"} placeholder="Value per ticket" />
                  </label>
                </>
              ) : null}
            </div>
            <div className="reports-status-filter">
              <span><Filter size={14} aria-hidden="true" /> Status</span>
              <div>
                {options?.statuses.map((item) => (
                  <label className="checkbox-row" key={item}>
                    <input type="checkbox" checked={statuses.includes(item)} onChange={() => toggleStatus(item)} />
                    {label(item)}
                  </label>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {loading ? <div className="panel dashboard-loading">Loading report...</div> : null}

      {activeData && !loading ? (
        <>
          <section className="dashboard-kpi-grid reports-kpi-grid">
            {ticketData ? (
              <>
                <SummaryCard title="Total tickets" value={ticketData.summary.totalTickets} note="Created in range" />
                <SummaryCard title="Active tickets" value={ticketData.summary.activeTickets} note="Current active workload" />
                <SummaryCard title="Closed tickets" value={ticketData.summary.closedTickets} note="Closed in result set" />
                <SummaryCard title="Resolved tickets" value={ticketData.summary.resolvedTickets} note="Resolved in result set" />
                <SummaryCard title="Unassigned" value={ticketData.summary.unassignedTickets} note="No owner" />
                <SummaryCard title="High priority" value={ticketData.summary.highPriorityTickets} note="High, urgent, critical" />
                <SummaryCard title="With attachments" value={ticketData.summary.withAttachments} note={`${ticketData.summary.withoutAttachments} without files`} />
                <SummaryCard title="Estimated total" value={currency(ticketData.summary.estimatedTotal)} note="Optional estimate" />
              </>
            ) : null}
            {eventData ? (
              <>
                <SummaryCard title="Total requests" value={eventData.summary.totalRequests} note="Created in range" />
                <SummaryCard title="New requests" value={eventData.summary.newRequests} note="Needs review" />
                <SummaryCard title="Assigned" value={eventData.summary.assignedRequests} note="Specialist workload" />
                <SummaryCard title="Completed" value={eventData.summary.completedRequests} note="Finished requests" />
                <SummaryCard title="Cancelled" value={eventData.summary.cancelledRequests} note="Cancelled requests" />
                <SummaryCard title="Total tasks" value={eventData.summary.totalTasks} note="All event tasks" />
                <SummaryCard title="Open tasks" value={eventData.summary.openTasks} note="Pending work" />
                <SummaryCard title="Completed tasks" value={eventData.summary.completedTasks} note="Done work" />
              </>
            ) : null}
          </section>

          <section className="dashboard-main-grid">
            {ticketData ? (
              <>
                <ActivityChart items={ticketData.activity} />
                <HorizontalBars title="Tickets by Status" subtitle="Distribution by current ticket state." items={ticketData.byStatus} />
                <HorizontalBars title="Tickets by Client" subtitle="Top clients in the selected period." items={ticketData.byClient} />
                <HorizontalBars title="Technician Workload" subtitle="Assigned ticket distribution." items={ticketData.byTechnician} />
                <HorizontalBars title="Tickets by Team" subtitle="Operational team distribution." items={ticketData.byTeam} />
                <HorizontalBars title="Tickets by Priority" subtitle="Urgency distribution." items={ticketData.byPriority} />
                <HorizontalBars title="Tickets by Source" subtitle="Where tickets entered the system." items={ticketData.bySource} />
              </>
            ) : null}
            {eventData ? (
              <>
                <EventActivityChart items={eventData.activity} />
                <HorizontalBars title="Requests by Status" subtitle="Distribution by current event state." items={eventData.byStatus} />
                <HorizontalBars title="Requests by Service" subtitle="Requested service mix." items={eventData.byService} />
                <HorizontalBars title="Specialist Workload" subtitle="Assigned request and task distribution." items={eventData.byTechnician} />
                <HorizontalBars title="Tasks by Status" subtitle="Event task completion state." items={eventData.byTaskStatus} />
                <HorizontalBars title="Requests by Client" subtitle="Top clients in the selected period." items={eventData.byClient} />
                <HorizontalBars title="Requests by Priority" subtitle="Urgency distribution." items={eventData.byPriority} />
              </>
            ) : null}
          </section>

          <section className="panel report-detail-panel">
            <div className="section-heading compact-heading">
              <div>
                <h2>Report Detail</h2>
                <p className="muted">Showing {firstDetailRow}-{lastDetailRow} of {activeData.totalMatched} {isTicketReport ? "tickets" : "event requests"}. Exports include the full filtered result.</p>
              </div>
            </div>
            <div className="table-scroll report-table-scroll">
              {ticketData ? (
              <table className="tickets-table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Subject</th>
                    <th>Client</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Assigned</th>
                    <th>Created</th>
                    <th>Files</th>
                    <th>Estimate</th>
                  </tr>
                </thead>
                <tbody>
                  {ticketData.detail.map((ticket) => (
                    <tr key={ticket.ticketNumber}>
                      <td>{ticket.ticketNumber}</td>
                      <td>
                        <span className="report-cell-stack">
                          <strong>{ticket.subject}</strong>
                          <span className="muted">{ticket.requester}</span>
                        </span>
                      </td>
                      <td>{ticket.clientName}</td>
                      <td><span className="status-pill" style={ticket.statusDefinition ? { color: ticket.statusDefinition.color, borderColor: `${ticket.statusDefinition.color}55`, backgroundColor: `${ticket.statusDefinition.color}18` } : undefined}>{ticket.statusDefinition?.name ?? label(ticket.status)}</span></td>
                      <td>{label(ticket.priority)}</td>
                      <td>
                        <span className="report-cell-stack">
                          <strong>{ticket.assignedTo}</strong>
                          <span className="muted">Team: {ticket.team}</span>
                        </span>
                      </td>
                      <td>{formatDate(ticket.createdAt)}</td>
                      <td>{ticket.attachmentCount}</td>
                      <td>{currency(ticket.estimatedValue)}</td>
                    </tr>
                  ))}
                  {ticketData.detail.length === 0 ? (
                    <tr>
                      <td colSpan={9}>No ticket detail rows match this report.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
              ) : null}
              {eventData ? (
              <table className="tickets-table">
                <thead>
                  <tr>
                    <th>Tracking</th>
                    <th>Event</th>
                    <th>Client</th>
                    <th>Date / Time</th>
                    <th>Services</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Assigned</th>
                    <th>Tasks</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {eventData.detail.map((request) => (
                    <tr key={request.trackingNumber}>
                      <td>{request.trackingNumber}</td>
                      <td>
                        <span className="report-cell-stack">
                          <strong>{request.eventName}</strong>
                          <span className="muted">{request.requester} | {request.requesterEmail}</span>
                        </span>
                      </td>
                      <td>{request.clientName}</td>
                      <td>
                        <span className="report-cell-stack">
                          <strong>{request.eventDate}</strong>
                          <span className="muted">{request.time}</span>
                        </span>
                      </td>
                      <td>{request.services}</td>
                      <td><span className={`status-pill event-status-${request.status.toLowerCase().replaceAll("_", "-")}`}>{label(request.status)}</span></td>
                      <td>{label(request.priority)}</td>
                      <td>{request.assignedTo}</td>
                      <td>{request.completedTaskCount}/{request.taskCount}</td>
                      <td>{formatDate(request.updatedAt)}</td>
                    </tr>
                  ))}
                  {eventData.detail.length === 0 ? (
                    <tr>
                      <td colSpan={10}>No event request detail rows match this report.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
              ) : null}
            </div>
            <div className="pagination-bar report-pagination-bar">
              <div className="form-actions">
                <span className="muted">Rows</span>
                <select className="input compact-select" value={detailPageSize} onChange={(event) => { setDetailPageSize(event.target.value); setDetailPage(1); }}>
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              </div>
              <div className="form-actions">
                <button className="button secondary" type="button" onClick={() => setDetailPage((current) => Math.max(1, current - 1))} disabled={detailPage <= 1}>
                  Previous
                </button>
                <span className="muted">Page {activeData.page} of {totalPages}</span>
                <button className="button secondary" type="button" onClick={() => setDetailPage((current) => Math.min(totalPages, current + 1))} disabled={detailPage >= totalPages}>
                  Next
                </button>
              </div>
            </div>
          </section>

          <section className="reports-admin-grid">
            <div className="panel reports-admin-panel">
              <div className="section-heading compact-heading">
                <div>
                  <h2><CalendarClock size={18} aria-hidden="true" /> Scheduled Reports</h2>
                  <p className="muted">Automatic report deliveries based on saved reports.</p>
                </div>
              </div>
              <div className="report-list-stack">
                {schedules.length ? schedules.map((schedule) => (
                  <div className="report-admin-row" key={schedule.id}>
                    <span className="report-cell-stack">
                      <strong>{schedule.name}</strong>
                      <span className="muted">{schedule.definition.name} | {label(schedule.frequency)} | {schedule.format.toUpperCase()}</span>
                    </span>
                    <span className="muted">{schedule.nextRunAt ? `Next: ${formatDate(schedule.nextRunAt)}` : "Paused"}</span>
                    <span className={`status-pill ${schedule.isActive ? "read-pill" : "ticket-status-cancelled"}`}>{schedule.isActive ? "Active" : "Paused"}</span>
                    <button className="button secondary small-button" type="button" onClick={() => toggleSchedule(schedule)} disabled={deliveryBusy}>
                      {schedule.isActive ? "Pause" : "Resume"}
                    </button>
                    <button className="button secondary danger-soft small-button" type="button" onClick={() => deleteSchedule(schedule.id)} disabled={deliveryBusy}>
                      Delete
                    </button>
                  </div>
                )) : <p className="muted">No scheduled reports yet.</p>}
              </div>
            </div>
            <div className="panel reports-admin-panel">
              <div className="section-heading compact-heading">
                <div>
                  <h2><History size={18} aria-hidden="true" /> Export History</h2>
                  <p className="muted">Recent report downloads and email deliveries.</p>
                </div>
              </div>
              <div className="report-list-stack">
                {exportHistory.length ? exportHistory.slice(0, 10).map((item) => (
                  <div className="report-admin-row compact" key={item.id}>
                    <span className="report-cell-stack">
                      <strong>{item.definitionName ?? (item.reportType === "event-service-report" ? "Event services report" : "Ticket report")}</strong>
                      <span className="muted">{item.format.toUpperCase()} | {item.deliveryStatus}{item.recipientEmail ? ` to ${item.recipientEmail}` : ""}</span>
                    </span>
                    <span className="muted">{formatDate(item.createdAt)}</span>
                  </div>
                )) : <p className="muted">No report exports yet.</p>}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
