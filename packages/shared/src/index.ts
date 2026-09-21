export const DEFAULT_APP_NAME = "Avidity IT Management Tool";

export const INITIAL_ROLES = [
  "Super Admin",
  "Admin",
  "Manager",
  "Technician",
  "Client Manager",
  "QC Reviewer",
  "Client User",
  "Auditor"
] as const;

export const INITIAL_PERMISSIONS = [
  "qc.view",
  "qc.view_all",
  "qc.reviews_perform",
  "qc.reviews_assign",
  "qc.reviews_bulk",
  "qc.rubrics_manage",
  "qc.coaching_manage",
  "qc.actions_complete_own",
  "qc.flags_override",
  "qc.settings_manage",
  "qc.notifications_manage",
  "qc.export_internal",
  "qc.export_client",
  "qc.work_record",
  "qc.billing_release",

  "users.view",
  "users.create",
  "users.update",
  "users.delete",
  "groups.view",
  "groups.create",
  "groups.update",
  "groups.delete",
  "roles.view",
  "roles.create",
  "roles.update",
  "roles.delete",
  "permissions.view",
  "clients.view",
  "clients.create",
  "clients.update",
  "clients.delete",
  "client_domains.view",
  "client_domains.create",
  "client_domains.update",
  "client_domains.delete",
  "contacts.view",
  "contacts.create",
  "contacts.update",
  "contacts.delete",
  "tickets.view",
  "tickets.create",
  "tickets.update",
  "tickets.assign",
  "tickets.reply",
  "tickets.close",
  "tickets.reopen",
  "tickets.merge",
  "tickets.delete",
  "ticket_meetings.view",
  "ticket_meetings.create",
  "ticket_meetings.update",
  "ticket_meetings.cancel",
  "ticket_statuses.view",
  "ticket_statuses.manage",
  "ticket_workflows.manage",
  "operations.view",
  "projects.view",
  "projects.create",
  "projects.update",
  "projects.delete",
  "event_services.view",
  "event_services.create",
  "event_services.update",
  "event_services.assign",
  "event_services.manage_forms",
  "event_services.delete",
  "external_specialists.view",
  "external_specialists.manage",
  "ticket_messages.view",
  "ticket_messages.create_internal",
  "ticket_messages.create_public",
  "ticket_attachments.view",
  "ticket_attachments.upload",
  "ticket_attachments.download",
  "ticket_attachments.delete",
  "mailboxes.view",
  "mailboxes.create",
  "mailboxes.update",
  "mailboxes.delete",
  "spam.view",
  "spam.manage",
  "maintenance.view",
  "maintenance.manage",
  "auto_replies.view",
  "auto_replies.create",
  "auto_replies.update",
  "auto_replies.delete",
  "signatures.view",
  "signatures.update",
  "ai_assistant.use",
  "ai_assistant.configure",
  "knowledge_base.view",
  "knowledge_base.create",
  "knowledge_base.update",
  "knowledge_base.delete",
  "knowledge_base.publish",
  "reports.view",
  "reports.export",
  "reports.manage",
  "reports.send",
  "devices.view",
  "devices.create",
  "devices.update",
  "devices.delete",
  "remote_access.view",
  "remote_access.connect",
  "remote_access.configure",
  "audit_logs.view",
  "audit_logs.export",
  "system_settings.view",
  "system_settings.update"
] as const;

export const DEFAULT_ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  "QC Reviewer": ["qc.view", "qc.view_all", "qc.reviews_perform"],
  "Super Admin": INITIAL_PERMISSIONS,
  Admin: INITIAL_PERMISSIONS,
  Manager: INITIAL_PERMISSIONS.filter(
    (permission) =>
      !permission.startsWith("qc.") &&
      !permission.startsWith("system_settings.") &&
      !permission.startsWith("mailboxes.") &&
      !permission.startsWith("maintenance.") &&
      !permission.startsWith("spam.") &&
      !permission.startsWith("roles.") &&
      permission !== "permissions.view" &&
      permission !== "audit_logs.export" &&
      permission !== "ai_assistant.configure" &&
      permission !== "ticket_statuses.manage" &&
      permission !== "ticket_workflows.manage" &&
      !["users.create", "users.update", "users.delete", "groups.create", "groups.update", "groups.delete"].includes(permission)
  ),
  Technician: INITIAL_PERMISSIONS.filter(
    (permission) =>
      permission.startsWith("tickets.") ||
      permission.startsWith("ticket_meetings.") ||
      permission === "ticket_statuses.view" ||
      permission === "operations.view" ||
      permission === "projects.view" ||
      permission.startsWith("event_services.") ||
      permission.startsWith("external_specialists.") ||
      permission.startsWith("ticket_messages.") ||
      permission.startsWith("ticket_attachments.") ||
      permission.startsWith("knowledge_base.") ||
      permission.startsWith("devices.") ||
      permission === "ai_assistant.use" ||
      permission === "clients.view" ||
      permission === "contacts.view" ||
      permission === "groups.view" ||
      permission === "users.view"
  ),
  "Client Manager": INITIAL_PERMISSIONS.filter(
    (permission) => permission.startsWith("clients.") || permission.startsWith("client_domains.") || permission.startsWith("contacts.") || permission.startsWith("tickets.") || permission === "ticket_statuses.view" || permission.startsWith("ticket_messages.")
  ),
  "Client User": ["tickets.view", "tickets.create", "ticket_statuses.view", "ticket_messages.view", "ticket_messages.create_public", "ticket_attachments.view", "ticket_attachments.upload", "ticket_attachments.download"],
  Auditor: ["tickets.view", "ticket_meetings.view", "ticket_statuses.view", "ticket_messages.view", "ticket_attachments.view", "clients.view", "contacts.view", "devices.view", "reports.view", "audit_logs.view"]
};

export const BLOCKED_ATTACHMENT_EXTENSIONS = [
  ".exe",
  ".msi",
  ".bat",
  ".cmd",
  ".ps1",
  ".vbs",
  ".js",
  ".jse",
  ".scr",
  ".com",
  ".pif",
  ".cpl",
  ".hta",
  ".reg"
] as const;

export const ALLOWED_PREVIEW_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain"
] as const;

export type InitialPermission = (typeof INITIAL_PERMISSIONS)[number];

export interface PublicBrandingSettings {
  applicationName: string;
  companyName: string;
  logoUrl: string | null;
  loginLogoUrl?: string | null;
  loginFormLogoUrl?: string | null;
  mobileLogoUrl?: string | null;
  mobileLoginLogoUrl?: string | null;
  appIconUrl?: string | null;
  loginLogoWidth?: number;
  loginLogoHeight?: number;
  loginFormLogoWidth?: number;
  loginFormLogoHeight?: number;
  brandTextSize?: number;
  brandTextColor?: string;
  brandLogoBackgroundColor?: string;
  brandLogoTransparentBackground?: boolean;
  appBrandTextSize?: number;
  appBrandTextColor?: string;
  mobileLogoWidth?: number;
  mobileLogoHeight?: number;
  mobileBrandTextSize?: number;
  mobileBrandTextColor?: string;
  mobileLoginLogoWidth?: number;
  mobileLoginLogoHeight?: number;
  mobileLoginBrandTextSize?: number;
  mobileLoginBrandTextColor?: string;
  brandFontFamily?: string;
  appSubtitle?: string | null;
  showLoginBrandTitle?: boolean;
  showSubtitleOnLogin?: boolean;
  showSubtitleInApp?: boolean;
  subtitlePlacement?: string;
  mobileSubtitlePlacement?: string;
  subtitleSize?: number;
  subtitleColor?: string;
  subtitleWeight?: string;
  subtitleStyle?: string;
  subtitleFontFamily?: string;
  primaryColor: string;
  secondaryColor: string;
  supportEmail: string;
  supportButtonEnabled?: boolean;
  supportButtonLabel?: string;
  supportButtonUrl?: string | null;
  defaultLandingPage?: string;
  defaultTimezone?: string;
  defaultLanguage?: string;
  dateFormat?: string;
  timeFormat?: string;
  loginHeadline?: string;
  loginSubtitle?: string;
  loginFooterText?: string;
  loginHeadlineSize?: number;
  loginHeadlineColor?: string;
  loginHeadlineWeight?: string;
  loginHeadlineStyle?: string;
  loginHeadlineFontFamily?: string;
  loginSubtitleSize?: number;
  loginSubtitleColor?: string;
  loginSubtitleWeight?: string;
  loginSubtitleStyle?: string;
  loginSubtitleAlign?: string;
  loginSubtitleFontFamily?: string;
  loginFooterSize?: number;
  loginFooterColor?: string;
  loginFooterWeight?: string;
  loginFooterStyle?: string;
  loginFooterFontFamily?: string;
}

export * from "./qc";

export * from "./reports";
