import { MicrosoftGraphMailProvider } from "./microsoft-graph-mail.provider";

describe("MicrosoftGraphMailProvider", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as never;
  });

  it("loads paginated file attachments and fetches missing content bytes", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token-1" })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/next-attachments-page",
          value: [
            {
              "@odata.type": "#microsoft.graph.fileAttachment",
              id: "attachment-1",
              name: "first.pdf",
              contentType: "application/pdf",
              contentBytes: Buffer.from("first").toString("base64")
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: [
            {
              "@odata.type": "#microsoft.graph.fileAttachment",
              id: "attachment-2",
              name: "second.docx",
              contentType: null
            }
          ]
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          id: "attachment-2",
          name: "second.docx",
          contentType: null,
          contentBytes: Buffer.from("second").toString("base64")
        })
      });

    const provider = new MicrosoftGraphMailProvider({
      get: jest.fn((key: string) => (key === "MICROSOFT_CLIENT_SECRET" ? "secret-1" : undefined))
    } as never);
    const attachments = await provider.getMessageAttachments({
      mailboxId: "mailbox-1",
      mailboxEmailAddress: "support@example.com",
      providerMessageId: "message-1",
      tenantId: "tenant-1",
      microsoftClientId: "client-1",
      encryptedClientSecretReference: "env:MICROSOFT_CLIENT_SECRET"
    });

    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toEqual(expect.objectContaining({ id: "attachment-1", originalFilename: "first.pdf", mimeType: "application/pdf" }));
    expect(attachments[1]).toEqual(
      expect.objectContaining({
        id: "attachment-2",
        originalFilename: "second.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      })
    );
    expect(fetchMock).toHaveBeenCalledWith("https://graph.microsoft.com/v1.0/next-attachments-page", expect.any(Object));
  });

  it("reloads a quarantined message by its Graph message id", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "token-1" }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "message-1",
          subject: "Need assistance",
          bodyPreview: "Please help.",
          body: { contentType: "html", content: "<p>Please help.</p>" },
          from: { emailAddress: { address: "person@example.com", name: "Person" } },
          toRecipients: [],
          ccRecipients: [{ emailAddress: { address: "manager@example.com", name: "Manager" } }],
          replyTo: [],
          internetMessageId: "<message@example.com>",
          conversationId: "conversation-1",
          hasAttachments: false,
          internetMessageHeaders: [{ name: "In-Reply-To", value: "<previous@example.com>" }]
        })
      });
    const provider = new MicrosoftGraphMailProvider({
      get: jest.fn((key: string) => (key === "MICROSOFT_CLIENT_SECRET" ? "secret-1" : undefined))
    } as never);

    const message = await provider.getInboundMessage({
      mailboxId: "mailbox-1",
      mailboxEmailAddress: "support@example.com",
      providerMessageId: "message-1",
      tenantId: "tenant-1",
      microsoftClientId: "client-1",
      encryptedClientSecretReference: "env:MICROSOFT_CLIENT_SECRET"
    });

    expect(message).toEqual(expect.objectContaining({
      providerMessageId: "message-1",
      from: { email: "person@example.com", name: "Person" },
      bodyText: "Please help.",
      bodyHtml: "<p>Please help.</p>",
      cc: [{ email: "manager@example.com", name: "Manager" }],
      inReplyTo: "<previous@example.com>"
    }));
    expect(fetchMock.mock.calls[1][0]).toContain("/users/support%40example.com/messages/message-1");
    expect(fetchMock.mock.calls[1][0]).toContain("ccRecipients");
  });

  it("recovers CC recipients from internet headers when a legacy delta projection omits ccRecipients", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "token-1" }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "message-legacy",
          subject: "Legacy projection",
          bodyPreview: "Please review.",
          from: { emailAddress: { address: "requester@example.com", name: "Requester" } },
          toRecipients: [{ emailAddress: { address: "support@example.com", name: "Support" } }],
          internetMessageHeaders: [
            { name: "Cc", value: "Manager One <manager@example.com>; reviewer@example.org" }
          ]
        })
      });
    const provider = new MicrosoftGraphMailProvider({
      get: jest.fn((key: string) => (key === "MICROSOFT_CLIENT_SECRET" ? "secret-1" : undefined))
    } as never);

    const message = await provider.getInboundMessage({
      mailboxId: "mailbox-1",
      mailboxEmailAddress: "support@example.com",
      providerMessageId: "message-legacy",
      connectionMode: "GRAPH_DIRECT",
      tenantId: "tenant-1",
      microsoftClientId: "client-1",
      encryptedClientSecretReference: "env:MICROSOFT_CLIENT_SECRET"
    });

    expect(message?.cc).toEqual([
      { email: "manager@example.com", name: null },
      { email: "reviewer@example.org", name: null }
    ]);
  });

  it("recovers the original CC line from a forwarded message body", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "token-1" }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "message-forwarded",
          subject: "Fwd: Website update",
          bodyPreview: "From: Requester <requester@example.com>\nTo: Support <support@example.com>\nCc: Manager <manager@example.com>; reviewer@example.org\nSubject: Website update",
          body: {
            contentType: "html",
            content: "<div>From: Requester &lt;requester@example.com&gt;</div><div>To: Support &lt;support@example.com&gt;</div><div>Cc: Manager &lt;manager@example.com&gt;; reviewer@example.org</div>"
          },
          from: { emailAddress: { address: "forwarder@aviditytechnologies.com", name: "Forwarder" } },
          toRecipients: [{ emailAddress: { address: "ingestion@aviditytechnologies.com", name: "Ingestion" } }],
          ccRecipients: []
        })
      });
    const provider = new MicrosoftGraphMailProvider({
      get: jest.fn((key: string) => (key === "MICROSOFT_CLIENT_SECRET" ? "secret-1" : undefined))
    } as never);

    const message = await provider.getInboundMessage({
      mailboxId: "mailbox-1",
      mailboxEmailAddress: "ingestion@aviditytechnologies.com",
      providerMessageId: "message-forwarded",
      connectionMode: "GRAPH_FORWARDED_MAILBOX",
      preserveOriginalSenderHeaders: true,
      tenantId: "tenant-1",
      microsoftClientId: "client-1",
      encryptedClientSecretReference: "env:MICROSOFT_CLIENT_SECRET"
    });

    expect(message?.from.email).toBe("requester@example.com");
    expect(message?.cc).toEqual([
      { email: "manager@example.com", name: null },
      { email: "reviewer@example.org", name: null }
    ]);
  });
});
