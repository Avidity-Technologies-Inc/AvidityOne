"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
export type PasteMode = "adapt" | "keep" | "text";
export interface ComposerFormat { fontFamily: string; fontSize: number; color: string; lineHeight: number; pasteMode: PasteMode; displayScale: number; allowPersonalFormatting: boolean }
export interface ComposerPreferences { defaults: ComposerFormat; overrides: Partial<ComposerFormat>; effective: ComposerFormat; fonts: string[]; canManage: boolean }
export function useComposerPreferences(organization = false) {
  const [data, setData] = useState<ComposerPreferences | null>(null);
  const [status, setStatus] = useState("Loading preferences…");
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const pending = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const failedPatches = useRef<Record<string, unknown>[]>([]);
  const mounted = useRef(true);
  const endpoint = organization ? "/system-settings/composer" : "/profile/composer";
  const load = useCallback(async () => {
    if (pending.current || failedPatches.current.length) return;
    const version = revision.current;
    try {
      const result = await apiFetch<ComposerPreferences>(endpoint);
      if (!mounted.current || version !== revision.current) return;
      if (!result.effective || !result.defaults || !Array.isArray(result.fonts)) throw new Error("Composer preferences are unavailable.");
      setData(result); setError(null); setStatus("Saved automatically");
    } catch (e) { if (mounted.current) { setError(e instanceof Error ? e.message : "Unable to load preferences."); setStatus(""); } }
  }, [endpoint]);
  useEffect(() => {
    mounted.current = true; void load();
    const refresh = () => { void load(); };
    window.addEventListener("focus", refresh); window.addEventListener("composer-preferences-updated", refresh);
    return () => { mounted.current = false; window.removeEventListener("focus", refresh); window.removeEventListener("composer-preferences-updated", refresh); };
  }, [load]);
  function update(patch: Record<string, unknown>) {
    const version = ++revision.current;
    pending.current++;
    setStatus("Saving…"); setError(null);
    setData(current => {
      if (!current) return current;
      const next = { ...current };
      const values: Record<string, unknown> = patch.reset ? {} : { ...(organization ? current.defaults : current.overrides), ...patch };
      for (const key of Object.keys(values)) if (values[key] === null) delete values[key];
      if (!organization) {
        next.overrides = values;
        next.effective = { ...current.defaults, ...(current.defaults.allowPersonalFormatting ? values : {}), pasteMode: (values.pasteMode ?? current.defaults.pasteMode) as PasteMode, displayScale: Number(values.displayScale ?? 100) };
      } else if (!patch.reset) next.defaults = values as unknown as ComposerFormat;
      return next;
    });
    queue.current = queue.current.then(async () => {
      const patches = [...failedPatches.current, patch];
      failedPatches.current = [];
      let index = 0;
      try {
        let result: ComposerPreferences | null = null;
        for (; index < patches.length; index++) {
          result = await apiFetch<ComposerPreferences>(endpoint, { method: "PATCH", body: JSON.stringify(patches[index]) });
        }
        if (mounted.current && version === revision.current) { setData(result); setStatus("Saved automatically"); setError(null); }
      } catch (e) {
        failedPatches.current = patches.slice(index);
        if (mounted.current) { setError(e instanceof Error ? e.message : "Unable to save preferences."); setStatus("Changes not saved"); }
      } finally {
        pending.current--;
        if (!pending.current) window.dispatchEvent(new Event("composer-preferences-updated"));
      }
    });
  }
  return { data, status, error, update, retry: () => failedPatches.current.length ? update({}) : void load() };
}
