import { INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { ThrottlerModule } from "@nestjs/throttler";
import cookieParser from "cookie-parser";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { MicrosoftCalendarService } from "../microsoft-calendar/microsoft-calendar.service";
import { TicketMeetingsModule } from "./ticket-meetings.module";

const url = process.env.QC_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite("Scheduled activities authenticated runtime", () => {
  let app: INestApplication, prisma: PrismaService, base: string, ticketId: string, organizationId: string, organizerId: string;
  let session: string, viewer: string;
  const calendar = {
    createEvent: jest.fn(async () => ({ id: randomUUID(), webLink: "https://outlook.example/activity" })),
    updateEvent: jest.fn(async (input: { eventId: string }) => ({ id: input.eventId })),
    cancelEvent: jest.fn(async () => undefined), deleteEvent: jest.fn(async () => undefined)
  };
  beforeAll(async () => {
    const target = new URL(url!);
    if (target.hostname !== "127.0.0.1" || target.port !== "55473" || target.pathname !== "/qc_validation") throw new Error("A dedicated synthetic database is required.");
    prisma = new PrismaService({ datasources: { db: { url } } });
    const module = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({ SESSION_COOKIE_NAME: "activities_session", APP_URL: "http://localhost" })] }), ThrottlerModule.forRoot([{ ttl: 60000, limit: 1000 }]), TicketMeetingsModule] }).overrideProvider(PrismaService).useValue(prisma).overrideProvider(MicrosoftCalendarService).useValue(calendar).compile();
    app = module.createNestApplication({ logger: false }); app.use(cookieParser()); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.listen(0, "127.0.0.1"); base = await app.getUrl();
    organizationId = (await prisma.organization.create({ data: { name: `Activities ${randomUUID()}` } })).id;
    await prisma.systemSetting.create({ data: { organizationId, applicationName: "Synthetic activities", companyName: "Synthetic", supportEmail: "support@example.invalid", eventCalendarSyncEnabled: true } });
    async function identity(names: string[]) {
      const person = await prisma.user.create({ data: { organizationId, email: `${randomUUID()}@example.invalid`, firstName: "Activity", lastName: "Tester", passwordHash: "unusable", forcePasswordChange: false } });
      const role = await prisma.role.create({ data: { organizationId, name: randomUUID(), permissions: { create: (await prisma.permission.findMany({ where: { name: { in: names } } })).map(item => ({ permissionId: item.id })) } } });
      await prisma.group.create({ data: { organizationId, name: randomUUID(), users: { create: { userId: person.id } }, roles: { create: { roleId: role.id } } } });
      const token = randomUUID(); await prisma.session.create({ data: { userId: person.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600000) } });
      return { token, id: person.id };
    }
    const admin = await identity(["ticket_meetings.view", "ticket_meetings.create", "ticket_meetings.update", "ticket_meetings.cancel"]); session = admin.token; organizerId = admin.id;
    viewer = (await identity(["ticket_meetings.view", "ticket_meetings.update"])).token;
    ticketId = (await prisma.ticket.create({ data: { organizationId, subject: "Scheduled work", status: "OPEN", ticketNumber: `A-${randomUUID()}`, senderEmail: "client@example.invalid" } })).id;
  });
  afterAll(async () => { await app?.close(); await prisma?.$disconnect(); });
  const http = (path = "", method = "GET", body?: unknown, token = session) => fetch(`${base}/tickets/${ticketId}/meetings${path}`, { method, headers: { Cookie: `activities_session=${token}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const input = () => ({ title: "Service activity", startAt: new Date(Date.now() + 86400000).toISOString(), endAt: new Date(Date.now() + 90000000).toISOString(), timeZone: "America/Chicago", activityType: "WORK_SESSION", modality: "REMOTE", isOnlineMeeting: false });
  async function create(extra = {}) { const response = await http("", "POST", { ...input(), ...extra }); expect(response.status).toBe(201); return response.json(); }

  it("validates authentication, permissions and activity enums", async () => {
    expect((await http("", "GET", undefined, "invalid")).status).toBe(401);
    expect((await http("", "POST", input(), viewer)).status).toBe(403);
    expect((await http("", "POST", { ...input(), modality: "INVENTED" })).status).toBe(400);
  });
  it("reserves personal work without default customer invitations and retains legacy modality", async () => {
    const work = await create(); expect(work.attendees).toHaveLength(0);
    expect((await http(`/${work.id}/schedule`, "POST")).status).toBe(201);
    expect(calendar.createEvent).toHaveBeenLastCalledWith(expect.objectContaining({ attendees: [], isOnlineMeeting: false, bodyHtml: expect.stringContaining("work session") }));
    const legacy = await prisma.ticketMeeting.create({ data: { organizationId, ticketId, organizerUserId: organizerId, title: "Existing legacy", startAt: new Date(), endAt: new Date(Date.now() + 3600000), timeZone: "UTC", location: "Existing room", isOnlineMeeting: true } });
    expect(legacy.activityType).toBe("MEETING"); expect(legacy.modality).toBeNull();
  });
  it("allows unfinished on-site drafts but requires location before scheduling", async () => {
    const visit = await create({ activityType: "SERVICE_VISIT", modality: "ON_SITE" });
    expect((await http(`/${visit.id}/schedule`, "POST")).status).toBe(400);
    expect((await http(`/${visit.id}`, "PATCH", { location: "Client office, room 2" })).status).toBe(200);
    expect((await http(`/${visit.id}/schedule`, "POST")).status).toBe(201);
    expect(calendar.createEvent).toHaveBeenLastCalledWith(expect.objectContaining({ location: "Client office, room 2", isOnlineMeeting: false }));
    expect((await http(`/${visit.id}`, "PATCH", { location: " " })).status).toBe(400);
  });
  it("preserves explicit invitees and rejects incompatible Teams modes", async () => {
    const meeting = await create({ activityType: "MEETING", modality: "HYBRID", location: "Conference room", isOnlineMeeting: true, attendees: [{ email: "invited@example.invalid", type: "OPTIONAL" }] });
    expect((await http(`/${meeting.id}/schedule`, "POST")).status).toBe(201);
    expect(calendar.createEvent).toHaveBeenLastCalledWith(expect.objectContaining({ isOnlineMeeting: true, attendees: [expect.objectContaining({ email: "invited@example.invalid", type: "optional" })] }));
    expect((await http(`/${meeting.id}`, "PATCH", { modality: "ON_SITE", isOnlineMeeting: false })).status).toBe(400);
    expect((await http(`/${meeting.id}/complete-and-release`, "POST")).status).toBe(400);
    expect((await http(`/${meeting.id}/cancel`, "POST")).status).toBe(201);
    expect(calendar.cancelEvent).toHaveBeenCalled();
  });
  it("requires release permission, retains failed reservations, then records early completion once", async () => {
    const work = await create(); await http(`/${work.id}/schedule`, "POST");
    expect((await http(`/${work.id}/complete-and-release`, "POST", undefined, viewer)).status).toBe(403);
    calendar.deleteEvent.mockRejectedValueOnce(new Error("Synthetic provider unavailable"));
    expect((await http(`/${work.id}/complete-and-release`, "POST")).status).toBe(500);
    expect(await prisma.ticketMeeting.findUnique({ where: { id: work.id } })).toMatchObject({ status: "SCHEDULED", syncStatus: "FAILED" });
    const response = await http(`/${work.id}/complete-and-release`, "POST"); expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ status: "COMPLETED", providerWebLink: null });
    const calls = calendar.deleteEvent.mock.calls.length;
    await http(`/${work.id}/complete-and-release`, "POST"); expect(calendar.deleteEvent.mock.calls.length).toBe(calls);
    expect(await prisma.ticketActivity.count({ where: { ticketMeetingId: work.id, action: "ticket.meeting.completed" } })).toBe(1);
    expect((await prisma.ticket.findUnique({ where: { id: ticketId } }))?.status).toBe("OPEN");
  });
  it("cancels an organizer reservation with DELETE and never reactivates concluded work", async () => {
    const work = await create(); await http(`/${work.id}/schedule`, "POST");
    const cancels = calendar.cancelEvent.mock.calls.length;
    expect((await http(`/${work.id}/cancel`, "POST")).status).toBe(201);
    expect(calendar.cancelEvent.mock.calls.length).toBe(cancels);
    expect((await http(`/${work.id}/schedule`, "POST")).status).toBe(400);
    expect((await http(`/${work.id}`, "PATCH", { title: "Overwrite" })).status).toBe(400);
    expect((await http(`/${work.id}/complete`, "POST")).status).toBe(400);
  });
});
