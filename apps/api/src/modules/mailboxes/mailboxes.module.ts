import { TicketEmailModule } from "../ticket-email/ticket-email.module";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { TicketAttachmentsModule } from "../ticket-attachments/ticket-attachments.module";
import { SpamManagementModule } from "../spam-management/spam-management.module";
import { TicketsModule } from "../tickets/tickets.module";
import { MailTransportModule } from "./mail-transport.module";
import { MailboxesController } from "./mailboxes.controller";
import { MailboxesService } from "./mailboxes.service";

@Module({
  imports: [TicketEmailModule, AuthModule, TicketsModule, TicketAttachmentsModule, SpamManagementModule, MailTransportModule],
  controllers: [MailboxesController],
  providers: [MailboxesService],
  exports: [MailboxesService]
})
export class MailboxesModule {}


