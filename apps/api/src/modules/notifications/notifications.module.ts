import { TicketEmailModule } from "../ticket-email/ticket-email.module";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MailTransportModule } from "../mailboxes/mail-transport.module";
import { PermissionsModule } from "../permissions/permissions.module";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

@Module({
  imports: [TicketEmailModule, AuthModule, MailTransportModule, PermissionsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService]
})
export class NotificationsModule {}
