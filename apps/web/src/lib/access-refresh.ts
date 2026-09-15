const accessEvent = "avidity:access-changed";

/** Broadcast invalidation only; permissions always come from the authenticated API. */
export function notifyAccessChanged() {
  window.dispatchEvent(new Event(accessEvent));
  try {
    localStorage.setItem(accessEvent, `${Date.now()}-${Math.random()}`);
  } catch {
    // Storage may be unavailable in a private browser session.
  }
}

export function subscribeAccessRefresh(refresh: () => void) {
  const visibleRefresh = () => { if (document.visibilityState === "visible") refresh(); };
  const storageRefresh = (event: StorageEvent) => { if (event.key === accessEvent) visibleRefresh(); };
  window.addEventListener(accessEvent, visibleRefresh);
  window.addEventListener("focus", visibleRefresh);
  window.addEventListener("storage", storageRefresh);
  document.addEventListener("visibilitychange", visibleRefresh);
  // Changes made by another administrator must also reach an already open session.
  const interval = window.setInterval(visibleRefresh, 60_000);
  return () => {
    window.removeEventListener(accessEvent, visibleRefresh);
    window.removeEventListener("focus", visibleRefresh);
    window.removeEventListener("storage", storageRefresh);
    document.removeEventListener("visibilitychange", visibleRefresh);
    window.clearInterval(interval);
  };
}

export function accessLabel(value: string) {
  if (value === "ticket_meetings") return "Scheduled Activities";
  if (value === "qc") return "Quality Control";
  return value.replace(/[_.]/g, " ").replace(/\b\w/g, character => character.toUpperCase());
}
