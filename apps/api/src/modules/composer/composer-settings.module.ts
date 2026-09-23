import { Body, Controller, Get, Module, Patch, UseGuards } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuditLogsModule } from "../audit-logs/audit-logs.module";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { PermissionsGuard } from "../permissions/guards/permissions.guard";
import { RequirePermissions } from "../permissions/decorators/require-permissions.decorator";
import { ComposerSettingsService } from "./composer-settings.service";

@Controller()
@UseGuards(SessionAuthGuard, PermissionsGuard)
class ComposerSettingsController {
  constructor(private readonly settings: ComposerSettingsService) {}
  @Get("profile/composer")
  personal(@CurrentUser() user: AuthenticatedUser) { return this.settings.get(user); }
  @Patch("profile/composer")
  updatePersonal(@CurrentUser() user: AuthenticatedUser, @Body() input: Record<string, unknown>) { return this.settings.update(user, input, false); }
  @Get("system-settings/composer")
  @RequirePermissions("system_settings.view")
  organization(@CurrentUser() user: AuthenticatedUser) { return this.settings.get(user); }
  @Patch("system-settings/composer")
  @RequirePermissions("system_settings.update")
  updateOrganization(@CurrentUser() user: AuthenticatedUser, @Body() input: Record<string, unknown>) { return this.settings.update(user, input, true); }
}
@Module({ imports: [AuthModule, AuditLogsModule], controllers: [ComposerSettingsController], providers: [ComposerSettingsService] })
export class ComposerSettingsModule {}
