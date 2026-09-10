"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { apiFetch } from "@/lib/api";
export function QcContextLink({ href = "/qc", label = "Quality Control", permission = "qc.view", permissions }: { href?: string; label?: string; permission?: string; permissions?: string[] }) {
  const [grants, setGrants] = useState<string[]>(permissions ?? []);
  useEffect(() => {
    if (permissions) { setGrants(permissions); return; }
    let mounted = true;
    apiFetch<{ user: { permissions: string[] } }>("/auth/me").then(result => { if (mounted) setGrants(result.user.permissions); }).catch(() => {});
    return () => { mounted = false; };
  }, [permissions]);
  return grants.includes("qc.view") && grants.includes(permission) ? <Link className="button secondary" href={href}><ClipboardCheck size={15} aria-hidden="true" /><span>{label}</span></Link> : null;
}
