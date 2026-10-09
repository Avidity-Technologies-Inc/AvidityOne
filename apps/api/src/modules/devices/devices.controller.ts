import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { RequirePermissions } from "../permissions/decorators/require-permissions.decorator";
import { PermissionsGuard } from "../permissions/guards/permissions.guard";
import { DeviceQueryDto } from "./dto/device-query.dto";
import { UpdateRmmSettingsDto } from "./dto/update-rmm-settings.dto";
import { UpsertDeviceViewDto } from "./dto/upsert-device-view.dto";
import { DevicesService } from "./devices.service";
import { DeviceIdentityService } from "./device-identity.service";
import { ResolveDeviceIdentityDto } from "./dto/resolve-device-identity.dto";

@Controller("devices")
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class DevicesController {
  constructor(private readonly devicesService: DevicesService, private readonly identity: DeviceIdentityService) {}

  @Get("identity-review")
  @RequirePermissions("devices.view")
  reviewIdentity(@CurrentUser() user: AuthenticatedUser) { return this.identity.review(user); }

  @Post("identity-review/:installationId")
  @RequirePermissions("remote_access.configure")
  resolveIdentity(@CurrentUser() user: AuthenticatedUser, @Param("installationId") id: string, @Body() body: ResolveDeviceIdentityDto) {
    return this.identity.resolve(user, id, body);
  }

  @Get()
  @RequirePermissions("devices.view")
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: DeviceQueryDto) {
    return this.devicesService.list(user, query);
  }

  @Get("rmm-settings")
  @RequirePermissions("remote_access.configure")
  getRemoteAccessSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.devicesService.getRemoteAccessSettings(user);
  }

  @Patch("rmm-settings")
  @RequirePermissions("remote_access.configure")
  updateRemoteAccessSettings(@CurrentUser() user: AuthenticatedUser, @Body() body: UpdateRmmSettingsDto) {
    return this.devicesService.updateRemoteAccessSettings(user, body);
  }

  @Post("rmm-sync")
  @RequirePermissions("remote_access.configure")
  syncFromRemoteAccessProvider(@CurrentUser() user: AuthenticatedUser) {
    return this.devicesService.syncFromRemoteAccessProvider(user);
  }

  @Post(":deviceId/rmm-details/refresh")
  @RequirePermissions("remote_access.connect")
  refreshRemoteAccessDetails(@CurrentUser() user: AuthenticatedUser, @Param("deviceId") deviceId: string) {
    return this.devicesService.refreshRemoteAccessDetails(user, deviceId);
  }

  @Get("views")
  @RequirePermissions("devices.view")
  listViews(@CurrentUser() user: AuthenticatedUser) {
    return this.devicesService.listViews(user);
  }

  @Post("views")
  @RequirePermissions("devices.view")
  createView(@CurrentUser() user: AuthenticatedUser, @Body() body: UpsertDeviceViewDto) {
    return this.devicesService.saveView(user, body);
  }

  @Patch("views/:viewId")
  @RequirePermissions("devices.view")
  updateView(@CurrentUser() user: AuthenticatedUser, @Param("viewId") viewId: string, @Body() body: UpsertDeviceViewDto) {
    return this.devicesService.updateView(user, viewId, body);
  }

  @Delete("views/:viewId")
  @RequirePermissions("devices.view")
  deleteView(@CurrentUser() user: AuthenticatedUser, @Param("viewId") viewId: string) {
    return this.devicesService.deleteView(user, viewId);
  }

  @Put(":deviceId/favorite")
  @RequirePermissions("devices.view")
  markFavorite(@CurrentUser() user: AuthenticatedUser, @Param("deviceId") deviceId: string) {
    return this.devicesService.setFavorite(user, deviceId, true);
  }

  @Delete(":deviceId/favorite")
  @RequirePermissions("devices.view")
  unmarkFavorite(@CurrentUser() user: AuthenticatedUser, @Param("deviceId") deviceId: string) {
    return this.devicesService.setFavorite(user, deviceId, false);
  }

  @Get(":deviceId")
  @RequirePermissions("devices.view")
  getById(@CurrentUser() user: AuthenticatedUser, @Param("deviceId") deviceId: string) {
    return this.devicesService.getById(user, deviceId);
  }
}
