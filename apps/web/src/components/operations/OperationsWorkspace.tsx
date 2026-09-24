"use client";
import { QcContextLink } from "@/components/qc/QcContextLink";

import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, CalendarClock, Check, ChevronLeft, ChevronRight, CircleAlert, ClipboardCheck, Download, Filter, FolderKanban, Mail, PenLine, RefreshCw, Ticket, UsersRound, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiBaseUrl, apiFetch } from "@/lib/api";
import { humanize, ticketStatusName, ticketStatusStyle, type TicketStatusDefinition } from "@/lib/ticket-statuses";

type WorkKind = "TICKET" | "EVENT" | "EVENT_TASK" | "PROJECT";
type Period = "ALL" | "TODAY" | "7_DAYS" | "30_DAYS";
type QueueMode = "ATTENTION" | "ALL";
type DecisionStatus = "OPEN" | "IN_PROGRESS";
type QueueSortKey = "work" | "source" | "owner" | "client" | "status" | "dueAt" | "updatedAt";
type SortDirection = "asc" | "desc";
type PageSize = "20" | "50" | "100" | "ALL";

interface WorkItem {
  id: string;
  kind: WorkKind;
  reference: string;
  title: string;
  clientName: string | null;
  status: string;
  statusDefinitionId?: string | null;
  statusDefinition?: TicketStatusDefinition | null;
  health?: string | null;
  priority: string | null;
  owner: string | null;
  teamName: string | null;
  groupName?: string | null;
  dueAt: string | null;
  updatedAt: string;
  href: string;
  attention: boolean;
  requestId?: string;
  internalOwners: string[];
  internalOwnerIds?: string[];
}

interface OperationsDecision {
  id: string;
  title: string;
  description: string | null;
  status: DecisionStatus;
  dueAt: string | null;
  createdAt: string;
  owner: string | null;
  projectId: string;
  projectName: string;
  projectHealth: string;
  attention: boolean;
  href: string;
}

interface OperationsOverview {
  currentUserId?: string;
  agendaEnd?: string;
  agenda?: Array<{ id: string; title: string; startAt: string; endAt: string; timeZone: string; activityType: string; modality: string | null; location: string | null; syncStatus: string; organizer: { id: string; firstName: string; lastName: string } | null; attendees: Array<{ userId: string | null }>; ticket: { ticketNumber: string; status: string; client: { name: string } | null } }>;

  generatedAt: string;
  summary: {
    activeTickets: number;
    unassignedTickets: number;
    activeEvents: number;
    upcomingEvents: number;
    activeProjects: number;
    atRiskProjects: number;
    openProjectDecisions: number;
    projectCommitments: number;
    unassignedProjectCommitments: number;
    blockedTasks: number;
    attentionItems: number;
    overdueItems: number;
    overCapacity: number;
    nearCapacity: number;
    capacityBaseline: number;
    capacityWarningPercent: number;
    dueSoonDays: number;
  };
  sources?: { tickets: boolean; events: boolean; projects: boolean };
  capabilities: {
    updateTicketStatus: boolean;
    closeTickets: boolean;
    reopenTickets: boolean;
    updateEventStatus: boolean;
    exportProjectReports: boolean;
    scheduleProjectReports: boolean;
  };
  items: WorkItem[];
  decisions: OperationsDecision[];
  workload: Array<{ ownerId?: string; owner: string; operational: number; projectCommitments: number; total: number; attention: number; capacityPercent: number; capacityStatus: "AVAILABLE" | "NEAR_CAPACITY" | "OVER_CAPACITY"; details: Array<{ id: string; kind: string; reference: string; title: string; dueAt: string | null; clientName: string | null; status: string; statusDefinitionId?: string | null; statusDefinition?: TicketStatusDefinition | null; priority: string | null; updatedAt: string; href: string; attention: boolean }> }>;
  forecast: { weeks: Array<{ startAt: string; endAt: string; label: string }>; owners: Array<{ ownerId?: string; owner: string; weeks: number[]; unscheduled: number; totalPlanned: number; capacityBaseline: number }> };
}

interface ExecutiveProjectSummary {
  summary: { activeProjects: number; atRiskProjects: number; overdueDecisions: number; unassignedDecisions: number; overdueMilestones: number };
  detail: Array<{ projectId: string; projectName: string; health: string; targetDate: string | null; risk: boolean }>;
}

function label(value: string) {
  return humanize(value);
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function kindLabel(kind: WorkKind) {
  if (kind === "EVENT_TASK") return "Event task";
  if (kind === "EVENT") return "Event request";
  return kind === "PROJECT" ? "Project" : "Ticket";
}

function SummaryCard({ icon: Icon, title, value, note, tone = "default", onClick, active = false }: { icon: typeof Ticket; title: string; value: number; note: string; tone?: "default" | "attention"; onClick?: () => void; active?: boolean }) {
  const content = <>
      <div className="operations-summary-icon"><Icon size={18} aria-hidden="true" /></div>
      <div>
        <span>{title}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </>;
  const className = `operations-summary-card${tone === "attention" ? " attention" : ""}${onClick ? " interactive" : ""}${active ? " active" : ""}`;
  return onClick ? <button className={className} type="button" onClick={onClick} aria-label={`${title}: ${value}. ${note}`}>{content}</button> : <div className={className}>{content}</div>;
}

function SortButton({ column, activeColumn, direction, children, onSort }: { column: QueueSortKey; activeColumn: QueueSortKey; direction: SortDirection; children: string; onSort: (column: QueueSortKey) => void }) {
  const active = column === activeColumn;
  const Icon = !active ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown;
  return <button className={active ? "active" : ""} type="button" onClick={() => onSort(column)} aria-label={`Sort by ${children} ${active && direction === "asc" ? "descending" : "ascending"}`}>{children}<Icon size={13} aria-hidden="true" /></button>;
}

export function OperationsWorkspace() {
  const router = useRouter();
  const [agendaMine, setAgendaMine] = useState(true);
  const [overview, setOverview] = useState<OperationsOverview | null>(null);
  const [period, setPeriod] = useState<Period>("7_DAYS");
  const [queueMode, setQueueMode] = useState<QueueMode>("ATTENTION");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusDrafts, setStatusDrafts] = useState<Record<string, string>>({});
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [ownerFilter, setOwnerFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [planningFilter, setPlanningFilter] = useState<"ALL" | "PLANNED" | "UNSCHEDULED">("ALL");
  const [sortKey, setSortKey] = useState<QueueSortKey>("updatedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [pageSize, setPageSize] = useState<PageSize>("20");
  const [page, setPage] = useState(1);
  const [decisionOwner, setDecisionOwner] = useState("ALL");
  const [decisionStatus, setDecisionStatus] = useState<"ALL" | DecisionStatus>("ALL");
  const [decisionAttentionOnly, setDecisionAttentionOnly] = useState(true);
  const [selectedWorkloadOwner, setSelectedWorkloadOwner] = useState<string | null>(null);
  const [executive, setExecutive] = useState<ExecutiveProjectSummary | null>(null);
  const [executiveRecipients, setExecutiveRecipients] = useState("");
  const [executiveFrequency, setExecutiveFrequency] = useState<"weekly" | "monthly">("weekly");
  const [ticketStatuses, setTicketStatuses] = useState<TicketStatusDefinition[]>([]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [nextOverview, statuses] = await Promise.all([
        apiFetch<OperationsOverview>("/operations/overview"),
        apiFetch<TicketStatusDefinition[]>("/ticket-workflow/statuses").catch(() => [])
      ]);
      setOverview(nextOverview);
      setTicketStatuses(statuses);
      try {
        setExecutive(await apiFetch<ExecutiveProjectSummary>("/reports/projects/executive-summary"));
      } catch {
        setExecutive(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load Operations Center.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const queueCandidates = useMemo(() => {
    if (!overview) return [];
    const query = search.trim().toLowerCase();
    const now = new Date();
    const end = new Date(now);
    if (period === "TODAY") end.setHours(23, 59, 59, 999);
    if (period === "7_DAYS") end.setDate(end.getDate() + 7);
    if (period === "30_DAYS") end.setDate(end.getDate() + 30);

    return overview.items.filter((item) => {
      const dueDate = item.dueAt ? new Date(item.dueAt) : null;
      const timeMatches = period === "ALL" || !dueDate || (dueDate >= now && dueDate <= end) || (item.attention && dueDate < now);
      const text = [item.reference, item.title, item.clientName, item.owner, item.teamName, item.status, item.health, item.priority].filter(Boolean).join(" ").toLowerCase();
      return timeMatches && (queueMode === "ALL" || item.attention) && (!query || text.includes(query));
    });
  }, [overview, period, queueMode, search]);

  const queueOwners = useMemo(() => [...new Map((overview?.items ?? []).flatMap(item => item.internalOwners.length ? item.internalOwners.map((name, index) => [item.internalOwnerIds?.[index] ?? name, name] as const) : item.owner ? [[item.owner, item.owner] as const] : [])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [overview?.items]);
  const queueStatuses = useMemo(() => [...new Map((overview?.items ?? []).map(item => [`${item.kind}:${item.kind === "TICKET" ? item.statusDefinitionId ?? item.status : item.status}`, `${kindLabel(item.kind)} · ${item.kind === "TICKET" ? ticketStatusName(item, ticketStatuses) : label(item.status)}`])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [overview?.items, ticketStatuses]);

  const visibleItems = useMemo(() => {
    const filtered = queueCandidates.filter((item) => {
      const ownerMatches = ownerFilter === "ALL" || (ownerFilter === "UNASSIGNED" ? !item.owner && !item.teamName && !item.groupName : (item.internalOwnerIds?.includes(ownerFilter) ?? item.internalOwners.includes(ownerFilter)) || (!item.internalOwners.length && item.owner === ownerFilter));
      const planningMatches = planningFilter === "ALL" || (planningFilter === "PLANNED" ? Boolean(item.dueAt) : !item.dueAt);
      const itemStatusFilter = `${item.kind}:${item.kind === "TICKET" ? item.statusDefinitionId ?? item.status : item.status}`;
      return (sourceFilter === "ALL" || item.kind === sourceFilter) && ownerMatches && (statusFilter === "ALL" || itemStatusFilter === statusFilter) && planningMatches;
    });

    const valueFor = (item: WorkItem) => {
      if (sortKey === "work") return `${item.reference} ${item.title}`;
      if (sortKey === "source") return kindLabel(item.kind);
      if (sortKey === "owner") return item.owner;
      if (sortKey === "client") return `${item.clientName ?? ""} ${item.teamName ?? ""}`;
      if (sortKey === "status") return `${item.kind === "TICKET" ? ticketStatusName(item, ticketStatuses) : item.status} ${item.priority ?? item.health ?? ""}`;
      return item[sortKey];
    };

    return [...filtered].sort((left, right) => {
      const leftValue = valueFor(left);
      const rightValue = valueFor(right);
      if (leftValue === null && rightValue === null) return left.reference.localeCompare(right.reference);
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;
      const comparison = sortKey === "dueAt" || sortKey === "updatedAt"
        ? new Date(leftValue).getTime() - new Date(rightValue).getTime()
        : leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: "base" });
      return (sortDirection === "asc" ? comparison : -comparison) || left.reference.localeCompare(right.reference);
    });
  }, [ownerFilter, planningFilter, queueCandidates, sortDirection, sortKey, sourceFilter, statusFilter, ticketStatuses]);

  useEffect(() => {
    setPage(1);
  }, [ownerFilter, pageSize, period, planningFilter, queueMode, search, sortDirection, sortKey, sourceFilter, statusFilter]);

  const pageSizeNumber = pageSize === "ALL" ? Math.max(visibleItems.length, 1) : Number(pageSize);
  const pageCount = Math.max(1, Math.ceil(visibleItems.length / pageSizeNumber));
  const currentPage = Math.min(page, pageCount);
  const pageItems = pageSize === "ALL" ? visibleItems : visibleItems.slice((currentPage - 1) * pageSizeNumber, currentPage * pageSizeNumber);
  const firstVisibleItem = visibleItems.length ? (currentPage - 1) * pageSizeNumber + 1 : 0;
  const lastVisibleItem = pageSize === "ALL" ? visibleItems.length : Math.min(currentPage * pageSizeNumber, visibleItems.length);
  const filtersActive = sourceFilter !== "ALL" || ownerFilter !== "ALL" || statusFilter !== "ALL" || planningFilter !== "ALL";

  const sortQueue = (column: QueueSortKey) => {
    if (sortKey === column) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortKey(column);
      setSortDirection("asc");
    }
  };

  const clearQueueFilters = () => {
    setSourceFilter("ALL");
    setOwnerFilter("ALL");
    setStatusFilter("ALL");
    setPlanningFilter("ALL");
  };

  const scrollToSection = (sectionId: string) => {
    window.requestAnimationFrame(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const focusQueue = (next: { mode: QueueMode; source?: WorkKind; owner?: string; status?: string }) => {
    setPeriod("ALL");
    setQueueMode(next.mode);
    setSearch("");
    setSourceFilter(next.source ?? "ALL");
    setOwnerFilter(next.owner ?? "ALL");
    setStatusFilter(next.status && next.source ? `${next.source}:${next.status}` : "ALL");
    setPlanningFilter("ALL");
    setPage(1);
    scrollToSection("operations-queue");
  };

  const focusDecisions = () => {
    setDecisionOwner("ALL");
    setDecisionStatus("ALL");
    setDecisionAttentionOnly(false);
    scrollToSection("operations-decisions");
  };

  const focusCapacityAlert = () => {
    const alertedOwner = overview?.workload.find((entry) => entry.capacityStatus === "OVER_CAPACITY") ?? overview?.workload.find((entry) => entry.capacityStatus === "NEAR_CAPACITY");
    if (alertedOwner) setSelectedWorkloadOwner(alertedOwner.ownerId ?? alertedOwner.owner);
    else scrollToSection("operations-capacity");
  };

  const canUpdateStatus = (item: WorkItem) => item.kind === "TICKET" ? Boolean(overview?.capabilities.updateTicketStatus) : item.kind === "PROJECT" ? false : Boolean(overview?.capabilities.updateEventStatus);

  const decisionOwners = useMemo(() => [...new Set((overview?.decisions ?? []).map((decision) => decision.owner).filter((owner): owner is string => Boolean(owner)))].sort((left, right) => left.localeCompare(right)), [overview?.decisions]);
  const selectedWorkload = useMemo(() => overview?.workload.find((entry) => (entry.ownerId ?? entry.owner) === selectedWorkloadOwner) ?? null, [overview?.workload, selectedWorkloadOwner]);
  const visibleDecisions = useMemo(() => (overview?.decisions ?? []).filter((decision) => {
    const ownerMatches = decisionOwner === "ALL" || (decisionOwner === "UNASSIGNED" ? !decision.owner : decision.owner === decisionOwner);
    return ownerMatches && (decisionStatus === "ALL" || decision.status === decisionStatus) && (!decisionAttentionOnly || decision.attention);
  }), [decisionAttentionOnly, decisionOwner, decisionStatus, overview?.decisions]);

  const statusOptions = (item: WorkItem) => {
    if (item.kind === "TICKET") return ticketStatuses.filter((status) => {
      if (!status.isActive && status.id !== item.statusDefinitionId) return false;
      if (status.systemStatus === "CLOSED" && !overview?.capabilities.closeTickets) return status.id === item.statusDefinitionId;
      if (status.systemStatus === "REOPENED" && !overview?.capabilities.reopenTickets) return status.id === item.statusDefinitionId;
      return true;
    }).map((status) => status.id);
    if (item.kind === "EVENT") return ["NEW", "UNDER_REVIEW", "SCHEDULED", "ASSIGNED", "IN_PROGRESS", "WAITING_ON_CLIENT", "WAITING_ON_INTERNAL_TEAM", "COMPLETED", "CANCELLED"];
    return ["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"];
  };

  const updateStatus = async (item: WorkItem) => {
    const currentStatus = item.kind === "TICKET" ? item.statusDefinitionId ?? item.status : item.status;
    const status = statusDrafts[item.id] ?? currentStatus;
    if (status === currentStatus || !canUpdateStatus(item)) return;
    setUpdatingItemId(item.id);
    setError("");
    try {
      if (item.kind === "TICKET") {
        await apiFetch("/tickets/bulk", { method: "PATCH", body: JSON.stringify({ ticketIds: [item.id], statusDefinitionId: status }) });
      } else if (item.kind === "EVENT") {
        await apiFetch(`/event-services/${item.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      } else if (item.requestId) {
        await apiFetch(`/event-services/${item.requestId}/tasks/${item.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      }
      setStatusDrafts((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      await load();
      setEditingItemId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update work item status.");
    } finally {
      setUpdatingItemId(null);
    }
  };

  const unscheduledCount = useMemo(() => (overview?.forecast.owners ?? []).reduce((sum, entry) => sum + entry.unscheduled, 0), [overview?.forecast.owners]);
  const queueScopeLabel = queueMode === "ATTENTION" ? "attention items" : "active items";

  const scheduleExecutiveReport = async () => {
    const recipientEmails = executiveRecipients.split(/[;,\s]+/).map((email) => email.trim()).filter(Boolean);
    if (!recipientEmails.length) {
      setError("Enter at least one recipient email for the executive report.");
      return;
    }
    setError("");
    try {
      const definition = await apiFetch<{ id: string }>("/reports/definitions", { method: "POST", body: JSON.stringify({ name: `Executive Project Review ${Date.now()}`, reportType: "project-executive-report", filters: {} }) });
      await apiFetch("/reports/schedules", { method: "POST", body: JSON.stringify({ definitionId: definition.id, name: "Executive Project Review", frequency: executiveFrequency, format: "pdf", recipientEmails }) });
      setExecutiveRecipients("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to schedule executive project report.");
    }
  };

  return (
    <div className="operations-workspace">
      <section className="operations-toolbar panel" aria-label="Operations filters">
        <div className="operations-toolbar-copy">
          <strong>Active work queue</strong>
        </div>
        <div className="operations-toolbar-controls"><QcContextLink href="/qc/reviews" label="QC queue" />
          <div className="segmented-control" aria-label="Queue mode">
            <button type="button" className={queueMode === "ATTENTION" ? "active" : ""} aria-pressed={queueMode === "ATTENTION"} onClick={() => setQueueMode("ATTENTION")}>Needs attention</button>
            <button type="button" className={queueMode === "ALL" ? "active" : ""} aria-pressed={queueMode === "ALL"} onClick={() => setQueueMode("ALL")}>All work</button>
          </div>
          <div className="segmented-control operations-period-control" aria-label="Queue range">
            {(["TODAY", "7_DAYS", "30_DAYS", "ALL"] as Period[]).map((value) => (
              <button key={value} type="button" className={period === value ? "active" : ""} aria-pressed={period === value} onClick={() => setPeriod(value)}>
                {value === "TODAY" ? "Today" : value === "7_DAYS" ? "7 days" : value === "30_DAYS" ? "30 days" : "All"}
              </button>
            ))}
          </div>
          <input className="input operations-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search work" aria-label="Search work" />
          <button className="button secondary icon-button" type="button" onClick={() => void load()} disabled={loading} title="Refresh operations data" aria-label="Refresh operations data">
            <RefreshCw size={16} className={loading ? "spin" : ""} aria-hidden="true" />
          </button>
        </div>
      </section>

      {error ? <div className="alert error">Unable to load Operations Center. {error}</div> : null}

      {overview?.sources ? <p className="muted">Visible sources: {Object.entries(overview.sources).filter(([, allowed]) => allowed).map(([source]) => label(source)).join(", ") || "No source permissions"}. Counts follow your current access.</p> : null}
      <section className="operations-summary-grid" aria-label="Operations summary">
        <SummaryCard icon={CircleAlert} title="Needs attention" value={overview?.summary.attentionItems ?? 0} note={`${overview?.summary.overdueItems ?? 0} overdue work items`} tone="attention" onClick={() => focusQueue({ mode: "ATTENTION" })} active={queueMode === "ATTENTION" && period === "ALL" && sourceFilter === "ALL" && ownerFilter === "ALL" && statusFilter === "ALL" && planningFilter === "ALL" && !search} />
        {overview?.sources?.tickets !== false && <SummaryCard icon={Ticket} title="Unassigned tickets" value={overview?.summary.unassignedTickets ?? 0} note={`${overview?.summary.activeTickets ?? 0} active tickets`} tone={(overview?.summary.unassignedTickets ?? 0) > 0 ? "attention" : "default"} onClick={() => focusQueue({ mode: "ALL", source: "TICKET", owner: "UNASSIGNED" })} active={queueMode === "ALL" && period === "ALL" && sourceFilter === "TICKET" && ownerFilter === "UNASSIGNED" && statusFilter === "ALL" && planningFilter === "ALL" && !search} />}
        {overview?.sources?.projects !== false && <SummaryCard icon={FolderKanban} title="Project commitments" value={overview?.summary.projectCommitments ?? 0} note={`${overview?.summary.atRiskProjects ?? 0} at risk · ${overview?.summary.unassignedProjectCommitments ?? 0} unassigned`} tone={(overview?.summary.atRiskProjects ?? 0) > 0 || (overview?.summary.unassignedProjectCommitments ?? 0) > 0 ? "attention" : "default"} onClick={() => router.push("/projects")} />}
        {overview?.sources?.projects !== false && <SummaryCard icon={ClipboardCheck} title="Open decisions" value={overview?.summary.openProjectDecisions ?? 0} note="Project actions needing ownership or closure" tone={(overview?.summary.openProjectDecisions ?? 0) > 0 ? "attention" : "default"} onClick={focusDecisions} />}
        <SummaryCard icon={CalendarClock} title="Capacity alerts" value={overview?.summary.overCapacity ?? 0} note={`${overview?.summary.nearCapacity ?? 0} nearing ${overview?.summary.capacityWarningPercent ?? 75}% of capacity`} tone={(overview?.summary.overCapacity ?? 0) > 0 ? "attention" : "default"} onClick={focusCapacityAlert} />
        {overview?.sources?.events !== false && <SummaryCard icon={AlertTriangle} title="Blocked tasks" value={overview?.summary.blockedTasks ?? 0} note="Event service tasks requiring follow-up" tone={(overview?.summary.blockedTasks ?? 0) > 0 ? "attention" : "default"} onClick={() => focusQueue({ mode: "ALL", source: "EVENT_TASK", status: "BLOCKED" })} active={queueMode === "ALL" && period === "ALL" && sourceFilter === "EVENT_TASK" && ownerFilter === "ALL" && statusFilter === "EVENT_TASK:BLOCKED" && planningFilter === "ALL" && !search} />}
      </section>

      {executive?.summary.activeProjects ? <section className="panel operations-executive-panel"><div className="section-heading operations-section-heading"><div><h2>Executive project review</h2><p>Delivery health, overdue commitments, and decision ownership.</p></div>{overview?.capabilities.exportProjectReports ? <div className="operations-executive-downloads"><a className="button secondary" href={`${apiBaseUrl}/reports/projects/executive-export?format=csv`}><Download size={15} aria-hidden="true" /> CSV</a><a className="button secondary" href={`${apiBaseUrl}/reports/projects/executive-export?format=xlsx`}><Download size={15} aria-hidden="true" /> Excel</a><a className="button secondary" href={`${apiBaseUrl}/reports/projects/executive-export?format=pdf`}><Download size={15} aria-hidden="true" /> PDF</a></div> : null}</div><div className="operations-executive-grid"><SummaryCard icon={FolderKanban} title="At risk" value={executive.summary.atRiskProjects} note={`${executive.summary.activeProjects} active projects`} tone={executive.summary.atRiskProjects ? "attention" : "default"} /><SummaryCard icon={ClipboardCheck} title="Overdue decisions" value={executive.summary.overdueDecisions} note={`${executive.summary.unassignedDecisions} unassigned`} tone={executive.summary.overdueDecisions ? "attention" : "default"} /><SummaryCard icon={AlertTriangle} title="Overdue milestones" value={executive.summary.overdueMilestones} note="Across active project plans" tone={executive.summary.overdueMilestones ? "attention" : "default"} /></div>{overview?.capabilities.scheduleProjectReports ? <div className="operations-executive-schedule"><Mail size={16} aria-hidden="true" /><input className="input" value={executiveRecipients} onChange={(event) => setExecutiveRecipients(event.target.value)} placeholder="Schedule recipient emails" aria-label="Executive report recipient emails" /><select className="input" value={executiveFrequency} onChange={(event) => setExecutiveFrequency(event.target.value as "weekly" | "monthly")} aria-label="Executive report frequency"><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select><button className="button secondary" type="button" onClick={() => void scheduleExecutiveReport()}>Schedule PDF</button></div> : null}</section> : executive ? <section className="operations-project-empty" aria-label="Project planning"><FolderKanban size={18} aria-hidden="true" /><span>No active project plans yet.</span><Link href="/projects">Create a project plan</Link></section> : null}

      <section className="panel operations-queue-panel" id="operations-queue">
        <div className="section-heading operations-section-heading operations-queue-heading">
          <div>
            <h2>Operational queue</h2>
            <p>{loading ? "Refreshing work data..." : `Showing ${firstVisibleItem}-${lastVisibleItem} of ${visibleItems.length} matching ${queueScopeLabel}`}</p>
          </div>
          <div className="operations-queue-filters" aria-label="Filter operational queue">
            <Filter size={15} aria-hidden="true" />
            <select className="input" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} aria-label="Filter by source"><option value="ALL">All sources</option>{(["TICKET", "EVENT", "EVENT_TASK", "PROJECT"] as WorkKind[]).map((kind) => <option value={kind} key={kind}>{kindLabel(kind)}</option>)}</select>
            <select className="input" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)} aria-label="Filter by owner"><option value="ALL">All owners</option><option value="UNASSIGNED">Unassigned</option>{queueOwners.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select>
            <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status"><option value="ALL">All statuses</option>{queueStatuses.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select>
            <select className="input" value={planningFilter} onChange={(event) => setPlanningFilter(event.target.value as typeof planningFilter)} aria-label="Filter by planning"><option value="ALL">Any planning</option><option value="PLANNED">Planned</option><option value="UNSCHEDULED">Unscheduled</option></select>
            {filtersActive ? <button className="button secondary icon-button" type="button" onClick={clearQueueFilters} title="Clear queue filters" aria-label="Clear queue filters"><X size={14} aria-hidden="true" /></button> : null}
          </div>
          {overview ? <span className="muted">Updated {formatDateTime(overview.generatedAt)}</span> : null}
        </div>
        <div className="operations-table-scroll">
          <table className="table operations-table">
            <thead>
              <tr><th><SortButton column="work" activeColumn={sortKey} direction={sortDirection} onSort={sortQueue}>Work item</SortButton></th><th><SortButton column="source" activeColumn={sortKey} direction={sortDirection} onSort={sortQueue}>Source</SortButton></th><th><SortButton column="owner" activeColumn={sortKey} direction={sortDirection} onSort={sortQueue}>Owner</SortButton></th><th><SortButton column="client" activeColumn={sortKey} direction={sortDirection} onSort={sortQueue}>Client / Team</SortButton></th><th><SortButton column="status" activeColumn={sortKey} direction={sortDirection} onSort={sortQueue}>Status</SortButton></th><th><SortButton column="dueAt" activeColumn={sortKey} direction={sortDirection} onSort={sortQueue}>Target / Event</SortButton></th><th><SortButton column="updatedAt" activeColumn={sortKey} direction={sortDirection} onSort={sortQueue}>Updated</SortButton></th><th>Action</th></tr>
            </thead>
            <tbody>
              {pageItems.map((item) => (
                <tr key={`${item.kind}-${item.id}`}>
                  <td>
                    <div className="operations-work-cell">
                      <Link href={item.href}>{item.reference}</Link>
                      <strong title={item.title}>{item.title}</strong>
                    </div>
                  </td>
                  <td><span className="operations-kind-pill">{kindLabel(item.kind)}</span></td>
                  <td>{item.owner ?? <span className="operations-unassigned">{item.groupName ? `Access group: ${item.groupName}` : item.teamName ? `Team: ${item.teamName}` : "Unassigned"}</span>}</td>
                  <td><div className="operations-context-cell"><strong>{item.clientName ?? "No client"}</strong><span>{item.teamName ?? "No team"}</span></div></td>
                  <td><div className="operations-status-cell"><span style={item.kind === "TICKET" ? ticketStatusStyle(item, ticketStatuses) : undefined}>{item.kind === "TICKET" ? ticketStatusName(item, ticketStatuses) : label(item.status)}</span>{item.health ? <small>{label(item.health)}</small> : item.priority ? <small>{label(item.priority)}</small> : null}</div></td>
                  <td>{formatDate(item.dueAt)}</td>
                  <td>{formatDate(item.updatedAt)}</td>
                  <td>
                    {canUpdateStatus(item) && editingItemId === item.id ? (
                      <div className="operations-action-control">
                        <select className="input" value={statusDrafts[item.id] ?? (item.kind === "TICKET" ? item.statusDefinitionId ?? item.status : item.status)} onChange={(event) => setStatusDrafts((current) => ({ ...current, [item.id]: event.target.value }))} disabled={updatingItemId === item.id} aria-label={`Update ${item.reference} status`}>
                          {statusOptions(item).map((status) => <option value={status} key={status}>{item.kind === "TICKET" ? ticketStatuses.find((definition) => definition.id === status)?.name ?? label(status) : label(status)}</option>)}
                        </select>
                        <button className="button secondary icon-button" type="button" onClick={() => void updateStatus(item)} disabled={updatingItemId === item.id || (statusDrafts[item.id] ?? (item.kind === "TICKET" ? item.statusDefinitionId ?? item.status : item.status)) === (item.kind === "TICKET" ? item.statusDefinitionId ?? item.status : item.status)} title={`Save ${item.reference} status`} aria-label={`Save ${item.reference} status`}>
                          <Check size={15} aria-hidden="true" />
                        </button>
                      </div>
                    ) : <div className="operations-row-actions"><Link className="button secondary" href={item.href}>Open</Link>{canUpdateStatus(item) ? <button className="button secondary icon-button" type="button" onClick={() => setEditingItemId(item.id)} title={`Update ${item.reference} status`} aria-label={`Update ${item.reference} status`}><PenLine size={14} aria-hidden="true" /></button> : null}</div>}
                  </td>
                </tr>
              ))}
              {!loading && visibleItems.length === 0 ? <tr><td colSpan={8}><div className="dashboard-empty">No active work matches these filters.</div></td></tr> : null}
            </tbody>
          </table>
        </div>
        <footer className="operations-pagination">
          <span>{firstVisibleItem}-{lastVisibleItem} of {visibleItems.length}</span>
          <label><span>Rows</span><select className="input" value={pageSize} onChange={(event) => setPageSize(event.target.value as PageSize)}><option value="20">20</option><option value="50">50</option><option value="100">100</option><option value="ALL">All</option></select></label>
          <div className="operations-pagination-actions"><button className="button secondary icon-button" type="button" onClick={() => setPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1} title="Previous page" aria-label="Previous page"><ChevronLeft size={15} aria-hidden="true" /></button><span>Page {currentPage} of {pageCount}</span><button className="button secondary icon-button" type="button" onClick={() => setPage(Math.min(pageCount, currentPage + 1))} disabled={currentPage >= pageCount} title="Next page" aria-label="Next page"><ChevronRight size={15} aria-hidden="true" /></button></div>
        </footer>
      </section>

      <section className="panel operations-decision-panel" id="operations-decisions">
        <div className="section-heading operations-section-heading">
          <div><h2>Decision queue</h2><p>{loading ? "Refreshing project decisions..." : `${visibleDecisions.length} open decisions in view`}</p></div>
          <div className="operations-decision-controls">
            <select className="input" value={decisionStatus} onChange={(event) => setDecisionStatus(event.target.value as "ALL" | DecisionStatus)} aria-label="Filter decision status"><option value="ALL">All statuses</option><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option></select>
            <select className="input" value={decisionOwner} onChange={(event) => setDecisionOwner(event.target.value)} aria-label="Filter decision owner"><option value="ALL">All owners</option><option value="UNASSIGNED">Unassigned</option>{decisionOwners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}</select>
            <label className="operations-attention-toggle"><input type="checkbox" checked={decisionAttentionOnly} onChange={(event) => setDecisionAttentionOnly(event.target.checked)} />Needs attention</label>
          </div>
        </div>
        <div className="operations-table-scroll"><table className="table operations-table operations-decision-table"><thead><tr><th>Decision / action</th><th>Project</th><th>Owner</th><th>Status</th><th>Due</th><th>Project risk</th><th></th></tr></thead><tbody>
          {visibleDecisions.map((decision) => <tr key={decision.id}><td><div className="operations-work-cell"><strong title={decision.title}>{decision.title}</strong>{decision.description ? <span>{decision.description}</span> : null}</div></td><td><Link href={decision.href}>{decision.projectName}</Link></td><td>{decision.owner ?? <span className="operations-unassigned">Unassigned</span>}</td><td>{label(decision.status)}</td><td>{formatDate(decision.dueAt)}</td><td>{decision.attention ? <span className="operations-unassigned">Needs attention</span> : label(decision.projectHealth)}</td><td><Link className="button secondary" href={decision.href}>Open Project</Link></td></tr>)}
          {!loading && !visibleDecisions.length ? <tr><td colSpan={7}><div className="dashboard-empty">No open project decisions match these filters.</div></td></tr> : null}
        </tbody></table></div>
      </section>

      <section className="panel operations-workload-panel" id="operations-capacity">
        <div className="section-heading operations-section-heading"><div><h2>Workload against item baseline</h2><p>Counts assignments and project commitments, not hours or staff availability. Baseline: {overview?.summary.capacityBaseline ?? 12} items; warning at {overview?.summary.capacityWarningPercent ?? 75}%.</p></div><UsersRound size={19} aria-hidden="true" /></div>
        <div className="operations-workload-list">
          {(overview?.workload ?? []).map((entry) => <button className={`operations-workload-row ${entry.capacityStatus.toLowerCase().replace("_", "-")}`} type="button" key={entry.ownerId ?? entry.owner} onClick={() => setSelectedWorkloadOwner(entry.ownerId ?? entry.owner)} aria-label={`Open ${entry.owner} workload`}><strong>{entry.owner}</strong><span>{entry.total}/{overview?.summary.capacityBaseline ?? 12} projected · {entry.capacityPercent}%</span><small>{entry.operational} operational · {entry.projectCommitments} project · {entry.attention} attention</small><em>{label(entry.capacityStatus)}</em><div className="operations-capacity-meter" aria-label={`${entry.owner} projected capacity ${entry.capacityPercent}%`}><span style={{ width: `${Math.min(entry.capacityPercent, 100)}%` }} /></div></button>)}
          {!loading && !overview?.workload.length ? <div className="dashboard-empty">No assigned active work.</div> : null}
        </div>
      </section>

      {overview?.agenda && <section className="panel"><div className="section-heading"><div><h2>Scheduled ticket activities</h2><p className="muted">Work sessions, visits and meetings through {overview.agendaEnd ? formatDate(overview.agendaEnd) : "the next four weeks"}. Dates below use each activity's timezone.</p></div><label className="audit-toggle"><input type="checkbox" checked={agendaMine} onChange={event => setAgendaMine(event.target.checked)} /> My activities</label></div><div className="audit-agenda">{overview.agenda.filter(item => !agendaMine || item.organizer?.id === overview.currentUserId || item.attendees.some(attendee => attendee.userId === overview.currentUserId)).map(item => <article key={item.id}><div><Link href={`/tickets/${item.ticket.ticketNumber}?activity=${item.id}`}>{item.ticket.ticketNumber} · {item.title}</Link><small>{label(item.activityType)} · {item.modality ? label(item.modality) : "Modality not set"} · {item.ticket.client?.name ?? "No client"}</small><small>{item.organizer ? `${item.organizer.firstName} ${item.organizer.lastName}` : "No organizer"}{item.location ? ` · ${item.location}` : ""}</small></div><div><time>{new Date(item.startAt).toLocaleString(undefined, { timeZone: item.timeZone })} – {new Date(item.endAt).toLocaleTimeString(undefined, { timeZone: item.timeZone, hour: "numeric", minute: "2-digit" })}</time><small>{item.timeZone} · Calendar: {label(item.syncStatus)}</small>{["CLOSED", "RESOLVED", "CANCELLED"].includes(item.ticket.status) && <small>Ticket {label(item.ticket.status)} · activity retained</small>}</div></article>)}{!overview.agenda.some(item => !agendaMine || item.organizer?.id === overview.currentUserId || item.attendees.some(attendee => attendee.userId === overview.currentUserId)) && <p className="muted">No scheduled activities in this scope. Schedule work from a ticket's Activities tool.</p>}</div></section>}

      <section className="panel operations-forecast-panel">
        <div className="section-heading operations-section-heading"><div><h2>Four-week deadline forecast</h2><p>Deadlines by specialist. Scheduled activities appear separately above; a reservation does not change a deadline.</p></div><CalendarClock size={19} aria-hidden="true" /></div>
        {unscheduledCount ? <div className="operations-planning-callout"><CalendarClock size={16} aria-hidden="true" /><span>{unscheduledCount} assigned items have no target date and are excluded from the weekly plan.</span><Link href="/tickets">Plan tickets</Link></div> : null}
        <div className="operations-forecast-scroll"><table className="table operations-forecast-table"><thead><tr><th>Specialist</th>{(overview?.forecast.weeks ?? []).map((week) => <th key={week.startAt}>Week of {week.label}</th>)}<th>Unscheduled</th></tr></thead><tbody>{(overview?.forecast.owners ?? []).map((entry) => <tr key={entry.ownerId ?? entry.owner}><td><button className="operations-owner-link" type="button" onClick={() => setSelectedWorkloadOwner(entry.ownerId ?? entry.owner)}>{entry.owner}</button></td>{entry.weeks.map((count, index) => <td key={`${entry.owner}-${index}`}><span className={count >= entry.capacityBaseline ? "operations-forecast-alert" : ""}>{count}</span></td>)}<td>{entry.unscheduled || "-"}</td></tr>)}{!loading && !overview?.forecast.owners.length ? <tr><td colSpan={6}><div className="dashboard-empty">No assigned capacity to forecast.</div></td></tr> : null}</tbody></table></div>
      </section>

      {selectedWorkload ? <div className="operations-workload-drawer-backdrop" role="presentation" onClick={() => setSelectedWorkloadOwner(null)}><aside className="operations-workload-drawer" role="dialog" aria-modal="true" aria-label={`${selectedWorkload.owner} workload`} onClick={(event) => event.stopPropagation()}><div className="section-heading operations-section-heading"><div><h2>{selectedWorkload.owner}</h2><p>{selectedWorkload.total} projected items · {selectedWorkload.capacityPercent}% of baseline.</p></div><button className="button secondary icon-button" type="button" onClick={() => setSelectedWorkloadOwner(null)} title="Close workload" aria-label="Close workload"><X size={16} aria-hidden="true" /></button></div><div className="operations-drawer-summary"><span>{selectedWorkload.operational} operational</span><span>{selectedWorkload.projectCommitments} project commitments</span><span>{selectedWorkload.attention} need attention</span></div><div className="operations-drawer-list">{selectedWorkload.details.map((item) => <article className={`operations-drawer-item${item.attention ? " attention" : ""}`} key={item.id}><div><Link href={item.href}>{item.reference}</Link><strong>{item.title}</strong><span>{item.clientName ?? label(item.kind)} · {item.kind === "TICKET" ? ticketStatusName(item, ticketStatuses) : label(item.status)}{item.priority ? ` · ${label(item.priority)}` : ""}</span></div><div><time className={item.attention ? "operations-unassigned" : ""}>{item.dueAt ? `Target ${formatDate(item.dueAt)}` : "Unscheduled"}</time><small>Updated {formatDate(item.updatedAt)}</small></div></article>)}</div></aside></div> : null}
    </div>
  );
}
