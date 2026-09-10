"use client";

import { accessLabel } from "@/lib/access-refresh";
import "./access.css";

export function PermissionPreview({ title, permissions }: { title: string; permissions: string[] }) {
  const names = [...new Set(permissions)].sort();
  const scopes = [...new Set(names.map(name => name.split(".")[0]))];
  return <div className="access-preview"><h3>{title}</h3><p>{names.length} permissions across {scopes.length} modules</p>{scopes.map(scope => <details key={scope}><summary>{accessLabel(scope)} <span className="muted">({names.filter(name => name.startsWith(`${scope}.`)).length})</span></summary><ul>{names.filter(name => name.startsWith(`${scope}.`)).map(name => <li key={name}>{accessLabel(name.split(".").slice(1).join("."))}<code>{name}</code></li>)}</ul></details>)}{!names.length ? <p className="muted">No module permissions are granted by this selection.</p> : null}</div>;
}

