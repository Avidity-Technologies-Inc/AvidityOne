import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditLogsModule } from "../audit-logs/audit-logs.module";
import { ContactsModule } from "../contacts/contacts.module";
import { ExternalSpecialistsModule } from "../external-specialists/external-specialists.module";
import { MailTransportModule } from "../mailboxes/mail-transport.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { AutoRepliesModule } from "../auto-replies/auto-replies.module";
import { TicketRoutingModule } from "../ticket-routing/ticket-routing.module";
import { TicketWorkflowModule } from "../ticket-workflow/ticket-workflow.module";
import { HtmlSanitizerService } from "../../common/html/html-sanitizer.service";
import { SupportPortalController } from "./support-portal.controller";
import { SupportPortalService } from "./support-portal.service";
import { TicketsController } from "./tickets.controller";
import { TicketsService } from "./tickets.service";

@Module({
  imports: [AuthModule, AuditLogsModule, ContactsModule, ExternalSpecialistsModule, TicketRoutingModule, TicketWorkflowModule, MailTransportModule, NotificationsModule, AutoRepliesModule],
  controllers: [TicketsController, SupportPortalController],
  providers: [TicketsService, SupportPortalService, HtmlSanitizerService],
  exports: [TicketsService, HtmlSanitizerService]
})
export class TicketsModule {}
