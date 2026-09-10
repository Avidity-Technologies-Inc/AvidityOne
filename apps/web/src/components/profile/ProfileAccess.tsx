"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { subscribeAccessRefresh } from "@/lib/access-refresh";
import { PermissionPreview } from "../users/PermissionPreview";

interface Membership {
  group: { id: string; name: string; roles: Array<{ role: { id: string; name: string } }> };
}

export function ProfileAccess() {
  const [access, setAccess] = useState<{ groups: Membership[]; permissions: string[] } | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let mounted = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      setRefreshing(true);
      try {
        const [profile, session] = await Promise.all([
          apiFetch<{ user: { groups: Membership[] } }>("/profile"),
          apiFetch<{ user: { permissions: string[] } }>("/auth/me")
        ]);
        if (mounted) { setAccess({ groups: profile.user.groups, permissions: session.user.permissions }); setError(""); }
      } catch {
        if (mounted) setError("Unable to refresh your access. Previously loaded details may be outdated.");
      } finally {
        pending = false;
        if (mounted) setRefreshing(false);
      }
    };
    void refresh();
    const unsubscribe = subscribeAccessRefresh(() => { void refresh(); });
    return () => { mounted = false; unsubscribe(); };
  }, [revision]);
  return <section className="panel profile-panel profile-access">
    <div className="section-heading"><div><h2>My Access</h2><p className="muted">Your administrator manages group membership and roles. Permissions combine across all your groups.</p></div><button className="button secondary" disabled={refreshing} type="button" onClick={() => setRevision(value => value + 1)}>Refresh access</button></div>
    {error ? <div className="error-banner" role="alert">{error}</div> : null}
    {!access && refreshing ? <p role="status">Loading your access…</p> : null}
    {access ? <>
      <h3>Groups and inherited roles</h3>
      <div className="access-choices">{access.groups.map(({ group }) => <div className="access-choice" key={group.id}><span><strong>{group.name}</strong><small>{group.roles.map(({ role }) => role.name).join(", ") || "No roles assigned"}</small></span></div>)}</div>
      {!access.groups.length ? <p className="muted">You are not assigned to any access groups.</p> : null}
      <PermissionPreview title="Your current effective permissions" permissions={access.permissions} />
      <p className="muted">Access is checked by the server for each request. This view refreshes when you return to the app and periodically while it is open.</p>
    </> : null}
  </section>;
}
