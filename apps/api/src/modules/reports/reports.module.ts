import { LocalFileStorageProvider } from "../file-storage/providers/local-file-storage.provider";
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MailTransportModule } from "../mailboxes/mail-transport.module";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

@Module({
  imports: [AuthModule, MailTransportModule],
  controllers: [ReportsController],
  providers: [ReportsService, LocalFileStorageProvider]
})
export class ReportsModule {}
