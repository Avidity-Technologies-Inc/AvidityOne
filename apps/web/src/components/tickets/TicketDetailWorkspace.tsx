"use client";
import { subscribeAccessRefresh } from "@/lib/access-refresh";
import { QcContextLink } from "@/components/qc/QcContextLink";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUp, BookOpen, CalendarClock, ChevronDown, ChevronUp, CircleHelp, Download, ExternalLink, Eye, Files, GitMerge, Info, ListChecks, MessageSquareReply, Plus, RefreshCcw, Save, Search, ShieldAlert, Sparkles, Target, Trash2, UsersRound, Video, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { apiBaseUrl, apiFetch } from "@/lib/api";
import { enhanceEmailMessageBody, splitPlainMessage } from "@/lib/message-content";
import { TicketStatusDefinition, ticketStatusDefinition, ticketStatusName, ticketStatusStyle } from "@/lib/ticket-statuses";
import { AssignableTicketUser, TicketAssigneePicker } from "./TicketAssigneePicker";
import { TicketReplyEditor } from "./TicketReplyEditor";
import { TicketActivityCloseout } from "./TicketActivityCloseout";
import { activityTypeLabel, activityModeLabel, TicketMeetingActivity, TicketMeetingCollection, TicketMeetingDrawer } from "./TicketMeetingDrawer";

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  activeTicketCount?: number;
}

interface CurrentUser extends User {
  permissions: string[];
}

interface Contact {
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
  phone: string | null;
  company: string | null;
  notes: string | null;
  isActive: boolean;
}

interface TicketMessage {
  id: string;
  direction: string;
  visibility: string;
  bodyText: string;
  sanitizedBodyHtml: string | null;
  senderEmail: string | null;
  ccEmails: string[];
  createdAt: string;
  mergedFromTicketId: string | null;
  mergedFromTicketNumber: string | null;
  mergedFromTicketSubject: string | null;
  authorUser: User | null;
  authorContact: { firstName: string; lastName: string; email: string } | null;
  attachments: TicketAttachment[];
  attachmentImportFailures: AttachmentImportFailure[];
  mailDeliveryStatus: "NOT_APPLICABLE" | "ACCEPTED" | "SKIPPED";
  mailDeliveryAttemptedAt: string | null;
  mailDeliveryAcceptedAt: string | null;
}

interface AttachmentImportFailure {
  attachmentId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  reason: string;
  rejectedAt: string;
}

interface MergedTicketReference {
  id: string;
  ticketNumber: string;
  subject: string;
  status?: string;
  mergedAt?: string | null;
}

interface MergeCandidate extends MergedTicketReference {
  status: string;
  statusDefinitionId: string | null;
  statusDefinition: TicketStatusDefinition | null;
  priority: string;
  createdAt: string;
  clientId: string | null;
  client: { id: string; name: string } | null;
  contact: { id: string; firstName: string; lastName: string; email: string } | null;
  senderEmail: string | null;
  _count: { messages: number; attachments: number };
}

interface TicketAttachment {
  id: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  isInline: boolean;
  contentId: string | null;
  scanStatus: string;
}

interface ConversationParticipant {
  id: string;
  email: string;
  displayName: string | null;
  userId: string | null;
  contactId: string | null;
  user: User | null;
  contact: Contact | null;
}

interface Ticket {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string | null;
  status: string;
  priority: string;
  targetDate: string | null;
  source: string;
  senderEmail: string | null;
  senderDomain: string | null;
  client: { id: string; name: string } | null;
  contact: { id: string; firstName: string; lastName: string; email: string } | null;
  assignedUserId: string | null;
  assignedGroupId: string | null;
  assignedTeamId: string | null;
  assignedUser: User | null;
  assignees: Array<{ user: User }>;
  externalSpecialists: Array<{ id: string; role: string | null; externalSpecialist: ExternalSpecialist }>;
  assignedGroup: Group | null;
  assignedTeam: TicketTeam | null;
  watchers: Array<{ user: User }>;
  conversationParticipants: ConversationParticipant[];
  messages: TicketMessage[];
  attachments: TicketAttachment[];
  mergedIntoTicket: MergedTicketReference | null;
  mergedTickets: MergedTicketReference[];
  mergedAt: string | null;
  mergeReason: string | null;
  reopenedAt: string | null;
  closedAt: string | null;
  createdAt: string;
}

interface TicketAiAnalysis {
  id: string;
  goal: string;
  summary: string;
  recommendedActions: string[];
  missingInformation: string[];
  risks: string[];
  contradictions?: string[];
  evidence?: string[];
  webReferences?: Array<{
    url: string;
    title: string | null;
    excerpt: string | null;
    matchedTerms: string[];
    source: "EXPLICIT_URL" | "RELATIVE_PATH" | "SITEMAP";
    status: "FOUND" | "BLOCKED" | "FAILED";
    checkedAt: string;
    confidence: number;
    reason: string | null;
  }>;
  suggestedResponse: string | null;
  responseReady?: boolean;
  confidence: number | null;
  provider?: string;
  model: string;
  createdAt: string;
  translations?: TicketAiAnalysisTranslation[];
}

interface TicketAiAnalysisTranslation {
  id: string;
  language: string;
  goal: string;
  summary: string;
  recommendedActions: string[];
  missingInformation: string[];
  contradictions: string[];
  risks: string[];
  provider?: string;
  model: string;
  createdAt: string;
}

interface TicketAiBriefResponse {
  analysis: TicketAiAnalysis | null;
  isStale: boolean;
}

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

function externalName(specialist: ExternalSpecialist) {
  return `${specialist.name}${specialist.company ? ` (${specialist.company})` : ""}`;
}

function mergeUsers(primary: User[], fallback: Array<User | null | undefined>) {
  const byId = new Map<string, User>();
  [...primary, ...fallback].forEach((user) => {
    if (user) {
      byId.set(user.id, user);
    }
  });
  return [...byId.values()].sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
}

export function TicketDetailWorkspace({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const conversationRef = useRef<HTMLDivElement>(null);
  const composerSlotRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [ccContacts, setCcContacts] = useState<Contact[]>([]);
  const [ticketTeams, setTicketTeams] = useState<TicketTeam[]>([]);
  const [ticketStatuses, setTicketStatuses] = useState<TicketStatusDefinition[]>([]);
  const [externalSpecialists, setExternalSpecialists] = useState<ExternalSpecialist[]>([]);
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>([]);
  const [assignedTeamId, setAssignedTeamId] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [externalAssignmentId, setExternalAssignmentId] = useState("");
  const [externalDraft, setExternalDraft] = useState({ name: "", email: "", phone: "", company: "" });
  const [externalCreateOpen, setExternalCreateOpen] = useState(false);
  const [meetingData, setMeetingData] = useState<TicketMeetingCollection | null>(null);
  const [meetingDrawerOpen, setMeetingDrawerOpen] = useState(false);
  const [meetingTargetId, setMeetingTargetId] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<"DETAILS" | "GOAL" | "ASSIGNMENT" | "FILES">("DETAILS");
  const [composerCollapsed, setComposerCollapsed] = useState(false);
  const [composerScrollState, setComposerScrollState] = useState<"NORMAL" | "PINNED" | "HIDDEN">("NORMAL");
  const [aiBrief, setAiBrief] = useState<TicketAiAnalysis | null>(null);
  const [aiBriefStale, setAiBriefStale] = useState(false);
  const [aiBriefLoading, setAiBriefLoading] = useState(false);
  const [aiBriefError, setAiBriefError] = useState<string | null>(null);
  const [goalLanguage, setGoalLanguage] = useState<"EN" | "ES">("EN");
  const [goalTranslationLoading, setGoalTranslationLoading] = useState(false);
  const [draftInsertRequest, setDraftInsertRequest] = useState<{ id: number; text: string } | null>(null);
  const [messageSearch, setMessageSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeCandidates, setMergeCandidates] = useState<MergeCandidate[]>([]);
  const [selectedMergeIds, setSelectedMergeIds] = useState<string[]>([]);
  const [mergeReason, setMergeReason] = useState("");
  const [mergeAllowDifferentClient, setMergeAllowDifferentClient] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeSearchBusy, setMergeSearchBusy] = useState(false);
  const [toolBusy, setToolBusy] = useState<string | null>(null);
  const [assignmentNotice, setAssignmentNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const spanishGoal = useMemo(() => aiBrief?.translations?.find((translation) => translation.language === "es") ?? null, [aiBrief]);
  const displayedAiBrief = goalLanguage === "ES" && spanishGoal
    ? { ...aiBrief!, ...spanishGoal }
    : aiBrief;
  const goalLabels = goalLanguage === "ES"
    ? {
        customerGoal: "Objetivo del cliente",
        situation: "Situación",
        recommendedActions: "Acciones recomendadas",
        missingInformation: "Información pendiente",
        contradictions: "Contradicciones",
        risks: "Riesgos"
      }
    : {
        customerGoal: "Customer goal",
        situation: "Situation",
        recommendedActions: "Recommended actions",
        missingInformation: "Missing information",
        contradictions: "Contradictions",
        risks: "Risks"
      };

  useEffect(() => {
    let mounted = true;
    const unsubscribe = subscribeAccessRefresh(() => {
      void apiFetch<{ user: CurrentUser }>("/auth/me").then(({ user }) => {
        if (mounted) setCurrentUser(user);
      }).catch(() => {});
    });
    return () => { mounted = false; unsubscribe(); };
  }, []);

  const requester = useMemo(() => {
    if (!ticket) {
      return "Unknown";
    }
    return ticket.contact ? `${ticket.contact.firstName} ${ticket.contact.lastName}` : ticket.senderEmail ?? "Unknown";
  }, [ticket]);
  const isMergedTicket = ticket?.status === "MERGED";
  const selectedMergeTickets = useMemo(() => selectedMergeIds.map((id) => mergeCandidates.find((candidate) => candidate.id === id)).filter((candidate): candidate is MergeCandidate => Boolean(candidate)), [selectedMergeIds, mergeCandidates]);
  const conversationMessages = useMemo<TicketMessage[]>(() => {
    if (!ticket || ticket.messages.length > 0 || !ticket.description?.trim()) {
      return ticket?.messages ?? [];
    }
    return [{
      id: `legacy-description-${ticket.id}`,
      direction: "INBOUND",
      visibility: "PUBLIC",
      bodyText: ticket.description,
      sanitizedBodyHtml: null,
      senderEmail: ticket.senderEmail,
      ccEmails: [],
      createdAt: ticket.createdAt,
      mergedFromTicketId: null,
      mergedFromTicketNumber: null,
      mergedFromTicketSubject: null,
      authorUser: null,
      authorContact: ticket.contact,
      attachments: [],
      attachmentImportFailures: [],
      mailDeliveryStatus: "NOT_APPLICABLE",
      mailDeliveryAttemptedAt: null,
      mailDeliveryAcceptedAt: null
    }];
  }, [ticket]);
  const displayedTimeline = useMemo(() => {
    const query = messageSearch.trim().toLowerCase();
    return [
      ...conversationMessages.map((message) => ({ kind: "MESSAGE" as const, id: message.id, createdAt: message.createdAt, message })),
      ...(meetingData?.activity ?? []).map((activity) => ({ kind: "MEETING" as const, id: activity.id, createdAt: activity.createdAt, activity }))
    ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()).filter((item) => {
      if (!query) return true;
      if (item.kind === "MEETING") return `${item.activity.action} ${item.activity.metadata?.title ?? ""} ${item.activity.metadata?.error ?? ""}`.toLowerCase().includes(query);
      const message = item.message;
      const author = message.authorUser ? `${message.authorUser.firstName} ${message.authorUser.lastName}` : message.authorContact ? `${message.authorContact.firstName} ${message.authorContact.lastName}` : message.senderEmail ?? "";
      return `${author} ${message.bodyText} ${message.ccEmails.join(" ")}`.toLowerCase().includes(query);
    });
  }, [conversationMessages, meetingData?.activity, messageSearch]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const ticketData = await apiFetch<Ticket>(`/tickets/${ticketId}`);
      setTicket(ticketData);
      if (ticketData.ticketNumber && ticketId !== ticketData.ticketNumber) {
        router.replace(`/tickets/${ticketData.ticketNumber}`);
      }
      const [userData, teamData, externalData, statusData, authData] = await Promise.all([
        apiFetch<AssignableTicketUser[]>("/tickets/assignment-options").catch(() => []),
        apiFetch<TicketTeam[]>("/ticket-teams").catch(() => []),
        apiFetch<ExternalSpecialist[]>("/external-specialists").catch(() => []),
        apiFetch<TicketStatusDefinition[]>("/ticket-workflow/statuses").catch(() => []),
        apiFetch<{ user: CurrentUser }>("/auth/me")
      ]);
      setUsers(mergeUsers(userData, [
        ticketData.assignedUser,
        ...(ticketData.assignees ?? []).map((assignment) => assignment.user),
        ...(ticketData.watchers ?? []).map((watcher) => watcher.user),
        ...(ticketData.conversationParticipants ?? []).map((participant) => participant.user)
      ]));
      setTicketTeams(teamData);
      setTicketStatuses(statusData);
      setExternalSpecialists(externalData);
      setCurrentUser(authData.user);
      if (authData.user.permissions.includes("ticket_meetings.view")) {
        setMeetingData(await apiFetch<TicketMeetingCollection>(`/tickets/${ticketData.ticketNumber}/meetings`).catch(() => null));
      } else {
        setMeetingData(null);
      }
      void loadAiBrief(ticketData.ticketNumber, authData.user);
      if (ticketData.client?.id) {
        try {
          setCcContacts(await apiFetch<Contact[]>(`/clients/${ticketData.client.id}/contacts`));
        } catch {
          setCcContacts(ticketData.contact ? [ticketData.contact] : []);
        }
      } else {
        setCcContacts(ticketData.contact ? [ticketData.contact] : []);
      }
      setAssignedUserIds(ticketData.assignees?.length ? ticketData.assignees.map((assignment) => assignment.user.id) : ticketData.assignedUserId ? [ticketData.assignedUserId] : []);
      setAssignedTeamId(ticketData.assignedTeamId ?? "");
      setTargetDate(ticketData.targetDate ? ticketData.targetDate.slice(0, 10) : "");
    } catch {
      setError("Unable to load ticket.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMeetings() {
    if (!ticket?.ticketNumber || !currentUser?.permissions.includes("ticket_meetings.view")) return;
    setMeetingData(await apiFetch<TicketMeetingCollection>(`/tickets/${ticket.ticketNumber}/meetings`));
  }

  async function loadAiBrief(ticketRef: string, user: CurrentUser) {
    if (!user.permissions.includes("ai_assistant.use") || !user.permissions.includes("tickets.view")) {
      setAiBrief(null);
      setAiBriefStale(false);
      return;
    }

    setAiBriefLoading(true);
    setAiBriefError(null);
    setGoalLanguage("EN");
    try {
      const result = await apiFetch<TicketAiBriefResponse>(`/tickets/${ticketRef}/ai/brief`);
      setAiBrief(result.analysis);
      setAiBriefStale(result.isStale);
    } catch (cause) {
      setAiBriefError(cause instanceof Error ? cause.message : "Unable to load AI ticket goal.");
    } finally {
      setAiBriefLoading(false);
    }
  }

  async function generateAiBrief() {
    if (!ticket) return;
    setAiBriefLoading(true);
    setAiBriefError(null);
    setSideTab("GOAL");
    setGoalLanguage("EN");
    try {
      const result = await apiFetch<TicketAiBriefResponse>(`/tickets/${ticket.ticketNumber}/ai/brief`, { method: "POST" });
      setAiBrief(result.analysis);
      setAiBriefStale(false);
    } catch (cause) {
      setAiBriefError(cause instanceof Error ? cause.message : "Unable to analyze this ticket.");
    } finally {
      setAiBriefLoading(false);
    }
  }

  async function changeGoalLanguage(language: "EN" | "ES") {
    if (language === "EN") {
      setGoalLanguage("EN");
      return;
    }
    if (!ticket || !aiBrief || goalTranslationLoading) return;
    if (spanishGoal) {
      setGoalLanguage("ES");
      return;
    }

    setGoalTranslationLoading(true);
    setAiBriefError(null);
    try {
      const translation = await apiFetch<TicketAiAnalysisTranslation>(`/tickets/${ticket.ticketNumber}/ai/brief/${aiBrief.id}/translations`, {
        method: "POST",
        body: JSON.stringify({ language: "es" })
      });
      setAiBrief((current) => current ? {
        ...current,
        translations: [...(current.translations ?? []).filter((item) => item.language !== translation.language), translation]
      } : current);
      setGoalLanguage("ES");
    } catch (cause) {
      setAiBriefError(cause instanceof Error ? cause.message : "Unable to translate this ticket goal.");
    } finally {
      setGoalTranslationLoading(false);
    }
  }

  function insertAiDraft(text: string) {
    setComposerCollapsed(false);
    setComposerScrollState("PINNED");
    setDraftInsertRequest({ id: Date.now(), text });
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>(".ticket-composer-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function saveAssignment(nextUserIds: string[], nextTeamId: string) {
    const previousUserIds = assignedUserIds;
    const previousTeamId = assignedTeamId;
    setAssignedUserIds(nextUserIds);
    setAssignedTeamId(nextTeamId);
    setAssignmentBusy(true);
    setAssignmentNotice(null);
    setError(null);
    try {
      await apiFetch(`/tickets/${ticketId}/assignment`, {
        method: "PATCH",
        body: JSON.stringify({
          assignedUserId: nextUserIds[0] ?? null,
          assignedUserIds: nextUserIds,
          assignedTeamId: nextTeamId || null
        })
      });
      setTicket((current) => {
        if (!current) {
          return current;
        }
        const assignedUsers = users.filter((user) => nextUserIds.includes(user.id));
        const assignedTeam = ticketTeams.find((team) => team.id === nextTeamId) ?? null;

        return {
          ...current,
          assignedUserId: assignedUsers[0]?.id ?? null,
          assignedUser: assignedUsers[0] ?? null,
          assignedTeamId: assignedTeam?.id ?? null,
          assignedTeam,
          assignees: assignedUsers.map((user) => ({ user }))
        };
      });
      setAssignmentNotice("Assignment saved.");
    } catch {
      setAssignedUserIds(previousUserIds);
      setAssignedTeamId(previousTeamId);
      setError("Unable to save assignment.");
    } finally {
      setAssignmentBusy(false);
    }
  }

  async function savePlanning(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setAssignmentNotice(null);
    setError(null);
    try {
      const updated = await apiFetch<Ticket>(`/tickets/${ticketId}/planning`, {
        method: "PATCH",
        body: JSON.stringify({ targetDate: targetDate || null })
      });
      setTicket((current) => current ? { ...current, targetDate: updated.targetDate } : current);
      setAssignmentNotice("Target date saved.");
    } catch {
      setError("Unable to save ticket planning date.");
    } finally {
      setSaving(false);
    }
  }

  async function updateTicketState(update: { status?: string; statusDefinitionId?: string; priority?: string }) {
    setToolBusy("STATE");
    setAssignmentNotice(null);
    setError(null);
    try {
      const updated = await apiFetch<Ticket>(`/tickets/${ticketId}/state`, { method: "PATCH", body: JSON.stringify(update) });
      setTicket(updated);
      setAssignmentNotice(update.status || update.statusDefinitionId ? "Status updated." : "Priority updated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update ticket.");
    } finally {
      setToolBusy(null);
    }
  }

  function scrollConversation(position: "TOP" | "BOTTOM") {
    const element = conversationRef.current;
    if (!element) return;
    const messages = element.querySelectorAll<HTMLElement>(".message");
    const target = position === "TOP" ? messages.item(0) : messages.item(messages.length - 1);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function createExternalSpecialist() {
    if (!externalDraft.name.trim() || !externalDraft.email.trim()) return;
    setToolBusy("external-create");
    setAssignmentNotice(null);
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
      setAssignmentNotice("External specialist added.");
    } catch {
      setError("Unable to add external specialist.");
    } finally {
      setToolBusy(null);
    }
  }

  async function addExternalToTicket() {
    if (!ticket || !externalAssignmentId) return;
    setToolBusy("external-assign");
    setAssignmentNotice(null);
    setError(null);
    try {
      const updated = await apiFetch<Ticket>(`/tickets/${ticketId}/external-specialists`, {
        method: "POST",
        body: JSON.stringify({ externalSpecialistId: externalAssignmentId })
      });
      setTicket(updated);
      setExternalAssignmentId("");
      setAssignmentNotice("External specialist assigned.");
    } catch {
      setError("Unable to assign external specialist.");
    } finally {
      setToolBusy(null);
    }
  }

  async function removeExternalFromTicket(assignmentId: string) {
    setToolBusy(`external-remove-${assignmentId}`);
    setAssignmentNotice(null);
    setError(null);
    try {
      const updated = await apiFetch<Ticket>(`/tickets/${ticketId}/external-specialists/${assignmentId}`, { method: "DELETE" });
      setTicket(updated);
      setAssignmentNotice("External specialist removed.");
    } catch {
      setError("Unable to remove external specialist.");
    } finally {
      setToolBusy(null);
    }
  }

  async function removeConversationParticipant(participantId: string) {
    setToolBusy(`participant-remove-${participantId}`);
    setAssignmentNotice(null);
    setError(null);
    try {
      const updated = await apiFetch<Ticket>(`/tickets/${ticketId}/conversation-participants/${participantId}`, { method: "DELETE" });
      setTicket(updated);
      setAssignmentNotice("Conversation participant removed.");
    } catch {
      setError("Unable to remove conversation participant.");
    } finally {
      setToolBusy(null);
    }
  }

  async function clearConversationParticipants() {
    if (!window.confirm("Remove all persistent CC recipients from future public replies?")) return;
    setToolBusy("participants-clear");
    setAssignmentNotice(null);
    setError(null);
    try {
      const updated = await apiFetch<Ticket>(`/tickets/${ticketId}/conversation-participants`, { method: "DELETE" });
      setTicket(updated);
      setAssignmentNotice("Conversation participants cleared.");
    } catch {
      setError("Unable to clear conversation participants.");
    } finally {
      setToolBusy(null);
    }
  }

  function toggleMergeCandidate(ticketId: string) {
    setSelectedMergeIds((current) => (current.includes(ticketId) ? current.filter((id) => id !== ticketId) : [...current, ticketId]));
  }

  function openMergeModal() {
    setMergeSearch("");
    setMergeCandidates([]);
    setSelectedMergeIds([]);
    setMergeReason("");
    setMergeAllowDifferentClient(false);
    setShowMergeModal(true);
  }

  async function loadMergeCandidates(searchValue = mergeSearch) {
    if (!searchValue.trim()) {
      setMergeCandidates([]);
      return;
    }

    setMergeSearchBusy(true);
    setError(null);
    try {
      const candidates = await apiFetch<MergeCandidate[]>(`/tickets/${ticketId}/merge-candidates?search=${encodeURIComponent(searchValue.trim())}`);
      setMergeCandidates(candidates);
      setSelectedMergeIds((current) => current.filter((id) => candidates.some((candidate) => candidate.id === id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to search merge candidates.");
    } finally {
      setMergeSearchBusy(false);
    }
  }

  async function mergeTickets() {
    if (selectedMergeIds.length === 0) {
      setError("Choose at least one ticket to merge into this ticket.");
      return;
    }

    setMergeBusy(true);
    setError(null);
    try {
      const updatedTicket = await apiFetch<Ticket>(`/tickets/${ticketId}/merge`, {
        method: "POST",
        body: JSON.stringify({
          sourceTicketIds: selectedMergeIds,
          reason: mergeReason.trim() || undefined,
          allowDifferentClient: mergeAllowDifferentClient
        })
      });
      setTicket(updatedTicket);
      setShowMergeModal(false);
      setSelectedMergeIds([]);
      setMergeCandidates([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to merge tickets.");
    } finally {
      setMergeBusy(false);
    }
  }

  async function blockSender(type: "EMAIL" | "DOMAIN") {
    if (!ticket) {
      return;
    }
    const value = type === "EMAIL" ? ticket.senderEmail : ticket.senderDomain;
    if (!value) {
      setError(type === "EMAIL" ? "This ticket does not have a sender email." : "This ticket does not have a sender domain.");
      return;
    }
    if (!window.confirm(`Block ${value} from creating new email tickets?`)) {
      return;
    }

    setToolBusy(type);
    setError(null);
    try {
      await apiFetch("/spam-blocklist", {
        method: "POST",
        body: JSON.stringify({
          type,
          value,
          notes: `Blocked from ticket ${ticket.ticketNumber}`
        })
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create spam block entry.");
    } finally {
      setToolBusy(null);
    }
  }

  async function createKnowledgeArticleDraft() {
    if (!ticket) {
      return;
    }
    setToolBusy("KB");
    setError(null);
    try {
      const article = await apiFetch<{ id: string }>(`/knowledge-base/articles/from-ticket/${ticket.ticketNumber}`, { method: "POST" });
      router.push(`/knowledge-base?articleId=${article.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create a Knowledge Base draft.");
    } finally {
      setToolBusy(null);
    }
  }

  async function deleteCurrentTicket() {
    if (!ticket || !window.confirm(`Move ticket ${ticket.ticketNumber} to the recycle bin?`)) {
      return;
    }

    setToolBusy("DELETE");
    setError(null);
    try {
      await apiFetch("/tickets/bulk/delete", {
        method: "POST",
        body: JSON.stringify({ ticketIds: [ticket.id] })
      });
      router.push("/tickets");
    } catch {
      setError("Unable to move ticket to recycle bin.");
    } finally {
      setToolBusy(null);
    }
  }

  useEffect(() => {
    void load();
  }, [ticketId]);

  useEffect(() => {
    if (!showMergeModal || mergeSearch.trim().length < 2) {
      setMergeCandidates([]);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadMergeCandidates(mergeSearch);
    }, 300);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMergeModal, mergeSearch]);

  useEffect(() => {
    if (!composerRef.current || !composerSlotRef.current) return;
    const desktopQuery = window.matchMedia("(min-width: 1101px)");
    let lastScrollY = window.scrollY;
    let accumulatedDistance = 0;
    let direction = 0;
    let frameId: number | null = null;

    const syncFloatingGeometry = () => {
      const composer = composerRef.current;
      const slot = composerSlotRef.current;
      if (!composer || !slot) return;

      const slotRect = slot.getBoundingClientRect();
      slot.style.setProperty("--ticket-composer-left", `${slotRect.left}px`);
      slot.style.setProperty("--ticket-composer-width", `${slotRect.width}px`);
      // Reserve the normal-flow height; resizing a floating panel must not move the timeline.
      if (!desktopQuery.matches || composer.classList.contains("scroll-normal")) {
        slot.style.setProperty("--ticket-composer-height", `${composer.offsetHeight}px`);
      }
      // Keep the action bar inside the viewport in both normal and floating states.
      slot.style.setProperty("--ticket-composer-available-height", `${Math.max(240, window.innerHeight - Math.max(8, slotRect.top) - 8)}px`);
    };

    const updateComposerPosition = () => {
      frameId = null;
      const composer = composerRef.current;
      const slot = composerSlotRef.current;
      const currentScrollY = window.scrollY;
      const delta = currentScrollY - lastScrollY;
      lastScrollY = currentScrollY;

      if (!desktopQuery.matches || !composer || !slot) {
        accumulatedDistance = 0;
        direction = 0;
        setComposerScrollState("NORMAL");
        return;
      }

      syncFloatingGeometry();
      if (slot.getBoundingClientRect().top >= 8) {
        accumulatedDistance = 0;
        direction = 0;
        setComposerScrollState("NORMAL");
        return;
      }

      if (composer.contains(document.activeElement)) {
        accumulatedDistance = 0;
        setComposerScrollState("PINNED");
        return;
      }

      const nextDirection = Math.sign(delta);
      if (nextDirection === 0) return;
      if (nextDirection !== direction) {
        direction = nextDirection;
        accumulatedDistance = 0;
      }
      accumulatedDistance += Math.abs(delta);

      if (accumulatedDistance >= 24) {
        setComposerScrollState(direction > 0 ? "HIDDEN" : "PINNED");
        accumulatedDistance = 0;
      }
    };

    const handleScroll = () => {
      if (frameId === null) frameId = window.requestAnimationFrame(updateComposerPosition);
    };
    const handleViewportChange = () => {
      lastScrollY = window.scrollY;
      syncFloatingGeometry();
      updateComposerPosition();
    };

    const resizeObserver = new ResizeObserver(syncFloatingGeometry);
    if (composerRef.current) resizeObserver.observe(composerRef.current);
    syncFloatingGeometry();

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleViewportChange);
    desktopQuery.addEventListener("change", handleViewportChange);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleViewportChange);
      desktopQuery.removeEventListener("change", handleViewportChange);
      resizeObserver.disconnect();
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, [loading, currentUser?.permissions, ticket?.status]);

  if (loading) {
    return <div className="panel ticket-detail-loading">Loading ticket...</div>;
  }

  if (!ticket) {
    return <div className="error-banner">{error ?? "Ticket was not found."}</div>;
  }
  const realAttachments = ticket.attachments.filter((attachment) => !isInlineEmailAsset(attachment));
  const inlineAttachments = ticket.attachments.filter((attachment) => isInlineEmailAsset(attachment));
  const uniqueInlineAttachments = dedupeInlineAttachments(inlineAttachments);
  const downloadableAttachmentCount = ticket.attachments.filter((attachment) => attachment.scanStatus !== "BLOCKED" && attachment.scanStatus !== "SUSPICIOUS").length;
  const attachmentImportFailures = ticket.messages.flatMap((message) => message.attachmentImportFailures ?? []);
  const nextScheduledActivity = meetingData?.meetings
    .filter(item => item.status === "SCHEDULED" && new Date(item.endAt) > new Date())
    .sort((a, b) => a.startAt.localeCompare(b.startAt))[0];
  const ticketRef = ticket.ticketNumber;
  const downloadAllUrl = `${apiBaseUrl}/tickets/${ticketRef}/attachments/download-all`;
  const clientLabel = ticket.client?.name ?? (ticket.senderDomain ? `Unmapped: ${ticket.senderDomain}` : "Unassigned");
  const permissionSet = new Set(currentUser?.permissions ?? []);
  const canUpdate = permissionSet.has("tickets.update");
  const canAssign = permissionSet.has("tickets.assign");
  const canUseAi = permissionSet.has("ai_assistant.use") && permissionSet.has("tickets.view");
  const canReply = permissionSet.has("tickets.reply");
  const canChangeStatus = canUpdate || permissionSet.has("tickets.close") || permissionSet.has("tickets.reopen");
  const currentStatusDefinition = ticketStatusDefinition(ticket, ticketStatuses);
  const selectableStatusCatalog = currentStatusDefinition && !ticketStatuses.some((status) => status.id === currentStatusDefinition.id)
    ? [...ticketStatuses, currentStatusDefinition]
    : ticketStatuses;
  const statusOptions = selectableStatusCatalog.filter((status) =>
    (status.isActive || status.id === currentStatusDefinition?.id)
    && status.systemStatus !== "MERGED"
    && (status.id === currentStatusDefinition?.id || (status.systemStatus === "CLOSED" ? permissionSet.has("tickets.close") : status.systemStatus === "REOPENED" ? permissionSet.has("tickets.reopen") : canUpdate))
  );

  return (
    <>
      <header className="ticket-detail-header">
        <div className="ticket-detail-title-block">
          <Link className="ticket-detail-back-link" href="/tickets">
            <ArrowLeft size={15} aria-hidden="true" />
            <span>Tickets</span>
          </Link>
          <div className="ticket-detail-title-row">
            <h1>#{ticket.ticketNumber}</h1>
            {canChangeStatus && !isMergedTicket && statusOptions.length ? <select className="ticket-header-select ticket-header-status" style={ticketStatusStyle(ticket, ticketStatuses)} value={currentStatusDefinition?.id ?? ""} onChange={(event) => void updateTicketState({ statusDefinitionId: event.target.value })} disabled={toolBusy === "STATE"} aria-label="Ticket status">
              {statusOptions.map((status) => <option value={status.id} key={status.id}>{status.name}</option>)}
            </select> : <span className={`status-pill ${statusClass(ticket.status)}`} style={ticketStatusStyle(ticket, ticketStatuses)}>{ticketStatusName(ticket, ticketStatuses)}</span>}
          </div>
          <p className="ticket-detail-subject">{ticket.subject}</p>
          <div className="ticket-detail-meta-row">
            <span>{clientLabel}</span>
            <span>{requester}</span>
            <span>{label(ticket.source)}</span>
            {canUpdate && !isMergedTicket ? <select className={`ticket-header-select ticket-header-priority ${priorityClass(ticket.priority)}`} value={ticket.priority} onChange={(event) => void updateTicketState({ priority: event.target.value })} disabled={toolBusy === "STATE"} aria-label="Ticket priority">
              {["LOW", "NORMAL", "HIGH", "URGENT", "CRITICAL"].map((priority) => <option value={priority} key={priority}>{label(priority)}</option>)}
            </select> : <span className={`status-pill ticket-header-priority ${priorityClass(ticket.priority)}`}>{label(ticket.priority)}</span>}
            {ticket.reopenedAt && !ticket.closedAt ? <span className="ticket-reopened-badge" title={new Date(ticket.reopenedAt).toLocaleString()}>Reopened {new Date(ticket.reopenedAt).toLocaleDateString()}</span> : null}
          </div>
        </div>
        {canUseAi ? (
          <button className="ticket-header-goal" type="button" onClick={() => setSideTab("GOAL")}>
            <span><Target size={14} aria-hidden="true" /> Goal {aiBriefStale ? <em>Update available</em> : null}</span>
            <strong>{displayedAiBrief?.goal ?? (aiBriefLoading ? "Analyzing ticket context..." : "Generate a concise objective and next steps")}</strong>
            {displayedAiBrief ? <small>{displayedAiBrief.recommendedActions[0] ?? displayedAiBrief.summary}</small> : null}
          </button>
        ) : null}
        <div className="form-actions ticket-detail-actions">
          <button className="button secondary icon-button" type="button" onClick={load} title="Refresh ticket" aria-label="Refresh ticket"><RefreshCcw size={15} aria-hidden="true" /></button>
          <button className="button secondary icon-button" type="button" onClick={() => { setComposerCollapsed(false); setComposerScrollState("PINNED"); composerRef.current?.focus(); }} title="Open reply composer" aria-label="Open reply composer">
            <MessageSquareReply size={16} aria-hidden="true" />
          </button>
        </div>
      </header>
      {error ? <div className="error-banner">{error}</div> : null}
      {isMergedTicket ? (
        <div className="info-banner">
          This ticket was merged{ticket.mergedIntoTicket ? " into " : "."}
          {ticket.mergedIntoTicket ? (
            <>
              {" "}
              <Link href={`/tickets/${ticket.mergedIntoTicket.ticketNumber}`}>{ticket.mergedIntoTicket.ticketNumber}</Link>. Replies should be sent from the primary ticket.
            </>
          ) : null}
        </div>
      ) : null}
      {ticket.status === "CLOSED" && meetingData && <TicketActivityCloseout ticketId={ticketRef} meetings={meetingData.meetings} permissions={permissionSet} onChanged={loadMeetings} onOpen={id => { setMeetingTargetId(id); setMeetingDrawerOpen(true); }} />}
      {ticket.status !== "CLOSED" && nextScheduledActivity && <div className="panel ticket-activity-plan-summary">
        <CalendarClock size={16} /><span>Next activity: <button type="button" onClick={() => { setMeetingTargetId(nextScheduledActivity.id); setMeetingDrawerOpen(true); }}>
          {nextScheduledActivity.title} · {new Intl.DateTimeFormat(undefined, { timeZone: nextScheduledActivity.timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(nextScheduledActivity.startAt))} ({nextScheduledActivity.timeZone})
        </button></span>
      </div>}
      <section className="ticket-detail-layout">
        <div className="ticket-main-workspace">
          {!isMergedTicket ? (
            <div className="ticket-composer-slot" ref={composerSlotRef}>
              <div className={`panel ticket-composer-panel${composerCollapsed ? " collapsed" : ""} ${composerScrollState === "HIDDEN" ? "scroll-hidden" : composerScrollState === "PINNED" ? "scroll-pinned" : "scroll-normal"}`} ref={composerRef} tabIndex={-1}>
                <div className="ticket-composer-heading"><div><MessageSquareReply size={16} aria-hidden="true" /><h2>Reply Composer</h2></div><button className="button secondary icon-button" type="button" onClick={() => setComposerCollapsed((current) => !current)} title={composerCollapsed ? "Expand composer" : "Collapse composer"} aria-label={composerCollapsed ? "Expand composer" : "Collapse composer"}>{composerCollapsed ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronUp size={15} aria-hidden="true" />}</button></div>
                <TicketReplyEditor ticketId={ticketRef} ccUsers={users} ccContacts={ccContacts} conversationParticipants={ticket.conversationParticipants ?? []} insertRequest={draftInsertRequest} onSaved={load} />
              </div>
            </div>
          ) : null}
          <div className="panel ticket-conversation-panel">
            <div className="ticket-conversation-heading">
              <div><h2>Ticket Timeline</h2><span>{displayedTimeline.length} of {conversationMessages.length + (meetingData?.activity.length ?? 0)}</span></div>
              <div className="ticket-conversation-controls">
                <label><Search size={14} aria-hidden="true" /><input value={messageSearch} onChange={(event) => setMessageSearch(event.target.value)} placeholder="Search conversation" aria-label="Search conversation" /></label>
                <button className="button secondary icon-button" type="button" onClick={() => scrollConversation("TOP")} title="Newest message" aria-label="Go to newest message"><ArrowUp size={14} aria-hidden="true" /></button>
                <button className="button secondary icon-button" type="button" onClick={() => scrollConversation("BOTTOM")} title="Oldest message" aria-label="Go to oldest message"><ArrowDown size={14} aria-hidden="true" /></button>
              </div>
            </div>
            <div className="ticket-conversation-scroll" ref={conversationRef}>
              <div className="timeline ticket-timeline">
              {conversationMessages.length === 0 && !meetingData?.activity.length ? <p className="ticket-detail-empty">No ticket activity yet.</p> : null}
              {conversationMessages.length + (meetingData?.activity.length ?? 0) > 0 && displayedTimeline.length === 0 ? <p className="ticket-detail-empty">No timeline items match this search.</p> : null}
              {displayedTimeline.map((item) => {
                if (item.kind === "MEETING") {
                  return <TicketMeetingActivityCard activity={item.activity} key={item.id} onOpen={() => { setMeetingTargetId(item.activity.metadata?.meetingId ?? null); setMeetingDrawerOpen(true); }} />;
                }
                const message = item.message;
                return (
                <article className={`message ${message.direction === "INBOUND" ? "inbound" : "outbound"} ${message.visibility === "INTERNAL" ? "internal" : ""}`} key={message.id}>
                  <header className="message-header">
                    <div className="message-author-block">
                      <strong>
                        {message.direction === "INBOUND"
                          ? message.authorContact
                            ? `${message.authorContact.firstName} ${message.authorContact.lastName}`
                            : message.senderEmail ?? "Customer"
                          : message.authorUser
                            ? `${message.authorUser.firstName} ${message.authorUser.lastName}`
                            : "Technician"}
                      </strong>
                      <span className="muted">{label(message.direction)} - {label(message.visibility)}</span>
                      {message.direction === "OUTBOUND" && message.visibility === "PUBLIC" ? (
                        <span className={`ticket-mail-delivery ${message.mailDeliveryStatus.toLowerCase()}`}>
                          {message.mailDeliveryStatus === "ACCEPTED" ? "Email accepted" : message.mailDeliveryStatus === "SKIPPED" ? "Email not sent" : "Saved"}
                        </span>
                      ) : null}
                    </div>
                    <span className="muted">{new Date(message.createdAt).toLocaleString()}</span>
                  </header>
                  {message.mergedFromTicketNumber ? (
                    <div className="merge-origin-badge">
                      <GitMerge size={14} aria-hidden="true" />
                      <span>
                        Merged from {message.mergedFromTicketNumber}
                        {message.mergedFromTicketSubject ? ` - ${message.mergedFromTicketSubject}` : ""}
                      </span>
                    </div>
                  ) : null}
                  {message.ccEmails.length ? (
                    <div className="message-cc-list">
                      <strong>CC</strong>
                      <span>{message.ccEmails.join(", ")}</span>
                    </div>
                  ) : null}
                  {message.sanitizedBodyHtml ? (
                    <CollapsibleMessageBody html={renderMessageHtml(ticketRef, message.sanitizedBodyHtml, mergeAttachments(message.attachments, ticket.attachments))} />
                  ) : (
                    <CollapsiblePlainTextBody text={message.bodyText} />
                  )}
                  <MessageAttachments
                    ticketId={ticketRef}
                    attachments={message.attachments.filter((attachment) => !isInlineEmailAsset(attachment))}
                    variant="message"
                  />
                </article>
                );
              })}
              </div>
            </div>
          </div>
        </div>
        <aside className="ticket-side-panel">
          <div className="panel ticket-rail-panel">
            <div className="ticket-tools-heading"><h3>Ticket Tools</h3>{permissionSet.has("tickets.delete") ? <button className="button danger icon-button" type="button" onClick={() => void deleteCurrentTicket()} disabled={toolBusy === "DELETE"} title="Delete ticket" aria-label="Delete ticket"><Trash2 size={14} aria-hidden="true" /></button> : null}</div>
            <div className="ticket-tools-grid">
              <QcContextLink permissions={currentUser?.permissions} href={`/qc/reviews?ticketId=${ticket.id}`} label="QC reviews" title="View quality reviews and request an inspection for this ticket" />
              {permissionSet.has("ticket_meetings.view") ? <button className="button secondary" type="button" onClick={() => { setMeetingTargetId(null); setMeetingDrawerOpen(true); }} disabled={!meetingData} title="Schedule work, service visits, and meetings"><CalendarClock size={14} aria-hidden="true" /><span>Activities{meetingData?.meetings.length ? ` (${meetingData.meetings.length})` : ""}</span></button> : null}
              {permissionSet.has("tickets.merge") ? <button className="button secondary" type="button" onClick={openMergeModal} disabled={isMergedTicket} title="Merge tickets"><GitMerge size={14} aria-hidden="true" /><span>Merge</span></button> : null}
              {permissionSet.has("knowledge_base.create") ? <button className="button secondary" type="button" onClick={() => void createKnowledgeArticleDraft()} disabled={toolBusy === "KB"} title="Create Knowledge Base draft"><BookOpen size={14} aria-hidden="true" /><span>KB Draft</span></button> : null}
              {permissionSet.has("spam.manage") ? <button className="button secondary" type="button" onClick={() => blockSender("EMAIL")} disabled={!ticket.senderEmail || toolBusy === "EMAIL"} title="Block sender"><X size={14} aria-hidden="true" /><span>Sender</span></button> : null}
              {permissionSet.has("spam.manage") ? <button className="button secondary" type="button" onClick={() => blockSender("DOMAIN")} disabled={!ticket.senderDomain || toolBusy === "DOMAIN"} title="Block domain"><X size={14} aria-hidden="true" /><span>Domain</span></button> : null}
            </div>
            <div className={`ticket-rail-tabs${canUseAi ? " has-goal" : ""}`} role="tablist" aria-label="Ticket workspace panels">
              <button className={sideTab === "DETAILS" ? "active" : ""} type="button" role="tab" aria-selected={sideTab === "DETAILS"} onClick={() => setSideTab("DETAILS")}><Info size={14} aria-hidden="true" /> Details</button>
              {canUseAi ? <button className={sideTab === "GOAL" ? "active" : ""} type="button" role="tab" aria-selected={sideTab === "GOAL"} onClick={() => setSideTab("GOAL")}><Target size={14} aria-hidden="true" /> Goal</button> : null}
              <button className={sideTab === "ASSIGNMENT" ? "active" : ""} type="button" role="tab" aria-selected={sideTab === "ASSIGNMENT"} onClick={() => setSideTab("ASSIGNMENT")}><UsersRound size={14} aria-hidden="true" /> Assignment</button>
              <button className={sideTab === "FILES" ? "active" : ""} type="button" role="tab" aria-selected={sideTab === "FILES"} onClick={() => setSideTab("FILES")}><Files size={14} aria-hidden="true" /> Files</button>
            </div>
            <div className="ticket-rail-content">
            {assignmentNotice ? <span className="ticket-operation-notice">{assignmentNotice}</span> : null}
            {sideTab === "DETAILS" ? <div className="ticket-rail-section">
            <h3>Ticket Details</h3>
            <dl className="detail-list">
              <div><dt>Status</dt><dd>
                {canChangeStatus && !isMergedTicket && statusOptions.length ? <select className="ticket-detail-state-select" style={ticketStatusStyle(ticket, ticketStatuses)} value={currentStatusDefinition?.id ?? ""} onChange={(event) => void updateTicketState({ statusDefinitionId: event.target.value })} disabled={toolBusy === "STATE"} aria-label="Ticket details status">
                  {statusOptions.map((status) => <option value={status.id} key={status.id}>{status.name}</option>)}
                </select> : <span className={`status-pill ${statusClass(ticket.status)}`} style={ticketStatusStyle(ticket, ticketStatuses)}>{ticketStatusName(ticket, ticketStatuses)}</span>}
              </dd></div>
              <div><dt>Priority</dt><dd>
                {canUpdate && !isMergedTicket ? <select className={`ticket-detail-state-select ${priorityClass(ticket.priority)}`} value={ticket.priority} onChange={(event) => void updateTicketState({ priority: event.target.value })} disabled={toolBusy === "STATE"} aria-label="Ticket details priority">
                  {["LOW", "NORMAL", "HIGH", "URGENT", "CRITICAL"].map((priority) => <option value={priority} key={priority}>{label(priority)}</option>)}
                </select> : label(ticket.priority)}
              </dd></div>
              <div><dt>Target date</dt><dd>{ticket.targetDate ? new Date(ticket.targetDate).toLocaleDateString() : "Not planned"}</dd></div>
              <div><dt>Source</dt><dd>{label(ticket.source)}</dd></div>
              <div><dt>Sender</dt><dd className="ticket-detail-email" title={ticket.senderEmail ?? undefined}>{ticket.senderEmail ?? "Not set"}</dd></div>
              <div><dt>Inline images</dt><dd>{inlineAttachments.length}</dd></div>
              <div><dt>Files</dt><dd>{realAttachments.length}</dd></div>
              {ticket.reopenedAt && !ticket.closedAt ? <div><dt>Reopened</dt><dd>{new Date(ticket.reopenedAt).toLocaleString()}</dd></div> : null}
              {ticket.mergedAt ? <div><dt>Merged</dt><dd>{new Date(ticket.mergedAt).toLocaleString()}</dd></div> : null}
            </dl>
          {canUpdate ? <form className="ticket-planning-form" onSubmit={savePlanning}>
            <h3>Operational planning</h3>
            <label className="field">
              <span>Target date</span>
              <input className="input" type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} />
            </label>
            <button className="button secondary compact-button" type="submit" disabled={saving}>
              <Save size={14} aria-hidden="true" /><span>Save date</span>
            </button>
          </form> : null}
          {isMergedTicket && ticket.mergedIntoTicket ? <Link className="button secondary ticket-primary-link" href={`/tickets/${ticket.mergedIntoTicket.ticketNumber}`}><ExternalLink size={14} aria-hidden="true" /> Open Primary</Link> : null}
          {ticket.mergedTickets.length > 0 ? (
            <div className="ticket-merged-panel">
              <h3>Merged Tickets</h3>
              <div className="merge-reference-list">
                {ticket.mergedTickets.map((mergedTicket) => (
                  <Link className="merge-reference-card" href={`/tickets/${mergedTicket.ticketNumber}`} key={mergedTicket.id}>
                    <strong>{mergedTicket.ticketNumber}</strong>
                    <span>{mergedTicket.subject}</span>
                    <span className="muted">{mergedTicket.mergedAt ? new Date(mergedTicket.mergedAt).toLocaleString() : "Merged"}</span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
          </div> : null}
          {sideTab === "GOAL" && canUseAi ? <div className="ticket-rail-section ticket-goal-panel">
            <div className="ticket-goal-heading">
              <h3><Sparkles size={14} aria-hidden="true" /> AI Goal</h3>
              <div className="ticket-goal-heading-actions">
                {aiBrief ? <div className="ticket-goal-language" role="group" aria-label="Goal language">
                  <button className={goalLanguage === "EN" ? "active" : ""} type="button" onClick={() => void changeGoalLanguage("EN")} disabled={goalTranslationLoading} title="View in English" aria-label="View Goal in English">🇺🇸 <span>EN</span></button>
                  <button className={goalLanguage === "ES" ? "active" : ""} type="button" onClick={() => void changeGoalLanguage("ES")} disabled={goalTranslationLoading} title="Ver en español" aria-label="Ver Goal en español">🇪🇸 <span>{goalTranslationLoading ? "..." : "ES"}</span></button>
                </div> : null}
                <button className="button secondary compact-button" type="button" onClick={() => void generateAiBrief()} disabled={aiBriefLoading || goalTranslationLoading}>
                  <RefreshCcw size={13} aria-hidden="true" /><span>{aiBrief ? "Refresh" : "Analyze"}</span>
                </button>
              </div>
            </div>
            {aiBriefStale ? <div className="ticket-goal-stale">The conversation changed after this analysis. Refresh before relying on it.</div> : null}
            {aiBriefError ? <div className="error-banner">{aiBriefError}</div> : null}
            {aiBriefLoading && !aiBrief ? <div className="ticket-goal-empty"><Sparkles size={18} aria-hidden="true" /><strong>Analyzing ticket context...</strong></div> : null}
            {!aiBriefLoading && !aiBrief ? <div className="ticket-goal-empty">
              <Target size={19} aria-hidden="true" />
              <strong>No goal generated yet</strong>
              <span>Analyze the public conversation to identify the requested outcome and next steps.</span>
              <button className="button compact-button" type="button" onClick={() => void generateAiBrief()}><Sparkles size={14} aria-hidden="true" /> Analyze Ticket</button>
            </div> : null}
            {aiBrief && displayedAiBrief ? <>
              {goalLanguage === "ES" ? <p className="ticket-goal-translation-note">Traducción contextual generada por IA. El análisis original permanece en inglés.</p> : null}
              <section className="ticket-goal-section primary"><span>{goalLabels.customerGoal}</span><strong>{displayedAiBrief.goal}</strong></section>
              <section className="ticket-goal-section"><span>{goalLabels.situation}</span><p>{displayedAiBrief.summary}</p></section>
              <TicketGoalList icon={<ListChecks size={14} aria-hidden="true" />} title={goalLabels.recommendedActions} items={displayedAiBrief.recommendedActions} />
              <TicketGoalList icon={<CircleHelp size={14} aria-hidden="true" />} title={goalLabels.missingInformation} items={displayedAiBrief.missingInformation} emptyLabel={goalLanguage === "ES" ? "No se identificó información pendiente." : "No missing information identified."} />
              <TicketGoalList icon={<ShieldAlert size={14} aria-hidden="true" />} title={goalLabels.contradictions} items={displayedAiBrief.contradictions ?? []} emptyLabel={goalLanguage === "ES" ? "No se identificaron contradicciones importantes." : "No material contradictions identified."} />
              <TicketGoalList icon={<ShieldAlert size={14} aria-hidden="true" />} title={goalLabels.risks} items={displayedAiBrief.risks} emptyLabel={goalLanguage === "ES" ? "No se identificaron riesgos específicos." : "No specific risks identified."} />
              {(aiBrief.webReferences?.length ?? 0) > 0 ? <section className="ticket-goal-section ticket-web-references">
                <span><ExternalLink size={14} aria-hidden="true" /> Web references</span>
                <div className="ticket-web-reference-list">
                  {aiBrief.webReferences!.map((reference, referenceIndex) => <article className={`ticket-web-reference ${reference.status.toLowerCase()}`} key={`${reference.source}-${reference.url}`}>
                    <div className="ticket-web-reference-heading">
                      {reference.status === "FOUND" ? <a href={reference.url} target="_blank" rel="noopener noreferrer">{reference.title ?? reference.url}<ExternalLink size={11} aria-hidden="true" /></a> : <strong>{reference.title ?? reference.url}</strong>}
                      <span>{reference.status === "FOUND" ? `${Math.round(reference.confidence * 100)}% match` : label(reference.status)}</span>
                    </div>
                    {reference.excerpt ? <p>{reference.excerpt}</p> : null}
                    {reference.reason ? <p className="ticket-web-reference-reason">{reference.reason}</p> : null}
                    <small>WEB-{referenceIndex + 1} · {label(reference.source)} · Checked {new Date(reference.checkedAt).toLocaleString()}</small>
                  </article>)}
                </div>
              </section> : null}
              <TicketGoalList icon={<Info size={14} aria-hidden="true" />} title="Evidence" items={aiBrief.evidence ?? []} emptyLabel="No supporting evidence provided." />
              {aiBrief.suggestedResponse ? <section className="ticket-goal-section suggested-response">
                <span>Suggested response</span>
                <p>{aiBrief.suggestedResponse}</p>
                {!aiBrief.responseReady ? <div className="ticket-goal-stale">Review the analysis before using this response. The AI found unresolved or insufficiently grounded information.</div> : null}
                {canReply ? <button className="button compact-button" type="button" onClick={() => insertAiDraft(aiBrief.suggestedResponse!)} disabled={!aiBrief.responseReady} title={!aiBrief.responseReady ? "Resolve contradictions or refresh the analysis before using this response." : undefined}><MessageSquareReply size={14} aria-hidden="true" /> Use as Reply</button> : null}
              </section> : null}
              {canReply && aiBrief.missingInformation.length > 0 ? <button className="button secondary compact-button ticket-goal-question-button" type="button" onClick={() => insertAiDraft(`To help us proceed, could you please confirm:\n\n${aiBrief.missingInformation.map((item) => `- ${item}`).join("\n")}`)} disabled={!aiBrief.responseReady}><CircleHelp size={14} aria-hidden="true" /> Ask for Missing Information</button> : null}
              <p className="ticket-goal-meta">AI-generated guidance · {aiBrief.confidence === null ? "Confidence not provided" : `${Math.round(aiBrief.confidence * 100)}% confidence`} · {[aiBrief.provider, aiBrief.model].filter(Boolean).join(" / ")} · {new Date(aiBrief.createdAt).toLocaleString()}</p>
              <p className="ticket-goal-disclaimer">Verify recommendations before replying or changing systems.</p>
            </> : null}
          </div> : null}
          {sideTab === "ASSIGNMENT" ? <div className="ticket-rail-section ticket-assignment-panel">
            <h3>Assignment</h3>
            <div className="field"><span>Specialists</span><TicketAssigneePicker users={users} selectedIds={assignedUserIds} currentUserId={currentUser?.id} disabled={!canAssign || assignmentBusy} onChange={(nextUserIds) => void saveAssignment(nextUserIds, assignedTeamId)} /></div>
            <label className="field">
              <span>Ticket Team</span>
              <select className="input" value={assignedTeamId} onChange={(event) => void saveAssignment(assignedUserIds, event.target.value)} disabled={!canAssign || assignmentBusy}>
                <option value="">No team</option>
                {ticketTeams.filter((team) => team.isActive).map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="ticket-assignment-note">Assigned specialists receive ticket notifications automatically.</p>
            <div className="ticket-conversation-participants">
              <div className="ticket-rail-section-heading">
                <h3>Conversation Participants</h3>
                {canUpdate && ticket.conversationParticipants.length > 1 ? <button className="button secondary compact-button" type="button" onClick={() => void clearConversationParticipants()} disabled={toolBusy === "participants-clear"}>Clear all</button> : null}
              </div>
              <p className="ticket-assignment-note">Included automatically on future public replies. Internal notes are never sent to these recipients.</p>
              {ticket.conversationParticipants.length === 0 ? <span className="muted">No persistent CC recipients.</span> : null}
              <div className="ticket-participant-list">
                {ticket.conversationParticipants.map((participant) => (
                  <div key={participant.id}>
                    <span><strong>{participant.displayName || participant.email}</strong>{participant.displayName ? <small>{participant.email}</small> : null}</span>
                    {canUpdate ? <button className="icon-button" type="button" onClick={() => void removeConversationParticipant(participant.id)} disabled={toolBusy === `participant-remove-${participant.id}`} title="Remove from future public replies" aria-label={`Remove ${participant.email} from conversation`}><X size={14} aria-hidden="true" /></button> : null}
                  </div>
                ))}
              </div>
            </div>
            <div className="ticket-external-section">
            <h3>External Specialists</h3>
            <div className="checkbox-row vertical">
              {ticket.externalSpecialists.length === 0 ? <span className="muted">No external specialists assigned.</span> : null}
              {ticket.externalSpecialists.map((assignment) => (
                <label key={assignment.id}>
                  <span>
                    {externalName(assignment.externalSpecialist)}
                    <br />
                    <small>{assignment.externalSpecialist.email}{assignment.externalSpecialist.phone ? ` · ${assignment.externalSpecialist.phone}` : ""}</small>
                  </span>
                  {canUpdate ? <button className="icon-button" type="button" aria-label="Remove external specialist" onClick={() => void removeExternalFromTicket(assignment.id)} disabled={toolBusy === `external-remove-${assignment.id}`}>
                    <X size={14} aria-hidden="true" />
                  </button> : null}
                </label>
              ))}
            </div>
            {canUpdate ? <><div className="event-inline-controls">
              <select className="input compact-select" value={externalAssignmentId} onChange={(event) => setExternalAssignmentId(event.target.value)}>
                <option value="">Select external specialist</option>
                {externalSpecialists.filter((specialist) => specialist.isActive).map((specialist) => (
                  <option key={specialist.id} value={specialist.id}>{externalName(specialist)}</option>
                ))}
              </select>
              <button className="button secondary" type="button" onClick={addExternalToTicket} disabled={!externalAssignmentId || toolBusy === "external-assign"}>
                <Plus size={16} aria-hidden="true" />
                <span>Assign</span>
              </button>
            </div>
            <button className="button secondary full-width-button" type="button" onClick={() => setExternalCreateOpen((current) => !current)}>
              {externalCreateOpen ? <X size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
              <span>{externalCreateOpen ? "Cancel New Specialist" : "Add New External Specialist"}</span>
            </button>
            {externalCreateOpen ? <div className="event-external-create-grid">
              <input className="input" placeholder="Name" value={externalDraft.name} onChange={(event) => setExternalDraft((current) => ({ ...current, name: event.target.value }))} />
              <input className="input" placeholder="Email" value={externalDraft.email} onChange={(event) => setExternalDraft((current) => ({ ...current, email: event.target.value }))} />
              <input className="input" placeholder="Phone" value={externalDraft.phone} onChange={(event) => setExternalDraft((current) => ({ ...current, phone: event.target.value }))} />
              <input className="input" placeholder="Company" value={externalDraft.company} onChange={(event) => setExternalDraft((current) => ({ ...current, company: event.target.value }))} />
              <button className="button secondary span-2" type="button" onClick={createExternalSpecialist} disabled={toolBusy === "external-create" || !externalDraft.name.trim() || !externalDraft.email.trim()}>
                <Plus size={16} aria-hidden="true" />
                <span>Add External Contact</span>
              </button>
            </div> : null}</> : null}
            </div>
          </div> : null}
          {sideTab === "FILES" ? <div className="ticket-rail-section ticket-files-panel">
            <h3>Ticket Files</h3>
            {downloadableAttachmentCount > 1 ? (
              <a className="button secondary compact-button ticket-download-all-button" href={downloadAllUrl} title="Download all ticket files as a ZIP">
                <Download size={16} aria-hidden="true" />
                <span>Download All</span>
              </a>
            ) : null}
            <MessageAttachments ticketId={ticketRef} attachments={realAttachments} variant="sidebar" />
            {attachmentImportFailures.length > 0 ? (
              <div className="ticket-rejected-attachments" role="status">
                <strong><ShieldAlert size={14} aria-hidden="true" /> Rejected email files</strong>
                {attachmentImportFailures.map((failure) => (
                  <div key={`${failure.attachmentId}-${failure.rejectedAt}`}>
                    <span title={failure.originalFilename}>{failure.originalFilename}</span>
                    <small>{failure.reason}</small>
                  </div>
                ))}
              </div>
            ) : null}
            {inlineAttachments.length > 0 ? (
              <details className="inline-attachments-summary"><summary>Inline email images <span>{uniqueInlineAttachments.length} unique · {inlineAttachments.length} total</span></summary><MessageAttachments ticketId={ticketRef} attachments={uniqueInlineAttachments} variant="sidebar" /></details>
            ) : null}
          </div> : null}
          </div>
          </div>
        </aside>
      </section>
      <TicketMeetingDrawer open={meetingDrawerOpen} ticketId={ticketRef} data={meetingData} initialMeetingId={meetingTargetId} users={users} permissions={permissionSet} onClose={() => setMeetingDrawerOpen(false)} onChanged={loadMeetings} />
      {showMergeModal ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="ticket-detail-merge-modal-title">
            <div className="modal-header">
              <div>
                <h2 id="ticket-detail-merge-modal-title">Merge Into {ticket.ticketNumber}</h2>
                <p className="muted">Search tickets by number, subject, client, domain, or requester. Selected tickets will be moved into this ticket.</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setShowMergeModal(false)} aria-label="Close merge dialog">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <label className="input-with-icon merge-search-field">
              <Search size={16} aria-hidden="true" />
              <input value={mergeSearch} onChange={(event) => setMergeSearch(event.target.value)} placeholder="Search tickets to merge" />
            </label>
            <div className="merge-candidate-list">
              {mergeSearchBusy ? <p className="muted">Searching tickets...</p> : null}
              {!mergeSearchBusy && mergeSearch.trim().length >= 2 && mergeCandidates.length === 0 ? <p className="muted">No merge candidates found.</p> : null}
              {!mergeSearchBusy && mergeSearch.trim().length < 2 ? <p className="muted">Type at least 2 characters to search.</p> : null}
              {mergeCandidates.map((candidate) => (
                <label className="merge-candidate-card" key={candidate.id}>
                  <input type="checkbox" checked={selectedMergeIds.includes(candidate.id)} onChange={() => toggleMergeCandidate(candidate.id)} />
                  <span className="merge-candidate-main">
                    <strong>{candidate.ticketNumber} - {candidate.subject}</strong>
                    <span>{candidate.client?.name ?? "Unassigned"} - {candidate.contact ? `${candidate.contact.firstName} ${candidate.contact.lastName}` : candidate.senderEmail ?? "Unknown requester"}</span>
                    <span className="muted">{label(candidate.status ?? "OPEN")} - {candidate._count.messages} messages - {candidate._count.attachments} files</span>
                  </span>
                </label>
              ))}
            </div>
            {selectedMergeTickets.length > 0 ? (
              <div className="merge-selection-summary">
                <strong>{selectedMergeTickets.length} selected</strong>
                <span>{selectedMergeTickets.map((candidate) => candidate.ticketNumber).join(", ")}</span>
              </div>
            ) : null}
            <label className="field">
              <span>Merge reason</span>
              <textarea className="input" rows={3} value={mergeReason} onChange={(event) => setMergeReason(event.target.value)} placeholder="Optional internal note" />
            </label>
            <label className="checkbox-card">
              <input type="checkbox" checked={mergeAllowDifferentClient} onChange={(event) => setMergeAllowDifferentClient(event.target.checked)} />
              <span>Allow merge if selected tickets belong to different clients</span>
            </label>
            <div className="modal-actions">
              <button className="button secondary" type="button" onClick={() => setShowMergeModal(false)} disabled={mergeBusy}>
                Cancel
              </button>
              <button className="button" type="button" onClick={mergeTickets} disabled={mergeBusy || selectedMergeIds.length === 0}>
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

function TicketMeetingActivityCard({ activity, onOpen }: { activity: TicketMeetingActivity; onOpen: () => void }) {
  const title = activity.metadata?.title ?? "Scheduled activity";
  const action = activity.action.split(".").at(-1)?.replace(/_/g, " ") ?? "updated";
  const actor = activity.user ? `${activity.user.firstName} ${activity.user.lastName}`.trim() || activity.user.email : "System";
  let scheduled = "Date not available";
  if (activity.metadata?.startAt) {
    try {
      scheduled = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: activity.metadata.timeZone }).format(new Date(activity.metadata.startAt));
    } catch {
      scheduled = new Date(activity.metadata.startAt).toLocaleString();
    }
  }
  return <article className={`ticket-meeting-activity${activity.action.endsWith("sync_failed") ? " failed" : ""}`}>
    <div className="ticket-meeting-activity-icon">{activity.metadata?.status === "SCHEDULED" ? <Video size={16} aria-hidden="true" /> : <CalendarClock size={16} aria-hidden="true" />}</div>
    <div>
      <header><span><strong>{title}</strong><small>{activityTypeLabel(activity.metadata?.activityType)} {action}</small></span><time>{new Date(activity.createdAt).toLocaleString()}</time></header>
      <p>{scheduled} · {activity.metadata?.attendeeCount ?? 0} attendee{activity.metadata?.attendeeCount === 1 ? "" : "s"} · {actor}</p>
      {activity.metadata?.modality && <p>{activityModeLabel(activity.metadata.modality)}{activity.metadata.location ? ` · ${activity.metadata.location}` : ""}</p>}
      {activity.metadata?.calendarReservationReleased && <p>Work completed early; future calendar reservation released.</p>}
      {activity.metadata?.error ? <p className="ticket-meeting-activity-error">{activity.metadata.error}</p> : null}
      <button className="button secondary compact-button" type="button" onClick={onOpen}>View activity</button>
    </div>
  </article>;
}

function MessageAttachments({
  ticketId,
  attachments,
  variant
}: {
  ticketId: string;
  attachments: TicketAttachment[];
  variant: "message" | "sidebar";
}) {
  const visibleAttachments = attachments.filter((attachment) => attachment.scanStatus !== "BLOCKED" && attachment.scanStatus !== "SUSPICIOUS");
  if (visibleAttachments.length === 0) {
    return variant === "sidebar" ? <p className="muted">No files attached.</p> : null;
  }

  return (
    <div className={`message-attachments ${variant === "sidebar" ? "sidebar-attachments" : ""}`}>
      {variant === "message" ? (
        <div className="attachment-group-heading">
          <strong>{visibleAttachments.length} attachment{visibleAttachments.length === 1 ? "" : "s"}</strong>
        </div>
      ) : null}
      {visibleAttachments.map((attachment) => {
        const previewUrl = `${apiBaseUrl}/tickets/${ticketId}/attachments/${attachment.id}/preview`;
        const downloadUrl = `${apiBaseUrl}/tickets/${ticketId}/attachments/${attachment.id}/download`;
        const canPreviewImage = attachment.mimeType.startsWith("image/");

        return (
          <div className={`message-attachment-card ${variant === "sidebar" ? "sidebar-file-card" : ""}`} key={attachment.id}>
            <div className="attachment-main">
              <strong>{attachment.originalFilename}</strong>
              <div className="muted">
                {attachment.mimeType} - {formatBytes(attachment.fileSize)}
              </div>
              {canPreviewImage && variant === "message" ? <img className="attachment-image-preview" src={previewUrl} alt={attachment.originalFilename} /> : null}
            </div>
            <div className="attachment-actions">
              {canPreview(attachment.mimeType) ? (
                <a className="icon-button" href={previewUrl} target="_blank" rel="noreferrer" title="Preview" aria-label={`Preview ${attachment.originalFilename}`}>
                  <Eye size={16} aria-hidden="true" />
                </a>
              ) : null}
              <a className="icon-button" href={downloadUrl} title="Download" aria-label={`Download ${attachment.originalFilename}`}>
                <Download size={16} aria-hidden="true" />
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function renderMessageHtml(ticketId: string, html: string, attachments: TicketAttachment[]) {
  const inlineAttachments = attachments.filter((attachment) => isInlineEmailAsset(attachment) && canPreview(attachment.mimeType));
  const usedAttachmentIds = new Set<string>();

  return html.replace(/src=(["'])cid:([^"']+)\1/gi, (match, quote: string, rawContentId: string) => {
    const attachment = findInlineAttachment(rawContentId, inlineAttachments, usedAttachmentIds);
    if (attachment) {
      usedAttachmentIds.add(attachment.id);
    }
    return attachment ? `src=${quote}${apiBaseUrl}/tickets/${ticketId}/attachments/${attachment.id}/preview${quote}` : match;
  });
}

function mergeAttachments(primary: TicketAttachment[], fallback: TicketAttachment[]) {
  const seen = new Set<string>();
  return [...primary, ...fallback].filter((attachment) => {
    if (seen.has(attachment.id)) {
      return false;
    }

    seen.add(attachment.id);
    return true;
  });
}

function dedupeInlineAttachments(attachments: TicketAttachment[]) {
  const seen = new Set<string>();
  return attachments.filter((attachment) => {
    const key = `${attachment.originalFilename.toLowerCase()}|${attachment.mimeType}|${attachment.fileSize}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function CollapsibleMessageBody({ html }: { html: string }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const enhancedHtmlRef = useRef<string | null>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || enhancedHtmlRef.current === html) return;
    enhanceEmailMessageBody(body);
    enhancedHtmlRef.current = html;
  }, [html]);

  return <div className="message-body" ref={bodyRef} dangerouslySetInnerHTML={{ __html: html }} />;
}

function CollapsiblePlainTextBody({ text }: { text: string }) {
  const sections = splitPlainMessage(text);

  return (
    <div className="message-body message-plain-body">
      {sections.main ? <div className="message-plain-text">{sections.main}</div> : null}
      {sections.signature ? (
        <details className="message-collapsible message-signature-collapsible">
          <summary>Show signature</summary>
          <div className="message-plain-text">{sections.signature}</div>
        </details>
      ) : null}
      {sections.quote ? (
        <details className="message-collapsible">
          <summary>Show quoted history</summary>
          <div className="message-plain-text">{sections.quote}</div>
        </details>
      ) : null}
    </div>
  );
}

function TicketGoalList({ icon, title, items, emptyLabel }: { icon: ReactNode; title: string; items: string[]; emptyLabel?: string }) {
  return <section className="ticket-goal-section">
    <span>{icon}{title}</span>
    {items.length > 0 ? <ol>{items.map((item) => <li key={item}>{item}</li>)}</ol> : <p className="muted">{emptyLabel ?? "No recommendations generated."}</p>}
  </section>;
}

function cleanContentId(value: string | null) {
  return value?.trim().replace(/^cid:/i, "").replace(/^<|>$/g, "").replace(/^["']|["']$/g, "").toLowerCase() ?? "";
}

function isInlineEmailAsset(attachment: TicketAttachment) {
  return attachment.isInline || Boolean(attachment.contentId);
}

function findInlineAttachment(rawContentId: string, attachments: TicketAttachment[], usedAttachmentIds: Set<string>) {
  const normalizedContentId = cleanContentId(rawContentId);
  const available = attachments.filter((attachment) => !usedAttachmentIds.has(attachment.id));

  return (
    available.find((attachment) => cleanContentId(attachment.contentId) === normalizedContentId) ??
    available.find((attachment) => normalizedContentId.includes(attachment.originalFilename.toLowerCase())) ??
    available.find((attachment) => attachment.originalFilename.toLowerCase().includes(normalizedContentId)) ??
    available[0] ??
    null
  );
}

function canPreview(mimeType: string) {
  return ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain"].includes(mimeType);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round((bytes / 1024) * 10) / 10} KB`;
  }

  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
}
