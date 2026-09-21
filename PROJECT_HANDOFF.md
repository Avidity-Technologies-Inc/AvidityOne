# Project Handoff

## Direct Ticket Email Replies — 2026-09-21

- Authorized follow-up from clean canonical `main` at `daedfde`. New operational replies execute directly: a first-line `[Closed]` records the reply and closes the ticket through the existing ticket workflow, with no confirmation request. Public replies and internal notes retain their own permissions and delivery boundaries. Current sender, mailbox, organization, membership and password-change restrictions remain checked; forwarded sender substitution is rejected.
- A unique source key claims each action before execution. Duplicate syncs, previously rejected source mail, old pending confirmations and legacy `[Confirm ...]` replies do not execute again. Interrupted actions require review, not automatic replay. Completion receipts are informational and cannot cause a completed action to be retried.
- Outlook Mac's `mail-editor-reference-message-container`, Windows/Exchange quote markers, Gmail quotes and unmarked From/To/Subject blocks are stripped consistently from HTML and text. Fresh signatures retain safe HTML and referenced inline files; quoted inline images are excluded from the posted reply. Existing customer-reply reopening and specialist reply status behavior are retained.
- Settings/Profile now explain direct execution and no longer expose confirmation validity. Legacy schema/settings fields remain for backward compatibility only; no migration or dependency/environment changes. Existing enabled reply/close policy applies immediately after deployment, without resetting notification preferences.
- Validation: 233 tests across all 39 API suites passed on disposable PostgreSQL targets; 12 email-control browser tests passed across Chromium, Firefox and WebKit. API/web TypeScript and full production build passed. Three isolated deployment tests cover successful API/web startup, build failure and health failure with restoration of both runtimes.
- Deployment: `scripts/deploy-ticket-email-direct.sh <full-release-sha>` requires clean native production `main` at `daedfde` or the target for retry, backs up source/API/web, builds both apps and checks both services and public endpoints. Publication/deployment are authorized and pending at commit time. Do not replay legacy proposals or send real ticket replies as an unsolicited smoke test. Actual Outlook acceptance is a post-deployment check.

## Downloadable Operational Email Attachments — 2026-09-21

- Follow-up implemented locally from clean canonical `main` at `cbf7f7e`. Production was verified at that revision with both services healthy following dependency recovery. Read-only Microsoft inspection confirmed the three reported images existed in sent messages with bytes, inline metadata and matching CID references; the ambiguous “included” label did not distinguish embedded images from downloadable files.
- Operational copies preserve CID rendering and add ordinary downloadable image copies after all original files, within the existing configured raw-byte budget. Unreferenced inline files become ordinary attachments. Labels distinguish attached files, embedded images and omitted copies. Scanner, visibility, download permissions and attachment-copy settings remain enforced.
- Corrected event classification: reply/internal-note event names contain “Assigned” but must not become assignment snapshots. New communications now select their own message/files; assignment history remains settings-driven. Previously accepted deliveries are not replayed.
- Validation: 47 focused email/Graph tests passed across four suites using disposable PostgreSQL and mocked delivery; API TypeScript and production API build passed. No real test email, persistent database migration, dependency, environment or service change for this follow-up. Publication and deployment are authorized. The deployment helper accepts the verified `cbf7f7e` baseline; four isolated deployment/recovery tests passed. Execution and Outlook acceptance of the new downloadable copies remain pending at commit time.

## Deployment Dependency Recovery — 2026-09-21

- The transport deployment at `518a3b6` built and started the API, but stopping API also stopped web because the live web unit Requires=avidity-api.service. Both the success and rollback paths only started API, leaving the platform web unavailable. This was a deployment procedure defect; no schema or configuration change was involved.
- Restored access by starting the existing web service. Verified the authenticated ticket list loaded 17 records for the current filters, and main login/API health/events/support all returned HTTP 200.
- Corrected the helper to stop/start both dependent services for deployment and rollback, while rebuilding only API. It now accepts the interrupted `518a3b6` checkout and checks both local endpoints before changing runtime files. No systemd unit or environment changes.
- Three isolated deployment regression tests passed: success with a Requires-like dependency, build failure rollback, and health failure rollback. Tests execute the helper with temporary runtime files and stubbed commands; no real services or credentials are used. Run `python3 tests/deployment/test_ticket_email_transport.py`.

## Ticket Email Transport Compatibility — 2026-09-21

- Production diagnosis verified release `7e1cfc9`, active services and 16 operational deliveries in REVIEW REQUIRED. The app token exposed Mail.Read and Mail.Send, while the new draft-based path required Mail.ReadWrite. No operational copies appeared among the most recent 100 drafts/sent items inspected. No permission change or test email was performed.
- Local correction uses direct Microsoft sendMail with explicit recipients, complete HTML and permitted attachments. Safe errors distinguish confirmed rejection, throttling, authentication and uncertain acceptance. The stored acceptance receipt is not an Outlook message ID; AO references continue to link email actions. Native Outlook conversation grouping is not guaranteed.
- Removed the blanket 30-second delay; five-second polling and bounded independent delivery concurrency preserve atomic claims and per-recipient ordering. Incomplete inbound attachments wait briefly without consuming send attempts. Existing uncertain deliveries require review before manual retry.
- Validation: 224 tests passed across all 39 API suites, including isolated PostgreSQL email/QC/activity workflows, authenticated runtime checks, direct Graph request contracts, confirmed rejection/throttling/uncertain acceptance, attachment readiness and concurrent recipient ordering. API TypeScript and production API build passed.
- No schema, dependency, UI, credential or environment changes. Publication is authorized; production deployment and real Microsoft receipt validation remain pending. `scripts/deploy-ticket-email-transport.sh <full-release-sha>` updates only the API from clean `7e1cfc9` (or the same release on retry), preserves the old runtime for recovery and leaves existing uncertain deliveries untouched.

## Ticket Operational Email — 2026-09-21

- Implemented on clean canonical `main` at `d8df408`, with publication authorized. Full ticket message/history copies, private attachment handling, current recipient checks and durable delivery tracking extend existing notifications. Settings and Profile share explicit policy/status controls; individual event preferences remain in force.
- Email responses use personalized context and a separate single-use confirmation to the registered user. Public replies and internal notes remain separate; `[Closed]` is accepted only on the first authored line with current permissions. Recipient changes, expired/replayed confirmations, automatic/quoted mail and removed assignments are checked. Existing reply/close services preserve workflow, QC and activity closeout behavior.
- One additive migration creates operational policy/event/delivery/action tables, a silent-note flag and transactional source-capture triggers. Capture/reply/close features default off. No permissions, credentials, dependencies, live configuration or production data have been changed; no real customer/staff email was sent for testing.
- Validation: full API regression passed with 205 tests and no skips on isolated PostgreSQL targets; focused authenticated module/permission tests passed. API/web TypeScript and full production build passed. Thirty-six focused browser checks (email controls, ticket composer and email formatting) passed across Chromium/Firefox/WebKit; the final 12 email-control cases were rerun successfully. Settings and mobile Profile screenshots were inspected. Actual Microsoft tenant delivery remains a controlled-pilot acceptance item.
- Deployment helper: `scripts/deploy-ticket-email.sh <full-release-sha>`, from clean production `main` at `d8df408` or the same release for retry. It backs up source/runtime/database, applies the additive migration, rebuilds API/web and checks health. It does not activate email policies. Native production deployment remains pending.
- Details, activation prerequisites, operational limits and recovery: [ticket operational email](docs/TICKET_EMAIL_OPERATIONS_2026-09-21.md).

## Export Row Ordering — 2026-09-21

- Web-only follow-up from clean canonical `main` at `60ae53c`. Export options now expose row sort column/direction using only selected export columns; the preview states the effective order. PDF, Excel and CSV reuse the existing server sort contract.
- Changing export sort also refreshes the main report and resets pagination to page 1. Saved reports retain the order. Removing the active sort column preserves and explicitly labels the current order until another included column is selected.
- No API, database, dependency, permission or environment changes. Web TypeScript and production build checks passed. All 24 report browser cases passed across Chromium, Firefox and WebKit, covering selected-column options, pagination reset, directions, all format requests and saved ordering; synthetic data only.
- Web-only deployment helper: `scripts/deploy-report-export-sort.sh <full-release-sha>`. Requires clean production `main` at `60ae53c` or the exact target for retry. Backs up source/Next runtime, rebuilds/restarts only web and checks health. Production deployment remains pending.

## Compact Report Controls — 2026-09-21

- Follow-up from canonical `main` at `6189269`: compact toolbar replaces the large Reports banner; filters collapse and controls use less space.
- Shared granular selection controls individual metrics/charts/criteria/detail in the view, PDF/Excel and saved reports. All detail columns sort globally before pagination using displayed values; individual record exclusions recalculate summaries/charts and persist with saved definitions. Source records remain unchanged. Explicit exclusions are limited to 100 IDs; use filters for broader selection.
- Legacy saved section aliases remain compatible. No schema, dependency, environment or permission-grant changes. Report detail reuses the existing full metadata snapshot for sorting rather than issuing a separate detail query.
- Full API regression: 158 passed, 28 existing database-gated tests skipped. Focused report tests and browser checks cover selection, exclusions, sorting, saved settings and exports. PDF layouts were visually inspected; live production acceptance remains pending.
- Guarded deployment helper: `scripts/deploy-report-controls.sh <full-release-sha>`, from clean production `main` at `6189269` or the exact target for retry. Backs up source/runtime, builds shared/API/web and verifies health; no migration.
- Details: [compact controls and report content](docs/REPORT_CONTROLS_2026-09-21.md).

## Reports Workspace Release — 2026-09-21

- Implemented on clean canonical `main` from `5289619`; publication is authorized. No additional branch/worktree, dependency upgrade, environment change or production deployment.
- Tickets/Event Services/project exports now share validated column selection and professional PDF/Excel rendering. Inclusive timezone-aware dates, explicit cohort date basis, relative periods, full-result totals, deterministic detail pagination, true zero charts, configured status labels and multiple-technician attribution replace the previous date/cap/layout defects.
- Reports has separate overview/saved/schedule/history views, applied-filter controls, full subjects, ordered columns, export preview and permission-aware actions. Saved private/shared visibility and current schedule-owner grants are enforced. Optional estimates require explicit currency and retain QC holds.
- One additive migration adds nullable `report_schedules.timing`. Saved schedules support local time/day/timezone and atomic occurrence claims; delivery history distinguishes generation, acceptance, simulation and failure. Existing definitions/data are preserved.
- API/web checks and full build passed. Full API run: 149 passed, 28 database-gated skipped; 22 focused report cases subsequently passed (152 distinct verified cases). Browser run: 158/159 passed, with the existing Firefox composer scroll case passing its isolated rerun. All 12 new report browser cases passed. Synthetic PDF and all Excel sheets were visually reviewed; no real mail or production database operation was performed.
- Guarded deployment helper: `scripts/deploy-reports-workspace.sh <full-release-sha>`. Includes source/runtime/database backups, the additive migration, complete build, service/health checks and runtime recovery without branch changes or destructive data rollback. Requires clean production `main` at the reviewed base or target for retry.
- See [report semantics, export behavior, scheduling, validation and deployment](docs/REPORTS_WORKSPACE_2026-09-21.md). Live production acceptance and an authorized Microsoft-delivery test remain pending.

## Ticket Email Formatting Fix — 2026-09-18

- Implemented locally on clean canonical `main` at `3060467`, after fetching and confirming no upstream divergence. Publication on `main` is authorized; production deployment remains pending.
- Email sanitization preserves safe table/column widths and signature spacing, plus safe fractional pixel/point borders. Scripts, event handlers, unsafe URLs, arbitrary styles and active embedded content remain blocked. Outbound replies use the corrected sanitized HTML.
- Ticket detail responses rebuild `sanitizedBodyHtml` from retained `bodyHtml` (or the sanitized copy when no original exists). Stored messages are not rewritten; plain-text messages retain their null HTML value. Historical formatting absent from both stored copies cannot be reconstructed, and previously delivered emails are not changed.
- Conversation tables no longer float alongside following paragraphs through legacy `align` attributes. Safe widths are retained on desktop, with automatic table sizing on small screens; oversized content remains contained. Existing composer action/attachment behavior is preserved.
- Validation: API/web type checks and full build passed, followed by an API rebuild and 22 focused ticket tests after preserving the null-HTML contract. Full API run: 130 passed; 28 existing database-gated QC/activity integration tests skipped because `QC_TEST_DATABASE_URL` was not supplied. All 147 browser cases verified across Chromium/Firefox/WebKit (145 full-run passes, then three focused passes after fixing an ambiguous selector in the new composer test). New cases cover actual sanitizer output, signature columns, external banners, themes, responsive layouts, editor submission, safe historical projection and unsafe HTML removal. Desktop Chromium and mobile WebKit screenshots reviewed.
- Guarded native deployment helper: `scripts/deploy-ticket-email-formatting.sh <full-release-sha>`. Accepts clean `main` at `409a48b`, `43a5222`, `3060467`, or the target for retries. Backs up source and API/web runtime, builds both components, and checks local/public health. On failure it restores runtime artifacts and leaves Git at the attempted revision; inspect before retrying. Syntax-checked locally; not executed on production.
- Requires API and web deployment; no dependency, schema, migration or environment change. No production data edits or real emails were sent. Controlled Outlook receipt verification remains pending after deployment.

## Ticket Composer Layout Release — 2026-09-18

- Implemented locally on `main` after verifying a clean checkout synchronized with canonical `origin/main` at `43a5222`. Publication is authorized; production deployment remains pending.
- The reply panel is bounded by available viewport height, with independently scrolling content and a persistent action bar. Floating geometry starts after the ticket loads and retains the normal-flow placeholder height to avoid moving the conversation while scrolling. Collapsing the composer preserves the mounted editor, draft and uploaded attachment selection.
- Validation: web TypeScript check and production web build passed; all 135 browser tests passed across Chromium, Firefox and WebKit. New tests mount the actual ticket workspace and cover 24 uploads, long signed drafts, CCs, send failure/retry, public/internal action menus, collapse/expand, scroll hiding and responsive layouts. Desktop and dark mobile screenshots were reviewed. API interactions were synthetic; no real ticket or customer message was changed.
- No backend, schema, dependency, permission or production configuration changes. Application code is limited to the ticket workspace, reply editor and scoped styles; tests are in `tests/browser/ticket-composer-layout.spec.ts`.
- Web-only deployment helper: `scripts/deploy-ticket-composer.sh <full-release-sha>`, run as root from the native host after fetching the exact release. It expects a clean `main` at `409a48b` or `43a5222` (or the target for retries), backs up the source and Next build, stops only `avidity-web`, builds web and checks local/public health. It leaves API/database/configuration unchanged. On failure it attempts to restore the old Next build while leaving Git at the attempted release for a retry. The helper was syntax-checked locally; it has not been executed against production.

## Main-only Repository Workflow — 2026-09-18

- The owner authorized aligning local and canonical GitHub `main` and removing additional branches after a verified full-history backup. Application baseline is `409a48b`; this administrative change does not modify application code, dependencies, database migrations or production.
- Work directly on `main`; new branches/worktrees require explicit authorization. Dependency proposals are archived for manual review; automatic update PR creation is disabled while vulnerability alerts remain enabled.
- See [branch policy, archived proposals and recovery](docs/REPOSITORY_BRANCH_POLICY_2026-09-18.md). The ticket composer attachment/scroll fix remains pending.

## Scheduled Activities Release — 2026-09-15

- Local branch `codex/ticket-scheduled-activities`, based on canonical `main` at `c083b19`, expands ticket Meetings to work sessions, service visits and meetings with explicit modality and organizer-only reservations. The ticket closeout panel separates actual completion, early work reservation release, cancellation and retaining future activities.
- One additive migration is prepared; existing meeting modality remains unspecified and existing attendees/Teams details are preserved. Publication is authorized; production migration and deployment remain pending. The release includes a guarded native deployment helper with source/runtime/database backups and recovery.
- API/web checks and full build passed; 155 API tests and 123 browser tests passed using synthetic fixtures and a disposable database. Real Microsoft acceptance is pending. See [scheduled activities implementation and release notes](docs/TICKET_SCHEDULED_ACTIVITIES_2026-09-15.md).

## QC Operational Preparation Production Update — 2026-09-10

- Application release `4119f61d2418750b8ec7b32bb1bda0c99c57c7df` is published and deployed. QC setup supports partial configuration with clear pending items and save actions; the ticket link now appears as **QC reviews** in Ticket Tools and opens its contextual review queue.
- **QC Administrator** contains all 15 existing QC permissions and is assigned to **Administrators**, preserving its existing roles and memberships. Configuration revision 1 includes retained historical evidence. Capture, processing and delivery remain off; operating targets and criteria must be configured later.
- Full production build succeeded, both services are active, all four public health/entry checks returned HTTP 200, and authenticated setup/ticket navigation checks passed. No migration or environment change was made. Recovery: `/opt/avidity/qc-readiness-backup-4119f61.0GNbFb`.
- See [QC operational preparation and deployment](docs/QC_OPERATIONAL_PREPARATION_2026-09-10.md) for validation and remaining activation work. Earlier entries below describe historical release states.

## People & Access Production Update — 2026-09-10

- Application release `895ac09d304e2764b7917dd568b2c4f39690acf4` is published on canonical `main` and deployed to `/opt/avidity/app`. Settings now has separate Users, Groups and Roles tabs, bounded editors with visible save actions, inheritance previews and Profile > My Access.
- Only the web build/service was updated. Both services are active; API health, login and both public portals returned HTTP 200. Authenticated Settings and My Access were verified without changing actual account grants. Production configuration and database were unchanged.
- Recovery files: `/opt/avidity/access-backup-895ac09.gBqxQi`. Persistent server Git credentials remain pending; a verified incremental bundle was used. See [access UX and deployment record](docs/ACCESS_UX_REVIEW_2026-09-10.md) for validation and operational details. QC configuration and permission assignment remain separate pending work.

## QC Production Update — 2026-09-10

- QC application release `b43bb7298b26be7fb9f7782367153425bfac1160` is published on canonical `main` and deployed to `/opt/avidity/app`, following explicit user authorization. Eight additive migrations, Prisma generation and the full shared/API/web build succeeded; both services are active.
- API health, main login, Event Portal and Support Portal returned HTTP 200. Unauthenticated QC API returned 401. Authenticated Tickets and Dashboard loaded; the system health panel reports all checks OK. No error-priority API/web journal entries were observed after startup.
- QC remains unconfigured/inactive: no program rows or captured events. The migration installed 15 QC permissions and an unassigned QC Reviewer role. Existing access grants were preserved; the current administrator session cannot open QC until the intended QC permissions are assigned through Settings. No provider notices, historical processing or billing holds were activated.
- Database, runtime and file recovery copies are retained under `/opt/avidity/qc-backup-b43bb72.p3iPyr`. Persistent server Git credentials remain pending; the exact published commit was transferred through a SHA-256-verified Git bundle and fast-forwarded.
- Production `.env.production` was not changed. Its legacy `API_URL` contains port 400, but current code does not use that variable. Actual Next rewrites use `INTERNAL_API_ORIGIN` (default `http://localhost:4000`); the built production route was verified at port 4000. Do not treat the legacy value as a deployment blocker or change it automatically.
- See [QC deployment record](docs/QC_DEPLOYMENT_2026-09-10.md), [configuration/runbook](docs/QC_RELEASE_READINESS_2026-09-10.md) and [requirements acceptance matrix](docs/QC_REQUIREMENTS_MATRIX.md). Business configuration and real Teams/Outlook/RMM pilot remain pending. The older dated entries below remain historical evidence.

## Production Update — 2026-09-09

- Ticket reply editor spacing fix `113955d` is published on canonical `main` and deployed to `/opt/avidity/app`. Native Enter cloned a draft block with a 64px minimum height; removing that rule restores normal line spacing while preserving the editable draft and protected signature.
- Local validation passed: web type check, full build, 45 browser tests, and 114 API tests. A mounted React composer smoke check passed in Chromium, Firefox, and WebKit using a mocked local API.
- Deployment was explicitly authorized and performed through Tactical RMM. The server was clean at `fb62bb5`; the checksum-verified incremental bundle fast-forwarded it to `113955d`. Only the web build/service was updated; no migrations, dependency installs, environment changes, or API restart were needed.
- Production verification: API health, main login, Event Portal, and Support Portal returned HTTP 200; both services were active; the last five minutes of error-priority service journal entries were empty. The authenticated Tickets page loaded and its stylesheet no longer contained the draft-height rule. Customer-message sending and native Enter were not exercised in production; user acceptance remains the next check.
- The previous web build was retained in the deployment script's `/tmp/avidity-web-113955d.*` backup directory. The persistent server Git credential remains pending; the bundle was used for this deployment.
- QC remains at planning stage. Existing continuity and QC documents remain local and uncommitted.

## Continuity Update — 2026-09-08

Read [the current new-session handoff](docs/PROJECT_CONTINUITY_2026-09-08.md) before starting a new module. It supplements the historical overview below with the current source map, Operations/Projects, ticket meetings, regression boundaries, deployment evidence, and unresolved acceptance checks.

- Verified on 2026-09-08: local `main` and freshly fetched `origin/main` both point to `fb62bb5`; ahead/behind is `0/0`. The worktree was clean before this documentation update.
- Canonical repository: `Avidity-Technologies-Inc/AvidityOne`; local origin uses SSH.
- Last production verification was on 2026-09-04 at `fb62bb5`, with the ticket-meetings migration applied and both native systemd services healthy. Production was not re-inspected for this documentation-only update.
- Ticket meetings are implemented and deployed. A real Microsoft Calendar invitation lifecycle still needs a controlled production acceptance test.
- This documentation update is local and uncommitted. No new application changes or deployment were performed on 2026-09-08.
- Older setup commands below are reference material, not instructions to overwrite an existing `.env`, recreate an initial migration, seed an existing database, or deploy Docker onto the native production host.

This document is the continuity handoff for moving Avidity One development to another machine. It is intentionally focused on current project state, decisions already made, and commands future Codex sessions should know before editing.

## 1. Project Purpose And Business Goal

Avidity One is a modular IT management platform for MSP and internal IT operations. It started as a helpdesk/ticketing system and has expanded into a broader operations platform covering tickets, client/contact management, reports, knowledge base, event/service requests, support portal intake, devices, remote access placeholders, maintenance, security settings, AI assistance, and Microsoft 365 email/knowledge integration.

The product should remain configurable and rebrandable from Settings. Application name, company name, logo, support email, colors, login presentation, portal titles, public form behavior, and related identity choices should not be hardcoded into application screens.

## 2. Current Tech Stack

- Monorepo: npm workspaces.
- Backend: NestJS 11, TypeScript, Prisma 5, PostgreSQL.
- Frontend: Next.js 16, React 18, TypeScript.
- Background jobs and queues: Redis and BullMQ foundation.
- Auth: HttpOnly cookie sessions, Argon2id password hashing, database-stored hashed session tokens.
- Storage: local private file storage under `storage/local`, abstracted for later provider support.
- Email: Microsoft Graph provider interface plus local mock provider.
- AI: provider adapter pattern with mock, OpenAI-compatible, Anthropic, Gemini, Ollama, and custom HTTP provider support.
- UI icons: `lucide-react`.
- Local services: Docker Compose for PostgreSQL, Redis, and Mailpit.

## 3. Current Architecture

The repository is an npm-workspaces monorepo:

```txt
apps/api       NestJS REST API, modules, guards, Prisma access, integrations
apps/web       Next.js app router UI under apps/web/src/app
packages/shared Shared constants and API-shaped types
packages/config Runtime configuration types
packages/ui     Shared UI/navigation constants
prisma          Prisma schema, migrations, and seed script
docs            Architecture, operations, security, database, and feature notes
storage/local   Non-public local file storage for attachments and generated files
```

The backend is module-oriented. Key modules include auth, profile, permissions, users, groups, roles, clients, contacts, client domains, tickets, ticket messages, ticket attachments, ticket teams, ticket routing, support portal, event services, knowledge base, reports, dashboards, devices, remote access, file storage, mailboxes, auto replies, AI assistant, spam management, maintenance, system settings, system health, notifications, and audit logs.

The frontend uses Next.js routes under `apps/web/src/app`. Important current routes include `/dashboard`, `/tickets`, `/tickets/[ticketId]`, `/clients`, `/devices`, `/devices/[deviceId]`, `/reports`, `/knowledge-base`, `/knowledge-base/[articleId]`, `/event-services`, `/event-services/[trackingNumber]`, `/event-services/calendar`, `/settings`, `/profile`, `/users`, `/login`, `/reset-password`, `/public/event-services/request`, and `/public/support/request`.

`apps/web/next.config.mjs` rewrites browser `/api/*` calls to `INTERNAL_API_ORIGIN` with a default of `http://localhost:4000`. `apps/web/src/proxy.ts` handles session redirects and host-based public portal routing:

- `events.*` root requests rewrite to `/public/event-services/request`.
- `support.*` root requests rewrite to `/public/support/request`.

## 4. Important Folders And Files

- `README.md`: general project overview and local setup.
- `package.json`: root workspace scripts and dependency overrides.
- `apps/api/src/app.module.ts`: backend module wiring.
- `apps/api/src/modules/*`: backend domain modules.
- `apps/web/src/app/*`: frontend routes.
- `apps/web/src/components/*`: frontend workspaces and reusable UI.
- `apps/web/src/lib/api.ts`: frontend API client utilities.
- `apps/web/src/proxy.ts`: public route/session proxy behavior.
- `apps/web/next.config.mjs`: Next.js rewrites and package transpilation.
- `packages/shared/src/index.ts`: shared constants/types.
- `packages/config/src/index.ts`: shared runtime config types.
- `packages/ui/src/index.ts`: shared UI/navigation constants.
- `prisma/schema.prisma`: database schema.
- `prisma/migrations/*`: migration history.
- `prisma/seed.ts`: seed data and baseline permissions/settings.
- `.env.example`: local development environment template.
- `.env.production.example`: production template, but check notes below because production has evolved beyond the original support-only domain.
- `docker-compose.yml`: local PostgreSQL, Redis, Mailpit, optional app containers.
- `docker-compose.prod.yml`: older Docker-based production path.
- `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/SECURITY.md`, `docs/LOCAL_DEVELOPMENT.md`, `docs/PRODUCTION_DEPLOYMENT.md`, `docs/WORK_LOG.md`: core project documentation.

## 5. Completed Work

Completed work visible from repo docs, migrations, and continuity notes includes:

- Initial monorepo scaffold with NestJS API, Next.js web app, Prisma, PostgreSQL, Redis, Docker Compose, seed data, and health check.
- Auth foundation with HttpOnly sessions, Argon2id password hashing, hashed session tokens, permission guards, groups, roles, permissions, users, and profile self-service.
- Client, contact, client-domain, unmapped-domain, mailbox, ticket, message, attachment, watcher, assignment, notification, routing, and audit-log foundations.
- Clean ticket URLs based on ticket numbers while retaining UUID compatibility.
- Ticket workspace productivity work: search, saved views, filter panel, conditional bulk actions, manual ticket creation, inline specialist assignment, assignment workflow, columns, density, recycle bin, and dashboard-driven filters.
- Ticket merging with source ticket closure, message/attachment transfer, watcher copying, internal summary notes, inbound redirect behavior, and `tickets.merge` permission.
- Channel-specific notification preferences and richer ticket notification emails.
- Dashboard analytics with KPIs, charts, source distribution, workload insights, and clickable filters.
- Spam management, blocked inbound email logging, maintenance recycle-bin controls, attachment quarantine and rescan operations.
- Theme support including light, dark, system, and OLED dark continuity.
- Branding and layout controls through Settings.
- Login/security settings, password reset, TOTP MFA, recovery/trusted-device foundations.
- Profile self-service including password, notifications, signature editor, appearance, and MFA setup.
- Ticket reply signature behavior with sanitized HTML and plain-text storage.
- AI assistant provider registry, model/action settings, mock provider, OpenAI-compatible provider, Anthropic, Gemini, Ollama, custom HTTP provider, request logging, and inline writing assistance/autocomplete.
- Microsoft 365 mailbox integration shape with direct/forwarded mailbox modes, mock inbound sync, Microsoft Graph inbound delta sync and outbound `sendMail` paths, attachment pagination handling, and initial sync date behavior.
- Knowledge Base with categories/articles, OneNote import, delegated Microsoft auth, section/page mapping, import preview, list/card views, article details, bulk state actions, search, media sync, and page attachments.
- Reports with ticket/event switching, report definitions, schedules, PDF/export work, event reports, pagination improvements, and report layout updates.
- Event & Services module with EVT tracking numbers, public event request form, service catalog, configurable fields, 15-minute scheduling increments, internal request management, assignments, tasks, comments, activity, messages, attachments, recycle bin, notifications, event reporting, calendar view planning, and Microsoft calendar sync support.
- Support Portal at `support.aviditytechnologies.com` with configurable fields, sections, conditional visibility, field widths, reorderable fields/sections, core field width controls, and configurable browser title.
- Devices, remote access placeholders, RMM settings, control URL templates, favorites, saved views, and detail snapshot work.
- Security health and attachment quarantine work.
- Email operational-hours migration.

Latest local Git state checked during this handoff:

- Branch: `main`.
- Remote: `git@github.com:Avidity-Technologies-Inc/AvidityOne.git`.
- Latest visible commits:
  - `fb62bb5 Add ticket meeting scheduling`
  - `a5d22ad Fix AI draft selection boundary`
  - `d1e28a6 Fix empty ticket reply composer`
  - `7a602c8 Fix ticket conversation and AI reply handling`
  - `57d8ca0 Update repository ownership references`
- Verified against freshly fetched origin on 2026-09-08; working tree was clean before this documentation update.
- Operations and Projects are implemented in the current source, including project templates, milestones, decisions, ticket/event work items, and dependencies. See the current new-session handoff for entry points.

## 6. Pending Work

Known or likely pending work:

- Continue Reports cleanup if PDF formatting, selector styling, or report UX needs more polish.
- Implement TacticalRMM integration only when explicitly approved. Prior guidance was backend-only API integration, `X-API-KEY` stored as an environment reference, read-only sync first, audited remote access links, and deeper remote actions later.
- Continue Events & Services calendar/task workflow cleanup if needed.
- Continue Support Portal field/section UX refinements if public form layout needs polish.
- Replace or mature the current rich text editor with a proven editor such as TipTap or Lexical if the placeholder no longer meets requirements.
- Add stronger production controls that are still listed as future security work: CSRF tokens, antivirus scanning, stricter content-type sniffing, account lockout tuning, and reverse-proxy hardening.
- Keep validating dark/OLED contrast and mobile layouts as UI surfaces grow.

## 7. Known Bugs Or Issues

- Production documentation contains both Docker-based deployment guidance and newer native systemd guidance. Current production continuity says the live deployment is native Ubuntu/systemd under `/opt/avidity/app`, not Docker Compose.
- `.env.production.example` still reflects the older single-domain `support.aviditytechnologies.com` deployment. Current production domain continuity uses:
  - Main app: `https://one.aviditytechnologies.com`
  - Event public portal: `https://events.aviditytechnologies.com`
  - Support public portal: `https://support.aviditytechnologies.com`
- Do not set production `API_URL` to the public domain. Keep `API_URL=http://localhost:4000` on the native production host; public browser values use `NEXT_PUBLIC_API_URL=https://one.aviditytechnologies.com/api`.
- Do not use `NODE_OPTIONS="-r dotenv/config"` for production builds; Next.js workers reject `-r` in `NODE_OPTIONS`. Use the documented Node dotenv wrapper instead.
- TacticalRMM is not a completed integration unless current code proves otherwise. Treat it as future work despite RMM-related settings and placeholders.
- The prior inline autocomplete spacing bug was fixed by preserving cursor whitespace behavior. Be careful changing `TicketReplyEditor`, `EventMessageComposer`, `getTextBeforeCursor`, or autocomplete normalization.

## 8. Design/UI Decisions Already Made

- Product-facing identity should be Settings-driven, not hardcoded.
- Settings is the home for branding, themes, login/security, password reset, TOTP/MFA, notification settings, spam management, maintenance, AI/security, ticket teams/routing/domains, Events Config, Reports, Support Portal, Knowledge Config, RMM settings, and related admin configuration.
- Users navigation was moved out of the main sidebar and into `Settings > General`; do not assume user management is a top-level nav item.
- Event & Services sits below Tickets and above Clients in the product model.
- Profile is separate from admin user management and is exposed through user-facing navigation/menu paths.
- Public portals should support configurable browser title suffixes from their Settings sections.
- Public event and support forms should use configured fields, ordering, field widths, sections, and conditional visibility where applicable.
- Keep SaaS/admin UI quiet, operational, and scannable. Avoid marketing-page patterns inside the app.
- Use existing component/workspace patterns before adding new abstractions.
- Use `lucide-react` icons when icons are needed.

## 9. Backend/API Decisions Already Made

- REST is the initial API style.
- Permission checks use permission strings, not role names.
- Sensitive actions should write audit logs.
- Public ticket/event/support behavior should go through dedicated public endpoints and settings-backed configuration.
- Mailbox integration supports mock, Microsoft Graph direct mailbox, and forwarded mailbox workflows.
- Initial sync date should be configured before first real Microsoft sync to avoid importing too much history.
- AI output must require human approval and must never send customer messages automatically.
- AI prompt context should avoid secrets and should not include attachment contents by default.
- File paths should not be exposed to browser clients. Downloads/previews go through authenticated API endpoints.
- Ticket teams and event-service teams/progress are distinct workflows; do not conflate changes between them.

## 10. Database Structure And Migrations

Prisma uses UUID primary keys for most records and human-readable ticket/event numbers through sequence models. Soft deletion is used where appropriate; audit logs are append-only.

Important enum/model areas include:

- Organization and settings: `Organization`, `SystemSetting`.
- Auth and users: `User`, `Session`, password reset tokens, MFA challenges, trusted devices, groups, roles, permissions, join tables.
- Clients and contacts: `Client`, `ClientDomain`, `UnmappedEmailDomain`, `Contact`.
- Mailboxes: `Mailbox`, provider/connection/outbound modes.
- Tickets: `TicketSequence`, `Ticket`, `TicketMerge`, assignees, watchers, routing rules, messages, attachments, notification preferences, saved views.
- Files: `StoredFile`, attachment scan status/result, storage provider.
- Support portal: `SupportPortalForm`, `SupportPortalFormSection`, `SupportPortalFormField`.
- Event Services: event sequence, services, forms, fields, requests, request services, assignees, tasks, messages, comments, activities, attachments.
- Knowledge Base: categories, articles, pages, attachments.
- Reports: exports, definitions, schedules.
- Devices and remote access: devices, profiles, favorites, views.
- AI: request logs, provider configs, model configs, action settings.
- Operations: spam entries, blocked inbound email, notifications, audit logs, system health snapshots, maintenance-related records.

Migration history currently runs from `20260528174347_init` through `20260904120000_ticket_meetings`. Before changing `prisma/schema.prisma`, inspect the existing migration pattern and add a focused migration.

Commands:

```bash
npm run prisma:generate
npm run prisma:migrate -- --name <migration_name>
npm run prisma:seed
```

On Windows PowerShell, use `npm.cmd` instead of `npm` if execution policy blocks `npm.ps1`.

## 11. Environment Variables Needed

Local development starts from `.env.example`. Important variables:

- App/runtime: `APP_NAME`, `APP_ENV`, `APP_URL`, `API_URL`, `PORT`, `NEXT_PUBLIC_API_URL`, `CORS_ORIGINS`.
- Database: `DATABASE_URL`, `DOCKER_DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`.
- Redis: `REDIS_URL`, `DOCKER_REDIS_URL`.
- Sessions/cookies: `SESSION_SECRET`, `SESSION_COOKIE_NAME`, `SESSION_TTL_HOURS`, `COOKIE_DOMAIN`, `COOKIE_SECURE`, `COOKIE_SAME_SITE`.
- Microsoft 365/mail: `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_SUPPORT_MAILBOX`, `MICROSOFT_INGESTION_MAILBOX`, `MAIL_PROVIDER`, `MOCK_INBOUND_EMAIL_ENABLED`, `MOCK_INBOUND_SENDER_EMAIL`, `MOCK_INBOUND_SENDER_NAME`.
- AI: `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, `AI_BASE_URL`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`.
- RMM: `TACTICAL_RMM_API_KEY`.
- Storage: `FILE_STORAGE_PROVIDER`, `LOCAL_STORAGE_PATH`, `MAX_UPLOAD_SIZE_MB`.
- Defaults: `DEFAULT_COMPANY_NAME`, `DEFAULT_SUPPORT_EMAIL`, `DEFAULT_TIMEZONE`, `DEFAULT_LANGUAGE`.
- Seed admin: `ADMIN_EMAIL`, `ADMIN_PASSWORD`.

Do not commit `.env`, `.env.production`, database dumps, logs, or `storage/local` contents.

For macOS local setup, create a local `.env` from `.env.example` and adjust hostnames/ports if needed. If Docker Compose is used for PostgreSQL and Redis, `DATABASE_URL` should point to `localhost` for local commands and `DOCKER_DATABASE_URL` should point to `postgres` for containers.

## 12. Commands To Install, Run, Build, And Deploy

macOS local setup:

```bash
cp .env.example .env
npm install
docker compose up -d
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run prisma:seed
npm run dev
```

Windows local setup:

```powershell
Copy-Item .env.example .env
npm.cmd install
docker compose up -d
npm.cmd run prisma:generate
npm.cmd run prisma:migrate -- --name init
npm.cmd run prisma:seed
npm.cmd run dev
```

Useful local URLs:

- Web: `http://localhost:3000`
- API health: `http://localhost:4000/api/health`
- Mailpit: `http://localhost:8025`
- Prisma Studio: `npm run prisma:studio`

Validation commands:

```bash
npm run prisma:generate
npm run lint:api
npm run lint:web
npm test
npm run build
```

Windows equivalent:

```powershell
npm.cmd run prisma:generate
npm.cmd run lint:api
npm.cmd run lint:web
npm.cmd test
npm.cmd run build
```

Docker app containers for local full-stack container testing:

```bash
docker compose --profile app up -d --build
```

## 13. Deployment Notes

Current production continuity:

- Production path: `/opt/avidity/app`.
- Runtime: native Ubuntu/systemd, not Docker Compose.
- Services: `avidity-api` and `avidity-web`.
- Main app domain: `https://one.aviditytechnologies.com`.
- Event public portal domain: `https://events.aviditytechnologies.com`.
- Support public portal domain: `https://support.aviditytechnologies.com`.
- Keep old helpdesk links redirecting to the main domain if that redirect still exists.
- API runs internally at `http://localhost:4000`.
- Web runs internally at `http://localhost:3000`.
- Browser calls should go through `/api`, with Next rewrites pointing to the internal API origin.

High-confidence native production update pattern:

```bash
cd /opt/avidity/app
git status --short
sudo -u avidity git pull
sudo -u avidity bash -lc 'cd /opt/avidity/app && npm install'
sudo -u avidity bash -lc 'cd /opt/avidity/app && DOTENV_CONFIG_PATH=.env.production node -r dotenv/config ./node_modules/prisma/build/index.js generate --schema prisma/schema.prisma'
sudo -u avidity bash -lc 'cd /opt/avidity/app && DOTENV_CONFIG_PATH=.env.production node -r dotenv/config ./node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma'
sudo -u avidity bash -lc 'cd /opt/avidity/app && node -e "require(\"dotenv\").config({ path: \".env.production\" }); const { spawnSync } = require(\"node:child_process\"); const result = spawnSync(\"npm\", [\"run\", \"build\"], { stdio: \"inherit\", env: process.env }); process.exit(result.status ?? 1);"'
sudo systemctl restart avidity-api avidity-web
sudo systemctl status avidity-api avidity-web --no-pager
curl -s -H "Host: one.aviditytechnologies.com" http://127.0.0.1/api/health
```

Important production env guidance:

```env
API_URL=http://localhost:4000
APP_URL=https://one.aviditytechnologies.com
NEXT_PUBLIC_API_URL=https://one.aviditytechnologies.com/api
CORS_ORIGINS=https://one.aviditytechnologies.com,https://events.aviditytechnologies.com,https://support.aviditytechnologies.com
```

After changing public API or cookie settings, rebuild Next with the dotenv wrapper and restart both systemd services.

The Docker production docs and `docker-compose.prod.yml` remain in the repo, but confirm whether they are still intended before using them for deployment.

## 14. Security Considerations

- Keep secrets in environment variables or Settings `env:` references; never hardcode secrets.
- Do not commit `.env`, `.env.production`, dumps, logs, or `storage/local`.
- Passwords are Argon2id-hashed.
- Session cookies are HttpOnly and backed by hashed tokens in the database.
- Permission checks use permission strings.
- Attachment storage is private; downloads/previews require authenticated API routes.
- Blocked or suspicious attachments must not be previewed or downloaded.
- HTML from ticket messages, event messages, and signatures must be sanitized before save/render.
- AI output is advisory only and requires human approval.
- AI prompts should strip common secret patterns and avoid attachment contents by default.
- Microsoft credentials, AI API keys, Turnstile secrets, and RMM tokens belong in env vars or env references.
- Turnstile site keys live in Settings/database; secrets stay in env references such as `env:TURNSTILE_SECRET_KEY`, `env:EVENT_TURNSTILE_SECRET_KEY`, and `env:SUPPORT_PORTAL_TURNSTILE_SECRET_KEY`.
- For production lockout recovery, avoid broad auth changes. Disable only the specific setting or reset only the affected user record after verifying the issue.
- Do not use `npm audit fix --force` without analysis.

## 15. Important Decisions From Previous Chats

- Treat Avidity One as broader than ticketing. It includes helpdesk, service operations, reporting, knowledge base, event/service request management, public portals, devices, remote access placeholders, and admin settings.
- Default to Settings-driven behavior for branding, portal presentation, login/security options, public form behavior, and browser titles.
- Keep repo artifacts in English: code, comments, docs, labels, tests, and API names.
- Use Windows PowerShell commands for Windows instructions, and use `npm.cmd` when PowerShell blocks `npm.ps1`. For the Mac handoff, use normal `npm` commands.
- Inspect the real implemented state before changing UI or runtime behavior.
- For interrupted work, start with `git status --short`, `git diff --stat`, `git log --oneline -5`, and targeted diffs before editing.
- Do not improvise production deploy commands. Follow repo docs and the current native systemd production pattern.
- Preserve explicit DB credentials or env values if the user provides them; do not normalize them back to generic defaults.
- Users live under `Settings > General`, not top-level navigation.
- Support Portal and Event Portal are first-class public surfaces.
- Ticket-team changes and event-team/progress changes are not interchangeable.
- TacticalRMM remains future analysis unless explicitly approved for implementation.

## 16. What Codex Should Know Before Continuing

- Read `AGENTS.md` first in future sessions.
- Start with `git status --short` before edits.
- Keep changes small and scoped to the requested task.
- Do not modify working behavior unless needed for the task, a bug fix, security, or clear duplication.
- Do not make broad formatting sweeps, dependency upgrades, architecture changes, migrations, or deploy changes unless explicitly requested.
- When touching high-risk areas such as auth, permissions, database schema, public API contracts, production config, or security-sensitive code, make the smallest possible change and validate carefully.
- For UI work, follow existing workspaces/components and Settings-driven product decisions.
- For public portals, verify host routing and Settings-backed behavior.
- For AI work, preserve human approval and prompt-safety boundaries.
- For email/Microsoft Graph work, verify mailbox mode, initial sync date, duplicate handling, and permissions.
- For attachment work, preserve private storage, validation, scan status, and authenticated access.
- For production, remember the live deployment is native systemd under `/opt/avidity/app` unless current server inspection proves otherwise.

## 17. Recommended Next Steps

1. On the Mac, confirm the cloned repo is on `main` and current with `git status --short` and `git log --oneline -5`.
2. Copy or recreate a local `.env` from `.env.example`. Do not commit it.
3. Install dependencies with `npm install`.
4. Start local services with `docker compose up -d`.
5. Run `npm run prisma:generate`.
6. If the Mac database is new, run `npm run prisma:migrate -- --name init` and `npm run prisma:seed`. If it already has migrations applied, inspect first and use the correct Prisma command.
7. Validate with `npm run lint:api`, `npm run lint:web`, `npm test`, and `npm run build` before making major changes.
8. Start local development with `npm run dev` and test `http://localhost:3000` plus `http://localhost:4000/api/health`.
9. Before the next feature/fix, inspect the exact files involved instead of relying only on this handoff.
