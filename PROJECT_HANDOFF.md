# Project Handoff

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
- Remote: `https://github.com/Avidity-Technologies-Inc/AvidityOne.git`.
- Latest visible commits:
  - `14579d6 Preserve autocomplete cursor spacing`
  - `2e4ae20 Refine inline writing suggestions`
  - `125bf43 Improve live writing assistance`
  - `ea1a2e5 Support modern OpenAI token limits`
  - `7eda7cd Add AI provider management actions`
- Working tree was clean before these documentation files were created.

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

Migration history currently runs from `20260528174347_init` through `20260630120000_email_operational_hours`. Before changing `prisma/schema.prisma`, inspect the existing migration pattern and add a focused migration.

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
