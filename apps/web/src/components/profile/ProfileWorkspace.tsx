"use client";
import { QcContextLink } from "@/components/qc/QcContextLink";

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Eye,
  Italic,
  KeyRound,
  Link,
  List,
  ListOrdered,
  Mail,
  PenLine,
  Redo2,
  RemoveFormatting,
  Save,
  SunMoon,
  Strikethrough,
  Underline,
  Undo2,
  UserRound
} from "lucide-react";
import { ClipboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { apiFetch } from "@/lib/api";
import { ThemePreference, useTheme } from "@/components/providers/ThemeProvider";

type ProfileSection = "account" | "password" | "appearance" | "notifications" | "signature";

interface ProfileUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  forcePasswordChange: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  groups: Array<{
    group: {
      id: string;
      name: string;
      roles: Array<{ role: { id: string; name: string } }>;
    };
  }>;
}

interface NotificationPreference {
  inAppEnabled: boolean;
  emailEnabled: boolean;
  ticketAssignedToMe: boolean;
  ticketAssignedToMyTeam: boolean;
  ticketReplyOnAssignedTicket: boolean;
  internalNoteOnAssignedTicket: boolean;
  internalNoteMention: boolean;
  routingRuleMatched: boolean;
  ticketReopened: boolean;
  newTicketCreated: boolean;
  inAppTicketAssignedToMe: boolean;
  inAppTicketAssignedToMyTeam: boolean;
  inAppTicketReplyOnAssignedTicket: boolean;
  inAppInternalNoteOnAssignedTicket: boolean;
  inAppInternalNoteMention: boolean;
  inAppRoutingRuleMatched: boolean;
  inAppTicketReopened: boolean;
  inAppNewTicketCreated: boolean;
  emailTicketAssignedToMe: boolean;
  emailTicketAssignedToMyTeam: boolean;
  emailTicketReplyOnAssignedTicket: boolean;
  emailInternalNoteOnAssignedTicket: boolean;
  emailInternalNoteMention: boolean;
  emailRoutingRuleMatched: boolean;
  emailTicketReopened: boolean;
  emailNewTicketCreated: boolean;
  inAppEventAssignedToMe: boolean;
  inAppEventRequestUpdated: boolean;
  inAppEventTaskAssignedToMe: boolean;
  inAppEventTaskUpdated: boolean;
  inAppEventCommentAdded: boolean;
  emailEventAssignedToMe: boolean;
  emailEventRequestUpdated: boolean;
  emailEventTaskAssignedToMe: boolean;
  emailEventTaskUpdated: boolean;
  emailEventCommentAdded: boolean;
  inAppNewEventRequestCreated: boolean;
  emailNewEventRequestCreated: boolean;
  dailyDigestEnabled: boolean;
}

interface UserSignature {
  htmlSignature: string;
  plainTextSignature: string;
  useSignatureByDefault: boolean;
}

interface ProfileResponse {
  user: ProfileUser;
  notificationPreference: NotificationPreference;
  signature: UserSignature;
}

const TICKET_NOTIFICATION_FIELDS: Array<{ label: string; inAppKey: keyof NotificationPreference; emailKey: keyof NotificationPreference }> = [
  { label: "New ticket created", inAppKey: "inAppNewTicketCreated", emailKey: "emailNewTicketCreated" },
  { label: "Assigned to me", inAppKey: "inAppTicketAssignedToMe", emailKey: "emailTicketAssignedToMe" },
  { label: "Assigned to my team", inAppKey: "inAppTicketAssignedToMyTeam", emailKey: "emailTicketAssignedToMyTeam" },
  { label: "Reply on assigned ticket", inAppKey: "inAppTicketReplyOnAssignedTicket", emailKey: "emailTicketReplyOnAssignedTicket" },
  { label: "Internal note on assigned ticket", inAppKey: "inAppInternalNoteOnAssignedTicket", emailKey: "emailInternalNoteOnAssignedTicket" },
  { label: "Mentioned on internal note", inAppKey: "inAppInternalNoteMention", emailKey: "emailInternalNoteMention" },
  { label: "Routing rule matched", inAppKey: "inAppRoutingRuleMatched", emailKey: "emailRoutingRuleMatched" },
  { label: "Ticket reopened", inAppKey: "inAppTicketReopened", emailKey: "emailTicketReopened" }
];

const EVENT_NOTIFICATION_FIELDS: Array<{ label: string; inAppKey: keyof NotificationPreference; emailKey: keyof NotificationPreference }> = [
  { label: "New event request created", inAppKey: "inAppNewEventRequestCreated", emailKey: "emailNewEventRequestCreated" },
  { label: "Event assigned to me", inAppKey: "inAppEventAssignedToMe", emailKey: "emailEventAssignedToMe" },
  { label: "Event request updated", inAppKey: "inAppEventRequestUpdated", emailKey: "emailEventRequestUpdated" },
  { label: "Event task assigned to me", inAppKey: "inAppEventTaskAssignedToMe", emailKey: "emailEventTaskAssignedToMe" },
  { label: "Event task updated", inAppKey: "inAppEventTaskUpdated", emailKey: "emailEventTaskUpdated" },
  { label: "Event comment added", inAppKey: "inAppEventCommentAdded", emailKey: "emailEventCommentAdded" }
];

const SECTIONS: Array<{ key: ProfileSection; label: string; icon: typeof UserRound }> = [
  { key: "account", label: "Account", icon: UserRound },
  { key: "password", label: "Password", icon: KeyRound },
  { key: "appearance", label: "Appearance", icon: SunMoon },
  { key: "notifications", label: "Notifications", icon: Mail },
  { key: "signature", label: "Signature", icon: PenLine }
];

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string; description: string }> = [
  { value: "light", label: "Light", description: "Use the standard bright interface." },
  { value: "dark", label: "Dark", description: "Use a darker interface for low-light work." },
  { value: "oled", label: "OLED Dark", description: "Use true black surfaces with high-contrast content." },
  { value: "system", label: "System", description: "Follow your operating system setting." }
];

function notificationPreferencePayload(preference: NotificationPreference): NotificationPreference {
  return {
    inAppEnabled: preference.inAppEnabled,
    emailEnabled: preference.emailEnabled,
    ticketAssignedToMe: preference.ticketAssignedToMe,
    ticketAssignedToMyTeam: preference.ticketAssignedToMyTeam,
    ticketReplyOnAssignedTicket: preference.ticketReplyOnAssignedTicket,
    internalNoteOnAssignedTicket: preference.internalNoteOnAssignedTicket,
    internalNoteMention: preference.internalNoteMention,
    routingRuleMatched: preference.routingRuleMatched,
    ticketReopened: preference.ticketReopened,
    newTicketCreated: preference.newTicketCreated,
    inAppTicketAssignedToMe: preference.inAppTicketAssignedToMe,
    inAppTicketAssignedToMyTeam: preference.inAppTicketAssignedToMyTeam,
    inAppTicketReplyOnAssignedTicket: preference.inAppTicketReplyOnAssignedTicket,
    inAppInternalNoteOnAssignedTicket: preference.inAppInternalNoteOnAssignedTicket,
    inAppInternalNoteMention: preference.inAppInternalNoteMention,
    inAppRoutingRuleMatched: preference.inAppRoutingRuleMatched,
    inAppTicketReopened: preference.inAppTicketReopened,
    inAppNewTicketCreated: preference.inAppNewTicketCreated,
    emailTicketAssignedToMe: preference.emailTicketAssignedToMe,
    emailTicketAssignedToMyTeam: preference.emailTicketAssignedToMyTeam,
    emailTicketReplyOnAssignedTicket: preference.emailTicketReplyOnAssignedTicket,
    emailInternalNoteOnAssignedTicket: preference.emailInternalNoteOnAssignedTicket,
    emailInternalNoteMention: preference.emailInternalNoteMention,
    emailRoutingRuleMatched: preference.emailRoutingRuleMatched,
    emailTicketReopened: preference.emailTicketReopened,
    emailNewTicketCreated: preference.emailNewTicketCreated,
    inAppEventAssignedToMe: preference.inAppEventAssignedToMe,
    inAppEventRequestUpdated: preference.inAppEventRequestUpdated,
    inAppEventTaskAssignedToMe: preference.inAppEventTaskAssignedToMe,
    inAppEventTaskUpdated: preference.inAppEventTaskUpdated,
    inAppEventCommentAdded: preference.inAppEventCommentAdded,
    emailEventAssignedToMe: preference.emailEventAssignedToMe,
    emailEventRequestUpdated: preference.emailEventRequestUpdated,
    emailEventTaskAssignedToMe: preference.emailEventTaskAssignedToMe,
    emailEventTaskUpdated: preference.emailEventTaskUpdated,
    emailEventCommentAdded: preference.emailEventCommentAdded,
    inAppNewEventRequestCreated: preference.inAppNewEventRequestCreated,
    emailNewEventRequestCreated: preference.emailNewEventRequestCreated,
    dailyDigestEnabled: preference.dailyDigestEnabled
  };
}

function hasEnabledEmailEvents(preference: NotificationPreference) {
  return (
    preference.dailyDigestEnabled ||
    TICKET_NOTIFICATION_FIELDS.some((field) => Boolean(preference[field.emailKey])) ||
    EVENT_NOTIFICATION_FIELDS.some((field) => Boolean(preference[field.emailKey]))
  );
}

function NotificationSwitch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      className={`notification-switch ${checked ? "is-on" : ""}`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function ProfileNotificationPreferenceGroup({
  title,
  preference,
  fields,
  onChange
}: {
  title: string;
  preference: NotificationPreference;
  fields: Array<{ label: string; inAppKey: keyof NotificationPreference; emailKey: keyof NotificationPreference }>;
  onChange: (key: keyof NotificationPreference, value: boolean) => void;
}) {
  return (
    <div className="notification-preference-group">
      <div className="notification-group-title">
        <h3>{title}</h3>
        <div>
          <span>In-app</span>
          <span>Email</span>
        </div>
      </div>
      <div className="notification-preference-header">
        <span>Notification</span>
        <span>In-app</span>
        <span>Email</span>
      </div>
      {fields.map((field) => (
        <div className="notification-preference-row" key={field.label}>
          <span>{field.label}</span>
          <NotificationSwitch checked={Boolean(preference[field.inAppKey])} onChange={(value) => onChange(field.inAppKey, value)} label={`${field.label} in-app`} />
          <NotificationSwitch checked={Boolean(preference[field.emailKey])} onChange={(value) => onChange(field.emailKey, value)} label={`${field.label} email`} />
        </div>
      ))}
    </div>
  );
}

const SIGNATURE_TOOLBAR = [
  { label: "Undo", icon: Undo2, command: "undo" },
  { label: "Redo", icon: Redo2, command: "redo" },
  { label: "Bold", icon: Bold, command: "bold" },
  { label: "Italic", icon: Italic, command: "italic" },
  { label: "Underline", icon: Underline, command: "underline" },
  { label: "Strikethrough", icon: Strikethrough, command: "strikeThrough" },
  { label: "Ordered list", icon: ListOrdered, command: "insertOrderedList" },
  { label: "Unordered list", icon: List, command: "insertUnorderedList" },
  { label: "Align left", icon: AlignLeft, command: "justifyLeft" },
  { label: "Align center", icon: AlignCenter, command: "justifyCenter" },
  { label: "Align right", icon: AlignRight, command: "justifyRight" },
  { label: "Remove formatting", icon: RemoveFormatting, command: "removeFormat" }
] as const;

export function ProfileWorkspace() {
  const { theme, setTheme } = useTheme();
  const [activeSection, setActiveSection] = useState<ProfileSection>("account");
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mfaPassword, setMfaPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaSetup, setMfaSetup] = useState<{ setupToken: string; secret: string; otpauthUrl: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [notificationDraft, setNotificationDraft] = useState<NotificationPreference | null>(null);
  const [signatureHtml, setSignatureHtml] = useState("");
  const [useSignatureByDefault, setUseSignatureByDefault] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const signatureEditorRef = useRef<HTMLDivElement>(null);
  const signatureDirtyRef = useRef(false);

  useEffect(() => {
    void loadProfile();
  }, []);

  async function loadProfile() {
    setError(null);
    const response = await apiFetch<ProfileResponse>("/profile");
    setProfile(response);
    setFirstName(response.user.firstName);
    setLastName(response.user.lastName);
    setNotificationDraft(response.notificationPreference);
    syncSignatureEditor(response.signature.htmlSignature);
    setUseSignatureByDefault(response.signature.useSignatureByDefault);
  }

  const roles = useMemo(() => {
    const names = new Set<string>();
    profile?.user.groups.forEach((membership) => {
      membership.group.roles.forEach((roleMembership) => names.add(roleMembership.role.name));
    });
    return [...names];
  }, [profile?.user.groups]);
  const groupCount = profile?.user.groups.length ?? 0;
  const signatureStatus = signatureHtml.trim() ? "Configured" : "Not set";

  async function saveAccount() {
    setBusy("account");
    setError(null);
    setMessage(null);
    try {
      await apiFetch("/profile", {
        method: "PATCH",
        body: JSON.stringify({ firstName, lastName })
      });
      setMessage("Profile information saved.");
      await loadProfile();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save profile information.");
    } finally {
      setBusy(null);
    }
  }

  async function savePassword() {
    setBusy("password");
    setError(null);
    setMessage(null);
    try {
      if (newPassword !== confirmPassword) {
        throw new Error("The new password confirmation does not match.");
      }
      await apiFetch("/profile/password", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword })
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("Password changed.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to change password.");
    } finally {
      setBusy(null);
    }
  }

  async function startMfaSetup() {
    setBusy("mfa");
    setError(null);
    setMessage(null);
    setRecoveryCodes([]);
    try {
      const response = await apiFetch<{ setupToken: string; secret: string; otpauthUrl: string }>("/profile/mfa/setup", {
        method: "POST",
        body: JSON.stringify({ currentPassword: mfaPassword })
      });
      setMfaSetup(response);
      setMessage("Enter this setup key in your authenticator app, then confirm the 6-digit code.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start MFA setup.");
    } finally {
      setBusy(null);
    }
  }

  async function confirmMfaSetup() {
    if (!mfaSetup) return;
    setBusy("mfa");
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch<{ enabled: boolean; recoveryCodes: string[] }>("/profile/mfa/confirm", {
        method: "POST",
        body: JSON.stringify({ setupToken: mfaSetup.setupToken, code: mfaCode })
      });
      setRecoveryCodes(response.recoveryCodes);
      setMfaSetup(null);
      setMfaPassword("");
      setMfaCode("");
      setMessage("Two-factor authentication enabled. Store your recovery codes securely.");
      await loadProfile();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to confirm MFA setup.");
    } finally {
      setBusy(null);
    }
  }

  async function disableMfa() {
    if (!window.confirm("Disable two-factor authentication for your account?")) {
      return;
    }
    setBusy("mfa");
    setError(null);
    setMessage(null);
    try {
      await apiFetch("/profile/mfa/disable", {
        method: "POST",
        body: JSON.stringify({ currentPassword: mfaPassword, code: mfaCode || undefined })
      });
      setMfaPassword("");
      setMfaCode("");
      setMfaSetup(null);
      setRecoveryCodes([]);
      setMessage("Two-factor authentication disabled.");
      await loadProfile();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to disable MFA.");
    } finally {
      setBusy(null);
    }
  }

  async function saveNotifications() {
    if (!notificationDraft) {
      return;
    }
    setBusy("notifications");
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch<NotificationPreference>("/notification-preferences/me", {
        method: "PATCH",
        body: JSON.stringify(notificationPreferencePayload(notificationDraft))
      });
      setNotificationDraft(response);
      setMessage("Notification preferences saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save notification preferences.");
    } finally {
      setBusy(null);
    }
  }

  async function saveSignature() {
    const htmlSignature = signatureEditorRef.current?.innerHTML ?? signatureHtml;
    setBusy("signature");
    setError(null);
    setMessage(null);
    try {
      const response = await apiFetch<UserSignature>("/profile/signature", {
        method: "PATCH",
        body: JSON.stringify({ htmlSignature, useSignatureByDefault })
      });
      syncSignatureEditor(response.htmlSignature);
      setUseSignatureByDefault(response.useSignatureByDefault);
      setMessage("Signature saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save signature.");
    } finally {
      setBusy(null);
    }
  }

  function updateNotificationDraft(key: keyof NotificationPreference, value: boolean) {
    setNotificationDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  function syncSignatureEditor(html: string) {
    signatureDirtyRef.current = false;
    setSignatureHtml(html);
    if (signatureEditorRef.current) {
      signatureEditorRef.current.innerHTML = html;
    }
  }

  function updateSignatureDraft(html: string) {
    signatureDirtyRef.current = true;
    setSignatureHtml(html);
  }

  function runSignatureCommand(command: string, value?: string) {
    signatureEditorRef.current?.focus();
    document.execCommand(command, false, value);
    updateSignatureDraft(signatureEditorRef.current?.innerHTML ?? signatureHtml);
  }

  function setSignatureBlock(value: string) {
    if (!value) {
      return;
    }
    runSignatureCommand("formatBlock", value);
  }

  function setSignatureFontSize(value: string) {
    if (!value) {
      return;
    }
    runSignatureCommand("fontSize", value);
  }

  function addSignatureLink() {
    const href = window.prompt("Link URL");
    if (!href) {
      return;
    }
    runSignatureCommand("createLink", href);
  }

  function handleSignaturePaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    const pasted = html ? normalizePastedSignatureHtml(html) : escapeHtml(text).replace(/\n/g, "<br>");
    document.execCommand("insertHTML", false, pasted);
    updateSignatureDraft(signatureEditorRef.current?.innerHTML ?? signatureHtml);
  }

  useEffect(() => {
    if (activeSection === "signature" && signatureEditorRef.current && !signatureDirtyRef.current) {
      signatureEditorRef.current.innerHTML = signatureHtml;
    }
  }, [activeSection, signatureHtml]);

  const emailEventsBlocked = notificationDraft ? !notificationDraft.emailEnabled && hasEnabledEmailEvents(notificationDraft) : false;
  const assignmentEmailReady = notificationDraft ? notificationDraft.emailEnabled && notificationDraft.emailTicketAssignedToMe : false;

  return (
    <div className="stack profile-page">
      <div className="compact-page-header profile-page-header">
        <div>
          <span className="page-eyebrow">Account Preferences</span>
          <h1>Profile</h1><QcContextLink href="/qc/scorecards?scope=mine" label="My quality scorecard" />
          <p className="muted">Manage your account information, security, appearance, notifications, and ticket reply signature.</p>
        </div>
      </div>

      {message ? <div className="success-banner">{message}</div> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      <section className="profile-summary-grid" aria-label="Profile summary">
        <div className="profile-summary-card">
          <span>Account</span>
          <strong>{profile ? `${profile.user.firstName} ${profile.user.lastName}`.trim() || profile.user.email : "Loading"}</strong>
          <small>{profile?.user.email ?? "Preparing account details"}</small>
        </div>
        <div className="profile-summary-card">
          <span>Access</span>
          <strong>{roles.length || groupCount}</strong>
          <small>{roles.length ? "Assigned roles" : "Group memberships"}</small>
        </div>
        <div className="profile-summary-card">
          <span>Security</span>
          <strong>{profile?.user.mfaEnabled ? "2FA on" : "2FA off"}</strong>
          <small>{profile?.user.lastLoginAt ? `Last login ${new Date(profile.user.lastLoginAt).toLocaleDateString()}` : "No recent login recorded"}</small>
        </div>
        <div className="profile-summary-card">
          <span>Signature</span>
          <strong>{signatureStatus}</strong>
          <small>{useSignatureByDefault ? "Used by default" : "Manual use only"}</small>
        </div>
      </section>

      <div className="settings-layout profile-layout">
        <aside className="settings-nav profile-nav" aria-label="Profile sections">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.key}
                className={activeSection === section.key ? "active" : ""}
                type="button"
                onClick={() => setActiveSection(section.key)}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{section.label}</span>
              </button>
            );
          })}
        </aside>

        <div className="settings-content profile-content">
          {activeSection === "account" ? (
            <section className="panel profile-panel">
              <div className="section-heading">
                <div>
                  <h2>Account Information</h2>
                  <p className="muted">Your email address is managed by an administrator.</p>
                </div>
              </div>
              <div className="profile-form-grid">
                <label>
                  First name
                  <input className="input" value={firstName} onChange={(event) => setFirstName(event.target.value)} />
                </label>
                <label>
                  Last name
                  <input className="input" value={lastName} onChange={(event) => setLastName(event.target.value)} />
                </label>
                <label>
                  Email
                  <input className="input" value={profile?.user.email ?? ""} disabled />
                </label>
                <label>
                  Roles
                  <input className="input" value={roles.length ? roles.join(", ") : "No roles assigned"} disabled />
                </label>
              </div>
              <div className="settings-actions">
                <button className="button" type="button" onClick={saveAccount} disabled={busy === "account"}>
                  <Save size={16} aria-hidden="true" />
                  <span>Save Account</span>
                </button>
              </div>
            </section>
          ) : null}

          {activeSection === "password" ? (
            <section className="panel profile-panel">
              <div className="section-heading">
                <div>
                  <h2>Password & Security</h2>
                  <p className="muted">Change your password without exposing the plain text value.</p>
                </div>
              </div>
              <div className="profile-form-grid">
                <label>
                  Current password
                  <input className="input" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
                </label>
                <span />
                <label>
                  New password
                  <input className="input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                </label>
                <label>
                  Confirm new password
                  <input className="input" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
                </label>
              </div>
              <p className="muted settings-section">Use at least 12 characters.</p>
              <div className="settings-actions">
                <button className="button" type="button" onClick={savePassword} disabled={busy === "password"}>
                  <KeyRound size={16} aria-hidden="true" />
                  <span>Change Password</span>
                </button>
              </div>
              <div className="panel subtle-panel settings-section">
                <div className="section-heading">
                  <div>
                    <h3>Two-Factor Authentication</h3>
                    <p className="muted">Enable 2FA with Google Authenticator, Microsoft Authenticator, or any compatible authenticator app.</p>
                  </div>
                  <span className={`status-pill ${profile?.user.mfaEnabled ? "success" : "muted-pill"}`}>{profile?.user.mfaEnabled ? "Enabled" : "Disabled"}</span>
                </div>
                <div className="profile-form-grid">
                  <label>
                    Current password
                    <input className="input" type="password" value={mfaPassword} onChange={(event) => setMfaPassword(event.target.value)} />
                  </label>
                  <label>
                    {profile?.user.mfaEnabled ? "Authenticator or recovery code" : "Authenticator code"}
                    <input className="input" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} placeholder={profile?.user.mfaEnabled ? "Required to disable 2FA" : "Enter 6-digit setup code"} />
                  </label>
                </div>
                {mfaSetup ? (
                  <div className="settings-section stack">
                    <div className="mfa-qr-panel">
                      <div className="mfa-qr-frame" aria-label="Authenticator app QR code">
                        <QRCodeSVG value={mfaSetup.otpauthUrl} size={192} level="M" includeMargin />
                      </div>
                      <div className="mfa-qr-copy">
                        <strong>Scan QR code</strong>
                        <p className="muted">
                          Scan this code with Google Authenticator, Microsoft Authenticator, or another compatible authenticator app.
                        </p>
                      </div>
                    </div>
                    <div className="security-code-box">
                      <strong>Setup key</strong>
                      <code>{mfaSetup.secret}</code>
                    </div>
                    <details className="security-code-box">
                      <summary>Show manual authenticator URL</summary>
                      <code>{mfaSetup.otpauthUrl}</code>
                    </details>
                    <button className="button" type="button" onClick={confirmMfaSetup} disabled={busy === "mfa" || !mfaCode}>
                      Confirm and Enable 2FA
                    </button>
                  </div>
                ) : null}
                {recoveryCodes.length > 0 ? (
                  <div className="settings-section security-code-box">
                    <strong>Recovery codes</strong>
                    {recoveryCodes.map((code) => <code key={code}>{code}</code>)}
                  </div>
                ) : null}
                <div className="settings-actions settings-section">
                  {profile?.user.mfaEnabled ? (
                    <button className="button danger" type="button" onClick={disableMfa} disabled={busy === "mfa"}>
                      Disable 2FA
                    </button>
                  ) : (
                    <button className="button secondary" type="button" onClick={startMfaSetup} disabled={busy === "mfa" || !mfaPassword}>
                      Enable 2FA
                    </button>
                  )}
                </div>
              </div>
            </section>
          ) : null}

          {activeSection === "appearance" ? (
            <section className="panel profile-panel">
              <div className="section-heading">
                <div>
                  <h2>Appearance</h2>
                  <p className="muted">Choose how the application theme is displayed on this device.</p>
                </div>
              </div>
              <div className="profile-card-grid">
                {THEME_OPTIONS.map((option) => (
                  <label className="profile-toggle-card" key={option.value}>
                    <input type="radio" name="theme" checked={theme === option.value} onChange={() => setTheme(option.value)} />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                  </label>
                ))}
              </div>
            </section>
          ) : null}

          {activeSection === "notifications" && notificationDraft ? (
            <section className="panel profile-panel">
              <div className="section-heading">
                <div>
                  <h2>Notifications</h2>
                  <p className="muted">Choose which ticket and Event Services notifications can reach you.</p>
                </div>
                <span className={`status-pill ${assignmentEmailReady ? "success" : "warning-pill"}`}>
                  {assignmentEmailReady ? "Assignment email ready" : "Assignment email off"}
                </span>
              </div>
              {emailEventsBlocked ? (
                <div className="notification-warning-banner settings-section" role="status">
                  Email delivery is turned off. Email-specific notification switches are saved, but they will not send until the Email channel is enabled.
                </div>
              ) : null}
              <div className="notification-channel-strip settings-section">
                <div className="notification-channel-item">
                  <span>In-app</span>
                  <NotificationSwitch checked={notificationDraft.inAppEnabled} onChange={(value) => updateNotificationDraft("inAppEnabled", value)} label="In-app notification channel" />
                </div>
                <div className="notification-channel-item">
                  <span>Email</span>
                  <NotificationSwitch checked={notificationDraft.emailEnabled} onChange={(value) => updateNotificationDraft("emailEnabled", value)} label="Email notification channel" />
                </div>
                <div className="notification-channel-item">
                  <span>Daily digest</span>
                  <NotificationSwitch checked={notificationDraft.dailyDigestEnabled} onChange={(value) => updateNotificationDraft("dailyDigestEnabled", value)} label="Daily digest preference" />
                </div>
              </div>
              <div className="notification-user-grid">
                <ProfileNotificationPreferenceGroup title="Ticket Notifications" preference={notificationDraft} fields={TICKET_NOTIFICATION_FIELDS} onChange={updateNotificationDraft} />
                <ProfileNotificationPreferenceGroup title="Event Service Notifications" preference={notificationDraft} fields={EVENT_NOTIFICATION_FIELDS} onChange={updateNotificationDraft} />
              </div>
              <div className="settings-actions">
                <button className="button" type="button" onClick={saveNotifications} disabled={busy === "notifications"}>
                  <Save size={16} aria-hidden="true" />
                  <span>Save Notifications</span>
                </button>
              </div>
            </section>
          ) : null}

          {activeSection === "signature" ? (
            <section className="panel profile-panel">
              <div className="section-heading">
                <div>
                  <h2>Ticket Reply Signature</h2>
                  <p className="muted">Safe HTML is allowed. Scripts, unsafe URLs, and unsupported tags are removed when saved.</p>
                </div>
              </div>
              <div className="editor-toolbar signature-toolbar" aria-label="Signature tools">
                <select className="editor-select" aria-label="Signature block style" defaultValue="" onChange={(event) => setSignatureBlock(event.target.value)}>
                  <option value="">Paragraph</option>
                  <option value="h3">Heading</option>
                  <option value="blockquote">Quote</option>
                  <option value="pre">Code block</option>
                </select>
                <select className="editor-select" aria-label="Signature text size" defaultValue="" onChange={(event) => setSignatureFontSize(event.target.value)}>
                  <option value="">Size</option>
                  <option value="1">Small</option>
                  <option value="3">Normal</option>
                  <option value="5">Large</option>
                </select>
                {SIGNATURE_TOOLBAR.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      className="icon-button"
                      type="button"
                      title={item.label}
                      aria-label={item.label}
                      key={item.label}
                      onClick={() => runSignatureCommand(item.command)}
                    >
                      <Icon size={17} aria-hidden="true" />
                    </button>
                  );
                })}
                <button className="icon-button" type="button" title="Link" aria-label="Link" onClick={addSignatureLink}>
                  <Link size={17} aria-hidden="true" />
                </button>
              </div>
              <div
                ref={signatureEditorRef}
                className="input editor-surface signature-editor signature-render"
                contentEditable
                dir="ltr"
                suppressContentEditableWarning
                onInput={(event) => updateSignatureDraft(event.currentTarget.innerHTML)}
                onPaste={handleSignaturePaste}
              />
              <label className="profile-check-card settings-section profile-digest-row">
                <input type="checkbox" checked={useSignatureByDefault} onChange={(event) => setUseSignatureByDefault(event.target.checked)} />
                <span>Use this signature by default for ticket replies</span>
              </label>
              <div className="panel subtle-panel signature-preview-panel settings-section">
                <h3>
                  <Eye size={16} aria-hidden="true" />
                  Preview
                </h3>
                {signatureHtml.trim() ? <div className="message-body signature-render" dangerouslySetInnerHTML={{ __html: signatureHtml }} /> : <p className="muted">No signature configured.</p>}
              </div>
              <div className="settings-actions">
                <button className="button" type="button" onClick={saveSignature} disabled={busy === "signature"}>
                  <Save size={16} aria-hidden="true" />
                  <span>Save Signature</span>
                </button>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function normalizePastedSignatureHtml(html: string) {
  return html
    .replace(/\sdir=(["'])(rtl|auto)\1/gi, "")
    .replace(/direction\s*:\s*rtl\s*;?/gi, "")
    .replace(/unicode-bidi\s*:\s*[^;"']+;?/gi, "");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
