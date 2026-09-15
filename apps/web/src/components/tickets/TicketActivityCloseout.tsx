"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { activityModeLabel, activityTypeLabel, TicketMeeting } from "./TicketMeetingDrawer";

export function TicketActivityCloseout({ ticketId, meetings, permissions, onChanged, onOpen }: {
  ticketId: string; meetings: TicketMeeting[]; permissions: Set<string>; onChanged: () => Promise<void>; onOpen: (id: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const pending = meetings.filter(item => item.status === "DRAFT" || item.status === "SCHEDULED");
  if (!pending.length) return null;
  async function conclude(item: TicketMeeting, action: "complete" | "cancel" | "complete-and-release") {
    if (busy) return;
    const message = action === "complete-and-release"
      ? "Confirm the work was performed early and remove its future organizer-only calendar reservation?"
      : action === "cancel"
        ? `Cancel this activity without recording it as performed? ${item.attendees.length ? "Invited participants will be notified." : "Its calendar reservation will be removed."}`
        : "Confirm this activity was actually performed? The calendar event will be retained as history.";
    if (!window.confirm(message)) return;
    setBusy(item.id); setError("");
    try {
      await apiFetch(`/tickets/${ticketId}/meetings/${item.id}/${action}`, { method: "POST", ...(action === "cancel" ? { body: JSON.stringify({ comment: "Ticket closed; this scheduled activity is no longer needed." }) } : {}) });
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to conclude this activity. Retry or open its details."); }
    finally { setBusy(null); }
  }
  return <section className="panel ticket-activity-closeout" aria-label="Closed ticket activities">
    <h2>Ticket closed — review scheduled activities</h2>
    <p>Complete work that was performed, release reservations no longer needed, or keep an activity scheduled by leaving it unchanged. Closing or reopening the ticket does not send calendar cancellations automatically.</p>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {pending.map(item => {
      const future = new Date(item.startAt) > new Date();
      const release = future && item.activityType === "WORK_SESSION" && item.attendees.length === 0;
      return <article key={item.id}>
        <div><strong>{item.title}</strong><small>{activityTypeLabel(item.activityType)} · {activityModeLabel(item.modality)} · {new Intl.DateTimeFormat(undefined, { timeZone: item.timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(item.startAt))} ({item.timeZone}){future ? " · Upcoming" : ""}</small></div>
        <div className="ticket-activity-closeout-actions">
          <button className="button secondary compact-button" disabled={Boolean(busy)} onClick={() => onOpen(item.id)}>Review / keep scheduled</button>
          {permissions.has("ticket_meetings.update") && <button className="button secondary compact-button" disabled={Boolean(busy)} onClick={() => void conclude(item, "complete")}>Mark performed</button>}
          {release && permissions.has("ticket_meetings.update") && permissions.has("ticket_meetings.cancel") && <button className="button secondary compact-button" disabled={Boolean(busy)} onClick={() => void conclude(item, "complete-and-release")}>Work done early · free calendar</button>}
          {permissions.has("ticket_meetings.cancel") && <button className="button secondary compact-button" disabled={Boolean(busy)} onClick={() => void conclude(item, "cancel")}>{item.attendees.length ? "Cancel & notify invitees" : "Cancel reservation"}</button>}
        </div>
      </article>;
    })}
  </section>;
}
