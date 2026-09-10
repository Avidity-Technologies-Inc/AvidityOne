import { Body, Controller, Headers, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { QcTeamsService, TeamsActivity } from "./qc.teams.service";
@Controller("qc/teams")
@UseGuards(ThrottlerGuard)
export class QcTeamsController {
  constructor(private readonly teams: QcTeamsService) {}
  @Post(":organizationId/activities") @HttpCode(200) @Throttle({ default: { limit: 60, ttl: 60000 } })
  receive(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Headers("authorization") authorization: string | undefined, @Body() activity: TeamsActivity) { return this.teams.receive(organizationId, authorization, activity); }
}
