import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { RequirePermissions } from "../permissions/decorators/require-permissions.decorator";
import { PermissionsGuard } from "../permissions/guards/permissions.guard";
import { BulkTicketIdsDto } from "./dto/bulk-ticket-ids.dto";
import { BulkUpdateTicketsDto } from "./dto/bulk-update-tickets.dto";
import { AddTicketExternalSpecialistDto } from "./dto/add-ticket-external-specialist.dto";
import { CreateTicketDto } from "./dto/create-ticket.dto";
import { CreateTicketMessageDto } from "./dto/create-ticket-message.dto";
import { ListTicketsQueryDto } from "./dto/list-tickets-query.dto";
import { MergeTicketsDto } from "./dto/merge-tickets.dto";
import { UpdateTicketAssignmentDto } from "./dto/update-ticket-assignment.dto";
import { UpdateTicketWatchersDto } from "./dto/update-ticket-watchers.dto";
import { UpdateTicketPlanningDto } from "./dto/update-ticket-planning.dto";
import { UpdateTicketStateDto } from "./dto/update-ticket-state.dto";
import { UpsertTicketViewDto } from "./dto/upsert-ticket-view.dto";
import { TicketsService } from "./tickets.service";

@Controller("tickets")
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  @RequirePermissions("tickets.view")
  list(@Query() query: ListTicketsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.list(user, query);
  }

  @Post()
  @RequirePermissions("tickets.create")
  create(@Body() body: CreateTicketDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.create(body, user);
  }

  @Get("views")
  @RequirePermissions("tickets.view")
  listViews(@CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.listViews(user);
  }

  @Get("statistics")
  @RequirePermissions("tickets.view")
  statistics(@CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.statistics(user);
  }

  @Get("assignment-options")
  @RequirePermissions("tickets.view")
  assignmentOptions(@CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.assignmentOptions(user);
  }

  @Post("views")
  @RequirePermissions("tickets.view")
  createView(@Body() body: UpsertTicketViewDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.saveView(body, user);
  }

  @Patch("views/:viewId")
  @RequirePermissions("tickets.view")
  updateView(@Param("viewId") viewId: string, @Body() body: UpsertTicketViewDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.updateView(viewId, body, user);
  }

  @Delete("views/:viewId")
  @RequirePermissions("tickets.view")
  deleteView(@Param("viewId") viewId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.deleteView(viewId, user);
  }

  @Patch("bulk")
  @RequirePermissions("tickets.view")
  bulkUpdate(@Body() body: BulkUpdateTicketsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.bulkUpdate(body, user);
  }

  @Post("bulk/delete")
  @RequirePermissions("tickets.delete")
  bulkDelete(@Body() body: BulkTicketIdsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.bulkSoftDelete(body.ticketIds, user);
  }

  @Post("bulk/restore")
  @RequirePermissions("tickets.update")
  bulkRestore(@Body() body: BulkTicketIdsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.bulkRestore(body.ticketIds, user);
  }

  @Get(":ticketId/merge-candidates")
  @RequirePermissions("tickets.view")
  mergeCandidates(@Param("ticketId") ticketId: string, @Query("search") search: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.mergeCandidates(ticketId, user, search);
  }

  @Post(":ticketId/merge")
  @RequirePermissions("tickets.merge")
  mergeTickets(@Param("ticketId") ticketId: string, @Body() body: MergeTicketsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.mergeTickets(ticketId, body, user);
  }

  @Get(":ticketId")
  @RequirePermissions("tickets.view")
  getById(@Param("ticketId") ticketId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.getById(ticketId, user);
  }

  @Patch(":ticketId/assignment")
  @RequirePermissions("tickets.assign")
  updateAssignment(
    @Param("ticketId") ticketId: string,
    @Body() body: UpdateTicketAssignmentDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.ticketsService.updateAssignment(ticketId, body, user);
  }

  @Patch(":ticketId/planning")
  @RequirePermissions("tickets.update")
  updatePlanning(@Param("ticketId") ticketId: string, @Body() body: UpdateTicketPlanningDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.updatePlanning(ticketId, body, user);
  }

  @Patch(":ticketId/state")
  @RequirePermissions("tickets.view")
  updateState(@Param("ticketId") ticketId: string, @Body() body: UpdateTicketStateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.updateState(ticketId, body, user);
  }

  @Patch(":ticketId/watchers")
  @RequirePermissions("tickets.update")
  updateWatchers(@Param("ticketId") ticketId: string, @Body() body: UpdateTicketWatchersDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.updateWatchers(ticketId, body.userIds ?? [], user);
  }

  @Delete(":ticketId/conversation-participants/:participantId")
  @RequirePermissions("tickets.update")
  removeConversationParticipant(
    @Param("ticketId") ticketId: string,
    @Param("participantId") participantId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.ticketsService.removeConversationParticipant(ticketId, participantId, user);
  }

  @Delete(":ticketId/conversation-participants")
  @RequirePermissions("tickets.update")
  clearConversationParticipants(@Param("ticketId") ticketId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.clearConversationParticipants(ticketId, user);
  }

  @Post(":ticketId/external-specialists")
  @RequirePermissions("tickets.update")
  addExternalSpecialist(@Param("ticketId") ticketId: string, @Body() body: AddTicketExternalSpecialistDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.addExternalSpecialist(ticketId, body, user);
  }

  @Delete(":ticketId/external-specialists/:assignmentId")
  @RequirePermissions("tickets.update")
  removeExternalSpecialist(@Param("ticketId") ticketId: string, @Param("assignmentId") assignmentId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.removeExternalSpecialist(ticketId, assignmentId, user);
  }

  @Post(":ticketId/close")
  @RequirePermissions("tickets.close")
  closeTicket(@Param("ticketId") ticketId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ticketsService.closeTicket(ticketId, user);
  }

  @Post(":ticketId/messages")
  @RequirePermissions("tickets.reply")
  createMessage(
    @Param("ticketId") ticketId: string,
    @Body() body: CreateTicketMessageDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.ticketsService.createMessage(ticketId, body, user);
  }
}
