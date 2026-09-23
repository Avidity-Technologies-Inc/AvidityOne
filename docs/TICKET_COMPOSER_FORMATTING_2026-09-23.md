# Ticket composer formatting and preferences

## Scope

The ticket editor now offers safe clipboard modes, explicit text formatting, editable links and account-backed preferences. Existing signatures, ticket messages, attachments, CC recipients, mail threading and status workflows are retained. Historical messages are not rewritten.

- **Match message** is the default paste mode: remove foreign colors/backgrounds/fonts while retaining paragraphs, lists, tables, emphasis and safe links.
- **Keep source format** retains supported safe inline styles. It does not import active content or arbitrary remote images. Clipboard image files still upload as private ticket attachments; failed uploads are reported. Remote images without clipboard files require explicit attachment.
- **Plain text only**, or Ctrl/Cmd+Shift+V, inserts literal text without source HTML.
- **Format & paste** exposes font, 10–32 px size, text color, highlight, alignment and paste mode. Existing lists/emphasis tools remain. Link opens an editor for display text/address, editing/removal and Ctrl/Cmd+K. HTTP(S) and mailto links are allowed. Native undo/redo remain available; browsers can group adjacent editing operations.
- The email canvas stays white, including dark application themes, so deliberate message colors and signature styling remain visible.
- **Settings > Ticket Composer** controls organization defaults using existing `system_settings.view/update` permissions. Organization changes are audited. **Profile > Ticket Writing** controls personal overrides, paste mode and reading zoom; changes autosave with error/retry feedback and a restore-defaults action. Personal formatting overrides can be disabled by policy without deleting them. This governs starting defaults, not an enforced restriction on formatting individual selections.
- Reading zoom affects only the composer view. Outgoing HTML contains actual font/size/color/line-spacing defaults and selected formatting; zoom is never serialized into a message. Signature markup remains separate.
- AI rewrite/grammar/paraphrase results appear for review before applying. Protected links/images are represented by immutable markers and restored locally; a missing marker rejects the suggestion. Signatures are excluded. Changes made while awaiting a suggestion invalidate it, preventing draft overwrite. Applied suggestions have an explicit undo action and never send mail automatically.

## Persistence and compatibility

Migration `20260923190000_composer_preferences` adds JSONB columns with empty-object defaults to `system_settings` and `users`. Unset values inherit application/organization defaults. Updates are scoped to the authenticated organization/account, validate allowed keys and values, and merge under serializable transactions with bounded conflict retries. No dependencies, provider permissions, existing notification settings or environment values change.

The default font list is an intentionally limited email-compatible catalog, not sample customer data. Available fonts depend on the recipient's installed fonts and mail client. No hosted font service is introduced; clipboard remote images are not imported automatically. Existing signature images retain their established handling.

## Validation

- API and web TypeScript checks and production builds passed for shared packages, API and web.
- 234 API tests in 41 suites passed (28 separate QC/activity database cases skipped). Suites include composer validation/inheritance/policy/isolation and concurrent persistence against disposable PostgreSQL, plus existing ticket/mail/threading/attachment regressions. Separate QC/activity database suites remain outside this validation target.
- 69 distinct browser checks passed across Chromium, Firefox and WebKit (24 formatting, 30 editor-content and 15 layout checks): clipboard filtering, safe links, selected sizing, outgoing HTML, autosave failures/retry/reset, AI integrity/stale results/undo, signature preservation, existing line spacing, many attachments, pinned composer controls and small screens.
- Two isolated deployment tests (five scenarios) passed and exercise success and failures during backup, migration, build and health checks, restoring both dependent services/runtimes without changing configuration.
- The independent MIME parser regression passed. One existing pinned-scroll assertion timed out in a parallel run; the complete 15-check layout suite subsequently passed sequentially without changing its assertions.
- No real customer mail is sent during automated validation. User acceptance includes actual Outlook rendering and AI provider output.

## Deployment

From reviewed clean production `main` at `d131af9ef48e7dd390711f2c09882e73f90de987`, fetch the published release and run `scripts/deploy-composer-preferences.sh <full-release-sha>`. The helper validates the host/revision/migration scope, backs up source/runtime/database, applies the additive migration, generates Prisma, builds both apps and restarts both dependent systemd services. It checks API/web and all public sites. On failure, it restores API/web/shared/generated-client artifacts; additive database columns remain, and Git stays at the attempted release for investigation. Never restore the database dump automatically over newer ticket activity.

Publication/deployment are authorized and pending at commit time. Confirm the actual deployed revision, migration status, services, mailbox health and authenticated Settings/Profile/editor UI after execution. Production acceptance does not require sending an unsolicited ticket reply.
