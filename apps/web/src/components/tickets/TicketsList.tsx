"use client";

import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Eye,
  GitMerge,
  MoreHorizontal,
  Plus,
  RefreshCcw,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  X
} from "lucide-react";
import { MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { TicketStatusDefinition, ticketStatusDefinition, ticketStatusName, ticketStatusStyle } from "@/lib/ticket-statuses";

interface TicketListItem {
  id: string;
  ticketNumber: string;
  subject: string;
  status: string;
  statusDefinitionId: string | null;
  statusDefinition: TicketStatusDefinition | null;
  priority: string;
  source: string;
  senderEmail: string | null;
  senderDomain: string | null;
  createdAt: string;
  updatedAt: string;
  client: { id: string; name: string } | null;
  contact: { id: string; firstName: string; lastName: string; email: string } | null;
  assignedUser: User | null;
  assignees: Array<{ user: User }>;
  assignedGroup: Group | null;
  assignedTeam: TicketTeam | null;
  mergedIntoTicket: { id: string; ticketNumber: string; subject: string } | null;
  mergedTickets: Array<{ id: string; ticketNumber: string; subject: string; status: string; mergedAt: string | null }>;
  firstReadAt: string | null;
  firstReadBy: User | null;
  deletedAt: string | null;
  _count: {
    messages: number;
    attachments: number;
  };
}

interface Client {
  id: string;
  name: string;
}

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface Group {
  id: string;
  name: string;
}

interface TicketTeam {
  id: string;
  name: string;
  isActive: boolean;
}

interface ExternalSpecialist {
  id: string;
  name: string;
  email: string;
  company: string | null;
  isActive: boolean;
}

interface PaginatedTickets {
  items: TicketListItem[];
  total: number;
  page: number;
  pageSize: "20" | "50" | "100" | "all";
  totalPages: number;
}

type SortBy = "ticketNumber" | "subject" | "client" | "status" | "priority" | "source" | "createdAt" | "updatedAt";
type SortDirection = "asc" | "desc";
type TableDensity = "compact" | "comfortable";
type InlineTicketField = "assignees" | "team" | "status" | "priority";
type ColumnId =
  | "ticketNumber"
  | "subject"
  | "client"
  | "requester"
  | "readState"
  | "assignees"
  | "team"
  | "status"
  | "priority"
  | "source"
  | "createdAt"
  | "updatedAt"
  | "messages"
  | "attachments";

interface ColumnDefinition {
  id: ColumnId;
  label: string;
  sortable?: SortBy;
}

interface TicketViewState {
  version: number;
  search: string;
  clientId: string;
  scope: string;
  assignedUserId: string;
  assignedTeamId: string;
  externalSpecialistId: string;
  requester: string;
  statuses: string[];
  priority: string;
  source: string;
  sortBy: SortBy;
  sortDirection: SortDirection;
  pageSize: "20" | "50" | "100" | "all";
  density: TableDensity;
  columnOrder: ColumnId[];
  visibleColumns: ColumnId[];
  columnWidths: Record<ColumnId, number>;
  trashMode: boolean;
}

interface TicketView {
  id: string;
  name: string;
  state: TicketViewState;
  isDefault: boolean;
}

const COLUMN_STORAGE_KEY = "avidity.ticketTable.columns";
const COLUMN_WIDTH_STORAGE_KEY = "avidity.ticketTable.columnWidths.v2";
const DENSITY_STORAGE_KEY = "avidity.ticketTable.density.v1";
const TICKET_VIEW_VERSION = 2;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const defaultColumnOrder: ColumnId[] = [
  "ticketNumber",
  "subject",
  "client",
  "requester",
  "readState",
  "assignees",
  "team",
  "status",
  "priority",
  "source",
  "createdAt",
  "updatedAt",
  "messages",
  "attachments"
];
const defaultVisibleColumns: ColumnId[] = [
  "ticketNumber",
  "subject",
  "client",
  "requester",
  "readState",
  "assignees",
  "team",
  "status",
  "priority",
  "createdAt",
  "updatedAt",
  "messages"
];
const allColumns: ColumnDefinition[] = [
  { id: "ticketNumber", label: "Number", sortable: "ticketNumber" },
  { id: "subject", label: "Subject", sortable: "subject" },
  { id: "client", label: "Client", sortable: "client" },
  { id: "requester", label: "Requester" },
  { id: "readState", label: "Read" },
  { id: "assignees", label: "Specialists" },
  { id: "team", label: "Team" },
  { id: "status", label: "Status", sortable: "status" },
  { id: "priority", label: "Priority", sortable: "priority" },
  { id: "source", label: "Source", sortable: "source" },
  { id: "createdAt", label: "Created", sortable: "createdAt" },
  { id: "updatedAt", label: "Modified", sortable: "updatedAt" },
  { id: "messages", label: "Messages" },
  { id: "attachments", label: "Attachments" }
];
const defaultColumnWidths: Record<ColumnId, number> = {
  ticketNumber: 86,
  subject: 220,
  client: 140,
  requester: 165,
  readState: 60,
  assignees: 115,
  team: 125,
  status: 145,
  priority: 100,
  source: 110,
  createdAt: 118,
  updatedAt: 118,
  messages: 65,
  attachments: 120
};
const statuses = ["NEW", "OPEN", "IN_PROGRESS", "WAITING_ON_CUSTOMER", "WAITING_ON_TECHNICIAN", "WAITING_ON_THIRD_PARTY", "RESOLVED", "CLOSED", "REOPENED", "CANCELLED", "MERGED"];
const priorities = ["LOW", "NORMAL", "HIGH", "URGENT", "CRITICAL"];
const sources = ["MANUAL", "EMAIL", "PORTAL", "API", "SYSTEM"];
const builtInViews: Array<{ id: string; name: string; state: Partial<TicketViewState> }> = [
  { id: "all", name: "All tickets", state: { scope: "all", statuses: [], priority: "", source: "" } },
  { id: "new", name: "New tickets", state: { statuses: ["NEW"], scope: "all" } },
  { id: "open", name: "Open tickets", state: { statuses: ["OPEN"], scope: "all" } },
  { id: "closed", name: "Closed tickets", state: { statuses: ["CLOSED"], scope: "all" } },
  { id: "mine", name: "My tickets", state: { scope: "assigned_to_me", statuses: [] } },
  { id: "unassigned", name: "Unassigned", state: { scope: "unassigned", statuses: [] } },
  { id: "high", name: "High priority", state: { priority: "HIGH", scope: "all" } }
];

function label(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function statusClass(value: string) {
  return `ticket-status-${value.toLowerCase().replace(/_/g, "-")}`;
}

function priorityClass(value: string) {
  return `ticket-priority-${value.toLowerCase().replace(/_/g, "-")}`;
}

function MergedInIndicator({ mergedTickets }: { mergedTickets?: TicketListItem["mergedTickets"] }) {
  if (!mergedTickets?.length) {
    return null;
  }

  const ticketNumbers = mergedTickets.map((ticket) => ticket.ticketNumber);
  const visibleTicketNumbers = ticketNumbers.slice(0, 3);
  const hiddenCount = Math.max(0, ticketNumbers.length - visibleTicketNumbers.length);
  const labelText = `Merged in: ${visibleTicketNumbers.join(", ")}${hiddenCount ? ` +${hiddenCount} more` : ""}`;

  return (
    <span className="ticket-merged-inline" title={`Merged in: ${ticketNumbers.join(", ")}`}>
      <GitMerge size={12} aria-hidden="true" />
      <span>{labelText}</span>
    </span>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function normalizeColumnOrder(value: unknown): ColumnId[] {
  if (!Array.isArray(value)) {
    return defaultColumnOrder;
  }

  const validIds = new Set(allColumns.map((column) => column.id));
  const saved = value.filter((id): id is ColumnId => typeof id === "string" && validIds.has(id as ColumnId));
  const missing = defaultColumnOrder.filter((id) => !saved.includes(id));
  return [...saved, ...missing];
}

function normalizeVisibleColumns(value: unknown): ColumnId[] {
  if (!Array.isArray(value)) {
    return defaultVisibleColumns;
  }

  const validIds = new Set(allColumns.map((column) => column.id));
  const saved = value.filter((id): id is ColumnId => typeof id === "string" && validIds.has(id as ColumnId));
  if (!saved.length) {
    return defaultVisibleColumns;
  }

  return [...new Set(saved)];
}

function normalizeColumnWidths(value: unknown): Record<ColumnId, number> {
  if (!value || typeof value !== "object") {
    return defaultColumnWidths;
  }

  const widths = { ...defaultColumnWidths };
  for (const columnId of defaultColumnOrder) {
    const rawWidth = (value as Partial<Record<ColumnId, unknown>>)[columnId];
    if (typeof rawWidth === "number" && Number.isFinite(rawWidth)) {
      widths[columnId] = Math.min(520, Math.max(80, rawWidth));
    }
  }

  return widths;
}

function normalizeDensity(value: unknown): TableDensity {
  return value === "compact" || value === "comfortable" ? value : "comfortable";
}

function isTicketStatusFilter(value: unknown): value is string {
  return typeof value === "string"
    && (statuses.includes(value) || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

function normalizeUuidV4(value: unknown) {
  return typeof value === "string" && UUID_V4_PATTERN.test(value) ? value : "";
}

function normalizeTicketViewState(value: unknown): TicketViewState {
  const state = value && typeof value === "object" ? (value as Partial<TicketViewState>) : {};
  const nextSortBy = allColumns.some((column) => column.sortable === state.sortBy) ? state.sortBy as SortBy : "updatedAt";
  const nextPageSize = state.pageSize === "20" || state.pageSize === "50" || state.pageSize === "100" || state.pageSize === "all" ? state.pageSize : "20";
  const legacyStatus = typeof (state as { status?: unknown }).status === "string" ? (state as { status: string }).status : "";
  const nextStatuses = Array.isArray(state.statuses)
    ? state.statuses.filter(isTicketStatusFilter)
    : isTicketStatusFilter(legacyStatus)
      ? [legacyStatus]
      : [];

  return {
    version: TICKET_VIEW_VERSION,
    search: typeof state.search === "string" ? state.search.slice(0, 160) : "",
    clientId: normalizeUuidV4(state.clientId),
    scope: typeof state.scope === "string" && ["all", "assigned_to_me", "my_teams", "unassigned"].includes(state.scope) ? state.scope : "all",
    assignedUserId: normalizeUuidV4(state.assignedUserId),
    assignedTeamId: normalizeUuidV4(state.assignedTeamId),
    externalSpecialistId: normalizeUuidV4(state.externalSpecialistId),
    requester: typeof state.requester === "string" ? state.requester.slice(0, 160) : "",
    statuses: [...new Set(nextStatuses)],
    priority: typeof state.priority === "string" && (state.priority === "" || priorities.includes(state.priority)) ? state.priority : "",
    source: typeof state.source === "string" && sources.includes(state.source) ? state.source : "",
    sortBy: nextSortBy,
    sortDirection: state.sortDirection === "asc" || state.sortDirection === "desc" ? state.sortDirection : "desc",
    pageSize: nextPageSize,
    density: normalizeDensity(state.density),
    columnOrder: normalizeColumnOrder(state.columnOrder),
    visibleColumns: normalizeVisibleColumns(state.visibleColumns),
    columnWidths: normalizeColumnWidths(state.columnWidths),
    trashMode: state.trashMode === true
  };
}

function ticketViewStateSignature(value: unknown) {
  return JSON.stringify(normalizeTicketViewState(value));
}

const ticketUrlFilterKeys = [
  "search",
  "clientId",
  "scope",
  "assignedUserId",
  "assignedTeamId",
  "externalSpecialistId",
  "requester",
  "statuses",
  "statusDefinitionIds",
  "priority",
  "source",
  "deletedScope",
  "sortBy",
  "sortDirection"
];

function hasExplicitTicketUrlFilters(searchParams: URLSearchParams) {
  return ticketUrlFilterKeys.some((key) => searchParams.has(key));
}

function isUnsupportedTicketSortError(message: string) {
  return /sortBy must be one of the following values:/i.test(message);
}

export function TicketsList() {
  const statusFilterRef = useRef<HTMLDivElement>(null);
  const ticketRequestIdRef = useRef(0);
  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [ticketTeams, setTicketTeams] = useState<TicketTeam[]>([]);
  const [ticketStatuses, setTicketStatuses] = useState<TicketStatusDefinition[]>([]);
  const [externalSpecialists, setExternalSpecialists] = useState<ExternalSpecialist[]>([]);
  const [ticketViews, setTicketViews] = useState<TicketView[]>([]);
  const [selectedViewId, setSelectedViewId] = useState("built-in:all");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [scope, setScope] = useState("all");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [assignedTeamId, setAssignedTeamId] = useState("");
  const [externalSpecialistId, setExternalSpecialistId] = useState("");
  const [search, setSearch] = useState("");
  const [clientId, setClientId] = useState("");
  const [requester, setRequester] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [showStatusFilterMenu, setShowStatusFilterMenu] = useState(false);
  const [priority, setPriority] = useState("");
  const [source, setSource] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("updatedAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(defaultColumnOrder);
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnId>>(new Set(defaultVisibleColumns));
  const [columnWidths, setColumnWidths] = useState<Record<ColumnId, number>>(defaultColumnWidths);
  const [showColumnsPanel, setShowColumnsPanel] = useState(false);
  const [showMobileActions, setShowMobileActions] = useState(false);
  const [density, setDensity] = useState<TableDensity>("comfortable");
  const [selectedTicketIds, setSelectedTicketIds] = useState<string[]>([]);
  const [trashMode, setTrashMode] = useState(false);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkAssignedUserId, setBulkAssignedUserId] = useState("");
  const [bulkAssignedTeamId, setBulkAssignedTeamId] = useState("");
  const [bulkPriority, setBulkPriority] = useState("");
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergePrimaryTicketId, setMergePrimaryTicketId] = useState("");
  const [mergeReason, setMergeReason] = useState("");
  const [mergeAllowDifferentClient, setMergeAllowDifferentClient] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<"20" | "50" | "100" | "all">("20");
  const [totalTickets, setTotalTickets] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [showNewTicketModal, setShowNewTicketModal] = useState(false);
  const [newTicketClientId, setNewTicketClientId] = useState("");
  const [newTicketContactId, setNewTicketContactId] = useState("");
  const [newTicketContacts, setNewTicketContacts] = useState<Contact[]>([]);
  const [newTicketSubject, setNewTicketSubject] = useState("");
  const [newTicketDescription, setNewTicketDescription] = useState("");
  const [newTicketPriority, setNewTicketPriority] = useState("NORMAL");
  const [newTicketStatus, setNewTicketStatus] = useState("");
  const [newTicketAssignedUserId, setNewTicketAssignedUserId] = useState("");
  const [newTicketAssignedTeamId, setNewTicketAssignedTeamId] = useState("");
  const [newTicketBusy, setNewTicketBusy] = useState(false);
  const [inlineUpdatingTicket, setInlineUpdatingTicket] = useState<{ ticketId: string; field: InlineTicketField } | null>(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [viewName, setViewName] = useState("");
  const [viewIsDefault, setViewIsDefault] = useState(false);
  const [viewBusy, setViewBusy] = useState(false);
  const [viewDeleteConfirm, setViewDeleteConfirm] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);
  const [viewNotice, setViewNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const visibleOrderedColumns = useMemo(
    () =>
      columnOrder
        .map((id) => allColumns.find((column) => column.id === id))
        .filter((column): column is ColumnDefinition => {
          if (!column) {
            return false;
          }
          return visibleColumns.has(column.id);
        }),
    [columnOrder, visibleColumns]
  );

  const hasActiveFilters = Boolean(search || clientId || requester || selectedStatuses.length > 0 || priority || source || scope !== "all" || assignedUserId || assignedTeamId || externalSpecialistId);
  const selectedSavedView = selectedViewId.startsWith("saved:")
    ? ticketViews.find((view) => `saved:${view.id}` === selectedViewId) ?? null
    : null;
  const selectedCount = selectedTicketIds.length;
  const allVisibleSelected = tickets.length > 0 && tickets.every((ticket) => selectedTicketIds.includes(ticket.id));
  const selectedTickets = useMemo(() => selectedTicketIds.map((id) => tickets.find((ticket) => ticket.id === id)).filter((ticket): ticket is TicketListItem => Boolean(ticket)), [selectedTicketIds, tickets]);
  const mergePrimaryTicket = selectedTickets.find((ticket) => ticket.id === mergePrimaryTicketId) ?? selectedTickets[0] ?? null;
  const mergeSourceTickets = selectedTickets.filter((ticket) => ticket.id !== mergePrimaryTicket?.id);

  async function loadTickets() {
    const requestId = ++ticketRequestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) {
        params.set("search", search.trim().slice(0, 160));
      }
      if (clientId) {
        params.set("clientId", clientId);
      }
      if (scope !== "all") {
        params.set("scope", scope);
      }
      if (assignedUserId) {
        params.set("assignedUserId", assignedUserId);
      }
      if (assignedTeamId) {
        params.set("assignedTeamId", assignedTeamId);
      }
      if (externalSpecialistId) {
        params.set("externalSpecialistId", externalSpecialistId);
      }
      if (requester.trim()) {
        params.set("requester", requester.trim().slice(0, 160));
      }
      if (selectedStatuses.length > 0) {
        const definitionIds = selectedStatuses.filter((status) => /^[0-9a-f-]{36}$/i.test(status));
        const legacyStatuses = selectedStatuses.filter((status) => !definitionIds.includes(status));
        if (definitionIds.length) params.set("statusDefinitionIds", definitionIds.join(","));
        if (legacyStatuses.length) params.set("statuses", legacyStatuses.join(","));
      }
      if (priority) {
        params.set("priority", priority);
      }
      if (source) {
        params.set("source", source);
      }
      params.set("sortBy", sortBy);
      params.set("sortDirection", sortDirection);
      params.set("deletedScope", trashMode ? "deleted" : "active");
      params.set("page", String(page));
      params.set("pageSize", pageSize);
      const response = await apiFetch<PaginatedTickets | TicketListItem[]>(`/tickets?${params.toString()}`);
      if (requestId !== ticketRequestIdRef.current) return;
      const nextTickets = Array.isArray(response) ? response : Array.isArray(response.items) ? response.items : [];
      if (Array.isArray(response)) {
        setTickets(nextTickets);
        setTotalTickets(nextTickets.length);
        setTotalPages(1);
      } else {
        setTickets(nextTickets);
        setTotalTickets(response.total ?? nextTickets.length);
        setTotalPages(response.totalPages ?? 1);
      }
    } catch (cause) {
      if (requestId !== ticketRequestIdRef.current) return;
      const message = cause instanceof Error ? cause.message : "";
      if (sortBy !== "updatedAt" && isUnsupportedTicketSortError(message)) {
        setSortBy("updatedAt");
        return;
      }
      setError(message ? `Unable to load tickets. ${message}` : "Unable to load tickets.");
    } finally {
      if (requestId === ticketRequestIdRef.current) {
        setLoading(false);
      }
    }
  }

  async function loadClients() {
    try {
      const [clientData, userData, teamData, statusData] = await Promise.all([
        apiFetch<Client[]>("/clients"),
        apiFetch<User[]>("/users"),
        apiFetch<TicketTeam[]>("/ticket-teams"),
        apiFetch<TicketStatusDefinition[]>("/ticket-workflow/statuses")
      ]);
      setClients(clientData);
      setUsers(userData);
      setTicketTeams(teamData);
      setTicketStatuses(statusData);
      apiFetch<ExternalSpecialist[]>("/external-specialists")
        .then(setExternalSpecialists)
        .catch(() => setExternalSpecialists([]));
    } catch {
      setClients([]);
      setUsers([]);
      setTicketTeams([]);
      setTicketStatuses([]);
      setExternalSpecialists([]);
    }
  }

  async function loadTicketViews(options: { applyDefault?: boolean; preferredViewId?: string | null } = {}) {
    try {
      const viewData = await apiFetch<TicketView[]>("/tickets/views");
      const normalizedViews = viewData.map((view) => ({ ...view, state: normalizeTicketViewState(view.state) }));
      setTicketViews(normalizedViews);
      const preferredView = options.preferredViewId
        ? normalizedViews.find((view) => view.id === options.preferredViewId)
        : null;
      const viewToApply = preferredView ?? (options.applyDefault ? normalizedViews.find((view) => view.isDefault) : null);
      if (viewToApply) {
        applyViewState(viewToApply.state);
        setSelectedViewId(`saved:${viewToApply.id}`);
      }
      return normalizedViews;
    } catch (cause) {
      setTicketViews([]);
      setError(cause instanceof Error ? cause.message : "Unable to load saved ticket views.");
      return [];
    }
  }

  function currentViewState(): TicketViewState {
    return {
      version: TICKET_VIEW_VERSION,
      search,
      clientId,
      scope,
      assignedUserId,
      assignedTeamId,
      externalSpecialistId,
      requester,
      statuses: selectedStatuses,
      priority,
      source,
      sortBy,
      sortDirection,
      pageSize,
      density,
      columnOrder,
      visibleColumns: [...visibleColumns],
      columnWidths,
      trashMode
    };
  }

  const viewHasUnsavedChanges = selectedSavedView
    ? ticketViewStateSignature(currentViewState()) !== ticketViewStateSignature(selectedSavedView.state)
    : false;

  function applyViewState(nextState: Partial<TicketViewState>) {
    const normalized = normalizeTicketViewState(nextState);
    setSearch(normalized.search);
    setClientId(normalized.clientId);
    setScope(normalized.scope);
    setAssignedUserId(normalized.assignedUserId);
    setAssignedTeamId(normalized.assignedTeamId);
    setExternalSpecialistId(normalized.externalSpecialistId);
    setRequester(normalized.requester);
    setSelectedStatuses(normalized.statuses);
    setPriority(normalized.priority);
    setSource(normalized.source);
    setSortBy(normalized.sortBy);
    setSortDirection(normalized.sortDirection);
    setPageSize(normalized.pageSize);
    setDensity(normalized.density);
    setColumnOrder(normalized.columnOrder);
    setVisibleColumns(new Set(normalized.visibleColumns));
    setColumnWidths(normalized.columnWidths);
    setTrashMode(normalized.trashMode);
    setPage(1);
  }

  function updateViewUrl(value: string) {
    const url = new URL(window.location.href);
    ticketUrlFilterKeys.forEach((key) => url.searchParams.delete(key));
    url.searchParams.set("view", value);
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
  }

  function changeView(value: string) {
    setSelectedViewId(value);
    setViewNotice(null);
    if (value.startsWith("built-in:")) {
      const builtIn = builtInViews.find((view) => `built-in:${view.id}` === value);
      if (builtIn) {
        applyViewState(builtIn.state);
        updateViewUrl(value);
      }
      return;
    }

    const savedView = ticketViews.find((view) => `saved:${view.id}` === value);
    if (savedView) {
      applyViewState(savedView.state);
      updateViewUrl(savedView.id);
    }
  }

  function openViewManager() {
    const builtIn = builtInViews.find((view) => `built-in:${view.id}` === selectedViewId);
    setViewName(selectedSavedView?.name ?? (builtIn ? `${builtIn.name} view` : ""));
    setViewIsDefault(selectedSavedView?.isDefault ?? false);
    setViewDeleteConfirm(false);
    setViewError(null);
    setViewNotice(null);
    setShowViewModal(true);
  }

  async function saveTicketView(mode: "CREATE" | "UPDATE") {
    if (!viewName.trim() || (mode === "UPDATE" && !selectedSavedView)) return;
    setViewBusy(true);
    setError(null);
    setViewError(null);
    setViewNotice(null);
    try {
      const saved = await apiFetch<TicketView>(mode === "UPDATE" ? `/tickets/views/${selectedSavedView!.id}` : "/tickets/views", {
        method: mode === "UPDATE" ? "PATCH" : "POST",
        body: JSON.stringify({
          name: viewName.trim(),
          state: currentViewState(),
          isDefault: viewIsDefault
        })
      });
      await loadTicketViews();
      setSelectedViewId(`saved:${saved.id}`);
      updateViewUrl(saved.id);
      setShowViewModal(false);
      setViewNotice(mode === "UPDATE" ? `View "${saved.name}" updated.` : `View "${saved.name}" created.`);
    } catch (cause) {
      setViewError(cause instanceof Error ? cause.message : "Unable to save ticket view.");
    } finally {
      setViewBusy(false);
    }
  }

  async function deleteCurrentView() {
    if (!selectedSavedView || !viewDeleteConfirm) return;
    setViewBusy(true);
    setError(null);
    setViewError(null);
    try {
      const deletedName = selectedSavedView.name;
      await apiFetch(`/tickets/views/${selectedSavedView.id}`, { method: "DELETE" });
      await loadTicketViews();
      applyViewState(builtInViews[0].state);
      setSelectedViewId("built-in:all");
      updateViewUrl("built-in:all");
      setShowViewModal(false);
      setViewNotice(`View "${deletedName}" deleted.`);
    } catch (cause) {
      setViewError(cause instanceof Error ? cause.message : "Unable to delete ticket view.");
    } finally {
      setViewBusy(false);
    }
  }

  async function applyBulkUpdate() {
    if (selectedCount === 0) {
      return;
    }

    const body: Record<string, unknown> = { ticketIds: selectedTicketIds };
    if (bulkStatus) {
      body.statusDefinitionId = bulkStatus;
    }
    if (bulkAssignedUserId) {
      body.assignedUserId = bulkAssignedUserId;
      body.assignedUserIds = [bulkAssignedUserId];
    }
    if (bulkAssignedTeamId) {
      body.assignedTeamId = bulkAssignedTeamId;
    }
    if (bulkPriority) {
      body.priority = bulkPriority;
    }
    if (!bulkStatus && !bulkAssignedUserId && !bulkAssignedTeamId && !bulkPriority) {
      setError("Choose a status, technician, ticket team, or priority before applying changes.");
      return;
    }

    setBulkBusy(true);
    setError(null);
    try {
      await apiFetch("/tickets/bulk", {
        method: "PATCH",
        body: JSON.stringify(body)
      });
      setSelectedTicketIds([]);
      setBulkStatus("");
      setBulkAssignedUserId("");
      setBulkAssignedTeamId("");
      setBulkPriority("");
      await loadTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to apply bulk update.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function deleteSelectedTickets() {
    if (selectedCount === 0 || !window.confirm(`Move ${selectedCount} selected ticket${selectedCount === 1 ? "" : "s"} to the recycle bin?`)) {
      return;
    }

    setBulkBusy(true);
    setError(null);
    try {
      await apiFetch("/tickets/bulk/delete", {
        method: "POST",
        body: JSON.stringify({ ticketIds: selectedTicketIds })
      });
      setSelectedTicketIds([]);
      await loadTickets();
    } catch {
      setError("Unable to move tickets to recycle bin.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function restoreSelectedTickets() {
    if (selectedCount === 0) {
      return;
    }

    setBulkBusy(true);
    setError(null);
    try {
      await apiFetch("/tickets/bulk/restore", {
        method: "POST",
        body: JSON.stringify({ ticketIds: selectedTicketIds })
      });
      setSelectedTicketIds([]);
      await loadTickets();
    } catch {
      setError("Unable to restore tickets.");
    } finally {
      setBulkBusy(false);
    }
  }

  function resetNewTicketForm() {
    setNewTicketClientId("");
    setNewTicketContactId("");
    setNewTicketContacts([]);
    setNewTicketSubject("");
    setNewTicketDescription("");
    setNewTicketPriority("NORMAL");
    setNewTicketStatus("");
    setNewTicketAssignedUserId("");
    setNewTicketAssignedTeamId("");
  }

  async function loadNewTicketContacts(clientIdValue: string) {
    setNewTicketContactId("");
    if (!clientIdValue) {
      setNewTicketContacts([]);
      return;
    }

    try {
      const contactData = await apiFetch<Contact[]>(`/clients/${clientIdValue}/contacts`);
      setNewTicketContacts(contactData);
    } catch {
      setNewTicketContacts([]);
    }
  }

  async function createManualTicket() {
    if (!newTicketSubject.trim()) {
      setError("Subject is required to create a ticket.");
      return;
    }

    setNewTicketBusy(true);
    setError(null);
    try {
      await apiFetch<TicketListItem>("/tickets", {
        method: "POST",
        body: JSON.stringify({
          subject: newTicketSubject.trim(),
          description: newTicketDescription.trim() || undefined,
          clientId: newTicketClientId || undefined,
          contactId: newTicketContactId || undefined,
          priority: newTicketPriority,
          source: "MANUAL",
          statusDefinitionId: newTicketStatus || undefined,
          assignedUserIds: newTicketAssignedUserId ? [newTicketAssignedUserId] : [],
          assignedTeamId: newTicketAssignedTeamId || undefined
        })
      });

      resetNewTicketForm();
      setShowNewTicketModal(false);
      await loadTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create ticket.");
    } finally {
      setNewTicketBusy(false);
    }
  }

  function isTicketInlineBusy(ticket: TicketListItem) {
    return inlineUpdatingTicket?.ticketId === ticket.id;
  }

  function editableTicketTeams(ticket: TicketListItem) {
    const activeTeams = ticketTeams.filter((team) => team.isActive);
    if (ticket.assignedTeam && !activeTeams.some((team) => team.id === ticket.assignedTeam?.id)) {
      return [...activeTeams, ticket.assignedTeam];
    }
    return activeTeams;
  }

  function editableTicketStatuses(ticket: TicketListItem) {
    const current = ticketStatusDefinition(ticket, ticketStatuses);
    return current && !ticketStatuses.some((status) => status.id === current.id)
      ? [...ticketStatuses, current]
      : ticketStatuses;
  }

  async function assignTicketInline(ticket: TicketListItem, assignedUserId: string) {
    setInlineUpdatingTicket({ ticketId: ticket.id, field: "assignees" });
    setError(null);
    try {
      await apiFetch(`/tickets/${ticket.ticketNumber}/assignment`, {
        method: "PATCH",
        body: JSON.stringify({
          assignedUserId: assignedUserId || null,
          assignedUserIds: assignedUserId ? [assignedUserId] : []
        })
      });
      await loadTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to assign ticket.");
    } finally {
      setInlineUpdatingTicket(null);
    }
  }

  async function updateTicketInline(ticket: TicketListItem, field: Exclude<InlineTicketField, "assignees">, body: Record<string, string | null>) {
    setInlineUpdatingTicket({ ticketId: ticket.id, field });
    setError(null);
    try {
      await apiFetch("/tickets/bulk", {
        method: "PATCH",
        body: JSON.stringify({
          ticketIds: [ticket.id],
          ...body
        })
      });
      await loadTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update ticket.");
    } finally {
      setInlineUpdatingTicket(null);
    }
  }

  function openMergeModal() {
    if (selectedCount < 2) {
      setError("Select at least two tickets to merge.");
      return;
    }

    setMergePrimaryTicketId(selectedTicketIds[0] ?? "");
    setMergeReason("");
    setMergeAllowDifferentClient(false);
    setShowMergeModal(true);
  }

  async function mergeSelectedTickets() {
    if (!mergePrimaryTicket || mergeSourceTickets.length === 0) {
      setError("Choose one primary ticket and at least one ticket to merge into it.");
      return;
    }

    setMergeBusy(true);
    setError(null);
    try {
      await apiFetch(`/tickets/${mergePrimaryTicket.ticketNumber}/merge`, {
        method: "POST",
        body: JSON.stringify({
          sourceTicketIds: mergeSourceTickets.map((ticket) => ticket.id),
          reason: mergeReason.trim() || undefined,
          allowDifferentClient: mergeAllowDifferentClient
        })
      });
      setShowMergeModal(false);
      setSelectedTicketIds([]);
      await loadTickets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to merge selected tickets.");
    } finally {
      setMergeBusy(false);
    }
  }

  function clearFilters() {
    setSearch("");
    setClientId("");
    setScope("all");
    setAssignedUserId("");
    setAssignedTeamId("");
    setExternalSpecialistId("");
    setRequester("");
    setSelectedStatuses([]);
    setPriority("");
    setSource("");
  }

  function changeSort(column: ColumnDefinition) {
    if (!column.sortable) {
      return;
    }

    if (sortBy === column.sortable) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortBy(column.sortable);
    setSortDirection(column.sortable === "createdAt" || column.sortable === "updatedAt" ? "desc" : "asc");
  }

  function toggleColumn(columnId: ColumnId) {
    setVisibleColumns((current) => {
      const next = new Set(current);
      if (next.has(columnId)) {
        if (next.size === 1) {
          return next;
        }
        next.delete(columnId);
      } else {
        next.add(columnId);
      }
      return next;
    });
  }

  function moveColumn(columnId: ColumnId, direction: -1 | 1) {
    setColumnOrder((current) => {
      const index = current.indexOf(columnId);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= current.length) {
        return current;
      }
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function startColumnResize(columnId: ColumnId, event: ReactMouseEvent<HTMLSpanElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = columnWidths[columnId] ?? defaultColumnWidths[columnId];

    function handleMouseMove(moveEvent: MouseEvent) {
      const nextWidth = Math.min(520, Math.max(56, startWidth + moveEvent.clientX - startX));
      setColumnWidths((current) => ({ ...current, [columnId]: nextWidth }));
    }

    function handleMouseUp() {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }

  function toggleTicketSelection(ticketId: string) {
    setSelectedTicketIds((current) => (current.includes(ticketId) ? current.filter((id) => id !== ticketId) : [...current, ticketId]));
  }

  function toggleStatusFilter(definition: TicketStatusDefinition) {
    setSelectedStatuses((current) => {
      const selected = current.includes(definition.id) || current.includes(definition.systemStatus);
      const withoutStatus = current.filter((status) => status !== definition.id && status !== definition.systemStatus);
      return selected ? withoutStatus : [...withoutStatus, definition.id];
    });
  }

  function toggleSelectAllVisible() {
    setSelectedTicketIds((current) => {
      if (allVisibleSelected) {
        return current.filter((id) => !tickets.some((ticket) => ticket.id === id));
      }

      return [...new Set([...current, ...tickets.map((ticket) => ticket.id)])];
    });
  }

  function renderCell(ticket: TicketListItem, columnId: ColumnId) {
    switch (columnId) {
      case "ticketNumber":
        return ticket.id ? <Link className="ticket-number-link" href={`/tickets/${ticket.ticketNumber}`}>{ticket.ticketNumber}</Link> : <span className="ticket-number-link">{ticket.ticketNumber}</span>;
      case "subject":
        return ticket.id ? (
          <Link className="table-cell-stack ticket-subject-link" href={`/tickets/${ticket.ticketNumber}`}>
            <strong>{ticket.subject}</strong>
            <span>{ticket.senderEmail ?? label(ticket.source)}</span>
            <span className="ticket-subject-meta">
              <span>Created: {formatDate(ticket.createdAt)}</span>
              <span>Modified: {formatDate(ticket.updatedAt)}</span>
            </span>
          </Link>
        ) : (
          <span className="table-cell-stack">
            <strong>{ticket.subject}</strong>
            <span>{ticket.senderEmail ?? label(ticket.source)}</span>
            <span className="ticket-subject-meta">
              <span>Created: {formatDate(ticket.createdAt)}</span>
              <span>Modified: {formatDate(ticket.updatedAt)}</span>
            </span>
          </span>
        );
      case "client":
        return ticket.client?.name ?? (ticket.senderDomain ? `Unmapped: ${ticket.senderDomain}` : "Unassigned");
      case "requester":
        return ticket.contact ? (
          <span className="table-cell-stack">
            <strong>
              {ticket.contact.firstName} {ticket.contact.lastName}
            </strong>
            <span>{ticket.contact.email}</span>
          </span>
        ) : (
          ticket.senderEmail ?? "Unknown"
        );
      case "readState":
        return (
          <span className={`status-pill ${ticket.firstReadAt ? "read-pill" : "unread-pill"}`} title={ticket.firstReadBy ? `Opened by ${ticket.firstReadBy.firstName} ${ticket.firstReadBy.lastName}` : undefined}>
            {ticket.firstReadAt ? "Read" : "Unread"}
          </span>
        );
      case "assignees":
        return (
          <select
            className="input inline-ticket-select"
            value={ticket.assignees?.[0]?.user.id ?? ticket.assignedUser?.id ?? ""}
            onChange={(event) => void assignTicketInline(ticket, event.target.value)}
            disabled={isTicketInlineBusy(ticket) || ticket.status === "MERGED" || trashMode}
            title="Assign specialist"
          >
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.firstName} {user.lastName}
              </option>
            ))}
          </select>
        );
      case "team":
        return (
          <select
            className="input inline-ticket-select"
            value={ticket.assignedTeam?.id ?? (ticket.assignedGroup ? "legacy" : "")}
            onChange={(event) => {
              if (event.target.value === "legacy") {
                return;
              }
              void updateTicketInline(ticket, "team", { assignedTeamId: event.target.value || null, assignedGroupId: null });
            }}
            disabled={isTicketInlineBusy(ticket) || ticket.status === "MERGED" || trashMode}
            title="Assign ticket team"
          >
            {ticket.assignedGroup && !ticket.assignedTeam ? <option value="legacy">{ticket.assignedGroup.name} (legacy)</option> : null}
            <option value="">Unassigned</option>
            {editableTicketTeams(ticket).map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        );
      case "status":
        return (
          <div className="ticket-status-stack">
            <select
              className="input inline-ticket-select inline-status-select"
              style={ticketStatusStyle(ticket, ticketStatuses)}
              value={ticketStatusDefinition(ticket, ticketStatuses)?.id ?? ""}
              onChange={(event) => void updateTicketInline(ticket, "status", { statusDefinitionId: event.target.value })}
              disabled={isTicketInlineBusy(ticket) || ticket.status === "MERGED" || trashMode}
              title="Change status"
            >
              {editableTicketStatuses(ticket).filter((status) => status.systemStatus !== "MERGED").map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name}
                </option>
              ))}
              {ticket.status === "MERGED" ? <option value={ticket.statusDefinitionId ?? ""}>Merged</option> : null}
            </select>
            <MergedInIndicator mergedTickets={ticket.mergedTickets} />
          </div>
        );
      case "priority":
        return (
          <select
            className={`input inline-ticket-select inline-priority-select ${priorityClass(ticket.priority)}`}
            value={ticket.priority}
            onChange={(event) => void updateTicketInline(ticket, "priority", { priority: event.target.value })}
            disabled={isTicketInlineBusy(ticket) || ticket.status === "MERGED" || trashMode}
            title="Change priority"
          >
            {priorities.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
        );
      case "source":
        return <span className="status-pill muted-pill ticket-source-pill">{label(ticket.source)}</span>;
      case "createdAt":
        return formatDate(ticket.createdAt);
      case "updatedAt":
        return formatDate(ticket.updatedAt);
      case "messages":
        return <span className="ticket-count-pill">{ticket._count.messages}</span>;
      case "attachments":
        return <span className="ticket-count-pill">{ticket._count.attachments}</span>;
      default:
        return null;
    }
  }

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const hasUrlFilters = hasExplicitTicketUrlFilters(searchParams);
    const requestedView = searchParams.get("view")?.trim() ?? "";
    const initialSearch = searchParams.get("search")?.trim();
    const initialClientId = searchParams.get("clientId")?.trim();
    const initialScope = searchParams.get("scope")?.trim();
    const initialAssignedUserId = searchParams.get("assignedUserId")?.trim();
    const initialAssignedTeamId = searchParams.get("assignedTeamId")?.trim();
    const initialExternalSpecialistId = searchParams.get("externalSpecialistId")?.trim();
    const initialRequester = searchParams.get("requester")?.trim();
    const initialStatuses = searchParams.get("statuses")?.trim();
    const initialStatusDefinitionIds = searchParams.get("statusDefinitionIds")?.trim();
    const initialPriority = searchParams.get("priority")?.trim();
    const initialSource = searchParams.get("source")?.trim();
    const initialDeletedScope = searchParams.get("deletedScope")?.trim();
    const initialSortBy = searchParams.get("sortBy")?.trim();
    const initialSortDirection = searchParams.get("sortDirection")?.trim();

    if (requestedView.startsWith("built-in:")) {
      const builtIn = builtInViews.find((view) => `built-in:${view.id}` === requestedView);
      if (builtIn) {
        applyViewState(builtIn.state);
        setSelectedViewId(requestedView);
      }
    }
    if (initialSearch) {
      setSearch(initialSearch);
    }
    if (initialClientId && UUID_V4_PATTERN.test(initialClientId)) {
      setClientId(initialClientId);
    }
    if (initialScope && ["all", "assigned_to_me", "my_teams", "unassigned"].includes(initialScope)) {
      setScope(initialScope);
    }
    if (initialAssignedUserId && UUID_V4_PATTERN.test(initialAssignedUserId)) {
      setAssignedUserId(initialAssignedUserId);
    }
    if (initialAssignedTeamId && UUID_V4_PATTERN.test(initialAssignedTeamId)) {
      setAssignedTeamId(initialAssignedTeamId);
    }
    if (initialExternalSpecialistId && UUID_V4_PATTERN.test(initialExternalSpecialistId)) {
      setExternalSpecialistId(initialExternalSpecialistId);
    }
    if (initialRequester) {
      setRequester(initialRequester);
    }
    if (initialStatuses || initialStatusDefinitionIds) {
      const requestedStatuses = [initialStatuses, initialStatusDefinitionIds]
        .filter((value): value is string => Boolean(value))
        .flatMap((value) => value.split(","))
        .map((status) => status.trim())
        .filter(isTicketStatusFilter);
      setSelectedStatuses([...new Set(requestedStatuses)]);
    }
    if (initialPriority && priorities.includes(initialPriority)) {
      setPriority(initialPriority);
    }
    if (initialSource && sources.includes(initialSource)) {
      setSource(initialSource);
    }
    if (initialDeletedScope === "deleted") {
      setTrashMode(true);
    }
    if (initialSortBy && ["ticketNumber", "subject", "client", "status", "priority", "source", "createdAt", "updatedAt"].includes(initialSortBy)) {
      setSortBy(initialSortBy as SortBy);
    }
    if (initialSortDirection === "asc" || initialSortDirection === "desc") {
      setSortDirection(initialSortDirection);
    }

    const savedColumns = window.localStorage.getItem(COLUMN_STORAGE_KEY);
    if (savedColumns) {
      try {
        const parsed = JSON.parse(savedColumns) as { order?: unknown; visible?: unknown };
        const nextOrder = normalizeColumnOrder(parsed.order);
        const nextVisible = normalizeVisibleColumns(parsed.visible);
        setColumnOrder(nextOrder);
        setVisibleColumns(new Set(nextVisible));
      } catch {
        window.localStorage.removeItem(COLUMN_STORAGE_KEY);
      }
    }
    const savedWidths = window.localStorage.getItem(COLUMN_WIDTH_STORAGE_KEY);
    if (savedWidths) {
      try {
        setColumnWidths(normalizeColumnWidths(JSON.parse(savedWidths)));
      } catch {
        window.localStorage.removeItem(COLUMN_WIDTH_STORAGE_KEY);
      }
    }
    const savedDensity = window.localStorage.getItem(DENSITY_STORAGE_KEY);
    setDensity(normalizeDensity(savedDensity));

    void loadClients();
    void loadTicketViews({
      preferredViewId: requestedView && !requestedView.startsWith("built-in:") ? requestedView : null,
      applyDefault: !hasUrlFilters && !requestedView
    });
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      COLUMN_STORAGE_KEY,
      JSON.stringify({
        order: columnOrder,
        visible: [...visibleColumns]
      })
    );
  }, [columnOrder, visibleColumns]);

  useEffect(() => {
    window.localStorage.setItem(COLUMN_WIDTH_STORAGE_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
  }, [density]);

  useEffect(() => {
    setPage(1);
  }, [search, clientId, scope, assignedUserId, assignedTeamId, externalSpecialistId, requester, selectedStatuses, priority, source, sortBy, sortDirection, trashMode, pageSize]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!statusFilterRef.current?.contains(event.target as Node)) {
        setShowStatusFilterMenu(false);
      }
    }

    if (showStatusFilterMenu) {
      window.addEventListener("pointerdown", handlePointerDown);
    }

    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [showStatusFilterMenu]);

  useEffect(() => {
    ticketRequestIdRef.current += 1;
    setSelectedTicketIds([]);
    const timeoutId = window.setTimeout(() => {
      void loadTickets();
    }, 300);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, clientId, scope, assignedUserId, assignedTeamId, externalSpecialistId, requester, selectedStatuses, priority, source, sortBy, sortDirection, trashMode, page, pageSize]);

  useEffect(() => {
    void loadNewTicketContacts(newTicketClientId);
  }, [newTicketClientId]);

  useEffect(() => {
    if (!viewNotice) return;
    const timeoutId = window.setTimeout(() => setViewNotice(null), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [viewNotice]);

  return (
    <>
      <div className="tickets-compact-header">
        <div className="tickets-compact-title">
          <div className="tickets-title-copy">
            <h1>Tickets</h1>
          </div>
          <span className="count-pill">{totalTickets} total</span>
        </div>
        <div className="tickets-toolbar-row">
          <label className="input-with-icon tickets-search-field">
            <Search size={16} aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={160} placeholder="Search number, subject, body, client, domain, or requester" />
          </label>
          <select className="input tickets-view-select" value={selectedViewId} onChange={(event) => changeView(event.target.value)}>
            <optgroup label="Standard views">
              {builtInViews.map((view) => (
                <option key={view.id} value={`built-in:${view.id}`}>
                  {view.name}
                </option>
              ))}
            </optgroup>
            {ticketViews.length ? (
              <optgroup label="Saved views">
                {ticketViews.map((view) => (
                  <option key={view.id} value={`saved:${view.id}`}>
                    {view.isDefault ? "* " : ""}{view.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
          <div className="tickets-view-state" aria-live="polite">
            {selectedSavedView?.isDefault ? <span className="tickets-view-badge">Default</span> : null}
            {viewHasUnsavedChanges ? <span className="tickets-view-dirty">Unsaved changes</span> : null}
          </div>
          <div className="form-actions tickets-header-actions">
            <button className={`button ${hasActiveFilters ? "" : "secondary"}`} type="button" onClick={() => setShowAdvancedFilters((current) => !current)}>
              <SlidersHorizontal size={16} aria-hidden="true" />
              <span>{hasActiveFilters ? "Filters Active" : "Filters"}</span>
            </button>
            <button
              className="button secondary tickets-mobile-actions-trigger"
              type="button"
              aria-expanded={showMobileActions}
              onClick={() => setShowMobileActions((current) => !current)}
            >
              <MoreHorizontal size={16} aria-hidden="true" />
              <span>Actions</span>
            </button>
            <div className={`tickets-secondary-actions ${showMobileActions ? "open" : ""}`}>
              <button className="button" type="button" onClick={() => setShowNewTicketModal(true)}>
                <Plus size={16} aria-hidden="true" />
                <span>New Ticket</span>
              </button>
              <button className={`button ${viewHasUnsavedChanges ? "" : "secondary"}`} type="button" onClick={openViewManager}>
                <Save size={16} aria-hidden="true" />
                <span>{viewHasUnsavedChanges ? "Save Changes" : selectedSavedView ? "View Options" : "Save View"}</span>
              </button>
              <button className="button secondary" type="button" onClick={() => void loadTickets()} disabled={loading}>
                <RefreshCcw size={16} aria-hidden="true" />
                <span>Refresh</span>
              </button>
              <button className="button secondary" type="button" onClick={() => setShowColumnsPanel((current) => !current)}>
                <SlidersHorizontal size={16} aria-hidden="true" />
                <span>Columns</span>
              </button>
              <button className={`button ${trashMode ? "" : "secondary"}`} type="button" onClick={() => setTrashMode((current) => !current)}>
                {trashMode ? <RotateCcw size={16} aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
                <span>{trashMode ? "Active Tickets" : "Recycle Bin"}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      {viewNotice ? <div className="success-banner">{viewNotice}</div> : null}
      {showAdvancedFilters ? (
        <section className="panel tickets-toolbar-panel">
          <div className="tickets-filter-grid">
          <select className="input" value={clientId} onChange={(event) => setClientId(event.target.value)}>
            <option value="">All clients</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          <select className="input" value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value="all">All tickets</option>
            <option value="assigned_to_me">My tickets</option>
            <option value="my_teams">My team tickets</option>
            <option value="unassigned">Unassigned</option>
          </select>
          <select className="input" value={assignedTeamId} onChange={(event) => setAssignedTeamId(event.target.value)}>
            <option value="">All ticket teams</option>
            {ticketTeams.filter((team) => team.isActive).map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          <select className="input" value={externalSpecialistId} onChange={(event) => setExternalSpecialistId(event.target.value)}>
            <option value="">All external specialists</option>
            {externalSpecialists.filter((specialist) => specialist.isActive).map((specialist) => (
              <option key={specialist.id} value={specialist.id}>
                {specialist.name}{specialist.company ? ` (${specialist.company})` : ""}
              </option>
            ))}
          </select>
          <input className="input" value={requester} onChange={(event) => setRequester(event.target.value)} maxLength={160} placeholder="Requester name or email" />
          <div className={`ticket-status-filter ${showStatusFilterMenu ? "open" : ""}`} ref={statusFilterRef}>
            <button
              className="ticket-status-filter-trigger"
              type="button"
              aria-expanded={showStatusFilterMenu}
              onClick={() => setShowStatusFilterMenu((current) => !current)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setShowStatusFilterMenu(false);
                }
              }}
            >
              <span>{selectedStatuses.length ? `${selectedStatuses.length} status${selectedStatuses.length === 1 ? "" : "es"}` : "All statuses"}</span>
            </button>
            <div className="ticket-status-filter-menu" onKeyDown={(event) => event.key === "Escape" && setShowStatusFilterMenu(false)}>
              {ticketStatuses.map((status) => (
                <label className="checkbox-row" key={status.id}>
                  <input type="checkbox" checked={selectedStatuses.includes(status.id) || selectedStatuses.includes(status.systemStatus)} onChange={() => toggleStatusFilter(status)} />
                  <span className="ticket-status-swatch" style={{ backgroundColor: status.color }} />
                  {status.name}
                </label>
              ))}
              {selectedStatuses.length ? (
                <button className="button secondary compact-button" type="button" onClick={() => setSelectedStatuses([])}>
                  Clear statuses
                </button>
              ) : null}
            </div>
          </div>
          <select className="input" value={priority} onChange={(event) => setPriority(event.target.value)}>
            <option value="">All priorities</option>
            {priorities.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
          <select className="input" value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="">All sources</option>
            {sources.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </select>
          <button className="button secondary" type="button" onClick={clearFilters} disabled={!hasActiveFilters}>
            Clear
          </button>
          </div>
        </section>
      ) : null}
      {showColumnsPanel ? (
        <section className="panel tickets-toolbar-panel">
          <div className="column-config-toolbar">
            <select className="input compact-select" value={density} onChange={(event) => setDensity(event.target.value as TableDensity)}>
              <option value="comfortable">Comfortable rows</option>
              <option value="compact">Compact rows</option>
            </select>
          </div>
          <div className="column-config-panel">
            {columnOrder.map((columnId, index) => {
              const column = allColumns.find((item) => item.id === columnId);
              if (!column) {
                return null;
              }

              return (
                <div className="column-config-row" key={column.id}>
                  <label>
                    <input type="checkbox" checked={visibleColumns.has(column.id)} onChange={() => toggleColumn(column.id)} />
                    <span>{column.label}</span>
                  </label>
                  <div className="row-actions">
                    <button className="icon-button" type="button" title="Move left" aria-label={`Move ${column.label} column left`} onClick={() => moveColumn(column.id, -1)} disabled={index === 0}>
                      <ArrowLeft size={15} aria-hidden="true" />
                    </button>
                    <button className="icon-button" type="button" title="Move right" aria-label={`Move ${column.label} column right`} onClick={() => moveColumn(column.id, 1)} disabled={index === columnOrder.length - 1}>
                      <ArrowRight size={15} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
      {selectedCount > 0 ? (
      <section className="panel bulk-actions-panel">
        <div className="bulk-actions-summary">
          <strong>
            {selectedCount} selected {trashMode ? "in recycle bin" : ""}
          </strong>
          {selectedCount > 0 ? (
            <button className="button secondary" type="button" onClick={() => setSelectedTicketIds([])}>
              Clear selection
            </button>
          ) : null}
        </div>
        {trashMode ? (
          <div className="form-actions">
            <button className="button" type="button" onClick={restoreSelectedTickets} disabled={selectedCount === 0 || bulkBusy}>
              <RotateCcw size={16} aria-hidden="true" />
              <span>Restore Selected</span>
            </button>
          </div>
        ) : (
          <div className="bulk-actions-grid">
            <select className="input" value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)}>
              <option value="">Change status</option>
              {ticketStatuses.filter((status) => status.systemStatus !== "MERGED").map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name}
                </option>
              ))}
            </select>
            <select className="input" value={bulkAssignedUserId} onChange={(event) => setBulkAssignedUserId(event.target.value)}>
              <option value="">Assign technician</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.firstName} {user.lastName}
                </option>
              ))}
            </select>
            <select className="input" value={bulkAssignedTeamId} onChange={(event) => setBulkAssignedTeamId(event.target.value)}>
              <option value="">Assign ticket team</option>
              {ticketTeams.filter((team) => team.isActive).map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
            <select className="input" value={bulkPriority} onChange={(event) => setBulkPriority(event.target.value)}>
              <option value="">Set priority</option>
              {priorities.map((value) => (
                <option key={value} value={value}>
                  {label(value)}
                </option>
              ))}
            </select>
            <button className="button" type="button" onClick={applyBulkUpdate} disabled={selectedCount === 0 || bulkBusy}>
              Apply
            </button>
            <button className="button secondary" type="button" onClick={openMergeModal} disabled={selectedCount < 2 || bulkBusy}>
              <GitMerge size={16} aria-hidden="true" />
              <span>Merge</span>
            </button>
            <button className="button danger" type="button" onClick={deleteSelectedTickets} disabled={selectedCount === 0 || bulkBusy}>
              <Trash2 size={16} aria-hidden="true" />
              <span>Delete</span>
            </button>
          </div>
        )}
      </section>
      ) : null}
      <section className="panel tickets-table-panel">
        <div className="table-summary">
          <span>
            {totalTickets} ticket{totalTickets === 1 ? "" : "s"}
          </span>
          <span className="muted">{loading ? "Refreshing..." : `Sorted by ${allColumns.find((column) => column.sortable === sortBy)?.label ?? "Modified"}`}</span>
        </div>
        <div className="table-scroll">
          <table className={`table tickets-table ${density}`}>
            <colgroup>
              <col style={{ width: 42 }} />
              {visibleOrderedColumns.map((column) => (
                <col key={column.id} style={{ width: columnWidths[column.id] ?? defaultColumnWidths[column.id] }} />
              ))}
              <col style={{ width: 54 }} />
            </colgroup>
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} aria-label="Select all visible tickets" />
                </th>
                {visibleOrderedColumns.map((column) => (
                  <th key={column.id}>
                    <div className="resizable-column-header">
                      {column.sortable ? (
                        <button className="table-sort-button" type="button" onClick={() => changeSort(column)}>
                          <span>{column.label}</span>
                          {sortBy === column.sortable ? (
                            sortDirection === "asc" ? (
                              <ArrowUp size={14} aria-hidden="true" />
                            ) : (
                              <ArrowDown size={14} aria-hidden="true" />
                            )
                          ) : (
                            <ArrowUpDown size={14} aria-hidden="true" />
                          )}
                        </button>
                      ) : (
                        <span>{column.label}</span>
                      )}
                      <span className="column-resize-handle" role="separator" aria-label={`Resize ${column.label} column`} onMouseDown={(event) => startColumnResize(column.id, event)} />
                    </div>
                  </th>
                ))}
                <th>
                  <span className="visually-hidden">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="tickets-empty-cell" colSpan={visibleOrderedColumns.length + 2}>Loading tickets...</td>
                </tr>
              ) : null}
              {!loading && tickets.length === 0 ? (
                <tr>
                  <td className="tickets-empty-cell" colSpan={visibleOrderedColumns.length + 2}>No tickets match the current filters.</td>
                </tr>
              ) : null}
              {tickets.map((ticket, index) => (
                <tr className={selectedTicketIds.includes(ticket.id) ? "selected" : ""} key={ticket.id ?? `${ticket.ticketNumber}-${index}`}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedTicketIds.includes(ticket.id)}
                      onChange={() => toggleTicketSelection(ticket.id)}
                      aria-label={`Select ${ticket.ticketNumber}`}
                    />
                  </td>
                  {visibleOrderedColumns.map((column) => (
                    <td key={column.id}>{renderCell(ticket, column.id)}</td>
                  ))}
                  <td className="row-actions-cell">
                    {ticket.id ? (
                      <Link className="icon-button" href={`/tickets/${ticket.ticketNumber}`} title="Open ticket" aria-label={`Open ticket ${ticket.ticketNumber}`}>
                        <Eye size={16} aria-hidden="true" />
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mobile-ticket-list">
          {loading ? <div className="mobile-empty-state">Loading tickets...</div> : null}
          {!loading && tickets.length === 0 ? <div className="mobile-empty-state">No tickets match the current filters.</div> : null}
          {tickets.map((ticket, index) => (
            <article className={`mobile-ticket-card${selectedTicketIds.includes(ticket.id) ? " selected" : ""}`} key={ticket.id ?? `${ticket.ticketNumber}-mobile-${index}`}>
              <div className="mobile-ticket-card-header">
                <label className="mobile-ticket-select-row">
                  <input
                    type="checkbox"
                    checked={selectedTicketIds.includes(ticket.id)}
                    onChange={() => toggleTicketSelection(ticket.id)}
                    aria-label={`Select ${ticket.ticketNumber}`}
                  />
                  <span>{ticket.ticketNumber}</span>
                </label>
                <span className={`status-pill ${statusClass(ticket.status)}`} style={ticketStatusStyle(ticket, ticketStatuses)}>{ticketStatusName(ticket, ticketStatuses)}</span>
              </div>
              <Link className="mobile-ticket-subject" href={`/tickets/${ticket.ticketNumber}`}>
                <strong>{ticket.subject}</strong>
                <span>{ticket.senderEmail ?? label(ticket.source)}</span>
              </Link>
              <div className="mobile-ticket-meta-grid">
                <span>
                  <small>Client</small>
                  <strong>{ticket.client?.name ?? (ticket.senderDomain ? `Unmapped: ${ticket.senderDomain}` : "Unassigned")}</strong>
                </span>
                <span>
                  <small>Requester</small>
                  <strong>{ticket.contact ? `${ticket.contact.firstName} ${ticket.contact.lastName}` : ticket.senderEmail ?? "Unknown"}</strong>
                </span>
                <span>
                  <small>Created</small>
                  <strong>{formatDate(ticket.createdAt)}</strong>
                </span>
                <span>
                  <small>Modified</small>
                  <strong>{formatDate(ticket.updatedAt)}</strong>
                </span>
              </div>
              <div className="mobile-ticket-controls">
                <label>
                  <span>Specialist</span>
                  {renderCell(ticket, "assignees")}
                </label>
                <label>
                  <span>Team</span>
                  {renderCell(ticket, "team")}
                </label>
                <label>
                  <span>Status</span>
                  {renderCell(ticket, "status")}
                </label>
                <label>
                  <span>Priority</span>
                  {renderCell(ticket, "priority")}
                </label>
              </div>
              <Link className="button secondary mobile-ticket-open" href={`/tickets/${ticket.ticketNumber}`}>
                <Eye size={16} aria-hidden="true" />
                <span>Open Ticket</span>
              </Link>
            </article>
          ))}
        </div>
        <div className="pagination-bar">
          <div className="form-actions">
            <span className="muted">Rows</span>
            <select className="input compact-select" value={pageSize} onChange={(event) => setPageSize(event.target.value as "20" | "50" | "100" | "all")}>
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="all">All</option>
            </select>
          </div>
          <div className="form-actions">
            <button className="button secondary" type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || pageSize === "all"}>
              Previous
            </button>
            <span className="muted">
              Page {pageSize === "all" ? 1 : page} of {totalPages}
            </span>
            <button className="button secondary" type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages || pageSize === "all"}>
              Next
            </button>
          </div>
        </div>
      </section>
      {showViewModal ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel compact-modal ticket-view-modal" role="dialog" aria-modal="true" aria-labelledby="ticket-view-modal-title">
            <div className="modal-header">
              <div>
                <h2 id="ticket-view-modal-title">{selectedSavedView ? "Manage Ticket View" : "Save Ticket View"}</h2>
                <p className="muted">Store the current filters, sorting, columns, row density, and page size.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowViewModal(false)} aria-label="Close ticket view dialog" disabled={viewBusy}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <label className="field">
              <span>View name</span>
              <input
                className="input"
                value={viewName}
                onChange={(event) => setViewName(event.target.value)}
                maxLength={80}
                autoFocus
              />
            </label>
            {viewError ? <div className="error-banner ticket-view-error">{viewError}</div> : null}
            <label className="checkbox-card ticket-view-default-toggle">
              <input type="checkbox" checked={viewIsDefault} onChange={(event) => setViewIsDefault(event.target.checked)} />
              <span>
                <strong>Use as my default ticket view</strong>
                <small>This view opens automatically when Tickets has no explicit filters.</small>
              </span>
            </label>
            <div className="ticket-view-summary" aria-label="Current view summary">
              <span><strong>{hasActiveFilters ? "Filtered" : "All tickets"}</strong><small>Scope</small></span>
              <span><strong>{selectedStatuses.length || "All"}</strong><small>Statuses</small></span>
              <span><strong>{label(sortBy)}</strong><small>{sortDirection === "asc" ? "Ascending" : "Descending"}</small></span>
              <span><strong>{pageSize === "all" ? "All" : pageSize}</strong><small>Rows</small></span>
              <span><strong>{visibleColumns.size}</strong><small>Columns</small></span>
              <span><strong>{trashMode ? "Recycle bin" : label(density)}</strong><small>Mode</small></span>
            </div>
            {selectedSavedView ? (
              <p className="muted ticket-view-copy-note">To create a separate view, enter a unique name and choose Save as New.</p>
            ) : null}
            {viewDeleteConfirm ? (
              <div className="ticket-view-delete-confirm" role="alert">
                <span>Delete “{selectedSavedView?.name}”? Tickets and filters will not be deleted.</span>
                <div className="form-actions">
                  <button className="button secondary" type="button" onClick={() => setViewDeleteConfirm(false)} disabled={viewBusy}>Cancel</button>
                  <button className="button danger" type="button" onClick={() => void deleteCurrentView()} disabled={viewBusy}>
                    <Trash2 size={15} aria-hidden="true" />
                    <span>{viewBusy ? "Deleting..." : "Delete View"}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="modal-actions ticket-view-actions">
                {selectedSavedView ? (
                  <button className="button danger ghost-danger" type="button" onClick={() => setViewDeleteConfirm(true)} disabled={viewBusy}>
                    <Trash2 size={15} aria-hidden="true" />
                    <span>Delete</span>
                  </button>
                ) : null}
                <span className="ticket-view-actions-spacer" />
                <button className="button secondary" type="button" onClick={() => setShowViewModal(false)} disabled={viewBusy}>Cancel</button>
                {selectedSavedView ? (
                  <button className="button secondary" type="button" onClick={() => void saveTicketView("CREATE")} disabled={viewBusy || !viewName.trim()}>
                    <Plus size={15} aria-hidden="true" />
                    <span>Save as New</span>
                  </button>
                ) : null}
                <button className="button" type="button" onClick={() => void saveTicketView(selectedSavedView ? "UPDATE" : "CREATE")} disabled={viewBusy || !viewName.trim()}>
                  <Save size={15} aria-hidden="true" />
                  <span>{viewBusy ? "Saving..." : selectedSavedView ? "Update View" : "Create View"}</span>
                </button>
              </div>
            )}
          </section>
        </div>
      ) : null}
      {showNewTicketModal ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel compact-modal" role="dialog" aria-modal="true" aria-labelledby="new-ticket-modal-title">
            <div className="modal-header">
              <div>
                <h2 id="new-ticket-modal-title">New Ticket</h2>
                <p className="muted">Create a manual ticket using the existing ticket workflow.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowNewTicketModal(false)} aria-label="Close new ticket dialog">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="ticket-create-grid">
              <label className="field">
                <span>Client</span>
                <select className="input" value={newTicketClientId} onChange={(event) => setNewTicketClientId(event.target.value)}>
                  <option value="">No client</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Requester</span>
                <select className="input" value={newTicketContactId} onChange={(event) => setNewTicketContactId(event.target.value)} disabled={!newTicketClientId}>
                  <option value="">No requester</option>
                  {newTicketContacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.firstName} {contact.lastName} - {contact.email}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field ticket-create-wide">
                <span>Subject</span>
                <input className="input" value={newTicketSubject} onChange={(event) => setNewTicketSubject(event.target.value)} />
              </label>
              <label className="field ticket-create-wide">
                <span>Description</span>
                <textarea className="input" rows={4} value={newTicketDescription} onChange={(event) => setNewTicketDescription(event.target.value)} />
              </label>
              <label className="field">
                <span>Priority</span>
                <select className="input" value={newTicketPriority} onChange={(event) => setNewTicketPriority(event.target.value)}>
                  {priorities.map((value) => (
                    <option key={value} value={value}>
                      {label(value)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Status</span>
                <select className="input" value={newTicketStatus} onChange={(event) => setNewTicketStatus(event.target.value)}>
                  <option value="">Default status</option>
                  {ticketStatuses.filter((status) => status.systemStatus !== "MERGED").map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Assigned technician</span>
                <select className="input" value={newTicketAssignedUserId} onChange={(event) => setNewTicketAssignedUserId(event.target.value)}>
                  <option value="">Unassigned</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.firstName} {user.lastName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Ticket team</span>
                <select className="input" value={newTicketAssignedTeamId} onChange={(event) => setNewTicketAssignedTeamId(event.target.value)}>
                  <option value="">No team</option>
                  {ticketTeams.filter((team) => team.isActive).map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="modal-actions">
              <button className="button secondary" type="button" onClick={() => setShowNewTicketModal(false)} disabled={newTicketBusy}>
                Cancel
              </button>
              <button className="button" type="button" onClick={createManualTicket} disabled={newTicketBusy || !newTicketSubject.trim()}>
                <Plus size={16} aria-hidden="true" />
                <span>{newTicketBusy ? "Creating..." : "Create Ticket"}</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {showMergeModal ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel compact-modal" role="dialog" aria-modal="true" aria-labelledby="ticket-merge-modal-title">
            <div className="modal-header">
              <div>
                <h2 id="ticket-merge-modal-title">Merge Tickets</h2>
                <p className="muted">Choose the primary ticket that will keep the full conversation.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowMergeModal(false)} aria-label="Close merge dialog">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="merge-ticket-list">
              {selectedTickets.map((ticket) => (
                <label className="merge-ticket-option" key={ticket.id}>
                  <input type="radio" name="merge-primary-ticket" checked={ticket.id === mergePrimaryTicket?.id} onChange={() => setMergePrimaryTicketId(ticket.id)} />
                  <span>
                    <strong>{ticket.ticketNumber}</strong>
                    <span>{ticket.subject}</span>
                    <span className="muted">{ticket.client?.name ?? "Unassigned"} - {ticketStatusName(ticket, ticketStatuses)}</span>
                  </span>
                </label>
              ))}
            </div>
            <label className="field">
              <span>Merge reason</span>
              <textarea className="input" rows={3} value={mergeReason} onChange={(event) => setMergeReason(event.target.value)} placeholder="Optional note for the internal merge summary" />
            </label>
            <label className="checkbox-card">
              <input type="checkbox" checked={mergeAllowDifferentClient} onChange={(event) => setMergeAllowDifferentClient(event.target.checked)} />
              <span>Allow merge if selected tickets belong to different clients</span>
            </label>
            {mergePrimaryTicket ? (
              <p className="muted">
                {mergeSourceTickets.length} ticket{mergeSourceTickets.length === 1 ? "" : "s"} will be merged into {mergePrimaryTicket.ticketNumber}. Messages and files are moved to the primary ticket.
              </p>
            ) : null}
            <div className="modal-actions">
              <button className="button secondary" type="button" onClick={() => setShowMergeModal(false)} disabled={mergeBusy}>
                Cancel
              </button>
              <button className="button" type="button" onClick={mergeSelectedTickets} disabled={mergeBusy || !mergePrimaryTicket || mergeSourceTickets.length === 0}>
                <GitMerge size={16} aria-hidden="true" />
                <span>{mergeBusy ? "Merging..." : "Merge Tickets"}</span>
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
