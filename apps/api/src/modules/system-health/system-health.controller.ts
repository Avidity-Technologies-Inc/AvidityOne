import { Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { RequirePermissions } from "../permissions/decorators/require-permissions.decorator";
import { PermissionsGuard } from "../permissions/guards/permissions.guard";
import { SystemHealthRange, SystemHealthService } from "./system-health.service";

@Controller("system-health")
export class SystemHealthController {
  constructor(private readonly systemHealth: SystemHealthService) {}

  @Get("summary")
  @UseGuards(SessionAuthGuard)
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.systemHealth.getSummary(user, false);
  }

  @Post("check")
  @UseGuards(SessionAuthGuard, PermissionsGuard)
  @RequirePermissions("system_settings.view")
  check(@CurrentUser() user: AuthenticatedUser) {
    return this.systemHealth.getSummary(user, true);
  }

  @Get("history")
  @UseGuards(SessionAuthGuard, PermissionsGuard)
  @RequirePermissions("system_settings.view")
  history(@CurrentUser() user: AuthenticatedUser, @Query("range") range?: SystemHealthRange, @Query("page") page?: string, @Query("component") component?: string, @Query("status") status?: string) {
    return this.systemHealth.getHistory(user.organizationId, range, page, component, status);
  }

  @Get("timeline")
  @UseGuards(SessionAuthGuard, PermissionsGuard)
  @RequirePermissions("system_settings.view")
  timeline(@CurrentUser() user: AuthenticatedUser, @Query("range") range?: SystemHealthRange) {
    return this.systemHealth.getTimeline(user.organizationId, range);
  }
}
