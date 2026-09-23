import { TicketsService } from "./tickets.service";
import { HtmlSanitizerService } from "../../common/html/html-sanitizer.service";

describe("TicketsService", () => {

  it("rebuilds safe historical display HTML without rewriting stored messages", async () => {
    const original = '<table width="500"><tr><td style="width:143px">Photo</td><td style="width:26px"></td><td>Contact</td></tr></table><script>bad()</script>';
    const ticket = {
      id: "ticket-1", firstReadAt: new Date(),
      messages: [
        { id: "old-outbound", bodyHtml: original, sanitizedBodyHtml: "<table><tr><td>Photo</td><td></td><td>Contact</td></tr></table>" },
        { id: "old-inbound", bodyHtml: '<table align="left" width="100%"><tr><td>EXTERNAL</td></tr></table><p>Reply</p>', sanitizedBodyHtml: "<p>Old display</p>" },
        { id: "fallback", bodyHtml: null, sanitizedBodyHtml: '<p onclick="bad()">Retained safe copy</p>' },
        { id: "plain", bodyHtml: null, sanitizedBodyHtml: null, bodyText: "Plain text remains available" }
      ]
    };
    const prisma = { ticket: { findFirst: jest.fn().mockResolvedValue(ticket), update: jest.fn() }, ticketMessage: { update: jest.fn(), updateMany: jest.fn() } };
    const service = new TicketsService(prisma as never, {} as never, new HtmlSanitizerService(), {} as never, {} as never, {} as never, {} as never, {} as never);
    const result = await service.getById("AIT-100001", {
      id: "user-1", organizationId: "org-1", email: "tech@example.com", firstName: "Tech", lastName: "User", forcePasswordChange: false, permissions: ["tickets.view"]
    });
    expect(result.messages[0].sanitizedBodyHtml).toContain('width="500"');
    expect(result.messages[0].sanitizedBodyHtml).toContain('width:26px');
    expect(result.messages[0].sanitizedBodyHtml).not.toContain("<script");
    expect(result.messages[1].sanitizedBodyHtml).toContain('width="100%"');
    expect(result.messages[2].sanitizedBodyHtml).toBe("<p>Retained safe copy</p>");
    expect(result.messages[3].bodyText).toBe("Plain text remains available");
    expect(result.messages[3].sanitizedBodyHtml).toBeNull();
    expect(ticket.messages[0].sanitizedBodyHtml).not.toContain("width");
    expect(prisma.ticket.update).not.toHaveBeenCalled();
    expect(prisma.ticketMessage.update).not.toHaveBeenCalled();
    expect(prisma.ticketMessage.updateMany).not.toHaveBeenCalled();
  });

  it("creates a ticket with the next human-readable ticket number", async () => {
    const ticket = {
      id: "ticket-1",
      ticketNumber: "AIT-100001",
      subject: "Printer issue"
    };
    const tx = {
      ticketSequence: {
        upsert: jest.fn().mockResolvedValue({ prefix: "AIT", currentValue: 100001 })
      },
      ticket: {
        create: jest.fn().mockResolvedValue(ticket)
      }
    };
    const prisma = {
      ticket: {
        findFirst: jest.fn().mockResolvedValue(null)
      },
      $transaction: jest.fn((callback: (txClient: typeof tx) => unknown) => callback(tx))
    };
    const auditLogs = { create: jest.fn() };
    const sanitizer = { sanitize: jest.fn((value: string) => value) };
    const contactsService = { resolveRequesterFromEmail: jest.fn() };
    const routing = { applyInboundRules: jest.fn() };
    const mailDelivery = { sendTicketReply: jest.fn() };
    const notifications = { notifyUser: jest.fn(), notifyNewTicketCreated: jest.fn() };
    const autoReplies = { sendForNewInboundTicket: jest.fn() };
    const service = new TicketsService(
      prisma as never,
      auditLogs as never,
      sanitizer as never,
      contactsService as never,
      routing as never,
      mailDelivery as never,
      notifications as never,
      autoReplies as never
    );

    await expect(
      service.create(
        {
          subject: "Printer issue"
        },
        {
          id: "user-1",
          organizationId: "org-1",
          email: "tech@example.com",
          firstName: "Tech",
          lastName: "User",
          forcePasswordChange: false,
          permissions: []
        }
      )
    ).resolves.toEqual(ticket);
    expect(tx.ticket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ticketNumber: "AIT-100001",
          subject: "Printer issue"
        })
      })
    );
    expect(auditLogs.create).toHaveBeenCalledWith(expect.objectContaining({ action: "ticket.created" }));
  });

  it("creates inbound email tickets linked to the requester and client resolved from sender domain", async () => {
    const ticket = {
      id: "ticket-1",
      ticketNumber: "AIT-100001",
      clientId: "client-1",
      contactId: "contact-1"
    };
    const message = {
      id: "message-1",
      ticketId: "ticket-1"
    };
    const tx = {
      ticketSequence: {
        upsert: jest.fn().mockResolvedValue({ prefix: "AIT", currentValue: 100001 })
      },
      ticket: {
        create: jest.fn().mockResolvedValue(ticket)
      },
      ticketMessage: {
        create: jest.fn().mockResolvedValue(message)
      },
      ticketConversationParticipant: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn()
      }
    };
    const prisma = {
      mailbox: {
        findMany: jest.fn().mockResolvedValue([{ emailAddress: "support@example.org", publicEmailAddress: null, ingestionEmailAddress: null, outboundFromAddress: null, outboundReplyToAddress: null }])
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      contact: {
        findMany: jest.fn().mockResolvedValue([{ id: "contact-2", email: "manager@cityofharveyil.gov", firstName: "Maria", lastName: "Manager" }])
      },
      $transaction: jest.fn((callback: (txClient: typeof tx) => unknown) => callback(tx))
    };
    const auditLogs = { create: jest.fn() };
    const sanitizer = { sanitize: jest.fn((value: string) => value.replace("<script>", "").replace("</script>", "")) };
    const contactsService = {
      resolveRequesterFromEmail: jest.fn().mockResolvedValue({
        client: { id: "client-1", name: "City of Harvey" },
        contact: { id: "contact-1", email: "jane@cityofharveyil.gov" },
        domain: "cityofharveyil.gov",
        created: false
      })
    };
    const routing = { applyInboundRules: jest.fn().mockResolvedValue(null) };
    const mailDelivery = { sendTicketReply: jest.fn() };
    const notifications = { notifyUser: jest.fn(), notifyNewTicketCreated: jest.fn() };
    const autoReplies = { sendForNewInboundTicket: jest.fn().mockResolvedValue({ sent: false, reason: "no_template" }) };
    const service = new TicketsService(
      prisma as never,
      auditLogs as never,
      sanitizer as never,
      contactsService as never,
      routing as never,
      mailDelivery as never,
      notifications as never,
      autoReplies as never
    );

    await expect(
      service.createFromInboundEmail({
        organizationId: "org-1",
        senderEmail: "jane@cityofharveyil.gov",
        senderName: "Jane Mayor",
        subject: "Need workstation help",
        bodyText: "Please help",
        bodyHtml: "<p>Please help</p><script>bad()</script>",
        ccRecipients: [
          { email: "Manager@cityofharveyil.gov", name: "Maria Manager" },
          { email: "support@example.org", name: "Avidity Support" },
          { email: "jane@cityofharveyil.gov", name: "Jane Mayor" }
        ],
        emailInternetMessageId: "<message@example.org>"
      })
    ).resolves.toEqual({ ticket, message });

    expect(contactsService.resolveRequesterFromEmail).toHaveBeenCalledWith({
      emailAddress: "jane@cityofharveyil.gov",
      displayName: "Jane Mayor",
      organizationId: "org-1"
    });
    expect(tx.ticket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticketNumber: "AIT-100001",
        clientId: "client-1",
        contactId: "contact-1",
        source: "EMAIL"
      })
    });
    expect(tx.ticketMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticketId: "ticket-1",
        authorContactId: "contact-1",
        direction: "INBOUND",
        visibility: "PUBLIC",
        ccEmails: ["manager@cityofharveyil.gov", "support@example.org", "jane@cityofharveyil.gov"],
        sanitizedBodyHtml: "<p>Please help</p>bad()",
        emailInternetMessageId: "<message@example.org>"
      })
    });
    expect(tx.ticketConversationParticipant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticketId: "ticket-1",
        email: "manager@cityofharveyil.gov",
        displayName: "Maria Manager",
        contactId: "contact-2",
        addedById: null
      })
    });
    expect(tx.ticketConversationParticipant.create).toHaveBeenCalledTimes(1);
    expect(auditLogs.create).toHaveBeenCalledWith(expect.objectContaining({ action: "ticket.created_from_inbound_email" }));
    expect(auditLogs.create).toHaveBeenCalledWith(expect.objectContaining({ action: "ticket.inbound_cc_participants_captured" }));
    expect(autoReplies.sendForNewInboundTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        ticketId: "ticket-1",
        messageId: "message-1",
        senderEmail: "jane@cityofharveyil.gov"
      })
    );
  });

  it("creates a manual ticket, its original request, and its assignment atomically", async () => {
    const ticket = { id: "ticket-2", ticketNumber: "AIT-100002", assignedUserId: "user-2", assignedTeamId: null, assignedGroupId: null };
    const tx = {
      ticketSequence: { upsert: jest.fn().mockResolvedValue({ prefix: "AIT", currentValue: 100002 }) },
      ticket: { create: jest.fn().mockResolvedValue(ticket) },
      ticketMessage: { create: jest.fn().mockResolvedValue({ id: "message-1" }) },
      ticketAssignee: { create: jest.fn().mockResolvedValue({}) }
    };
    const prisma = {
      client: { findFirst: jest.fn().mockResolvedValue({ id: "client-1" }) },
      contact: { findFirst: jest.fn().mockResolvedValue({ id: "contact-1", clientId: "client-1", email: "requester@example.com" }) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: "user-2" }]) },
      ticket: { findUnique: jest.fn().mockResolvedValue(ticket) },
      ticketAssignee: { findMany: jest.fn().mockResolvedValue([{ userId: "user-2" }]) },
      ticketWatcher: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
      $transaction: jest.fn((callback: (txClient: typeof tx) => unknown) => callback(tx))
    };
    const notifications = { notifyUser: jest.fn(), notifyNewTicketCreated: jest.fn() };
    const service = new TicketsService(
      prisma as never,
      { create: jest.fn() } as never,
      { sanitize: jest.fn((value: string) => value) } as never,
      { resolveRequesterFromEmail: jest.fn() } as never,
      { applyInboundRules: jest.fn() } as never,
      { sendTicketReply: jest.fn() } as never,
      notifications as never,
      { sendForNewInboundTicket: jest.fn() } as never
    );

    await expect(service.create({
      subject: "New employee setup",
      description: "Please prepare the account.",
      clientId: "client-1",
      contactId: "contact-1",
      assignedUserIds: ["user-2"]
    }, {
      id: "user-1",
      organizationId: "org-1",
      email: "admin@example.com",
      firstName: "Admin",
      lastName: "User",
      forcePasswordChange: false,
      permissions: ["tickets.assign"]
    })).resolves.toEqual(ticket);

    expect(tx.ticketMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticketId: "ticket-2",
        bodyText: "Please prepare the account.",
        direction: "INBOUND",
        visibility: "PUBLIC",
        senderEmail: "requester@example.com"
      })
    });
    expect(tx.ticketAssignee.create).toHaveBeenCalledWith({
      data: { ticketId: "ticket-2", userId: "user-2", assignedById: "user-1" }
    });
    expect(notifications.notifyUser).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-2", eventType: "ticketAssignedToMe" }));
  });

  it("adds inbound customer replies to the existing thread and reopens closed tickets", async () => {
    const existingTicket = {
      id: "ticket-1",
      ticketNumber: "AIT-100001",
      status: "CLOSED",
      clientId: null,
      contactId: null,
      assignedUserId: "user-2",
      assignedTeamId: null,
      assignedGroupId: null,
      closedAt: new Date("2026-08-27T12:00:00Z")
    };
    const updatedTicket = {
      ...existingTicket,
      status: "REOPENED",
      clientId: "client-1",
      contactId: "contact-1"
    };
    const message = {
      id: "message-2",
      ticketId: "ticket-1"
    };
    const tx = {
      ticket: {
        update: jest.fn().mockResolvedValue(updatedTicket)
      },
      ticketMessage: {
        create: jest.fn().mockResolvedValue(message)
      }
    };
    const prisma = {
      ticket: {
        findFirst: jest.fn().mockResolvedValue(existingTicket),
        findUnique: jest.fn().mockResolvedValue(existingTicket)
      },
      ticketMessage: {
        count: jest.fn().mockResolvedValue(0)
      },
      ticketAssignee: { findMany: jest.fn().mockResolvedValue([{ userId: "user-3" }]) },
      ticketWatcher: { findMany: jest.fn().mockResolvedValue([{ userId: "user-4" }]), upsert: jest.fn() },
      $transaction: jest.fn((callback: (txClient: typeof tx) => unknown) => callback(tx))
    };
    const auditLogs = { create: jest.fn() };
    const sanitizer = { sanitize: jest.fn((value: string) => value) };
    const contactsService = {
      resolveRequesterFromEmail: jest.fn().mockResolvedValue({
        client: { id: "client-1", name: "City of Harvey" },
        contact: { id: "contact-1", email: "jane@cityofharveyil.gov" },
        domain: "cityofharveyil.gov",
        created: false
      })
    };
    const routing = { applyInboundRules: jest.fn() };
    const mailDelivery = { sendTicketReply: jest.fn() };
    const notifications = { notifyUser: jest.fn(), notifyNewTicketCreated: jest.fn() };
    const autoReplies = { sendForNewInboundTicket: jest.fn() };
    const service = new TicketsService(
      prisma as never,
      auditLogs as never,
      sanitizer as never,
      contactsService as never,
      routing as never,
      mailDelivery as never,
      notifications as never,
      autoReplies as never
    );

    await expect(
      service.createFromInboundEmail({
        organizationId: "org-1",
        senderEmail: "jane@cityofharveyil.gov",
        senderName: "Jane Mayor",
        subject: "Re: Need workstation help",
        bodyText: "This is still happening",
        emailMessageId: "graph-message-2",
        emailInternetMessageId: "<message-2@example.org>",
        emailConversationId: "conversation-1",
        inReplyTo: "<message-1@example.org>"
      })
    ).resolves.toEqual({ ticket: updatedTicket, message });

    expect(prisma.ticket.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-1",
          deletedAt: null,
          OR: expect.any(Array)
        })
      })
    );
    expect(tx.ticket.update).toHaveBeenCalledWith({
      where: { id: "ticket-1" },
      data: expect.objectContaining({
        clientId: "client-1",
        contactId: "contact-1",
        status: "REOPENED",
        closedAt: null,
        resolvedAt: null
      })
    });
    expect(tx.ticketMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticketId: "ticket-1",
        direction: "INBOUND",
        inReplyTo: "<message-1@example.org>"
      })
    });
    expect(routing.applyInboundRules).not.toHaveBeenCalled();
    expect(auditLogs.create).toHaveBeenCalledWith(expect.objectContaining({ action: "ticket.reopened_from_customer_reply" }));
    for (const userId of ["user-2", "user-3", "user-4"]) {
      expect(notifications.notifyUser).toHaveBeenCalledWith(expect.objectContaining({ userId, eventType: "ticketReplyOnAssignedTicket" }));
      expect(notifications.notifyUser).toHaveBeenCalledWith(expect.objectContaining({ userId, eventType: "ticketReopened" }));
    }
  });

  it("marks existing tickets as waiting on technician when a customer replies after a public technician response", async () => {
    const existingTicket = {
      id: "ticket-1",
      ticketNumber: "AIT-100001",
      status: "WAITING_ON_CUSTOMER",
      clientId: "client-1",
      contactId: "contact-1"
    };
    const updatedTicket = {
      ...existingTicket,
      status: "WAITING_ON_TECHNICIAN"
    };
    const message = {
      id: "message-2",
      ticketId: "ticket-1"
    };
    const tx = {
      ticket: {
        update: jest.fn().mockResolvedValue(updatedTicket)
      },
      ticketMessage: {
        create: jest.fn().mockResolvedValue(message)
      }
    };
    const prisma = {
      ticket: {
        findFirst: jest.fn().mockResolvedValue(existingTicket),
        findUnique: jest.fn().mockResolvedValue(existingTicket)
      },
      ticketMessage: {
        count: jest.fn().mockResolvedValue(1)
      },
      ticketAssignee: { findMany: jest.fn().mockResolvedValue([]) },
      ticketWatcher: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
      $transaction: jest.fn((callback: (txClient: typeof tx) => unknown) => callback(tx))
    };
    const auditLogs = { create: jest.fn() };
    const sanitizer = { sanitize: jest.fn((value: string) => value) };
    const contactsService = {
      resolveRequesterFromEmail: jest.fn().mockResolvedValue({
        client: { id: "client-1", name: "City of Harvey" },
        contact: { id: "contact-1", email: "jane@cityofharveyil.gov" },
        domain: "cityofharveyil.gov",
        created: false
      })
    };
    const routing = { applyInboundRules: jest.fn() };
    const mailDelivery = { sendTicketReply: jest.fn() };
    const notifications = { notifyUser: jest.fn(), notifyNewTicketCreated: jest.fn() };
    const autoReplies = { sendForNewInboundTicket: jest.fn() };
    const service = new TicketsService(
      prisma as never,
      auditLogs as never,
      sanitizer as never,
      contactsService as never,
      routing as never,
      mailDelivery as never,
      notifications as never,
      autoReplies as never
    );

    await expect(
      service.createFromInboundEmail({
        organizationId: "org-1",
        senderEmail: "jane@cityofharveyil.gov",
        senderName: "Jane Mayor",
        subject: "Re: Need workstation help",
        bodyText: "I tried that and still need help",
        emailConversationId: "conversation-1",
        inReplyTo: "<message-1@example.org>"
      })
    ).resolves.toEqual({ ticket: updatedTicket, message });

    expect(prisma.ticketMessage.count).toHaveBeenCalledWith({
      where: {
        ticketId: "ticket-1",
        direction: "OUTBOUND",
        visibility: "PUBLIC"
      }
    });
    expect(tx.ticket.update).toHaveBeenCalledWith({
      where: { id: "ticket-1" },
      data: expect.objectContaining({
        lastCustomerResponseAt: expect.any(Date),
        status: "WAITING_ON_TECHNICIAN"
      })
    });
  });

  it("marks public technician replies as waiting on customer when the ticket is not closed", async () => {
    const ticket = {
      id: "ticket-1",
      ticketNumber: "AIT-100001",
      status: "OPEN",
      subject: "Printer issue",
      mailboxId: null,
      firstResponseAt: null,
      assignedUserId: null,
      assignedTeamId: null,
      assignedGroupId: null
    };
    const message = { id: "message-1", ticketId: "ticket-1" };
    const prisma = {
      ticket: {
        findFirst: jest.fn().mockResolvedValue(ticket),
        findUnique: jest.fn().mockResolvedValue(ticket),
        update: jest.fn().mockResolvedValue({ ...ticket, status: "WAITING_ON_CUSTOMER" })
      },
      ticketMessage: {
        findFirst: jest.fn().mockResolvedValue({
          senderEmail: "customer@example.com",
          emailInternetMessageId: "<customer-message@example.com>",
          emailMessageId: "provider-message-1",
          emailReferences: null,
          emailConversationId: "conversation-1"
        }),
        create: jest.fn().mockResolvedValue(message)
      },
      ticketAttachment: {
        updateMany: jest.fn()
      },
      ticketAssignee: {
        findMany: jest.fn().mockResolvedValue([])
      },
      ticketWatcher: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn()
      },
      ticketConversationParticipant: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({})
      },
      contact: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };
    const auditLogs = { create: jest.fn() };
    const sanitizer = new HtmlSanitizerService();
    const signedHtml = '<p>Please try restarting the printer.</p><table style="width:500px"><tr><td style="width:143px">Photo</td><td style="width:26px"></td><td style="width:331px">Support</td></tr></table><script>bad()</script>';
    const contactsService = { resolveRequesterFromEmail: jest.fn() };
    const routing = { applyInboundRules: jest.fn() };
    const mailDelivery = {
      sendTicketReply: jest.fn().mockResolvedValue({
        providerMessageId: "sent-message-1",
        internetMessageId: "<sent-message@example.com>",
        conversationId: "conversation-1"
      })
    };
    const notifications = { notifyUser: jest.fn(), notifyNewTicketCreated: jest.fn() };
    const autoReplies = { sendForNewInboundTicket: jest.fn() };
    const service = new TicketsService(
      prisma as never,
      auditLogs as never,
      sanitizer as never,
      contactsService as never,
      routing as never,
      mailDelivery as never,
      notifications as never,
      autoReplies as never
    );

    await expect(
      service.createMessage(
        "AIT-100001",
        {
          bodyText: "Please try restarting the printer.",
          bodyHtml: signedHtml,
          visibility: "public",
          ccEmails: ["manager@example.com"],
          persistCc: true,
          action: "send"
        },
        {
          id: "user-1",
          organizationId: "org-1",
          email: "tech@example.com",
          firstName: "Tech",
          lastName: "User",
          forcePasswordChange: false,
          permissions: []
        }
      )
    ).resolves.toEqual(message);

    const deliveredHtml = mailDelivery.sendTicketReply.mock.calls[0][0].bodyHtml;
    expect(deliveredHtml).toContain("width:500px");
    expect(deliveredHtml).toContain("width:26px");
    expect(deliveredHtml).not.toContain("<script");
    expect(prisma.ticketMessage.create).toHaveBeenCalledWith({ data: expect.objectContaining({ bodyHtml: signedHtml, sanitizedBodyHtml: deliveredHtml.replace(/<p>Ticket: AIT-100001<\/p>$/, "") }) });

    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: "ticket-1" },
      data: expect.objectContaining({
        status: "WAITING_ON_CUSTOMER",
        closedAt: null,
        resolvedAt: null,
        lastTechnicianResponseAt: expect.any(Date),
        firstResponseAt: expect.any(Date)
      })
    });
    expect(prisma.ticketMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        mailDeliveryStatus: "ACCEPTED",
        mailDeliveryAttemptedAt: expect.any(Date),
        mailDeliveryAcceptedAt: expect.any(Date)
      })
    });
    expect(mailDelivery.sendTicketReply).toHaveBeenCalledWith(expect.objectContaining({ cc: ["manager@example.com"] }));
    expect(prisma.ticketConversationParticipant.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { ticketId_email: { ticketId: "ticket-1", email: "manager@example.com" } },
      create: expect.objectContaining({ ticketId: "ticket-1", email: "manager@example.com", addedById: "user-1" })
    }));
  });

  it("sends a manual ticket reply to the saved requester and includes the ticket number in the subject", async () => {
    const ticket = {
      id: "ticket-1",
      ticketNumber: "AIT-100001",
      status: "OPEN",
      subject: "New employee setup",
      mailboxId: null,
      contactId: "contact-1",
      senderEmail: "requester@example.com",
      firstResponseAt: null,
      assignedUserId: null,
      assignedTeamId: null,
      assignedGroupId: null
    };
    const prisma = {
      ticket: {
        findFirst: jest.fn().mockResolvedValue(ticket),
        findUnique: jest.fn().mockResolvedValue(ticket),
        update: jest.fn().mockResolvedValue(ticket)
      },
      ticketMessage: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "message-1", ticketId: "ticket-1" })
      },
      ticketAttachment: { updateMany: jest.fn() },
      ticketAssignee: { findMany: jest.fn().mockResolvedValue([]) },
      ticketWatcher: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
      ticketConversationParticipant: { findMany: jest.fn().mockResolvedValue([{ email: "manager@example.com", userId: null }]) }
    };
    const mailDelivery = { sendTicketReply: jest.fn().mockResolvedValue({ providerMessageId: "message-1", internetMessageId: null, conversationId: null }) };
    const service = new TicketsService(
      prisma as never,
      { create: jest.fn() } as never,
      { sanitize: jest.fn((value: string) => value) } as never,
      { resolveRequesterFromEmail: jest.fn() } as never,
      { applyInboundRules: jest.fn() } as never,
      mailDelivery as never,
      { notifyUser: jest.fn(), notifyNewTicketCreated: jest.fn() } as never,
      { sendForNewInboundTicket: jest.fn() } as never
    );

    await service.createMessage("AIT-100001", { visibility: "public", bodyText: "The account is ready.", action: "send" }, {
      id: "user-1", organizationId: "org-1", email: "tech@example.com", firstName: "Tech", lastName: "User", forcePasswordChange: false, permissions: []
    });

    expect(mailDelivery.sendTicketReply).toHaveBeenCalledWith(expect.objectContaining({
      to: ["requester@example.com"],
      cc: ["manager@example.com"],
      subject: "Re: [AIT-100001] New employee setup"
    }));

    await service.createMessage("AIT-100001", {
      visibility: "public",
      bodyText: "Private follow-up for the requester.",
      action: "send",
      includePersistentCc: false
    }, {
      id: "user-1", organizationId: "org-1", email: "tech@example.com", firstName: "Tech", lastName: "User", forcePasswordChange: false, permissions: []
    });
    expect(mailDelivery.sendTicketReply).toHaveBeenNthCalledWith(2, expect.objectContaining({ cc: [] }));
  });

  it("keeps the original requester on replies when a conversation participant answers", async () => {
    const ticket = {
      id: "ticket-1",
      ticketNumber: "AIT-100001",
      status: "OPEN",
      subject: "Account access",
      mailboxId: "mailbox-1",
      contactId: "contact-1",
      senderEmail: "requester@example.com",
      firstResponseAt: new Date(),
      assignedUserId: null,
      assignedTeamId: null,
      assignedGroupId: null
    };
    const prisma = {
      ticket: {
        findFirst: jest.fn().mockResolvedValue(ticket),
        findUnique: jest.fn().mockResolvedValue(ticket),
        update: jest.fn().mockResolvedValue(ticket)
      },
      ticketMessage: {
        findFirst: jest.fn().mockResolvedValue({
          senderEmail: "manager@example.com",
          emailMessageId: "provider-message-2",
          emailInternetMessageId: "<manager-reply@example.com>",
          emailReferences: "<requester-message@example.com>",
          emailConversationId: "conversation-1"
        }),
        create: jest.fn().mockResolvedValue({ id: "message-3", ticketId: "ticket-1" })
      },
      ticketAttachment: { updateMany: jest.fn() },
      ticketAssignee: { findMany: jest.fn().mockResolvedValue([]) },
      ticketWatcher: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() },
      ticketConversationParticipant: {
        findMany: jest.fn().mockResolvedValue([{ email: "manager@example.com", userId: null }])
      }
    };
    const mailDelivery = {
      sendTicketReply: jest.fn().mockResolvedValue({ providerMessageId: "sent-message-3", internetMessageId: null, conversationId: "conversation-1" })
    };
    const service = new TicketsService(
      prisma as never,
      { create: jest.fn() } as never,
      { sanitize: jest.fn((value: string) => value) } as never,
      { resolveRequesterFromEmail: jest.fn() } as never,
      { applyInboundRules: jest.fn() } as never,
      mailDelivery as never,
      { notifyUser: jest.fn(), notifyNewTicketCreated: jest.fn() } as never,
      { sendForNewInboundTicket: jest.fn() } as never
    );

    await service.createMessage("AIT-100001", { visibility: "public", bodyText: "We are reviewing this.", action: "send" }, {
      id: "user-1", organizationId: "org-1", email: "tech@example.com", firstName: "Tech", lastName: "User", forcePasswordChange: false, permissions: []
    });

    expect(mailDelivery.sendTicketReply).toHaveBeenCalledWith(expect.objectContaining({
      to: ["manager@example.com"],
      cc: ["requester@example.com"]
    }));
    expect(prisma.ticketMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ ccEmails: ["requester@example.com"] })
    });
  });

  it("does not reactivate a conversation participant removed manually when inbound CC is captured", async () => {
    const tx = {
      ticketConversationParticipant: {
        findMany: jest.fn().mockResolvedValue([{ id: "participant-1", email: "manager@example.com", isActive: false }]),
        update: jest.fn(),
        create: jest.fn()
      }
    };
    const service = new TicketsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    const capture = await (service as unknown as {
      captureInboundConversationParticipants: (
        txClient: typeof tx,
        ticketId: string,
        participants: Array<{ email: string; displayName: string | null; userId: string | null; contactId: string | null }>
      ) => Promise<{ activeEmails: string[]; addedEmails: string[]; suppressedEmails: string[] }>;
    }).captureInboundConversationParticipants(tx, "ticket-1", [{
      email: "manager@example.com",
      displayName: "Manager",
      userId: null,
      contactId: null
    }]);

    expect(capture).toEqual({ activeEmails: [], addedEmails: [], suppressedEmails: ["manager@example.com"] });
    expect(tx.ticketConversationParticipant.update).not.toHaveBeenCalled();
    expect(tx.ticketConversationParticipant.create).not.toHaveBeenCalled();
  });

  it("does not save a public reply when outbound delivery is unavailable", async () => {
    const ticket = {
      id: "ticket-1", ticketNumber: "AIT-100001", status: "OPEN", subject: "Printer issue", mailboxId: null,
      contactId: null, senderEmail: "customer@example.com", firstResponseAt: null, assignedUserId: null, assignedTeamId: null, assignedGroupId: null
    };
    const prisma = {
      ticket: { findFirst: jest.fn().mockResolvedValue(ticket) },
      ticketMessage: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      ticketConversationParticipant: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const service = new TicketsService(
      prisma as never,
      { create: jest.fn() } as never,
      { sanitize: jest.fn((value: string) => value) } as never,
      { resolveRequesterFromEmail: jest.fn() } as never,
      { applyInboundRules: jest.fn() } as never,
      { sendTicketReply: jest.fn().mockResolvedValue(null) } as never,
      { notifyUser: jest.fn(), notifyNewTicketCreated: jest.fn() } as never,
      { sendForNewInboundTicket: jest.fn() } as never
    );

    await expect(service.createMessage("AIT-100001", { visibility: "public", bodyText: "Reply", action: "send" }, {
      id: "user-1", organizationId: "org-1", email: "tech@example.com", firstName: "Tech", lastName: "User", forcePasswordChange: false, permissions: []
    })).rejects.toThrow("Outbound email delivery is not enabled");
    expect(prisma.ticketMessage.create).not.toHaveBeenCalled();
  });

  it("uses internal note CC as internal watcher notifications without sending email", async () => {
    const ticket = {
      id: "ticket-1",
      ticketNumber: "AIT-100001",
      status: "OPEN",
      subject: "Printer issue",
      mailboxId: null,
      firstResponseAt: null,
      assignedUserId: null,
      assignedTeamId: null,
      assignedGroupId: null
    };
    const message = { id: "message-1", ticketId: "ticket-1" };
    const prisma = {
      ticket: {
        findFirst: jest.fn().mockResolvedValue(ticket),
        update: jest.fn().mockResolvedValue(ticket)
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: "user-2", email: "observer@example.com" }])
      },
      ticketMessage: {
        create: jest.fn().mockResolvedValue(message)
      },
      ticketAttachment: {
        updateMany: jest.fn()
      },
      ticketWatcher: {
        upsert: jest.fn().mockResolvedValue({})
      }
    };
    const auditLogs = { create: jest.fn() };
    const sanitizer = { sanitize: jest.fn((value: string) => value) };
    const contactsService = { resolveRequesterFromEmail: jest.fn() };
    const routing = { applyInboundRules: jest.fn() };
    const mailDelivery = { sendTicketReply: jest.fn() };
    const notifications = { notifyUser: jest.fn(), notifyNewTicketCreated: jest.fn() };
    const autoReplies = { sendForNewInboundTicket: jest.fn() };
    const service = new TicketsService(
      prisma as never,
      auditLogs as never,
      sanitizer as never,
      contactsService as never,
      routing as never,
      mailDelivery as never,
      notifications as never,
      autoReplies as never
    );

    await expect(
      service.createMessage(
        "AIT-100001",
        {
          bodyText: "Internal update",
          bodyHtml: "<p>Internal update</p>",
          visibility: "internal",
          ccUserIds: ["user-2"],
          action: "save_note"
        },
        {
          id: "user-1",
          organizationId: "org-1",
          email: "tech@example.com",
          firstName: "Tech",
          lastName: "User",
          forcePasswordChange: false,
          permissions: []
        }
      )
    ).resolves.toEqual(message);

    expect(mailDelivery.sendTicketReply).not.toHaveBeenCalled();
    expect("ticketConversationParticipant" in prisma).toBe(false);
    expect(prisma.ticketMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: "INTERNAL",
        visibility: "INTERNAL",
        ccEmails: ["observer@example.com"],
        notifiedUserIds: ["user-2"]
      })
    });
    expect(prisma.ticketWatcher.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ userId: "user-2", reason: "CC on internal note" })
    }));
    expect(notifications.notifyUser).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-2",
      ticketId: "ticket-1",
      title: "Internal note added",
      eventType: "internalNoteMention"
    }));
  });

  it("merges selected source tickets into a primary ticket", async () => {
    const user = {
      id: "user-1",
      organizationId: "org-1",
      email: "tech@example.com",
      firstName: "Tech",
      lastName: "User",
      forcePasswordChange: false,
      permissions: ["tickets.merge"]
    };
    const primaryTicket = {
      id: "primary-ticket",
      ticketNumber: "AIT-100001",
      subject: "Network issue",
      clientId: "client-1",
      status: "OPEN"
    };
    const sourceTickets = [
      {
        id: "source-ticket",
        ticketNumber: "AIT-100002",
        subject: "Related outage",
        clientId: "client-1",
        status: "NEW",
        mergedIntoTicketId: null
      }
    ];
    const tx = {
      ticketMerge: {
        create: jest.fn()
      },
      ticketWatcher: {
        findMany: jest.fn().mockResolvedValue([{ userId: "watcher-1", reason: "Assigned" }]),
        upsert: jest.fn()
      },
      ticketMessage: {
        updateMany: jest.fn(),
        create: jest.fn()
      },
      ticketAttachment: {
        updateMany: jest.fn()
      },
      ticket: {
        update: jest.fn()
      }
    };
    const prisma = {
      ticket: {
        findFirst: jest.fn().mockResolvedValue(primaryTicket),
        findMany: jest.fn().mockResolvedValue(sourceTickets)
      },
      $transaction: jest.fn((callback: (txClient: typeof tx) => unknown) => callback(tx))
    };
    const auditLogs = { create: jest.fn() };
    const sanitizer = { sanitize: jest.fn((value: string) => value) };
    const contactsService = { resolveRequesterFromEmail: jest.fn() };
    const routing = { applyInboundRules: jest.fn() };
    const mailDelivery = { sendTicketReply: jest.fn() };
    const notifications = { notifyUser: jest.fn(), notifyNewTicketCreated: jest.fn() };
    const autoReplies = { sendForNewInboundTicket: jest.fn() };
    const service = new TicketsService(
      prisma as never,
      auditLogs as never,
      sanitizer as never,
      contactsService as never,
      routing as never,
      mailDelivery as never,
      notifications as never,
      autoReplies as never
    );
    jest.spyOn(service, "getById").mockResolvedValue({ id: "primary-ticket" } as never);

    await expect(service.mergeTickets("primary-ticket", { sourceTicketIds: ["source-ticket"], reason: "Same outage" }, user)).resolves.toEqual({ id: "primary-ticket" });

    expect(tx.ticketMerge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        primaryTicketId: "primary-ticket",
        mergedTicketIds: ["source-ticket"],
        performedByUserId: "user-1",
        reason: "Same outage"
      })
    });
    expect(tx.ticketMessage.updateMany).toHaveBeenCalledWith({
      where: { ticketId: "source-ticket" },
      data: expect.objectContaining({
        ticketId: "primary-ticket",
        mergedFromTicketId: "source-ticket",
        mergedFromTicketNumber: "AIT-100002"
      })
    });
    expect(tx.ticketAttachment.updateMany).toHaveBeenCalledWith({
      where: { ticketId: "source-ticket" },
      data: { ticketId: "primary-ticket" }
    });
    expect(tx.ticket.update).toHaveBeenCalledWith({
      where: { id: "source-ticket" },
      data: expect.objectContaining({
        status: "MERGED",
        mergedIntoTicketId: "primary-ticket",
        mergedByUserId: "user-1",
        mergeReason: "Same outage"
      })
    });
    expect(auditLogs.create).toHaveBeenCalledWith(expect.objectContaining({ action: "ticket.merged" }));
  });

  it("rejects replies on tickets that were merged into another ticket", async () => {
    const prisma = {
      ticket: {
        findFirst: jest.fn().mockResolvedValue({
          id: "source-ticket",
          status: "MERGED"
        })
      }
    };
    const auditLogs = { create: jest.fn() };
    const sanitizer = { sanitize: jest.fn((value: string) => value) };
    const contactsService = { resolveRequesterFromEmail: jest.fn() };
    const routing = { applyInboundRules: jest.fn() };
    const mailDelivery = { sendTicketReply: jest.fn() };
    const notifications = { notifyUser: jest.fn(), notifyNewTicketCreated: jest.fn() };
    const autoReplies = { sendForNewInboundTicket: jest.fn() };
    const service = new TicketsService(
      prisma as never,
      auditLogs as never,
      sanitizer as never,
      contactsService as never,
      routing as never,
      mailDelivery as never,
      notifications as never,
      autoReplies as never
    );

    await expect(
      service.createMessage(
        "source-ticket",
        {
          bodyText: "Reply",
          visibility: "public"
        },
        {
          id: "user-1",
          organizationId: "org-1",
          email: "tech@example.com",
          firstName: "Tech",
          lastName: "User",
          forcePasswordChange: false,
          permissions: []
        }
      )
    ).rejects.toThrow("Reply from the primary ticket");
  });

  it("notifies every selected specialist when a ticket is assigned to multiple users", async () => {
    const user = {
      id: "dispatcher-1",
      organizationId: "org-1",
      email: "dispatcher@example.com",
      firstName: "Dispatch",
      lastName: "User",
      forcePasswordChange: false,
      permissions: []
    };
    const existingTicket = {
      id: "ticket-1",
      ticketNumber: "AIT-100001"
    };
    const updatedTicket = {
      ...existingTicket,
      assignedUserId: "tech-1"
    };
    const prisma = {
      ticket: {
        findFirst: jest.fn().mockResolvedValue(existingTicket),
        update: jest.fn().mockResolvedValue(updatedTicket)
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: "tech-1" }, { id: "tech-2" }])
      },
      ticketAssignee: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({})
      },
      ticketWatcher: {
        upsert: jest.fn().mockResolvedValue({})
      }
    };
    const auditLogs = { create: jest.fn() };
    const sanitizer = { sanitize: jest.fn((value: string) => value) };
    const contactsService = { resolveRequesterFromEmail: jest.fn() };
    const routing = { applyInboundRules: jest.fn() };
    const mailDelivery = { sendTicketReply: jest.fn() };
    const notifications = { notifyUser: jest.fn(), notifyNewTicketCreated: jest.fn() };
    const autoReplies = { sendForNewInboundTicket: jest.fn() };
    const service = new TicketsService(
      prisma as never,
      auditLogs as never,
      sanitizer as never,
      contactsService as never,
      routing as never,
      mailDelivery as never,
      notifications as never,
      autoReplies as never
    );

    await expect(
      service.updateAssignment(
        "AIT-100001",
        {
          assignedUserIds: ["tech-1", "tech-2"]
        },
        user
      )
    ).resolves.toEqual(updatedTicket);

    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: "ticket-1" },
      data: expect.objectContaining({ assignedUserId: "tech-1" })
    });
    expect(prisma.ticketAssignee.create).toHaveBeenCalledTimes(2);
    expect(notifications.notifyUser).toHaveBeenCalledTimes(2);
    expect(notifications.notifyUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "tech-1",
        ticketId: "ticket-1",
        title: "Ticket assigned: AIT-100001",
        eventType: "ticketAssignedToMe"
      })
    );
    expect(notifications.notifyUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "tech-2",
        ticketId: "ticket-1",
        title: "Ticket assigned: AIT-100001",
        eventType: "ticketAssignedToMe"
      })
    );
  });

  it("only notifies specialists newly added to an existing assignment", async () => {
    const user = {
      id: "admin-1",
      organizationId: "org-1",
      email: "admin@example.com",
      firstName: "Admin",
      lastName: "User",
      forcePasswordChange: false,
      permissions: []
    };
    const existingTicket = { id: "ticket-1", ticketNumber: "AIT-100001" };
    const prisma = {
      ticket: {
        findFirst: jest.fn().mockResolvedValue(existingTicket),
        update: jest.fn().mockResolvedValue({ ...existingTicket, assignedUserId: "tech-1" })
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: "tech-1" }, { id: "tech-2" }])
      },
      ticketAssignee: {
        findMany: jest.fn().mockResolvedValue([{ userId: "tech-1" }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({})
      },
      ticketWatcher: {
        upsert: jest.fn().mockResolvedValue({})
      }
    };
    const notifications = { notifyUser: jest.fn(), notifyNewTicketCreated: jest.fn() };
    const service = new TicketsService(
      prisma as never,
      { create: jest.fn() } as never,
      { sanitize: jest.fn((value: string) => value) } as never,
      { resolveRequesterFromEmail: jest.fn() } as never,
      { applyInboundRules: jest.fn() } as never,
      { sendTicketReply: jest.fn() } as never,
      notifications as never,
      { sendForNewInboundTicket: jest.fn() } as never
    );

    await service.updateAssignment("AIT-100001", { assignedUserIds: ["tech-1", "tech-2"] }, user);

    expect(prisma.ticketAssignee.create).toHaveBeenCalledTimes(1);
    expect(prisma.ticketAssignee.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "tech-2" }) }));
    expect(notifications.notifyUser).toHaveBeenCalledTimes(1);
    expect(notifications.notifyUser).toHaveBeenCalledWith(expect.objectContaining({ userId: "tech-2" }));
  });

  it("requires the dedicated close permission for inline status changes", async () => {
    const service = new TicketsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    await expect(service.updateState("AIT-100001", { status: "CLOSED" }, {
      id: "user-1",
      organizationId: "org-1",
      email: "user@example.com",
      firstName: "Test",
      lastName: "User",
      forcePasswordChange: false,
      permissions: ["tickets.update"]
    })).rejects.toThrow("permission to change this ticket status");
  });

  it("creates a separate non-default ticket view without overwriting another view", async () => {
    const createdView = { id: "view-2", name: "Waiting for customer", isDefault: false };
    const tx = {
      userTicketView: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
        create: jest.fn().mockResolvedValue(createdView)
      }
    };
    const prisma = {
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) => callback(tx))
    };
    const service = new TicketsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    const user = {
      id: "user-1",
      organizationId: "org-1",
      email: "user@example.com",
      firstName: "Test",
      lastName: "User",
      forcePasswordChange: false,
      permissions: []
    };

    await expect(service.saveView({
      name: "Waiting for customer",
      state: { statuses: ["WAITING_ON_CUSTOMER"], pageSize: "20" },
      isDefault: false
    }, user)).resolves.toEqual(createdView);

    expect(tx.userTicketView.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        name: "Waiting for customer",
        isDefault: false
      })
    });
    expect(tx.userTicketView.updateMany).not.toHaveBeenCalled();
  });

  it("sorts ticket views by client name without passing an invalid scalar order to Prisma", async () => {
    const prisma = {
      ticket: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0)
      }
    };
    const service = new TicketsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    await expect(service.list({
      id: "user-1",
      organizationId: "org-1",
      email: "user@example.com",
      firstName: "Test",
      lastName: "User",
      forcePasswordChange: false,
      permissions: []
    }, {
      sortBy: "client",
      sortDirection: "asc",
      pageSize: "20"
    })).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: "20",
      totalPages: 1
    });

    expect(prisma.ticket.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [
        { client: { name: "asc" } },
        { ticketNumber: "asc" }
      ]
    }));
  });

  it("rejects duplicate ticket view names instead of silently overwriting the saved view", async () => {
    const tx = {
      userTicketView: {
        findUnique: jest.fn().mockResolvedValue({ id: "existing-view" }),
        updateMany: jest.fn(),
        create: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) => callback(tx))
    };
    const service = new TicketsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    await expect(service.saveView({
      name: "My queue",
      state: { statuses: ["NEW"] }
    }, {
      id: "user-1",
      organizationId: "org-1",
      email: "user@example.com",
      firstName: "Test",
      lastName: "User",
      forcePasswordChange: false,
      permissions: []
    })).rejects.toThrow("already exists");
    expect(tx.userTicketView.create).not.toHaveBeenCalled();
  });

  it("accepts custom status identifiers and makes a selected default view exclusive", async () => {
    const customStatusId = "8db34f63-c551-4fab-8f0a-e2ac2ad122ef";
    const createdView = { id: "view-3", name: "Equipment orders", isDefault: true };
    const tx = {
      userTicketView: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue(createdView)
      }
    };
    const prisma = {
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) => callback(tx))
    };
    const service = new TicketsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    await expect(service.saveView({
      name: "Equipment orders",
      state: {
        statuses: [customStatusId],
        columnWidths: { subject: 280 },
        trashMode: false
      },
      isDefault: true
    }, {
      id: "user-1",
      organizationId: "org-1",
      email: "user@example.com",
      firstName: "Test",
      lastName: "User",
      forcePasswordChange: false,
      permissions: []
    })).resolves.toEqual(createdView);

    expect(tx.userTicketView.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      data: { isDefault: false }
    });
  });

  it("rejects malformed custom status identifiers in saved ticket views", async () => {
    const prisma = { $transaction: jest.fn() };
    const service = new TicketsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );

    await expect(service.saveView({
      name: "Invalid status",
      state: { statuses: ["not-a-status"] }
    }, {
      id: "user-1",
      organizationId: "org-1",
      email: "user@example.com",
      firstName: "Test",
      lastName: "User",
      forcePasswordChange: false,
      permissions: []
    })).rejects.toThrow("invalid ticket status");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
