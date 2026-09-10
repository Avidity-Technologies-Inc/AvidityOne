import { businessMinutes, sampleIds, scoreReview, validateCalendar, validateProgram } from "./qc.rules";
import { aggregateCycles } from "./qc.reports.service";
import { measureCycle, splitCycles, QcSourceEvent } from "./qc.measurement";
import { emptyQcConfiguration, QcCalendar, QcPolicyConfiguration } from "@avidity/shared/dist";
const calendar: QcCalendar = { timeZone: "America/Chicago", weekly: [{ day: 1, startMinute: 540, endMinute: 1020 }], holidays: [] };
const policy: QcPolicyConfiguration = { calendar, priority: null, firstResponseMetric: "PUBLIC_RESPONSE", firstResponseMinutes: 60, resolutionMinutes: 480, subsequentResponseMinutes: 30, warningPercent: 80, pauseStatusIds: ["waiting"], pauseScheduledWork: false, pauseClockKinds: ["FIRST_RESPONSE", "RESOLUTION", "SUBSEQUENT_RESPONSE"] };
const event = (kind: string, time: string, snapshot: unknown = {}, origin = "CAPTURED"): QcSourceEvent => ({ id: `${kind}:${time}`, kind, occurredAt: new Date(time), actorId: null, snapshot, origin });
describe("QC business rules", () => {
  it("counts partial minutes, holidays and overlapping pauses only once", () => {
    const start = new Date("2026-09-07T13:59:30Z"), end = new Date("2026-09-07T15:00:30Z");
    expect(businessMinutes(start, end, calendar)).toBe(60.5);
    expect(businessMinutes(start, end, { ...calendar, holidays: ["2026-09-07"] })).toBe(0);
    expect(businessMinutes(start, end, calendar, [{ start: new Date("2026-09-07T14:10:00Z"), end: new Date("2026-09-07T14:30:00Z") }, { start: new Date("2026-09-07T14:20:00Z"), end: new Date("2026-09-07T14:40:00Z") }])).toBe(30.5);
  });
  it("handles skipped and repeated daylight saving hours by actual elapsed time", () => {
    const sunday = { ...calendar, weekly: [{ day: 0, startMinute: 60, endMinute: 240 }] };
    expect(businessMinutes(new Date("2026-03-08T07:00:00Z"), new Date("2026-03-08T09:00:00Z"), sunday)).toBe(120);
    expect(businessMinutes(new Date("2026-11-01T06:00:00Z"), new Date("2026-11-01T10:00:00Z"), sunday)).toBe(240);
  });
  it("rejects overlapping coverage and malformed nested values", () => {
    expect(() => validateCalendar({ ...calendar, weekly: [...calendar.weekly, ...calendar.weekly] })).toThrow("overlap");
    expect(() => validateCalendar({ ...calendar, weekly: [null] } as unknown as QcCalendar)).toThrow("Invalid working interval");
    expect(() => validateProgram({ ...emptyQcConfiguration(), flags: [null] } as never)).toThrow("Invalid flag");
  });
  it("requires comments, handles N/A weighting and critical failures", () => {
    const criteria = [{ id: "a", label: "Resolution", weight: 80, critical: false, allowNotApplicable: false }, { id: "b", label: "Proof", weight: 20, critical: true, allowNotApplicable: true }];
    expect(scoreReview(criteria, [{ criterionId: "a", outcome: "PASS", comment: "" }, { criterionId: "b", outcome: "NA", comment: "No creative work" }], 90)).toEqual({ score: 100, status: "PASSED" });
    expect(scoreReview(criteria, [{ criterionId: "a", outcome: "PASS", comment: "" }, { criterionId: "b", outcome: "FAIL", comment: "Proof missing" }], 70)).toEqual({ score: 80, status: "FAILED" });
    expect(() => scoreReview(criteria, [{ criterionId: "a", outcome: "PASS", comment: "" }, { criterionId: "b", outcome: "FAIL", comment: " " }], 70)).toThrow("comment");
    expect(() => scoreReview(criteria, [null, null] as never, 70)).toThrow("exactly once");
  });
  it("samples reproducibly independent of input order and applies ceiling/minimum", () => {
    const ids = ["a", "b", "c", "d", "e"];
    expect(sampleIds(ids, 25, 0, "period")).toEqual(sampleIds([...ids].reverse(), 25, 0, "period"));
    expect(sampleIds(ids, 25, 0, "period")).toHaveLength(2);
    expect(sampleIds(ids, 0, 3, "period")).toHaveLength(3);
    expect(sampleIds(ids, 100, 20, "period")).toHaveLength(5);
  });
  it("distinguishes internal touch from public response and pauses configured waiting", () => {
    const events = [event("CREATED", "2026-09-07T14:00:00Z", { category: "NEW" }), event("TECHNICAL_TOUCH", "2026-09-07T14:10:00Z"), event("TICKET_CHANGED", "2026-09-07T14:20:00Z", { statusDefinitionId: "waiting" }), event("TICKET_CHANGED", "2026-09-07T15:20:00Z", { statusDefinitionId: "active" }), event("PUBLIC_RESPONSE", "2026-09-07T15:30:00Z")];
    const measured = measureCycle(events, policy, new Date("2026-09-07T16:00:00Z"));
    expect(measured.clocks[0].elapsedMinutes).toBe(30);
    expect(measureCycle(events, { ...policy, firstResponseMetric: "TECHNICAL_TOUCH" }, new Date("2026-09-07T16:00:00Z")).clocks[0].elapsedMinutes).toBe(10);
  });
  it("keeps reopen cycles and missing historical evidence separate", () => {
    const events = [event("CREATED", "2026-09-07T14:00:00Z", {}, "HISTORICAL"), event("TICKET_CHANGED", "2026-09-07T14:30:00Z", { category: "CLOSED" }), event("REOPENED", "2026-09-07T15:00:00Z", { category: "ACTIVE" })];
    const cycles = splitCycles(events); expect(cycles).toHaveLength(2);
    expect(measureCycle(cycles[0], policy, new Date("2026-09-07T16:00:00Z")).complete).toBe(false);
    expect(measureCycle(cycles[1], policy, new Date("2026-09-07T16:00:00Z")).complete).toBe(true);
  });
  it("does not count an unresolved obligation as compliant or invent empty averages", () => {
    const measured = measureCycle([event("CREATED", "2026-09-07T14:00:00Z")], policy, new Date("2026-09-07T14:10:00Z"));
    expect(aggregateCycles([{ complete: true, measurement: measured }])).toMatchObject({ evaluatedObligations: 0, slaCompliancePercent: null, averageFirstResponseBusinessMinutes: null });
    expect(aggregateCycles([{ complete: false, measurement: measured }]).completeCycles).toBe(0);
  });
});
