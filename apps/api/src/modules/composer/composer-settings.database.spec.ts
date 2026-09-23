import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditLogsService } from "../audit-logs/audit-logs.service";
import { ComposerSettingsService } from "./composer-settings.service";
import { AuthenticatedUser } from "../auth/auth.types";
const databaseTests = process.env.TICKET_EMAIL_TEST_DATABASE_URL ? describe : describe.skip;
databaseTests("Composer preferences in isolated PostgreSQL", () => {
  let prisma: PrismaService;
  let service: ComposerSettingsService;
  let actor: AuthenticatedUser;
  beforeAll(async () => {
    const url = process.env.TICKET_EMAIL_TEST_DATABASE_URL!;
    const target = new URL(url);
    if (target.hostname !== "127.0.0.1" || target.port !== "55439" || target.pathname !== "/avidity_email_test") throw new Error("A dedicated disposable database is required.");
    prisma = new PrismaService({ datasources: { db: { url } } });
    const org = await prisma.organization.create({ data: { name: `Composer validation ${randomUUID()}` } });
    await prisma.systemSetting.create({ data: { organizationId: org.id, applicationName: "Synthetic app", companyName: "Synthetic organization", supportEmail: "support@example.invalid" } });
    const user = await prisma.user.create({ data: { organizationId: org.id, email: `${randomUUID()}@example.invalid`, firstName: "Synthetic", lastName: "Operator", passwordHash: "not-a-credential", forcePasswordChange: false } });
    actor = { ...user, permissions: ["system_settings.update"] };
    service = new ComposerSettingsService(prisma, new AuditLogsService(prisma));
  });
  afterAll(async () => { await prisma?.$disconnect(); });
  it("persists independent concurrent fields, inherits current defaults, and isolates accounts", async () => {
    await Promise.all([service.update(actor, { fontSize: 18 }, false), service.update(actor, { pasteMode: "keep" }, false)]);
    await service.update(actor, { color: "#123456" }, true);
    const result = await service.get(actor);
    expect(result.effective).toMatchObject({ fontSize: 18, color: "#123456", pasteMode: "keep" });
    await expect(service.update({ ...actor, organizationId: randomUUID() }, { fontSize: 16 }, false)).rejects.toThrow("owner was not found");
    await service.update(actor, { reset: true }, false);
    expect((await service.get(actor)).effective).toMatchObject({ fontSize: 12, color: "#123456", pasteMode: "adapt" });
  });
});
