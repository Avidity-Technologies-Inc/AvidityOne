import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { AuthenticatedUser } from "../auth/auth.types";
import { RequirePermissions } from "../permissions/decorators/require-permissions.decorator";
import { PermissionsGuard } from "../permissions/guards/permissions.guard";
import { CancelTicketMeetingDto, CreateTicketMeetingDto, UpdateTicketMeetingDto } from "./dto/ticket-meeting.dto";
import { TicketMeetingsService } from "./ticket-meetings.service";

@Controller("tickets/:ticketId/meetings")
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class TicketMeetingsController {
  constructor(private readonly meetings: TicketMeetingsService) {}

  @Get()
  @RequirePermissions("ticket_meetings.view")
  list(@Param("ticketId") ticketId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.meetings.list(ticketId, user);
  }

  @Post()
  @RequirePermissions("ticket_meetings.create")
  create(@Param("ticketId") ticketId: string, @Body() body: CreateTicketMeetingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.meetings.create(ticketId, body, user);
  }

  @Patch(":meetingId")
  @RequirePermissions("ticket_meetings.update")
  update(@Param("ticketId") ticketId: string, @Param("meetingId") meetingId: string, @Body() body: UpdateTicketMeetingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.meetings.update(ticketId, meetingId, body, user);
  }

  @Post(":meetingId/schedule")
  @RequirePermissions("ticket_meetings.create")
  schedule(@Param("ticketId") ticketId: string, @Param("meetingId") meetingId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.meetings.schedule(ticketId, meetingId, user);
  }

  @Post(":meetingId/retry")
  @RequirePermissions("ticket_meetings.update")
  retry(@Param("ticketId") ticketId: string, @Param("meetingId") meetingId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.meetings.schedule(ticketId, meetingId, user);
  }

  @Post(":meetingId/cancel")
  @RequirePermissions("ticket_meetings.cancel")
  cancel(@Param("ticketId") ticketId: string, @Param("meetingId") meetingId: string, @Body() body: CancelTicketMeetingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.meetings.cancel(ticketId, meetingId, body.comment, user);
  }

  @Post(":meetingId/complete-and-release")
  @RequirePermissions("ticket_meetings.update", "ticket_meetings.cancel")
  completeAndRelease(@Param("ticketId") ticketId: string, @Param("meetingId") meetingId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.meetings.complete(ticketId, meetingId, user, true);
  }

  @Post(":meetingId/complete")
  @RequirePermissions("ticket_meetings.update")
  complete(@Param("ticketId") ticketId: string, @Param("meetingId") meetingId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.meetings.complete(ticketId, meetingId, user);
  }
}
