export interface SyncInboundMessagesInput {
  mailboxId: string;
  mailboxEmailAddress: string;
  publicEmailAddress?: string | null;
  connectionMode?: string | null;
  preserveOriginalSenderHeaders?: boolean;
  lastSyncCursor?: string | null;
  initialSyncFrom?: Date | null;
  tenantId?: string | null;
  microsoftClientId?: string | null;
  encryptedClientSecretReference?: string | null;
}

export interface InboundMailAddress {
  email: string;
  name?: string | null;
}

export interface InboundMailMessage {
  providerMessageId: string;
  internetMessageId?: string | null;
  conversationId?: string | null;
  from: InboundMailAddress;
  rawFrom?: InboundMailAddress | null;
  replyTo?: InboundMailAddress[] | null;
  to?: InboundMailAddress[] | null;
  cc?: InboundMailAddress[] | null;
  subject: string;
  bodyText?: string | null;
  bodyHtml?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  hasAttachments?: boolean;
  internetMessageHeaders?: Record<string, string>;
}

export interface SyncInboundMessagesResult {
  messages: InboundMailMessage[];
  nextSyncCursor?: string | null;
}

export interface SendMessageInput {
  trackDelivery?: boolean;
  mailboxId: string;
  mailboxEmailAddress: string;
  fromAddress?: string | null;
  replyToAddress?: string | null;
  outboundMode?: string | null;
  tenantId?: string | null;
  microsoftClientId?: string | null;
  encryptedClientSecretReference?: string | null;
  to: string[];
  cc?: string[];
  subject: string;
  bodyHtml: string;
  bodyText: string;
  inReplyTo?: string | null;
  references?: string | null;
  replyToProviderMessageId?: string | null;
  attachmentIds?: string[];
  attachments?: OutboundMailAttachment[];
}

export interface SendMessageResult {
  providerMessageId: string;
  internetMessageId?: string | null;
  conversationId?: string | null;
}

export interface GetMessageAttachmentsInput {
  mailboxId: string;
  mailboxEmailAddress: string;
  providerMessageId: string;
  tenantId?: string | null;
  microsoftClientId?: string | null;
  encryptedClientSecretReference?: string | null;
}

export interface GetInboundMessageInput extends GetMessageAttachmentsInput {
  publicEmailAddress?: string | null;
  connectionMode?: string | null;
  preserveOriginalSenderHeaders?: boolean;
}

export interface MailAttachment {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  contentId?: string | null;
  isInline: boolean;
  contentBytes?: Buffer;
}

export interface OutboundMailAttachment {
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  contentBytes: Buffer;
  isInline?: boolean;
  contentId?: string | null;
}

export interface MailProvider {
  syncInboundMessages(input: SyncInboundMessagesInput): Promise<SyncInboundMessagesResult>;
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
  getMessageAttachments(input: GetMessageAttachmentsInput): Promise<MailAttachment[]>;
  getInboundMessage?(input: GetInboundMessageInput): Promise<InboundMailMessage | null>;
}
