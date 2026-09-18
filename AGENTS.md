# Codex Project Instructions

These instructions apply to future Codex sessions working in this repository.

## Core Rules

- Preserve working behavior. Change only what is necessary for the requested task, a bug fix, a security fix, or clear duplication reduction.
- Stay within scope. Do not make unrelated improvements, broad refactors, dependency upgrades, formatting sweeps, architecture changes, or large rewrites unless explicitly asked.
- Keep code simple, maintainable, and consistent with existing patterns.
- Inspect relevant files before assuming how a feature works.
- Check `git status --short` before editing.
- Do not overwrite user changes.
- Work directly on `main` for this repository. Do not create or publish additional branches or worktrees unless the user explicitly authorizes them for the current task.
- Before editing, fetch canonical `origin`, compare local `main` with `origin/main`, and preserve any existing changes or divergence. Use fast-forward updates when possible; never force-push shared history.
- Dependency upgrades are reviewed manually. Keep Dependabot vulnerability alerts enabled; do not re-enable automatic update PRs without explicit user authorization.
- Do not modify application code when the user asks only for documentation, planning, review, or analysis.

## Repository Conventions

- Repo artifacts should be in English: code, comments, docs, labels, tests, and API names.
- The project is an npm-workspaces monorepo.
- Backend code lives under `apps/api/src`.
- Frontend code lives under `apps/web/src`.
- Shared packages live under `packages/shared`, `packages/config`, and `packages/ui`.
- Database schema and migrations live under `prisma`.
- Documentation lives under `docs`.
- Prefer existing module, component, DTO, service, controller, and workspace patterns before adding new abstractions.
- Add comments only when they explain why something is done.

## Preferred Commands

Use normal npm commands on macOS/Linux:

```bash
npm install
docker compose up -d
npm run prisma:generate
npm run lint:api
npm run lint:web
npm test
npm run build
npm run dev
```

Use `npm.cmd` on Windows PowerShell when execution policy blocks `npm.ps1`:

```powershell
npm.cmd install
docker compose up -d
npm.cmd run prisma:generate
npm.cmd run lint:api
npm.cmd run lint:web
npm.cmd test
npm.cmd run build
npm.cmd run dev
```

Use targeted commands first. Do not start long-running dev servers unless UI, routing, API, or runtime validation needs it.

## Validation Expectations

- After meaningful backend changes, run `npm run lint:api` and relevant tests.
- After meaningful frontend changes, run `npm run lint:web`.
- After schema changes, run Prisma generate and the appropriate migration command.
- After broad or shared changes, run `npm test` and `npm run build` when practical.
- Report any validation that was not run and why.

## Design And Product Rules

- Avidity One is broader than ticketing. It includes helpdesk, service operations, reporting, knowledge base, event/service request management, support portal intake, devices, remote access placeholders, AI, Microsoft 365 integration, and admin settings.
- Keep product identity and public presentation Settings-driven. Branding, app name, logo, colors, login presentation, security options, public form behavior, and portal browser titles should not be hardcoded.
- Users navigation belongs under `Settings > General`, not the main sidebar, unless the product decision changes explicitly.
- Keep Profile separate from admin user management.
- Support Portal and Event Portal are first-class public surfaces.
- Ticket teams and Event Services team/progress behavior are separate workflows. Do not conflate them.
- For admin/SaaS UI, keep layouts quiet, scannable, and operational. Follow existing component density and interaction patterns.
- Use `lucide-react` icons when icons are needed.

## Backend And API Rules

- REST is the current API style.
- Permission checks should use permission strings, not role names.
- Sensitive actions should write audit logs.
- Keep public portal behavior behind dedicated endpoints and Settings-backed configuration.
- Preserve mailbox duplicate handling, initial sync date behavior, and direct/forwarded Microsoft Graph mailbox modes.
- AI output must require human approval and must not send customer messages automatically.
- AI prompt context should avoid secrets and should not include attachment contents by default.
- Attachments must remain private and accessible only through authenticated API endpoints.
- Sanitize ticket, event, knowledge, and signature HTML before save/render.

## Security Rules

- Never commit `.env`, `.env.production`, database dumps, logs, or `storage/local` contents.
- Keep secrets in environment variables or Settings `env:` references.
- Do not hardcode Microsoft credentials, AI keys, Turnstile secrets, RMM keys, session secrets, or database passwords.
- Do not use `npm audit fix --force` without explicit approval and analysis.
- Treat authentication, authorization, permissions, database migrations, security-sensitive code, deployment, environment config, and public API contracts as high risk.
- For high-risk areas, make the smallest possible change and explain the risk before editing when appropriate.

## Database Rules

- Prisma schema lives at `prisma/schema.prisma`.
- Inspect existing migrations before adding a new migration.
- Do not edit applied migration files unless explicitly directed and the environment impact is understood.
- Use UUID primary keys and existing model patterns.
- Preserve append-only audit log behavior.
- Preserve soft-delete behavior where already used.

## Deployment Rules

- Do not deploy unless explicitly asked.
- Do not change infrastructure, environment variables, secrets, systemd services, Docker production files, or Nginx config without explicit approval.
- Current production continuity says the live host is native Ubuntu/systemd under `/opt/avidity/app`, with services `avidity-api` and `avidity-web`.
- Current production domains are `one.aviditytechnologies.com`, `events.aviditytechnologies.com`, and `support.aviditytechnologies.com`.
- Keep production `API_URL=http://localhost:4000` unless server inspection proves the topology changed.
- Do not use `NODE_OPTIONS="-r dotenv/config"` for production Next builds.

## Forbidden Or Approval-Gated Actions

Ask for confirmation before:

- Installing, removing, or upgrading dependencies.
- Running database migrations against production or production-like data.
- Seeding, truncating, deleting, or mass-updating data.
- Deploying or restarting production services.
- Changing environment variables or secrets.
- Changing infrastructure, Nginx, DNS, SSL, or systemd configuration.
- Force-pushing, resetting history, or discarding user changes.
- Deleting many files or running destructive filesystem commands.

## Handoff And Recovery

- Read `PROJECT_HANDOFF.md` before major work or after moving machines.
- For interrupted work, start with:

```bash
git status --short
git diff --stat
git log --oneline -5
```

- Then inspect targeted diffs/files before editing.
- If the repo state differs from `PROJECT_HANDOFF.md`, trust the current repo after verifying it.
