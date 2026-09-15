"use client";

import { CalendarCheck, CalendarPlus, Check, ExternalLink, MapPin, Plus, RefreshCcw, Send, Users, Video, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "@/lib/api";

export type ActivityType = "MEETING" | "WORK_SESSION" | "SERVICE_VISIT";
export type ActivityMode = "REMOTE" | "ON_SITE" | "HYBRID";
export const activityTypeLabel = (type?: ActivityType) => type === "WORK_SESSION" ? "Work session" : type === "SERVICE_VISIT" ? "Service visit" : "Meeting";
export const activityModeLabel = (mode?: ActivityMode | null) => mode === "ON_SITE" ? "On-site" : mode === "HYBRID" ? "Hybrid" : mode === "REMOTE" ? "Remote" : "Modality not specified";

interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface TicketMeetingAttendee {
  id?: string;
  email: string;
  displayName: string | null;
  type: "REQUIRED" | "OPTIONAL";
  source: "REQUESTER" | "CONVERSATION_PARTICIPANT" | "INTERNAL_USER" | "CONTACT" | "MANUAL";
  responseStatus?: string | null;
}

export interface TicketMeeting {
  id: string;
  title: string;
  agenda: string | null;
  startAt: string;
  endAt: string;
  timeZone: string;
  location: string | null;
  activityType?: ActivityType;
  modality?: ActivityMode | null;
  isOnlineMeeting: boolean;
  status: "DRAFT" | "SCHEDULED" | "CANCELLED" | "COMPLETED";
  syncStatus: "NOT_SYNCED" | "PENDING" | "SYNCED" | "FAILED";
  organizerUserId: string | null;
  organizerCalendarEmail: string | null;
  providerEventId?: string | null;
  providerWebLink: string | null;
  onlineMeetingJoinUrl: string | null;
  syncError: string | null;
  syncedAt: string | null;
  attendees: TicketMeetingAttendee[];
  organizer: UserOption | null;
}

export interface TicketMeetingActivity {
  id: string;
  action: string;
  metadata: {
    activityType?: ActivityType;
    modality?: ActivityMode | null;
    location?: string | null;
    calendarReservationReleased?: boolean;
    meetingId?: string;
    title?: string;
    startAt?: string;
    endAt?: string;
    timeZone?: string;
    status?: string;
    syncStatus?: string;
    attendeeCount?: number;
    error?: string;
  } | null;
  createdAt: string;
  user: UserOption | null;
}

export interface TicketMeetingCollection {
  meetings: TicketMeeting[];
  activity: TicketMeetingActivity[];
  defaults: {
    title: string;
    timeZone: string;
    organizer: UserOption & { calendarEmail: string };
    attendees: TicketMeetingAttendee[];
    startAt: string;
    endAt: string;
  };
}

interface MeetingDraft {
  activityType: ActivityType;
  modality: ActivityMode | "";
  organizerUserId: string;
  title: string;
  agenda: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  location: string;
  isOnlineMeeting: boolean;
  attendees: TicketMeetingAttendee[];
}

export function TicketMeetingDrawer({
  open,
  ticketId,
  data,
  initialMeetingId,
  users,
  permissions,
  onClose,
  onChanged
}: {
  open: boolean;
  ticketId: string;
  data: TicketMeetingCollection | null;
  initialMeetingId?: string | null;
  users: UserOption[];
  permissions: Set<string>;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const [baseline, setBaseline] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MeetingDraft | null>(null);
  const [newAttendee, setNewAttendee] = useState({ email: "", displayName: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = useMemo(() => data?.meetings.find((meeting) => meeting.id === selectedId) ?? null, [data?.meetings, selectedId]);
  const dirty = Boolean(draft && baseline && JSON.stringify(draft) !== baseline);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  function replaceDraft(value: MeetingDraft) { setDraft(value); setBaseline(JSON.stringify(value)); }
  const canCreate = permissions.has("ticket_meetings.create");
  const canUpdate = permissions.has("ticket_meetings.update");
  const canCancel = permissions.has("ticket_meetings.cancel");

  useEffect(() => {
    if (!open || !data || draft) return;
    const initialMeeting = initialMeetingId ? data.meetings.find((meeting) => meeting.id === initialMeetingId) : null;
    if (initialMeeting) {
      setSelectedId(initialMeeting.id);
      replaceDraft(meetingToDraft(initialMeeting));
    } else if (selected) {
      replaceDraft(meetingToDraft(selected));
    } else {
      replaceDraft(defaultDraft(data));
    }
  }, [data, draft, initialMeetingId, open, selected]);

  useEffect(() => {
    if (!open) {
      setDraft(null);
      setSelectedId(null);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !draft) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { document.body.style.overflow = overflow; window.removeEventListener("beforeunload", beforeUnload); previous?.focus(); };
  }, [open, Boolean(draft)]);

  if (!open || !data || !draft) return null;

  function confirmDiscard() { return !dirty || window.confirm("Discard unsaved activity changes?"); }
  function close() { if (!busy && confirmDiscard()) onClose(); }
  function changeType(activityType: ActivityType) {
    setDraft(current => current ? { ...current, activityType, ...(activityType === "SERVICE_VISIT" ? { modality: selected?.isOnlineMeeting && (selected.providerEventId || selected.providerWebLink) ? "HYBRID" : "ON_SITE", isOnlineMeeting: Boolean(selected?.isOnlineMeeting && (selected.providerEventId || selected.providerWebLink)) } : {}) } : current);
  }
  function changeMode(modality: ActivityMode | "") {
    setDraft(current => current ? { ...current, modality, isOnlineMeeting: modality === "ON_SITE" ? false : modality === "HYBRID" ? true : current.isOnlineMeeting } : current);
  }

  function startNew() {
    if (busy || !confirmDiscard()) return;
    setSelectedId(null);
    replaceDraft(defaultDraft(data!));
    setError(null);
  }

  function selectMeeting(meeting: TicketMeeting) {
    if (busy || !confirmDiscard()) return;
    setSelectedId(meeting.id);
    replaceDraft(meetingToDraft(meeting));
    setError(null);
  }

  async function save(event: FormEvent, sendInvitations = false) {
    event.preventDefault();
    setError(null);
    const startAt = zonedLocalToIso(draft!.startAt, draft!.timeZone);
    const endAt = zonedLocalToIso(draft!.endAt, draft!.timeZone);
    if (!startAt || !endAt || new Date(endAt) <= new Date(startAt)) {
      setError("Meeting end time must be after its start time.");
      return;
    }
    if (!draft!.title.trim() || (!selected && !draft!.modality)) { setError("Enter a title and select a modality."); return; }
    if ((sendInvitations || selected?.status === "SCHEDULED") && ["ON_SITE", "HYBRID"].includes(draft!.modality) && !draft!.location.trim()) { setError("Enter the location before scheduling this activity."); return; }
    const payload = {
      activityType: draft!.activityType,
      ...(draft!.modality ? { modality: draft!.modality } : {}),
      organizerUserId: draft!.organizerUserId,
      title: draft!.title.trim(),
      agenda: draft!.agenda.trim() || null,
      startAt,
      endAt,
      timeZone: draft!.timeZone,
      location: draft!.location.trim() || null,
      isOnlineMeeting: draft!.isOnlineMeeting,
      attendees: draft!.attendees.map(({ email, displayName, type, source }) => ({ email, displayName, type, source }))
    };
    setBusy(sendInvitations ? "send" : "save");
    try {
      let saved: TicketMeeting;
      if (selected) {
        saved = dirty ? await apiFetch<TicketMeeting>(`/tickets/${ticketId}/meetings/${selected.id}`, { method: "PATCH", body: JSON.stringify(payload) }) : selected;
      } else {
        saved = await apiFetch<TicketMeeting>(`/tickets/${ticketId}/meetings`, { method: "POST", body: JSON.stringify(payload) });
        setSelectedId(saved.id);
      }
      if (sendInvitations && saved.status === "DRAFT") {
        saved = await apiFetch<TicketMeeting>(`/tickets/${ticketId}/meetings/${saved.id}/schedule`, { method: "POST" });
      }
      await onChanged();
      replaceDraft(meetingToDraft(saved));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save the meeting.");
    } finally {
      setBusy(null);
    }
  }

  async function meetingAction(action: "schedule" | "retry" | "cancel" | "complete") {
    if (!selected || busy || !confirmDiscard()) return;
    if (action === "complete" && new Date(selected.startAt) > new Date() && !window.confirm("Mark this future activity as actually performed? Its calendar event will be retained.")) return;
    if (action === "cancel" && !window.confirm("Cancel this activity? Invited attendees will receive a cancellation; an organizer-only reservation will be removed from the calendar.")) return;
    setBusy(action);
    setError(null);
    try {
      const updated = await apiFetch<TicketMeeting>(`/tickets/${ticketId}/meetings/${selected.id}/${action}`, {
        method: "POST",
        body: action === "cancel" ? JSON.stringify({ comment: "This activity was cancelled from Avidity One." }) : undefined
      });
      await onChanged();
      replaceDraft(meetingToDraft(updated));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Unable to ${action} the meeting.`);
    } finally {
      setBusy(null);
    }
  }

  function addAttendee() {
    const email = newAttendee.email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError("Enter a valid attendee email address.");
      return;
    }
    if (draft!.attendees.some((attendee) => attendee.email.toLowerCase() === email)) {
      setError("That attendee is already included.");
      return;
    }
    setDraft((current) => current ? { ...current, attendees: [...current.attendees, { email, displayName: newAttendee.displayName.trim() || null, type: "REQUIRED", source: "MANUAL" }] } : current);
    setNewAttendee({ email: "", displayName: "" });
    setError(null);
  }

  const locked = Boolean(selected && ["CANCELLED", "COMPLETED"].includes(selected.status));
  const editable = !busy && (selected ? canUpdate && !locked : canCreate);
  const publishedOnline = Boolean(selected?.isOnlineMeeting && (selected.providerEventId || selected.providerWebLink));

  return createPortal(
    <div className="ticket-meeting-drawer-backdrop" role="presentation" onClick={close}>
      <aside ref={dialogRef} tabIndex={-1} onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); close(); }
        if (event.key === "Tab") {
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]')).filter(item => item.getClientRects().length);
          const first = items[0], last = items[items.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }} className="ticket-meeting-drawer" role="dialog" aria-modal="true" aria-labelledby="ticket-meeting-drawer-title" onClick={(event) => event.stopPropagation()}>
        <header className="ticket-meeting-drawer-header">
          <div><CalendarCheck size={18} aria-hidden="true" /><span><strong id="ticket-meeting-drawer-title">Scheduled Activities</strong><small>{data.meetings.length} scheduled record{data.meetings.length === 1 ? "" : "s"}</small></span></div>
          <div>{canCreate ? <button className="button secondary compact-button" type="button" onClick={startNew}><CalendarPlus size={14} aria-hidden="true" /> Schedule activity</button> : null}<button className="icon-button" type="button" onClick={close} disabled={Boolean(busy)} aria-label="Close scheduled activities"><X size={17} aria-hidden="true" /></button></div>
        </header>
        <div className={`ticket-meeting-drawer-body ${!data.meetings.length ? "ticket-activities-empty" : ""}`}>
          <nav className="ticket-meeting-list" aria-label="Scheduled activities">
            {data.meetings.length === 0 ? <div className="ticket-meeting-empty"><CalendarPlus size={22} aria-hidden="true" /><strong>No activities yet</strong><span>Plan work, a service visit, or a meeting for this ticket.</span></div> : null}
            {data.meetings.map((meeting) => <button className={selectedId === meeting.id ? "active" : ""} type="button" key={meeting.id} onClick={() => selectMeeting(meeting)}>
              <span><strong>{meeting.title}</strong><small>{activityTypeLabel(meeting.activityType)} · {activityModeLabel(meeting.modality)}</small><small>{formatMeetingDate(meeting.startAt, meeting.timeZone)}</small>{meeting.location && <small title={meeting.location}>{meeting.location}</small>}</span>
              <em className={`ticket-meeting-status ${meeting.status.toLowerCase()}`}>{label(meeting.status)}</em>
            </button>)}
          </nav>
          <form className="ticket-meeting-form" onSubmit={(event) => void save(event)}>
            <div className="ticket-meeting-form-heading"><div><h3>{selected ? "Activity details" : "Schedule activity"}</h3>{selected ? <span className={`ticket-meeting-sync ${selected.syncStatus.toLowerCase()}`}>{label(selected.syncStatus)}</span> : null}</div>{selected?.providerWebLink ? <a className="button secondary compact-button" href={selected.providerWebLink} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Outlook</a> : null}</div>
            {error ? <div className="error-banner">{error}</div> : null}
            {selected?.syncError ? <div className="ticket-meeting-sync-error">{selected.syncError}</div> : null}
            <div className="ticket-activity-intro">Reserve time to work on this ticket, arrange a visit, or meet with participants. This schedule is separate from the ticket target date.</div>
            <div className="ticket-meeting-fields">
              <label className="field"><span>Activity type</span><select className="input" value={draft.activityType} disabled={!editable} onChange={event => changeType(event.target.value as ActivityType)}><option value="WORK_SESSION">Work session</option><option value="SERVICE_VISIT">Service visit</option><option value="MEETING">Meeting</option></select></label>
              <label className="field"><span>Modality</span><select className="input" value={draft.modality} disabled={!editable} onChange={event => changeMode(event.target.value as ActivityMode)}>{!draft.modality && <option value="">Not specified — existing activity</option>}<option value="REMOTE">Remote</option><option value="ON_SITE" disabled={publishedOnline}>On-site</option><option value="HYBRID">Hybrid</option></select></label>
              {publishedOnline && <p className="ticket-activity-help span-2">This event already includes Teams. Keep it remote or hybrid; an exclusively on-site replacement requires explicitly cancelling this event and scheduling another.</p>}
              <label className="field span-2"><span>Title</span><input className="input" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} disabled={!editable} required /></label>
              <label className="field"><span>Start</span><input className="input" type="datetime-local" value={draft.startAt} onChange={(event) => setDraft({ ...draft, startAt: event.target.value })} disabled={!editable} required /></label>
              <label className="field"><span>End</span><input className="input" type="datetime-local" value={draft.endAt} onChange={(event) => setDraft({ ...draft, endAt: event.target.value })} disabled={!editable} required /></label>
              <label className="field"><span>Timezone</span><input className="input" list="ticket-meeting-timezones" value={draft.timeZone} onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })} disabled={!editable} required /><datalist id="ticket-meeting-timezones"><option value="America/Chicago" /><option value="America/New_York" /><option value="America/Denver" /><option value="America/Los_Angeles" /><option value="UTC" /></datalist></label>
              <label className="field"><span>Responsible / organizer</span><select className="input" value={draft.organizerUserId} onChange={(event) => setDraft({ ...draft, organizerUserId: event.target.value })} disabled={!editable || Boolean(selected?.providerEventId || selected?.providerWebLink)}>{users.map((user) => <option value={user.id} key={user.id}>{displayUser(user)} · {user.email}</option>)}</select></label>
              <label className="field span-2"><span><MapPin size={13} /> Location</span><input className="input" value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} disabled={!editable} placeholder="Office, conference room, or address" /></label>
              <label className="checkbox-card span-2"><input type="checkbox" checked={draft.isOnlineMeeting} onChange={(event) => setDraft({ ...draft, isOnlineMeeting: event.target.checked })} disabled={!editable || publishedOnline || draft.modality === "ON_SITE" || draft.modality === "HYBRID"} /><span><Video size={14} /> Create a Microsoft Teams meeting</span></label>
              <label className="field span-2"><span>Agenda</span><textarea className="input" rows={5} value={draft.agenda} onChange={(event) => setDraft({ ...draft, agenda: event.target.value })} disabled={!editable} placeholder="Add only the ticket information that attendees need. Internal notes and conversation history are not copied." /></label>
            </div>
            <section className="ticket-meeting-attendees">
              <div className="ticket-meeting-section-heading"><div><Users size={15} /><h3>Calendar invitations</h3><span>{draft.attendees.length}</span></div></div>
              <p className="ticket-activity-help">{draft.attendees.length ? `${draft.attendees.length} selected participant(s) will receive calendar invitations or updates. Review this list before scheduling.` : "Organizer only: reserves time in the responsible person's calendar without sending invitations."}</p>
              {editable && <div className="ticket-activity-audience"><button className="button secondary compact-button" type="button" onClick={() => setDraft({ ...draft, attendees: [...draft.attendees, ...data.defaults.attendees.filter(person => !draft.attendees.some(existing => existing.email.toLowerCase() === person.email.toLowerCase()))] })}>Add suggested ticket participants</button>{draft.attendees.length > 0 && <button className="button secondary compact-button" type="button" onClick={() => { if (!selected?.providerWebLink || window.confirm("Remove all invited participants? Saving will update the existing calendar invitation.")) setDraft({ ...draft, attendees: [] }); }}>Organizer only</button>}</div>}
              <div className="ticket-meeting-attendee-list">
                {draft.attendees.map((attendee) => <div key={attendee.email}>
                  <span><strong>{attendee.displayName || attendee.email}</strong>{attendee.displayName ? <small>{attendee.email}</small> : null}<small>{label(attendee.source)}</small></span>
                  <select value={attendee.type} onChange={(event) => setDraft({ ...draft, attendees: draft.attendees.map((item) => item.email === attendee.email ? { ...item, type: event.target.value as TicketMeetingAttendee["type"] } : item) })} disabled={!editable} aria-label={`Attendance type for ${attendee.email}`}><option value="REQUIRED">Required</option><option value="OPTIONAL">Optional</option></select>
                  {editable ? <button className="icon-button" type="button" onClick={() => setDraft({ ...draft, attendees: draft.attendees.filter((item) => item.email !== attendee.email) })} aria-label={`Remove ${attendee.email}`}><X size={14} /></button> : null}
                </div>)}
              </div>
              {editable ? <div className="ticket-meeting-add-attendee"><input className="input" value={newAttendee.displayName} onChange={(event) => setNewAttendee({ ...newAttendee, displayName: event.target.value })} placeholder="Name (optional)" /><input className="input" type="email" value={newAttendee.email} onChange={(event) => setNewAttendee({ ...newAttendee, email: event.target.value })} placeholder="email@example.com" /><button className="button secondary" type="button" onClick={addAttendee}><Plus size={14} /> Add</button></div> : null}
            </section>
            {selected?.onlineMeetingJoinUrl ? <a className="ticket-meeting-join" href={selected.onlineMeetingJoinUrl} target="_blank" rel="noopener noreferrer"><Video size={15} /> Join Microsoft Teams Meeting</a> : null}
            <footer className="ticket-meeting-actions"><span className="ticket-activity-help">{dirty ? "Unsaved changes" : selected ? "Saved activity" : "Draft not yet saved"}</span>
              {selected && selected.status === "DRAFT" && canCreate ? <button className="button" type="button" onClick={(event) => void save(event, true)} disabled={Boolean(busy)}><Send size={14} /> {draft.attendees.length ? "Schedule & send invitations" : "Reserve in calendar"}</button> : null}
              {selected && selected.syncStatus === "FAILED" && canUpdate ? <button className="button" type="button" onClick={() => void meetingAction("retry")} disabled={Boolean(busy)}><RefreshCcw size={14} /> Retry Sync</button> : null}
              {selected && selected.status === "SCHEDULED" && canUpdate ? <button className="button secondary" type="button" onClick={() => void meetingAction("complete")} disabled={Boolean(busy)}><Check size={14} /> Complete</button> : null}
              {selected && selected.status === "SCHEDULED" && canCancel ? <button className="button danger" type="button" onClick={() => void meetingAction("cancel")} disabled={Boolean(busy)}><X size={14} /> Cancel activity</button> : null}
              {editable ? <button className="button secondary" type="submit" disabled={Boolean(busy) || !draft.title.trim()}>{busy === "save" ? "Saving..." : selected?.status === "SCHEDULED" ? draft.attendees.length ? "Save & send update" : "Update calendar reservation" : "Save Draft"}</button> : null}
              {!selected && canCreate ? <button className="button" type="button" onClick={(event) => void save(event, true)} disabled={Boolean(busy) || !draft.title.trim()}><Send size={14} /> {busy === "send" ? "Scheduling..." : draft.attendees.length ? "Schedule & send invitations" : "Reserve in calendar"}</button> : null}
            </footer>
          </form>
        </div>
      </aside>
    </div>, document.body
  );
}

function defaultDraft(data: TicketMeetingCollection): MeetingDraft {
  return {
    activityType: "WORK_SESSION",
    modality: "REMOTE",
    organizerUserId: data.defaults.organizer.id,
    title: data.defaults.title,
    agenda: "",
    startAt: isoToZonedLocal(data.defaults.startAt, data.defaults.timeZone),
    endAt: isoToZonedLocal(data.defaults.endAt, data.defaults.timeZone),
    timeZone: data.defaults.timeZone,
    location: "",
    isOnlineMeeting: false,
    attendees: []
  };
}

function meetingToDraft(meeting: TicketMeeting): MeetingDraft {
  return {
    activityType: meeting.activityType ?? "MEETING",
    modality: meeting.modality ?? "",
    organizerUserId: meeting.organizerUserId ?? "",
    title: meeting.title,
    agenda: meeting.agenda ?? "",
    startAt: isoToZonedLocal(meeting.startAt, meeting.timeZone),
    endAt: isoToZonedLocal(meeting.endAt, meeting.timeZone),
    timeZone: meeting.timeZone,
    location: meeting.location ?? "",
    isOnlineMeeting: meeting.isOnlineMeeting,
    attendees: meeting.attendees.map((attendee) => ({ ...attendee }))
  };
}

function isoToZonedLocal(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}

function zonedLocalToIso(value: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  try {
    const desired = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
    let instant = desired;
    for (let iteration = 0; iteration < 2; iteration += 1) {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
      const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
      const represented = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
      instant += desired - represented;
    }
    return new Date(instant).toISOString();
  } catch {
    return null;
  }
}

function formatMeetingDate(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

function displayUser(user: UserOption) {
  return `${user.firstName} ${user.lastName}`.trim() || user.email;
}

function label(value: string) {
  return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
