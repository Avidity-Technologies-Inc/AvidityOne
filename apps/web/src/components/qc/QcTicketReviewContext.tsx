"use client";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type TicketContext = { id: string; ticketNumber: string; subject: string };

export function QcTicketReviewContext({ ticketId, permissions, onRequested }: { ticketId: string; permissions: string[]; onRequested: () => Promise<void> }) {
  const [ticket, setTicket] = useState<TicketContext | null>(null);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    apiFetch<TicketContext>(`/qc/tickets/${encodeURIComponent(ticketId)}`).then(value => { if (mounted) setTicket(value); }).catch(cause => { if (mounted) setError(cause instanceof Error ? cause.message : "Ticket context is unavailable."); });
    return () => { mounted = false; };
  }, [ticketId]);
  async function requestInspection(event: FormEvent) {
    event.preventDefault();
    if (!ticket || busy || !reason.trim()) return;
    setBusy(true); setError(""); setReviewId(null);
    try {
      const review = await apiFetch<{ id: string }>("/qc/reviews", { method: "POST", body: JSON.stringify({ ticketId: ticket.id, reason: reason.trim() }) });
      setReviewId(review.id); setReason(""); await onRequested();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Inspection could not be requested."); }
    finally { setBusy(false); }
  }
  return <article className="qc-card qc-ticket-context" aria-label="Ticket review context">
    {error && <p role="alert" className="qc-error">{error}</p>}
    {!ticket && !error && <p role="status">Loading ticket context…</p>}
    {ticket && <>
      <h2>QC reviews for {ticket.ticketNumber}</h2>
      <p>{ticket.subject}</p>
      <div className="qc-inline">
        {permissions.includes("tickets.view") && <Link href={`/tickets/${ticket.id}`}>Back to ticket</Link>}
        <Link href={`/qc/work?ticketId=${ticket.id}`}>Ticket work records</Link>
        <Link href="/qc/reviews">View all permitted reviews</Link>
      </div>
      <p className="qc-muted">The queue below is limited to this ticket. Opening this page does not create an inspection or change the ticket.</p>
      {permissions.includes("qc.reviews_assign") && permissions.includes("qc.view_all") ? <form onSubmit={requestInspection}>
        <label>Reason for manual QC review<input required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} /></label>
        <button disabled={busy || !reason.trim()}>{busy ? "Requesting inspection…" : "Request inspection"}</button>
        <p className="qc-muted">If this work cycle already has an inspection, it will be reused. Scoring requires a published rubric and a configured failure consequence.</p>
      </form> : <p className="qc-muted">A user with QC review assignment permission can request an inspection for this ticket.</p>}
      {reviewId && <p role="status">Inspection available. <Link href={`/qc/reviews/${reviewId}`}>Open inspection</Link></p>}
    </>}
  </article>;
}
