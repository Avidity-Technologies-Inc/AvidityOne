import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { RequirePermissions } from "../permissions/decorators/require-permissions.decorator";
import { PermissionsGuard } from "../permissions/guards/permissions.guard";
import { CreateReportDefinitionDto, CreateReportScheduleDto, ExecutiveProjectReportQueryDto, SendReportDto, UpdateReportDefinitionDto, UpdateReportScheduleDto } from "./dto/report-definition.dto";
import { EventServiceReportExportQueryDto, EventServiceReportQueryDto, TicketReportExportQueryDto, TicketReportQueryDto } from "./dto/ticket-report-query.dto";
import { ReportsService } from "./reports.service";

@Controller("reports")
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get("configuration")
  @RequirePermissions("reports.view")
  configuration(@CurrentUser() user: AuthenticatedUser) { return this.reportsService.configuration(user); }

  @Get("tickets/summary")
  @RequirePermissions("reports.view")
  ticketSummary(@Query() query: TicketReportQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.ticketSummary(user, query);
  }

  @Get("event-services/summary")
  @RequirePermissions("reports.view")
  eventServiceSummary(@Query() query: EventServiceReportQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.eventServiceSummary(user, query);
  }

  @Get("projects/executive-summary")
  @RequirePermissions("reports.view", "projects.view")
  executiveProjectSummary(@CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.executiveProjectSummary(user);
  }

  @Get("projects/executive-export")
  @RequirePermissions("reports.export", "projects.view")
  async exportExecutiveProjects(@Query() query: ExecutiveProjectReportQueryDto, @CurrentUser() user: AuthenticatedUser, @Res() response: Response) {
    const exportResult = await this.reportsService.exportExecutiveProjects(user, query);
    response.setHeader("Content-Type", exportResult.contentType);
    response.setHeader("Content-Disposition", `attachment; filename="${exportResult.filename}"`);
    response.send(exportResult.body);
  }

  @Post("projects/executive-send")
  @RequirePermissions("reports.send", "projects.view")
  sendExecutiveProjects(@Query() query: ExecutiveProjectReportQueryDto, @Body() body: SendReportDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.sendExecutiveProjects(user, query, body);
  }

  @Get("definitions")
  @RequirePermissions("reports.view")
  listDefinitions(@Query("reportType") reportType: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.listDefinitions(user, reportType);
  }

  @Get("templates")
  @RequirePermissions("reports.view")
  listTemplates(@Query("reportType") reportType: string | undefined) {
    return this.reportsService.listTemplates(reportType);
  }

  @Get("exports")
  @RequirePermissions("reports.view")
  listExportHistory(@Query("reportType") reportType: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.listExportHistory(user, reportType);
  }

  @Post("definitions")
  @RequirePermissions("reports.manage")
  createDefinition(@Body() body: CreateReportDefinitionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.createDefinition(user, body);
  }

  @Patch("definitions/:definitionId")
  @RequirePermissions("reports.manage")
  updateDefinition(@Param("definitionId") definitionId: string, @Body() body: UpdateReportDefinitionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.updateDefinition(user, definitionId, body);
  }

  @Delete("definitions/:definitionId")
  @RequirePermissions("reports.manage")
  deleteDefinition(@Param("definitionId") definitionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.deleteDefinition(user, definitionId);
  }

  @Get("schedules")
  @RequirePermissions("reports.view")
  listSchedules(@Query("reportType") reportType: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.listSchedules(user, reportType);
  }

  @Post("schedules")
  @RequirePermissions("reports.manage", "reports.send", "reports.view")
  createSchedule(@Body() body: CreateReportScheduleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.createSchedule(user, body);
  }

  @Patch("schedules/:scheduleId")
  @RequirePermissions("reports.manage", "reports.send", "reports.view")
  updateSchedule(@Param("scheduleId") scheduleId: string, @Body() body: UpdateReportScheduleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.updateSchedule(user, scheduleId, body);
  }

  @Delete("schedules/:scheduleId")
  @RequirePermissions("reports.manage")
  deleteSchedule(@Param("scheduleId") scheduleId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.deleteSchedule(user, scheduleId);
  }

  @Get("tickets/export")
  @RequirePermissions("reports.export")
  async exportTickets(@Query() query: TicketReportExportQueryDto, @CurrentUser() user: AuthenticatedUser, @Res() response: Response) {
    const exportResult = await this.reportsService.exportTickets(user, query);
    response.setHeader("Content-Type", exportResult.contentType);
    response.setHeader("Content-Disposition", `attachment; filename="${exportResult.filename}"`);
    response.send(exportResult.body);
  }

  @Post("tickets/send")
  @RequirePermissions("reports.send")
  sendTicketsReport(@Query() query: TicketReportExportQueryDto, @Body() body: SendReportDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.sendTicketsReport(user, query, body);
  }

  @Get("event-services/export")
  @RequirePermissions("reports.export")
  async exportEventServices(@Query() query: EventServiceReportExportQueryDto, @CurrentUser() user: AuthenticatedUser, @Res() response: Response) {
    const exportResult = await this.reportsService.exportEventServices(user, query);
    response.setHeader("Content-Type", exportResult.contentType);
    response.setHeader("Content-Disposition", `attachment; filename="${exportResult.filename}"`);
    response.send(exportResult.body);
  }

  @Post("event-services/send")
  @RequirePermissions("reports.send")
  sendEventServicesReport(@Query() query: EventServiceReportExportQueryDto, @Body() body: SendReportDto, @CurrentUser() user: AuthenticatedUser) {
    return this.reportsService.sendEventServicesReport(user, query, body);
  }
}
