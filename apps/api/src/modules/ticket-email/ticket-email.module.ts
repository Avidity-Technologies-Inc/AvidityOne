import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PermissionsModule } from "../permissions/permissions.module";
import { AuditLogsModule } from "../audit-logs/audit-logs.module";
import { FileStorageModule } from "../file-storage/file-storage.module";
import { MailTransportModule } from "../mailboxes/mail-transport.module";
import { HtmlSanitizerService } from "../../common/html/html-sanitizer.service";
import { TicketEmailService } from "./ticket-email.service";
import { TicketEmailController } from "./ticket-email.controller";
@Module({ imports: [AuthModule, PermissionsModule, AuditLogsModule, FileStorageModule, MailTransportModule], providers: [TicketEmailService, HtmlSanitizerService], controllers: [TicketEmailController], exports: [TicketEmailService] })
export class TicketEmailModule {}
