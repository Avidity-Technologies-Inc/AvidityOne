import { QcPolicyConfiguration } from "@avidity/shared/dist";
import { businessMinutes } from "./qc.rules";

export interface QcSourceEvent { id: string; origin?: string; kind: string; occurredAt: Date; actorId: string | null; snapshot: unknown; }
export interface QcSnapshot { status?: string; category?: string; statusDefinitionId?: string | null; assignedUserId?: string | null; clientId?: string | null; priority?: string; closedAt?: string | null; previous?: Omit<QcSnapshot, "previous">; }
export interface QcClock { kind: "FIRST_RESPONSE" | "RESOLUTION" | "SUBSEQUENT_RESPONSE"; startedAt: Date; stoppedAt: Date | null; elapsedMinutes: number; targetMinutes: number; state: "WITHIN_TARGET" | "WARNING" | "BREACHED"; }
export function measureCycle(events: QcSourceEvent[], config: QcPolicyConfiguration, now: Date) {
  if (!events.length) return { complete: false, reason: "No captured source events", clocks: [] as QcClock[] };
  const start = events[0];
  const complete = start.origin !== "HISTORICAL" && (start.kind === "CREATED" || start.kind === "REOPENED");
  const terminal = events.find(event => ["RESOLVED", "CLOSED", "CANCELLED", "MERGED"].includes((event.snapshot as QcSnapshot).category ?? (event.snapshot as QcSnapshot).status ?? ""));
  const end = terminal?.occurredAt ?? now;
  if (terminal && ["CANCELLED", "MERGED"].includes((terminal.snapshot as QcSnapshot).category ?? (terminal.snapshot as QcSnapshot).status ?? "")) return { complete: false, reason: "Cancelled or merged work is excluded from service compliance", clocks: [] as QcClock[] };
  if (end.getTime() - start.occurredAt.getTime() > 366 * 3 * 86400000) return { complete: false, reason: "Retained interval exceeds the supported live calculation range", clocks: [] as QcClock[] };
  const pauses: Array<{ start: Date; end: Date }> = [];
  let pausedAt: Date | null = null;
  for (const event of events) {
    if (!["CREATED", "REOPENED", "TICKET_CHANGED"].includes(event.kind)) continue;
    const paused = config.pauseStatusIds.includes((event.snapshot as QcSnapshot).statusDefinitionId ?? "");
    if (paused && !pausedAt) pausedAt = event.occurredAt;
    if (!paused && pausedAt) { pauses.push({ start: pausedAt, end: event.occurredAt }); pausedAt = null; }
  }
  if (pausedAt) pauses.push({ start: pausedAt, end });
  if (config.pauseScheduledWork) for (const hold of events.filter(event => event.kind === "SCHEDULED_HOLD")) {
    const until = new Date((hold.snapshot as { until: string }).until);
    const resumed = events.find(event => event.kind === "HOLD_RESUMED" && (event.snapshot as { holdId?: string }).holdId === hold.id);
    pauses.push({ start: hold.occurredAt, end: resumed && resumed.occurredAt < until ? resumed.occurredAt : until < end ? until : end });
  }
  const makeClock = (kind: QcClock["kind"], startedAt: Date, stoppedAt: Date | null, targetMinutes: number): QcClock => {
    const elapsedMinutes = businessMinutes(startedAt, stoppedAt ?? end, config.calendar, config.pauseClockKinds.includes(kind) ? pauses : []);
    return { kind, startedAt, stoppedAt, elapsedMinutes, targetMinutes, state: elapsedMinutes > targetMinutes ? "BREACHED" : !stoppedAt && elapsedMinutes >= targetMinutes * config.warningPercent / 100 ? "WARNING" : "WITHIN_TARGET" };
  };
  const response = events.find(event => event.occurredAt <= end && (event.kind === "PUBLIC_RESPONSE" || config.firstResponseMetric === "TECHNICAL_TOUCH" && event.kind === "TECHNICAL_TOUCH"));
  const clocks = [makeClock("FIRST_RESPONSE", start.occurredAt, response?.occurredAt ?? null, config.firstResponseMinutes), makeClock("RESOLUTION", start.occurredAt, terminal?.occurredAt ?? null, config.resolutionMinutes)];
  if (config.subsequentResponseMinutes) {
    let pending: Date | null = null;
    for (const event of events.filter(event => event.occurredAt <= end)) {
      if (event.kind === "CUSTOMER_MESSAGE" && response && event.occurredAt > response.occurredAt && !pending) pending = event.occurredAt;
      if (event.kind === "PUBLIC_RESPONSE" && pending) { clocks.push(makeClock("SUBSEQUENT_RESPONSE", pending, event.occurredAt, config.subsequentResponseMinutes)); pending = null; }
    }
    if (pending) clocks.push(makeClock("SUBSEQUENT_RESPONSE", pending, null, config.subsequentResponseMinutes));
  }
  return { complete, reason: complete ? null : start.origin === "HISTORICAL" ? "Reconstructed from retained records; historical ownership, pauses and reopen cycles are incomplete" : "Capture began after this work cycle started", clocks };
}
export function splitCycles(events: QcSourceEvent[]) {
  const cycles: QcSourceEvent[][] = [];
  for (const event of events) {
    if (!cycles.length || event.kind === "REOPENED") cycles.push([]);
    cycles[cycles.length - 1].push(event);
  }
  return cycles;
}
