import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { SpamBlockType } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { RequirePermissions } from "../permissions/decorators/require-permissions.decorator";
import { PermissionsGuard } from "../permissions/guards/permissions.guard";
import { CreateSpamBlockEntryDto } from "./dto/create-spam-block-entry.dto";
import { SpamQuarantineQueryDto } from "./dto/spam-quarantine-query.dto";
import { UpdateSpamBlockEntryDto } from "./dto/update-spam-block-entry.dto";
import { SpamManagementService } from "./spam-management.service";

@Controller("spam-blocklist")
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class SpamManagementController {
  constructor(private readonly spamManagement: SpamManagementService) {}

  @Get()
  @RequirePermissions("spam.view")
  list(@Query("search") search: string | undefined, @Query("type") type: SpamBlockType | undefined, @Query("active") active: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.spamManagement.list(user, { search, type, active });
  }

  @Get("quarantine")
  @RequirePermissions("spam.view")
  listQuarantine(@Query() query: SpamQuarantineQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.spamManagement.listQuarantine(user, query);
  }

  @Post("quarantine/:entryId/dismiss")
  @RequirePermissions("spam.manage")
  dismissQuarantine(@Param("entryId") entryId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.spamManagement.dismissQuarantinedEmail(entryId, user);
  }

  @Post()
  @RequirePermissions("spam.manage")
  create(@Body() body: CreateSpamBlockEntryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.spamManagement.create(body, user);
  }

  @Patch(":entryId")
  @RequirePermissions("spam.manage")
  update(@Param("entryId") entryId: string, @Body() body: UpdateSpamBlockEntryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.spamManagement.update(entryId, body, user);
  }

  @Delete(":entryId")
  @RequirePermissions("spam.manage")
  delete(@Param("entryId") entryId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.spamManagement.delete(entryId, user);
  }
}
