"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

interface Installation {
  id: string; hostname: string; remoteIdentifier: string; state: string;
  serialNumber: string | null; hardwareUuid: string | null; manufacturer: string | null; model: string | null;
  clientId: string; client: {name:string}; site: string | null; lastSeenAt: string | null;
  macAddresses?: string[];
  present: boolean; reviewReason: string | null; status: string | null;
  deviceId: string | null; device: {id:string;name:string;clientId:string} | null; match?: string;
}
interface ReviewItem extends Installation { candidates: Installation[] }

export function DeviceIdentityReview({canManage, onChange}: {canManage:boolean;onChange:()=>void}) {
  const [items,setItems]=useState<ReviewItem[]>([]);
  const [error,setError]=useState(""); const [loading,setLoading]=useState(true);
  async function load() {
    setLoading(true); setError("");
    try { setItems((await apiFetch<{items:ReviewItem[]}>("/devices/identity-review")).items); }
    catch(e) {setError(e instanceof Error ? e.message : "Unable to load identity review.");}
    finally {setLoading(false);}
  }
  useEffect(()=>{void load();},[]);
  return <section className="panel device-identity-panel" aria-label="Device identity review">
    <div className="section-heading"><div><h2>Device identity review</h2><p className="muted">Link verified reinstallations or keep separate equipment. Decisions affect Avidity One only; nothing is deleted in Tactical RMM.</p></div><button type="button" className="button secondary compact" onClick={load} disabled={loading}>Refresh review</button></div>
    {error && <p role="alert" className="error-banner">{error}</p>}
    {loading ? <p>Loading identities…</p> : !items.length ? <p>No identities need review.</p> : items.map(item=><ReviewRow key={item.id} item={item} canManage={canManage} onResolved={()=>{void load();onChange();}} />)}
  </section>;
}

function Evidence({item}:{item:Installation}) {
  return <div className="device-identity-evidence">
    <strong>{item.hostname}</strong><span>{item.client.name} · {item.site ?? "No site"}</span>
    <span>Serial: {item.serialNumber ?? "Not reported"} · UUID: {item.hardwareUuid ?? "Not reported"}</span>
    <span>{[item.manufacturer,item.model].filter(Boolean).join(" · ") || "Hardware not reported"}</span>
    {!!item.macAddresses?.length && <span>MAC evidence: {item.macAddresses.join(", ")} (supporting evidence only)</span>}
    <span>Last seen: {item.lastSeenAt ? new Date(item.lastSeenAt).toLocaleString() : "Unknown"} · {item.status ?? "Unknown status"}</span>
    <span>Agent ID: <code>{item.remoteIdentifier}</code> · {item.present ? "In last inventory" : "Absent from last inventory"}</span>
  </div>;
}

function ReviewRow({item,canManage,onResolved}:{item:ReviewItem;canManage:boolean;onResolved:()=>void}) {
  const linked = item.state === "CURRENT" && item.device?.clientId === item.clientId;
  const [action,setAction]=useState(linked ? "current" : "historical"); const [target,setTarget]=useState(linked ? item.deviceId ?? "" : "");
  const [reason,setReason]=useState(""); const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  async function resolve(e: React.FormEvent) {
    e.preventDefault();setBusy(true);setError("");
    try {await apiFetch(`/devices/identity-review/${item.id}`,{method:"POST",body:JSON.stringify({action,deviceId:action === "separate" ? undefined : target,reason})});onResolved();}
    catch(e){setError(e instanceof Error ? e.message : "Unable to resolve identity.");}finally{setBusy(false);}
  }
  return <article className="device-identity-case">
    <p><strong>{item.reviewReason ?? "Installation needs review"}</strong></p>
    <Evidence item={item}/>
    <div className="device-identity-candidates">{item.candidates.map(candidate=><div key={candidate.id} className="device-identity-candidate"><p><Link href={`/devices/${candidate.deviceId}`}>Existing equipment: {candidate.device?.name}</Link> · {candidate.match === "strong" ? "Matching hardware" : candidate.match === "conflict" ? "Hardware conflict — keep separate" : "Insufficient hardware evidence"}</p><Evidence item={candidate}/></div>)}</div>
    {item.state !== "PENDING" && !linked ? <p className="muted">This linked agent changed hardware or client. Its equipment record was preserved. Verify the change before repairing the association; automatic reassignment is blocked.</p> : canManage ? <form onSubmit={resolve} className="device-identity-decision">
      <label>Decision<select className="input" value={action} onChange={e=>setAction(e.target.value)}>{!linked && <option value="historical">Keep as historical installation</option>}<option value="current">Use as current installation</option>{!linked && <option value="separate">Create separate equipment</option>}</select></label>
      {action !== "separate" && <label>Existing equipment<select className="input" required value={target} onChange={e=>setTarget(e.target.value)}><option value="">Choose after comparing evidence</option>{linked && <option value={item.deviceId!}>{item.device?.name} — accept verified hardware change</option>}{item.candidates.map(c=><option key={c.id} value={c.deviceId ?? ""} disabled={c.clientId!==item.clientId || c.device?.clientId!==item.clientId || c.match === "conflict" || Boolean(c.reviewReason)}>{c.device?.name} · {c.client.name} · {c.remoteIdentifier.slice(-8)}</option>)}</select></label>}
      <label>Verification note<input className="input" required minLength={5} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} placeholder="What confirms this decision?"/></label>
      <p className="muted">{action === "historical" ? "The current name, site and remote connection remain unchanged." : action === "current" ? "This installation will supply the current name, site and remote connection. The previous installation remains in history." : "A new equipment record will be created; existing records remain intact."}</p>
      {error && <p role="alert" className="error-banner">{error}</p>}<button className="button primary compact" disabled={busy}>{busy ? "Saving…" : "Apply identity decision"}</button>
    </form> : <p className="muted">RMM configuration permission is required to resolve identities.</p>}
  </article>;
}
