import { FileInterceptor } from "@nestjs/platform-express";
import { singleFileUploadOptions } from "../file-storage/upload-limits";
import { QcAttachmentsService } from "./qc.attachments.service";
import { QcTeamsService } from "./qc.teams.service";
import { Response } from "express";
import { TicketAttachmentsService } from "../ticket-attachments/ticket-attachments.service";
import { Body, BadRequestException, UseInterceptors, UploadedFile, NotFoundException, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards, Res, StreamableFile } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard";
import { RequirePermissions } from "../permissions/decorators/require-permissions.decorator";
import { PermissionsGuard } from "../permissions/guards/permissions.guard";
import { QcEvidenceService } from "./qc.evidence.service";
import { QcHoldDto, QcResumeDto, QcRmmLinkDto } from "./dto/qc-evidence.dto";
import { QcBillingReleaseDto } from "./dto/qc-billing.dto";
import * as D from "./dto/qc.dto";
import { QcService } from "./qc.service";
import { QcWorkService } from "./qc.work.service";
import { QcNotificationsService } from "./qc.notifications.service";
import { QcReportsService } from "./qc.reports.service";

@Controller("qc")
@UseGuards(SessionAuthGuard, PermissionsGuard)
export class QcController {
  constructor(private readonly qc: QcService, private readonly work: QcWorkService, private readonly reports: QcReportsService, private readonly notifications: QcNotificationsService, private readonly sourceEvidence: QcEvidenceService, private readonly attachments: TicketAttachmentsService, private readonly teams: QcTeamsService, private readonly creativeAttachments: QcAttachmentsService) {}
  @Post("deliverables/:id/attachments") @RequirePermissions("qc.view", "qc.work_record")
  @UseInterceptors(FileInterceptor("file", singleFileUploadOptions(Number(process.env.MAX_UPLOAD_SIZE_MB ?? 25) * 1024 * 1024)))
  uploadEvidence(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser, @UploadedFile() file?: { originalname: string; mimetype: string; buffer: Buffer }) {
    if (!file) throw new BadRequestException("Choose an evidence file.");
    return this.creativeAttachments.upload(id, user, file);
  }
  @Get("deliverables/:id/attachments/:attachmentId") @RequirePermissions("qc.view")
  async downloadCreative(@Param("id", ParseUUIDPipe) id: string, @Param("attachmentId", ParseUUIDPipe) attachmentId: string, @CurrentUser() user: AuthenticatedUser, @Res({ passthrough: true }) response: Response) {
    const result = await this.creativeAttachments.download(id, attachmentId, user);
    response.set({ "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${encodeURIComponent(result.filename)}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }); return new StreamableFile(result.stream);
  }
  @Get("reviews/:id/creative-attachments/:attachmentId") @RequirePermissions("qc.view")
  async downloadReviewCreative(@Param("id", ParseUUIDPipe) id: string, @Param("attachmentId", ParseUUIDPipe) attachmentId: string, @CurrentUser() user: AuthenticatedUser, @Res({ passthrough: true }) response: Response) {
    const review = await this.qc.review(id, user); if (!review.deliverableId) throw new NotFoundException();
    const result = await this.creativeAttachments.download(review.deliverableId, attachmentId, user, id);
    response.set({ "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${encodeURIComponent(result.filename)}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }); return new StreamableFile(result.stream);
  }
  @Get("teams-setup") @RequirePermissions("qc.view", "qc.notifications_manage") teamsSetup(@CurrentUser() user: AuthenticatedUser) { return this.teams.setup(user); }
  @Get("deliveries") @RequirePermissions("qc.view") deliveries(@Query() query: D.QcQueryDto, @CurrentUser() user: AuthenticatedUser) { return this.notifications.deliveries(user, query); }
  @Post("deliveries/:id/acknowledge") @RequirePermissions("qc.view") acknowledgeDelivery(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) { return this.notifications.acknowledge(id, user); }
  @Post("deliveries/:id/retry") @RequirePermissions("qc.view", "qc.notifications_manage") retryDelivery(@Param("id", ParseUUIDPipe) id: string, @Body() body: D.QcOverrideDto, @CurrentUser() user: AuthenticatedUser) { return this.notifications.retry(id, body.reason, user); }
  @Get("overview") @RequirePermissions("qc.view") overview(@Query() query: D.QcQueryDto, @CurrentUser() user: AuthenticatedUser) { return this.reports.overview(query, user); }
  @Get("exports/client") @RequirePermissions("qc.view", "qc.view_all", "qc.export_client") clientExport(@Query() query: D.QcQueryDto, @CurrentUser() user: AuthenticatedUser) { return this.reports.clientExport(query, user); }
  @Get("exports/internal") @RequirePermissions("qc.view", "qc.export_internal") internalExport(@Query() query: D.QcQueryDto, @CurrentUser() user: AuthenticatedUser) { return this.reports.overview(query, user); }
  @Get("settings") @RequirePermissions("qc.view", "qc.settings_manage") settings(@CurrentUser() user: AuthenticatedUser) { return this.qc.configurationResources(user); }
  @Patch("settings") @RequirePermissions("qc.view", "qc.settings_manage") saveSettings(@Body() body: D.QcProgramDto, @CurrentUser() user: AuthenticatedUser) { return this.qc.saveProgram(body, user); }
  @Get("lookups") @RequirePermissions("qc.view") lookups(@CurrentUser() user: AuthenticatedUser) { return this.qc.lookups(user); }
  @Post("categories") @RequirePermissions("qc.view", "qc.settings_manage") category(@Body() body: D.QcCategoryDto, @CurrentUser() user: AuthenticatedUser) { return this.qc.createCategory(body, user); }
  @Post("agreement-types") @RequirePermissions("qc.view", "qc.settings_manage") agreementType(@Body() body: D.QcCategoryDto, @CurrentUser() user: AuthenticatedUser) { return this.qc.createAgreementType(body, user); }
  @Post("policies") @RequirePermissions("qc.view", "qc.settings_manage") policy(@Body() body: D.QcPolicyDto, @CurrentUser() user: AuthenticatedUser) { return this.qc.createPolicy(body, user); }
  @Post("policies/:id/publish") @RequirePermissions("qc.view", "qc.settings_manage") publishPolicy(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) { return this.qc.publish("policy", id, user); }
  @Post("rubrics") @RequirePermissions("qc.view", "qc.rubrics_manage") rubric(@Body() body: D.QcRubricDto, @CurrentUser() user: AuthenticatedUser) { return this.qc.createRubric(body, user); }
  @Post("rubrics/:id/publish") @RequirePermissions("qc.view", "qc.rubrics_manage") publishRubric(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) { return this.qc.publish("rubric", id, user); }
  @Get("reviews") @RequirePermissions("qc.view") reviews(@Query() query: D.QcQueryDto, @CurrentUser() user: AuthenticatedUser) { return this.qc.listReviews(query, user); }
  @Post("reviews") @RequirePermissions("qc.view", "qc.view_all", "qc.reviews_assign") createReview(@Body() body: D.QcReviewDto, @CurrentUser() user: AuthenticatedUser) { return this.qc.createReview(body, user); }
  @Post("reviews/bulk") @RequirePermissions("qc.view", "qc.view_all", "qc.reviews_bulk") bulk(@Body() body: D.QcBulkDto, @CurrentUser() user: AuthenticatedUser) { return this.qc.bulk(body, user); }
  @Get("reviews/:id") @RequirePermissions("qc.view") review(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) { return this.qc.review(id, user); }
  @Get("reviews/:id/evidence") @RequirePermissions("qc.view") evidence(@Param("id", ParseUUIDPipe) id: string, @Query() query: D.QcQueryDto, @CurrentUser() user: AuthenticatedUser) { return this.qc.evidence(id, user, query); }
  @Get("reviews/:id/attachments/:attachmentId") @RequirePermissions("qc.view")
  async attachment(@Param("id", ParseUUIDPipe) id: string, @Param("attachmentId", ParseUUIDPipe) attachmentId: string, @CurrentUser() user: AuthenticatedUser, @Res({ passthrough: true }) response: Response) {
    const review = await this.qc.review(id, user);
    if (!review.ticketId) throw new NotFoundException("Ticket evidence is unavailable.");
    const result = await this.attachments.getDownload(review.ticketId, attachmentId, user, false);
    response.set({ "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${encodeURIComponent(result.attachment.originalFilename)}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    return new StreamableFile(result.stream);
  }
  @Get("tickets/:id/billing-eligibility") @RequirePermissions("qc.view", "qc.view_all")
  async billingEligibility(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.work.ticket(id, user);
    const holds = await this.qc.prisma.qcReview.findMany({ where: { organizationId: user.organizationId, ticketId: id, billingState: "HELD" }, select: { id: true, version: true } });
    return { ticketId: id, eligible: holds.length === 0, checkedAt: new Date(), holds };
  }
  @Patch("reviews/:id/assignment") @RequirePermissions("qc.view", "qc.view_all", "qc.reviews_assign") assign(@Param("id", ParseUUIDPipe) id: string, @Body() body: D.QcAssignDto, @CurrentUser() user: AuthenticatedUser) { return this.qc.assign(id, body, user); }
  @Post("reviews/:id/transition") @RequirePermissions("qc.view") transition(@Param("id", ParseUUIDPipe) id: string, @Body() body: D.QcTransitionDto, @CurrentUser() user: AuthenticatedUser) { return this.qc.transition(id, body, user); }
  @Post("reviews/:id/billing-release") @RequirePermissions("qc.view", "qc.view_all", "qc.billing_release") billingRelease(@Param("id", ParseUUIDPipe) id: string, @Body() body: QcBillingReleaseDto, @CurrentUser() user: AuthenticatedUser) { return this.qc.releaseBilling(id, body, user); }
  @Post("reviews/:id/score") @RequirePermissions("qc.view", "qc.view_all", "qc.reviews_perform") score(@Param("id", ParseUUIDPipe) id: string, @Body() body: D.QcScoreDto, @CurrentUser() user: AuthenticatedUser) { return this.qc.score(id, body, user); }
  @Post("findings/:id/override") @RequirePermissions("qc.view", "qc.view_all", "qc.flags_override") override(@Param("id", ParseUUIDPipe) id: string, @Body() body: D.QcOverrideDto, @CurrentUser() user: AuthenticatedUser) { return this.qc.override(id, body, user); }
  @Get("actions") @RequirePermissions("qc.view") actions(@Query() query: D.QcQueryDto, @CurrentUser() user: AuthenticatedUser) { return this.qc.actions(user, query); }
  @Post("actions") @RequirePermissions("qc.view", "qc.view_all", "qc.coaching_manage") createAction(@Body() body: D.QcActionDto, @CurrentUser() user: AuthenticatedUser) { return this.qc.createAction(body, user); }
  @Post("actions/:id/transition") @RequirePermissions("qc.view") action(@Param("id", ParseUUIDPipe) id: string, @Body() body: D.QcActionUpdateDto, @CurrentUser() user: AuthenticatedUser) { return this.qc.updateAction(id, body, user); }
  @Get("tickets") @RequirePermissions("qc.view") searchTickets(@Query() query: D.QcQueryDto, @CurrentUser() user: AuthenticatedUser) { return this.work.searchTickets(query, user); }
  @Get("tickets/:id/evidence-context") @RequirePermissions("qc.view") evidenceContext(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) { return this.sourceEvidence.context(id, user); }
  @Post("tickets/:id/rmm-link") @RequirePermissions("qc.view", "qc.work_record") rmmLink(@Param("id", ParseUUIDPipe) id: string, @Body() body: QcRmmLinkDto, @CurrentUser() user: AuthenticatedUser) { return this.sourceEvidence.link(id, body, user); }
  @Post("tickets/:id/rmm-verify") @RequirePermissions("qc.view", "qc.work_record", "remote_access.connect") rmmVerify(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) { return this.sourceEvidence.verifyRmm(id, user); }
  @Post("tickets/:id/holds") @RequirePermissions("qc.view", "qc.work_record") hold(@Param("id", ParseUUIDPipe) id: string, @Body() body: QcHoldDto, @CurrentUser() user: AuthenticatedUser) { return this.sourceEvidence.hold(id, body, user); }
  @Post("tickets/:id/holds/resume") @RequirePermissions("qc.view", "qc.work_record") resume(@Param("id", ParseUUIDPipe) id: string, @Body() body: QcResumeDto, @CurrentUser() user: AuthenticatedUser) { return this.sourceEvidence.resume(id, body, user); }
  @Get("tickets/:id") @RequirePermissions("qc.view") ticket(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) { return this.work.ticket(id, user); }
  @Patch("tickets/:id") @RequirePermissions("qc.view", "qc.work_record") profile(@Param("id", ParseUUIDPipe) id: string, @Body() body: D.QcProfileDto, @CurrentUser() user: AuthenticatedUser) { return this.work.profile(id, body, user); }
  @Post("time-entries") @RequirePermissions("qc.view", "qc.work_record") time(@Body() body: D.QcTimeDto, @CurrentUser() user: AuthenticatedUser) { return this.work.time(body, user); }
  @Get("projects/:id/evidence-options") @RequirePermissions("qc.view") creativeOptions(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) { return this.work.creativeOptions(id, user); }
  @Get("deliverables") @RequirePermissions("qc.view") deliverables(@Query() query: D.QcQueryDto, @CurrentUser() user: AuthenticatedUser) { return this.work.deliverables(query, user); }
  @Post("deliverables") @RequirePermissions("qc.view", "qc.work_record") createDeliverable(@Body() body: D.QcDeliverableDto, @CurrentUser() user: AuthenticatedUser) { return this.work.createDeliverable(body, user); }
  @Get("deliverables/:id") @RequirePermissions("qc.view") deliverable(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) { return this.work.deliverable(id, user); }
  @Patch("deliverables/:id") @RequirePermissions("qc.view", "qc.work_record") updateDeliverable(@Param("id", ParseUUIDPipe) id: string, @Body() body: D.QcDeliverableUpdateDto, @CurrentUser() user: AuthenticatedUser) { return this.work.updateDeliverable(id, body, user); }
}
