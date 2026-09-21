"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type Policy = { enabled: boolean; repliesEnabled: boolean; closeEnabled: boolean; includeHistory: boolean; includeAttachments: boolean; includeInternal: boolean; includeTeams: boolean; includeGroups: boolean; includeWatchers: boolean; attachmentBudgetMb: number; confirmationMinutes: number };
type Delivery = { ticketId: string; ticketNumber: string; userName: string; userEmail: string; id: string; subject: string; eventType: string; status: string; attempts: number; error?: string; createdAt: string };
type Action = { ticketId: string; ticketNumber: string; userName: string; userEmail: string; id: string; mode: string; closeTicket: boolean; status: string; error?: string; createdAt: string };
type Overview = { policy: Policy; deliveries: Delivery[]; actions: Action[] };
const options: Array<{ key: keyof Pick<Policy, "enabled" | "repliesEnabled" | "closeEnabled" | "includeHistory" | "includeAttachments" | "includeInternal" | "includeTeams" | "includeGroups" | "includeWatchers">; label: string; help: string }> = [
  { key: "enabled", label: "Full ticket email", help: "Use complete message copies and the delivery queue for enabled ticket email events." },
  { key: "includeHistory", label: "History on assignment", help: "Include the available conversation when a specialist joins. Later emails contain the new message." },
  { key: "includeAttachments", label: "Include attachment copies", help: "Send permitted files within the email size budget. Every omitted file is identified." },
  { key: "includeWatchers", label: "Notify explicit followers", help: "Include users deliberately following the conversation, while respecting their event preferences." },
  { key: "includeTeams", label: "Notify assigned team", help: "Include current members of the assigned ticket team." },
  { key: "includeGroups", label: "Notify assigned access group", help: "Include current members of the assigned group." },
  { key: "includeInternal", label: "Internal note email", help: "Keep staff-only notes in a separate internal email context. Never include them in public reply copies." },
  { key: "repliesEnabled", label: "Allow replies from email", help: "Each proposed reply requires a one-time confirmation sent to the specialist's registered email." },
  { key: "closeEnabled", label: "Allow [Closed] command", help: "First line of new text only. Requires current close permission and email confirmation." }
];
export function TicketEmailPanel({ own = false }: { own?: boolean }) {
  const [visible, setVisible] = useState(true);
  const [data, setData] = useState<Overview | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const session = await apiFetch<{ user: { permissions: string[] } }>("/auth/me");
      if (own && !session.user.permissions.includes("tickets.view")) { setVisible(false); return; }
      const next = await apiFetch<Overview>(`/ticket-email/${own ? "me" : "settings"}`);
      setData(next); setDraft(next.policy); setCanEdit(!own && session.user.permissions.includes("system_settings.update")); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load ticket email settings."); }
  }, [own]);
  useEffect(() => { void load(); }, [load]);
  const dirty = Boolean(data && draft && JSON.stringify(data.policy) !== JSON.stringify(draft));
  async function save() {
    if (!draft) return;
    setBusy(true); setStatus(""); setError("");
    try { const policy = await apiFetch<Policy>("/ticket-email/settings", { method: "PATCH", body: JSON.stringify(draft) }); setData((current) => current ? { ...current, policy } : current); setDraft(policy); setStatus("Ticket email settings saved. Individual email/event preferences still apply."); }
    catch (e) { setError(e instanceof Error ? e.message : "Settings could not be saved."); }
    finally { setBusy(false); }
  }
  async function retry(delivery: Delivery) {
    if (delivery.status === "REVIEW_REQUIRED" && !window.confirm("The provider may already have accepted this email. Inspect Sent Items first. Queue another attempt, which may send a duplicate?")) return;
    setBusy(true); setError("");
    try { await apiFetch(`/ticket-email/deliveries/${delivery.id}/retry`, { method: "POST" }); await load(); setStatus("Delivery queued for another attempt."); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to retry delivery."); }
    finally { setBusy(false); }
  }
  if (!visible) return null;
  return <section className="ticket-email-panel settings-section" aria-label="Ticket email operations">
    <div className="section-heading"><div><h3>Ticket email operations</h3><p className="muted">Complete conversation copies, confirmed email replies and delivery tracking.</p></div><button className="button secondary compact-button" disabled={busy || dirty} onClick={() => void load()}>Refresh email status</button></div>
    {error ? <p role="alert">{error}</p> : null}{status ? <p role="status">{status}</p> : null}
    {draft ? <>
      <p className="notification-warning-banner">{data?.policy.enabled ? "Full ticket email is enabled." : "Full ticket email is off; existing notification behavior is preserved."} {data?.policy.repliesEnabled && data?.policy.enabled ? "Email actions require a separate one-time confirmation." : "Respond using the platform until email replies are enabled."} External specialists are not automatically subscribed or authorized to execute commands.</p>
      {own ? <p>Email replies: <strong>{draft.enabled && draft.repliesEnabled ? "Enabled" : "Disabled"}</strong> · Close command: <strong>{draft.enabled && draft.repliesEnabled && draft.closeEnabled ? "Enabled, subject to your permissions" : "Disabled"}</strong>. Your personal notification switches below determine which copies reach you.</p> : <>
        <div className="ticket-email-options">{options.map(({ key, label, help }) => <label key={key}><span><input type="checkbox" checked={draft[key]} disabled={!canEdit || busy || (key === "closeEnabled" && !draft.repliesEnabled)} onChange={(e) => setDraft({ ...draft, [key]: e.target.checked, ...(key === "repliesEnabled" && !e.target.checked ? { closeEnabled: false } : {}) })}/><strong>{label}</strong></span><small className="muted">{help}</small></label>)}</div>
        <div className="ticket-email-options"><label>Attachment budget per email (MB)<input className="input" aria-label="Attachment budget per email (MB)" type="number" min={1} max={2} value={draft.attachmentBudgetMb} disabled={!canEdit || busy} onChange={(e) => setDraft({ ...draft, attachmentBudgetMb: Number(e.target.value) })}/><small className="muted">Conservative budget for the current Microsoft transport; larger files are listed with an explicit omission notice.</small></label><label>Confirmation validity (minutes)<input className="input" aria-label="Confirmation validity (minutes)" type="number" min={5} max={60} value={draft.confirmationMinutes} disabled={!canEdit || busy} onChange={(e) => setDraft({ ...draft, confirmationMinutes: Number(e.target.value) })}/></label></div>
        {canEdit ? <div className="ticket-email-actions"><span className="muted">{dirty ? "Unsaved email policy changes" : "Settings are up to date"}</span><button className="button" disabled={busy || !dirty} onClick={() => void save()}>Save ticket email settings</button></div> : null}
      </>}
      <details><summary>Recent deliveries and email actions</summary><p className="muted">Last 50 records in each list. Accepted means the provider accepted the email, not proof of inbox receipt. Simulated means no real email was sent. Interrupted actions must be reviewed in the ticket before resubmission.</p>
        <div className="ticket-email-history"><table><caption>Email deliveries</caption><thead><tr><th>Notification</th><th>Status</th><th>Attempts</th><th>Created</th><th>Action</th></tr></thead><tbody>{data?.deliveries.map((row) => <tr key={row.id}><td><a href={`/tickets/${row.ticketId}`}>{row.ticketNumber}</a>{!own ? <small>{row.userName} · {row.userEmail}</small> : null}<div>{row.subject}</div>{row.error ? <small>{row.error}</small> : null}</td><td>{row.status.replaceAll("_", " ")}</td><td>{row.attempts}</td><td>{new Date(row.createdAt).toLocaleString()}</td><td>{canEdit && ["FAILED", "REVIEW_REQUIRED"].includes(row.status) ? <button className="button secondary compact-button" disabled={busy || dirty} onClick={() => void retry(row)}>Retry delivery</button> : "—"}</td></tr>)}</tbody></table>{!data?.deliveries.length ? <p className="muted">No operational email deliveries yet.</p> : null}</div>
        <div className="ticket-email-history"><table><caption>Email actions</caption><thead><tr><th>Operation</th><th>Status</th><th>Created</th></tr></thead><tbody>{data?.actions.map((row) => <tr key={row.id}><td><a href={`/tickets/${row.ticketId}`}>{row.ticketNumber}</a>{!own ? <small>{row.userName} · {row.userEmail}</small> : null}<br/>{row.mode === "INTERNAL" ? "Internal note" : "Public reply"}{row.closeTicket ? " + close" : ""}{row.error ? <small>{row.error}</small> : null}</td><td>{row.status.replaceAll("_", " ")}</td><td>{new Date(row.createdAt).toLocaleString()}</td></tr>)}</tbody></table>{!data?.actions.length ? <p className="muted">No email actions yet.</p> : null}</div>
      </details>
    </> : !error ? <p className="muted">Loading ticket email settings…</p> : null}
  </section>;
}
