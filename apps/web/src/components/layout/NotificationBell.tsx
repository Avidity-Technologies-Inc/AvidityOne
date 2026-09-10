"use client";

import { Bell, CheckCheck, Settings2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

interface NotificationItem {
  id: string;
  title: string;
  body: string | null;
  status: "UNREAD" | "READ";
  createdAt: string;
  ticket: { id: string; ticketNumber: string; subject: string } | null;
  metadata?: { entityType?: string; requestId?: string; trackingNumber?: string; projectId?: string; href?: string } | null;
}

interface NotificationPreferences {
  inAppEnabled: boolean;
  emailEnabled: boolean;
  ticketAssignedToMe: boolean;
  ticketAssignedToMyTeam: boolean;
  ticketReplyOnAssignedTicket: boolean;
  internalNoteOnAssignedTicket: boolean;
  internalNoteMention: boolean;
  routingRuleMatched: boolean;
  ticketReopened: boolean;
  newTicketCreated: boolean;
  inAppTicketAssignedToMe: boolean;
  inAppTicketAssignedToMyTeam: boolean;
  inAppTicketReplyOnAssignedTicket: boolean;
  inAppInternalNoteOnAssignedTicket: boolean;
  inAppInternalNoteMention: boolean;
  inAppRoutingRuleMatched: boolean;
  inAppTicketReopened: boolean;
  inAppNewTicketCreated: boolean;
  emailTicketAssignedToMe: boolean;
  emailTicketAssignedToMyTeam: boolean;
  emailTicketReplyOnAssignedTicket: boolean;
  emailInternalNoteOnAssignedTicket: boolean;
  emailInternalNoteMention: boolean;
  emailRoutingRuleMatched: boolean;
  emailTicketReopened: boolean;
  emailNewTicketCreated: boolean;
  inAppEventAssignedToMe: boolean;
  inAppEventRequestUpdated: boolean;
  inAppEventTaskAssignedToMe: boolean;
  inAppEventTaskUpdated: boolean;
  inAppEventCommentAdded: boolean;
  inAppNewEventRequestCreated: boolean;
  emailEventAssignedToMe: boolean;
  emailEventRequestUpdated: boolean;
  emailEventTaskAssignedToMe: boolean;
  emailEventTaskUpdated: boolean;
  emailEventCommentAdded: boolean;
  emailNewEventRequestCreated: boolean;
  dailyDigestEnabled: boolean;
}

const preferenceLabels: Array<{ key: keyof NotificationPreferences; label: string }> = [
  { key: "inAppEnabled", label: "In-app notifications" },
  { key: "emailEnabled", label: "Email notifications" },
  { key: "inAppNewTicketCreated", label: "In-app: new tickets" },
  { key: "inAppTicketAssignedToMe", label: "In-app: assigned to me" },
  { key: "inAppTicketAssignedToMyTeam", label: "In-app: assigned to my team" },
  { key: "inAppTicketReplyOnAssignedTicket", label: "In-app: replies" },
  { key: "inAppInternalNoteOnAssignedTicket", label: "In-app: internal notes" },
  { key: "inAppInternalNoteMention", label: "In-app: mentions" },
  { key: "inAppRoutingRuleMatched", label: "In-app: routing rules" },
  { key: "inAppTicketReopened", label: "In-app: reopened tickets" },
  { key: "inAppNewEventRequestCreated", label: "In-app: new event requests" },
  { key: "inAppEventAssignedToMe", label: "In-app: event assignments" },
  { key: "inAppEventRequestUpdated", label: "In-app: event updates" },
  { key: "inAppEventTaskAssignedToMe", label: "In-app: event tasks" },
  { key: "inAppEventTaskUpdated", label: "In-app: event task updates" },
  { key: "inAppEventCommentAdded", label: "In-app: event comments" },
  { key: "emailNewTicketCreated", label: "Email: new tickets" },
  { key: "emailTicketAssignedToMe", label: "Email: assigned to me" },
  { key: "emailTicketAssignedToMyTeam", label: "Email: assigned to my team" },
  { key: "emailTicketReplyOnAssignedTicket", label: "Email: replies" },
  { key: "emailInternalNoteOnAssignedTicket", label: "Email: internal notes" },
  { key: "emailInternalNoteMention", label: "Email: mentions" },
  { key: "emailRoutingRuleMatched", label: "Email: routing rules" },
  { key: "emailTicketReopened", label: "Email: reopened tickets" },
  { key: "emailNewEventRequestCreated", label: "Email: new event requests" },
  { key: "emailEventAssignedToMe", label: "Email: event assignments" },
  { key: "emailEventRequestUpdated", label: "Email: event updates" },
  { key: "emailEventTaskAssignedToMe", label: "Email: event tasks" },
  { key: "emailEventTaskUpdated", label: "Email: event task updates" },
  { key: "emailEventCommentAdded", label: "Email: event comments" },
  { key: "dailyDigestEnabled", label: "Daily digest" }
];

export function NotificationBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [open, setOpen] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const unreadCount = items.filter((item) => item.status === "UNREAD").length;

  async function load() {
    try {
      const [notificationData, preferenceData] = await Promise.all([
        apiFetch<NotificationItem[]>("/notifications"),
        apiFetch<NotificationPreferences>("/notification-preferences/me")
      ]);
      setItems(notificationData);
      setPreferences(preferenceData);
    } catch {
      setItems([]);
    }
  }

  async function markAllRead() {
    setBusy(true);
    try {
      await apiFetch("/notifications/read-all", { method: "POST" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function updatePreference(key: keyof NotificationPreferences, value: boolean) {
    if (!preferences) {
      return;
    }

    const next = { ...preferences, [key]: value };
    setPreferences(next);
    await apiFetch("/notification-preferences/me", {
      method: "PATCH",
      body: JSON.stringify({ [key]: value })
    });
  }

  function notificationHref(item: NotificationItem) {
    if (item.ticket) {
      return `/tickets/${item.ticket.ticketNumber}`;
    }
    if (item.metadata?.entityType === "QC") return item.metadata.href?.startsWith("/qc/") ? item.metadata.href : "/qc";
    if (item.metadata?.entityType === "EventServiceRequest") {
      if (item.metadata.trackingNumber) {
        return `/event-services/${encodeURIComponent(item.metadata.trackingNumber)}`;
      }
      if (item.metadata.requestId) {
        return `/event-services?request=${encodeURIComponent(item.metadata.requestId)}`;
      }
    }
    if (item.metadata?.entityType === "ProjectDecision" && item.metadata.projectId) {
      return `/projects?project=${encodeURIComponent(item.metadata.projectId)}`;
    }
    if (item.metadata?.entityType === "ProjectDecisionDigest") {
      return item.metadata.href ?? "/operations";
    }
    return "#";
  }

  useEffect(() => {
    void load();
    const intervalId = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!panelRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  return (
    <div className="notification-menu" ref={panelRef}>
      <button className="notification-trigger" type="button" onClick={() => setOpen((current) => !current)} aria-label="Notifications">
        <Bell size={17} aria-hidden="true" />
        {unreadCount > 0 ? <span>{unreadCount > 9 ? "9+" : unreadCount}</span> : null}
      </button>
      {open ? (
        <div className="notification-panel">
          <div className="notification-panel-header">
            <strong>{showPreferences ? "Notification Preferences" : "Notifications"}</strong>
            <div className="form-actions">
              <button className="icon-button" type="button" onClick={() => setShowPreferences((current) => !current)} title="Preferences" aria-label="Notification preferences">
                <Settings2 size={15} aria-hidden="true" />
              </button>
              {!showPreferences ? (
                <button className="icon-button" type="button" onClick={markAllRead} disabled={busy} title="Mark all read" aria-label="Mark all notifications as read">
                  <CheckCheck size={15} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
          {showPreferences ? (
            <div className="notification-preferences">
              {preferences
                ? preferenceLabels.map((item) => (
                    <label className="checkbox-row" key={item.key}>
                      <input type="checkbox" checked={preferences[item.key]} onChange={(event) => void updatePreference(item.key, event.target.checked)} />
                      {item.label}
                    </label>
                  ))
                : <p className="muted">Loading preferences...</p>}
            </div>
          ) : (
            <div className="notification-list">
              {items.length === 0 ? <p className="muted">No notifications yet.</p> : null}
              {items.map((item) => (
                <Link className={`notification-item ${item.status === "UNREAD" ? "unread" : ""}`} href={notificationHref(item)} key={item.id}>
                  <strong>{item.title}</strong>
                  {item.body ? <span>{item.body}</span> : null}
                  <small>{new Date(item.createdAt).toLocaleString()}</small>
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
