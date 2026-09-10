"use client";
import { useState } from "react";
import { apiFetch, getApiBaseUrl } from "@/lib/api";
import { formatDate, label } from "./qc.types";

export interface CreativeAttachment {
  id: string;
  createdAt: string;
  deliverableVersion: number;
  scanStatus: string;
  storedFile: { originalFilename: string; fileSize: number; sha256Hash: string };
}

export function QcCreativeAttachments({ attachments = [], deliverableId, reviewId, canUpload = false, onUpdated }: {
  attachments?: CreativeAttachment[];
  deliverableId: string;
  reviewId?: string;
  canUpload?: boolean;
  onUpdated?: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <section className="qc-divider">
    <h3>Private proof files</h3>
    <p className="qc-muted">Files retain their work version and use the existing attachment policy. Upload a new file for each revised proof.</p>
    {attachments.map(item => <div key={item.id} className="qc-divider">
      {["BLOCKED", "SUSPICIOUS"].includes(item.scanStatus)
        ? <span>{item.storedFile.originalFilename}</span>
        : <a href={`${getApiBaseUrl()}/qc/${reviewId ? `reviews/${reviewId}/creative-attachments` : `deliverables/${deliverableId}/attachments`}/${item.id}`} download>{item.storedFile.originalFilename}</a>}
      <small>Work version {item.deliverableVersion} · {formatDate(item.createdAt)} · {item.storedFile.fileSize.toLocaleString()} bytes · Scan: {label(item.scanStatus)}</small>
    </div>)}
    {!attachments.length && <p>No proof files recorded.</p>}
    {error && <p className="qc-notice qc-error" role="alert">{error}</p>}
    {canUpload && <form onSubmit={async event => {
      event.preventDefault(); if (!file) return;
      const form = event.currentTarget;
      setBusy(true); setError("");
      try {
        const body = new FormData(); body.append("file", file);
        await apiFetch(`/qc/deliverables/${deliverableId}/attachments`, { method: "POST", body });
        setFile(null); form.reset(); await onUpdated?.();
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Proof file could not be saved."); }
      finally { setBusy(false); }
    }}>
      <label>Proof or approval file<input type="file" required disabled={busy} onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
      <button disabled={busy || !file}>{busy ? "Saving proof…" : "Save private proof"}</button>
    </form>}
  </section>;
}
