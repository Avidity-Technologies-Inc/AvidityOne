import { BadRequestException } from "@nestjs/common";

export function validZone(zone: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(); return zone; }
  catch { throw new BadRequestException("Choose a valid IANA timezone, for example America/Chicago."); }
}
export function localDay(date: Date, zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function shiftDay(day: string, days: number) {
  const instant = Date.parse(`${day}T12:00:00Z`);
  if (!Number.isFinite(instant)) throw new BadRequestException("Invalid report date.");
  return new Date(instant + days * 86400000).toISOString().slice(0, 10);
}
export function zonedInstant(day: string, time: string, zone: string) {
  validZone(zone);
  const target = Date.parse(`${day}T${time}:00Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 10) !== day) throw new BadRequestException("Invalid report date.");
  let instant = target;
  const seen = new Set<number>();
  // Resolve wall clock time without depending on the API server's timezone.
  for (let i = 0; i < 4; i++) {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
    const get = (k: string) => p.find((x) => x.type === k)!.value;
    const wall = Date.parse(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`);
    if (wall === target) break;
    const next = instant + target - wall;
    if (seen.has(next)) return new Date(Math.max(next, instant));
    seen.add(instant);
    instant = next;
  }
  return new Date(instant);
}
export function reportRange(query: { startDate?: string; endDate?: string; period?: string }, zone: string, now = new Date()) {
  validZone(zone);
  const today = localDay(now, zone);
  let endDay = query.endDate?.slice(0, 10) ?? today;
  let startDay = query.startDate?.slice(0, 10) ?? shiftDay(endDay, -29);
  if (query.period && query.period !== "custom") {
    endDay = today;
    if (query.period === "last7" || query.period === "last30") startDay = shiftDay(today, query.period === "last7" ? -6 : -29);
    else if (query.period === "currentMonth") startDay = `${today.slice(0, 7)}-01`;
    else if (query.period === "previousMonth") { endDay = shiftDay(`${today.slice(0, 7)}-01`, -1); startDay = `${endDay.slice(0, 7)}-01`; }
    else if (query.period === "previousWeek") { const weekday = new Date(`${today}T12:00:00Z`).getUTCDay(); endDay = shiftDay(today, -(weekday || 7)); startDay = shiftDay(endDay, -6); }
    else throw new BadRequestException("Unknown relative reporting period.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDay) || !/^\d{4}-\d{2}-\d{2}$/.test(endDay) || startDay > endDay) throw new BadRequestException("Choose a valid start and end date.");
  const start = zonedInstant(startDay, "00:00", zone);
  const end = new Date(zonedInstant(shiftDay(endDay, 1), "00:00", zone).getTime() - 1);
  // Validate the end day itself as well (Date.parse normalizes invalid calendar days).
  zonedInstant(endDay, "00:00", zone);
  return { start, end, startDay, endDay, timeZone: zone };
}
export function periodKey(date: Date, grouping: string, zone: string) {
  const day = localDay(date, zone);
  if (grouping === "year") return day.slice(0, 4);
  if (grouping === "month") return day.slice(0, 7);
  if (grouping === "week") { const weekday = new Date(`${day}T12:00:00Z`).getUTCDay(); return shiftDay(day, -((weekday + 6) % 7)); }
  return day;
}
export type ScheduleTiming = { timeZone: string; time: string; weekDay: number; monthDay: number };
export function nextReportRun(frequency: string, timing: ScheduleTiming, now = new Date()) {
  validZone(timing.timeZone);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timing.time) || !Number.isInteger(timing.weekDay) || timing.weekDay < 0 || timing.weekDay > 6 || !Number.isInteger(timing.monthDay) || timing.monthDay < 1 || timing.monthDay > 31) throw new BadRequestException("Invalid report schedule time or day.");
  const today = localDay(now, timing.timeZone);
  for (let i = 0; i <= 370; i++) {
    const day = shiftDay(today, i);
    const d = new Date(`${day}T12:00:00Z`);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    if (frequency === "weekly" && d.getUTCDay() !== timing.weekDay) continue;
    if (frequency === "monthly" && d.getUTCDate() !== Math.min(timing.monthDay, last)) continue;
    const next = zonedInstant(day, timing.time, timing.timeZone);
    if (next > now) return next;
  }
  throw new BadRequestException("Cannot calculate the next report run.");
}
