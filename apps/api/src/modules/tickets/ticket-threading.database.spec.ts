import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { TicketsService } from "./tickets.service";
import { AuditLogsService } from "../audit-logs/audit-logs.service";
import { HtmlSanitizerService } from "../../common/html/html-sanitizer.service";

const url = process.env.TICKET_EMAIL_TEST_DATABASE_URL;
(url ? describe : describe.skip)("Ticket threading with isolated PostgreSQL", () => {
  let prisma: PrismaService; let service: TicketsService; let org: string; let original: string; let messageId: string;
  const number = `TEST-${Date.now()}`;
  beforeAll(async () => {
    const target = new URL(url!);
    if (target.hostname !== "127.0.0.1" || target.port !== "55439" || target.pathname !== "/avidity_email_test") throw new Error("A disposable email test database is required.");
    prisma = new PrismaService({ datasources: { db: { url } } }); await prisma.$connect();
    org = (await prisma.organization.create({ data: { name: "Threading validation" } })).id;
    messageId = `<${randomUUID()}@example.test>`;
    original = (await prisma.ticket.create({ data: { organizationId: org, ticketNumber: number, subject: "Flyer", senderEmail: "customer@example.test", status: "CLOSED", closedAt: new Date(), messages: { create: { direction: "OUTBOUND", visibility: "PUBLIC", bodyText: "Attached flyer", emailInternetMessageId: messageId, emailConversationId: "old-thread" } } } })).id;
    service = new TicketsService(prisma, new AuditLogsService(prisma), new HtmlSanitizerService(), { resolveRequesterFromEmail: async () => null } as never, {} as never, {} as never, { notifyUser: jest.fn() } as never, {} as never);
  });
  afterAll(async () => { await prisma?.$disconnect(); });
  const match = (extra: object) => (service as any).findExistingTicketForInbound({ organizationId: org, senderEmail: "customer@example.test", subject: "Re: Flyer", ...extra });

  it("records a changed-conversation reply in the original closed ticket and reopens it", async () => {
    const before = await prisma.ticket.count({ where: { organizationId: org } });
    const result = await service.createFromInboundEmail({ organizationId: org, senderEmail: "customer@example.test", subject: "Re: New wording", bodyText: "Please adjust the attachment", emailConversationId: "changed-thread", emailInternetMessageId: `<${randomUUID()}@example.test>`, inReplyTo: messageId });
    expect(result.ticket.id).toBe(original);
    expect(result.ticket.closedAt).toBeNull();
    expect(["REOPENED", "WAITING_ON_TECHNICIAN"]).toContain(result.ticket.status);
    expect(await prisma.ticket.count({ where: { organizationId: org } })).toBe(before);
    expect(await prisma.ticketMessage.count({ where: { ticketId: original, bodyText: "Please adjust the attachment" } })).toBe(1);
  });
  it("accepts ticket-number recovery only for an established participant", async () => {
    expect((await match({ subject: `Re: [${number}] Flyer` }))?.id).toBe(original);
    expect(await match({ senderEmail: "stranger@example.test", subject: `Re: [${number}] Flyer` })).toBeNull();
  });
  it("does not confuse other organizations or independent requests with the same subject", async () => {
    const otherOrg = (await prisma.organization.create({ data: { name: "Other organization" } })).id;
    expect(await match({ organizationId: otherOrg, inReplyTo: messageId })).toBeNull();
    expect(await match({})).toBeNull();
  });
});
