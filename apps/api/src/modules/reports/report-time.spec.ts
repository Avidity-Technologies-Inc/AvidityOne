import { localDay, nextReportRun, periodKey, reportRange, zonedInstant } from "./report-time";

describe("Report calendar boundaries", () => {
  it("preserves inclusive selected calendar days regardless of the server timezone", () => {
    const range = reportRange({ startDate: "2026-08-01", endDate: "2026-08-31" }, "America/Chicago");
    expect(range.start.toISOString()).toBe("2026-08-01T05:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-09-01T04:59:59.999Z");
    expect(range.startDay).toBe("2026-08-01");
  });
  it.each([["2026-03-08", 23], ["2026-11-01", 25]])("uses real DST duration for %s", (day, hours) => {
    const r = reportRange({ startDate: String(day), endDate: String(day) }, "America/Chicago");
    expect(r.end.getTime() + 1 - r.start.getTime()).toBe(Number(hours) * 3600000);
  });
  it("rejects invalid dates, reversed dates and unsupported zones", () => {
    for (const query of [{ startDate: "2026-02-30" }, { endDate: "2026-02-30" }, { startDate: "2026-09-20", endDate: "2026-09-19" }]) expect(() => reportRange(query, "UTC")).toThrow();
    expect(() => reportRange({}, "Invalid/Zone")).toThrow();
  });
  it("recomputes prior month and prior week from local time", () => {
    const now = new Date("2026-09-01T01:00:00Z");
    const r = reportRange({ period: "previousMonth" }, "America/Chicago", now);
    expect([r.startDay, r.endDay]).toEqual(["2026-07-01", "2026-07-31"]);
    const week = reportRange({ period: "previousWeek" }, "America/Chicago", new Date("2026-09-21T15:00:00Z"));
    expect([week.startDay, week.endDay]).toEqual(["2026-09-14", "2026-09-20"]);
  });
  it("clamps the monthly day and retains the local hour across DST", () => {
    const timing = { timeZone: "America/Chicago", time: "09:00", monthDay: 31, weekDay: 1 };
    expect(nextReportRun("monthly", timing, new Date("2026-02-01T00:00:00Z")).toISOString()).toBe("2026-02-28T15:00:00.000Z");
    expect(nextReportRun("daily", timing, new Date("2026-03-07T16:00:00Z")).toISOString()).toBe("2026-03-08T14:00:00.000Z");
  });
  it("moves a nonexistent spring-forward time to the next valid local hour", () => {
    expect(zonedInstant("2026-03-08", "02:30", "America/Chicago").toISOString()).toBe("2026-03-08T08:30:00.000Z");
  });
  it("uses Monday's date as a stable weekly bucket at a year boundary", () => {
    expect(periodKey(new Date("2026-01-01T17:00:00Z"), "week", "America/Chicago")).toBe("2025-12-29");
    expect(localDay(zonedInstant("2026-09-21", "09:00", "Pacific/Auckland"), "Pacific/Auckland")).toBe("2026-09-21");
  });
});
