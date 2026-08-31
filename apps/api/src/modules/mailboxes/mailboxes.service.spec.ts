import { BadRequestException } from "@nestjs/common";
import { BlockedInboundEmailStatus, SpamReleaseAction } from "@prisma/client";
import { MailboxesService } from "./mailboxes.service";

const user = {
  id: "user-1",
  organizationId: "org-1",
  email: "admin@example.com",
  firstName: "Admin",
  lastName: "User",
  forcePasswordChange: false,
  permissions: []
};

describe("MailboxesService", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("lists mailboxes only for the current organization", async () => {
    const prisma = {
      mailbox: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const service = new MailboxesService(
      prisma as never,
      { get: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    await service.list(user);

    expect(prisma.mailbox.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      orderBy: { emailAddress: "asc" }
    });
  });

  it("releases a quarantined message without sending a late automatic acknowledgement", async () => {
    const prisma = { ticketMessage: { findFirst: jest.fn().mockResolvedValue(null) } };
    const ticketsService = {
      createFromInboundEmail: jest.fn().mockResolvedValue({ ticket: { id: "ticket-1", ticketNumber: "AIT-100001" }, message: { id: "message-1" } })
    };
    const spamManagement = {
      getQuarantinedEmail: jest.fn().mockResolvedValue({
        id: "quarantine-1",
        organizationId: "org-1",
        status: BlockedInboundEmailStatus.QUARANTINED,
        senderEmail: "person@example.com",
        senderName: "Person",
        subject: "Need assistance",
        bodyText: "Please help.",
        bodyHtml: null,
        emailMessageId: "graph-message-1",
        emailInternetMessageId: "<message@example.com>",
        emailConversationId: "conversation-1",
        inReplyTo: null,
        emailReferences: null,
        hasAttachments: false,
        ccRecipients: [{ email: "manager@example.com", name: "Manager" }],
        internetMessageHeaders: null,
        mailbox: { id: "mailbox-1", provider: "MOCK", connectionMode: "MOCK", emailAddress: "support@example.com", publicEmailAddress: null },
        spamBlockEntry: null
      }),
      claimQuarantineRelease: jest.fn().mockResolvedValue(true),
      applyReleaseRuleAction: jest.fn(),
      markReleased: jest.fn(),
      markReleaseFailed: jest.fn()
    };
    const service = new MailboxesService(
      prisma as never,
      { get: jest.fn() } as never,
      ticketsService as never,
      {} as never,
      spamManagement as never,
      {} as never,
      {} as never
    );

    const result = await service.releaseQuarantinedEmail("quarantine-1", SpamReleaseAction.ALLOW_SENDER, user);

    expect(ticketsService.createFromInboundEmail).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      senderEmail: "person@example.com",
      ccRecipients: [{ email: "manager@example.com", name: "Manager" }],
      suppressAutoReply: true
    }));
    expect(spamManagement.applyReleaseRuleAction).toHaveBeenCalledWith("quarantine-1", SpamReleaseAction.ALLOW_SENDER, user);
    expect(spamManagement.markReleased).toHaveBeenCalledWith("quarantine-1", SpamReleaseAction.ALLOW_SENDER, "ticket-1", "message-1", user);
    expect(result).toEqual({ ticketId: "ticket-1", ticketNumber: "AIT-100001", messageId: "message-1", alreadyReleased: false });
  });

  it("defers automatic sync outside configured operational hours without calling the provider", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-06-30T23:30:00.000Z"));
    const prisma = {
      mailbox: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "mailbox-1",
            organizationId: "org-1",
            emailAddress: "support@example.org",
            autoSyncIntervalSeconds: 60,
            nextAutoSyncAt: new Date("2026-06-30T23:00:00.000Z")
          }
        ]),
        update: jest.fn().mockResolvedValue({})
      },
      systemSetting: {
        findMany: jest.fn().mockResolvedValue([
          {
            organizationId: "org-1",
            emailOperationalHoursEnabled: true,
            emailOperationalTimezone: "America/Chicago",
            emailOperationalDays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
            emailOperationalStartTime: "06:00",
            emailOperationalEndTime: "17:00",
            emailSkipUsFederalHolidays: false,
            emailCustomClosedDates: []
          }
        ])
      }
    };
    const mockMailProvider = {
      syncInboundMessages: jest.fn()
    };
    const service = new MailboxesService(
      prisma as never,
      { get: jest.fn().mockReturnValue("mock") } as never,
      { createFromInboundEmail: jest.fn() } as never,
      { createInboundEmailAttachment: jest.fn() } as never,
      { findBlockForSender: jest.fn(), logBlockedInboundEmail: jest.fn() } as never,
      mockMailProvider as never,
      {} as never
    );

    await (service as unknown as { runDueAutoSyncs: () => Promise<void> }).runDueAutoSyncs();

    expect(mockMailProvider.syncInboundMessages).not.toHaveBeenCalled();
    expect(prisma.mailbox.update).toHaveBeenCalledWith({
      where: { id: "mailbox-1" },
      data: {
        nextAutoSyncAt: expect.any(Date),
        autoSyncLockedAt: null
      }
    });
    expect(prisma.mailbox.update.mock.calls[0][0].data.nextAutoSyncAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("syncs inbound mock messages into tickets and stores the next cursor", async () => {
    const prisma = {
      mailbox: {
        findFirst: jest.fn().mockResolvedValue({
          id: "mailbox-1",
          organizationId: "org-1",
          emailAddress: "support@example.org",
          lastSyncCursor: null,
          tenantId: null,
          microsoftClientId: null,
          encryptedClientSecretReference: null
        }),
        update: jest.fn()
      },
      ticketMessage: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([])
      },
      eventServiceMessage: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn()
      },
      eventServiceRequest: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      eventServiceActivity: {
        create: jest.fn()
      }
    };
    const ticketsService = {
      createFromInboundEmail: jest.fn().mockResolvedValue({ ticket: { id: "ticket-1" } })
    };
    const mockMailProvider = {
      syncInboundMessages: jest.fn().mockResolvedValue({
        messages: [
          {
            providerMessageId: "mock-message-1",
            internetMessageId: "<mock-message-1@example.org>",
            conversationId: "conversation-1",
            from: { email: "requester@example.org", name: "Requester One" },
            cc: [{ email: "manager@example.org", name: "Manager One" }],
            subject: "Need help",
            bodyText: "Please help"
          }
        ],
        nextSyncCursor: "cursor-1"
      })
    };
    const service = new MailboxesService(
      prisma as never,
      { get: jest.fn().mockReturnValue("mock") } as never,
      ticketsService as never,
      { createInboundEmailAttachment: jest.fn() } as never,
      { findBlockForSender: jest.fn().mockResolvedValue(null), logBlockedInboundEmail: jest.fn() } as never,
      mockMailProvider as never,
      {} as never
    );

    await expect(service.syncInbound("mailbox-1", user)).resolves.toEqual({
      mailboxId: "mailbox-1",
      provider: "mock",
      receivedMessages: 1,
      createdTickets: 1,
      skippedDuplicates: 0,
      blockedSpamMessages: 0,
      attachmentBackfilled: 0,
      attachmentBackfillFailures: 0,
      attachmentBackfillErrors: [],
      nextSyncCursor: "cursor-1"
    });
    expect(ticketsService.createFromInboundEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        senderEmail: "requester@example.org",
        senderName: "Requester One",
        ccRecipients: [{ email: "manager@example.org", name: "Manager One" }],
        subject: "Need help",
        emailMessageId: "mock-message-1"
      })
    );
    expect(prisma.mailbox.update).toHaveBeenCalledWith({
      where: { id: "mailbox-1" },
      data: expect.objectContaining({ lastSyncCursor: "cursor-1", inboundProjectionVersion: 2, lastSyncError: null })
    });
  });

  it("starts a fresh delta projection once for mailboxes with a legacy sync cursor", async () => {
    const mailbox = {
      id: "mailbox-1",
      organizationId: "org-1",
      emailAddress: "support@example.org",
      provider: "MOCK",
      connectionMode: "MOCK",
      lastSyncCursor: "https://graph.example/legacy-delta-link",
      inboundProjectionVersion: 1,
      initialSyncFrom: new Date("2026-08-01T00:00:00.000Z"),
      lastSyncedAt: new Date("2026-08-30T15:00:00.000Z"),
      autoSyncEnabled: false,
      autoSyncIntervalSeconds: null,
      nextAutoSyncAt: null,
      tenantId: null,
      microsoftClientId: null,
      encryptedClientSecretReference: null
    };
    const prisma = {
      mailbox: {
        findFirst: jest.fn().mockResolvedValue(mailbox),
        update: jest.fn()
      },
      ticketMessage: { findMany: jest.fn().mockResolvedValue([]) },
      eventServiceMessage: { findFirst: jest.fn().mockResolvedValue(null) },
      eventServiceRequest: { findFirst: jest.fn().mockResolvedValue(null) }
    };
    const mockMailProvider = {
      syncInboundMessages: jest.fn().mockResolvedValue({ messages: [], nextSyncCursor: "fresh-cursor" })
    };
    const service = new MailboxesService(
      prisma as never,
      { get: jest.fn().mockReturnValue("mock") } as never,
      { createFromInboundEmail: jest.fn() } as never,
      { createInboundEmailAttachment: jest.fn() } as never,
      { findBlockForSender: jest.fn().mockResolvedValue(null), logBlockedInboundEmail: jest.fn() } as never,
      mockMailProvider as never,
      {} as never
    );

    await service.syncInbound("mailbox-1", user);

    expect(mockMailProvider.syncInboundMessages).toHaveBeenCalledWith(expect.objectContaining({
      lastSyncCursor: null,
      initialSyncFrom: new Date("2026-08-29T15:00:00.000Z")
    }));
    expect(prisma.mailbox.update).toHaveBeenCalledWith({
      where: { id: "mailbox-1" },
      data: expect.objectContaining({ lastSyncCursor: "fresh-cursor", inboundProjectionVersion: 2 })
    });
  });

  it("runs manual backfill without replacing the daily sync cursor", async () => {
    const prisma = {
      mailbox: {
        findFirst: jest.fn().mockResolvedValue({
          id: "mailbox-1",
          organizationId: "org-1",
          emailAddress: "support@example.org",
          lastSyncCursor: "daily-cursor",
          tenantId: null,
          microsoftClientId: null,
          encryptedClientSecretReference: null,
          autoSyncEnabled: true,
          autoSyncIntervalSeconds: 300,
          nextAutoSyncAt: new Date("2026-06-30T15:00:00.000Z")
        }),
        update: jest.fn().mockResolvedValue({})
      },
      ticketMessage: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([])
      },
      eventServiceMessage: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn()
      },
      eventServiceRequest: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      eventServiceActivity: {
        create: jest.fn()
      }
    };
    const ticketsService = {
      createFromInboundEmail: jest.fn().mockResolvedValue({ ticket: { id: "ticket-1" } })
    };
    const mockMailProvider = {
      syncInboundMessages: jest.fn().mockResolvedValue({
        messages: [
          {
            providerMessageId: "old-message-1",
            internetMessageId: "<old-message-1@example.org>",
            conversationId: "conversation-1",
            from: { email: "requester@example.org", name: "Requester One" },
            subject: "Old request",
            bodyText: "Please review"
          }
        ],
        nextSyncCursor: "backfill-cursor"
      })
    };
    const service = new MailboxesService(
      prisma as never,
      { get: jest.fn().mockReturnValue("mock") } as never,
      ticketsService as never,
      { createInboundEmailAttachment: jest.fn() } as never,
      { findBlockForSender: jest.fn().mockResolvedValue(null), logBlockedInboundEmail: jest.fn() } as never,
      mockMailProvider as never,
      {} as never
    );

    await expect(service.backfillInbound("mailbox-1", "2026-05-25", user)).resolves.toEqual(
      expect.objectContaining({
        receivedMessages: 1,
        createdTickets: 1,
        nextSyncCursor: "backfill-cursor"
      })
    );

    expect(mockMailProvider.syncInboundMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSyncCursor: null,
        initialSyncFrom: new Date("2026-05-25")
      })
    );
    expect(prisma.mailbox.update).toHaveBeenCalledTimes(1);
    expect(prisma.mailbox.update).toHaveBeenCalledWith({
      where: { id: "mailbox-1" },
      data: {
        initialSyncFrom: new Date("2026-05-25"),
        lastSyncError: null
      }
    });
  });

  it("skips already imported provider messages", async () => {
    const prisma = {
      mailbox: {
        findFirst: jest.fn().mockResolvedValue({
          id: "mailbox-1",
          organizationId: "org-1",
          emailAddress: "support@example.org",
          lastSyncCursor: null,
          tenantId: null,
          microsoftClientId: null,
          encryptedClientSecretReference: null
        }),
        update: jest.fn()
      },
      ticketMessage: {
        findFirst: jest.fn().mockResolvedValue({ id: "message-existing", ticketId: "ticket-1" }),
        findMany: jest.fn().mockResolvedValue([])
      },
      eventServiceMessage: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn()
      },
      eventServiceRequest: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      eventServiceActivity: {
        create: jest.fn()
      }
    };
    const ticketsService = {
      createFromInboundEmail: jest.fn()
    };
    const mockMailProvider = {
      syncInboundMessages: jest.fn().mockResolvedValue({
        messages: [
          {
            providerMessageId: "mock-message-1",
            from: { email: "requester@example.org" },
            subject: "Need help"
          }
        ],
        nextSyncCursor: null
      })
    };
    const service = new MailboxesService(
      prisma as never,
      { get: jest.fn().mockReturnValue("mock") } as never,
      ticketsService as never,
      { createInboundEmailAttachment: jest.fn() } as never,
      { findBlockForSender: jest.fn().mockResolvedValue(null), logBlockedInboundEmail: jest.fn() } as never,
      mockMailProvider as never,
      {} as never
    );

    await expect(service.syncInbound("mailbox-1", user)).resolves.toEqual({
      mailboxId: "mailbox-1",
      provider: "mock",
      receivedMessages: 1,
      createdTickets: 0,
      skippedDuplicates: 1,
      blockedSpamMessages: 0,
      attachmentBackfilled: 0,
      attachmentBackfillFailures: 0,
      attachmentBackfillErrors: [],
      nextSyncCursor: null
    });
    expect(ticketsService.createFromInboundEmail).not.toHaveBeenCalled();
  });

  it("checks Microsoft 365 attachments even when Graph does not flag hasAttachments", async () => {
    const prisma = {
      mailbox: {
        findFirst: jest.fn().mockResolvedValue({
          id: "mailbox-1",
          organizationId: "org-1",
          emailAddress: "support@example.org",
          provider: "MICROSOFT365",
          connectionMode: "GRAPH_DIRECT",
          lastSyncCursor: null,
          tenantId: "tenant-1",
          microsoftClientId: "client-1",
          encryptedClientSecretReference: "env:MICROSOFT_CLIENT_SECRET",
          autoSyncEnabled: false,
          autoSyncIntervalSeconds: null,
          nextAutoSyncAt: null
        }),
        update: jest.fn()
      },
      ticketMessage: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn()
      },
      eventServiceMessage: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn()
      },
      eventServiceRequest: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      eventServiceActivity: {
        create: jest.fn()
      }
    };
    const ticketsService = {
      createFromInboundEmail: jest.fn().mockResolvedValue({ ticket: { id: "ticket-1" }, message: { id: "message-1" } })
    };
    const ticketAttachmentsService = {
      createInboundEmailAttachment: jest.fn().mockResolvedValue({ attachment: { id: "attachment-record-1" }, created: true })
    };
    const microsoftGraphProvider = {
      syncInboundMessages: jest.fn().mockResolvedValue({
        messages: [
          {
            providerMessageId: "graph-message-1",
            internetMessageId: "<graph-message-1@example.org>",
            conversationId: "conversation-1",
            from: { email: "requester@example.org", name: "Requester One" },
            subject: "Need help",
            bodyText: "Please see attached",
            hasAttachments: false
          }
        ],
        nextSyncCursor: "cursor-1"
      }),
      getMessageAttachments: jest.fn().mockResolvedValue([
        {
          id: "graph-attachment-1",
          originalFilename: "details.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          sizeBytes: 12,
          contentBytes: Buffer.from("attachment"),
          isInline: false,
          contentId: null
        }
      ])
    };
    const service = new MailboxesService(
      prisma as never,
      { get: jest.fn() } as never,
      ticketsService as never,
      ticketAttachmentsService as never,
      { findBlockForSender: jest.fn().mockResolvedValue(null), logBlockedInboundEmail: jest.fn() } as never,
      {} as never,
      microsoftGraphProvider as never
    );

    await expect(service.syncInbound("mailbox-1", user)).resolves.toEqual(
      expect.objectContaining({
        receivedMessages: 1,
        createdTickets: 1,
        attachmentBackfilled: 1,
        attachmentBackfillFailures: 0
      })
    );

    expect(microsoftGraphProvider.getMessageAttachments).toHaveBeenCalledWith(
      expect.objectContaining({
        mailboxId: "mailbox-1",
        providerMessageId: "graph-message-1"
      })
    );
    expect(ticketAttachmentsService.createInboundEmailAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "ticket-1",
        ticketMessageId: "message-1",
        originalFilename: "details.docx",
        emailAttachmentId: "graph-attachment-1"
      })
    );
    expect(prisma.ticketMessage.update).toHaveBeenCalledWith({
      where: { id: "message-1" },
      data: {
        hasAttachments: true,
        attachmentImportFailures: [],
        attachmentsProcessedAt: expect.any(Date)
      }
    });
  });

  it("records policy-rejected attachments and marks the provider message as processed", async () => {
    const prisma = {
      ticketMessage: {
        update: jest.fn()
      }
    };
    const ticketAttachmentsService = {
      createInboundEmailAttachment: jest.fn().mockRejectedValue(new BadRequestException("Attachment exceeds the 25 MB limit."))
    };
    const provider = {
      getMessageAttachments: jest.fn().mockResolvedValue([
        {
          id: "graph-attachment-too-large",
          originalFilename: "large-poster.png",
          mimeType: "image/png",
          sizeBytes: 30 * 1024 * 1024,
          contentBytes: Buffer.from("oversized"),
          isInline: false,
          contentId: null
        }
      ])
    };
    const service = new MailboxesService(
      prisma as never,
      { get: jest.fn() } as never,
      {} as never,
      ticketAttachmentsService as never,
      {} as never,
      {} as never,
      {} as never
    );

    await expect(
      (
        service as unknown as {
          storeInboundAttachments: (
            provider: unknown,
            mailbox: unknown,
            providerMessageId: string,
            ticketId: string,
            ticketMessageId: string
          ) => Promise<{ stored: number; failed: number; errors: string[] }>;
        }
      ).storeInboundAttachments(
        provider,
        {
          id: "mailbox-1",
          emailAddress: "support@example.org",
          connectionMode: "GRAPH_DIRECT",
          tenantId: "tenant-1",
          microsoftClientId: "client-1",
          encryptedClientSecretReference: "env:MICROSOFT_CLIENT_SECRET"
        },
        "graph-message-1",
        "ticket-1",
        "message-1"
      )
    ).resolves.toEqual({
      stored: 0,
      failed: 1,
      errors: [expect.stringContaining("Attachment exceeds the 25 MB limit.")]
    });

    expect(prisma.ticketMessage.update).toHaveBeenCalledWith({
      where: { id: "message-1" },
      data: {
        hasAttachments: true,
        attachmentImportFailures: [
          expect.objectContaining({
            attachmentId: "graph-attachment-too-large",
            originalFilename: "large-poster.png",
            mimeType: "image/png",
            sizeBytes: 30 * 1024 * 1024,
            reason: "Attachment exceeds the 25 MB limit.",
            rejectedAt: expect.any(String)
          })
        ],
        attachmentsProcessedAt: expect.any(Date)
      }
    });
    expect(
      (
        service as unknown as {
          shouldFetchInboundAttachments: (
            providerName: "microsoft365",
            message: { attachmentsProcessedAt: Date }
          ) => boolean;
        }
      ).shouldFetchInboundAttachments("microsoft365", { attachmentsProcessedAt: new Date() })
    ).toBe(false);
  });

  it("runs broad attachment recovery for existing Microsoft 365 messages after manual sync returns", async () => {
    const prisma = {
      mailbox: {
        findFirst: jest.fn().mockResolvedValue({
          id: "mailbox-1",
          organizationId: "org-1",
          emailAddress: "support@example.org",
          provider: "MICROSOFT365",
          connectionMode: "GRAPH_DIRECT",
          lastSyncCursor: "cursor-1",
          tenantId: "tenant-1",
          microsoftClientId: "client-1",
          encryptedClientSecretReference: "env:MICROSOFT_CLIENT_SECRET",
          autoSyncEnabled: false,
          autoSyncIntervalSeconds: null,
          nextAutoSyncAt: null
        }),
        update: jest.fn()
      },
      ticketMessage: {
        findFirst: jest.fn(),
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              id: "message-existing",
              ticketId: "ticket-1",
              emailMessageId: "graph-message-existing"
            }
          ]),
        update: jest.fn()
      },
      eventServiceMessage: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn()
      },
      eventServiceRequest: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      eventServiceActivity: {
        create: jest.fn()
      }
    };
    const ticketAttachmentsService = {
      createInboundEmailAttachment: jest.fn().mockResolvedValue({ attachment: { id: "attachment-record-1" }, created: true })
    };
    const microsoftGraphProvider = {
      syncInboundMessages: jest.fn().mockResolvedValue({
        messages: [],
        nextSyncCursor: "cursor-2"
      }),
      getMessageAttachments: jest.fn().mockResolvedValue([
        {
          id: "graph-attachment-1",
          originalFilename: "agenda.pdf",
          mimeType: "application/pdf",
          sizeBytes: 12,
          contentBytes: Buffer.from("attachment"),
          isInline: false,
          contentId: null
        }
      ])
    };
    const service = new MailboxesService(
      prisma as never,
      { get: jest.fn() } as never,
      { createFromInboundEmail: jest.fn() } as never,
      ticketAttachmentsService as never,
      { findBlockForSender: jest.fn().mockResolvedValue(null), logBlockedInboundEmail: jest.fn() } as never,
      {} as never,
      microsoftGraphProvider as never
    );

    await expect(service.syncInbound("mailbox-1", user)).resolves.toEqual(
      expect.objectContaining({
        receivedMessages: 0,
        createdTickets: 0,
        attachmentBackfilled: 0,
        attachmentBackfillFailures: 0
      })
    );

    await new Promise((resolve) => setImmediate(resolve));

    expect(prisma.ticketMessage.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          direction: "INBOUND"
        }),
        take: 200
      })
    );
    expect(microsoftGraphProvider.getMessageAttachments).toHaveBeenCalledWith(
      expect.objectContaining({
        mailboxId: "mailbox-1",
        providerMessageId: "graph-message-existing"
      })
    );
    expect(ticketAttachmentsService.createInboundEmailAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "ticket-1",
        ticketMessageId: "message-existing",
        originalFilename: "agenda.pdf",
        emailAttachmentId: "graph-attachment-1"
      })
    );
  });
});
