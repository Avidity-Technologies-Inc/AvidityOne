# Microsoft 365 Integration

The first milestone creates the integration shape without requiring real Graph credentials.

Mailbox configuration stores:

- Name
- Email address to read
- Public support email address
- Optional ingestion mailbox address for forwarded-mailbox workflows
- Provider
- Connection mode: direct Graph mailbox, forwarded Graph mailbox, or mock
- Outbound mode: Graph send-as, Graph send-on-behalf, SMTP relay placeholder, or inbound only
- Tenant ID
- Microsoft client ID
- Encrypted client secret reference
- Active state
- Last sync cursor
- Initial sync date

Provider interface:

```ts
interface MailProvider {
  syncInboundMessages(input: SyncInboundMessagesInput): Promise<SyncInboundMessagesResult>;
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
  getMessageAttachments(input: GetMessageAttachmentsInput): Promise<MailAttachment[]>;
}
```

`MockMailProvider` supports local development. The mailbox sync service imports provider messages, skips duplicate provider Message-IDs, resolves the sender domain to a client, creates the requester contact when needed, and opens the first inbound ticket message.

Use `MAIL_PROVIDER=mock` for local development. The mock sender can be adjusted with:

```env
MOCK_INBOUND_EMAIL_ENABLED=true
MOCK_INBOUND_SENDER_EMAIL=requester@example.org
MOCK_INBOUND_SENDER_NAME="Mock Requester"
```

`MicrosoftGraphMailProvider` supports the initial inbound delta-sync path and outbound `sendMail` path once the Microsoft Entra app credentials are configured.

For a direct support mailbox, read from and send as the same mailbox:

```txt
Connection mode: Graph direct mailbox
Mailbox to read: support@aviditytechnologies.com
Public support address: support@aviditytechnologies.com
Outbound mode: Send as public address
```

For an Atera-style forwarded mailbox, Microsoft 365 forwards incoming support mail to a mailbox owned by the ticket system:

```txt
Connection mode: Graph forwarded mailbox
Mailbox to read: tickets-ingest@yourdomain.example
Public support address: support@aviditytechnologies.com
Forwarded ingestion mailbox: tickets-ingest@yourdomain.example
Outbound mode: Send as public address
Outbound from address: support@aviditytechnologies.com
Reply-To address: support@aviditytechnologies.com
```

Use the initial sync date in Settings before the first real sync so historical resolved email is not imported. Changing this date clears the stored sync cursor so the next sync starts from that date.

Microsoft Graph application permissions expected for production mail are `Mail.Read`, `Mail.Send`, and admin consent for the relevant tenant. The mailbox used for outbound sending must have Send As or Send on Behalf permission for the configured public support address.

Ticket meetings and Event Services calendar synchronization additionally require the Microsoft Graph application permission `Calendars.ReadWrite` with administrator consent. Limit application calendar access to approved organizer mailboxes through Exchange Online App RBAC. Calendar credentials remain stored as environment-variable references, and calendar invitations, updates, and cancellations require an explicit user action.
