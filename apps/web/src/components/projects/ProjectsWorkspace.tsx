"use client";
import { QcContextLink } from "@/components/qc/QcContextLink";

import { AlertTriangle, ArrowDown, ArrowUp, CalendarRange, ChevronLeft, ChevronRight, ClipboardCheck, Eye, Filter, Link2, Milestone, Plus, RefreshCw, Save, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";

type ProjectStatus = "PLANNING" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "CANCELLED";
type ProjectHealth = "ON_TRACK" | "AT_RISK" | "OFF_TRACK";
type MilestoneStatus = "NOT_STARTED" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED";
type DecisionStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CANCELLED";
type ProjectView = "PORTFOLIO" | "TIMELINE";
type TimelineRange = "30" | "90" | "180";
type TimelineEntryKind = "TARGET" | "MILESTONE" | "EVENT";
type ProjectSortKey = "name" | "client" | "owner" | "status" | "health" | "progress" | "work" | "decisions" | "target";
type ProjectPageSize = 20 | 50 | 100 | "ALL";

interface ProjectMilestone {
  id: string;
  title: string;
  description: string | null;
  status: MilestoneStatus;
  dueAt: string | null;
  assignedUser: { id: string; firstName: string; lastName: string } | null;
}

interface ProjectDecision {
  id: string;
  title: string;
  description: string | null;
  resolution: string | null;
  status: DecisionStatus;
  dueAt: string | null;
  resolvedAt: string | null;
  owner: { id: string; firstName: string; lastName: string } | null;
}

interface ProjectWorkItem {
  id: string;
  ticket: { id: string; ticketNumber: string; subject: string; status: string; priority: string } | null;
  eventServiceRequest: { id: string; trackingNumber: string; eventName: string; status: string; priority: string; eventDate: string | null } | null;
}

interface ProjectDependency {
  id: string;
  dependsOnProject: { id: string; name: string; status: ProjectStatus; health: ProjectHealth; targetDate: string | null; owner: { id: string; firstName: string; lastName: string } | null };
}

interface Project {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  health: ProjectHealth;
  startAt: string | null;
  targetDate: string | null;
  client: { id: string; name: string } | null;
  owner: { id: string; firstName: string; lastName: string } | null;
  milestones: ProjectMilestone[];
  decisions: ProjectDecision[];
  workItems: ProjectWorkItem[];
  dependencies: ProjectDependency[];
}

interface ProjectsResponse {
  items: Project[];
  clients: Array<{ id: string; name: string }>;
  assignableUsers: Array<{ id: string; firstName: string; lastName: string }>;
  templates: Array<{ id: string; name: string; description: string | null; durationDays: number | null; milestones: Array<{ id: string }>; decisions: Array<{ id: string }> }>;
  capabilities: { create: boolean; update: boolean; delete: boolean };
}

interface ProjectDraft {
  name: string;
  description: string;
  clientId: string;
  ownerId: string;
  status: ProjectStatus;
  health: ProjectHealth;
  startAt: string;
  targetDate: string;
}

interface TimelineEntry {
  id: string;
  projectId: string;
  projectName: string;
  date: string;
  kind: TimelineEntryKind;
  title: string;
  status: string;
  href?: string;
  overdue: boolean;
}

interface ProjectCommitment {
  id: string;
  kind: "TARGET" | "MILESTONE" | "DEPENDENCY" | "DECISION";
  title: string;
  note: string;
  dueAt: string | null;
  overdue: boolean;
}

const emptyDraft: ProjectDraft = { name: "", description: "", clientId: "", ownerId: "", status: "PLANNING", health: "ON_TRACK", startAt: "", targetDate: "" };

function label(value: string) {
  return value.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function toDateInput(value: string | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "-";
}

function draftFromProject(project: Project): ProjectDraft {
  return { name: project.name, description: project.description ?? "", clientId: project.client?.id ?? "", ownerId: project.owner?.id ?? "", status: project.status, health: project.health, startAt: toDateInput(project.startAt), targetDate: toDateInput(project.targetDate) };
}

export function ProjectsWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedProjectId = searchParams.get("project");
  const [data, setData] = useState<ProjectsResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProjectDraft>(emptyDraft);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [milestoneDueAt, setMilestoneDueAt] = useState("");
  const [milestoneAssignedUserId, setMilestoneAssignedUserId] = useState("");
  const [decisionTitle, setDecisionTitle] = useState("");
  const [decisionDescription, setDecisionDescription] = useState("");
  const [decisionDueAt, setDecisionDueAt] = useState("");
  const [decisionOwnerId, setDecisionOwnerId] = useState("");
  const [decisionResolutionDrafts, setDecisionResolutionDrafts] = useState<Record<string, string>>({});
  const [linkType, setLinkType] = useState<"TICKET" | "EVENT_SERVICE">("TICKET");
  const [linkReference, setLinkReference] = useState("");
  const [dependencyProjectId, setDependencyProjectId] = useState("");
  const [projectView, setProjectView] = useState<ProjectView>("PORTFOLIO");
  const [timelineRange, setTimelineRange] = useState<TimelineRange>("90");
  const [clientFilter, setClientFilter] = useState(searchParams.get("clientId") ?? "ALL");
  const [projectQuery, setProjectQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "ALL">("ALL");
  const [healthFilter, setHealthFilter] = useState<ProjectHealth | "ALL">("ALL");
  const [ownerFilter, setOwnerFilter] = useState("ALL");
  const [projectSortKey, setProjectSortKey] = useState<ProjectSortKey>("target");
  const [projectSortDirection, setProjectSortDirection] = useState<"asc" | "desc">("asc");
  const [projectPageSize, setProjectPageSize] = useState<ProjectPageSize>(20);
  const [projectPage, setProjectPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selected = useMemo(() => data?.items.find((item) => item.id === selectedId) ?? null, [data, selectedId]);

  const selectProject = (project: Project | null) => {
    setSelectedId(project?.id ?? null);
    setDraft(project ? draftFromProject(project) : emptyDraft);
    setMilestoneTitle("");
    setMilestoneDueAt("");
    setMilestoneAssignedUserId("");
    setDecisionTitle("");
    setDecisionDescription("");
    setDecisionDueAt("");
    setDecisionOwnerId("");
    setDecisionResolutionDrafts({});
    setLinkReference("");
    setDependencyProjectId("");
  };

  const load = async (preferredProjectId?: string | null) => {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch<ProjectsResponse>("/projects");
      setData(response);
      const targetId = preferredProjectId === undefined ? selectedId ?? requestedProjectId : preferredProjectId;
      const next = targetId ? response.items.find((project) => project.id === targetId) ?? null : null;
      selectProject(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load projects.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const updateDraft = (field: keyof ProjectDraft, value: string) => setDraft((current) => ({ ...current, [field]: value }));

  const saveProject = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/projects/${selected.id}`, { method: "PATCH", body: JSON.stringify({ ...draft, clientId: draft.clientId || null, ownerId: draft.ownerId || null, startAt: draft.startAt || null, targetDate: draft.targetDate || null }) });
      await load(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save project.");
    } finally {
      setSaving(false);
    }
  };

  const addMilestone = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !milestoneTitle.trim()) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/projects/${selected.id}/milestones`, { method: "POST", body: JSON.stringify({ title: milestoneTitle, dueAt: milestoneDueAt || null, assignedUserId: milestoneAssignedUserId || null }) });
      await load(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to add milestone.");
    } finally {
      setSaving(false);
    }
  };

  const updateMilestone = async (milestone: ProjectMilestone, update: Partial<Pick<ProjectMilestone, "status">> & { assignedUserId?: string | null }) => {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/projects/${selected.id}/milestones/${milestone.id}`, { method: "PATCH", body: JSON.stringify(update) });
      await load(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update milestone.");
    } finally {
      setSaving(false);
    }
  };

  const removeMilestone = async (milestoneId: string) => {
    if (!selected || !window.confirm("Remove this milestone from the project?")) return;
    setSaving(true);
    try {
      await apiFetch(`/projects/${selected.id}/milestones/${milestoneId}`, { method: "DELETE" });
      await load(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to remove milestone.");
    } finally {
      setSaving(false);
    }
  };

  const addDecision = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !decisionTitle.trim()) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/projects/${selected.id}/decisions`, { method: "POST", body: JSON.stringify({ title: decisionTitle, description: decisionDescription || null, dueAt: decisionDueAt || null, ownerId: decisionOwnerId || null }) });
      await load(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to add project decision.");
    } finally {
      setSaving(false);
    }
  };

  const updateDecision = async (decision: ProjectDecision, update: { ownerId?: string | null; status?: DecisionStatus; resolution?: string | null }) => {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/projects/${selected.id}/decisions/${decision.id}`, { method: "PATCH", body: JSON.stringify(update) });
      await load(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update project decision.");
    } finally {
      setSaving(false);
    }
  };

  const addWorkItem = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !linkReference.trim()) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/projects/${selected.id}/work-items`, { method: "POST", body: JSON.stringify({ sourceType: linkType, reference: linkReference }) });
      await load(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to link work item.");
    } finally {
      setSaving(false);
    }
  };

  const removeWorkItem = async (workItemId: string) => {
    if (!selected || !window.confirm("Remove this linked item from the project?")) return;
    setSaving(true);
    try {
      await apiFetch(`/projects/${selected.id}/work-items/${workItemId}`, { method: "DELETE" });
      await load(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to remove linked work item.");
    } finally {
      setSaving(false);
    }
  };

  const removeProject = async () => {
    if (!selected || !window.confirm(`Archive project "${selected.name}"?`)) return;
    setSaving(true);
    try {
      await apiFetch(`/projects/${selected.id}`, { method: "DELETE" });
      await load(null);
      router.replace("/projects", { scroll: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to archive project.");
    } finally {
      setSaving(false);
    }
  };

  const saveTemplate = async () => {
    if (!selected || !templateName.trim()) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch("/projects/templates", { method: "POST", body: JSON.stringify({ sourceProjectId: selected.id, name: templateName.trim() }) });
      setTemplateName("");
      await load(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save project template.");
    } finally {
      setSaving(false);
    }
  };

  const applyTemplate = async (templateId: string) => {
    const template = data?.templates.find((item) => item.id === templateId);
    if (!template) return;
    setSaving(true);
    setError("");
    try {
      const project = await apiFetch<Project>(`/projects/templates/${templateId}/apply`, { method: "POST", body: JSON.stringify({ name: `${template.name} - ${new Date().toLocaleDateString()}`, ownerId: draft.ownerId || undefined, clientId: draft.clientId || undefined, startAt: new Date().toISOString().slice(0, 10) }) });
      setShowTemplates(false);
      await load(project.id);
      router.replace(`/projects?project=${project.id}`, { scroll: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to apply project template.");
    } finally {
      setSaving(false);
    }
  };

  const removeTemplate = async (templateId: string) => {
    if (!window.confirm("Delete this project template? Existing projects will not change.")) return;
    setSaving(true);
    try {
      await apiFetch(`/projects/templates/${templateId}`, { method: "DELETE" });
      await load(selected?.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete project template.");
    } finally {
      setSaving(false);
    }
  };

  const addDependency = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !dependencyProjectId) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/projects/${selected.id}/dependencies`, { method: "POST", body: JSON.stringify({ dependsOnProjectId: dependencyProjectId }) });
      await load(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to add project dependency.");
    } finally {
      setSaving(false);
    }
  };

  const removeDependency = async (dependencyId: string) => {
    if (!selected || !window.confirm("Remove this project dependency?")) return;
    setSaving(true);
    try {
      await apiFetch(`/projects/${selected.id}/dependencies/${dependencyId}`, { method: "DELETE" });
      await load(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to remove project dependency.");
    } finally {
      setSaving(false);
    }
  };

  const blockedDependencies = selected?.dependencies.filter((dependency) => dependency.dependsOnProject.status !== "COMPLETED") ?? [];
  const availableDependencies = (data?.items ?? []).filter((project) => project.id !== selected?.id && !selected?.dependencies.some((dependency) => dependency.dependsOnProject.id === project.id));
  const timelineEntries = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(today);
    rangeEnd.setDate(rangeEnd.getDate() + Number(timelineRange));
    const isIncomplete = (status: string) => !["COMPLETED", "CANCELLED"].includes(status);
    const entries: TimelineEntry[] = [];

    for (const project of data?.items ?? []) {
      if (clientFilter !== "ALL" && project.client?.id !== clientFilter) continue;
      if (project.targetDate) {
        entries.push({ id: `${project.id}:target`, projectId: project.id, projectName: project.name, date: project.targetDate, kind: "TARGET", title: "Project target", status: project.status, overdue: new Date(project.targetDate) < today && isIncomplete(project.status) });
      }
      for (const milestone of project.milestones) {
        if (milestone.dueAt) {
          entries.push({ id: milestone.id, projectId: project.id, projectName: project.name, date: milestone.dueAt, kind: "MILESTONE", title: milestone.title, status: milestone.status, overdue: new Date(milestone.dueAt) < today && isIncomplete(milestone.status) });
        }
      }
      for (const workItem of project.workItems) {
        const event = workItem.eventServiceRequest;
        if (event?.eventDate) {
          entries.push({ id: workItem.id, projectId: project.id, projectName: project.name, date: event.eventDate, kind: "EVENT", title: event.eventName, status: event.status, href: `/event-services/${event.trackingNumber}`, overdue: new Date(event.eventDate) < today && isIncomplete(event.status) });
        }
      }
    }

    return entries.filter((entry) => entry.overdue || (new Date(entry.date) >= today && new Date(entry.date) <= rangeEnd)).sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
  }, [clientFilter, data, timelineRange]);

  const showProjectInPortfolio = (projectId: string) => {
    const project = data?.items.find((item) => item.id === projectId) ?? null;
    setProjectView("PORTFOLIO");
    selectProject(project);
    router.replace(`/projects?project=${projectId}`, { scroll: false });
  };

  const closeProject = () => {
    selectProject(null);
    router.replace("/projects", { scroll: false });
  };

  const quickUpdateProject = async (project: Project, update: Partial<Pick<Project, "status" | "health">>) => {
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/projects/${project.id}`, { method: "PATCH", body: JSON.stringify(update) });
      await load(selected?.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update project.");
    } finally {
      setSaving(false);
    }
  };

  const toggleProjectSort = (key: ProjectSortKey) => {
    if (projectSortKey === key) {
      setProjectSortDirection((current) => current === "asc" ? "desc" : "asc");
    } else {
      setProjectSortKey(key);
      setProjectSortDirection("asc");
    }
    setProjectPage(1);
  };
  const commitments = useMemo(() => {
    if (!selected) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const incomplete = !["COMPLETED", "CANCELLED"].includes(selected.status);
    const entries: ProjectCommitment[] = [];
    if (selected.targetDate && incomplete) {
      entries.push({ id: "target", kind: "TARGET", title: "Project target", note: selected.owner ? `${label(selected.status)} · ${selected.owner.firstName} ${selected.owner.lastName}` : `${label(selected.status)} · Unassigned`, dueAt: selected.targetDate, overdue: new Date(selected.targetDate) < today });
    }
    for (const milestone of selected.milestones) {
      if (milestone.status !== "COMPLETED") {
        entries.push({ id: milestone.id, kind: "MILESTONE", title: milestone.title, note: milestone.assignedUser ? `${label(milestone.status)} · ${milestone.assignedUser.firstName} ${milestone.assignedUser.lastName}` : `${label(milestone.status)} · Unassigned`, dueAt: milestone.dueAt, overdue: Boolean(milestone.dueAt && new Date(milestone.dueAt) < today) });
      }
    }
    for (const dependency of selected.dependencies) {
      if (dependency.dependsOnProject.status !== "COMPLETED") {
        entries.push({ id: dependency.id, kind: "DEPENDENCY", title: dependency.dependsOnProject.name, note: dependency.dependsOnProject.owner ? `Prerequisite · ${dependency.dependsOnProject.owner.firstName} ${dependency.dependsOnProject.owner.lastName}` : "Prerequisite · Unassigned", dueAt: dependency.dependsOnProject.targetDate, overdue: Boolean(dependency.dependsOnProject.targetDate && new Date(dependency.dependsOnProject.targetDate) < today) });
      }
    }
    for (const decision of selected.decisions) {
      if (!["RESOLVED", "CANCELLED"].includes(decision.status)) {
        entries.push({ id: decision.id, kind: "DECISION", title: decision.title, note: decision.owner ? `${label(decision.status)} · ${decision.owner.firstName} ${decision.owner.lastName}` : `${label(decision.status)} · Unassigned`, dueAt: decision.dueAt, overdue: Boolean(decision.dueAt && new Date(decision.dueAt) < today) });
      }
    }
    return entries.sort((left, right) => (left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER) - (right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER));
  }, [selected]);

  const filteredProjects = useMemo(() => {
    const query = projectQuery.trim().toLowerCase();
    const valueFor = (project: Project, key: ProjectSortKey) => {
      const completedMilestones = project.milestones.filter((milestone) => milestone.status === "COMPLETED").length;
      const openDecisions = project.decisions.filter((decision) => !["RESOLVED", "CANCELLED"].includes(decision.status)).length;
      switch (key) {
        case "name": return project.name.toLowerCase();
        case "client": return (project.client?.name ?? "Internal").toLowerCase();
        case "owner": return project.owner ? `${project.owner.firstName} ${project.owner.lastName}`.toLowerCase() : "";
        case "status": return project.status;
        case "health": return project.health;
        case "progress": return project.milestones.length ? completedMilestones / project.milestones.length : 0;
        case "work": return project.workItems.length;
        case "decisions": return openDecisions;
        case "target": return project.targetDate ? new Date(project.targetDate).getTime() : Number.MAX_SAFE_INTEGER;
      }
    };

    return (data?.items ?? [])
      .filter((project) => {
      if (clientFilter !== "ALL" && project.client?.id !== clientFilter) return false;
        const searchable = `${project.name} ${project.description ?? ""} ${project.client?.name ?? "Internal"} ${project.owner ? `${project.owner.firstName} ${project.owner.lastName}` : "Unassigned"}`.toLowerCase();
        return (!query || searchable.includes(query))
          && (statusFilter === "ALL" || project.status === statusFilter)
          && (healthFilter === "ALL" || project.health === healthFilter)
          && (ownerFilter === "ALL" || (ownerFilter === "UNASSIGNED" ? !project.owner : project.owner?.id === ownerFilter));
      })
      .sort((left, right) => {
        const leftValue = valueFor(left, projectSortKey);
        const rightValue = valueFor(right, projectSortKey);
        const comparison = typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue));
        return projectSortDirection === "asc" ? comparison : -comparison;
      });
  }, [clientFilter, data, healthFilter, ownerFilter, projectQuery, projectSortDirection, projectSortKey, statusFilter]);

  const totalProjectPages = projectPageSize === "ALL" ? 1 : Math.max(1, Math.ceil(filteredProjects.length / projectPageSize));
  const safeProjectPage = Math.min(projectPage, totalProjectPages);
  const visibleProjects = projectPageSize === "ALL" ? filteredProjects : filteredProjects.slice((safeProjectPage - 1) * projectPageSize, safeProjectPage * projectPageSize);
  const projectPageStart = filteredProjects.length ? (safeProjectPage - 1) * (projectPageSize === "ALL" ? filteredProjects.length : projectPageSize) + 1 : 0;
  const projectPageEnd = projectPageSize === "ALL" ? filteredProjects.length : Math.min(filteredProjects.length, safeProjectPage * projectPageSize);

  const renderProjectSort = (title: string, key: ProjectSortKey) => (
    <button className={projectSortKey === key ? "active" : ""} type="button" onClick={() => toggleProjectSort(key)}>
      {title}
      {projectSortKey === key ? projectSortDirection === "asc" ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" /> : null}
    </button>
  );

  return (
    <div className="projects-workspace">
      <div className="projects-toolbar panel">
        <strong>Project portfolio</strong>
        <div className="projects-toolbar-actions">
          <div className="segmented-control" role="group" aria-label="Project view">
            <button className={projectView === "PORTFOLIO" ? "active" : ""} type="button" onClick={() => setProjectView("PORTFOLIO")}>Portfolio</button>
            <button className={projectView === "TIMELINE" ? "active" : ""} type="button" onClick={() => setProjectView("TIMELINE")}>Timeline</button>
          </div>
          {data?.capabilities.create ? <button className="button secondary" type="button" onClick={() => setShowTemplates((current) => !current)}><ClipboardCheck size={16} aria-hidden="true" /> Templates</button> : null}
          <button className="button secondary icon-button" type="button" onClick={() => void load()} disabled={loading} title="Refresh projects" aria-label="Refresh projects"><RefreshCw size={16} className={loading ? "spin" : ""} aria-hidden="true" /></button>
          {data?.capabilities.create ? <Link className="button" href="/projects/new"><Plus size={16} aria-hidden="true" /> Add Project</Link> : null}
        </div>
      </div>

      {error ? <div className="alert error">{error}</div> : null}

      {showTemplates ? <section className="panel projects-templates-panel"><div className="section-heading"><div><h2>Project templates</h2><p>Reusable project structures with their milestones and open decisions.</p></div><button className="button secondary icon-button" type="button" onClick={() => setShowTemplates(false)} title="Close templates" aria-label="Close templates"><X size={16} aria-hidden="true" /></button></div><div className="projects-template-list">{(data?.templates ?? []).map((template) => <div className="projects-template-row" key={template.id}><div><strong>{template.name}</strong><span>{template.milestones.length} milestones · {template.decisions.length} decisions · {template.durationDays ?? "No"} day target</span></div><div className="projects-template-actions"><button className="button secondary" type="button" onClick={() => void applyTemplate(template.id)} disabled={saving}><Plus size={15} aria-hidden="true" /> Use</button>{data?.capabilities.delete ? <button className="button secondary icon-button" type="button" onClick={() => void removeTemplate(template.id)} disabled={saving} title={`Delete ${template.name}`} aria-label={`Delete ${template.name}`}><Trash2 size={15} aria-hidden="true" /></button> : null}</div></div>)}{!data?.templates.length ? <div className="dashboard-empty">Save an existing project as a template to begin.</div> : null}</div></section> : null}

      {projectView === "TIMELINE" ? <section className="panel projects-timeline-panel">
        <div className="projects-timeline-heading">
          <div><span className="projects-timeline-title"><CalendarRange size={18} aria-hidden="true" /> Portfolio timeline</span><p>Upcoming project targets, milestones, and linked event requests. Overdue work remains visible.</p></div>
          <div className="segmented-control" role="group" aria-label="Timeline range">
            {(["30", "90", "180"] as TimelineRange[]).map((range) => <button className={timelineRange === range ? "active" : ""} type="button" key={range} onClick={() => setTimelineRange(range)}>{range}d</button>)}
          </div>
        </div>
        <div className="projects-timeline-list">
          {timelineEntries.map((entry) => <div className={`projects-timeline-row${entry.overdue ? " overdue" : ""}`} key={entry.id}>
            <time>{formatDate(entry.date)}</time><span className={`projects-timeline-marker ${entry.kind.toLowerCase()}`} aria-hidden="true" />
            <div className="projects-timeline-content"><div><span className="projects-timeline-kind">{label(entry.kind)}</span><button type="button" onClick={() => showProjectInPortfolio(entry.projectId)}>{entry.projectName}</button></div>{entry.href ? <Link href={entry.href}>{entry.title}</Link> : <strong>{entry.title}</strong>}<small>{entry.overdue ? "Overdue" : label(entry.status)}</small></div>
          </div>)}
          {!loading && !timelineEntries.length ? <div className="dashboard-empty">No project targets, milestones, or linked events fall within this timeline.</div> : null}
        </div>
      </section> : <>
        <section className="panel projects-portfolio-panel">
          <div className="projects-portfolio-heading">
            <div><h2>Projects</h2><p>{filteredProjects.length} of {data?.items.length ?? 0} planning records</p></div>
            <div className="projects-portfolio-filters"><select className="input" aria-label="Filter projects by client" value={clientFilter} onChange={event => { setClientFilter(event.target.value); setProjectPage(1); }}><option value="ALL">All clients</option>{data?.clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select>
              <Filter size={15} aria-hidden="true" />
              <label className="projects-search"><Search size={14} aria-hidden="true" /><input value={projectQuery} onChange={(event) => { setProjectQuery(event.target.value); setProjectPage(1); }} placeholder="Search projects" aria-label="Search projects" /></label>
              <select className="input" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as ProjectStatus | "ALL"); setProjectPage(1); }} aria-label="Filter projects by status"><option value="ALL">All statuses</option>{(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as ProjectStatus[]).map((status) => <option value={status} key={status}>{label(status)}</option>)}</select>
              <select className="input" value={healthFilter} onChange={(event) => { setHealthFilter(event.target.value as ProjectHealth | "ALL"); setProjectPage(1); }} aria-label="Filter projects by health"><option value="ALL">All health</option>{(["ON_TRACK", "AT_RISK", "OFF_TRACK"] as ProjectHealth[]).map((health) => <option value={health} key={health}>{label(health)}</option>)}</select>
              <select className="input" value={ownerFilter} onChange={(event) => { setOwnerFilter(event.target.value); setProjectPage(1); }} aria-label="Filter projects by owner"><option value="ALL">All owners</option><option value="UNASSIGNED">Unassigned</option>{(data?.assignableUsers ?? []).map((owner) => <option value={owner.id} key={owner.id}>{owner.firstName} {owner.lastName}</option>)}</select>
              <button className="button secondary icon-button" type="button" onClick={() => { setClientFilter("ALL"); setProjectQuery(""); setStatusFilter("ALL"); setHealthFilter("ALL"); setOwnerFilter("ALL"); setProjectPage(1); }} title="Clear filters" aria-label="Clear project filters"><X size={15} aria-hidden="true" /></button>
            </div>
          </div>
          <div className="projects-table-scroll">
            <table className="table projects-table">
              <thead><tr><th>{renderProjectSort("Project", "name")}</th><th>{renderProjectSort("Client", "client")}</th><th>{renderProjectSort("Owner", "owner")}</th><th>{renderProjectSort("Status", "status")}</th><th>{renderProjectSort("Health", "health")}</th><th>{renderProjectSort("Progress", "progress")}</th><th>{renderProjectSort("Work", "work")}</th><th>{renderProjectSort("Decisions", "decisions")}</th><th>{renderProjectSort("Target", "target")}</th><th>Actions</th></tr></thead>
              <tbody>
                {visibleProjects.map((project) => {
                  const completedMilestones = project.milestones.filter((milestone) => milestone.status === "COMPLETED").length;
                  const openDecisions = project.decisions.filter((decision) => !["RESOLVED", "CANCELLED"].includes(decision.status)).length;
                  const progress = project.milestones.length ? Math.round((completedMilestones / project.milestones.length) * 100) : 0;
                  return <tr className={project.id === selected?.id ? "selected" : ""} key={project.id}>
                    <td><button className="projects-project-link" type="button" onClick={() => showProjectInPortfolio(project.id)}><strong>{project.name}</strong>{project.description ? <small>{project.description}</small> : null}</button></td>
                    <td>{project.client?.name ?? "Internal"}</td>
                    <td>{project.owner ? `${project.owner.firstName} ${project.owner.lastName}` : <span className="projects-unassigned">Unassigned</span>}</td>
                    <td>{data?.capabilities.update ? <select className="input projects-quick-select" value={project.status} onChange={(event) => void quickUpdateProject(project, { status: event.target.value as ProjectStatus })} disabled={saving}>{(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as ProjectStatus[]).map((status) => <option value={status} key={status}>{label(status)}</option>)}</select> : label(project.status)}</td>
                    <td>{data?.capabilities.update ? <select className={`input projects-quick-select health-${project.health.toLowerCase()}`} value={project.health} onChange={(event) => void quickUpdateProject(project, { health: event.target.value as ProjectHealth })} disabled={saving}>{(["ON_TRACK", "AT_RISK", "OFF_TRACK"] as ProjectHealth[]).map((health) => <option value={health} key={health}>{label(health)}</option>)}</select> : label(project.health)}</td>
                    <td><div className="projects-progress"><span><i style={{ width: `${progress}%` }} /></span><small>{completedMilestones}/{project.milestones.length}</small></div></td>
                    <td>{project.workItems.length}</td><td>{openDecisions}</td><td>{formatDate(project.targetDate)}</td>
                    <td><button className="button secondary projects-open-button" type="button" onClick={() => showProjectInPortfolio(project.id)}><Eye size={14} aria-hidden="true" /> Open</button></td>
                  </tr>;
                })}
                {!loading && !visibleProjects.length ? <tr><td className="projects-table-empty" colSpan={10}>{data?.items.length ? "No projects match the current filters." : "No projects have been created. Start with a project plan, assign its owner, then add milestones and link existing tickets or event requests. Creative QC deliverables can reference that project."}</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="projects-pagination">
            <span>Showing {projectPageStart}-{projectPageEnd} of {filteredProjects.length}</span>
            <label>Rows <select className="input" value={projectPageSize} onChange={(event) => { const value = event.target.value; setProjectPageSize(value === "ALL" ? "ALL" : Number(value) as 20 | 50 | 100); setProjectPage(1); }}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option><option value="ALL">All</option></select></label>
            <div><button className="button secondary icon-button" type="button" onClick={() => setProjectPage((current) => Math.max(1, current - 1))} disabled={safeProjectPage <= 1} title="Previous page" aria-label="Previous project page"><ChevronLeft size={15} aria-hidden="true" /></button><span>Page {safeProjectPage} of {totalProjectPages}</span><button className="button secondary icon-button" type="button" onClick={() => setProjectPage((current) => Math.min(totalProjectPages, current + 1))} disabled={safeProjectPage >= totalProjectPages} title="Next page" aria-label="Next project page"><ChevronRight size={15} aria-hidden="true" /></button></div>
          </div>
        </section>

        {selected ? <section className="panel projects-detail-panel">
            <div className="section-heading projects-detail-heading"><div><h2>{selected.name}</h2><p>Owner: {selected.owner ? `${selected.owner.firstName} ${selected.owner.lastName}` : "Unassigned"}</p></div><div className="projects-detail-actions"><QcContextLink href={`/qc/creative?projectId=${selected.id}`} label="Creative QC" /><button className="button secondary icon-button" type="button" onClick={closeProject} title="Close project detail" aria-label="Close project detail"><X size={16} aria-hidden="true" /></button>{data?.capabilities.delete ? <button className="button secondary icon-button" type="button" onClick={() => void removeProject()} disabled={saving} title="Archive project" aria-label="Archive project"><Trash2 size={16} aria-hidden="true" /></button> : null}</div></div>
            {data?.capabilities.create ? <div className="projects-save-template"><input className="input" value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Template name" maxLength={120} /><button className="button secondary" type="button" onClick={() => void saveTemplate()} disabled={saving || !templateName.trim()}><ClipboardCheck size={15} aria-hidden="true" /> Save as template</button></div> : null}
            {data?.capabilities.update ? <form className="projects-detail-form" onSubmit={(event) => void saveProject(event)}><ProjectFields draft={draft} clients={data?.clients ?? []} owners={data?.assignableUsers ?? []} onChange={updateDraft} /><div className="form-actions"><button className="button" type="submit" disabled={saving || !draft.name.trim()}><Save size={16} aria-hidden="true" /> Save Plan</button></div></form> : null}

            {blockedDependencies.length ? <div className="projects-dependency-alert"><AlertTriangle size={17} aria-hidden="true" /><span>{blockedDependencies.length === 1 ? `Blocked by ${blockedDependencies[0].dependsOnProject.name}.` : `Blocked by ${blockedDependencies.length} incomplete project dependencies.`}</span></div> : null}

            <div className="projects-detail-section projects-commitments-section"><div className="projects-detail-section-heading"><CalendarRange size={17} aria-hidden="true" /><div><h3>Project commitments</h3><p>Outstanding targets, milestones, and prerequisites that need follow-through.</p></div></div>
              <div className="projects-commitment-list">{commitments.map((commitment) => <div className={`projects-commitment-row${commitment.overdue ? " overdue" : ""}`} key={commitment.id}><span>{label(commitment.kind)}</span><strong>{commitment.title}</strong><small>{commitment.overdue ? "Overdue" : commitment.note}</small><time>{formatDate(commitment.dueAt)}</time></div>)}{!commitments.length ? <span className="muted">No outstanding project commitments.</span> : null}</div>
            </div>

            <div className="projects-detail-section"><div className="projects-detail-section-heading"><ClipboardCheck size={17} aria-hidden="true" /><div><h3>Decisions and actions</h3><p>Record risk responses, operating decisions, accountability, and closure outcomes.</p></div></div>
              <div className="projects-decision-list">{selected.decisions.map((decision) => <div className="projects-decision-row" key={decision.id}><div><strong>{decision.title}</strong>{decision.description ? <span>{decision.description}</span> : null}<small>{decision.owner ? `${decision.owner.firstName} ${decision.owner.lastName}` : "Unassigned"} · Due {formatDate(decision.dueAt)}</small>{decision.resolution ? <small className="projects-decision-resolution">Outcome: {decision.resolution}</small> : null}</div>{data?.capabilities.update ? <div className="projects-decision-controls"><select className="input" value={decision.owner?.id ?? ""} onChange={(event) => void updateDecision(decision, { ownerId: event.target.value || null })} disabled={saving} aria-label={`Assign ${decision.title}`}><option value="">Unassigned</option>{(data?.assignableUsers ?? []).map((user) => <option value={user.id} key={user.id}>{user.firstName} {user.lastName}</option>)}</select><select className="input" value={decision.status} onChange={(event) => { const status = event.target.value as DecisionStatus; const resolution = decisionResolutionDrafts[decision.id] ?? decision.resolution ?? ""; if (["RESOLVED", "CANCELLED"].includes(status) && !resolution.trim()) { setError("Save a closure note before closing this decision."); return; } void updateDecision(decision, { status }); }} disabled={saving}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="RESOLVED">Resolved</option><option value="CANCELLED">Cancelled</option></select><div className="projects-decision-resolution-input"><input className="input" value={decisionResolutionDrafts[decision.id] ?? decision.resolution ?? ""} onChange={(event) => setDecisionResolutionDrafts((current) => ({ ...current, [decision.id]: event.target.value }))} placeholder="Closure note required before closing" aria-label={`Closure note for ${decision.title}`} /><button className="button secondary icon-button" type="button" onClick={() => void updateDecision(decision, { resolution: decisionResolutionDrafts[decision.id] ?? decision.resolution ?? null })} disabled={saving} title="Save closure note" aria-label={`Save closure note for ${decision.title}`}><Save size={15} aria-hidden="true" /></button></div></div> : <em>{label(decision.status)}</em>}</div>)}{!selected.decisions.length ? <span className="muted">No decisions or actions recorded.</span> : null}</div>
              {data?.capabilities.update ? <form className="projects-inline-form projects-decision-form" onSubmit={(event) => void addDecision(event)}><input className="input" value={decisionTitle} onChange={(event) => setDecisionTitle(event.target.value)} placeholder="Decision or action" /><input className="input" type="date" value={decisionDueAt} onChange={(event) => setDecisionDueAt(event.target.value)} /><select className="input" value={decisionOwnerId} onChange={(event) => setDecisionOwnerId(event.target.value)}><option value="">Unassigned</option>{(data?.assignableUsers ?? []).map((user) => <option value={user.id} key={user.id}>{user.firstName} {user.lastName}</option>)}</select><textarea className="input" value={decisionDescription} onChange={(event) => setDecisionDescription(event.target.value)} placeholder="Context or action needed (optional)" maxLength={2000} /><button className="button secondary" type="submit" disabled={saving || !decisionTitle.trim()}><Plus size={15} aria-hidden="true" /> Add action</button></form> : null}
            </div>

            <div className="projects-detail-section"><div className="projects-detail-section-heading"><Milestone size={17} aria-hidden="true" /><div><h3>Milestones</h3><p>Track the intended delivery checkpoints.</p></div></div>
              <div className="projects-milestone-list">{selected.milestones.map((milestone) => <div className="projects-milestone-row" key={milestone.id}><div><strong>{milestone.title}</strong><span>Due {formatDate(milestone.dueAt)}</span></div>{data?.capabilities.update ? <><select className="input projects-milestone-owner-select" value={milestone.assignedUser?.id ?? ""} onChange={(event) => void updateMilestone(milestone, { assignedUserId: event.target.value || null })} disabled={saving} aria-label={`Assign ${milestone.title}`}><option value="">Unassigned</option>{(data?.assignableUsers ?? []).map((user) => <option value={user.id} key={user.id}>{user.firstName} {user.lastName}</option>)}</select><select className="input" value={milestone.status} onChange={(event) => void updateMilestone(milestone, { status: event.target.value as MilestoneStatus })} disabled={saving}>{(["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "COMPLETED"] as MilestoneStatus[]).map((status) => <option value={status} key={status}>{label(status)}</option>)}</select><button className="button secondary icon-button" type="button" onClick={() => void removeMilestone(milestone.id)} disabled={saving} title="Remove milestone" aria-label={`Remove ${milestone.title}`}><Trash2 size={15} aria-hidden="true" /></button></> : <span>{label(milestone.status)}</span>}</div>)}{!selected.milestones.length ? <span className="muted">No milestones defined.</span> : null}</div>
              {data?.capabilities.update ? <form className="projects-inline-form projects-milestone-form" onSubmit={(event) => void addMilestone(event)}><input className="input" value={milestoneTitle} onChange={(event) => setMilestoneTitle(event.target.value)} placeholder="Milestone title" /><input className="input" type="date" value={milestoneDueAt} onChange={(event) => setMilestoneDueAt(event.target.value)} /><select className="input" value={milestoneAssignedUserId} onChange={(event) => setMilestoneAssignedUserId(event.target.value)}><option value="">Unassigned</option>{(data?.assignableUsers ?? []).map((user) => <option value={user.id} key={user.id}>{user.firstName} {user.lastName}</option>)}</select><button className="button secondary" type="submit" disabled={saving || !milestoneTitle.trim()}><Plus size={15} aria-hidden="true" /> Add</button></form> : null}
            </div>

            <div className="projects-detail-section"><div className="projects-detail-section-heading"><Link2 size={17} aria-hidden="true" /><div><h3>Linked operational work</h3><p>Tickets and event requests remain managed in their source modules.</p></div></div>
              <div className="projects-work-list">{selected.workItems.map((workItem) => { const ticket = workItem.ticket; const event = workItem.eventServiceRequest; const href = ticket ? `/tickets/${ticket.ticketNumber}` : `/event-services/${event?.trackingNumber}`; const reference = ticket?.ticketNumber ?? event?.trackingNumber ?? "Unknown"; const title = ticket?.subject ?? event?.eventName ?? "Unavailable work item"; return <div className="projects-work-row" key={workItem.id}><div><Link href={href}>{reference}</Link><strong>{title}</strong><span>{label(ticket?.status ?? event?.status ?? "")}</span></div>{data?.capabilities.update ? <button className="button secondary icon-button" type="button" onClick={() => void removeWorkItem(workItem.id)} disabled={saving} title="Remove linked work" aria-label={`Remove ${reference}`}><Trash2 size={15} aria-hidden="true" /></button> : null}</div>; })}{!selected.workItems.length ? <span className="muted">No linked work items.</span> : null}</div>
              {data?.capabilities.update ? <form className="projects-inline-form projects-link-form" onSubmit={(event) => void addWorkItem(event)}><select className="input" value={linkType} onChange={(event) => setLinkType(event.target.value as "TICKET" | "EVENT_SERVICE")}><option value="TICKET">Ticket</option><option value="EVENT_SERVICE">Event request</option></select><input className="input" value={linkReference} onChange={(event) => setLinkReference(event.target.value)} placeholder={linkType === "TICKET" ? "AIT-100001 or ID" : "EVT-100001 or ID"} /><button className="button secondary" type="submit" disabled={saving || !linkReference.trim()}><Plus size={15} aria-hidden="true" /> Link</button></form> : null}
            </div>

            <div className="projects-detail-section"><div className="projects-detail-section-heading"><AlertTriangle size={17} aria-hidden="true" /><div><h3>Project dependencies</h3><p>Work that must be completed before this project can close safely.</p></div></div>
              <div className="projects-dependency-list">{selected.dependencies.map((dependency) => <div className="projects-dependency-row" key={dependency.id}><div><strong>{dependency.dependsOnProject.name}</strong><span>{label(dependency.dependsOnProject.status)} · Target {formatDate(dependency.dependsOnProject.targetDate)}</span></div>{data?.capabilities.update ? <button className="button secondary icon-button" type="button" onClick={() => void removeDependency(dependency.id)} disabled={saving} title="Remove dependency" aria-label={`Remove ${dependency.dependsOnProject.name}`}><Trash2 size={15} aria-hidden="true" /></button> : null}</div>)}{!selected.dependencies.length ? <span className="muted">No project dependencies.</span> : null}</div>
              {data?.capabilities.update && availableDependencies.length ? <form className="projects-inline-form projects-dependency-form" onSubmit={(event) => void addDependency(event)}><select className="input" value={dependencyProjectId} onChange={(event) => setDependencyProjectId(event.target.value)}><option value="">Select prerequisite project</option>{availableDependencies.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select><button className="button secondary" type="submit" disabled={saving || !dependencyProjectId}><Plus size={15} aria-hidden="true" /> Add dependency</button></form> : null}
            </div>
        </section> : null}
      </>}
    </div>
  );
}

function ProjectFields({ draft, clients, owners, onChange }: { draft: ProjectDraft; clients: Array<{ id: string; name: string }>; owners: Array<{ id: string; firstName: string; lastName: string }>; onChange: (field: keyof ProjectDraft, value: string) => void }) {
  return <div className="projects-fields"><label><span>Name</span><input className="input" value={draft.name} onChange={(event) => onChange("name", event.target.value)} maxLength={180} required /></label><label><span>Client</span><select className="input" value={draft.clientId} onChange={(event) => onChange("clientId", event.target.value)}><option value="">Internal / no client</option>{clients.map((client) => <option value={client.id} key={client.id}>{client.name}</option>)}</select></label><label><span>Project owner</span><select className="input" value={draft.ownerId} onChange={(event) => onChange("ownerId", event.target.value)}><option value="">Unassigned</option>{owners.map((owner) => <option value={owner.id} key={owner.id}>{owner.firstName} {owner.lastName}</option>)}</select></label><label className="projects-field-wide"><span>Description</span><textarea className="input" value={draft.description} onChange={(event) => onChange("description", event.target.value)} maxLength={4000} /></label><label><span>Status</span><select className="input" value={draft.status} onChange={(event) => onChange("status", event.target.value)}>{(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as ProjectStatus[]).map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></label><label><span>Health</span><select className="input" value={draft.health} onChange={(event) => onChange("health", event.target.value)}>{(["ON_TRACK", "AT_RISK", "OFF_TRACK"] as ProjectHealth[]).map((health) => <option key={health} value={health}>{label(health)}</option>)}</select></label><label><span>Start date</span><input className="input" type="date" value={draft.startAt} onChange={(event) => onChange("startAt", event.target.value)} /></label><label><span>Target date</span><input className="input" type="date" value={draft.targetDate} onChange={(event) => onChange("targetDate", event.target.value)} /></label></div>;
}
