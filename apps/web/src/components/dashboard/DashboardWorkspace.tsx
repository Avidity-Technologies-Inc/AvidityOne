"use client";

import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ClipboardList,
  Database,
  EyeOff,
  GripVertical,
  HardDrive,
  Inbox,
  Monitor,
  RotateCcw,
  Save,
  Server,
  Settings2,
  Ticket,
  UsersRound,
  UserX,
  Zap
} from "lucide-react";
import Link from "next/link";
import type { DragEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";

interface DashboardTicket {
  ticketNumber: string;
  subject: string;
  status: string;
  statusDefinitionId?: string | null;
  statusDefinition?: { id: string; name: string; color: string } | null;
  priority: string;
  clientName: string;
  assignedTo: string;
  createdAt: string;
  updatedAt: string;
  href: string;
}

interface DashboardStats {
  timeZone?: string;
  staleBefore?: string;
  summary: {
    totalOpen: number;
    newTickets: number;
    closedTickets: number;
    unassignedTickets: number;
    highPriorityTickets: number;
    awaitingCustomer: number;
    awaitingTechnician: number;
    noRecentUpdate: number;
  };
  byStatus: Array<{ status: string; statusDefinitionId: string | null; label: string; color: string | null; count: number; filter: { statuses?: string[]; statusDefinitionIds?: string[] } }>;
  byPriority: Array<{ priority: string; count: number; filter: { priority: string } }>;
  bySource: Array<{ source: string; count: number; filter: { source: string } }>;
  byClient: Array<{ clientId: string | null; name: string; count: number; filter: { clientId?: string } }>;
  workload: Array<{ userId: string; name: string; count: number; filter: { assignedUserId: string } }>;
  agingBuckets?: Array<{ label: string; count: number }>;
  staleBySpecialist?: Array<{ userId: string; name: string; count: number; filter: { assignedUserId: string; statuses: string[]; sortBy: string; sortDirection: string } }>;
  specialistPerformance?: Array<{
    userId: string;
    name: string;
    assignedActive: number;
    awaitingTechnician: number;
    closedLast30Days: number;
    totalAssigned: number;
    averageDailyClosed: number;
    teamAverageActive: number;
    filter: { assignedUserId: string };
  }>;
  specialistTrend?: Array<{
    userId: string;
    name: string;
    points: Array<{ date: string; label: string; assigned: number; closed: number }>;
  }>;
  activityByDay: Array<{ date: string; label: string; created: number; closed: number }>;
  createdByHour: Array<{ hour: number; label: string; count: number }>;
  insightTickets: {
    critical: DashboardTicket[];
    unassigned: DashboardTicket[];
    stale: DashboardTicket[];
  };
}

interface DashboardDeviceStats {
  summary: {
    total: number;
    active: number;
    inactive: number;
    retired: number;
    servers: number;
    workstations: number;
    otherTypes: number;
  };
  byClient: Array<{
    clientId: string;
    name: string;
    total: number;
    active: number;
    inactive: number;
    servers: number;
    workstations: number;
  }>;
  byOperatingSystem: Array<{ name: string; count: number }>;
  byType: Array<{ type: string; total: number; active: number; inactive: number }>;
  signals: {
    errors: number;
    warnings: number;
    info: number;
    items: Array<{
      deviceId: string;
      hostname: string;
      clientName: string;
      severity: "ERROR" | "WARNING" | "INFO";
      message: string;
      checkedAt: string;
      status: string;
    }>;
  };
}

type EventStatus = "NEW" | "UNDER_REVIEW" | "SCHEDULED" | "ASSIGNED" | "IN_PROGRESS" | "WAITING_ON_CLIENT" | "WAITING_ON_INTERNAL_TEAM" | "COMPLETED" | "CANCELLED" | "CONVERTED_TO_TICKET";

interface DashboardEventRequest {
  id: string;
  status: EventStatus;
}

type DashboardWidgetId =
  | "ticketKpis"
  | "eventKpis"
  | "deviceOverview"
  | "ticketActivity"
  | "ticketsByStatus"
  | "ticketsByPriority"
  | "specialistTrend"
  | "createdByHour"
  | "technicianWorkload"
  | "ticketAging"
  | "staleBySpecialist"
  | "specialistPerformance"
  | "ticketsByClient"
  | "ticketsBySource"
  | "deviceSignals"
  | "criticalTickets"
  | "unassignedTickets"
  | "staleTickets";

interface DashboardPreference {
  layout: string[];
  hiddenWidgets: string[];
}

interface DashboardWidgetDefinition {
  id: DashboardWidgetId;
  label: string;
  group: "summary" | "analytics" | "insight";
  wide?: boolean;
}

const activeStatuses = ["NEW", "OPEN", "IN_PROGRESS", "WAITING_ON_CUSTOMER", "WAITING_ON_TECHNICIAN", "WAITING_ON_THIRD_PARTY", "REOPENED"];
const activeEventStatuses: EventStatus[] = ["ASSIGNED", "IN_PROGRESS", "WAITING_ON_CLIENT", "WAITING_ON_INTERNAL_TEAM"];
const chartColors = ["#155eef", "#16a34a", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#64748b", "#ec4899"];
const defaultDashboardWidgets: DashboardWidgetDefinition[] = [
  { id: "ticketKpis", label: "Ticket summary cards", group: "summary" },
  { id: "eventKpis", label: "Event service summary cards", group: "summary" },
  { id: "ticketActivity", label: "Ticket Activity", group: "analytics", wide: true },
  { id: "specialistTrend", label: "Specialist Trend", group: "analytics", wide: true },
  { id: "specialistPerformance", label: "Specialist Performance", group: "analytics", wide: true },
  { id: "deviceOverview", label: "Devices / RMM overview", group: "analytics", wide: true },
  { id: "deviceSignals", label: "Device Signals", group: "analytics", wide: true },
  { id: "technicianWorkload", label: "Technician Workload", group: "analytics" },
  { id: "ticketsByClient", label: "Tickets by Client", group: "analytics" },
  { id: "ticketAging", label: "Ticket Aging", group: "analytics" },
  { id: "staleBySpecialist", label: "Stale by Specialist", group: "analytics" },
  { id: "createdByHour", label: "Created by Hour", group: "analytics" },
  { id: "ticketsByStatus", label: "Tickets by Status", group: "analytics" },
  { id: "ticketsByPriority", label: "Tickets by Priority", group: "analytics" },
  { id: "ticketsBySource", label: "Tickets by Source", group: "analytics" },
  { id: "criticalTickets", label: "Critical and High Priority", group: "insight" },
  { id: "unassignedTickets", label: "Unassigned Tickets", group: "insight" },
  { id: "staleTickets", label: "No Recent Update", group: "insight" }
];
const defaultDashboardLayout = defaultDashboardWidgets.map((widget) => widget.id);
const widgetDefinitionById = new Map(defaultDashboardWidgets.map((widget) => [widget.id, widget]));

function label(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function ticketHref(filter: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (Array.isArray(value) && value.length > 0) {
      params.set(key, value.join(","));
    } else if (typeof value === "string" && value) {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return query ? `/tickets?${query}` : "/tickets";
}

function eventHref(filter: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `/event-services?${query}` : "/event-services";
}

function deviceHref(filter: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `/devices?${query}` : "/devices";
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "2-digit", hour: "numeric", minute: "2-digit" });
}

function normalizeDashboardPreference(preference?: Partial<DashboardPreference> | null): DashboardPreference {
  const knownIds = new Set(defaultDashboardLayout);
  const layout = [...(preference?.layout ?? []).filter((id): id is DashboardWidgetId => knownIds.has(id as DashboardWidgetId)), ...defaultDashboardLayout.filter((id) => !(preference?.layout ?? []).includes(id))];
  const hiddenWidgets = (preference?.hiddenWidgets ?? []).filter((id): id is DashboardWidgetId => knownIds.has(id as DashboardWidgetId));
  return { layout, hiddenWidgets };
}

function KpiCard({ title, value, href, tone, icon: Icon, note }: { title: string; value: number; href: string; tone: string; icon: typeof Ticket; note: string }) {
  return (
    <Link className={`dashboard-kpi-card ${tone}`} href={href}>
      <span className="dashboard-kpi-icon">
        <Icon size={18} aria-hidden="true" />
      </span>
      <span className="dashboard-kpi-label">{title}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </Link>
  );
}

function DonutChart({ title, subtitle, items }: { title: string; subtitle: string; items: Array<{ label: string; count: number; href: string }> }) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  let offset = 25;

  return (
    <div className="panel dashboard-chart-card">
      <div className="section-heading compact-heading">
        <div>
          <h2>{title}</h2>
          <p className="muted">{subtitle}</p>
        </div>
        <span className="count-pill">{total} total</span>
      </div>
      <div className="dashboard-donut-layout">
        <svg className="dashboard-donut" viewBox="0 0 42 42" role="img" aria-label={title}>
          <circle className="dashboard-donut-track" cx="21" cy="21" r="15.915" />
          {total > 0
            ? items.map((item, index) => {
                const value = (item.count / total) * 100;
                const segment = (
                  <circle
                    className="dashboard-donut-segment"
                    cx="21"
                    cy="21"
                    key={item.label}
                    r="15.915"
                    stroke={chartColors[index % chartColors.length]}
                    strokeDasharray={`${value} ${100 - value}`}
                    strokeDashoffset={offset}
                  />
                );
                offset -= value;
                return segment;
              })
            : null}
          <text x="21" y="20" textAnchor="middle" className="dashboard-donut-total">
            {total}
          </text>
          <text x="21" y="25" textAnchor="middle" className="dashboard-donut-caption">
            tickets
          </text>
        </svg>
        <div className="dashboard-legend">
          {items.length ? (
            items.map((item, index) => (
              <Link className="dashboard-legend-row" href={item.href} key={item.label}>
                <span className="dashboard-legend-color" style={{ backgroundColor: chartColors[index % chartColors.length] }} />
                <span>{item.label}</span>
                <strong>{item.count}</strong>
              </Link>
            ))
          ) : (
            <p className="dashboard-empty">No data yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ActivityChart({ items }: { items: DashboardStats["activityByDay"] }) {
  const maxValue = Math.max(1, ...items.flatMap((item) => [item.created, item.closed]));

  return (
    <div className="panel dashboard-chart-card dashboard-wide-card">
      <div className="section-heading compact-heading">
        <div>
          <h2>Ticket Activity</h2>
          <p className="muted">Created and closed tickets over the last 30 days.</p>
        </div>
      </div>
      <div className="dashboard-activity-chart" role="img" aria-label="Tickets created and closed by day">
        {items.map((item, index) => (
          <div className="dashboard-activity-day" key={item.date} title={`${item.label}: ${item.created} created, ${item.closed} closed`}>
            <div className="dashboard-activity-bars">
              <span className="created" style={{ height: `${Math.max(0, (item.created / maxValue) * 100)}%` }} />
              <span className="closed" style={{ height: `${Math.max(0, (item.closed / maxValue) * 100)}%` }} />
            </div>
            {index % 5 === 0 || index === items.length - 1 ? <small>{item.label}</small> : <small aria-hidden="true" />}
          </div>
        ))}
      </div>
      <div className="dashboard-chart-legend">
        <span>
          <i className="created" /> Created
        </span>
        <span>
          <i className="closed" /> Closed
        </span>
      </div>
    </div>
  );
}

function SpecialistTrendChart({ items }: { items: NonNullable<DashboardStats["specialistTrend"]> }) {
  const [selectedUserId, setSelectedUserId] = useState("");
  const selected = items.find((item) => item.userId === selectedUserId) ?? items[0];
  const points = selected?.points ?? [];
  const maxValue = Math.max(1, ...points.flatMap((point) => [point.assigned, point.closed]));

  useEffect(() => {
    if (!items.length) {
      setSelectedUserId("");
      return;
    }
    if (!items.some((item) => item.userId === selectedUserId)) {
      setSelectedUserId(items[0].userId);
    }
  }, [items, selectedUserId]);

  return (
    <div className="panel dashboard-chart-card dashboard-wide-card">
      <div className="section-heading compact-heading">
        <div>
          <h2>Specialist Trend</h2>
          <p className="muted">Assigned and closed ticket movement over the last 30 days.</p>
        </div>
        {items.length ? (
          <select className="input compact-select" value={selected?.userId ?? ""} onChange={(event) => setSelectedUserId(event.target.value)}>
            {items.map((item) => (
              <option value={item.userId} key={item.userId}>
                {item.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {points.length ? (
        <>
          <div className="dashboard-activity-chart dashboard-specialist-trend-chart" role="img" aria-label="Assigned and closed tickets by specialist">
            {points.map((point, index) => (
              <div className="dashboard-activity-day" key={point.date} title={`${point.label}: ${point.assigned} assigned, ${point.closed} closed`}>
                <div className="dashboard-activity-bars">
                  <span className="assigned" style={{ height: `${Math.max(0, (point.assigned / maxValue) * 100)}%` }} />
                  <span className="closed" style={{ height: `${Math.max(0, (point.closed / maxValue) * 100)}%` }} />
                </div>
                {index % 5 === 0 || index === points.length - 1 ? <small>{point.label}</small> : <small aria-hidden="true" />}
              </div>
            ))}
          </div>
          <div className="dashboard-chart-legend dashboard-specialist-trend-legend">
            <span>
              <i className="assigned" /> Assigned
            </span>
            <span>
              <i className="closed" /> Closed
            </span>
          </div>
        </>
      ) : (
        <p className="dashboard-empty">No specialist activity yet.</p>
      )}
    </div>
  );
}

function HourChart({ items }: { items: DashboardStats["createdByHour"] }) {
  const maxValue = Math.max(1, ...items.map((item) => item.count));

  return (
    <div className="panel dashboard-chart-card">
      <div className="section-heading compact-heading">
        <div>
          <h2>Created by Hour</h2>
          <p className="muted">New ticket arrival pattern for the last 30 days.</p>
        </div>
      </div>
      <div className="dashboard-hour-chart" role="img" aria-label="Tickets created by hour">
        {items.map((item) => (
          <span key={item.hour} title={`${item.label}: ${item.count}`} style={{ height: `${Math.max(0, (item.count / maxValue) * 100)}%` }} />
        ))}
      </div>
      <div className="dashboard-hour-axis">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
    </div>
  );
}

function HorizontalBarList({ title, subtitle, items }: { title: string; subtitle: string; items: Array<{ label: string; count: number; href?: string }> }) {
  const maxValue = Math.max(1, ...items.map((item) => item.count));

  return (
    <div className="panel dashboard-chart-card">
      <div className="section-heading compact-heading">
        <div>
          <h2>{title}</h2>
          <p className="muted">{subtitle}</p>
        </div>
      </div>
      <div className="dashboard-horizontal-bars">
        {items.length ? (
          items.map((item, index) => {
            const content = (
              <>
                <span>{item.label}</span>
                <strong>{item.count}</strong>
                <i style={{ width: `${Math.max(8, (item.count / maxValue) * 100)}%`, backgroundColor: chartColors[index % chartColors.length] }} />
              </>
            );
            return item.href ? (
              <Link className="dashboard-horizontal-row" href={item.href} key={item.label}>
                {content}
              </Link>
            ) : (
              <div className="dashboard-horizontal-row" key={item.label}>
                {content}
              </div>
            );
          })
        ) : (
          <p className="dashboard-empty">No data yet.</p>
        )}
      </div>
    </div>
  );
}

function DeviceOverviewCard({ stats }: { stats: DashboardDeviceStats | null }) {
  if (!stats) {
    return (
      <div className="panel dashboard-chart-card dashboard-wide-card">
        <div className="section-heading compact-heading">
          <div>
            <h2>Devices / RMM</h2>
            <p className="muted">Tactical RMM inventory visibility is unavailable for this user.</p>
          </div>
        </div>
        <p className="dashboard-empty">No device statistics available.</p>
      </div>
    );
  }

  const maxClient = Math.max(1, ...stats.byClient.map((item) => item.total));
  const maxOs = Math.max(1, ...stats.byOperatingSystem.map((item) => item.count));
  const deviceCards = [
    { title: "Total Devices", value: stats.summary.total, tone: "primary", icon: Monitor, note: "Managed assets", href: deviceHref({}) },
    { title: "Tactical Active", value: stats.summary.active, tone: "success", icon: CheckCircle2, note: "RMM active", href: deviceHref({ status: "ACTIVE" }) },
    { title: "Tactical Inactive", value: stats.summary.inactive, tone: "muted", icon: Clock3, note: "RMM inactive", href: deviceHref({ status: "INACTIVE" }) },
    { title: "Servers", value: stats.summary.servers, tone: "info", icon: Server, note: "Server assets", href: deviceHref({ deviceTab: "servers" }) },
    { title: "Workstations", value: stats.summary.workstations, tone: "neutral", icon: HardDrive, note: "Desktop/laptop", href: deviceHref({ deviceTab: "workstations" }) }
  ];

  return (
    <div className="panel dashboard-chart-card dashboard-wide-card dashboard-device-overview">
      <div className="section-heading compact-heading">
        <div>
          <h2>Devices / RMM</h2>
          <p className="muted">Tactical status, client distribution, device type, and operating system mix.</p>
        </div>
        <span className="count-pill">{stats.summary.total} total</span>
      </div>

      <section className="dashboard-device-kpi-grid" aria-label="Device summary">
        {deviceCards.map((card) => (
          <KpiCard key={card.title} {...card} />
        ))}
      </section>

      <div className="dashboard-device-breakdown-grid">
        <div className="dashboard-device-breakdown">
          <div className="dashboard-breakdown-heading">
            <h3>Devices by Client</h3>
            <span>Active / inactive</span>
          </div>
          <div className="dashboard-device-client-list">
            {stats.byClient.length ? (
              stats.byClient.map((client) => {
                const activeWidth = Math.max(0, (client.active / maxClient) * 100);
                const inactiveWidth = Math.max(0, (client.inactive / maxClient) * 100);
                return (
                  <Link className="dashboard-device-client-row" href={deviceHref({ clientId: client.clientId })} key={client.clientId}>
                    <span>
                      <strong>{client.name}</strong>
                      <small>{client.servers} servers - {client.workstations} workstations</small>
                    </span>
                    <span className="dashboard-device-client-counts">
                      <small>{client.active} active</small>
                      <small>{client.inactive} inactive</small>
                      <strong>{client.total}</strong>
                    </span>
                    <i className="dashboard-device-stack" aria-hidden="true">
                      <b className="active" style={{ width: `${activeWidth}%` }} />
                      <b className="inactive" style={{ width: `${inactiveWidth}%` }} />
                    </i>
                  </Link>
                );
              })
            ) : (
              <p className="dashboard-empty">No devices synced yet.</p>
            )}
          </div>
        </div>

        <div className="dashboard-device-breakdown">
          <div className="dashboard-breakdown-heading">
            <h3>Operating Systems</h3>
            <span>Top platforms</span>
          </div>
          <div className="dashboard-device-os-list">
            {stats.byOperatingSystem.length ? (
              stats.byOperatingSystem.map((item, index) => (
                <div className="dashboard-device-os-row" key={item.name}>
                  <span>
                    <Database size={14} aria-hidden="true" />
                    {item.name}
                  </span>
                  <strong>{item.count}</strong>
                  <i style={{ width: `${Math.max(8, (item.count / maxOs) * 100)}%`, backgroundColor: chartColors[index % chartColors.length] }} />
                </div>
              ))
            ) : (
              <p className="dashboard-empty">No operating system data yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DeviceSignalsCard({ stats }: { stats: DashboardDeviceStats | null }) {
  if (!stats) {
    return (
      <div className="panel dashboard-chart-card dashboard-wide-card">
        <div className="section-heading compact-heading">
          <div>
            <h2>Device Signals</h2>
            <p className="muted">RMM checks and device status signals are unavailable for this user.</p>
          </div>
        </div>
        <p className="dashboard-empty">No device signals available.</p>
      </div>
    );
  }

  const signals = stats.signals;

  return (
    <div className="panel dashboard-chart-card dashboard-wide-card dashboard-device-signals">
      <div className="section-heading compact-heading">
        <div>
          <h2>Device Signals</h2>
          <p className="muted">Tactical check status, warnings, and inactive device indicators.</p>
        </div>
        <div className="dashboard-signal-summary" aria-label="Device signal summary">
          <span className="error">{signals.errors} errors</span>
          <span className="warning">{signals.warnings} warnings</span>
          <span className="info">{signals.info} info</span>
        </div>
      </div>

      <div className="dashboard-device-signal-list">
        {signals.items.length ? (
          signals.items.map((item) => (
            <Link className={`dashboard-device-signal-row ${item.severity.toLowerCase()}`} href={`/devices/${item.deviceId}`} key={`${item.deviceId}:${item.message}`}>
              <span className="dashboard-signal-severity">{label(item.severity)}</span>
              <span>
                <strong>{item.hostname}</strong>
                <small>{item.clientName} - {item.status}</small>
              </span>
              <span>
                <strong>{item.message}</strong>
                <small>{item.checkedAt ? `Checked ${formatDate(item.checkedAt)}` : "No check timestamp"}</small>
              </span>
            </Link>
          ))
        ) : (
          <p className="dashboard-empty">No active RMM warnings or errors.</p>
        )}
      </div>
    </div>
  );
}

function SpecialistPerformanceCard({ items }: { items: NonNullable<DashboardStats["specialistPerformance"]> }) {
  const maxValue = Math.max(1, ...items.flatMap((item) => [item.assignedActive, item.closedLast30Days, item.awaitingTechnician]));
  const teamAverage = items[0]?.teamAverageActive ?? 0;

  return (
    <div className="panel dashboard-chart-card dashboard-wide-card">
      <div className="section-heading compact-heading">
        <div>
          <h2>Specialist Performance</h2>
          <p className="muted">Active workload, closed tickets, and internal wait by specialist.</p>
        </div>
        <span className="count-pill">Team avg {teamAverage}</span>
      </div>
      <div className="dashboard-performance-list">
        {items.length ? (
          items.map((item) => (
            <Link className="dashboard-performance-row" href={ticketHref({ assignedUserId: item.filter.assignedUserId, statuses: activeStatuses })} key={item.userId}>
              <span>
                <strong>{item.name}</strong>
                <small>{item.totalAssigned} total assigned - {item.averageDailyClosed} closed/day</small>
              </span>
              <div className="dashboard-performance-metrics">
                <span title={`${item.assignedActive} active`}>
                  <i className="assigned" style={{ width: `${Math.max(8, (item.assignedActive / maxValue) * 100)}%` }} />
                  Active <strong>{item.assignedActive}</strong>
                </span>
                <span title={`${item.closedLast30Days} closed in the last 30 days`}>
                  <i className="closed" style={{ width: `${Math.max(8, (item.closedLast30Days / maxValue) * 100)}%` }} />
                  Closed <strong>{item.closedLast30Days}</strong>
                </span>
                <span title={`${item.awaitingTechnician} awaiting technician`}>
                  <i className="awaiting" style={{ width: `${Math.max(8, (item.awaitingTechnician / maxValue) * 100)}%` }} />
                  Awaiting <strong>{item.awaitingTechnician}</strong>
                </span>
              </div>
            </Link>
          ))
        ) : (
          <p className="dashboard-empty">No specialist workload yet.</p>
        )}
      </div>
    </div>
  );
}

function InsightTable({ title, subtitle, tickets }: { title: string; subtitle: string; tickets: DashboardTicket[] }) {
  return (
    <div className="panel dashboard-insight-card">
      <div className="section-heading compact-heading">
        <div>
          <h2>{title}</h2>
          <p className="muted">{subtitle}</p>
        </div>
      </div>
      <div className="dashboard-insight-list">
        {tickets.length ? (
          tickets.map((ticket) => (
            <Link className="dashboard-insight-row" href={ticket.href} key={ticket.ticketNumber}>
              <span>
                <strong>{ticket.ticketNumber}</strong>
                <small>{ticket.subject}</small>
              </span>
              <span>
                <small>{ticket.clientName}</small>
                <small>Updated {formatDate(ticket.updatedAt)}</small>
              </span>
              <span className="status-pill" style={ticket.statusDefinition ? { color: ticket.statusDefinition.color, borderColor: `${ticket.statusDefinition.color}55`, backgroundColor: `${ticket.statusDefinition.color}18` } : undefined}>{ticket.statusDefinition?.name ?? label(ticket.status)}</span>
            </Link>
          ))
        ) : (
          <p className="dashboard-empty">No tickets in this group.</p>
        )}
      </div>
    </div>
  );
}

function DashboardWidgetShell({
  children,
  customizing,
  hidden,
  id,
  label: widgetLabel,
  wide,
  onDragStart,
  onDrop,
  onHide
}: {
  children: ReactNode;
  customizing: boolean;
  hidden: boolean;
  id: DashboardWidgetId;
  label: string;
  wide?: boolean;
  onDragStart: (id: DashboardWidgetId) => void;
  onDrop: (id: DashboardWidgetId) => void;
  onHide: (id: DashboardWidgetId) => void;
}) {
  if (hidden) {
    return null;
  }

  return (
    <div
      className={`dashboard-widget-shell ${wide ? "dashboard-widget-wide" : ""} ${customizing ? "customizing" : ""}`}
      draggable={customizing}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        onDragStart(id);
      }}
      onDragOver={(event) => {
        if (customizing) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(id);
      }}
    >
      {customizing ? (
        <div className="dashboard-widget-overlay">
          <span>
            <GripVertical size={14} /> {widgetLabel}
          </span>
          <button className="icon-button subtle" type="button" onClick={() => onHide(id)} title={`Hide ${widgetLabel}`} aria-label={`Hide ${widgetLabel}`}>
            <EyeOff size={14} />
          </button>
        </div>
      ) : null}
      {children}
    </div>
  );
}

function DashboardCustomizer({
  preference,
  saving,
  onMove,
  onToggle,
  onSave,
  onReset
}: {
  preference: DashboardPreference;
  saving: boolean;
  onMove: (sourceId: DashboardWidgetId, targetId: DashboardWidgetId) => void;
  onToggle: (id: DashboardWidgetId) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const [draggedId, setDraggedId] = useState<DashboardWidgetId | null>(null);
  const hidden = new Set(preference.hiddenWidgets);

  function handleDrop(event: DragEvent<HTMLDivElement>, targetId: DashboardWidgetId) {
    event.preventDefault();
    if (draggedId && draggedId !== targetId) {
      onMove(draggedId, targetId);
    }
    setDraggedId(null);
  }

  return (
    <div className="panel dashboard-customizer-panel">
      <div className="section-heading compact-heading">
        <div>
          <h2>Customize Dashboard</h2>
          <p className="muted">Drag widgets to change order, hide unused sections, and save this layout for your user.</p>
        </div>
        <div className="dashboard-customizer-actions">
          <button className="button secondary" type="button" onClick={onReset}>
            <RotateCcw size={16} /> Reset
          </button>
          <button className="button primary" type="button" onClick={onSave} disabled={saving}>
            <Save size={16} /> {saving ? "Saving..." : "Save layout"}
          </button>
        </div>
      </div>
      <div className="dashboard-customizer-list">
        {preference.layout.map((id) => {
          const definition = widgetDefinitionById.get(id as DashboardWidgetId);
          if (!definition) {
            return null;
          }
          return (
            <div
              className="dashboard-customizer-row"
              draggable
              key={definition.id}
              onDragStart={() => setDraggedId(definition.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => handleDrop(event, definition.id)}
            >
              <span>
                <GripVertical size={14} />
                {definition.label}
              </span>
              <label className="dashboard-visibility-toggle">
                <input type="checkbox" checked={!hidden.has(definition.id)} onChange={() => onToggle(definition.id)} />
                Visible
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DashboardWorkspace() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [deviceStats, setDeviceStats] = useState<DashboardDeviceStats | null>(null);
  const [eventRequests, setEventRequests] = useState<DashboardEventRequest[]>([]);
  const [preference, setPreference] = useState<DashboardPreference>(() => normalizeDashboardPreference());
  const [customizing, setCustomizing] = useState(false);
  const [draggedWidgetId, setDraggedWidgetId] = useState<DashboardWidgetId | null>(null);
  const [savingPreference, setSavingPreference] = useState(false);
  const [preferenceNotice, setPreferenceNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([
      apiFetch<DashboardStats>("/tickets/statistics"),
      apiFetch<DashboardEventRequest[]>("/event-services").catch(() => []),
      apiFetch<DashboardDeviceStats>("/dashboard/device-statistics").catch(() => null),
      apiFetch<DashboardPreference>("/dashboard/preferences").catch(() => normalizeDashboardPreference())
    ])
      .then(([data, events, devices, dashboardPreference]) => {
        if (mounted) {
          setStats(data);
          setEventRequests(events);
          setDeviceStats(devices);
          setPreference(normalizeDashboardPreference(dashboardPreference));
          setError("");
        }
      })
      .catch(() => {
        if (mounted) {
          setError("Unable to load dashboard statistics.");
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const eventSummaryCards = useMemo(() => {
    const total = eventRequests.length;
    const newRequests = eventRequests.filter((item) => item.status === "NEW").length;
    const active = eventRequests.filter((item) => activeEventStatuses.includes(item.status)).length;
    const completed = eventRequests.filter((item) => item.status === "COMPLETED").length;

    return [
      { title: "Event Requests", value: total, href: eventHref({}), tone: "primary", icon: ClipboardList, note: "All event intake" },
      { title: "New Events", value: newRequests, href: eventHref({ status: "NEW" }), tone: "info", icon: CalendarDays, note: "Needs review" },
      { title: "Active Events", value: active, href: eventHref({ status: "IN_PROGRESS" }), tone: "warning", icon: UsersRound, note: "Team workload" },
      { title: "Completed Events", value: completed, href: eventHref({ status: "COMPLETED" }), tone: "success", icon: CheckCircle2, note: "Finished requests" }
    ];
  }, [eventRequests]);

  const summaryCards = useMemo(() => {
    if (!stats) {
      return [];
    }

    return [
      { title: "Open Tickets", value: stats.summary.totalOpen, href: ticketHref({ statuses: activeStatuses }), tone: "primary", icon: Ticket, note: "Active workload" },
      { title: "New Tickets", value: stats.summary.newTickets, href: ticketHref({ statuses: ["NEW"] }), tone: "info", icon: Inbox, note: "Needs triage" },
      { title: "Closed Tickets", value: stats.summary.closedTickets, href: ticketHref({ statuses: ["CLOSED"] }), tone: "success", icon: CheckCircle2, note: "Completed" },
      { title: "Unassigned", value: stats.summary.unassignedTickets, href: ticketHref({ scope: "unassigned", statuses: activeStatuses }), tone: "warning", icon: UserX, note: "Needs owner" },
      { title: "High Priority", value: stats.summary.highPriorityTickets, href: ticketHref({ highPriority: "true", statuses: activeStatuses }), tone: "danger", icon: AlertTriangle, note: "High, urgent and critical" },
      { title: "Awaiting Customer", value: stats.summary.awaitingCustomer, href: ticketHref({ statuses: ["WAITING_ON_CUSTOMER"] }), tone: "neutral", icon: Clock3, note: "External wait" },
      { title: "Awaiting Technician", value: stats.summary.awaitingTechnician, href: ticketHref({ statuses: ["WAITING_ON_TECHNICIAN"] }), tone: "info", icon: Clock3, note: "Internal action" },
      { title: "No Recent Update", value: stats.summary.noRecentUpdate, href: ticketHref({ statuses: activeStatuses, updatedBefore: stats.staleBefore, sortBy: "updatedAt", sortDirection: "asc" }), tone: "muted", icon: Zap, note: "7+ days idle" }
    ];
  }, [stats]);

  function moveWidget(sourceId: DashboardWidgetId, targetId: DashboardWidgetId) {
    setPreference((current) => {
      const layout = [...current.layout];
      const sourceIndex = layout.indexOf(sourceId);
      const targetIndex = layout.indexOf(targetId);
      if (sourceIndex === -1 || targetIndex === -1) {
        return current;
      }
      layout.splice(sourceIndex, 1);
      layout.splice(targetIndex, 0, sourceId);
      return { ...current, layout };
    });
  }

  function toggleWidget(id: DashboardWidgetId) {
    setPreference((current) => {
      const hidden = new Set(current.hiddenWidgets);
      if (hidden.has(id)) {
        hidden.delete(id);
      } else {
        hidden.add(id);
      }
      return { ...current, hiddenWidgets: [...hidden] };
    });
  }

  async function saveDashboardPreference() {
    setSavingPreference(true);
    setPreferenceNotice("");
    try {
      const saved = await apiFetch<DashboardPreference>("/dashboard/preferences", {
        method: "PUT",
        body: JSON.stringify(preference)
      });
      setPreference(normalizeDashboardPreference(saved));
      setPreferenceNotice("Dashboard layout saved.");
    } catch (caught) {
      setPreferenceNotice(caught instanceof Error ? caught.message : "Unable to save dashboard layout.");
    } finally {
      setSavingPreference(false);
    }
  }

  function resetDashboardPreference() {
    setPreference(normalizeDashboardPreference());
    setPreferenceNotice("Default layout restored. Save to keep this layout.");
  }

  function handleWidgetDrop(targetId: DashboardWidgetId) {
    if (draggedWidgetId && draggedWidgetId !== targetId) {
      moveWidget(draggedWidgetId, targetId);
    }
    setDraggedWidgetId(null);
  }

  if (loading) {
    return <div className="panel dashboard-loading">Loading dashboard statistics...</div>;
  }

  if (error) {
    return <div className="error-banner">{error}</div>;
  }

  if (!stats) {
    return null;
  }

  const statusItems = stats.byStatus.map((item) => ({ label: item.label, count: item.count, href: ticketHref(item.filter) }));
  const priorityItems = stats.byPriority.map((item) => ({ label: label(item.priority), count: item.count, href: ticketHref({ priority: item.filter.priority }) }));
  const sourceItems = stats.bySource.map((item) => ({ label: label(item.source), count: item.count, href: ticketHref({ source: item.filter.source }) }));
  const clientItems = stats.byClient.map((item) => ({ label: item.name, count: item.count, href: item.clientId ? ticketHref({ clientId: item.clientId, statuses: activeStatuses }) : undefined }));
  const workloadItems = stats.workload.map((item) => ({ label: item.name, count: item.count, href: ticketHref({ assignedUserId: item.filter.assignedUserId, statuses: activeStatuses }) }));
  const agingItems = (stats.agingBuckets ?? []).map((item) => ({ label: item.label, count: item.count }));
  const staleSpecialistItems = (stats.staleBySpecialist ?? []).map((item) => ({
    label: item.name,
    count: item.count,
    href: ticketHref(item.filter)
  }));
  const specialistPerformance = stats.specialistPerformance ?? [];
  const specialistTrend = stats.specialistTrend ?? [];
  const hiddenWidgets = new Set(preference.hiddenWidgets);

  const renderWidget = (id: DashboardWidgetId) => {
    switch (id) {
      case "ticketKpis":
        return (
          <>
            <div className="dashboard-section-heading">
              <h2>Tickets</h2><small className="muted">Calendar charts: {stats.timeZone ?? "UTC"}</small>
            </div>
            <section className="dashboard-kpi-grid dashboard-ticket-kpi-grid">
              {summaryCards.map((card) => (
                <KpiCard key={card.title} {...card} />
              ))}
            </section>
          </>
        );
      case "eventKpis":
        return (
          <>
            <div className="dashboard-section-heading">
              <h2>Event & Services</h2>
            </div>
            <section className="dashboard-kpi-grid dashboard-event-kpi-grid">
              {eventSummaryCards.map((card) => (
                <KpiCard key={card.title} {...card} />
              ))}
            </section>
          </>
        );
      case "deviceOverview":
        return <DeviceOverviewCard stats={deviceStats} />;
      case "deviceSignals":
        return <DeviceSignalsCard stats={deviceStats} />;
      case "ticketActivity":
        return <ActivityChart items={stats.activityByDay} />;
      case "ticketsByStatus":
        return <DonutChart title="Tickets by Status" subtitle="Click a segment label to filter tickets." items={statusItems} />;
      case "ticketsByPriority":
        return <DonutChart title="Tickets by Priority" subtitle="Workload distribution by urgency." items={priorityItems} />;
      case "specialistTrend":
        return <SpecialistTrendChart items={specialistTrend} />;
      case "createdByHour":
        return <HourChart items={stats.createdByHour} />;
      case "technicianWorkload":
        return <HorizontalBarList title="Technician Workload" subtitle="Active tickets by assigned technician." items={workloadItems} />;
      case "ticketAging":
        return <HorizontalBarList title="Ticket Aging" subtitle="Active tickets grouped by time open." items={agingItems} />;
      case "staleBySpecialist":
        return <HorizontalBarList title="Stale by Specialist" subtitle="Assigned tickets idle for more than 7 days." items={staleSpecialistItems} />;
      case "specialistPerformance":
        return <SpecialistPerformanceCard items={specialistPerformance} />;
      case "ticketsByClient":
        return <HorizontalBarList title="Tickets by Client" subtitle="Top client workload across all active tickets." items={clientItems} />;
      case "ticketsBySource":
        return <DonutChart title="Tickets by Source" subtitle="Where tickets are entering the helpdesk." items={sourceItems} />;
      case "criticalTickets":
        return <InsightTable title="Critical and High Priority" subtitle="Open tickets that need fast attention." tickets={stats.insightTickets.critical} />;
      case "unassignedTickets":
        return <InsightTable title="Unassigned Tickets" subtitle="Tickets waiting for ownership." tickets={stats.insightTickets.unassigned} />;
      case "staleTickets":
        return <InsightTable title="No Recent Update" subtitle="Active tickets idle for more than 7 days." tickets={stats.insightTickets.stale} />;
      default:
        return null;
    }
  };

  const renderShell = (id: DashboardWidgetId) => {
    const definition = widgetDefinitionById.get(id);
    if (!definition) {
      return null;
    }

    return (
      <DashboardWidgetShell
        customizing={customizing}
        hidden={hiddenWidgets.has(id)}
        id={id}
        key={id}
        label={definition.label}
        onDragStart={setDraggedWidgetId}
        onDrop={handleWidgetDrop}
        onHide={toggleWidget}
        wide={definition.wide}
      >
        {renderWidget(id)}
      </DashboardWidgetShell>
    );
  };
  const summaryWidgets = preference.layout.filter((id): id is DashboardWidgetId => widgetDefinitionById.get(id as DashboardWidgetId)?.group === "summary");
  const analyticsWidgets = preference.layout.filter((id): id is DashboardWidgetId => widgetDefinitionById.get(id as DashboardWidgetId)?.group === "analytics");
  const insightWidgets = preference.layout.filter((id): id is DashboardWidgetId => widgetDefinitionById.get(id as DashboardWidgetId)?.group === "insight");

  return (
    <div className="dashboard-page">
      <div className="dashboard-toolbar">
        <button className={`button ${customizing ? "primary" : "secondary"}`} type="button" onClick={() => setCustomizing((current) => !current)}>
          <Settings2 size={16} /> {customizing ? "Done" : "Customize"}
        </button>
      </div>
      {preferenceNotice ? <div className={preferenceNotice.includes("Unable") ? "error-banner" : "success-banner"}>{preferenceNotice}</div> : null}
      {customizing ? (
        <DashboardCustomizer
          preference={preference}
          saving={savingPreference}
          onMove={moveWidget}
          onToggle={toggleWidget}
          onSave={() => void saveDashboardPreference()}
          onReset={resetDashboardPreference}
        />
      ) : null}

      {summaryWidgets.map(renderShell)}

      <section className="dashboard-main-grid">{analyticsWidgets.map(renderShell)}</section>

      <section className="dashboard-insight-grid">{insightWidgets.map(renderShell)}</section>
    </div>
  );
}
