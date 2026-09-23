import { BadRequestException } from "@nestjs/common";
import { ComposerSettingsService, validateComposerPatch } from "./composer-settings.service";
import { AuthenticatedUser } from "../auth/auth.types";
const actor: AuthenticatedUser = { id: "user-a", organizationId: "org-a", permissions: ["system_settings.update"], email: "operator@example.invalid", firstName: "Test", lastName: "Operator", forcePasswordChange: false };
function fixture() {
  let organization: Record<string, unknown> = {};
  let person: Record<string, unknown> = {};
  const prisma = {
    systemSetting: { findUnique: jest.fn(async () => ({ composerDefaults: organization })), update: jest.fn(async ({ data }) => { organization = data.composerDefaults; }) },
    user: { findFirst: jest.fn(async () => ({ composerPreferences: person })), update: jest.fn(async ({ data }) => { person = data.composerPreferences; }) },
    $transaction: jest.fn()
  };
  prisma.$transaction.mockImplementation(async fn => fn(prisma));
  const audit = { create: jest.fn(async () => undefined) };
  const service = new ComposerSettingsService(prisma as never, audit as never);
  return { service, prisma, audit };
}
describe("Composer preferences", () => {
  it.each([{ fontSize: 100 }, { color: "url(evil)" }, { fontFamily: "arbitrary" }, { displayScale: 0 }, { organizationId: "other" }, { reset: true, color: "#123456" }, { allowPersonalFormatting: false }])("rejects invalid personal values: %j", patch => {
    expect(() => validateComposerPatch(patch, false)).toThrow(BadRequestException);
  });
  it("inherits unchanged organization values and clears overrides without changing signatures", async () => {
    const { service, prisma, audit } = fixture();
    await service.update(actor, { fontSize: 16, color: "#123456" }, true);
    let result = await service.update(actor, { fontSize: 18, displayScale: 125 }, false);
    expect(result.effective).toMatchObject({ fontSize: 18, color: "#123456", displayScale: 125 });
    result = await service.update(actor, { fontSize: null }, false);
    expect(result.effective.fontSize).toBe(16);
    expect(result.overrides).toEqual({ displayScale: 125 });
    result = await service.update(actor, { reset: true }, false);
    expect(result.effective.displayScale).toBe(100);
    expect(result.effective.fontSize).toBe(16);
    expect(prisma.user.update.mock.calls.every(([args]) => Object.keys(args.data).join() === "composerPreferences")).toBe(true);
    expect(audit.create).toHaveBeenCalledTimes(1);
  });
  it("enforces organization default policy without deleting personal values", async () => {
    const { service } = fixture();
    await service.update(actor, { fontSize: 20, pasteMode: "keep", displayScale: 150 }, false);
    const result = await service.update(actor, { allowPersonalFormatting: false, fontSize: 14 }, true);
    expect(result.effective).toMatchObject({ fontSize: 14, pasteMode: "keep", displayScale: 150 });
    expect(result.overrides.fontSize).toBe(20);
  });
  it("scopes all preference lookups to authenticated identity and reports manage permission", async () => {
    const { service, prisma } = fixture();
    const result = await service.get({ ...actor, permissions: [] });
    expect(prisma.systemSetting.findUnique).toHaveBeenCalledWith({ where: { organizationId: "org-a" }, select: { composerDefaults: true } });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { id: "user-a", organizationId: "org-a" }, select: { composerPreferences: true } });
    expect(result.canManage).toBe(false);
  });
});
