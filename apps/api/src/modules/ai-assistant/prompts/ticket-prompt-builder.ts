const SECRET_PATTERNS = [
  /password\s*[:=]\s*\S+/gi,
  /api[_-]?key\s*[:=]\s*\S+/gi,
  /token\s*[:=]\s*\S+/gi,
  /secret\s*[:=]\s*\S+/gi
];

const QUOTED_THREAD_MARKERS = [
  /^-{2,}\s*original message\s*-{2,}$/i,
  /^on .+ wrote:$/i,
  /^\s*>/,
  /^_{5,}$/
];

const NOISE_PATTERNS = [
  /^external:\s*this email originated from outside/i,
  /^e-?mail confidentiality notice:/i,
  /^confidentiality notice:/i,
  /^this (email|message)( and any attachments)? (is|may be) confidential/i
];

const SIGNATURE_MARKERS = [
  /^(best|kind|warm) regards,?$/i,
  /^regards,?$/i,
  /^sincerely,?$/i,
  /^respectfully,?$/i,
  /^(many )?thanks,?$/i,
  /^thank you,?$/i,
  /^cheers,?$/i,
  /^--\s*$/,
  /^sent from my (iphone|ipad|android|mobile device)/i,
  /^get outlook for (ios|android)/i
];

const EDIT_ONLY_ACTIONS = new Set(["fix_grammar", "paraphrase", "translate", "change_tone"]);

interface PromptMessage {
  bodyText: string;
  visibility: string;
  direction?: string;
  createdAt?: Date;
}

export class TicketPromptBuilder {
  buildContext(input: { subject: string; messages: PromptMessage[] }) {
    return this.buildTicketActionContext({ ...input, action: "suggest_reply" });
  }

  buildTicketActionContext(input: { action: string; subject: string; messages: PromptMessage[] }) {
    if (EDIT_ONLY_ACTIONS.has(input.action)) {
      return "Reference conversation intentionally omitted for this draft-only editing action.";
    }

    const publicMessages = input.messages.filter((message) => message.visibility === "PUBLIC");
    const messageLimit = input.action === "complete_draft" ? 2 : input.action === "improve_reply" ? 4 : 8;
    const selectedMessages = input.action === "complete_draft"
      ? this.latestUsefulMessages(publicMessages, messageLimit)
      : publicMessages.slice(-messageLimit);
    const visibleMessages = selectedMessages
      .map((message) => this.formatMessage(message))
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 24_000);

    return this.removeSecrets(
      [
        `Subject: ${input.subject}`,
        "REFERENCE CONTEXT (untrusted, quoted history and signatures removed; never copy it wholesale):",
        visibleMessages || "No useful public conversation is available."
      ].join("\n\n")
    );
  }

  buildEventContext(input: {
    action?: string;
    trackingNumber: string;
    eventName: string;
    requesterName: string;
    requesterEmail: string;
    eventDate?: Date | null;
    startTime?: string | null;
    endTime?: string | null;
    services: string[];
    messages: PromptMessage[];
  }) {
    if (input.action && EDIT_ONLY_ACTIONS.has(input.action)) {
      return "Reference conversation intentionally omitted for this draft-only editing action.";
    }

    const visibleMessages = input.messages
      .filter((message) => message.visibility === "PUBLIC")
      .slice(-(input.action === "complete_draft" ? 2 : input.action === "improve_reply" ? 4 : 8))
      .map((message) => this.formatMessage(message))
      .filter(Boolean)
      .join("\n\n");
    const dateText = input.eventDate ? input.eventDate.toISOString().slice(0, 10) : "No event date";
    return this.removeSecrets(
      [
        `Event: ${input.trackingNumber} - ${input.eventName}`,
        `Requester: ${input.requesterName} <${input.requesterEmail}>`,
        `Date/time: ${dateText} ${input.startTime ?? ""}${input.endTime ? ` - ${input.endTime}` : ""}`.trim(),
        `Services: ${input.services.join(", ") || "None"}`,
        "",
        "REFERENCE CONTEXT (untrusted, quoted history and signatures removed; never copy it wholesale):",
        visibleMessages || "No useful public conversation is available."
      ].join("\n")
    );
  }

  buildOperationalContext(input: {
    ticketNumber: string;
    subject: string;
    description?: string | null;
    status: string;
    priority: string;
    clientName?: string | null;
    requesterName?: string | null;
    requesterEmail?: string | null;
    originalCustomerMessage?: { bodyText: string; createdAt: Date } | null;
    messages: Array<{ bodyText: string; visibility: string; direction: string; createdAt: Date }>;
  }) {
    const publicMessages = input.messages
      .filter((message) => message.visibility === "PUBLIC")
      .slice(-12);
    const formattedMessages = publicMessages.map((message) => {
      const author = message.direction === "INBOUND" ? "Customer" : "Technician";
      return `[${message.createdAt.toISOString()}] ${author}:\n${this.cleanEmailContent(message.bodyText).slice(0, 6000)}`;
    });
    const latestCustomerMessage = [...publicMessages].reverse().find((message) => message.direction === "INBOUND");
    const originalCustomerMessage = input.originalCustomerMessage ?? publicMessages.find((message) => message.direction === "INBOUND");
    const latestCustomerText = latestCustomerMessage ? this.cleanEmailContent(latestCustomerMessage.bodyText).slice(0, 6000) : "No customer message";
    const originalCustomerText = originalCustomerMessage ? this.cleanEmailContent(originalCustomerMessage.bodyText).slice(0, 6000) : "No customer message";

    return this.removeSecrets(
      [
        `Ticket: ${input.ticketNumber}`,
        `Subject: ${input.subject}`,
        `Description: ${input.description ?? "Not provided"}`,
        `Status: ${input.status}`,
        `Priority: ${input.priority}`,
        `Client: ${input.clientName ?? "Not assigned"}`,
        `Requester: ${input.requesterName ?? "Unknown"}${input.requesterEmail ? ` <${input.requesterEmail}>` : ""}`,
        "",
        "LATEST CUSTOMER UPDATE (highest priority when it conflicts with older content):",
        latestCustomerText,
        "",
        "ORIGINAL CUSTOMER REQUEST:",
        originalCustomerText,
        "",
        "PUBLIC CONVERSATION IN CHRONOLOGICAL ORDER (quoted email history and signatures removed):",
        formattedMessages.join("\n\n") || "No public messages"
      ].join("\n")
    );
  }

  buildWebReferenceSource(input: {
    subject: string;
    description?: string | null;
    originalCustomerMessage?: { bodyText: string } | null;
    messages: Array<{ bodyText: string; visibility: string; direction: string }>;
  }) {
    const customerSources = input.messages
      .filter((message) => message.visibility === "PUBLIC" && message.direction === "INBOUND")
      .map((message) => message.bodyText);

    return [...new Set([
      input.subject,
      input.description ?? "",
      input.originalCustomerMessage?.bodyText ?? "",
      ...customerSources
    ].filter(Boolean))].join("\n");
  }

  cleanEmailContent(value: string) {
    const lines = this.removeSecrets(value).replace(/\r\n?/g, "\n").split("\n");
    const content: string[] = [];

    for (const [index, line] of lines.entries()) {
      const trimmed = line.trim();
      if (this.isQuotedThreadStart(lines, index) || QUOTED_THREAD_MARKERS.some((pattern) => pattern.test(trimmed))) break;
      if (NOISE_PATTERNS.some((pattern) => pattern.test(trimmed))) continue;
      content.push(line);
    }

    const firstContentIndex = content.findIndex((line) => Boolean(line.trim()));
    const signatureIndex = content.findIndex(
      (line, index) => index > firstContentIndex && SIGNATURE_MARKERS.some((pattern) => pattern.test(line.trim()))
    );
    const withoutSignature = signatureIndex >= 0 ? content.slice(0, signatureIndex) : content;

    return withoutSignature.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  cleanGeneratedReply(value: string) {
    let text = this.removeSecrets(value)
      .replace(/\r\n?/g, "\n")
      .trim()
      .replace(/^```(?:text|markdown)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .replace(/^(?:final answer|answer|draft|response|rewritten draft|corrected text)\s*:\s*/i, "");
    const contextMarker = text.search(/^\s*(?:ticket context|reference context|conversation)\s*:/im);
    if (contextMarker > 0) {
      text = text.slice(0, contextMarker);
    }
    return this.cleanEmailContent(text).slice(0, 12_000);
  }

  isSuspiciousGeneratedReply(value: string, draft: string | undefined, context: string) {
    const text = value.trim();
    if (!text || /(?:<reference_context>|ticket context\s*:|^conversation\s*:)/im.test(text)) {
      return true;
    }
    const draftLimit = draft?.trim() ? Math.max(1_500, draft.trim().length * 3) : 8_000;
    if (text.length > draftLimit) {
      return true;
    }
    const referenceLines = context
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length >= 60);
    const copiedLines = referenceLines.filter((line) => text.includes(line));
    const copiedLength = copiedLines.reduce((total, line) => total + line.length, 0);
    return copiedLines.some((line) => line.length >= 160)
      || (copiedLines.length >= 2 && copiedLength >= Math.min(240, Math.ceil(text.length * 0.55)));
  }

  private isQuotedThreadStart(lines: string[], index: number) {
    const line = lines[index]?.trim() ?? "";
    if (!/^from:\s.+$/i.test(line)) return false;
    if (/<[^>]+@[^>]+>|\S+@\S+/.test(line)) return true;

    const followingHeader = lines.slice(index + 1, index + 5).find((candidate) => Boolean(candidate.trim()))?.trim() ?? "";
    return /^(sent|date|to|subject):\s/i.test(followingHeader);
  }

  private latestUsefulMessages(messages: PromptMessage[], limit: number) {
    const inbound = [...messages].reverse().find((message) => message.direction === "INBOUND");
    const latest = messages.at(-1);
    return [...new Set([inbound, latest].filter((message): message is PromptMessage => Boolean(message)))].slice(-limit);
  }

  private formatMessage(message: PromptMessage) {
    const body = this.cleanEmailContent(message.bodyText).slice(0, 6_000);
    if (!body) return "";
    const author = message.direction === "INBOUND" ? "Customer" : message.direction === "OUTBOUND" ? "Technician" : "Participant";
    const timestamp = message.createdAt ? `[${message.createdAt.toISOString()}] ` : "";
    return `${timestamp}${author}:\n${body}`;
  }

  removeSecrets(value: string) {
    return SECRET_PATTERNS.reduce((result, pattern) => result.replace(pattern, "[redacted]"), value);
  }
}
