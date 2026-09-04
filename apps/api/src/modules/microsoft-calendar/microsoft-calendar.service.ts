import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface MicrosoftCalendarCredentials {
  tenantId?: string | null;
  clientId?: string | null;
  clientSecretReference?: string | null;
}

export interface MicrosoftCalendarAttendee {
  email: string;
  name?: string | null;
  type: "required" | "optional";
}

export interface MicrosoftCalendarEventInput extends MicrosoftCalendarCredentials {
  organizerEmail: string;
  subject: string;
  bodyHtml: string;
  startDateTime: string;
  endDateTime: string;
  timeZone: string;
  location?: string | null;
  attendees?: MicrosoftCalendarAttendee[];
  isOnlineMeeting?: boolean;
  transactionId: string;
}

export interface MicrosoftCalendarEvent extends Record<string, unknown> {
  id: string;
  changeKey?: string;
  iCalUId?: string;
  webLink?: string;
  body?: { contentType?: string; content?: string };
  onlineMeeting?: { joinUrl?: string };
}

@Injectable()
export class MicrosoftCalendarService {
  private readonly tokenCache = new Map<string, { token: string; expiresAt: number }>();

  constructor(private readonly config: ConfigService) {}

  async createEvent(input: MicrosoftCalendarEventInput) {
    return this.requestEvent(input, `/users/${encodeURIComponent(input.organizerEmail)}/events`, {
      method: "POST",
      body: {
        subject: input.subject,
        body: { contentType: "HTML", content: input.bodyHtml },
        start: { dateTime: input.startDateTime, timeZone: input.timeZone },
        end: { dateTime: input.endDateTime, timeZone: input.timeZone },
        location: input.location ? { displayName: input.location } : undefined,
        attendees: input.attendees?.map((attendee) => ({
          emailAddress: { address: attendee.email, name: attendee.name || attendee.email },
          type: attendee.type
        })),
        allowNewTimeProposals: true,
        responseRequested: true,
        isOnlineMeeting: input.isOnlineMeeting || undefined,
        onlineMeetingProvider: input.isOnlineMeeting ? "teamsForBusiness" : undefined,
        transactionId: input.transactionId
      }
    });
  }

  async updateEvent(input: MicrosoftCalendarEventInput & { eventId: string }) {
    const eventPath = `/users/${encodeURIComponent(input.organizerEmail)}/events/${encodeURIComponent(input.eventId)}`;
    let bodyHtml = input.bodyHtml;
    if (input.isOnlineMeeting) {
      const existing = await this.requestEvent(input, `${eventPath}?$select=body`, { method: "GET" });
      bodyHtml = this.preserveOnlineMeetingBody(existing.body?.content, input.bodyHtml);
    }
    return this.requestEvent(input, eventPath, {
      method: "PATCH",
      body: {
        subject: input.subject,
        body: { contentType: "HTML", content: bodyHtml },
        start: { dateTime: input.startDateTime, timeZone: input.timeZone },
        end: { dateTime: input.endDateTime, timeZone: input.timeZone },
        location: input.location ? { displayName: input.location } : { displayName: "" },
        attendees: input.attendees?.map((attendee) => ({
          emailAddress: { address: attendee.email, name: attendee.name || attendee.email },
          type: attendee.type
        }))
      }
    });
  }

  async cancelEvent(input: MicrosoftCalendarCredentials & { organizerEmail: string; eventId: string; comment?: string | null }) {
    await this.request(input, `/users/${encodeURIComponent(input.organizerEmail)}/events/${encodeURIComponent(input.eventId)}/cancel`, {
      method: "POST",
      body: { comment: input.comment?.trim() || "This meeting has been cancelled." },
      expectJson: false
    });
  }

  private async requestEvent(credentials: MicrosoftCalendarCredentials, path: string, options: { method: string; body?: Record<string, unknown> }) {
    return this.request(credentials, path, { ...options, expectJson: true }) as Promise<MicrosoftCalendarEvent>;
  }

  private async request(
    credentials: MicrosoftCalendarCredentials,
    path: string,
    options: { method: string; body?: Record<string, unknown>; expectJson: boolean }
  ) {
    const token = await this.getAccessToken(credentials);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      if (response.ok) {
        if (!options.expectJson || response.status === 204) return null;
        return response.json();
      }
      const details = await response.text();
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < 2) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await this.delay(Number.isFinite(retryAfter) ? Math.min(retryAfter * 1000, 10_000) : 500 * 2 ** attempt);
        continue;
      }
      throw new InternalServerErrorException(
        `Microsoft Graph calendar request failed (${response.status})${details ? `: ${details.slice(0, 300)}` : "."}`
      );
    }
    throw new InternalServerErrorException("Microsoft Graph calendar request failed after retries.");
  }

  private async getAccessToken(credentials: MicrosoftCalendarCredentials) {
    const tenantId = credentials.tenantId || this.config.get<string>("MICROSOFT_TENANT_ID");
    const clientId = credentials.clientId || this.config.get<string>("MICROSOFT_CLIENT_ID");
    const clientSecret = this.resolveSecret(credentials.clientSecretReference) || this.config.get<string>("MICROSOFT_CLIENT_SECRET");
    if (!tenantId || !clientId || !clientSecret) {
      throw new InternalServerErrorException("Microsoft Graph calendar credentials are not configured.");
    }
    const cacheKey = `${tenantId}:${clientId}`;
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

    const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials"
      })
    });
    if (!response.ok) throw new InternalServerErrorException("Unable to authenticate with Microsoft Graph calendar.");
    const token = await response.json() as { access_token?: string; expires_in?: number };
    if (!token.access_token) throw new InternalServerErrorException("Microsoft Graph token response did not include an access token.");
    this.tokenCache.set(cacheKey, { token: token.access_token, expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000 });
    return token.access_token;
  }

  private preserveOnlineMeetingBody(existing: string | undefined, replacement: string) {
    if (!existing) return replacement;
    const start = "<!-- avidity-ticket-meeting:start -->";
    const end = "<!-- avidity-ticket-meeting:end -->";
    const startIndex = existing.indexOf(start);
    const endIndex = existing.indexOf(end);
    if (startIndex >= 0 && endIndex > startIndex) {
      return `${existing.slice(0, startIndex)}${replacement}${existing.slice(endIndex + end.length)}`;
    }
    return `${replacement}${existing}`;
  }

  private resolveSecret(reference: string | null | undefined) {
    if (!reference?.startsWith("env:")) return null;
    return this.config.get<string>(reference.slice(4)) ?? null;
  }

  private delay(milliseconds: number) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
