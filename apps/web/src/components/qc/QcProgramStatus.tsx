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
    {!status.processingEnabled && <>
      <p>{status.readiness.length ? "Complete the pending settings when your operating rules are available. Partial configuration can be saved without activating QC." : "Required program fields are saved. An authorized administrator can activate processing after validating the operating rules."}</p>
      {status.readiness.length > 0 && <details><summary>{status.readiness.length} configuration items pending</summary><ul>{status.readiness.map(item => <li key={item}>{item}</li>)}</ul></details>}
      <p>{canConfigure ? <Link href="/qc/settings">Continue QC setup</Link> : <>A QC administrator must complete setup. Your current access does not include program configuration.</>}</p>
    </>}
    <details><summary>Your QC access</summary>
      <p>{permissions.includes("qc.view_all") ? "You can view QC work across the organization." : "You can view QC work within your assigned scope."} {permissions.includes("qc.reviews_perform") ? "You can claim and evaluate available inspections." : "Inspection scoring is not included in your access."}</p>
      <p>Configuration, assignment, work records, coaching, exports and billing release each require their own permission. <Link href="/profile">View your profile and inherited access</Link>.</p>
    </details>
  </aside>;
}
