import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { QC_FLAG_CODES, QC_NOTIFICATION_EVENTS, emptyQcConfiguration, QcCalendar, QcCriterion, QcCriterionResult, QcPolicyConfiguration, QcProgramConfiguration } from "@avidity/shared/dist";

export function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new BadRequestException(message);
}
function allowedKeys(value: object, keys: string[]) {
  requireValue(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)), "Configuration contains unsupported fields.");
}
export const finiteRange = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
export function validateCalendar(calendar: QcCalendar) {
  allowedKeys(calendar, ["timeZone", "weekly", "holidays"]);
  requireValue(calendar && typeof calendar.timeZone === "string", "Choose a calendar time zone.");
  try { new Intl.DateTimeFormat("en", { timeZone: calendar.timeZone }).format(); } catch { throw new BadRequestException("Invalid calendar time zone."); }
  requireValue(Array.isArray(calendar.weekly) && calendar.weekly.length > 0 && calendar.weekly.length <= 70, "Define working intervals.");
  requireValue(calendar.weekly.every(slot => slot && typeof slot === "object"), "Invalid working interval.");
  const sorted = [...calendar.weekly].sort((a, b) => a.day - b.day || a.startMinute - b.startMinute);
  for (let i = 0; i < sorted.length; i++) {
    const slot = sorted[i];
    allowedKeys(slot, ["day", "startMinute", "endMinute"]);
    requireValue(Number.isInteger(slot.day) && finiteRange(slot.day, 0, 6) && Number.isInteger(slot.startMinute) && finiteRange(slot.startMinute, 0, 1439) && Number.isInteger(slot.endMinute) && finiteRange(slot.endMinute, 1, 1440) && slot.endMinute > slot.startMinute, "Invalid working interval. Split overnight coverage at midnight.");
    requireValue(!i || sorted[i - 1].day !== slot.day || sorted[i - 1].endMinute <= slot.startMinute, "Working intervals overlap.");
  }
  requireValue(Array.isArray(calendar.holidays) && calendar.holidays.length <= 2000 && calendar.holidays.every(day => /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day), "Invalid holiday dates.");
}
export function validatePolicy(config: QcPolicyConfiguration) {
  requireValue(config && typeof config === "object", "An SLA configuration is required.");
  allowedKeys(config, ["calendar", "priority", "firstResponseMetric", "firstResponseMinutes", "resolutionMinutes", "subsequentResponseMinutes", "warningPercent", "pauseStatusIds", "pauseScheduledWork", "pauseClockKinds"]);
  validateCalendar(config.calendar);
  requireValue(typeof config.pauseScheduledWork === "boolean" && Array.isArray(config.pauseClockKinds) && config.pauseClockKinds.every(value => ["FIRST_RESPONSE", "RESOLUTION", "SUBSEQUENT_RESPONSE"].includes(value)), "Configure which SLA clocks can pause.");
  requireValue(["PUBLIC_RESPONSE", "TECHNICAL_TOUCH"].includes(config.firstResponseMetric), "Choose the first-response definition.");
  requireValue(finiteRange(config.firstResponseMinutes, 1, 525600) && finiteRange(config.resolutionMinutes, 1, 525600), "Response and resolution targets must be positive minutes.");
  requireValue(config.subsequentResponseMinutes === null || finiteRange(config.subsequentResponseMinutes, 1, 525600), "Invalid subsequent-response target.");
  requireValue(finiteRange(config.warningPercent, 1, 99), "Warning threshold must be between 1 and 99 percent.");
  requireValue(config.priority === null || ["LOW", "NORMAL", "HIGH", "URGENT", "CRITICAL"].includes(config.priority), "Invalid priority.");
  requireValue(Array.isArray(config.pauseStatusIds) && config.pauseStatusIds.length <= 100 && config.pauseStatusIds.every(id => typeof id === "string"), "Invalid pause statuses.");
}
export function validateRubric(criteria: QcCriterion[], threshold: number, reinspectionCount: number) {
  requireValue(Array.isArray(criteria) && criteria.length > 0 && criteria.length <= 50, "A rubric needs 1–50 criteria.");
  requireValue(finiteRange(threshold, 0, 100), "Pass threshold must be between 0 and 100.");
  requireValue(Number.isInteger(reinspectionCount) && finiteRange(reinspectionCount, 0, 100), "Invalid reinspection count.");
  const ids = new Set<string>();
  for (const item of criteria) {
    requireValue(item && typeof item.id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(item.id) && !ids.has(item.id), "Criterion identifiers must be unique.");
    requireValue(typeof item.label === "string" && item.label.trim().length > 0 && item.label.length <= 200 && finiteRange(item.weight, 0.01, 1000), "Each criterion needs a label and a positive weight.");
    requireValue(typeof item.critical === "boolean" && typeof item.allowNotApplicable === "boolean", "Define critical and not-applicable behavior for each criterion.");
    allowedKeys(item, ["id", "label", "weight", "critical", "allowNotApplicable"]);
    ids.add(item.id);
  }
}
export function scoreReview(criteria: QcCriterion[], results: QcCriterionResult[], threshold: number) {
  requireValue(Array.isArray(results) && results.length === criteria.length && results.every(result => result && typeof result === "object") && new Set(results.map(result => result.criterionId)).size === results.length, "Score every criterion exactly once.");
  let possible = 0; let earned = 0; let criticalFailure = false;
  for (const criterion of criteria) {
    const result = results.find(item => item.criterionId === criterion.id);
    requireValue(result && ["PASS", "FAIL", "NA"].includes(result.outcome), "Invalid criterion result.");
    requireValue(typeof result.comment === "string" && result.comment.length <= 5000, "Invalid reviewer comment.");
    requireValue(result.outcome !== "FAIL" || result.comment.trim(), "Every failed criterion requires a comment.");
    requireValue(result.outcome !== "NA" || criterion.allowNotApplicable, "This criterion cannot be marked not applicable.");
    if (result.outcome !== "NA") { possible += criterion.weight; if (result.outcome === "PASS") earned += criterion.weight; }
    if (criterion.critical && result.outcome === "FAIL") criticalFailure = true;
  }
  requireValue(possible > 0, "At least one criterion must apply.");
  const exactScore = earned / possible * 100;
  return { score: Math.round(exactScore * 100) / 100, status: !criticalFailure && exactScore >= threshold ? "PASSED" : "FAILED" };
}
export function validateProgram(config: QcProgramConfiguration) {
  requireValue(config && typeof config === "object", "Program configuration is required.");
  allowedKeys(config, Object.keys(emptyQcConfiguration()));
  for (const key of ["leadershipIds", "anchorClientIds", "samplingDimensions", "flags", "routes"] as const) requireValue(Array.isArray(config[key]) && config[key].length <= 200, `Invalid ${key}.`);
  for (const key of ["ownerId", "serviceRubricId", "creativeRubricId", "mailboxId"] as const) requireValue(config[key] === null || (typeof config[key] === "string" && /^[0-9a-f-]{36}$/i.test(config[key]!)), `Invalid ${key}.`);
  for (const key of ["leadershipIds", "anchorClientIds"] as const) requireValue(config[key].every(id => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)), `Invalid ${key}.`);
  for (const [key, max] of [["samplingPercent", 100], ["samplingPeriodDays", 366], ["samplingMinimum", 10000], ["queueAgingMinutes", 525600], ["laborThresholdMinutes", 525600], ["dailyDigestMinute", 1439], ["weeklyDigestDay", 6], ["maxNotificationsPerHour", 1000]] as const) requireValue(config[key] === null || finiteRange(config[key], 0, max), `Invalid ${key}.`);
  requireValue(config.samplingPeriodDays === null || (Number.isInteger(config.samplingPeriodDays) && config.samplingPeriodDays > 0), "Sampling period must be a positive whole number of days.");
  requireValue(config.samplingMinimum === null || Number.isInteger(config.samplingMinimum), "Sampling minimum must be a whole number.");
  requireValue(config.maxNotificationsPerHour === null || (Number.isInteger(config.maxNotificationsPerHour) && config.maxNotificationsPerHour > 0), "Notification limit must be positive.");
  requireValue(config.samplingDimensions.every(value => ["TECHNICIAN", "CLIENT", "CATEGORY"].includes(value)), "Invalid sampling dimensions.");
  requireValue(config.flags.every(flag => flag && typeof flag === "object") && config.routes.every(route => route && typeof route === "object"), "Invalid flag or notification rule.");
  for (const flag of config.flags) allowedKeys(flag, ["code", "enabled", "severity", "threshold"]);
  for (const route of config.routes) allowedKeys(route, ["event", "channel", "audiences", "delayMinutes", "stopOnAcknowledgment"]);
  requireValue(new Set(config.flags.map(flag => flag.code)).size === config.flags.length, "Flag rules must not repeat.");
  for (const flag of config.flags) requireValue(QC_FLAG_CODES.includes(flag.code) && typeof flag.enabled === "boolean" && ["LOW", "MEDIUM", "HIGH"].includes(flag.severity) && (flag.threshold === null || finiteRange(flag.threshold, 0, 525600)), "Invalid flag configuration.");
  for (const route of config.routes) requireValue(QC_NOTIFICATION_EVENTS.includes(route.event) && ["IN_APP", "OUTLOOK", "TEAMS", "TEAMS_DIRECT"].includes(route.channel) && (route.stopOnAcknowledgment === undefined || typeof route.stopOnAcknowledgment === "boolean") && finiteRange(route.delayMinutes, 0, 525600) && Array.isArray(route.audiences) && route.audiences.length > 0 && route.audiences.every(value => ["TECHNICIAN", "QC_OWNER", "LEADERSHIP"].includes(value)), "Invalid notification route.");
  requireValue(typeof config.teamsChannelIncludeWorkDetails === "boolean", "Define Teams channel detail visibility.");
  requireValue(typeof config.urgentOutsideHours === "boolean", "Define quiet-hours behavior.");
  requireValue(config.failureConsequence === null || ["COACHING", "BILLING_HOLD"].includes(config.failureConsequence), "Invalid failure consequence.");
  requireValue(config.historicalMeasurement === null || ["FORWARD_ONLY", "INCLUDE_HISTORY"].includes(config.historicalMeasurement), "Choose the historical measurement mode.");
  requireValue(config.teamsSecretReference === null || /^env:[A-Z][A-Z0-9_]{1,100}$/.test(config.teamsSecretReference), "Teams credentials must be an environment reference.");
  requireValue(Array.isArray(config.creativeCheckpoints) && config.creativeCheckpoints.every(value => ["PROOF_SENT", "DELIVER"].includes(value)), "Choose creative inspection checkpoints.");
  for (const key of ["teamsTenantId", "teamsAppId", "teamsTeamId", "teamsChannelId"] as const) requireValue(config[key] === null || typeof config[key] === "string" && config[key]!.length > 0 && config[key]!.length <= 500, `Invalid ${key}.`);
  requireValue(config.rmmVerificationMode === null || ["CHECK_IN", "ALERT_CLEAR"].includes(config.rmmVerificationMode), "Invalid RMM verification mode.");
  requireValue(config.rmmEvidenceFreshnessMinutes === null || finiteRange(config.rmmEvidenceFreshnessMinutes, 1, 525600), "Invalid RMM evidence freshness.");
  requireValue(Array.isArray(config.rmmClearedStatuses) && config.rmmClearedStatuses.length <= 30 && config.rmmClearedStatuses.every(value => typeof value === "string" && value.length > 0 && value.length <= 100), "Invalid RMM clearance statuses.");
  requireValue(config.varianceBaselineMinimum === null || Number.isInteger(config.varianceBaselineMinimum) && finiteRange(config.varianceBaselineMinimum, 1, 10000), "Invalid variance baseline size.");
  requireValue(config.varianceThresholdPercent === null || finiteRange(config.varianceThresholdPercent, 1, 10000), "Invalid variance threshold.");
  if (config.deliveryCalendar) validateCalendar(config.deliveryCalendar);
}

const formatters = new Map<string, Intl.DateTimeFormat>();
export function calendarPosition(date: Date, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) { formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); formatters.set(timeZone, formatter); }
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return { day, weekday: new Date(`${day}T12:00:00Z`).getUTCDay(), minute: Number(parts.hour) * 60 + Number(parts.minute) };
}
export function isWorkingTime(date: Date, calendar: QcCalendar) {
  const position = calendarPosition(date, calendar.timeZone);
  return !calendar.holidays.includes(position.day) && calendar.weekly.some(slot => slot.day === position.weekday && position.minute >= slot.startMinute && position.minute < slot.endMinute);
}
// Cache actual UTC coverage, including offset transitions, by calendar content and UTC day.
const coverageCache = new Map<string, Array<[number, number]>>();
function coverage(day: number, calendar: QcCalendar, calendarKey: string) {
  const key = `${calendarKey}:${day}`;
  const cached = coverageCache.get(key); if (cached) return cached;
  const ranges: Array<[number, number]> = [];
  for (let hour = day; hour < day + 86400000; hour += 3600000) {
    const first = calendarPosition(new Date(hour), calendar.timeZone);
    const last = calendarPosition(new Date(hour + 3540000), calendar.timeZone);
    if (first.day === last.day && last.minute - first.minute === 59) {
      if (calendar.holidays.includes(first.day)) continue;
      for (const slot of calendar.weekly.filter(item => item.day === first.weekday)) {
        const begin = Math.max(first.minute, slot.startMinute), end = Math.min(first.minute + 60, slot.endMinute);
        if (end > begin) ranges.push([hour + (begin - first.minute) * 60000, hour + (end - first.minute) * 60000]);
      }
    } else for (let minute = hour; minute < hour + 3600000; minute += 60000) if (isWorkingTime(new Date(minute), calendar)) ranges.push([minute, minute + 60000]);
  }
  if (coverageCache.size >= 4096) coverageCache.delete(coverageCache.keys().next().value!);
  coverageCache.set(key, ranges); return ranges;
}
export function businessMinutes(start: Date, end: Date, calendar: QcCalendar, pauses: Array<{ start: Date; end: Date }> = []) {
  requireValue(Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()), "Invalid clock dates.");
  if (end <= start) return 0;
  requireValue(end.getTime() - start.getTime() <= 366 * 3 * 86400000, "This interval requires an explicit historical calculation.");
  const holds = pauses.filter(pause => pause.end > start && pause.start < end).sort((a, b) => a.start.getTime() - b.start.getTime());
  const calendarKey = JSON.stringify(calendar);
  let total = 0;
  for (let day = Math.floor(start.getTime() / 86400000) * 86400000; day < end.getTime(); day += 86400000) {
    for (const [begin, finish] of coverage(day, calendar, calendarKey)) {
      let cursor = Math.max(begin, start.getTime()); const stop = Math.min(finish, end.getTime());
      if (cursor >= stop) continue;
      for (const hold of holds) { if (hold.start.getTime() >= stop) break; if (hold.end.getTime() <= cursor) continue; total += Math.max(0, Math.min(stop, hold.start.getTime()) - cursor); cursor = Math.max(cursor, Math.min(stop, hold.end.getTime())); }
      total += Math.max(0, stop - cursor);
    }
  }
  return total / 60000;
}
export function sampleIds(ids: string[], percentage: number, minimum: number, seed: string) {
  const population = [...new Set(ids)];
  const count = Math.min(population.length, Math.max(minimum, Math.ceil(population.length * percentage / 100)));
  return population.sort((a, b) => createHash("sha256").update(`${seed}:${a}`).digest("hex").localeCompare(createHash("sha256").update(`${seed}:${b}`).digest("hex"))).slice(0, count);
}
