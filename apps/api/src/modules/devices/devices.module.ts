import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuditLogsModule } from "../audit-logs/audit-logs.module";
import { AuthModule } from "../auth/auth.module";
import { DevicesController } from "./devices.controller";
import { DevicesService } from "./devices.service";

@Module({
  imports: [AuditLogsModule, AuthModule, ConfigModule],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService]
})
export class DevicesModule {}


