import { Module } from "@nestjs/common";
import { MicrosoftCalendarService } from "./microsoft-calendar.service";

@Module({
  providers: [MicrosoftCalendarService],
  exports: [MicrosoftCalendarService]
})
export class MicrosoftCalendarModule {}
