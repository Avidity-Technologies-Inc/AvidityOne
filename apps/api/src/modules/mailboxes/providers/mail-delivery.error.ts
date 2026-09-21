/** Safe transport metadata only; never include provider bodies, tokens or message content. */
export class MailDeliveryError extends Error {
  constructor(
    message: string,
    readonly outcome: "NOT_SENT" | "UNKNOWN",
    readonly retryable = false,
    readonly retryAfterMs = 0
  ) {
    super(message);
    this.name = "MailDeliveryError";
  }
}
