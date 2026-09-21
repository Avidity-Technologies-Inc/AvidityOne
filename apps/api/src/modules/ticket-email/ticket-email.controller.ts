import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { RequirePermissions } from "../permissions/decorators/require-permissions.decorator";
import { PermissionsGuard } from "../permissions/guards/permissions.guard";
import { UpdateTicketEmailPolicyDto } from "./ticket-email.dto";
import { TicketEmailService } from "./ticket-email.service";
@Controller("ticket-email")
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class TicketEmailController {
  constructor(private readonly service: TicketEmailService) {}
  @Get("settings") @RequirePermissions("system_settings.view")
  overview(@CurrentUser() user: AuthenticatedUser) { return this.service.overview(user); }
  @Patch("settings") @RequirePermissions("system_settings.update")
  update(@CurrentUser() user: AuthenticatedUser, @Body() input: UpdateTicketEmailPolicyDto) { return this.service.updatePolicy(user, input); }
  @Get("me") @RequirePermissions("tickets.view")
  mine(@CurrentUser() user: AuthenticatedUser) { return this.service.overview(user, true); }
  @Post("deliveries/:id/retry") @RequirePermissions("system_settings.update")
  retry(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) { return this.service.retry(user, id); }
}
