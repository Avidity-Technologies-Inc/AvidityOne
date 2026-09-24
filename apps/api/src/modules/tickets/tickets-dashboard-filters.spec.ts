import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { TicketsService } from "./tickets.service";
import { TicketViewStateDto } from "./dto/upsert-ticket-view.dto";

describe("Dashboard calendar and drill-down consistency", () => {
  const service = Object.create(TicketsService.prototype) as any;
  it("preserves stale, high-priority and truly unassigned predicates in the ticket list", () => {
    const where = service.buildTicketListWhere({ id: "user", organizationId: "org" }, { scope: "unassigned", updatedBefore: "2026-09-17T15:00:00Z", highPriority: "true", statuses: "NEW,OPEN" });
    expect(where).toMatchObject({ organizationId: "org", deletedAt: null });
    expect(where.AND).toEqual(expect.arrayContaining([
      { updatedAt: { lt: new Date("2026-09-17T15:00:00Z") } },
      { priority: { in: ["HIGH", "URGENT", "CRITICAL"] } },
      { assignedUserId: null, assignedTeamId: null, assignedGroupId: null, assignees: { none: {} } }
    ]));
  });
  it("groups midnight and DST transitions in the organization timezone", () => {
    const points = service.buildActivityByDay([
      { createdAt: new Date("2026-11-01T04:59:00Z") },
      { createdAt: new Date("2026-11-01T06:30:00Z") },
      { createdAt: new Date("2026-11-01T07:30:00Z") }
    ], [], "America/Chicago", "2026-10-31");
    expect(points[0]).toMatchObject({ date: "2026-10-31", created: 1 });
    expect(points[1]).toMatchObject({ date: "2026-11-01", created: 2 });
    expect(points).toHaveLength(30);
    expect(service.buildCreatedByHour([{ createdAt: new Date("2026-11-01T06:30:00Z") }, { createdAt: new Date("2026-11-01T07:30:00Z") }], "America/Chicago")[1].count).toBe(2);
  });
  it("retains and validates dashboard predicates in saved views", async () => {
    const state = plainToInstance(TicketViewStateDto, { updatedBefore: "2026-09-17T15:00:00Z", highPriority: true });
    expect(await validate(state, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(state.highPriority).toBe(true);
    expect(await validate(plainToInstance(TicketViewStateDto, { updatedBefore: "", highPriority: false }))).toEqual([]);
    expect(await validate(plainToInstance(TicketViewStateDto, { updatedBefore: "not-a-date" }))).not.toEqual([]);
  });
});
