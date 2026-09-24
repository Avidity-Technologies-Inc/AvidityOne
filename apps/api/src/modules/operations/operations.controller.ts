import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { RequirePermissions } from "../permissions/decorators/require-permissions.decorator";
import { PermissionsGuard } from "../permissions/guards/permissions.guard";
import { OperationsService } from "./operations.service";

@Controller("operations")
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get("overview")
  @RequirePermissions("operations.view")
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.operations.overview(user);
  }
}
