import { ReportsService } from "./reports.service";
import { PrismaService } from "../prisma/prisma.service";
import { MailDeliveryService } from "../mailboxes/mail-delivery.service";
import { LocalFileStorageProvider } from "../file-storage/providers/local-file-storage.provider";
import { AuthenticatedUser } from "../auth/auth.types";

const user: AuthenticatedUser = { id: "11111111-1111-4111-8111-111111111111", organizationId: "22222222-2222-4222-8222-222222222222", firstName: "Test", lastName: "Reviewer", email: "test@example.invalid", forcePasswordChange: false, permissions: ["reports.view", "reports.export", "reports.send", "reports.manage"] };
const ticket = (i: number) => ({ id: String(i), ticketNumber: `SYN-${i}`, subject: "Synthetic subject", status: "CLOSED", statusDefinition: { id: "status", name: "Awaiting Equipment", color: "#336699" }, priority: "NORMAL", source: "EMAIL", senderEmail: "requester@example.invalid", assignedUserId: "tech", assignedTeamId: null, createdAt: new Date("2026-08-15T14:00:00Z"), updatedAt: new Date("2026-09-10T14:00:00Z"), closedAt: new Date("2026-09-10T14:00:00Z"), resolvedAt: null, client: { id: "client", name: "ISFA" }, contact: null, assignedUser: { firstName: "Mary Ann", lastName: "Smith" }, assignedTeam: null, assignees: [{ userId: "tech", user: { id: "tech", firstName: "Mary Ann", lastName: "Smith" } }, { userId: "other", user: { id: "other", firstName: "Luis", lastName: "Mena" } }], _count: { attachments: 2 } });
function setup(count = 2) {
  const records = Array.from({ length: count }, (_, i) => ticket(i));
  const db = {
    $transaction: jest.fn(),
    systemSetting: { findUnique: jest.fn().mockResolvedValue({ defaultTimezone: "America/Chicago", defaultLanguage: "en", applicationName: "Synthetic platform", companyName: "Synthetic org", primaryColor: "#155eef" }) },
    ticket: { findMany: jest.fn().mockImplementation(async ({ skip = 0, take = count }) => records.slice(skip, skip + take)) },
    client: { findMany: jest.fn().mockResolvedValue([]) }, user: { findMany: jest.fn().mockResolvedValue([]) }, ticketTeam: { findMany: jest.fn().mockResolvedValue([]) }, ticketStatusDefinition: { findMany: jest.fn().mockResolvedValue([]) },
    qcReview: { count: jest.fn().mockResolvedValue(0) }, reportExport: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({}) },
    reportDefinition: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    reportSchedule: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) }
  };
  db.$transaction.mockImplementation((fn) => fn(db));
  const mail = { sendTicketReply: jest.fn().mockResolvedValue({ providerMessageId: "provider-synthetic" }) };
  const service = new ReportsService(db as unknown as PrismaService, mail as unknown as MailDeliveryService, {} as LocalFileStorageProvider);
  return { service, db, mail, records };
}
const query = { startDate: "2026-08-01", endDate: "2026-08-31" };
describe("Report totals, access and delivery", () => {
  it("counts every matching record beyond 2000 and paginates the ordered snapshot", async () => {
    const { service, db } = setup(2105);
    const result = await service.ticketSummary(user, { ...query, page: "85" });
    expect(result.totalMatched).toBe(2105); expect(result.detail).toHaveLength(5); expect(result.detail[4].ticketNumber).toBe("SYN-2104");
    expect(db.ticket.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 2000, take: 1000, where: expect.objectContaining({ organizationId: user.organizationId, deletedAt: null, createdAt: { gte: new Date("2026-08-01T05:00:00Z"), lte: new Date("2026-09-01T04:59:59.999Z") } }) }));
    expect(result.activity.reduce((sum, day) => sum + Number(day.closed), 0)).toBe(0);
    expect(result.activity).toHaveLength(31);
    expect(result.byTechnician).toEqual([{ label: "Luis Mena", count: 2105 }, { label: "Mary Ann Smith", count: 2105 }]);
    expect(result.byClient).toEqual([{ label: "ISFA", count: 2105 }]);
    expect(result.detail[0].assignedTo).toBe("Mary Ann Smith, Luis Mena");
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "RepeatableRead" }));
  });
  it("preserves explicit zero estimates and enforces QC holds", async () => {
    const { service, db } = setup();
    const q = { ...query, estimateMode: "perTicket" as const, currency: "CAD", valuePerTicket: "0" };
    expect((await service.ticketSummary(user, q)).summary.estimatedTotal).toBe(0);
    db.qcReview.count.mockResolvedValue(1);
    await expect(service.ticketSummary(user, q)).rejects.toThrow("QC billing hold");
    expect(db.qcReview.count).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: user.organizationId }) }));
    expect(() => service.ticketSummary(user, { ...q, currency: undefined })).toThrow("currency");
  });
  it("filters configured status IDs and excludes merged tickets even with explicit statuses", async () => {
    const { service, db } = setup();
    await service.ticketSummary(user, { ...query, statuses: "CLOSED,MERGED", statusDefinitionId: "custom-status" });
    expect(db.ticket.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { in: ["CLOSED", "MERGED"], not: "MERGED" }, statusDefinitionId: "custom-status" }) }));
    await expect(service.ticketSummary(user, { ...query, statuses: "INVALID" })).rejects.toThrow("Unknown report status");
  });
  it("does not expose other users' private definitions or exports", async () => {
    const { service, db } = setup();
    await service.listDefinitions(user); await service.listExportHistory(user);
    expect(db.reportDefinition.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: user.organizationId, reportType: "ticket-report", OR: [{ isShared: true }, { createdById: user.id }] } }));
    expect(db.reportExport.create).not.toHaveBeenCalled();
  });
  it("records failure when mail delivery is disabled, without claiming a send", async () => {
    const { service, db, mail } = setup(); mail.sendTicketReply.mockResolvedValue(null as never);
    await expect(service.sendTicketsReport(user, { ...query, format: "csv" }, { recipientEmails: ["synthetic@example.invalid"] })).rejects.toThrow("disabled");
    expect(db.reportExport.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ deliveryStatus: "failed" }) }));
  });
  it("distinguishes provider simulation from actual acceptance", async () => {
    const { service, mail } = setup(); mail.sendTicketReply.mockResolvedValue({ providerMessageId: "mock-synthetic" });
    expect(await service.sendTicketsReport(user, { ...query, format: "csv" }, { recipientEmails: ["synthetic@example.invalid"] })).toMatchObject({ sent: false, status: "simulated" });
  });
  it("uses atomic occurrence claims and actual owner permissions for schedules", async () => {
    const { service, db, mail } = setup();
    const schedule = { id: "schedule", updatedAt: new Date(), organizationId: user.organizationId, definitionId: "definition", name: "Synthetic weekly", frequency: "weekly", format: "csv", recipientEmails: ["synthetic@example.invalid"], nextRunAt: new Date("2026-08-01"), timing: { timeZone: "America/Chicago", time: "09:00", weekDay: 1, monthDay: 1 }, definition: { reportType: "ticket-report", filters: query, isShared: true }, createdBy: { ...user, isActive: true, deletedAt: null, groups: [] } };
    db.reportSchedule.findMany.mockResolvedValue([schedule] as never);
    await service["runDueSchedules"](); expect(mail.sendTicketReply).not.toHaveBeenCalled();
    expect(db.reportSchedule.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastStatus: "failed" }) }));
    db.reportSchedule.updateMany.mockResolvedValue({ count: 0 }); db.reportSchedule.update.mockClear();
    await service["runDueSchedules"](); expect(db.reportSchedule.update).not.toHaveBeenCalled();
  });
});

describe("Event reports and preserved saved definitions", () => {
  it("treats event dates as stored calendar dates and deduplicates task assignments per request", async () => {
    const { service, db } = setup();
    const person = { id: "one", firstName: "Mary Ann", lastName: "Smith", email: "one@example.invalid" };
    const request = { id: "event", trackingNumber: "SYN-EVT-1", eventName: "Synthetic event", eventDate: new Date("2026-08-01T00:00:00Z"), startTime: "09:00", endTime: "10:00", requesterFirstName: "Test", requesterLastName: "Requester", requesterEmail: "requester@example.invalid", status: "COMPLETED", priority: "NORMAL", createdAt: new Date("2026-07-15T15:00:00Z"), updatedAt: new Date("2026-08-01T15:00:00Z"), completedAt: new Date("2026-08-01T15:00:00Z"), cancelledAt: null, client: { id: "client", name: "eBay Research" }, services: [], assignees: [{ user: person }], tasks: [{ status: "DONE", assignedUserId: person.id, assignedUser: person }, { status: "NEW", assignedUserId: person.id, assignedUser: person }] };
    const events = { findMany: jest.fn().mockResolvedValue([request]) };
    Object.assign(db, { eventServiceRequest: events, eventServiceService: { findMany: jest.fn().mockResolvedValue([]) } });
    const result = await service.eventServiceSummary(user, { ...query, dateBasis: "eventDate" });
    expect(events.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: user.organizationId, eventDate: { gte: new Date("2026-08-01T00:00:00Z"), lt: new Date("2026-09-01T00:00:00Z") } }) }));
    expect(result.byTechnician).toEqual([{ label: "Mary Ann Smith", count: 1 }]);
    expect(result.summary).toMatchObject({ totalRequests: 1, totalTasks: 2, openTasks: 1, completedTasks: 1 });
    expect(result.activity.reduce((n, row) => n + Number(row.created), 0)).toBe(0);
    expect(result.activity.reduce((n, row) => n + Number(row.completed), 0)).toBe(1);
    expect(result.detail[0].eventDate).toBe("2026-08-01T00:00:00.000Z");
  });
  it("accepts legacy empty filters and status arrays without inventing currency", () => {
    const { service } = setup();
    expect(service["validateFilters"]("ticket-report", { startDate: "2026-08-01", endDate: "2026-08-31", clientId: "", statuses: ["CLOSED", "RESOLVED"], estimateMode: "none", valuePerTicket: "0" })).toMatchObject({ statuses: "CLOSED,RESOLVED" });
    expect(() => service["validateFilters"]("ticket-report", { estimateMode: "perTicket", valuePerTicket: "0" })).toThrow("currency");
    expect(() => service["validateFilters"]("ticket-report", { statuses: "UNKNOWN" })).toThrow("Unknown report status");
  });
  it("keeps distinct users with the same display name separate", () => {
    const { service } = setup();
    expect(service["groupEntities"]([{ id: "one", label: "Jane Smith", disambiguator: "one@example.invalid" }, { id: "two", label: "Jane Smith", disambiguator: "two@example.invalid" }])).toEqual([{ label: "Jane Smith (one@example.invalid)", count: 1 }, { label: "Jane Smith (two@example.invalid)", count: 1 }]);
  });
});

describe("Report ordering and exclusions", () => {
  it("sorts computed values across the complete result before paging and exporting", async () => {
    const { service, records } = setup(30);
    records.forEach((row, i) => { row._count.attachments = 30 - i; row.statusDefinition.name = i === 29 ? "AAA first" : "Zulu"; });
    const first = await service.ticketSummary(user, { ...query, sortBy: "attachmentCount", sortDirection: "asc" });
    expect(first.detail[0].ticketNumber).toBe("SYN-29"); expect(first.detail[0].attachmentCount).toBe(1);
    const second = await service.ticketSummary(user, { ...query, sortBy: "attachmentCount", sortDirection: "asc", page: "2" });
    expect(second.detail.map((row) => row.attachmentCount)).toEqual([26, 27, 28, 29, 30]);
    const all = await service.ticketSummary(user, { ...query, sortBy: "attachmentCount", sortDirection: "asc" }, { detailMode: "all" });
    expect([...first.detail, ...second.detail]).toEqual(all.detail);
    const statuses = await service.ticketSummary(user, { ...query, sortBy: "status", sortDirection: "asc" });
    expect(statuses.detail[0].ticketNumber).toBe("SYN-29");
  });
  it("orders every available column by displayed text, number or date, with missing values last", () => {
    const { service } = setup();
    const rows = [{ id: "a", requester: "Zulu", assignedTo: "Zulu, Amy", priority: "LOW", attachmentCount: 10, createdAt: null }, { id: "b", requester: "ámy", assignedTo: "Amy, Zulu", priority: "HIGH", attachmentCount: 2, createdAt: "2026-09-01" }];
    for (const sortBy of ["requester", "assignedTo", "priority", "attachmentCount", "createdAt"]) expect(service["sortRows"]([...rows], "ticket-report", { sortBy, sortDirection: "asc" })[0].id).toBe("b");
    expect(service["sortRows"]([...rows], "ticket-report", { sortBy: "createdAt", sortDirection: "desc" })[1].id).toBe("a");
    expect(() => service["validatePresentation"]("ticket-report", { sortBy: "passwordHash" })).toThrow("cannot be sorted");
  });
  it("applies exclusions to the scoped source query so summaries, charts and detail agree", async () => {
    const { service, db, records } = setup();
    const excluded = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; records[0].id = excluded;
    db.ticket.findMany.mockImplementation(async ({ where, skip = 0, take = 1000 }: any) => records.filter((row) => !where.id?.notIn.includes(row.id)).slice(skip, skip + take));
    const result = await service.ticketSummary(user, { ...query, excludedIds: excluded });
    expect(result.summary.totalTickets).toBe(1); expect(result.byClient[0].count).toBe(1); expect(result.detail).toHaveLength(1);
    expect(result.activity.reduce((sum, row) => sum + Number(row.created), 0)).toBe(1);
    expect(db.ticket.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: user.organizationId, deletedAt: null, id: { notIn: [excluded] } }) }));
    expect(() => service.ticketSummary(user, { ...query, excludedIds: "invalid" })).toThrow("valid record exclusions");
    expect(service["validateFilters"]("project-executive-report", { excludedIds: excluded, sortBy: "openDecisions", sections: "byHealth,detail" })).toMatchObject({ excludedIds: excluded, sortBy: "openDecisions", sections: "byHealth,detail" });
  });
  it("uses event display values and project numeric signals for ordering", () => {
    const { service } = setup();
    const events = [{ id: "a", services: "Zoom", time: "11:00", taskCount: 11 }, { id: "b", services: "Audio", time: "09:00", taskCount: 2 }];
    for (const sortBy of ["services", "time", "taskCount"]) expect(service["sortRows"]([...events], "event-service-report", { sortBy, sortDirection: "asc" })[0].id).toBe("b");
    const projects = [{ projectId: "a", owner: "Zulu", openDecisions: 10, risk: false }, { projectId: "b", owner: "Amy", openDecisions: 2, risk: true }];
    for (const sortBy of ["owner", "openDecisions", "risk"]) expect(service["sortRows"]([...projects], "project-executive-report", { sortBy, sortDirection: "asc" })[0].projectId).toBe("b");
  });
});
