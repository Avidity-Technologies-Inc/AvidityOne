export interface RmmHealthSettings {
  remoteAccessProviderEnabled: boolean;
  remoteAccessAutoSyncEnabled: boolean;
  remoteAccessAutoSyncIntervalMinutes: number | null;
  remoteAccessLastSyncAt: Date | null;
  remoteAccessLastSuccessAt: Date | null;
  remoteAccessLastSyncStatus: string | null;
  remoteAccessNextAutoSyncAt: Date | null;
  remoteAccessAutoSyncLockedAt: Date | null;
}

export function rmmHealth(settings: RmmHealthSettings, now = new Date(), outcome?: {checkedAt: Date; metadata: unknown} | null) {
  const interval = settings.remoteAccessAutoSyncIntervalMinutes;
  const metadata = {
    state: "unknown", evidence: "Recorded synchronization outcomes; no live RMM request.",
    enabled: settings.remoteAccessProviderEnabled, autoSyncEnabled: settings.remoteAccessAutoSyncEnabled,
    intervalMinutes: interval, lastAttemptAt: settings.remoteAccessLastSyncAt?.toISOString() ?? null,
    lastSuccessAt: settings.remoteAccessLastSuccessAt?.toISOString() ?? null,
    nextRunAt: settings.remoteAccessNextAutoSyncAt?.toISOString() ?? null,
    ageMinutes: settings.remoteAccessLastSyncAt ? Math.max(0, Math.floor((now.getTime() - settings.remoteAccessLastSyncAt.getTime()) / 60_000)) : null,
    runningSince: settings.remoteAccessAutoSyncLockedAt?.toISOString() ?? null
  };
  const result = (status: "ok" | "warning" | "error" | "disabled" | "unknown", state: string, message: string) => ({status, message, metadata: {...metadata, state}});
  if (!settings.remoteAccessProviderEnabled) return result("disabled", "disabled", "RMM integration is disabled.");
  const lock = settings.remoteAccessAutoSyncLockedAt;
  if (lock) return now.getTime() - lock.getTime() >= 30 * 60_000
    ? result("warning", "stalled", "The automatic synchronization lock is stale; review the scheduler.")
    : result("ok", "running", "Automatic inventory synchronization is running.");
  if (settings.remoteAccessLastSyncStatus === "error") return result("error", "error", "The latest RMM synchronization failed. Review RMM settings and server logs.");
  if (!settings.remoteAccessAutoSyncEnabled) return result("disabled", "manual", "Automatic synchronization is disabled; inventory is updated manually.");
  if (!interval || !settings.remoteAccessNextAutoSyncAt) return result("warning", "unscheduled", "Automatic synchronization has no valid interval or next run.");
  // Allow the scheduler scan and a brief active-mailbox deferral, not indefinite postponement.
  const overdue = now.getTime() - settings.remoteAccessNextAutoSyncAt.getTime() > 6 * 60_000;
  const stale = settings.remoteAccessLastSyncAt && now.getTime() - settings.remoteAccessLastSyncAt.getTime() > (interval + 6) * 60_000;
  if (overdue || stale) return result("warning", "overdue", "Inventory synchronization is overdue. Review the next run and last attempt.");
  if (settings.remoteAccessLastSyncStatus === "deferred") return result("warning", "deferred", "Synchronization was postponed while mailbox work was running.");
  if (!settings.remoteAccessLastSyncAt) return result("unknown", "never", "No synchronization attempt has been recorded yet.");
  if (settings.remoteAccessLastSyncStatus === "warning") {
    // Only use evidence from this attempt, never a previous successful snapshot.
    const details = outcome && outcome.checkedAt >= settings.remoteAccessLastSyncAt &&
      outcome.metadata && typeof outcome.metadata === "object" && !Array.isArray(outcome.metadata)
      ? outcome.metadata as Record<string, unknown> : {};
    const count = (key: string) => typeof details[key] === "number" && Number.isSafeInteger(details[key]) && (details[key] as number) >= 0 ? details[key] as number : null;
    const pending = count("pending");
    const failures = count("detailFailures");
    if (pending !== null && pending > 0 && failures !== null && failures > 0)
      return result("warning", "partial_identity_review", `The last synchronization recorded ${failures} device detail failures and ${pending} pending identity reviews. Review Devices and synchronization history.`);
    if (pending !== null && pending > 0 && failures === 0)
      return result("warning", "identity_review", `The last synchronization completed device details with ${pending} pending identity reviews. Review device identities in Devices.`);
    if (failures !== null && failures > 0)
      return result("warning", "partial", `The last synchronization recorded ${failures} device detail failures. Review synchronization history.`);
    return result("warning", "warning", "The last synchronization completed with warnings. Review synchronization history for the recorded outcome.");
  }
  if (settings.remoteAccessLastSyncStatus !== "success") return result("unknown", "unknown", "No recognized synchronization outcome is available.");
  return result("ok", "current", "Inventory is within the configured synchronization interval.");
}
