import { ConfigService } from "@nestjs/config";
import { MicrosoftGraphMailProvider } from "./microsoft-graph-mail.provider";

describe("MicrosoftGraphMailProvider", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as never;
  });

  const operationalInput = {
    mailboxId: "mailbox", mailboxEmailAddress: "support@example.test", fromAddress: "support@example.test",
    replyToAddress: "support@example.test", tenantId: "synthetic-tenant", microsoftClientId: "synthetic-client",
    encryptedClientSecretReference: "env:MICROSOFT_CLIENT_SECRET", to: ["specialist@example.test"],
    bodyText: "Only staff copy", bodyHtml: '<p>Only staff copy</p><img src="cid:photo">',
    subject: "Ticket [AO:synthetic-reference]", trackDelivery: true, replyToProviderMessageId: "old-receipt",
    cc: ["must-not-inherit@example.test"],
    attachments: [{ originalFilename: "photo.png", mimeType: "image/png", sizeBytes: 5,
      contentBytes: Buffer.from("photo"), isInline: true, contentId: "photo" }]
  };
  const operationalProvider = () => new MicrosoftGraphMailProvider(new ConfigService({ MICROSOFT_CLIENT_SECRET: "synthetic-secret" }));
  const authenticate = () => fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "synthetic-token" }) });

  it("sends full operational content and inline files with Mail.Send, without drafts or inherited recipients", async () => {
    authenticate().mockResolvedValueOnce({ ok: true, status: 202 });
    const result = await operationalProvider().sendMessage(operationalInput);
    expect(result).toMatchObject({ providerMessageId: expect.stringMatching(/^graph-send-/), internetMessageId: null, conversationId: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, request] = fetchMock.mock.calls[1];
    expect(url).toBe("https://graph.microsoft.com/v1.0/users/support%40example.test/sendMail");
    expect(request.method).toBe("POST");
    expect(JSON.parse(request.body)).toMatchObject({ saveToSentItems: true, message: {
      subject: operationalInput.subject, body: { contentType: "HTML", content: operationalInput.bodyHtml },
      toRecipients: [{ emailAddress: { address: "specialist@example.test" } }], ccRecipients: [], bccRecipients: [],
      replyTo: [{ emailAddress: { address: "support@example.test" } }],
      attachments: [{ name: "photo.png", contentId: "photo", isInline: true, contentBytes: Buffer.from("photo").toString("base64") }]
    } });
  });

  it.each([400, 401, 403, 404, 413])("classifies HTTP %s as a confirmed rejection, without retrying or leaking response bodies", async (status) => {
    authenticate().mockResolvedValueOnce({ ok: false, status, json: async () => ({ secret: "never expose" }) });
    await expect(operationalProvider().sendMessage(operationalInput)).rejects.toMatchObject({ outcome: "NOT_SENT", retryable: false, message: expect.stringContaining(`HTTP ${status}`) });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honors Microsoft throttling without a second send inside the provider", async () => {
    authenticate().mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ "Retry-After": "120" }) });
    await expect(operationalProvider().sendMessage(operationalInput)).rejects.toMatchObject({ outcome: "NOT_SENT", retryable: true, retryAfterMs: 120000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([408, 500, 502, 503, 504])("keeps HTTP %s uncertain and never falls back to another send", async (status) => {
    authenticate().mockResolvedValueOnce({ ok: false, status });
    await expect(operationalProvider().sendMessage(operationalInput)).rejects.toMatchObject({ outcome: "UNKNOWN", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("distinguishes failure to authenticate from a connection loss after submitting mail", async () => {
    fetchMock.mockRejectedValueOnce(new Error("private credential details"));
    await expect(operationalProvider().sendMessage(operationalInput)).rejects.toMatchObject({ outcome: "NOT_SENT", retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockReset();
    authenticate().mockRejectedValueOnce(new Error("private request data"));
    await expect(operationalProvider().sendMessage(operationalInput)).rejects.toMatchObject({ outcome: "UNKNOWN", retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  const customerInput = { ...operationalInput, trackDelivery: false, replyToProviderMessageId: "inbound-message",
    inReplyTo: "<parent@example.test>", references: "<original@example.test>", subject: "Re: [AIT-100001] Diseño" };
  const mimeRequest = () => Buffer.from(fetchMock.mock.calls[1][1].body, "base64").toString();

  it("replies with MIME attachments using Mail.Send and retains the submitted message identity", async () => {
    authenticate().mockResolvedValueOnce({ status: 202 }).mockImplementationOnce(async (url: string) => {
      const filter = new URL(url).searchParams.get("$filter")!;
      return { ok: true, json: async () => ({ value: [{ id: "real-sent-id", internetMessageId: filter.split("'")[1], conversationId: "real-thread" }] }) };
    });
    const result = await operationalProvider().sendMessage(customerInput);
    expect(result).toMatchObject({ providerMessageId: "real-sent-id", conversationId: "real-thread" });
    expect(fetchMock.mock.calls[1][0]).toContain("/messages/inbound-message/reply");
    expect(fetchMock.mock.calls[1][1].headers["Content-Type"]).toBe("text/plain");
    expect(mimeRequest()).toContain(`Message-ID: ${result.internetMessageId}`);
    expect(mimeRequest()).toContain("In-Reply-To: <parent@example.test>");
    expect(mimeRequest()).toContain("References: <original@example.test>\r\n <parent@example.test>");
    expect(mimeRequest()).toContain("Cc: <must-not-inherit@example.test>");
    expect(mimeRequest()).toContain("Content-ID: <photo>");
    expect(mimeRequest()).toContain(Buffer.from(customerInput.bodyHtml).toString("base64"));
    expect(mimeRequest()).toContain(Buffer.from("photo").toString("base64"));
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("createReply"))).toBe(true);
  });

  it("does not resend or lose acceptance when Sent Items has not indexed the message", async () => {
    authenticate().mockResolvedValueOnce({ status: 202 }).mockRejectedValueOnce(new Error("lookup unavailable"));
    const result = await operationalProvider().sendMessage(customerInput);
    expect(result.internetMessageId).toMatch(/^<[^>]+@example.test>$/);
    expect(result.conversationId).toBeNull();
    expect(fetchMock.mock.calls.filter(([, request]) => request.method === "POST")).toHaveLength(2); // token + send
  });

  it.each([403, 404, 500])("never falls back to unrelated sendMail after reply HTTP %s", async (status) => {
    authenticate().mockResolvedValueOnce({ status });
    await expect(operationalProvider().sendMessage(customerInput)).rejects.toMatchObject({ outcome: status === 500 ? "UNKNOWN" : "NOT_SENT" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("/reply");
  });

  it("uses explicit public recipients and RFC references for forwarded ingestion mailboxes", async () => {
    authenticate().mockResolvedValueOnce({ status: 202 }).mockResolvedValueOnce({ ok: true, json: async () => ({ value: [] }) });
    await operationalProvider().sendMessage({ ...customerInput, mailboxEmailAddress: "ingestion@example.test" });
    expect(fetchMock.mock.calls[1][0]).toBe("https://graph.microsoft.com/v1.0/users/support%40example.test/sendMail");
    expect(mimeRequest()).toContain("From: <support@example.test>");
    expect(mimeRequest()).toContain("To: <specialist@example.test>");
    expect(mimeRequest()).toContain("In-Reply-To: <parent@example.test>");
    expect(mimeRequest()).not.toContain("ingestion@example.test");
  });

  it("also preserves threading for replies without files and new manual-ticket email", async () => {
    authenticate().mockResolvedValueOnce({ status: 202 }).mockResolvedValueOnce({ ok: true, json: async () => ({ value: [] }) });
    await operationalProvider().sendMessage({ ...customerInput, attachments: [], replyToProviderMessageId: null });
    expect(fetchMock.mock.calls[1][0]).toContain("/sendMail");
    expect(mimeRequest()).toContain("In-Reply-To: <parent@example.test>");
    expect(mimeRequest()).toContain("multipart/alternative");
  });

  it("rejects injected recipients before any Microsoft request", async () => {
    await expect(operationalProvider().sendMessage({ ...customerInput, to: ["client@example.test\r\nBcc: other@example.test"] })).rejects.toMatchObject({ outcome: "NOT_SENT" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("projects full HTML/plain-text bodies instead of the truncated preview", async () => {
    const provider = new MicrosoftGraphMailProvider(new ConfigService());
    const project = (provider as unknown as { toInboundMessage: (message: unknown, input: unknown) => { bodyText: string } }).toInboundMessage.bind(provider);
    const body = "Complete content ".repeat(300);
    expect(project({ id: "message", from: { emailAddress: { address: "sender@example.test" } }, bodyPreview: "Truncated", body: { contentType: "text", content: body } }, {}).bodyText).toBe(body);
    expect(project({ id: "message", from: { emailAddress: { address: "sender@example.test" } }, bodyPreview: "Truncated", body: { contentType: "html", content: `<p>${body}</p>` } }, {}).bodyText).toBe(body.trim());
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
