import { BlockedInboundEmailStatus, SpamBlockType, SpamRuleAction, SpamRuleScope } from "@prisma/client";
import { SpamManagementService } from "./spam-management.service";

const user = {
  id: "user-1",
  organizationId: "org-1",
  email: "admin@example.com",
  firstName: "Admin",
  lastName: "User",
  forcePasswordChange: false,
  permissions: []
};

describe("SpamManagementService", () => {
  it("lets an exact sender allow rule override a blocked domain", async () => {
    const prisma = {
      spamBlockEntry: {
        findMany: jest.fn().mockResolvedValue([
          { id: "domain-rule", type: SpamBlockType.DOMAIN, normalizedValue: "example.com", action: SpamRuleAction.BLOCK, scope: SpamRuleScope.ALL_INBOUND },
          { id: "sender-rule", type: SpamBlockType.EMAIL, normalizedValue: "person@example.com", action: SpamRuleAction.ALLOW, scope: SpamRuleScope.ALL_INBOUND }
        ])
      }
    };
    const service = new SpamManagementService(prisma as never, {} as never);

    await expect(service.findBlockForSender("org-1", "Person@Example.com")).resolves.toBeNull();
  });

  it("applies a new-conversation block only when no matching ticket conversation exists", async () => {
    const rule = { id: "domain-rule", type: SpamBlockType.DOMAIN, normalizedValue: "example.com", action: SpamRuleAction.BLOCK, scope: SpamRuleScope.NEW_CONVERSATIONS_ONLY };
    const prisma = { spamBlockEntry: { findMany: jest.fn().mockResolvedValue([rule]) } };
    const service = new SpamManagementService(prisma as never, {} as never);

    await expect(service.findBlockForSender("org-1", "person@example.com", null, { isExistingConversation: true })).resolves.toBeNull();
    await expect(service.findBlockForSender("org-1", "person@example.com", null, { isExistingConversation: false })).resolves.toEqual(rule);
  });

  it("claims one release atomically and permits retrying stale processing records", async () => {
    const prisma = { blockedInboundEmail: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    const service = new SpamManagementService(prisma as never, {} as never);

    await expect(service.claimQuarantineRelease("message-1", user)).resolves.toBe(true);
    expect(prisma.blockedInboundEmail.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "message-1",
        organizationId: "org-1",
        OR: expect.arrayContaining([
          { status: BlockedInboundEmailStatus.QUARANTINED },
          expect.objectContaining({ status: BlockedInboundEmailStatus.PROCESSING })
        ])
      }),
      data: expect.objectContaining({ status: BlockedInboundEmailStatus.PROCESSING, resolvedByUserId: "user-1" })
    }));
  });
});
