import { Injectable, InternalServerErrorException, NotImplementedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  GetMessageAttachmentsInput,
  GetInboundMessageInput,
  InboundMailMessage,
  MailAttachment,
  MailProvider,
  SendMessageInput,
  SendMessageResult,
  SyncInboundMessagesInput,
  SyncInboundMessagesResult
} from "./mail-provider.interface";

@Injectable()
export class MicrosoftGraphMailProvider implements MailProvider {
  constructor(private readonly config: ConfigService) {}

  async syncInboundMessages(input: SyncInboundMessagesInput): Promise<SyncInboundMessagesResult> {
    const token = await this.getAccessToken(input);
    const syncUrl =
      input.lastSyncCursor ??
      this.buildInitialSyncUrl(input.mailboxEmailAddress, input.initialSyncFrom ?? null);
    const response = await this.graphFetch<GraphDeltaResponse>(syncUrl, token);

    return {
      messages: response.value
        .filter((message) => Boolean(message.from?.emailAddress?.address))
        .map((message) => this.toInboundMessage(message, input)),
      nextSyncCursor: response["@odata.deltaLink"] ?? response["@odata.nextLink"] ?? null
    };
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    if (input.outboundMode === "NONE") {
      throw new NotImplementedException("Outbound sending is disabled for this mailbox.");
    }

    const token = await this.getAccessToken(input);
    const sendAsAddress = input.fromAddress || input.mailboxEmailAddress;
    const attachments = input.attachments ?? [];

    if (input.replyToProviderMessageId) {
      const mailboxUser = encodeURIComponent(input.mailboxEmailAddress);
      const messageId = encodeURIComponent(input.replyToProviderMessageId);
      let fallbackToSendMail = false;

      if (attachments.length > 0) {
        try {
          const draft = await this.graphPostJson<GraphDraftMessage>(
            `https://graph.microsoft.com/v1.0/users/${mailboxUser}/messages/${messageId}/createReply`,
            token,
            {
              message: {
                ccRecipients: input.cc?.map((address) => ({
                  emailAddress: { address }
                })),
                body: {
                  contentType: "HTML",
                  content: input.bodyHtml
                }
              }
            }
          );

          for (const attachment of attachments) {
            this.ensureSmallGraphAttachment(attachment.originalFilename, attachment.sizeBytes);
            await this.graphPostJson(
              `https://graph.microsoft.com/v1.0/users/${mailboxUser}/messages/${encodeURIComponent(draft.id)}/attachments`,
              token,
              this.toGraphFileAttachment(attachment)
            );
          }

          await this.graphFetchNoBody(`https://graph.microsoft.com/v1.0/users/${mailboxUser}/messages/${encodeURIComponent(draft.id)}/send`, token, null);

          return {
            providerMessageId: draft.id,
            internetMessageId: draft.internetMessageId ?? null,
            conversationId: draft.conversationId ?? input.inReplyTo ?? null
          };
        } catch (error) {
          if (!this.isGraphAccessDenied(error)) {
            throw error;
          }
          fallbackToSendMail = true;
        }
      }

      if (!fallbackToSendMail) {
        await this.graphFetchNoBody(`https://graph.microsoft.com/v1.0/users/${mailboxUser}/messages/${messageId}/reply`, token, {
          message: {
            ccRecipients: input.cc?.map((address) => ({
              emailAddress: { address }
            })),
            body: {
              contentType: "HTML",
              content: input.bodyHtml
            }
          }
        });

        const sentAt = Date.now();
        return {
          providerMessageId: `graph-reply-${sentAt}`,
          internetMessageId: null,
          conversationId: input.inReplyTo ?? null
        };
      }
    }

    const endpointUser = encodeURIComponent(sendAsAddress);
    const message = {
      subject: input.subject,
      body: {
        contentType: "HTML",
        content: input.bodyHtml
      },
      toRecipients: input.to.map((address) => ({
        emailAddress: { address }
      })),
      ccRecipients: input.cc?.map((address) => ({
        emailAddress: { address }
      })),
      attachments: attachments.length ? attachments.map((attachment) => this.toGraphFileAttachment(attachment)) : undefined,
      replyTo: input.replyToAddress
        ? [
            {
              emailAddress: { address: input.replyToAddress }
            }
          ]
        : undefined
    };

    await this.graphFetchNoBody(`https://graph.microsoft.com/v1.0/users/${endpointUser}/sendMail`, token, {
      message,
      saveToSentItems: true
    });

    const sentAt = Date.now();
    return {
      providerMessageId: `graph-send-${sentAt}`,
      internetMessageId: null,
      conversationId: input.inReplyTo ?? null
    };
  }

  async getMessageAttachments(input: GetMessageAttachmentsInput): Promise<MailAttachment[]> {
    const token = await this.getAccessToken(input);
    const mailboxUser = encodeURIComponent(input.mailboxEmailAddress);
    const messageId = encodeURIComponent(input.providerMessageId);
    let nextUrl: string | null = `https://graph.microsoft.com/v1.0/users/${mailboxUser}/messages/${messageId}/attachments`;
    const attachments: MailAttachment[] = [];

    while (nextUrl) {
      const response: GraphAttachmentsResponse = await this.graphFetch<GraphAttachmentsResponse>(nextUrl, token);
      nextUrl = response["@odata.nextLink"] ?? null;

      for (const attachment of response.value) {
        if (!this.isFileAttachment(attachment)) {
          continue;
        }

        const fileAttachment = attachment.contentBytes
          ? attachment
          : await this.graphFetch<GraphAttachment>(
              `https://graph.microsoft.com/v1.0/users/${mailboxUser}/messages/${messageId}/attachments/${encodeURIComponent(attachment.id)}`,
              token
            );

        if (!this.isFileAttachment(fileAttachment) || !fileAttachment.contentBytes) {
          continue;
        }

        const buffer = Buffer.from(fileAttachment.contentBytes, "base64");
        attachments.push({
          id: fileAttachment.id,
          originalFilename: fileAttachment.name || `attachment-${fileAttachment.id}`,
          mimeType: this.resolveAttachmentMimeType(fileAttachment),
          sizeBytes: buffer.length || fileAttachment.size || 0,
          contentId: this.cleanContentId(fileAttachment.contentId),
          isInline: Boolean(fileAttachment.isInline || fileAttachment.contentId),
          contentBytes: buffer
        });
      }
    }

    return attachments;
  }

  async getInboundMessage(input: GetInboundMessageInput): Promise<InboundMailMessage | null> {
    const token = await this.getAccessToken(input);
    const user = encodeURIComponent(input.mailboxEmailAddress);
    const messageId = encodeURIComponent(input.providerMessageId);
    const select = encodeURIComponent(this.inboundMessageSelect());
    try {
      const message = await this.graphFetch<GraphMessage>(
        `https://graph.microsoft.com/v1.0/users/${user}/messages/${messageId}?$select=${select}`,
        token
      );
      return message.from?.emailAddress?.address ? this.toInboundMessage(message, input) : null;
    } catch (error) {
      if (error instanceof Error && /404|not found/i.test(error.message)) return null;
      throw error;
    }
  }

  private buildInitialSyncUrl(mailboxEmailAddress: string, initialSyncFrom: Date | null) {
    const user = encodeURIComponent(mailboxEmailAddress);
    const select = encodeURIComponent(this.inboundMessageSelect());
    const base = `https://graph.microsoft.com/v1.0/users/${user}/mailFolders/inbox/messages/delta?$select=${select}`;

    if (!initialSyncFrom) {
      return base;
    }

    return `${base}&$filter=${encodeURIComponent(`receivedDateTime ge ${initialSyncFrom.toISOString()}`)}`;
  }

  private async getAccessToken(input: Pick<SyncInboundMessagesInput, "tenantId" | "microsoftClientId" | "encryptedClientSecretReference">) {
    const tenantId = input.tenantId || this.config.get<string>("MICROSOFT_TENANT_ID");
    const clientId = input.microsoftClientId || this.config.get<string>("MICROSOFT_CLIENT_ID");
    const clientSecret = this.resolveSecret(input.encryptedClientSecretReference) || this.config.get<string>("MICROSOFT_CLIENT_SECRET");

    if (!tenantId || !clientId || !clientSecret) {
      throw new InternalServerErrorException("Microsoft Graph credentials are not configured.");
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials"
    });
    const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    if (!response.ok) {
      throw new InternalServerErrorException("Unable to authenticate with Microsoft Graph.");
    }

    const token = (await response.json()) as { access_token?: string };
    if (!token.access_token) {
      throw new InternalServerErrorException("Microsoft Graph token response did not include an access token.");
    }

    return token.access_token;
  }

  private inboundMessageSelect() {
    return "id,subject,body,bodyPreview,from,toRecipients,ccRecipients,replyTo,receivedDateTime,internetMessageId,conversationId,hasAttachments,internetMessageHeaders";
  }

  private toInboundMessage(
    message: GraphMessage,
    input: Pick<SyncInboundMessagesInput, "connectionMode" | "preserveOriginalSenderHeaders">
  ): InboundMailMessage {
    const rawFrom = this.toInboundAddress(message.from.emailAddress);
    const headers = this.toHeaderMap(message.internetMessageHeaders ?? []);
    const forwardedFrom = input.connectionMode === "GRAPH_FORWARDED_MAILBOX" && input.preserveOriginalSenderHeaders !== false
      ? this.resolveForwardedSender(headers, rawFrom, message.bodyPreview ?? null, message.body?.content ?? null)
      : rawFrom;
    const graphCc = message.ccRecipients?.map((recipient) => this.toInboundAddress(recipient.emailAddress)) ?? [];
    const headerCc = this.extractMailAddresses([
      headers.cc,
      headers["resent-cc"],
      headers["x-original-cc"],
      headers["x-forwarded-cc"],
      headers["x-ms-exchange-organization-originalcc"]
    ]);
    const forwardedCc = input.connectionMode === "GRAPH_FORWARDED_MAILBOX" && input.preserveOriginalSenderHeaders !== false
      ? this.extractMailAddresses([
          this.extractForwardedHeader(message.bodyPreview ?? null, "cc"),
          this.extractForwardedHeader(message.body?.content ?? null, "cc")
        ])
      : [];
    const cc = this.mergeInboundAddresses(graphCc, headerCc, forwardedCc);
    return {
      providerMessageId: message.id,
      internetMessageId: message.internetMessageId ?? null,
      conversationId: message.conversationId ?? null,
      from: forwardedFrom,
      rawFrom,
      replyTo: message.replyTo?.map((recipient) => this.toInboundAddress(recipient.emailAddress)) ?? null,
      to: message.toRecipients?.map((recipient) => this.toInboundAddress(recipient.emailAddress)) ?? null,
      cc: cc.length ? cc : null,
      subject: message.subject || "(No subject)",
      bodyText: message.bodyPreview ?? null,
      bodyHtml: message.body?.contentType?.toLowerCase() === "html" ? message.body.content : null,
      inReplyTo: headers["in-reply-to"] ?? null,
      references: headers.references ?? null,
      hasAttachments: message.hasAttachments ?? false,
      internetMessageHeaders: headers
    };
  }

  private resolveSecret(reference: string | null | undefined) {
    if (!reference) {
      return null;
    }

    if (reference.startsWith("env:")) {
      return this.config.get<string>(reference.slice(4)) ?? null;
    }

    return null;
  }

  private async graphFetch<T>(url: string, token: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.body-content-type="html"'
      }
    });

    if (!response.ok) {
      const details = await response.text();
      throw new InternalServerErrorException(
        `Microsoft Graph request failed with status ${response.status}${details ? `: ${details.slice(0, 500)}` : "."}`
      );
    }

    return response.json() as Promise<T>;
  }

  private async graphFetchNoBody(url: string, token: string, body: unknown): Promise<void> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: body === null ? undefined : JSON.stringify(body)
    });

    if (!response.ok) {
      const details = await response.text();
      throw new InternalServerErrorException(
        `Microsoft Graph request failed with status ${response.status}${details ? `: ${details.slice(0, 500)}` : "."}`
      );
    }
  }

  private isGraphAccessDenied(error: unknown) {
    return error instanceof InternalServerErrorException && error.message.includes("ErrorAccessDenied");
  }

  private async graphPostJson<T = unknown>(url: string, token: string, body: unknown): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const details = await response.text();
      throw new InternalServerErrorException(
        `Microsoft Graph request failed with status ${response.status}${details ? `: ${details.slice(0, 500)}` : "."}`
      );
    }

    return response.json() as Promise<T>;
  }

  private toGraphFileAttachment(attachment: {
    originalFilename: string;
    mimeType: string;
    contentBytes: Buffer;
    isInline?: boolean;
    contentId?: string | null;
  }) {
    return {
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: attachment.originalFilename,
      contentType: attachment.mimeType,
      contentBytes: attachment.contentBytes.toString("base64"),
      isInline: attachment.isInline ?? false,
      contentId: attachment.contentId ?? undefined
    };
  }

  private ensureSmallGraphAttachment(filename: string, sizeBytes: number) {
    if (sizeBytes > 3 * 1024 * 1024) {
      throw new InternalServerErrorException(
        `Microsoft Graph draft replies currently support direct attachments up to 3 MB. "${filename}" is larger.`
      );
    }
  }

  private isFileAttachment(attachment: GraphAttachment) {
    return attachment["@odata.type"]?.toLowerCase().includes("fileattachment") ?? Boolean(attachment.contentBytes || attachment.name);
  }

  private cleanContentId(value: string | null | undefined) {
    return value?.trim().replace(/^<|>$/g, "") || null;
  }

  private resolveAttachmentMimeType(attachment: GraphAttachment) {
    if (attachment.contentType) {
      return attachment.contentType.toLowerCase();
    }

    const extension = attachment.name?.split(".").pop()?.toLowerCase();
    switch (extension) {
      case "png":
        return "image/png";
      case "jpg":
      case "jpeg":
        return "image/jpeg";
      case "gif":
        return "image/gif";
      case "webp":
        return "image/webp";
      case "pdf":
        return "application/pdf";
      case "zip":
        return "application/zip";
      case "doc":
        return "application/msword";
      case "docx":
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      case "xls":
        return "application/vnd.ms-excel";
      case "xlsx":
        return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      case "ppt":
        return "application/vnd.ms-powerpoint";
      case "pptx":
        return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
      case "csv":
        return "text/csv";
      case "txt":
        return "text/plain";
      default:
        return "application/octet-stream";
    }
  }

  private toInboundAddress(emailAddress: GraphEmailAddress) {
    return {
      email: emailAddress.address.toLowerCase(),
      name: emailAddress.name ?? null
    };
  }

  private toHeaderMap(headers: GraphInternetMessageHeader[]) {
    return Object.fromEntries(headers.map((header) => [header.name.toLowerCase(), header.value]));
  }

  private resolveForwardedSender(
    headers: Record<string, string>,
    fallback: { email: string; name?: string | null },
    bodyPreview: string | null,
    bodyHtml: string | null
  ) {
    const headerCandidates = [
      headers["x-original-sender"],
      headers["x-forwarded-for"],
      headers["x-ms-exchange-organization-originalsender"],
      headers["return-path"],
      headers["reply-to"]
    ];
    const bodyCandidates = [bodyPreview, bodyHtml].flatMap((body) => (body ? this.extractForwardedAddresses(body) : []));
    const candidate = [...headerCandidates, ...bodyCandidates].map((value) => this.extractEmail(value)).find(Boolean);

    return candidate ? { email: candidate, name: null } : fallback;
  }

  private extractForwardedAddresses(value: string) {
    const normalized = value.replace(/<[^>]*>/g, " ").replace(/&lt;|&gt;/g, " ");
    const fromLine = normalized.match(/(?:from|de):\s*([^\n\r]+)/i)?.[1];
    return fromLine ? [fromLine] : [];
  }

  private extractForwardedHeader(value: string | null, headerName: string) {
    if (!value) return null;
    const normalized = value
      .slice(0, 64_000)
      .replace(/<br\s*\/?>|<\/(?:div|p|tr|li)>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
    const escapedHeaderName = headerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return normalized.match(new RegExp(`(?:^|\\n)\\s*${escapedHeaderName}\\s*:\\s*([^\\n\\r]+)`, "i"))?.[1] ?? null;
  }

  private extractMailAddresses(values: Array<string | null | undefined>) {
    const addresses: Array<{ email: string; name: null }> = [];
    const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
    for (const value of values) {
      if (!value) continue;
      for (const match of value.slice(0, 32_000).matchAll(emailPattern)) {
        addresses.push({ email: match[0].toLowerCase(), name: null });
        if (addresses.length >= 100) return addresses;
      }
    }
    return addresses;
  }

  private mergeInboundAddresses(...groups: Array<Array<{ email: string; name?: string | null }>>) {
    const merged = new Map<string, { email: string; name: string | null }>();
    for (const address of groups.flat()) {
      const email = address.email.trim().toLowerCase();
      if (!email) continue;
      const current = merged.get(email);
      merged.set(email, { email, name: current?.name || address.name?.trim() || null });
    }
    return [...merged.values()].sort((left, right) => left.email.localeCompare(right.email));
  }

  private extractEmail(value: string | null | undefined) {
    if (!value) {
      return null;
    }

    const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match?.[0]?.toLowerCase() ?? null;
  }
}

interface GraphDeltaResponse {
  value: GraphMessage[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

interface GraphMessage {
  id: string;
  subject?: string | null;
  bodyPreview?: string | null;
  internetMessageId?: string | null;
  conversationId?: string | null;
  hasAttachments?: boolean;
  from: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  replyTo?: GraphRecipient[];
  internetMessageHeaders?: GraphInternetMessageHeader[];
  body?: {
    contentType?: string | null;
    content?: string | null;
  } | null;
}

interface GraphRecipient {
  emailAddress: GraphEmailAddress;
}

interface GraphEmailAddress {
  address: string;
  name?: string | null;
}

interface GraphInternetMessageHeader {
  name: string;
  value: string;
}

interface GraphDraftMessage {
  id: string;
  internetMessageId?: string | null;
  conversationId?: string | null;
}

interface GraphAttachmentsResponse {
  "@odata.nextLink"?: string;
  value: GraphAttachment[];
}

interface GraphAttachment {
  "@odata.type"?: string;
  id: string;
  name?: string | null;
  contentType?: string | null;
  size?: number | null;
  isInline?: boolean | null;
  contentId?: string | null;
  contentBytes?: string | null;
}
