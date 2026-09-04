import { Module } from "@nestjs/common";
import { HtmlSanitizerService } from "../../common/html/html-sanitizer.service";
import { AuditLogsModule } from "../audit-logs/audit-logs.module";
import { AuthModule } from "../auth/auth.module";
import { AutoRepliesModule } from "../auto-replies/auto-replies.module";
import { FileStorageModule } from "../file-storage/file-storage.module";
import { ExternalSpecialistsModule } from "../external-specialists/external-specialists.module";
import { MailTransportModule } from "../mailboxes/mail-transport.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { MicrosoftCalendarModule } from "../microsoft-calendar/microsoft-calendar.module";
import { EventServicesAttachmentsService } from "./event-services-attachments.service";
import { EventServicesController } from "./event-services.controller";
import { EventServicesCalendarService } from "./event-services-calendar.service";
import { EventServicesService } from "./event-services.service";

@Module({
  imports: [AuthModule, AuditLogsModule, AutoRepliesModule, ExternalSpecialistsModule, FileStorageModule, MailTransportModule, MicrosoftCalendarModule, NotificationsModule],
  controllers: [EventServicesController],
  providers: [EventServicesService, EventServicesAttachmentsService, EventServicesCalendarService, HtmlSanitizerService],
  exports: [EventServicesService]
})
export class EventServicesModule {}
