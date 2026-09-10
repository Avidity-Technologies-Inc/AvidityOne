import { ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createPublicKey, verify, JsonWebKey } from "node:crypto";
import { QcProgramConfiguration } from "@avidity/shared/dist";
import { QcDelivery } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { QcService, qcJson } from "./qc.service";
import { requireValue } from "./qc.rules";

export interface TeamsActivity {
  type?: string; channelId?: string; serviceUrl?: string; recipient?: { id?: string };
  from?: { aadObjectId?: string }; conversation?: { id?: string; conversationType?: string; tenantId?: string };
  channelData?: { tenant?: { id?: string }; team?: { id?: string }; channel?: { id?: string } };
  value?: { qcActionId?: string; note?: string; reviewerId?: string; action?: { data?: { qcActionId?: string; note?: string; reviewerId?: string } } };
}
interface ConnectorKey extends JsonWebKey { kid?: string; endorsements?: string[]; }
export function validateConnectorToken(token: string, activity: TeamsActivity, appId: string, keys: ConnectorKey[], now = Date.now()) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (header.alg !== "RS256" || typeof header.kid !== "string" || header.crit || header.typ && header.typ !== "JWT") throw new Error();
    if (claims.iss !== "https://api.botframework.com" || claims.aud !== appId || !Number.isFinite(claims.exp) || !Number.isFinite(claims.nbf) || claims.exp * 1000 <= now || claims.nbf * 1000 > now + 300_000 || claims.serviceurl !== activity.serviceUrl && claims.serviceUrl !== activity.serviceUrl) throw new Error();
    const key = keys.find(item => item.kid === header.kid && item.kty === "RSA" && (!item.use || item.use === "sig"));
    if (!key || !key.endorsements?.includes("msteams") || activity.channelId !== "msteams") throw new Error();
    if (!verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key, format: "jwk" }), Buffer.from(parts[2], "base64url"))) throw new Error();
  } catch { throw new UnauthorizedException("The Teams connector identity could not be verified."); }
}
export function teamsServiceUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || !["smba.trafficmanager.net", "smba.infra.teams.microsoft.com"].includes(url.hostname)) throw new ForbiddenException("Unsupported Teams service origin.");
  return url.toString().replace(/\/$/, "");
}
@Injectable()
export class QcTeamsService {
  private keys?: { expiresAt: number; values: ConnectorKey[] };
  constructor(private readonly qc: QcService, private readonly environment: ConfigService) {}
  private async connectorKeys() {
    if (this.keys && this.keys.expiresAt > Date.now()) return this.keys.values;
    const discovery = await fetch("https://login.botframework.com/v1/.well-known/openidconfiguration", { redirect: "error", signal: AbortSignal.timeout(10000) });
    if (!discovery.ok) throw new UnauthorizedException("Teams signing metadata is unavailable.");
    const metadata = await discovery.json() as { issuer: string; jwks_uri: string; id_token_signing_alg_values_supported: string[] };
    if (metadata.issuer !== "https://api.botframework.com" || metadata.jwks_uri !== "https://login.botframework.com/v1/.well-known/keys" || !metadata.id_token_signing_alg_values_supported.includes("RS256")) throw new UnauthorizedException("Unexpected Teams signing metadata.");
    const response = await fetch(metadata.jwks_uri, { redirect: "error", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new UnauthorizedException("Teams signing keys are unavailable.");
    const document = await response.json() as { keys: ConnectorKey[] };
    if (!Array.isArray(document.keys)) throw new UnauthorizedException();
    this.keys = { values: document.keys, expiresAt: Date.now() + 3600000 };
    return this.keys.values;
  }
  async actor(organizationId: string, objectId: string, tenantId: string): Promise<AuthenticatedUser> {
    const users = await this.qc.prisma.user.findMany({ where: { organizationId, microsoftObjectId: objectId, microsoftTenantId: tenantId, isActive: true, deletedAt: null, forcePasswordChange: false }, include: { groups: { include: { group: { include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } } } } } });
    if (users.length !== 1) throw new ForbiddenException("An active, linked internal user is required.");
    const user = users[0];
    const permissions = [...new Set(user.groups.filter(link => link.group.organizationId === organizationId).flatMap(link => link.group.roles.filter(item => item.role.organizationId === organizationId).flatMap(item => item.role.permissions.map(grant => grant.permission.name))))];
    this.qc.requirePermission({ ...user, permissions }, "qc.view");
    return { id: user.id, organizationId, email: user.email, firstName: user.firstName, lastName: user.lastName, forcePasswordChange: user.forcePasswordChange, permissions };
  }
  async receive(organizationId: string, authorization: string | undefined, activity: TeamsActivity) {
    const program = await this.qc.prisma.qcProgram.findUnique({ where: { organizationId } });
    const config = program?.configuration as unknown as QcProgramConfiguration | undefined;
    if (!config?.teamsAppId || !config.teamsTenantId || !authorization?.startsWith("Bearer ") || authorization.length > 16384) throw new UnauthorizedException();
    const token = authorization.slice(7);
    validateConnectorToken(token, activity, config.teamsAppId, await this.connectorKeys());
    requireValue(activity.serviceUrl && activity.conversation?.id && activity.conversation.id.length <= 500 && typeof activity.from?.aadObjectId === "string" && /^[0-9a-f-]{36}$/i.test(activity.from.aadObjectId), "Teams activity is incomplete.");
    const serviceUrl = teamsServiceUrl(activity.serviceUrl);
    if ((activity.channelData?.tenant?.id ?? activity.conversation.tenantId) !== config.teamsTenantId) throw new ForbiddenException("Only the configured internal tenant is allowed.");
    const user = await this.actor(organizationId, activity.from.aadObjectId, config.teamsTenantId);
    const personal = activity.conversation.conversationType === "personal";
    if (!personal && (activity.channelData?.team?.id !== config.teamsTeamId || activity.channelData?.channel?.id !== config.teamsChannelId)) throw new ForbiddenException("This Teams channel is not configured for QC.");
    if (activity.type === "conversationUpdate" || activity.type === "installationUpdate") {
      if (!personal) this.qc.requirePermission(user, "qc.notifications_manage");
      await this.qc.prisma.$transaction(async tx => {
        await tx.qcTeamsConversation.upsert({ where: { organizationId_conversationId: { organizationId, conversationId: activity.conversation!.id! } }, create: { organizationId, teamId: activity.channelData?.team?.id, channelId: activity.channelData?.channel?.id, recipientId: personal ? user.id : null, conversationId: activity.conversation!.id!, serviceUrl, botAppId: config.teamsAppId!, scope: personal ? "PERSONAL" : "CHANNEL" }, update: { serviceUrl, botAppId: config.teamsAppId!, teamId: activity.channelData?.team?.id, channelId: activity.channelData?.channel?.id } });
        await this.qc.history(tx, user, "teams_conversation_verified", { scope: personal ? "PERSONAL" : "CHANNEL" });
      });
      return { status: 200, body: { message: "QC internal conversation verified." } };
    }
    const input = activity.value?.action?.data ?? activity.value;
    requireValue(input?.qcActionId && /^[0-9a-f-]{36}$/i.test(input.qcActionId), "Choose an action from a current QC card.");
    const action = await this.qc.prisma.qcTeamsAction.findFirst({ where: { id: input.qcActionId, organizationId, recipientId: user.id, consumedAt: null, expiresAt: { gt: new Date() } }, include: { delivery: true } });
    if (!action) throw new ForbiddenException("The action expired, was already used, or belongs to another recipient.");
    requireValue(action.delivery.state === "ACCEPTED", "Only delivered cards can be acknowledged or acted on.");
    if (action.reviewId && action.verb !== "ACKNOWLEDGE") await this.qc.review(action.reviewId, user);
    if (action.verb === "ASSIGN") this.qc.requirePermission(user, "qc.reviews_assign");
    if (action.verb === "NOTE") this.qc.requirePermission(user, "qc.reviews_perform");
    // Reserve the one-time action before execution. A stale/failed action requires a fresh card.
    const reserved = await this.qc.prisma.qcTeamsAction.updateMany({ where: { id: action.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
    if (reserved.count !== 1) throw new ForbiddenException("This action was already used.");
    if (action.verb === "ACKNOWLEDGE") await this.qc.prisma.$transaction(async tx => { await tx.qcDelivery.updateMany({ where: { id: action.deliveryId, organizationId, recipientId: user.id, acknowledgedAt: null }, data: { acknowledgedAt: new Date() } }); await this.qc.history(tx, user, "notification_acknowledged", { deliveryId: action.deliveryId }, action.reviewId ?? undefined); });
    else if (action.verb === "ASSIGN") { requireValue(action.reviewId && action.version !== null && input.reviewerId && /^[0-9a-f-]{36}$/i.test(input.reviewerId), "Choose a valid reviewer."); await this.qc.assign(action.reviewId, { version: action.version, reviewerId: input.reviewerId }, user); }
    else if (action.verb === "NOTE") {
      requireValue(action.reviewId && action.version !== null && typeof input.note === "string" && input.note.trim() && input.note.length <= 5000, "Enter an inspection note.");
      await this.qc.prisma.$transaction(async tx => { const result = await tx.qcReview.updateMany({ where: { id: action.reviewId!, ...this.qc.scope(user), version: action.version! }, data: { version: { increment: 1 } } }); requireValue(result.count === 1, "Review changed. Open the current inspection."); await this.qc.history(tx, user, "review_note_added", { note: input.note!.trim() }, action.reviewId!); });
    }
    return activity.type === "invoke" ? { statusCode: 200, type: "application/vnd.microsoft.activity.message", value: "QC action recorded." } : { message: "QC action recorded." };
  }
  async setup(user: AuthenticatedUser) {
    this.qc.requirePermission(user, "qc.notifications_manage");
    const program = await this.qc.program(user), config = program.configuration;
    const appUrl = this.environment.get<string>("APP_URL");
    const conversations = await this.qc.prisma.qcTeamsConversation.findMany({ where: { organizationId: user.organizationId, botAppId: config.teamsAppId ?? "" }, select: { scope: true, recipientId: true, channelId: true, updatedAt: true } });
    return { callbackUrl: appUrl?.startsWith("https://") ? `${appUrl.replace(/\/$/, "")}/api/qc/teams/${user.organizationId}/activities` : null, credentialAvailable: Boolean(config.teamsSecretReference?.startsWith("env:") && this.environment.get<string>(config.teamsSecretReference.slice(4))), tenantConfigured: Boolean(config.teamsTenantId), appConfigured: Boolean(config.teamsAppId), conversations, externalContactsEnabled: false };
  }
  async send(delivery: QcDelivery, config: QcProgramConfiguration, appUrl: string) {
    requireValue(config.teamsAppId && config.teamsTenantId && config.teamsSecretReference?.startsWith("env:"), "Teams bot credentials are not configured.");
    const secret = this.environment.get<string>(config.teamsSecretReference!.slice(4));
    requireValue(secret, "Teams bot credential reference is unavailable.");
    const personal = delivery.channel === "TEAMS_DIRECT";
    const conversation = await this.qc.prisma.qcTeamsConversation.findFirst({ where: { organizationId: delivery.organizationId, botAppId: config.teamsAppId, scope: personal ? "PERSONAL" : "CHANNEL", recipientId: personal ? delivery.recipientId : null, ...(!personal ? { teamId: config.teamsTeamId, channelId: config.teamsChannelId } : {}) }, orderBy: { updatedAt: "desc" } });
    requireValue(conversation, "Install and verify the QC bot in the configured internal conversation.");
    const serviceUrl = teamsServiceUrl(conversation.serviceUrl);
    const access = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.teamsTenantId)}/oauth2/v2.0/token`, { method: "POST", redirect: "error", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: config.teamsAppId, client_secret: secret, scope: "https://api.botframework.com/.default" }), signal: AbortSignal.timeout(10000) });
    requireValue(access.ok, "Teams bot authentication failed.");
    const token = await access.json() as { access_token?: string };
    requireValue(token.access_token, "Teams bot token is unavailable.");
    const review = delivery.reviewId ? await this.qc.prisma.qcReview.findFirst({ where: { id: delivery.reviewId, organizationId: delivery.organizationId }, select: { id: true, version: true, owner: { select: { firstName: true, lastName: true } }, ticket: { select: { ticketNumber: true, client: { select: { name: true } } } }, deliverable: { select: { name: true, project: { select: { client: { select: { name: true } } } } } } } }) : null;
    const payload = delivery.payload as { event: string; title: string; summary?: string; actionId?: string };
    const recipient = await this.qc.prisma.user.findFirst({ where: { id: delivery.recipientId, organizationId: delivery.organizationId }, select: { microsoftObjectId: true } });
    requireValue(recipient?.microsoftObjectId, "Link the recipient to the internal Microsoft tenant.");
    const user = await this.actor(delivery.organizationId, recipient.microsoftObjectId, config.teamsTenantId);
    const reviewers = personal && user.permissions.includes("qc.reviews_assign") ? (await this.qc.lookups(user)).reviewers : [];
    const verbs = ["ACKNOWLEDGE", ...(review && personal && user.permissions.includes("qc.reviews_assign") ? ["ASSIGN"] : []), ...(review && personal && user.permissions.includes("qc.reviews_perform") ? ["NOTE"] : [])];
    const actions = await this.qc.prisma.qcTeamsAction.createManyAndReturn({ data: verbs.map(verb => ({ organizationId: delivery.organizationId, deliveryId: delivery.id, recipientId: delivery.recipientId, reviewId: review?.id, version: review?.version, verb, expiresAt: new Date(Date.now() + 86400000) })) });
    const url = `${appUrl.replace(/\/$/, "")}/qc/${payload.actionId ? "actions" : review ? `reviews/${review.id}` : ""}`;
    const facts = review && (personal || config.teamsChannelIncludeWorkDetails) ? [{ type: "FactSet", facts: [{ title: "Work", value: review.ticket?.ticketNumber ?? review.deliverable?.name ?? "QC inspection" }, { title: "Client", value: review.ticket?.client?.name ?? review.deliverable?.project.client?.name ?? "Unassigned" }, { title: "Owner", value: review.owner ? `${review.owner.firstName} ${review.owner.lastName}` : "Unassigned" }] }] : [];
    const card = { type: "AdaptiveCard", version: "1.4", body: [{ type: "TextBlock", text: payload.title, weight: "Bolder", wrap: true }, { type: "TextBlock", text: personal ? payload.summary ?? "Open QC for the current details." : "An internal quality exception needs attention. Open QC to view details permitted for your account.", wrap: true }, ...facts, ...(verbs.includes("NOTE") ? [{ type: "Input.Text", id: "note", label: "Inspection note", isMultiline: true, maxLength: 5000 }] : []), ...(verbs.includes("ASSIGN") && reviewers.length ? [{ type: "Input.ChoiceSet", id: "reviewerId", label: "Assign reviewer", choices: reviewers.map(person => ({ title: `${person.firstName} ${person.lastName}`, value: person.id })) }] : [])], actions: [{ type: "Action.OpenUrl", title: "Open QC", url }, ...actions.map(action => ({ type: "Action.Submit", title: action.verb === "ACKNOWLEDGE" ? "Acknowledge" : action.verb === "ASSIGN" ? "Assign reviewer" : "Add note", data: { qcActionId: action.id } }))] };
    const response = await fetch(`${serviceUrl}/v3/conversations/${encodeURIComponent(conversation.conversationId)}/activities`, { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: card }] }), signal: AbortSignal.timeout(15000) });
    requireValue(response.ok, `Teams delivery failed (${response.status}).`);
    const result = await response.json() as { id?: string };
    requireValue(result.id, "Teams did not return a message identifier.");
    return result.id;
  }
}
