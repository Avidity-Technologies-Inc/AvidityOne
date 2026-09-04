import { Module } from "@nestjs/common";
import { AuditLogsModule } from "../audit-logs/audit-logs.module";
import { AuthModule } from "../auth/auth.module";
import { MicrosoftCalendarModule } from "../microsoft-calendar/microsoft-calendar.module";
import { TicketMeetingsController } from "./ticket-meetings.controller";
import { TicketMeetingsService } from "./ticket-meetings.service";

@Module({
  imports: [AuthModule, AuditLogsModule, MicrosoftCalendarModule],
  controllers: [TicketMeetingsController],
  providers: [TicketMeetingsService]
})
export class TicketMeetingsModule {}
