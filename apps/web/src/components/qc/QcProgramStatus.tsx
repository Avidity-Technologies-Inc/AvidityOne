"use client";
import Link from "next/link";

export interface QcReadiness {
  captureEnabled: boolean;
  processingEnabled: boolean;
  deliveryEnabled: boolean;
  readiness: string[];
}

export function QcProgramStatus({ status, permissions }: { status: QcReadiness; permissions: string[] }) {
  const canConfigure = permissions.includes("qc.settings_manage");
  return <aside className="qc-notice qc-program-status" aria-label="QC operational status">
    <div className="qc-inline">
      <strong>{status.processingEnabled ? "QC processing is active" : "QC processing is inactive."}</strong>
      <span className="qc-badge">Capture {status.captureEnabled ? "on" : "off"}</span>
      <span className="qc-badge">Processing {status.processingEnabled ? "on" : "off"}</span>
      <span className="qc-badge">Delivery {status.deliveryEnabled ? "on" : "off"}</span>
    </div>
    {!status.processingEnabled && <details><summary>{status.readiness.length ? `${status.readiness.length} setup items pending` : "Ready for activation review"} · {canConfigure ? <Link href="/qc/settings">Continue QC setup</Link> : "Ask your QC administrator"}</summary>
      <p>Save partial configuration now; activate only after the operating rules are defined.</p>
      {status.readiness.length > 0 && <ul>{status.readiness.map(item => <li key={item}>{item}</li>)}</ul>}
    </details>}
    {!canConfigure && <p className="qc-muted">Your current access does not include program configuration.</p>}
    <details><summary>Your QC access</summary>
      <p>{permissions.includes("qc.view_all") ? "You can view QC work across the organization." : "You can view QC work within your assigned scope."} {permissions.includes("qc.reviews_perform") ? "You can claim and evaluate available inspections." : "Inspection scoring is not included in your access."}</p>
      <p>Configuration, assignment, work records, coaching, exports and billing release each require their own permission. <Link href="/profile">View your profile and inherited access</Link>.</p>
    </details>
  </aside>;
}
