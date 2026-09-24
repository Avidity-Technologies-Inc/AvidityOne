import { OperationsService, OperationsWorkItem } from "./operations.service";

describe("OperationsService", () => {
  it("keeps all active work and same-name specialists distinct, including group assignments", async () => {
    const specialists = Array.from({ length: 14 }, (_, i) => ({ id: `user-${i}`, firstName: "Alex", lastName: "Example" }));
    const tickets = Array.from({ length: 181 }, (_, i) => ({ id: `ticket-${i}`, ticketNumber: `AIT-${i}`, subject: "Synthetic work", status: "OPEN", priority: "NORMAL", targetDate: null, updatedAt: new Date(), client: null, assignedUser: specialists[i % 14], assignedTeam: null, assignedGroup: null, assignees: [{ user: specialists[i % 14] }] }));
    const groupTicket = { ...tickets[0], id: "group-ticket", assignedUser: null, assignedGroup: { name: "Dispatch" }, assignees: [] };
    const prisma = { ticket: { findMany: jest.fn().mockResolvedValue([...tickets, groupTicket]) }, eventServiceRequest: { findMany: jest.fn() }, eventServiceTask: { findMany: jest.fn() }, project: { findMany: jest.fn() }, ticketMeeting: { findMany: jest.fn().mockResolvedValue([{ id: "scheduled-activity" }]) } };
    const service = new OperationsService(prisma as never, { getOperationsSettings: async () => ({ capacityBaseline: 12, capacityWarningPercent: 75, dueSoonDays: 7 }) } as never);
    const overview = await service.overview({ id: "user-0", organizationId: "org", permissions: ["operations.view", "tickets.view", "ticket_meetings.view"] } as never);
    expect(overview.items).toHaveLength(182);
    expect(overview.summary.activeTickets).toBe(182);
    expect(overview.summary.unassignedTickets).toBe(0);
    expect(overview.workload).toHaveLength(14);
    expect(overview.workload.reduce((sum, row) => sum + row.total, 0)).toBe(181);
    expect(overview.agenda).toEqual([{ id: "scheduled-activity" }]);
    expect(prisma.ticket.findMany.mock.calls[0][0]).not.toHaveProperty("take");
    expect(prisma.eventServiceRequest.findMany).not.toHaveBeenCalled();
    expect(prisma.eventServiceTask.findMany).not.toHaveBeenCalled();
    expect(prisma.project.findMany).not.toHaveBeenCalled();
    expect(prisma.ticketMeeting.findMany.mock.calls[0][0].where.organizationId).toBe("org");
  });

  it("calculates specialist capacity independently for shared work", () => {
    const service = new OperationsService({} as never, {} as never);
    const workload = (service as unknown as { workload(items: OperationsWorkItem[], capacityBaseline: number, capacityWarningPercent: number): Array<{ owner: string; total: number; attention: number; capacityStatus: string }> }).workload(
      Array.from({ length: 12 }, (_, index) => ({
        id: `item-${index}`,
        kind: "TICKET" as const,
        reference: `AIT-${index}`,
        title: "Work item",
        clientName: null,
        status: "OPEN",
        priority: "NORMAL" as never,
        owner: "Alex Example, Blair Example",
        teamName: null,
        dueAt: null,
        updatedAt: new Date(),
        href: "/tickets/example",
        attention: index === 0,
        internalOwners: ["Alex Example", "Blair Example"]
      })),
      12,
      75
    );

    expect(workload).toEqual(expect.arrayContaining([
      expect.objectContaining({ owner: "Alex Example", total: 12, attention: 1, capacityStatus: "OVER_CAPACITY" }),
      expect.objectContaining({ owner: "Blair Example", total: 12, attention: 1, capacityStatus: "OVER_CAPACITY" })
    ]));
  });

  it("uses the configured warning threshold before capacity is exceeded", () => {
    const service = new OperationsService({} as never, {} as never);
    const workload = (service as unknown as { workload(items: OperationsWorkItem[], capacityBaseline: number, capacityWarningPercent: number): Array<{ capacityStatus: string }> }).workload(
      Array.from({ length: 8 }, (_, index) => ({
        id: `item-${index}`,
        kind: "TICKET" as const,
        reference: `AIT-${index}`,
        title: "Work item",
        clientName: null,
        status: "OPEN",
        priority: "NORMAL" as never,
        owner: "Alex Example",
        teamName: null,
        dueAt: null,
        updatedAt: new Date(),
        href: "/tickets/example",
        attention: false,
        internalOwners: ["Alex Example"]
      })),
      12,
      60
    );

    expect(workload).toEqual([expect.objectContaining({ capacityStatus: "NEAR_CAPACITY" })]);
  });

  it("retains capacity above 100 percent so overload is visible to operations", () => {
    const service = new OperationsService({} as never, {} as never);
    const workload = (service as unknown as { workload(items: OperationsWorkItem[], capacityBaseline: number, capacityWarningPercent: number): Array<{ capacityPercent: number; capacityStatus: string }> }).workload(
      Array.from({ length: 15 }, (_, index) => ({
        id: `item-${index}`,
        kind: "TICKET" as const,
        reference: `AIT-${index}`,
        title: "Work item",
        clientName: null,
        status: "OPEN",
        priority: "NORMAL" as never,
        owner: "Alex Example",
        teamName: null,
        dueAt: null,
        updatedAt: new Date(),
        href: "/tickets/example",
        attention: false,
        internalOwners: ["Alex Example"]
      })),
      12,
      75
    );

    expect(workload).toEqual([expect.objectContaining({ capacityPercent: 125, capacityStatus: "OVER_CAPACITY" })]);
  });

  it("adds project commitments to projected capacity without treating them as operational work", () => {
    const service = new OperationsService({} as never, {} as never);
    const workload = (service as unknown as { workload(items: OperationsWorkItem[], capacityBaseline: number, capacityWarningPercent: number, projectCommitments: Array<{ owner: string; attention: boolean }>): Array<{ owner: string; operational: number; projectCommitments: number; total: number; attention: number; capacityStatus: string }> }).workload(
      Array.from({ length: 4 }, (_, index) => ({
        id: `item-${index}`,
        kind: "TICKET" as const,
        reference: `AIT-${index}`,
        title: "Work item",
        clientName: null,
        status: "OPEN",
        priority: "NORMAL" as never,
        owner: "Alex Example",
        teamName: null,
        dueAt: null,
        updatedAt: new Date(),
        href: "/tickets/example",
        attention: false,
        internalOwners: ["Alex Example"]
      })),
      7,
      75,
      [
        { owner: "Alex Example", attention: false },
        { owner: "Alex Example", attention: true },
        { owner: "Alex Example", attention: false }
      ]
    );

    expect(workload).toEqual([expect.objectContaining({ owner: "Alex Example", operational: 4, projectCommitments: 3, total: 7, attention: 1, capacityStatus: "OVER_CAPACITY" })]);
  });

  it("surfaces open project decisions in the operational decision queue", async () => {
    const prisma = {
      ticket: { findMany: jest.fn().mockResolvedValue([]) },
      eventServiceRequest: { findMany: jest.fn().mockResolvedValue([]) },
      eventServiceTask: { findMany: jest.fn().mockResolvedValue([]) },
      project: {
        findMany: jest.fn().mockResolvedValue([{
          id: "project-1",
          name: "Network rollout",
          status: "ACTIVE",
          health: "AT_RISK",
          targetDate: null,
          updatedAt: new Date("2026-07-20T12:00:00.000Z"),
          client: { name: "Avidity" },
          owner: { firstName: "Alex", lastName: "Example" },
          milestones: [],
          decisions: [{ id: "decision-1", title: "Confirm maintenance window", description: "Coordinate the client window.", status: "OPEN", dueAt: null, createdAt: new Date("2026-07-19T12:00:00.000Z"), owner: { firstName: "Blair", lastName: "Example" } }],
          dependencies: []
        }])
      }
    };
    const settings = { getOperationsSettings: jest.fn().mockResolvedValue({ capacityBaseline: 12, capacityWarningPercent: 75, dueSoonDays: 7 }) };
    const service = new OperationsService(prisma as never, settings as never);
    const user = { id: "user-1", organizationId: "org-1", email: "manager@example.com", firstName: "Project", lastName: "Manager", forcePasswordChange: false, permissions: ["projects.view"] };

    const overview = await service.overview(user);

    expect(overview.summary.openProjectDecisions).toBe(1);
    expect(overview.decisions).toEqual([expect.objectContaining({ id: "decision-1", projectName: "Network rollout", owner: "Blair Example", attention: true, href: "/projects?project=project-1" })]);
  });
});
