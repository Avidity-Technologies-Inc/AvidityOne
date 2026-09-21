import { randomUUID, createHash } from "node:crypto";
import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
import cookieParser from "cookie-parser";
import { PrismaService } from "../prisma/prisma.service";
import { MailDeliveryService } from "../mailboxes/mail-delivery.service";
import { TicketEmailModule } from "./ticket-email.module";
import { TicketsModule } from "../tickets/tickets.module";
import { MailboxesModule } from "../mailboxes/mailboxes.module";
const url = process.env.TICKET_EMAIL_TEST_DATABASE_URL;
(url ? describe : describe.skip)("Operational email authenticated runtime", () => {
  let app: INestApplication; let prisma: PrismaService; let base: string; let token: string; let roleId: string; let organizationId: string;
  beforeAll(async () => {
    const target = new URL(url!); if (target.hostname !== "127.0.0.1" || target.port !== "55439" || target.pathname !== "/avidity_email_test") throw new Error("A dedicated disposable email database is required.");
    prisma = new PrismaService({ datasources: { db: { url } } });
    const module = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ MAIL_PROVIDER: "mock", SESSION_COOKIE_NAME: "email_test_session" })] }), ThrottlerModule.forRoot([{ ttl: 60000, limit: 1000 }]), TicketEmailModule, TicketsModule, MailboxesModule] }).overrideProvider(PrismaService).useValue(prisma).overrideProvider(MailDeliveryService).useValue({ sendTicketReply: jest.fn(async () => ({ providerMessageId: "simulated" })) }).compile();
    app = module.createNestApplication({ logger: false }); app.use(cookieParser()); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.listen(0, "127.0.0.1"); base = await app.getUrl();
    organizationId = (await prisma.organization.create({ data: { name: "Synthetic email API" } })).id;
    const user = await prisma.user.create({ data: { organizationId, email: `${randomUUID()}@example.test`, firstName: "API", lastName: "Tester", passwordHash: "unusable", forcePasswordChange: false } });
    const permission = await prisma.permission.upsert({ where: { name: "tickets.view" }, update: {}, create: { name: "tickets.view" } });
    const role = await prisma.role.create({ data: { organizationId, name: "Email runtime", permissions: { create: { permissionId: permission.id } } } }); roleId = role.id;
    await prisma.group.create({ data: { organizationId, name: "Runtime group", roles: { create: { roleId } }, users: { create: { userId: user.id } } } });
    token = randomUUID(); await prisma.session.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600000) } });
  });
  afterAll(async () => { await app?.close(); await prisma?.$disconnect(); });
  const http = (path: string, method = "GET", body?: unknown, auth = token) => fetch(`${base}/ticket-email/${path}`, { method, headers: { Cookie: `email_test_session=${auth}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  async function grant(name: string) { const p = await prisma.permission.upsert({ where: { name }, update: {}, create: { name } }); await prisma.rolePermission.create({ data: { roleId, permissionId: p.id } }); }
  it("boots real ticket/mailbox modules and enforces authentication, organization scope and settings grants", async () => {
    expect((await http("me", "GET", undefined, "invalid")).status).toBe(401);
    const own = await http("me"); expect(own.status).toBe(200); expect(await own.json()).toMatchObject({ deliveries: [], actions: [], policy: { enabled: false } });
    expect((await http("settings")).status).toBe(403);
    expect((await http("settings", "PATCH", { enabled: true })).status).toBe(403);
    await grant("system_settings.view"); expect((await http("settings")).status).toBe(200);
    expect((await http("settings", "PATCH", { enabled: true })).status).toBe(403);
    await grant("system_settings.update");
    expect((await http("settings", "PATCH", { enabled: true, repliesEnabled: false, closeEnabled: true })).status).toBe(400);
    expect((await http("settings", "PATCH", { enabled: true, recipients: ["outside@example.test"] })).status).toBe(400);
    expect((await http("settings", "PATCH", { confirmationMinutes: 0 })).status).toBe(400);
    expect((await http("settings", "PATCH", { enabled: true, repliesEnabled: true, closeEnabled: true })).status).toBe(200);
    expect((await http(`deliveries/${randomUUID()}/retry`, "POST")).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { organizationId, action: "ticket.email_policy_updated" } })).toBe(1);
  });
});
