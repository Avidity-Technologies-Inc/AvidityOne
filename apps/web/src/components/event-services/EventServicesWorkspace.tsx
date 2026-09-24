"use client";

import { CalendarDays, CalendarPlus, CheckCircle2, ChevronDown, ClipboardList, ExternalLink, MessageSquare, Plus, RefreshCw, RotateCcw, Save, Send, Trash2, UserPlus, UsersRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { AttachmentPreviewList } from "../tickets/AttachmentPreviewList";
import { EventMessageComposer } from "./EventMessageComposer";

type EventStatus = "NEW" | "UNDER_REVIEW" | "SCHEDULED" | "ASSIGNED" | "IN_PROGRESS" | "WAITING_ON_CLIENT" | "WAITING_ON_INTERNAL_TEAM" | "COMPLETED" | "CANCELLED" | "CONVERTED_TO_TICKET";
type TaskStatus = "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELLED";
type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT" | "CRITICAL";

interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface EventServiceCatalogItem {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  isActive: boolean;
  defaultUserIds: string[];
}

interface ExternalSpecialist {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  notes: string | null;
  isActive: boolean;
}

interface EventServiceRequest {
  id: string;
  trackingNumber: string;
  eventName: string;
  organizer: string | null;
  venue: string | null;
  eventDate: string | null;
  startTime: string | null;
  endTime: string | null;
  requesterFirstName: string;
  requesterLastName: string;
  requesterEmail: string;
  requesterPhone: string | null;
  status: EventStatus;
  priority: Priority;
  additionalInfo: string | null;
  formData: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  client: { id: string; name: string; shortName: string | null } | null;
  services: Array<{ service: EventServiceCatalogItem }>;
  assignees: Array<{ user: UserOption; role: string | null }>;
  externalSpecialists: Array<{ id: string; role: string | null; externalSpecialist: ExternalSpecialist }>;
  tasks: Array<{ id: string; title: string; description: string | null; status: TaskStatus; dueAt: string | null; calendarEventId: string | null; calendarUserEmail: string | null; calendarSyncedAt: string | null; calendarSyncError: string | null; assignedUser: UserOption | null; externalSpecialist: ExternalSpecialist | null }>;
  comments?: Array<{ id: string; body: string; createdAt: string; user: UserOption | null }>;
  messages?: Array<{
    id: string;
    bodyText: string;
    bodyHtml: string | null;
    sanitizedBodyHtml: string | null;
    direction: "INBOUND" | "OUTBOUND" | "INTERNAL";
    visibility: "PUBLIC" | "INTERNAL";
    createdAt: string;
    senderEmail: string | null;
    authorUser: UserOption | null;
    attachments: Array<{ id: string; originalFilename: string; mimeType: string; fileSize: number; isInline?: boolean }>;
  }>;
  activity?: Array<{ id: string; action: string; metadata: Record<string, unknown> | null; createdAt: string; user: UserOption | null }>;
}

interface EventServiceTaskAssignment {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  dueAt: string | null;
  updatedAt: string;
  calendarEventId: string | null;
  calendarUserEmail: string | null;
  calendarSyncedAt: string | null;
  calendarSyncError: string | null;
  assignedUser: UserOption | null;
  request: EventServiceRequest;
}

interface EventServicesWorkspaceProps {
  detailTrackingNumber?: string;
}

const statuses: EventStatus[] = ["NEW", "UNDER_REVIEW", "SCHEDULED", "ASSIGNED", "IN_PROGRESS", "WAITING_ON_CLIENT", "WAITING_ON_INTERNAL_TEAM", "COMPLETED", "CANCELLED", "CONVERTED_TO_TICKET"];
const taskStatuses: TaskStatus[] = ["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"];
const priorities: Priority[] = ["LOW", "NORMAL", "HIGH", "URGENT", "CRITICAL"];
const simplifiedStatusOptions: Array<{ status: EventStatus; label: string; description: string }> = [
  { status: "UNDER_REVIEW", label: "Review", description: "Acknowledge that Avidity will review and coordinate the request." },
  { status: "SCHEDULED", label: "Schedule", description: "Mark the event as scheduled on the operations calendar." },
  { status: "IN_PROGRESS", label: "Start", description: "Move active work into progress." },
  { status: "WAITING_ON_CLIENT", label: "Waiting", description: "Pause while waiting for requester details or approval." },
  { status: "COMPLETED", label: "Complete", description: "Close the operational work as completed." }
];

const eventStatusLabels: Record<EventStatus, string> = {
  NEW: "New",
  UNDER_REVIEW: "Under Review",
  SCHEDULED: "Scheduled",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In Progress",
  WAITING_ON_CLIENT: "Waiting on Requester",
  WAITING_ON_INTERNAL_TEAM: "Waiting on Team",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  CONVERTED_TO_TICKET: "Converted to Ticket"
};

function label(value: string) {
  if (value === "TODO") return "To Do";
  return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function eventStatusLabel(value: EventStatus) {
  return eventStatusLabels[value] ?? label(value);
}

function statusClass(value: string) {
  return `event-status-${value.toLowerCase().replace(/_/g, "-")}`;
}

function priorityClass(value: string) {
  return `event-priority-${value.toLowerCase().replace(/_/g, "-")}`;
}

function userName(user: UserOption | null) {
  return user ? `${user.firstName} ${user.lastName}`.trim() || user.email : "Unassigned";
}

function externalName(specialist: ExternalSpecialist | null) {
  return specialist ? `${specialist.name}${specialist.company ? ` (${specialist.company})` : ""}` : "Unassigned";
}

function taskAssigneeValue(task: EventServiceRequest["tasks"][number]) {
  if (task.assignedUser) return `user:${task.assignedUser.id}`;
  if (task.externalSpecialist) return `external:${task.externalSpecialist.id}`;
  return "";
}

function taskAssigneeLabel(task: EventServiceRequest["tasks"][number]) {
  if (task.assignedUser) return userName(task.assignedUser);
  if (task.externalSpecialist) return externalName(task.externalSpecialist);
  return "Unassigned";
}

function taskAssigneePatch(value: string) {
  if (value.startsWith("user:")) return { assignedUserId: value.slice(5), externalSpecialistId: null };
  if (value.startsWith("external:")) return { assignedUserId: null, externalSpecialistId: value.slice(9) };
  return { assignedUserId: null, externalSpecialistId: null };
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : "No date";
}

function formatDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString(undefined, { month: "short", day: "2-digit", hour: "numeric", minute: "2-digit" }) : "No date";
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function textToHtml(value: string) {
  return escapeHtml(value).replace(/\n/g, "<br />");
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 102.4) / 10} KB`;
  }
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
}

function formatCustomFieldValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(", ");
  }
  if (value === null || value === undefined || value === "") {
    return "Not provided";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function activityTitle(action: string) {
  const labels: Record<string, string> = {
    "event_service_task.external_invite_sent": "External invite sent",
    "event_service_task.calendar_synced": "Calendar synced",
    "event_service_task.created": "Task created",
    "event_service_task.updated": "Task updated",
    "event_service_external_specialist.assigned": "External specialist assigned",
    "event_service_external_specialist.removed": "External specialist removed",
    "event_service_message.sent": "Message sent",
    "event_service_comment.created": "Internal comment added",
    "event_service_request.updated": "Request updated",
    "event_service_request.created_internal": "Request created",
    "event_service_request.created_public": "Portal request received",
    "event_service_request.auto_reply_sent": "Auto reply sent"
  };
  return labels[action] ?? label(action.replace(/^event_service_/, ""));
}

function activityDetail(activity: NonNullable<EventServiceRequest["activity"]>[number]) {
  const metadata = activity.metadata ?? {};
  if (activity.action === "event_service_task.external_invite_sent") {
    return `${String(metadata.taskTitle ?? "Task")} sent to ${String(metadata.externalSpecialistEmail ?? metadata.calendarUserEmail ?? "external specialist")}.`;
  }
  if (activity.action === "event_service_task.calendar_synced") {
    return `Calendar notification for ${String(metadata.calendarUserEmail ?? "specialist")}.`;
  }
  if (activity.action === "event_service_task.created" || activity.action === "event_service_task.updated") {
    return String(metadata.title ?? metadata.status ?? "Task workflow changed.");
  }
  return activity.user ? `By ${userName(activity.user)}` : "System activity";
}

export function EventServicesWorkspace({ detailTrackingNumber }: EventServicesWorkspaceProps = {}) {
  const detailPage = Boolean(detailTrackingNumber);
  const [activeTab, setActiveTab] = useState<"requests" | "myTasks">("requests");
  const [requests, setRequests] = useState<EventServiceRequest[]>([]);
  const [showTaskHistory, setShowTaskHistory] = useState(false);
  const [myTasks, setMyTasks] = useState<EventServiceTaskAssignment[]>([]);
  const [myTaskDrafts, setMyTaskDrafts] = useState<Record<string, { status: TaskStatus; comment: string }>>({});
  const [selectedId, setSelectedId] = useState<string | null>(detailTrackingNumber ?? null);
  const [selected, setSelected] = useState<EventServiceRequest | null>(null);
  const [detailOpen, setDetailOpen] = useState(detailPage);
  const [selectedRequestIds, setSelectedRequestIds] = useState<string[]>([]);
  const [recycleBinOpen, setRecycleBinOpen] = useState(false);
  const [recycledRequests, setRecycledRequests] = useState<EventServiceRequest[]>([]);
  const [services, setServices] = useState<EventServiceCatalogItem[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [externalSpecialists, setExternalSpecialists] = useState<ExternalSpecialist[]>([]);
  const [filters, setFilters] = useState({ search: "", status: "", assignedUserId: "", externalSpecialistId: "", serviceId: "" });
  const [draft, setDraft] = useState({ status: "NEW" as EventStatus, priority: "NORMAL" as Priority, assignedUserIds: [] as string[], additionalInfo: "" });
  const [taskDraft, setTaskDraft] = useState({ title: "", assignee: "", description: "", dueAt: "" });
  const [externalDraft, setExternalDraft] = useState({ name: "", email: "", phone: "", company: "" });
  const [externalAssignmentId, setExternalAssignmentId] = useState("");
  const [externalCreateOpen, setExternalCreateOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [calendarDrafts, setCalendarDrafts] = useState<Record<string, { startDate: string; startTime: string; endDate: string; endTime: string; location: string; notes: string }>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activeMyTasks = myTasks.filter(task => !["DONE", "CANCELLED"].includes(task.status) && !["COMPLETED", "CANCELLED", "CONVERTED_TO_TICKET"].includes(task.request.status));
  const visibleMyTasks = showTaskHistory ? myTasks : activeMyTasks;

  const summary = useMemo(() => ({
    total: requests.length,
    newRequests: requests.filter((item) => item.status === "NEW").length,
    assigned: requests.filter((item) => item.assignees.length > 0 || item.externalSpecialists.length > 0 || item.tasks.some((task) => task.assignedUser || task.externalSpecialist)).length,
    completed: requests.filter((item) => item.status === "COMPLETED").length
  }), [requests]);

  async function loadData(nextFilters = filters) {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    try {
      const [requestData, myTaskData, serviceData, userData] = await Promise.all([
        apiFetch<EventServiceRequest[]>(`/event-services?${params.toString()}`),
        apiFetch<EventServiceTaskAssignment[]>("/event-services/my-tasks"),
        apiFetch<EventServiceCatalogItem[]>("/event-services/services"),
        apiFetch<UserOption[]>("/users")
      ]);
      setRequests(requestData);
      setMyTasks(myTaskData);
      setMyTaskDrafts((current) => {
        const next: Record<string, { status: TaskStatus; comment: string }> = {};
        myTaskData.forEach((task) => {
          next[task.id] = current[task.id] ?? { status: task.status, comment: "" };
        });
        return next;
      });
      setServices(serviceData);
      setUsers(userData);
      apiFetch<ExternalSpecialist[]>("/external-specialists")
        .then(setExternalSpecialists)
        .catch(() => setExternalSpecialists([]));
      setSelectedRequestIds((current) => current.filter((id) => requestData.some((request) => request.id === id)));
      if (selectedId && !detailOpen && !requestData.some((request) => request.id === selectedId)) {
        setSelectedId(null);
        setSelected(null);
        setDetailOpen(false);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load Event & Services.");
    } finally {
      setLoading(false);
    }
  }

  async function loadSelected(id: string | null) {
    if (!id) {
      setSelected(null);
      return;
    }
    try {
      const item = await apiFetch<EventServiceRequest>(`/event-services/${id}`);
      setSelected(item);
      setSelectedId(item.id);
      setDraft({
        status: item.status,
        priority: item.priority,
        assignedUserIds: item.assignees.map((assignee) => assignee.user.id),
        additionalInfo: item.additionalInfo ?? ""
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load request detail.");
    }
  }

  useEffect(() => {
    const urlFilters = { ...filters };
    if (detailTrackingNumber) {
      setSelectedId(detailTrackingNumber);
      setDetailOpen(true);
    } else if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      urlFilters.status = params.get("status") ?? "";
      const legacyRequestRef = params.get("request");
      if (legacyRequestRef) {
        void apiFetch<EventServiceRequest>(`/event-services/${legacyRequestRef}`)
          .then((item) => {
            window.location.replace(`/event-services/${encodeURIComponent(item.trackingNumber)}`);
          })
          .catch((caught) => {
            setError(caught instanceof Error ? caught.message : "Unable to load request detail.");
          });
      }
      setFilters(urlFilters);
    }
    void loadData(urlFilters);
  }, []);

  useEffect(() => {
    if (detailOpen) {
      void loadSelected(selectedId);
    }
  }, [selectedId, detailOpen]);

  function openRequest(request: EventServiceRequest) {
    setActiveTab("requests");
    if (typeof window !== "undefined") {
      window.location.href = `/event-services/${encodeURIComponent(request.trackingNumber)}`;
    }
  }

  function closeRequest() {
    if (typeof window !== "undefined") {
      window.location.href = "/event-services";
      return;
    }
    setDetailOpen(false);
    setSelected(null);
  }

  function toggleRequestSelection(requestId: string, checked: boolean) {
    setSelectedRequestIds((current) => checked ? [...new Set([...current, requestId])] : current.filter((id) => id !== requestId));
  }

  function toggleAllRequests(checked: boolean) {
    setSelectedRequestIds(checked ? requests.map((request) => request.id) : []);
  }

  function updateRequestInState(updated: EventServiceRequest) {
    setRequests((current) => current.map((request) => request.id === updated.id ? updated : request));
    setSelected((current) => current?.id === updated.id ? updated : current);
  }

  async function quickUpdateRequest(request: EventServiceRequest, patch: Partial<Pick<EventServiceRequest, "status" | "priority">>) {
    setBusy(`quick-${request.id}`);
    setError(null);
    try {
      const updated = await apiFetch<EventServiceRequest>(`/event-services/${request.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
      });
      updateRequestInState(updated);
      setNotice(`${request.trackingNumber} updated.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update event request.");
    } finally {
      setBusy(null);
    }
  }

  async function moveSelectedToRecycleBin() {
    if (!selectedRequestIds.length) return;
    const confirmed = window.confirm(`Move ${selectedRequestIds.length} event request${selectedRequestIds.length === 1 ? "" : "s"} to the Event & Services recycle bin?`);
    if (!confirmed) return;
    setBusy("delete");
    setError(null);
    try {
      await apiFetch("/event-services/recycle-bin", {
        method: "POST",
        body: JSON.stringify({ requestIds: selectedRequestIds })
      });
      if (selectedId && selectedRequestIds.includes(selectedId)) {
        closeRequest();
        setSelectedId(null);
      }
      setSelectedRequestIds([]);
      setNotice("Event request moved to recycle bin.");
      await loadData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to move event request to recycle bin.");
    } finally {
      setBusy(null);
    }
  }

  async function loadRecycleBin() {
    setBusy("recycle-bin");
    setError(null);
    try {
      const data = await apiFetch<EventServiceRequest[]>("/event-services/recycle-bin");
      setRecycledRequests(data);
      setRecycleBinOpen(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load event recycle bin.");
    } finally {
      setBusy(null);
    }
  }

  async function restoreRequest(requestId: string) {
    setBusy(`restore-${requestId}`);
    setError(null);
    try {
      await apiFetch("/event-services/recycle-bin/restore", {
        method: "POST",
        body: JSON.stringify({ requestIds: [requestId] })
      });
      setNotice("Event request restored.");
      await Promise.all([loadData(), loadRecycleBin()]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to restore event request.");
    } finally {
      setBusy(null);
    }
  }

  async function saveRequest() {
    if (!selected) return;
    setBusy("request");
    setError(null);
    try {
      const updated = await apiFetch<EventServiceRequest>(`/event-services/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify(draft)
      });
      setSelected(updated);
      setNotice("Event request saved.");
      await loadData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save event request.");
    } finally {
      setBusy(null);
    }
  }

  async function quickSetSelectedStatus(status: EventStatus) {
    if (!selected) return;
    setBusy(`status-${status}`);
    setError(null);
    try {
      const updated = await apiFetch<EventServiceRequest>(`/event-services/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      setSelected(updated);
      setDraft((current) => ({ ...current, status: updated.status }));
      setNotice(`${updated.trackingNumber} marked ${eventStatusLabel(updated.status).toLowerCase()}.`);
      await loadData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update event status.");
    } finally {
      setBusy(null);
    }
  }

  async function createTask() {
    if (!selected || !taskDraft.title.trim()) return;
    setBusy("task");
    try {
      await apiFetch(`/event-services/${selected.id}/tasks`, {
        method: "POST",
        body: JSON.stringify({ title: taskDraft.title, description: taskDraft.description, dueAt: taskDraft.dueAt || null, ...taskAssigneePatch(taskDraft.assignee) })
      });
      setTaskDraft({ title: "", assignee: "", description: "", dueAt: "" });
      await loadSelected(selected.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create task.");
    } finally {
      setBusy(null);
    }
  }

  async function updateTask(taskId: string, patch: Partial<{ status: TaskStatus; assignedUserId: string | null; externalSpecialistId: string | null; dueAt: string | null }>) {
    if (!selected) return;
    await apiFetch(`/event-services/${selected.id}/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
    await loadSelected(selected.id);
    await loadData();
  }

  async function createExternalSpecialist() {
    if (!externalDraft.name.trim() || !externalDraft.email.trim()) return;
    setBusy("external-create");
    setError(null);
    try {
      const specialist = await apiFetch<ExternalSpecialist>("/external-specialists", {
        method: "POST",
        body: JSON.stringify(externalDraft)
      });
      setExternalSpecialists((current) => [specialist, ...current.filter((item) => item.id !== specialist.id)]);
      setExternalDraft({ name: "", email: "", phone: "", company: "" });
      setExternalAssignmentId(specialist.id);
      setExternalCreateOpen(false);
      setNotice("External specialist added.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to add external specialist.");
    } finally {
      setBusy(null);
    }
  }

  async function addExternalToEvent() {
    if (!selected || !externalAssignmentId) return;
    setBusy("external-assign");
    setError(null);
    try {
      await apiFetch(`/event-services/${selected.id}/external-specialists`, {
        method: "POST",
        body: JSON.stringify({ externalSpecialistId: externalAssignmentId })
      });
      setExternalAssignmentId("");
      await loadSelected(selected.id);
      setNotice("External specialist assigned to event.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to assign external specialist.");
    } finally {
      setBusy(null);
    }
  }

  async function removeExternalFromEvent(assignmentId: string) {
    if (!selected) return;
    setBusy(`external-remove-${assignmentId}`);
    setError(null);
    try {
      await apiFetch(`/event-services/${selected.id}/external-specialists/${assignmentId}`, { method: "DELETE" });
      await loadSelected(selected.id);
      setNotice("External specialist removed.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to remove external specialist.");
    } finally {
      setBusy(null);
    }
  }

  async function sendExternalTaskInvite(taskId: string) {
    if (!selected) return;
    const calendarDraft = calendarDrafts[taskId] ?? { location: selected.venue ?? "", notes: "" };
    setBusy(`external-invite-${taskId}`);
    setError(null);
    try {
      await apiFetch(`/event-services/${selected.id}/tasks/${taskId}/external-invite`, {
        method: "POST",
        body: JSON.stringify({ location: calendarDraft.location, message: calendarDraft.notes })
      });
      await loadSelected(selected.id);
      setNotice("External calendar invite sent.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send external calendar invite.");
    } finally {
      setBusy(null);
    }
  }

  function updateMyTaskDraft(taskId: string, patch: Partial<{ status: TaskStatus; comment: string }>) {
    setMyTaskDrafts((current) => ({
      ...current,
      [taskId]: {
        ...(current[taskId] ?? { status: "TODO" as TaskStatus, comment: "" }),
        ...patch
      }
    }));
  }

  async function saveMyTask(taskId: string) {
    const draft = myTaskDrafts[taskId];
    if (!draft) return;
    setBusy(`my-task-${taskId}`);
    setError(null);
    try {
      await apiFetch(`/event-services/my-tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: draft.status,
          comment: draft.comment.trim() || undefined
        })
      });
      setNotice("Task status saved.");
      await loadData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save task status.");
    } finally {
      setBusy(null);
    }
  }

  async function addComment() {
    if (!selected || !commentDraft.trim()) return;
    setBusy("comment");
    try {
      await apiFetch(`/event-services/${selected.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: commentDraft })
      });
      setCommentDraft("");
      await loadSelected(selected.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to add comment.");
    } finally {
      setBusy(null);
    }
  }

  function updateCalendarDraft(taskId: string, patch: Partial<{ startDate: string; startTime: string; endDate: string; endTime: string; location: string; notes: string }>) {
    setCalendarDrafts((current) => ({
      ...current,
      [taskId]: {
        ...(current[taskId] ?? { startDate: selected?.eventDate?.slice(0, 10) ?? "", startTime: selected?.startTime ?? "", endDate: selected?.eventDate?.slice(0, 10) ?? "", endTime: selected?.endTime ?? "", location: selected?.venue ?? "", notes: "" }),
        ...patch
      }
    }));
  }

  async function syncTaskCalendar(taskId: string) {
    if (!selected) return;
    setBusy(`calendar-${taskId}`);
    setError(null);
    try {
      await apiFetch(`/event-services/${selected.id}/tasks/${taskId}/calendar`, {
        method: "POST",
        body: JSON.stringify(calendarDrafts[taskId] ?? {})
      });
      setNotice("Task added to Microsoft Calendar.");
      await loadSelected(selected.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sync task to Microsoft Calendar.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={detailPage ? "event-services-page event-detail-page" : "event-services-page"}>
      <div className="compact-page-header event-page-header">
        <div className="event-page-title-block">
          <span className="event-page-eyebrow">Service Operations</span>
          <h1>{detailPage ? selected?.trackingNumber ?? detailTrackingNumber : "Event & Services"}</h1>
          <p className="muted">{detailPage ? selected?.eventName ?? "Event request detail" : "Coordinate requests, specialists, tasks, calendar work, and requester updates."}</p>
        </div>
        <div className="button-row event-header-actions">
          {detailPage ? (
            <button className="button secondary" type="button" onClick={closeRequest}>
              <span>Back to Requests</span>
            </button>
          ) : (
            <>
              <button className="button secondary" type="button" onClick={() => window.open("https://events.aviditytechnologies.com/", "_blank", "noopener,noreferrer")}>
                <ExternalLink size={16} aria-hidden="true" />
                <span>Customer Portal</span>
              </button>
              <button className="button secondary" type="button" onClick={() => { window.location.href = "/event-services/calendar"; }}>
                <CalendarDays size={16} aria-hidden="true" />
                <span>Calendar View</span>
              </button>
              <button className="button secondary" type="button" onClick={() => void loadRecycleBin()} disabled={busy === "recycle-bin"}>
                <Trash2 size={16} aria-hidden="true" />
                <span>Recycle Bin</span>
              </button>
            </>
          )}
          <button className="button secondary" type="button" onClick={() => detailPage ? void loadSelected(selectedId) : void loadData()} disabled={loading}>
            <RefreshCw size={16} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      </div>
      {error ? <div className="alert error">{error}</div> : null}
      {notice ? <div className="alert success">{notice}</div> : null}

      <section className="dashboard-kpi-grid event-kpi-grid event-compact-kpi-grid">
        <div className="dashboard-kpi-card event-kpi-card"><ClipboardList size={18} /><span>Total Requests</span><strong>{summary.total}</strong><small>Current filtered view</small></div>
        <div className="dashboard-kpi-card event-kpi-card"><CalendarDays size={18} /><span>New</span><strong>{summary.newRequests}</strong><small>Needs review</small></div>
        <div className="dashboard-kpi-card event-kpi-card"><UsersRound size={18} /><span>Assigned requests</span><strong>{summary.assigned}</strong><small>Includes task assignments</small></div>
        <div className="dashboard-kpi-card event-kpi-card"><CheckCircle2 size={18} /><span>Completed</span><strong>{summary.completed}</strong><small>Finished events</small></div>
      </section>

      <div className="event-workspace-tabs" role="tablist" aria-label="Event & Services views">
        <button className={activeTab === "requests" ? "active" : ""} type="button" onClick={() => setActiveTab("requests")}>
          Requests
        </button>
        <button className={activeTab === "myTasks" ? "active" : ""} type="button" onClick={() => setActiveTab("myTasks")}>
          My Tasks
          <span>{activeMyTasks.length}</span>
        </button>
      </div>

      {activeTab === "requests" ? (
      <>
      <section className="panel event-filter-panel">
        <label className="event-filter-field"><span>Search</span><input className="input" placeholder="Search tracking, event, requester, venue..." value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} /></label>
        <label className="event-filter-field"><span>Status</span><select className="input" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
          <option value="">All statuses</option>
          {statuses.map((status) => <option key={status} value={status}>{eventStatusLabel(status)}</option>)}
        </select></label>
        <label className="event-filter-field"><span>Service</span><select className="input" value={filters.serviceId} onChange={(event) => setFilters((current) => ({ ...current, serviceId: event.target.value }))}>
          <option value="">All services</option>
          {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
        </select></label>
        <label className="event-filter-field"><span>Specialist</span><select className="input" value={filters.assignedUserId} onChange={(event) => setFilters((current) => ({ ...current, assignedUserId: event.target.value }))}>
          <option value="">All technicians</option>
          {users.map((user) => <option key={user.id} value={user.id}>{userName(user)}</option>)}
        </select></label>
        <label className="event-filter-field"><span>External</span><select className="input" value={filters.externalSpecialistId} onChange={(event) => setFilters((current) => ({ ...current, externalSpecialistId: event.target.value }))}>
          <option value="">All external specialists</option>
          {externalSpecialists.filter((specialist) => specialist.isActive).map((specialist) => <option key={specialist.id} value={specialist.id}>{externalName(specialist)}</option>)}
        </select></label>
        <button className="button" type="button" onClick={() => void loadData(filters)}>Apply Filters</button>
      </section>

      <div className="event-services-layout">
        <section className="panel event-request-table-panel">
          <div className="section-heading compact-heading">
            <div>
              <h2>Requests</h2>
              <p className="muted">{requests.length} event request{requests.length === 1 ? "" : "s"} in this view.</p>
            </div>
            <div className="button-row">
              <button className="button danger" type="button" onClick={() => void moveSelectedToRecycleBin()} disabled={!selectedRequestIds.length || busy === "delete"}>
                <Trash2 size={16} aria-hidden="true" />
                <span>Delete Selected</span>
              </button>
            </div>
          </div>
          <div className="table-scroll event-table-scroll">
            <table className="tickets-table event-request-table">
              <thead>
                <tr>
                  <th>
                    <input
                      aria-label="Select all event requests"
                      type="checkbox"
                      checked={requests.length > 0 && selectedRequestIds.length === requests.length}
                      onChange={(event) => toggleAllRequests(event.target.checked)}
                    />
                  </th>
                  <th>Tracking</th>
                  <th>Event</th>
                  <th>Requester</th>
                  <th>Date / Time</th>
                  <th>Services</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Specialists</th>
                  <th>Updated</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {requests.length === 0 ? (
                  <tr>
                    <td colSpan={11}>
                      <span className="muted">{loading ? "Loading requests..." : "No event requests match the filters."}</span>
                    </td>
                  </tr>
                ) : null}
                {requests.map((request) => (
                  <tr className={selectedId === request.id && detailOpen ? "selected-row" : ""} key={request.id} onClick={() => openRequest(request)}>
                    <td className="event-request-select-cell">
                      <input
                        aria-label={`Select ${request.trackingNumber}`}
                        type="checkbox"
                        checked={selectedRequestIds.includes(request.id)}
                        onChange={(event) => { event.stopPropagation(); toggleRequestSelection(request.id, event.target.checked); }}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </td>
                    <td className="event-request-tracking-cell"><strong className="event-tracking-number">{request.trackingNumber}</strong></td>
                    <td className="event-request-info-cell">
                      <strong className="event-request-title" title={request.eventName}>{request.eventName}</strong>
                      <span className="event-request-muted" title={request.venue ?? "No venue"}>{request.venue ?? "No venue"}</span>
                    </td>
                    <td className="event-request-info-cell">
                      <strong className="event-request-title" title={`${request.requesterFirstName} ${request.requesterLastName}`}>{request.requesterFirstName} {request.requesterLastName}</strong>
                      <span className="event-request-muted event-request-email" title={request.requesterEmail}>{request.requesterEmail}</span>
                    </td>
                    <td className="event-request-date-cell">
                      <strong>{formatDate(request.eventDate)}</strong>
                      <span className="event-request-muted">{request.startTime ?? "--"} - {request.endTime ?? "--"}</span>
                    </td>
                    <td className="event-request-services-cell" title={request.services.map((item) => item.service.name).join(", ") || "None"}>{request.services.map((item) => item.service.name).join(", ") || "None"}</td>
                    <td className="event-request-status-cell">
                      <span className="event-select-wrap">
                        <select
                          className="input compact-select event-inline-select"
                          value={request.status}
                          disabled={busy === `quick-${request.id}`}
                          onChange={(event) => { event.stopPropagation(); void quickUpdateRequest(request, { status: event.target.value as EventStatus }); }}
                          onClick={(event) => event.stopPropagation()}
                        >
                          {statuses.map((status) => <option key={status} value={status}>{eventStatusLabel(status)}</option>)}
                        </select>
                        <ChevronDown className="event-select-chevron" size={15} aria-hidden="true" />
                      </span>
                    </td>
                    <td className="event-request-priority-cell"><span className={`status-pill event-priority-${request.priority.toLowerCase()}`}>{label(request.priority)}</span></td>
                    <td className="event-request-specialists-cell"><span className="event-request-muted" title={request.assignees.map((assignee) => userName(assignee.user)).join(", ") || "Unassigned"}>{request.assignees.map((assignee) => userName(assignee.user)).join(", ") || "Unassigned"}</span></td>
                    <td className="event-request-updated-cell">{formatDateTime(request.updatedAt)}</td>
                    <td className="event-request-action-cell">
                      <button className="event-open-button" type="button" onClick={(event) => { event.stopPropagation(); openRequest(request); }}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {detailPage && detailOpen ? (
          <section className="panel event-detail-panel">
            {selected ? (
            <>
              <div className="section-heading event-detail-heading">
                <div>
                  <div className="event-detail-title-row">
                    <h2>{selected.trackingNumber}</h2>
                    <span className={`status-pill ${statusClass(selected.status)}`}>{eventStatusLabel(selected.status)}</span>
                    <span className={`status-pill ${priorityClass(selected.priority)}`}>{label(selected.priority)}</span>
                  </div>
                  <p className="muted">{selected.eventName}</p>
                </div>
                <div className="button-row">
                  <button className="icon-button" type="button" onClick={closeRequest} aria-label="Close event details">
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div className="event-detail-grid event-detail-fact-grid">
                <div><span className="muted">Requester</span><strong>{selected.requesterFirstName} {selected.requesterLastName}</strong><small>{selected.requesterEmail}</small>{selected.requesterPhone ? <small>{selected.requesterPhone}</small> : null}</div>
                <div><span className="muted">Client</span><strong>{selected.client?.name ?? "Unmapped / no client"}</strong></div>
                <div><span className="muted">Date</span><strong>{formatDate(selected.eventDate)}</strong><small>{selected.startTime ?? "--"} - {selected.endTime ?? "--"}</small></div>
                <div><span className="muted">Services</span><strong>{selected.services.map((item) => item.service.name).join(", ") || "None"}</strong></div>
              </div>

              <div className="event-detail-workbench">
                <main className="event-detail-main">
                  <article className="nested-panel event-original-request-panel">
                    <div className="section-heading compact-heading">
                      <div>
                        <h3>Original Request</h3>
                        <p className="muted">Submitted from the event portal on {formatDateTime(selected.createdAt)}.</p>
                      </div>
                    </div>
                    <dl className="event-request-summary-list">
                      <div><dt>Event</dt><dd>{selected.eventName}</dd></div>
                      <div><dt>Organizer</dt><dd>{selected.organizer ?? "Not provided"}</dd></div>
                      <div><dt>Venue</dt><dd>{selected.venue ?? "Not provided"}</dd></div>
                      <div><dt>Requested services</dt><dd>{selected.services.map((item) => item.service.name).join(", ") || "None"}</dd></div>
                      <div><dt>Requester</dt><dd>{selected.requesterFirstName} {selected.requesterLastName} - {selected.requesterEmail}{selected.requesterPhone ? ` - ${selected.requesterPhone}` : ""}</dd></div>
                    </dl>
                    <div className="event-request-body">
                      <h4>Details</h4>
                      {selected.additionalInfo ? <p>{selected.additionalInfo}</p> : <p className="muted">No additional request details were provided.</p>}
                    </div>
                    {selected.formData && Object.keys(selected.formData).length ? (
                      <div className="event-custom-fields">
                        <h4>Portal Fields</h4>
                        <dl className="event-request-summary-list">
                          {Object.entries(selected.formData).map(([key, value]) => (
                            <div key={key}><dt>{label(key)}</dt><dd>{formatCustomFieldValue(value)}</dd></div>
                          ))}
                        </dl>
                      </div>
                    ) : null}
                  </article>

                  <section className="nested-panel event-conversation-panel">
                    <div className="section-heading compact-heading">
                      <div>
                        <h3><MessageSquare size={16} />Conversation</h3>
                        <p className="muted">Reply to the requester or save an internal note from the same workspace.</p>
                      </div>
                      <span className="count-pill">{selected.messages?.length ?? 0} message{(selected.messages?.length ?? 0) === 1 ? "" : "s"}</span>
                    </div>
                    <EventMessageComposer requestId={selected.id} users={users} onSaved={async () => {
                      setNotice("Event message saved.");
                      await loadSelected(selected.id);
                    }} />
                    <div className="event-message-list event-conversation-list">
                      {selected.messages?.length ? null : <p className="event-detail-empty">No requester messages or internal notes yet.</p>}
                      {[...(selected.messages ?? [])].reverse().map((message) => (
                        <article className={`event-message ${message.direction.toLowerCase()} ${message.visibility.toLowerCase()}`} key={message.id}>
                          <header className="event-message-header">
                            <div>
                              <strong>{message.direction === "OUTBOUND" || message.direction === "INTERNAL" ? userName(message.authorUser) : message.senderEmail ?? selected.requesterEmail}</strong>
                              <span className="muted">{label(message.direction)} - {label(message.visibility)}</span>
                            </div>
                            <small>{formatDateTime(message.createdAt)}</small>
                          </header>
                          <div className="message-body signature-render" dangerouslySetInnerHTML={{ __html: message.sanitizedBodyHtml ?? textToHtml(message.bodyText) }} />
                          {message.attachments?.length ? (
                            <AttachmentPreviewList attachments={message.attachments.map((attachment) => ({
                              id: attachment.id,
                              originalFilename: attachment.originalFilename,
                              mimeType: attachment.mimeType,
                              sizeLabel: formatBytes(attachment.fileSize),
                              isInline: attachment.isInline
                            }))} />
                          ) : null}
                        </article>
                      ))}
                    </div>
                  </section>
                </main>

                <aside className="event-detail-sidebar">
                  <section className="nested-panel event-side-panel event-request-management-panel">
                    <div className="section-heading compact-heading event-request-management-heading">
                      <div>
                        <h3>Management</h3>
                        <p className="muted">Status, priority, specialists, and internal request notes.</p>
                      </div>
                    </div>
                    <div className="event-status-actions" aria-label="Quick status actions">
                      {simplifiedStatusOptions.map((option) => (
                        <button
                          className={selected.status === option.status ? "active" : ""}
                          disabled={busy === `status-${option.status}` || selected.status === option.status}
                          key={option.status}
                          onClick={() => void quickSetSelectedStatus(option.status)}
                          title={option.description}
                          type="button"
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <div className="event-management-grid">
                      <label>Status<select className="input" value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as EventStatus }))}>{statuses.map((status) => <option key={status} value={status}>{eventStatusLabel(status)}</option>)}</select></label>
                      <label>Priority<select className="input" value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value as Priority }))}>{priorities.map((priority) => <option key={priority} value={priority}>{label(priority)}</option>)}</select></label>
                    </div>
                    <div className="event-assignee-picker compact">
                      <strong>Specialists</strong>
                      {users.map((user) => (
                        <label key={user.id}>
                          <input
                            type="checkbox"
                            checked={draft.assignedUserIds.includes(user.id)}
                            onChange={(event) => setDraft((current) => ({ ...current, assignedUserIds: event.target.checked ? [...current.assignedUserIds, user.id] : current.assignedUserIds.filter((id) => id !== user.id) }))}
                          />
                          {userName(user)}
                        </label>
                      ))}
                    </div>
                    <div className="event-assignee-picker compact">
                      <div className="event-external-heading">
                        <strong>External Specialists</strong>
                        <button
                          className={`icon-button event-external-add-button${externalCreateOpen ? " active" : ""}`}
                          type="button"
                          title={externalCreateOpen ? "Cancel new external specialist" : "Add new external specialist"}
                          aria-label={externalCreateOpen ? "Cancel new external specialist" : "Add new external specialist"}
                          onClick={() => setExternalCreateOpen((current) => !current)}
                        >
                          {externalCreateOpen ? <X size={15} /> : <UserPlus size={15} />}
                        </button>
                      </div>
                      {selected.externalSpecialists.length === 0 ? <span className="muted">No external specialists assigned.</span> : null}
                      {selected.externalSpecialists.map((assignment) => (
                        <label key={assignment.id}>
                          <span>{externalName(assignment.externalSpecialist)}<br /><small>{assignment.externalSpecialist.email}</small></span>
                          <button className="icon-button" type="button" aria-label="Remove external specialist" onClick={() => void removeExternalFromEvent(assignment.id)} disabled={busy === `external-remove-${assignment.id}`}><X size={14} /></button>
                        </label>
                      ))}
                      <div className="event-inline-controls">
                        <select className="input compact-select" value={externalAssignmentId} onChange={(event) => setExternalAssignmentId(event.target.value)}>
                          <option value="">Select external specialist</option>
                          {externalSpecialists.filter((specialist) => specialist.isActive).map((specialist) => <option key={specialist.id} value={specialist.id}>{externalName(specialist)}</option>)}
                        </select>
                        <button className="button secondary" type="button" onClick={addExternalToEvent} disabled={!externalAssignmentId || busy === "external-assign"}><Plus size={16} />Assign</button>
                      </div>
                      {externalCreateOpen ? <div className="event-external-create-grid">
                        <input className="input" placeholder="Name" value={externalDraft.name} onChange={(event) => setExternalDraft((current) => ({ ...current, name: event.target.value }))} />
                        <input className="input" placeholder="Email" value={externalDraft.email} onChange={(event) => setExternalDraft((current) => ({ ...current, email: event.target.value }))} />
                        <input className="input" placeholder="Phone" value={externalDraft.phone} onChange={(event) => setExternalDraft((current) => ({ ...current, phone: event.target.value }))} />
                        <input className="input" placeholder="Company" value={externalDraft.company} onChange={(event) => setExternalDraft((current) => ({ ...current, company: event.target.value }))} />
                        <button className="button secondary span-2" type="button" onClick={createExternalSpecialist} disabled={busy === "external-create" || !externalDraft.name.trim() || !externalDraft.email.trim()}><Plus size={16} />Add External Contact</button>
                      </div> : null}
                    </div>
                    <label className="event-management-notes">Internal request notes<textarea className="input" value={draft.additionalInfo} onChange={(event) => setDraft((current) => ({ ...current, additionalInfo: event.target.value }))} /></label>
                    <button className="button full-width-button" type="button" onClick={saveRequest} disabled={busy === "request"}><Save size={16} />Save Management</button>
                  </section>

                  <section className="nested-panel event-side-panel">
                    <div className="section-heading compact-heading">
                      <div>
                        <h3>Tasks</h3>
                        <p className="muted">{selected.tasks.length} task{selected.tasks.length === 1 ? "" : "s"} for this request.</p>
                      </div>
                    </div>
                    <div className="event-task-create compact">
                      <input className="input" placeholder="Task title" value={taskDraft.title} onChange={(event) => setTaskDraft((current) => ({ ...current, title: event.target.value }))} />
                      <select className="input" value={taskDraft.assignee} onChange={(event) => setTaskDraft((current) => ({ ...current, assignee: event.target.value }))}>
                        <option value="">Unassigned</option>
                        <optgroup label="Internal">
                          {users.map((user) => <option key={user.id} value={`user:${user.id}`}>{userName(user)}</option>)}
                        </optgroup>
                        <optgroup label="External">
                          {externalSpecialists.filter((specialist) => specialist.isActive).map((specialist) => <option key={specialist.id} value={`external:${specialist.id}`}>{externalName(specialist)}</option>)}
                        </optgroup>
                      </select>
                      <input className="input" type="datetime-local" value={taskDraft.dueAt} onChange={(event) => setTaskDraft((current) => ({ ...current, dueAt: event.target.value }))} />
                      <textarea className="input" placeholder="Task details or calendar notes" value={taskDraft.description} onChange={(event) => setTaskDraft((current) => ({ ...current, description: event.target.value }))} />
                      <button className="button secondary" type="button" onClick={createTask} disabled={busy === "task"}><Plus size={16} />Add Task</button>
                    </div>
                    <div className="event-compact-task-list">
                      {selected.tasks.length === 0 ? <p className="event-detail-empty">No tasks yet.</p> : null}
                      {selected.tasks.map((task) => {
                        const calendarDraft = calendarDrafts[task.id] ?? { startDate: selected.eventDate?.slice(0, 10) ?? "", startTime: selected.startTime ?? "", endDate: selected.eventDate?.slice(0, 10) ?? "", endTime: selected.endTime ?? "", location: selected.venue ?? "", notes: "" };
                        const taskActivity = selected.activity?.filter((activity) => activity.metadata?.taskId === task.id).slice(0, 4) ?? [];
                        return (
                          <article className={`event-task-card task-status-${task.status.toLowerCase().replace(/_/g, "-")}`} key={task.id}>
                            <div className="event-task-card-header">
                              <strong>{task.title}</strong>
                              <span className={`status-pill task-status-${task.status.toLowerCase().replace(/_/g, "-")}`}>{label(task.status)}</span>
                            </div>
                            {task.description ? <p className="muted">{task.description}</p> : null}
                            <span className="muted">Assigned: {taskAssigneeLabel(task)}</span>
                            <span className="muted">Due: {formatDateTime(task.dueAt)}</span>
                            <div className="event-task-edit-grid">
                              <label>Status<select className="input compact-select" value={task.status} onChange={(event) => void updateTask(task.id, { status: event.target.value as TaskStatus })}>{taskStatuses.map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></label>
                              <label>Specialist<select className="input compact-select" value={taskAssigneeValue(task)} onChange={(event) => void updateTask(task.id, taskAssigneePatch(event.target.value))}>
                                <option value="">Unassigned</option>
                                <optgroup label="Internal">
                                  {users.map((user) => <option key={user.id} value={`user:${user.id}`}>{userName(user)}</option>)}
                                </optgroup>
                                <optgroup label="External">
                                  {externalSpecialists.filter((specialist) => specialist.isActive).map((specialist) => <option key={specialist.id} value={`external:${specialist.id}`}>{externalName(specialist)}</option>)}
                                </optgroup>
                              </select></label>
                              <label>Due<input className="input compact-select" type="datetime-local" value={task.dueAt ? task.dueAt.slice(0, 16) : ""} onChange={(event) => void updateTask(task.id, { dueAt: event.target.value || null })} /></label>
                            </div>
                            <details className="event-calendar-sync">
                              <summary><CalendarPlus size={14} /> Calendar</summary>
                              <div className="event-calendar-grid">
                                <input className="input" type="date" value={calendarDraft.startDate} onChange={(event) => updateCalendarDraft(task.id, { startDate: event.target.value })} />
                                <input className="input" type="time" value={calendarDraft.startTime} onChange={(event) => updateCalendarDraft(task.id, { startTime: event.target.value })} />
                                <input className="input" type="date" value={calendarDraft.endDate} onChange={(event) => updateCalendarDraft(task.id, { endDate: event.target.value })} />
                                <input className="input" type="time" value={calendarDraft.endTime} onChange={(event) => updateCalendarDraft(task.id, { endTime: event.target.value })} />
                                <input className="input span-2" placeholder="Location" value={calendarDraft.location} onChange={(event) => updateCalendarDraft(task.id, { location: event.target.value })} />
                                <textarea className="input span-2" placeholder="Notes to include with calendar notification" value={calendarDraft.notes} onChange={(event) => updateCalendarDraft(task.id, { notes: event.target.value })} />
                              </div>
                              {task.calendarSyncedAt ? <p className="muted">Synced to {task.calendarUserEmail} on {formatDateTime(task.calendarSyncedAt)}</p> : null}
                              {task.calendarSyncError ? <p className="alert error">{task.calendarSyncError}</p> : null}
                              {task.externalSpecialist ? (
                                <button className="button secondary" type="button" onClick={() => void sendExternalTaskInvite(task.id)} disabled={busy === `external-invite-${task.id}`}>Send External Invite</button>
                              ) : (
                                <button className="button secondary" type="button" onClick={() => void syncTaskCalendar(task.id)} disabled={busy === `calendar-${task.id}`}>Add to Calendar</button>
                              )}
                            </details>
                            {taskActivity.length ? (
                              <details className="event-task-history">
                                <summary>Task History</summary>
                                {taskActivity.map((activity) => (
                                  <div className="event-comment" key={activity.id}>
                                    <strong>{activityTitle(activity.action)}</strong>
                                    <p>{activityDetail(activity)}</p>
                                    <small>{formatDateTime(activity.createdAt)}</small>
                                  </div>
                                ))}
                              </details>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  </section>

                  <section className="nested-panel event-side-panel">
                    <div className="section-heading compact-heading">
                      <div>
                        <h3>Internal Comments</h3>
                        <p className="muted">Team-only notes for coordination.</p>
                      </div>
                    </div>
                    <textarea className="input" placeholder="Add internal comment..." value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} />
                    <button className="button secondary full-width-button" type="button" onClick={addComment} disabled={busy === "comment"}><Send size={16} />Add Comment</button>
                    <div className="event-comment-list">
                      {selected.comments?.length ? null : <p className="event-detail-empty">No internal comments yet.</p>}
                      {selected.comments?.map((comment) => (
                        <div className="event-comment" key={comment.id}><strong>{userName(comment.user)}</strong><p>{comment.body}</p><small>{new Date(comment.createdAt).toLocaleString()}</small></div>
                      ))}
                    </div>
                  </section>

                  <details className="nested-panel event-side-panel event-activity-disclosure">
                    <summary>Activity Snapshot</summary>
                    {selected.activity?.length ? null : <p className="muted">No visible activity yet.</p>}
                    {selected.activity?.slice(0, 10).map((activity) => (
                      <div className="event-comment" key={activity.id}>
                        <strong>{activityTitle(activity.action)}</strong>
                        <p>{activityDetail(activity)}</p>
                        <small>{formatDateTime(activity.createdAt)}</small>
                      </div>
                    ))}
                  </details>
                </aside>
              </div>
            </>
            ) : <p className="muted">Loading request detail...</p>}
          </section>
        ) : null}
      </div>
      </>
      ) : (
        <section className="panel event-my-tasks-panel">
          <div className="section-heading compact-heading">
            <div>
              <h2>My Event Tasks</h2>
              <p className="muted">Update the event tasks assigned to you and keep the rest of the team informed.</p>
            </div>
            <button className="button secondary" type="button" onClick={() => void loadData()} disabled={loading}>
              <RefreshCw size={16} aria-hidden="true" />
              <span>Refresh</span>
            </button>
          </div>
          <label className="audit-toggle"><input type="checkbox" checked={showTaskHistory} onChange={event => setShowTaskHistory(event.target.checked)} /> Include completed tasks and tasks from closed or cancelled events ({myTasks.length - activeMyTasks.length})</label>
          <div className="table-scroll event-table-scroll">
            <table className="tickets-table event-task-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Event</th>
                  <th>Date / Time</th>
                  <th>Status</th>
                  <th>Update note</th>
                  <th>Updated</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleMyTasks.length === 0 ? (
                  <tr>
                    <td colSpan={7}><span className="muted">{loading ? "Loading tasks..." : "No active event tasks. Include history to review completed or cancelled work."}</span></td>
                  </tr>
                ) : null}
                {visibleMyTasks.map((task) => {
                  const draftTask = myTaskDrafts[task.id] ?? { status: task.status, comment: "" };
                  return (
                    <tr key={task.id}>
                      <td data-label="Task">
                        <strong className="event-task-title">{task.title}</strong>
                        {task.description ? <span className="muted event-task-description">{task.description}</span> : null}
                      </td>
                      <td data-label="Event">
                        <strong className="event-task-meta">{task.request.trackingNumber}</strong>
                        <span className="muted event-task-description">{task.request.eventName}</span><span className="status-pill">Event: {eventStatusLabel(task.request.status)}</span>
                      </td>
                      <td data-label="Date / Time">
                        <strong className="event-task-meta">{formatDate(task.request.eventDate)}</strong>
                        <span className="muted event-task-description">{task.request.startTime ?? "--"} - {task.request.endTime ?? "--"}</span>
                      </td>
                      <td data-label="Status">
                        <select className="input compact-select event-inline-select" value={draftTask.status} onChange={(event) => updateMyTaskDraft(task.id, { status: event.target.value as TaskStatus })}>
                          {taskStatuses.map((status) => <option key={status} value={status}>{label(status)}</option>)}
                        </select>
                      </td>
                      <td data-label="Update note">
                        <input className="input" placeholder="Optional note..." value={draftTask.comment} onChange={(event) => updateMyTaskDraft(task.id, { comment: event.target.value })} />
                      </td>
                      <td data-label="Updated"><span className="event-task-updated">{formatDateTime(task.updatedAt)}</span></td>
                      <td data-label="Action">
                        <div className="event-task-actions">
                          <button className="button secondary" type="button" onClick={() => openRequest(task.request)}>Open Event</button>
                          <button className="button" type="button" onClick={() => void saveMyTask(task.id)} disabled={busy === `my-task-${task.id}` || (draftTask.status === task.status && !draftTask.comment.trim())}>Save</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {recycleBinOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel event-recycle-panel" role="dialog" aria-modal="true" aria-label="Event request recycle bin">
            <div className="section-heading">
              <div>
                <h2>Event Recycle Bin</h2>
                <p className="muted">{recycledRequests.length} deleted event request{recycledRequests.length === 1 ? "" : "s"}.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setRecycleBinOpen(false)} aria-label="Close event recycle bin">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="table-scroll event-table-scroll">
              <table className="tickets-table event-request-table">
                <thead>
                  <tr>
                    <th>Tracking</th>
                    <th>Event</th>
                    <th>Requester</th>
                    <th>Deleted</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {recycledRequests.length === 0 ? (
                    <tr><td colSpan={5}><span className="muted">No deleted event requests.</span></td></tr>
                  ) : null}
                  {recycledRequests.map((request) => (
                    <tr key={request.id}>
                      <td><strong>{request.trackingNumber}</strong></td>
                      <td><strong>{request.eventName}</strong><span className="muted">{request.venue ?? "No venue"}</span></td>
                      <td><strong>{request.requesterFirstName} {request.requesterLastName}</strong><span className="muted">{request.requesterEmail}</span></td>
                      <td>{formatDateTime(request.deletedAt ?? null)}</td>
                      <td>
                        <button className="button secondary" type="button" onClick={() => void restoreRequest(request.id)} disabled={busy === `restore-${request.id}`}>
                          <RotateCcw size={16} aria-hidden="true" />
                          <span>Restore</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
