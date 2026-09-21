import { MailDeliveryError } from "../mailboxes/providers/mail-delivery.error";
import { TicketAttachmentsService } from "../ticket-attachments/ticket-attachments.service";
import { FileStorageService } from "../file-storage/file-storage.service";
import { FileValidationService } from "../file-storage/file-validation.service";
import { MailAttachment } from "../mailboxes/providers/mail-provider.interface";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { AuditLogsService } from "../audit-logs/audit-logs.service";
import { HtmlSanitizerService } from "../../common/html/html-sanitizer.service";
import { TicketsService } from "../tickets/tickets.service";
import { TicketWorkflowService } from "../ticket-workflow/ticket-workflow.service";
import { TicketEmailService } from "./ticket-email.service";
import { REPLY_SEPARATOR, ticketEmailDefaults } from "./ticket-email.policy";
import { InboundMailMessage } from "../mailboxes/providers/mail-provider.interface";
const databaseTests = process.env.TICKET_EMAIL_TEST_DATABASE_URL ? describe : describe.skip;
databaseTests("Ticket email isolated PostgreSQL workflows", () => {
  let prisma: PrismaService; let service: TicketEmailService; let tickets: TicketsService;
  let org: string; let userId: string; let mailboxId: string; let ticketId: string; let roleId: string;
  const send = jest.fn(async (_input: Record<string, unknown>) => ({ providerMessageId: `synthetic-${randomUUID()}` }));
  const email = `specialist-${randomUUID()}@example.test`;
  const storedContent = new Map<string, Buffer>();
  const loadFiles = jest.fn(async (): Promise<MailAttachment[]> => []);
  const execute = jest.fn((input: Parameters<TicketsService["executeEmailReply"]>[0]) => tickets.executeEmailReply(input));
  const sender = () => ({ id: mailboxId, organizationId: org });
  const incoming = (subject: string, bodyText: string, overrides: Partial<InboundMailMessage> = {}): InboundMailMessage => ({ providerMessageId: randomUUID(), internetMessageId: `<${randomUUID()}@example.test>`, from: { email }, subject, bodyText, ...overrides });
  beforeAll(async () => {
    const target = new URL(process.env.TICKET_EMAIL_TEST_DATABASE_URL!);
    if (target.hostname !== "127.0.0.1" || target.port !== "55439" || target.pathname !== "/avidity_email_test") throw new Error("A dedicated disposable email test database is required.");
    prisma = new PrismaService({ datasources: { db: { url: process.env.TICKET_EMAIL_TEST_DATABASE_URL } } }); await prisma.$connect();
    org = (await prisma.organization.create({ data: { name: `Email test ${randomUUID()}` } })).id;
    userId = (await prisma.user.create({ data: { organizationId: org, email, firstName: "Synthetic", lastName: "Specialist", passwordHash: "not-a-real-password", forcePasswordChange: false } })).id;
    const group = await prisma.group.create({ data: { organizationId: org, name: "Email testers" } });
    const role = await prisma.role.create({ data: { organizationId: org, name: "Email test grants" } }); roleId = role.id;
    await prisma.userGroup.create({ data: { userId, groupId: group.id } }); await prisma.groupRole.create({ data: { groupId: group.id, roleId } });
    for (const name of ["tickets.view", "tickets.reply", "tickets.close", "ticket_messages.view", "ticket_messages.create_public", "ticket_messages.create_internal", "ticket_attachments.download", "ticket_attachments.upload"]) {
      const permission = await prisma.permission.upsert({ where: { name }, create: { name }, update: {} }); await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
    }
    await prisma.userNotificationPreference.create({ data: { userId, emailEnabled: true, emailTicketAssignedToMe: true, emailTicketReplyOnAssignedTicket: true, emailInternalNoteOnAssignedTicket: true } });
    mailboxId = (await prisma.mailbox.create({ data: { organizationId: org, name: "Synthetic support", emailAddress: `support-${randomUUID()}@example.test`, provider: "MOCK", connectionMode: "MOCK" } })).id;
    const audit = new AuditLogsService(prisma); const sanitizer = new HtmlSanitizerService();
    service = new TicketEmailService(prisma, { sendTicketReply: send } as never, { getFileStream: async (key: string) => Readable.from(storedContent.get(key) ?? Buffer.from("synthetic file")) } as never, new ConfigService({ MAIL_PROVIDER: "mock", APP_URL: "https://example.test" }), audit, sanitizer);
    const validation = new FileValidationService({ getAttachmentPolicy: async () => ({ maximumUploadSizeMb: 25, blockedAttachmentFileTypes: [], allowedAttachmentFileTypes: [] }) } as never);
    const storage = new FileStorageService({ saveFile: async (input: { originalFilename: string; mimeType: string; buffer: Buffer }) => ({ storageProvider: "LOCAL", storageKey: `synthetic/${randomUUID()}`, originalFilename: input.originalFilename, storedFilename: input.originalFilename, mimeType: input.mimeType, fileSize: input.buffer.length, sha256Hash: "b".repeat(64) }) } as never, validation);
    const attachments = new TicketAttachmentsService(prisma, storage, { scanBuffer: async () => ({ scanStatus: "CLEAN", scanResult: "PASSED" }) } as never, validation, audit);
    tickets = new TicketsService(prisma, audit, sanitizer, {} as never, {} as never, { sendTicketReply: send } as never, { notifyUser: jest.fn(), notifyNewTicketCreated: jest.fn() } as never, {} as never, {} as never, new TicketWorkflowService(prisma, audit), attachments);
    await service.updatePolicy((await service.actor(userId, org))!, { ...ticketEmailDefaults, enabled: true, repliesEnabled: true, closeEnabled: true, includeInternal: true });
  });
  afterAll(async () => { await prisma?.$disconnect(); });
  async function ticket() {
    const row = await prisma.ticket.create({ data: { organizationId: org, ticketNumber: `EMAIL-${randomUUID()}`, mailboxId, subject: "Synthetic email operations", senderEmail: "customer@example.test", assignedUserId: userId } });
    ticketId = row.id;
    await prisma.ticketAssignee.create({ data: { ticketId, userId } });
    await prisma.ticketMessage.create({ data: { ticketId, direction: "INBOUND", visibility: "PUBLIC", senderEmail: "customer@example.test", bodyText: "Complete customer request, not a short preview.", bodyHtml: "<p><b>Complete customer request</b>, not a short preview.</p>" } });
    return row;
  }
  async function delivery(mode = "PUBLIC") {
    return prisma.ticketEmailDelivery.create({ data: { organizationId: org, ticketId, userId, eventType: "ticketReplyOnAssignedTicket", replyKey: randomUUID().replaceAll("-", "") + "a".repeat(16), mode, subject: "Synthetic conversation", status: "SIMULATED", dedupeKey: randomUUID() } });
  }
  async function propose(text = "[Closed]\nCompleted and verified.", mode = "PUBLIC", hasAttachments = false) {
    const d = await delivery(mode); const message = incoming(`[AO:${d.replyKey}]`, `${text}\n${REPLY_SEPARATOR}\nOld conversation`, { hasAttachments });
    expect(await service.inbound(sender(), message, loadFiles, execute)).toBe(true);
    const action = await prisma.ticketEmailAction.findUniqueOrThrow({ where: { sourceKey: `${org}:${message.internetMessageId}` } });
    const notice = await prisma.ticketEmailDelivery.findUniqueOrThrow({ where: { dedupeKey: `confirm:${action.id}` } });
    const token = notice.bodyText!.match(/\[Confirm ([a-f0-9]{48})\]/)![1];
    return { action, token, message };
  }
  it("captures source events transactionally and copies full public content while keeping notes separate", async () => {
    await ticket();
    await prisma.ticketMessage.create({ data: { ticketId, authorUserId: userId, direction: "INTERNAL", visibility: "INTERNAL", bodyText: "Never expose this internal note to a public thread.", suppressOperationalEmail: true } });
    expect(await prisma.ticketEmailEvent.count({ where: { ticketId } })).toBeGreaterThan(0);
    await service.enqueue({ organizationId: org, ticketId, userId, eventType: "ticketAssignedToMe", title: "Assigned" });
    await service.dispatch();
    await prisma.ticketEmailDelivery.updateMany({ where: { organizationId: org, status: "PENDING" }, data: { availableAt: new Date(0) } });
    for (let i = 0; i < 5; i++) await service.dispatch();
    const publicMail = send.mock.calls.map((c) => c[0] as unknown as { bodyHtml: string }).find((c) => c.bodyHtml.includes("Complete customer request"));
    expect(publicMail?.bodyHtml).toContain("<b>Complete customer request</b>"); expect(publicMail?.bodyHtml).not.toContain("Never expose");
    expect(await prisma.ticketEmailDelivery.count({ where: { ticketId, mode: "INTERNAL" } })).toBe(0);
  });
  it("does not execute before personal confirmation and sends a real workflow reply then closes once", async () => {
    await ticket(); const { action, token, message } = await propose();
    expect(execute).not.toHaveBeenCalled();
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe("NEW");
    await service.inbound(sender(), message, loadFiles, execute);
    expect(await prisma.ticketEmailAction.count({ where: { sourceKey: action.sourceKey } })).toBe(1);
    const confirmation = incoming("Confirm action", `[Confirm ${token}]`);
    await Promise.all([service.inbound(sender(), confirmation, loadFiles, execute), service.inbound(sender(), confirmation, loadFiles, execute)]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe("CLOSED");
    expect(await prisma.ticketMessage.count({ where: { ticketId, authorUserId: userId, direction: "OUTBOUND", bodyText: "Completed and verified." } })).toBe(1);
    expect((await prisma.ticketEmailAction.findUniqueOrThrow({ where: { id: action.id } })).status).toBe("COMPLETED");
    const sent = send.mock.calls.map((c) => c[0] as unknown as { to: string[]; bodyText: string }).find((c) => c.bodyText === "Completed and verified.");
    expect(sent?.to).toEqual(["customer@example.test"]);
  });
  it("rejects forged recipients, automated messages, expired confirmations and permission loss", async () => {
    await ticket(); const d = await delivery(); const before = execute.mock.calls.length;
    await service.inbound(sender(), incoming(`[AO:${d.replyKey}]`, "[Closed]\nForged", { from: { email: "attacker@example.test" } }), loadFiles, execute);
    expect(await prisma.ticketEmailAction.count({ where: { ticketId } })).toBe(0);
    await service.inbound(sender(), incoming(`[AO:${d.replyKey}]`, "[Closed]\nAuto", { internetMessageHeaders: { "auto-submitted": "auto-replied" } }), loadFiles, execute);
    expect(await prisma.ticketEmailAction.count({ where: { ticketId } })).toBe(0);
    const first = await propose(); await prisma.ticketEmailAction.update({ where: { id: first.action.id }, data: { expiresAt: new Date(0) } });
    await service.inbound(sender(), incoming("Confirm", `[Confirm ${first.token}]`), loadFiles, execute);
    expect((await prisma.ticketEmailAction.findUniqueOrThrow({ where: { id: first.action.id } })).status).toBe("EXPIRED");
    const second = await propose(); const permission = await prisma.permission.findUniqueOrThrow({ where: { name: "tickets.close" } });
    await prisma.rolePermission.deleteMany({ where: { roleId, permissionId: permission.id } });
    await service.inbound(sender(), incoming("Confirm", `[Confirm ${second.token}]`), loadFiles, execute);
    expect((await prisma.ticketEmailAction.findUniqueOrThrow({ where: { id: second.action.id } })).status).toBe("REJECTED");
    expect(execute.mock.calls.length).toBe(before);
    await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } });
  });
  it("rejects changed public recipients and preserves the ticket state", async () => {
    await ticket(); const proposed = await propose();
    await prisma.ticketConversationParticipant.create({ data: { ticketId, email: "new-recipient@example.test" } });
    await service.inbound(sender(), incoming("Confirm", `[Confirm ${proposed.token}]`), loadFiles, execute);
    expect((await prisma.ticketEmailAction.findUniqueOrThrow({ where: { id: proposed.action.id } })).status).toBe("REJECTED");
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe("NEW");
  });
  it("records staff-only email notes without sending their content to the customer", async () => {
    await ticket(); const proposed = await propose("Internal investigation detail", "INTERNAL"); const before = send.mock.calls.length;
    await service.inbound(sender(), incoming("Confirm", `[Confirm ${proposed.token}]`), loadFiles, execute);
    expect(send.mock.calls.length).toBe(before);
    expect(await prisma.ticketMessage.count({ where: { ticketId, bodyText: "Internal investigation detail", visibility: "INTERNAL", authorUserId: userId } })).toBe(1);
  });
  it("does not reclassify unlinked specialist replies as customer messages", async () => {
    const current = await ticket();
    // Match through a real message reference; subjects with synthetic UUIDs do not use the production number pattern.
    await prisma.ticketMessage.updateMany({ where: { ticketId }, data: { emailInternetMessageId: "<original@example.test>" } });
    expect(await service.inbound(sender(), incoming(`Re: ${current.subject}`, "[Closed]\nUnlinked", { inReplyTo: "<original@example.test>" }), loadFiles, execute)).toBe(true);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe("NEW");
  });
  it("deduplicates concurrent capture and refuses delivery after reassignment", async () => {
    await ticket(); const params = { organizationId: org, ticketId, userId, eventType: "ticketAssignedToMe", title: "Assigned" };
    await Promise.all([service.enqueue(params), service.enqueue(params)]);
    expect(await prisma.ticketEmailDelivery.count({ where: { ticketId } })).toBe(1);
    await prisma.ticketAssignee.deleteMany({ where: { ticketId } }); await prisma.ticket.update({ where: { id: ticketId }, data: { assignedUserId: null } });
    await prisma.ticketEmailDelivery.updateMany({ where: { ticketId }, data: { availableAt: new Date(0) } });
    await service.dispatch();
    expect((await prisma.ticketEmailDelivery.findFirstOrThrow({ where: { ticketId } })).status).toBe("CANCELLED");
  });
  it("labels attachment omissions and never sends blocked bytes", async () => {
    await ticket(); const message = await prisma.ticketMessage.findFirstOrThrow({ where: { ticketId } });
    const stored = await prisma.storedFile.create({ data: { originalFilename: "blocked.txt", storedFilename: "blocked.txt", mimeType: "text/plain", fileSize: 14, storageKey: `synthetic/${randomUUID()}`, sha256Hash: "a".repeat(64) } });
    await prisma.ticketAttachment.create({ data: { storedFileId: stored.id, storedFilename: "blocked.txt", sha256Hash: "a".repeat(64), ticketId, ticketMessageId: message.id, originalFilename: "blocked.txt", mimeType: "text/plain", fileSize: 14, storageKey: "synthetic/blocked", storageProvider: "LOCAL", scanStatus: "BLOCKED", source: "INBOUND_EMAIL" } });
    await service.enqueue({ organizationId: org, ticketId, userId, eventType: "ticketReplyOnAssignedTicket", title: "Attachment test", messageId: message.id });
    await prisma.ticketEmailDelivery.updateMany({ where: { ticketId }, data: { availableAt: new Date(0) } });
    await service.dispatch();
    const mail = send.mock.calls.map((c) => c[0]).find((c) => String(c.bodyHtml).includes("blocked.txt"));
    expect(mail?.bodyHtml).toContain("not cleared for delivery"); expect(mail?.rawAttachments).toEqual([]);
  });
  async function sourceFile(messageId: string, name: string, bytes: Buffer, contentId: string | null = null) {
    const storageKey = `synthetic/${randomUUID()}`;
    storedContent.set(storageKey, bytes);
    const data = { originalFilename: name, storedFilename: name, mimeType: contentId ? "image/png" : "application/pdf", fileSize: bytes.length, storageKey, sha256Hash: "a".repeat(64) };
    const stored = await prisma.storedFile.create({ data });
    return prisma.ticketAttachment.create({ data: { ...data, storedFileId: stored.id, ticketId, ticketMessageId: messageId, contentId, isInline: Boolean(contentId), storageProvider: "LOCAL", scanStatus: "CLEAN", source: "INBOUND_EMAIL" } });
  }
  async function sendMessageCopy(messageId: string) {
    await service.enqueue({ organizationId: org, ticketId, userId, eventType: "ticketReplyOnAssignedTicket", title: "File copy test", messageId });
    const row = await prisma.ticketEmailDelivery.findFirstOrThrow({ where: { ticketId, messageId } });
    const before = send.mock.calls.length;
    await (service as unknown as { deliver: (value: typeof row) => Promise<void> }).deliver(row);
    expect(send.mock.calls.length).toBe(before + 1);
    return send.mock.calls.at(-1)![0] as { bodyHtml: string; rawAttachments: Array<{ originalFilename: string; isInline: boolean; contentId: string | null; contentBytes: Buffer; sizeBytes: number }> };
  }
  it("keeps embedded images and includes downloadable copies while promoting unused inline files", async () => {
    await ticket();
    const message = await prisma.ticketMessage.findFirstOrThrow({ where: { ticketId } });
    await prisma.ticketMessage.update({ where: { id: message.id }, data: { bodyHtml: '<p>Evidence</p><img src="cid:screen">', attachmentsProcessedAt: new Date() } });
    const image = await sourceFile(message.id, "evidence.png", Buffer.from("actual image bytes"), "screen");
    await sourceFile(message.id, "document.pdf", Buffer.from("actual PDF bytes"));
    await sourceFile(message.id, "unused.png", Buffer.from("orphan image"), "unused");
    const result = await sendMessageCopy(message.id);
    const copies = result.rawAttachments.filter((f) => f.originalFilename === "evidence.png");
    expect(copies).toHaveLength(2);
    expect(copies[0]).toMatchObject({ isInline: true, contentId: `file-${image.id}@ticket`, contentBytes: Buffer.from("actual image bytes") });
    expect(copies[1]).toMatchObject({ isInline: false, contentId: null, contentBytes: copies[0].contentBytes });
    expect(result.bodyHtml).toContain(`cid:file-${image.id}@ticket`);
    expect(result.bodyHtml).toContain("Downloadable image copies");
    expect(result.rawAttachments.filter((f) => f.originalFilename === "unused.png")).toEqual([expect.objectContaining({ isInline: false, contentId: null })]);
    expect(result.rawAttachments.filter((f) => f.originalFilename === "document.pdf")).toHaveLength(1);
  });
  it("prioritizes original files over duplicate image copies within the configured budget", async () => {
    await ticket();
    const actor = (await service.actor(userId, org))!;
    await service.updatePolicy(actor, { attachmentBudgetMb: 1 });
    try {
      const message = await prisma.ticketMessage.findFirstOrThrow({ where: { ticketId } });
      await prisma.ticketMessage.update({ where: { id: message.id }, data: { bodyHtml: '<img src="cid:large">', attachmentsProcessedAt: new Date() } });
      await sourceFile(message.id, "large.png", Buffer.alloc(600000), "large");
      await sourceFile(message.id, "important.pdf", Buffer.alloc(400000));
      const result = await sendMessageCopy(message.id);
      expect(result.rawAttachments).toHaveLength(2);
      expect(result.rawAttachments.some((f) => f.originalFilename === "important.pdf" && !f.isInline)).toBe(true);
      expect(result.rawAttachments.reduce((sum, f) => sum + f.sizeBytes, 0)).toBe(1000000);
      expect(result.bodyHtml).toContain("downloadable copy omitted: email attachment budget exceeded");
    } finally { await service.updatePolicy(actor, { attachmentBudgetMb: 2 }); }
  });
  it("sends only the current communication's files, and respects attachment-copy configuration", async () => {
    await ticket();
    const old = await prisma.ticketMessage.findFirstOrThrow({ where: { ticketId } });
    await sourceFile(old.id, "old.pdf", Buffer.from("old"));
    const latest = await prisma.ticketMessage.create({ data: { ticketId, direction: "INBOUND", visibility: "PUBLIC", bodyText: "New evidence", attachmentsProcessedAt: new Date() } });
    await sourceFile(latest.id, "new.pdf", Buffer.from("new"));
    expect((await sendMessageCopy(latest.id)).rawAttachments.map((f) => f.originalFilename)).toEqual(["new.pdf"]);
    const actor = (await service.actor(userId, org))!;
    await service.updatePolicy(actor, { includeAttachments: false });
    try {
      const result = await sendMessageCopy(old.id);
      expect(result.rawAttachments).toEqual([]);
      expect(result.bodyHtml).toContain("attachment copies disabled");
    } finally { await service.updatePolicy(actor, { includeAttachments: true }); }
  });
  it("retains assignment history files without exposing internal attachments", async () => {
    await ticket();
    const first = await prisma.ticketMessage.findFirstOrThrow({ where: { ticketId } });
    await sourceFile(first.id, "initial.pdf", Buffer.from("initial"));
    const next = await prisma.ticketMessage.create({ data: { ticketId, direction: "INBOUND", visibility: "PUBLIC", bodyText: "Follow-up", attachmentsProcessedAt: new Date() } });
    await sourceFile(next.id, "follow-up.pdf", Buffer.from("follow-up"));
    const internal = await prisma.ticketMessage.create({ data: { ticketId, direction: "INTERNAL", visibility: "INTERNAL", bodyText: "Private note" } });
    await sourceFile(internal.id, "private.pdf", Buffer.from("private"));
    await service.enqueue({ organizationId: org, ticketId, userId, eventType: "ticketAssignedToMe", title: "Assignment history" });
    const row = await prisma.ticketEmailDelivery.findFirstOrThrow({ where: { ticketId } });
    expect(row.messageId).toBeNull();
    await (service as unknown as { deliver: (value: typeof row) => Promise<void> }).deliver(row);
    const mail = send.mock.calls.at(-1)![0] as { bodyHtml: string; rawAttachments: Array<{ originalFilename: string }> };
    expect(mail.rawAttachments.map((f) => f.originalFilename)).toEqual(["initial.pdf", "follow-up.pdf"]);
    expect(mail.bodyHtml).not.toContain("Private note");
  });
  it("withholds both embedded bytes and downloadable copies after download permission is removed", async () => {
    await ticket();
    const message = await prisma.ticketMessage.findFirstOrThrow({ where: { ticketId } });
    await prisma.ticketMessage.update({ where: { id: message.id }, data: { bodyHtml: '<img src="cid:protected">', attachmentsProcessedAt: new Date() } });
    await sourceFile(message.id, "protected.png", Buffer.from("protected"), "protected");
    const permission = await prisma.permission.findUniqueOrThrow({ where: { name: "ticket_attachments.download" } });
    await prisma.rolePermission.deleteMany({ where: { roleId, permissionId: permission.id } });
    try {
      const mail = await sendMessageCopy(message.id);
      expect(mail.rawAttachments).toEqual([]);
      expect(mail.bodyHtml).toContain("download permission required");
    } finally { await prisma.rolePermission.create({ data: { roleId, permissionId: permission.id } }); }
  });
  it("records ambiguous provider failures without automatic resend", async () => {
    await ticket(); await service.enqueue({ organizationId: org, ticketId, userId, eventType: "ticketAssignedToMe", title: "Ambiguous send" });
    await prisma.ticketEmailDelivery.updateMany({ where: { ticketId }, data: { availableAt: new Date(0) } });
    send.mockRejectedValueOnce(new Error("Connection interrupted after send"));
    // Exercise the claimed row directly so unrelated queued fixtures cannot consume the injected failure.
    const row = await prisma.ticketEmailDelivery.findFirstOrThrow({ where: { ticketId } });
    await (service as unknown as { deliver: (value: typeof row) => Promise<void> }).deliver(row);
    expect((await prisma.ticketEmailDelivery.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("REVIEW_REQUIRED");
    const before = send.mock.calls.length;
    await (service as unknown as { deliver: (value: typeof row) => Promise<void> }).deliver(row);
    expect(send.mock.calls.length).toBe(before);
  });
  it("delivers a new assignment on the first dispatch without an artificial delay", async () => {
    await ticket();
    await service.enqueue({ organizationId: org, ticketId, userId, eventType: "ticketAssignedToMe", title: "Ready now" });
    const row = await prisma.ticketEmailDelivery.findFirstOrThrow({ where: { ticketId } });
    expect(row.availableAt.getTime()).toBeLessThanOrEqual(Date.now());
    await (service as unknown as { deliver: (value: typeof row) => Promise<void> }).deliver(row);
    expect((await prisma.ticketEmailDelivery.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("SIMULATED");
    expect(send.mock.calls.at(-1)?.[0]).not.toHaveProperty("replyToProviderMessageId");
  });

  it.each([
    [new MailDeliveryError("Microsoft rejected email delivery (HTTP 403). Nothing was sent.", "NOT_SENT"), "FAILED"],
    [new MailDeliveryError("Microsoft throttled email delivery (HTTP 429).", "NOT_SENT", true, 120000), "PENDING"],
    [new MailDeliveryError("Microsoft send request was interrupted.", "UNKNOWN"), "REVIEW_REQUIRED"]
  ])("records the transport outcome and a safe retry time: %s", async (failure, status) => {
    await ticket();
    await service.enqueue({ organizationId: org, ticketId, userId, eventType: "ticketAssignedToMe", title: "Transport test" });
    const row = await prisma.ticketEmailDelivery.findFirstOrThrow({ where: { ticketId } });
    send.mockRejectedValueOnce(failure);
    const before = Date.now();
    await (service as unknown as { deliver: (value: typeof row) => Promise<void> }).deliver(row);
    const updated = await prisma.ticketEmailDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(updated.status).toBe(status);
    expect(updated.error).toBe((failure as MailDeliveryError).message);
    if (status === "PENDING") expect(updated.availableAt.getTime()).toBeGreaterThanOrEqual(before + 120000);
  });

  it("waits briefly for incomplete inbound files, then sends without exhausting attempts", async () => {
    await ticket();
    const message = await prisma.ticketMessage.findFirstOrThrow({ where: { ticketId } });
    await prisma.ticketMessage.update({ where: { id: message.id }, data: { hasAttachments: true, attachmentsProcessedAt: null } });
    await service.enqueue({ organizationId: org, ticketId, userId, eventType: "ticketAssignedToMe", title: "Files importing" });
    let row = await prisma.ticketEmailDelivery.findFirstOrThrow({ where: { ticketId } });
    const before = send.mock.calls.length;
    await (service as unknown as { deliver: (value: typeof row) => Promise<void> }).deliver(row);
    row = await prisma.ticketEmailDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(row).toMatchObject({ status: "PENDING", attempts: 0, error: "Waiting for inbound attachments to finish importing." });
    expect(send.mock.calls.length).toBe(before);
    expect(row.availableAt.getTime() - Date.now()).toBeLessThanOrEqual(5000);
    await prisma.ticketMessage.update({ where: { id: message.id }, data: { attachmentsProcessedAt: new Date() } });
    await (service as unknown as { deliver: (value: typeof row) => Promise<void> }).deliver(row);
    expect((await prisma.ticketEmailDelivery.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("SIMULATED");
  });

  it("preserves recipient order when workers attempt consecutive messages concurrently", async () => {
    await ticket();
    const first = await delivery(); const second = await delivery();
    await prisma.ticketEmailDelivery.update({ where: { id: first.id }, data: { status: "PENDING", createdAt: new Date(Date.now() - 2000) } });
    await prisma.ticketEmailDelivery.update({ where: { id: second.id }, data: { status: "PENDING", createdAt: new Date(Date.now() - 1000) } });
    const run = (row: typeof first) => (service as unknown as { deliver: (value: typeof row) => Promise<void> }).deliver(row);
    const before = send.mock.calls.length;
    await Promise.all([run(first), run(second)]);
    expect((await prisma.ticketEmailDelivery.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("SIMULATED");
    expect((await prisma.ticketEmailDelivery.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("PENDING");
    expect(send.mock.calls.length).toBe(before + 1);
    await run(second);
    expect((await prisma.ticketEmailDelivery.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("SIMULATED");
    expect(send.mock.calls.length).toBe(before + 2);
  });

  it("keeps capture disabled until configuration is explicitly enabled", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Disabled email feature" } });
    const otherTicket = await prisma.ticket.create({ data: { organizationId: otherOrg.id, ticketNumber: `OFF-${randomUUID()}`, subject: "Legacy behavior" } });
    await prisma.ticketMessage.create({ data: { ticketId: otherTicket.id, direction: "INBOUND", visibility: "PUBLIC", bodyText: "Legacy message" } });
    expect(await prisma.ticketEmailEvent.count({ where: { ticketId: otherTicket.id } })).toBe(0);
    expect(await service.enqueue({ organizationId: otherOrg.id, ticketId: otherTicket.id, userId, eventType: "newTicketCreated", title: "Legacy" })).toBe(false);
  });

  it("imports original reply attachments with inline metadata before sending and rejects blocked types", async () => {
    await ticket(); const proposed = await propose("See the attached screenshot.", "PUBLIC", true);
    loadFiles.mockResolvedValueOnce([{ id: "file", originalFilename: "screenshot.png", mimeType: "image/png", sizeBytes: 4, contentBytes: Buffer.from("test"), isInline: true, contentId: "image001" }]);
    await service.inbound(sender(), incoming("Confirm", `[Confirm ${proposed.token}]`), loadFiles, execute);
    const action = await prisma.ticketEmailAction.findUniqueOrThrow({ where: { id: proposed.action.id } }); expect(action.status).toBe("COMPLETED");
    const imported = await prisma.ticketAttachment.findFirstOrThrow({ where: { ticketMessageId: action.resultMessageId } });
    expect(imported).toMatchObject({ isInline: true, contentId: "image001", originalFilename: "screenshot.png", uploadedByUserId: userId });
    await ticket(); const blocked = await propose("[Closed]\nSee this file.", "PUBLIC", true);
    loadFiles.mockResolvedValueOnce([{ id: "blocked", originalFilename: "unsafe.exe", mimeType: "application/octet-stream", sizeBytes: 4, contentBytes: Buffer.from("test"), isInline: false }]);
    await service.inbound(sender(), incoming("Confirm", `[Confirm ${blocked.token}]`), loadFiles, execute);
    expect((await prisma.ticketEmailAction.findUniqueOrThrow({ where: { id: blocked.action.id } })).status).toBe("REVIEW_REQUIRED");
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe("NEW");
  });

  it("distinguishes explicit followers from obsolete assignment watchers", async () => {
    await ticket(); await prisma.ticketAssignee.deleteMany({ where: { ticketId } }); await prisma.ticket.update({ where: { id: ticketId }, data: { assignedUserId: null } });
    await prisma.ticketWatcher.create({ data: { ticketId, userId, reason: "Manual assignment" } });
    const request = { organizationId: org, ticketId, userId, eventType: "ticketReplyOnAssignedTicket", title: "Follower test" };
    await service.enqueue(request); expect(await prisma.ticketEmailDelivery.count({ where: { ticketId } })).toBe(0);
    await (tickets as unknown as { addWatcher: (id: string, uid: string, by: string, reason: string) => Promise<void> }).addWatcher(ticketId, userId, userId, "Following ticket conversation");
    await service.enqueue(request); expect(await prisma.ticketEmailDelivery.count({ where: { ticketId } })).toBe(1);
  });

});
