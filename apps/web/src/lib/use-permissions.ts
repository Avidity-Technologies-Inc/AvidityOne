"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "./api";
import { subscribeAccessRefresh } from "./access-refresh";

/** UI affordances follow current grants; the API remains the authorization boundary. */
export function usePermissions() {
  const [permissions, setPermissions] = useState<string[]>([]);
  useEffect(() => {
    let mounted = true;
    const refresh = () => { void apiFetch<{ user: { permissions: string[] } }>("/auth/me")
      .then(result => { if (mounted) setPermissions(result.user.permissions); })
      .catch(() => { if (mounted) setPermissions([]); }); };
    refresh();
    const unsubscribe = subscribeAccessRefresh(refresh);
    return () => { mounted = false; unsubscribe(); };
  }, []);
  return permissions;
}
