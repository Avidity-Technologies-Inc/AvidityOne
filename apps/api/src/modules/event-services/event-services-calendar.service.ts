import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { MicrosoftCalendarService } from "../microsoft-calendar/microsoft-calendar.service";

interface CreateCalendarEventInput {
  tenantId?: string | null;
  clientId?: string | null;
  clientSecretReference?: string | null;
  userEmail: string;
  subject: string;
  bodyHtml: string;
  startDateTime: string;
  endDateTime: string;
  timeZone: string;
  location?: string | null;
}

@Injectable()
export class EventServicesCalendarService {
  constructor(private readonly calendar: MicrosoftCalendarService) {}

  createEvent(input: CreateCalendarEventInput) {
    return this.calendar.createEvent({
      tenantId: input.tenantId,
      clientId: input.clientId,
      clientSecretReference: input.clientSecretReference,
      organizerEmail: input.userEmail,
      subject: input.subject,
      bodyHtml: input.bodyHtml,
      startDateTime: input.startDateTime,
      endDateTime: input.endDateTime,
      timeZone: input.timeZone,
      location: input.location,
      transactionId: randomUUID()
    });
  }
}
