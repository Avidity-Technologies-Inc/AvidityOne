import { FileStorageModule } from "../file-storage/file-storage.module";
import { QcAttachmentsService } from "./qc.attachments.service";
import { TicketAttachmentsModule } from "../ticket-attachments/ticket-attachments.module";
import { Module } from "@nestjs/common";
import { DevicesModule } from "../devices/devices.module";
import { QcEvidenceService } from "./qc.evidence.service";
import { MailTransportModule } from "../mailboxes/mail-transport.module";
import { QcTeamsController } from "./qc.teams.controller";
import { QcTeamsService } from "./qc.teams.service";
import { QcNotificationsService } from "./qc.notifications.service";
import { AuthModule } from "../auth/auth.module";
import { QcController } from "./qc.controller";
import { QcService } from "./qc.service";
import { QcWorkService } from "./qc.work.service";
import { QcReportsService } from "./qc.reports.service";
import { QcEngineService } from "./qc.engine.service";
@Module({ imports: [FileStorageModule, TicketAttachmentsModule, AuthModule, MailTransportModule, DevicesModule], controllers: [QcController, QcTeamsController], providers: [QcAttachmentsService, QcService, QcWorkService, QcReportsService, QcEngineService, QcTeamsService, QcNotificationsService, QcEvidenceService] })
export class QcModule {}
