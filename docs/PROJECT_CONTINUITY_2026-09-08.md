# Avidity One — New Session Handoff

**Latest September 10 update:** QC operational preparation release `4119f61` is deployed. Administrators now inherit the separate QC Administrator role; historical measurement scope is saved, while capture, processing and delivery remain off. Read [the latest QC preparation/deployment record](QC_OPERATIONAL_PREPARATION_2026-09-10.md) and [current handoff](../PROJECT_HANDOFF.md). The older activation and permission statements below are historical.

**September 10 production update:** QC release `b43bb72` is now published and deployed, with eight additive migrations and successful full production build. QC remains unconfigured and inactive; permissions were cataloged but no existing memberships were expanded. Read [the QC deployment record](QC_DEPLOYMENT_2026-09-10.md) and [current handoff](../PROJECT_HANDOFF.md) before acting. The September 8/9 statements below are historical. `.env.production` remains unchanged; actual API routing uses `INTERNAL_API_ORIGIN` at port 4000, while legacy `API_URL` is not consumed by current code.

Prepared on 2026-09-08 for a new chat that will define a significant new module. This is project continuity, not a specification or approval to build an unnamed module. Repository artifacts are in English; user-facing collaboration is normally in Spanish.

**2026-09-09 update:** `113955d` (`Fix ticket reply editor line spacing`) is now published on canonical `main` and deployed to the native production host with explicit user authorization. The web build succeeded, both services are active, API health and all three public web entry points returned HTTP 200, and authenticated Tickets loaded with the corrected stylesheet. See the September 9 entry in [PROJECT_HANDOFF.md](../PROJECT_HANDOFF.md) for validation and recovery details. The September 8 state and September 4 deployment below remain historical evidence. QC is still in planning; the server's persistent Git credential is still pending.

## 1. Evidence, scope, and current state

- Workspace: `/Users/luismenahernandez/Development/codex/helpdesksystem`.
- Canonical repository: `https://github.com/Avidity-Technologies-Inc/AvidityOne`.
- Local origin: `git@github.com:Avidity-Technologies-Inc/AvidityOne.git`.
- Branch and current commit: `main`, `fb62bb5` (`Add ticket meeting scheduling`).
- On 2026-09-08, `git fetch --prune origin` succeeded and `git rev-list --left-right --count HEAD...origin/main` returned `0 0`.
- The worktree was clean before creating this document and updating `PROJECT_HANDOFF.md`. These documentation changes are intentionally local and uncommitted.
- The previous application work is committed, pushed, and was deployed on 2026-09-04. There is no known pending application patch from this conversation.
- Today's inspection covered repository state, manifests, existing handoff/docs, module wiring, schema, and selected controllers/services/UI. It was not a full code audit, fresh test run, or production inspection.
- Production facts below are the last verified results from 2026-09-04. Recheck them before the next deployment.

## 2. Product purpose and module inventory

Avidity One is a modular platform for MSP and internal IT service operations. It is broader than helpdesk ticketing. Preserve its existing workflows when adding modules.

| Area | Current capability and boundary |
| --- | --- |
| Dashboard | Ticket KPIs, workload and activity charts, links into filtered ticket views. |
| Tickets | Manual/email/portal intake, clients/requesters, assignment, CC participants, public replies/internal notes, attachments, watchers, configurable statuses/workflows, routing, saved views, filters, bulk actions, merging, recycle bin, AI assistance, and meetings. |
| Meetings within tickets | Multiple meetings per ticket, editable participants and agenda, calendar scheduling, updates/cancellation/completion, synchronization status, and ticket activity history. Completing a meeting does not close its ticket. |
| Operations | Existing `/operations` workspace and `GET /api/operations/overview`; inspect its aggregation and permission requirements before adding a parallel operational dashboard. |
| Projects | Existing `/projects` and `/projects/new`, backend CRUD, templates, milestones, decisions, alerts/digests, linked ticket/event work items, dependencies, owner, client, status, health, and dates. This is implemented source, not an empty placeholder. |
| Event & Services | Separate EVT workflow: public request intake, configurable services/forms, schedules, assignments, internal/external specialists, tasks, messages/comments, attachments, activities, calendar synchronization, and reporting. Its teams/statuses/tasks are distinct from tickets. |
| Clients and contacts | Clients, contacts, email-domain matching and unmapped-domain handling. Reuse these records for future client-linked modules. |
| Knowledge Base | Categories, articles/pages, visibility/status, search, OneNote integration/import, Microsoft delegated authentication, media and attachments. |
| Reports | Definitions, schedules, ticket/event reporting and export/PDF functionality. Specific output quality still needs validation when changed. |
| Devices and remote access | Inventory, views/favorites, snapshots, provider settings and remote-link abstractions. Do not equate these with a completed TacticalRMM backend integration. |
| Settings and Profile | Branding, themes, users/groups/roles/permissions, security/MFA, notifications, signatures, mail, AI providers/actions, routing, portal forms, integrations, maintenance and health. Profile is separate from administrator user management. |
| Public portals | First-class Support Portal and Event Portal with Settings-driven presentation, fields, and host routing. |

## 3. Technical architecture and entry points

- npm-workspaces monorepo; TypeScript throughout.
- Backend: NestJS 11, REST controllers/services/DTOs, Prisma 5.22, PostgreSQL.
- Frontend: Next.js 16.2.11 release baseline, React 18, App Router, existing workspace components and CSS, `lucide-react` icons.
- Redis/BullMQ infrastructure for background work.
- Authentication: HttpOnly cookie sessions, hashed session tokens in the database, Argon2id passwords, permission guards, MFA and Microsoft SSO-related models.
- Private attachment storage via a storage abstraction; local provider under `storage/local`.
- Mail: mock and Microsoft Graph provider patterns; direct and forwarded mailbox modes.
- AI: provider adapters/configuration for mock, OpenAI-compatible, Anthropic, Gemini, Ollama, and custom HTTP providers. No provider credentials are included in this handoff.
- Treat the lockfile as the source for exact dependency versions. Do not upgrade dependencies just to start another feature.

| Path | Purpose |
| --- | --- |
| `AGENTS.md` | Repository engineering, safety, product and deployment rules. Read first. |
| `PROJECT_HANDOFF.md` | Broad historical overview; read its current continuity update first. |
| `apps/api/src/app.module.ts` | Existing module registration and runtime wiring. |
| `apps/api/src/modules/` | Domain modules, including operations, projects, tickets, ticket-meetings, microsoft-calendar, event-services, auth, permissions, settings and audit. |
| `apps/web/src/app/` | Application and public routes. |
| `apps/web/src/components/` | Existing workspaces and shared UI patterns. |
| `apps/web/src/components/tickets/TicketDetailWorkspace.tsx` | Ticket view, editor integration, conversation/timeline and meetings entry point. |
| `apps/web/src/components/tickets/TicketReplyEditor.tsx` | Sensitive rich text, draft selection, signature and AI interactions. |
| `apps/web/src/components/tickets/TicketMeetingDrawer.tsx` | Meeting list and create/edit/schedule/cancel/complete UI. |
| `apps/web/src/lib/api.ts` | Browser API access conventions. |
| `apps/web/src/proxy.ts` and `apps/web/next.config.mjs` | Session/public host routing and internal API rewrites. |
| `packages/shared`, `packages/config`, `packages/ui` | Shared contracts, config and UI/navigation foundations. Inspect actual shell filtering before changing navigation. |
| `prisma/schema.prisma`, `prisma/migrations`, `prisma/seed.ts` | Persistent models, migration history and baseline permissions/settings. |
| `tests/browser`, `playwright.config.ts` | Browser regression coverage for Chromium, Firefox and WebKit. |

Important documentation includes `docs/PRODUCTION_DEPLOYMENT.md`, `docs/DATABASE.md`, `docs/SECURITY.md`, `docs/ATTACHMENTS_AND_STORAGE.md`, `docs/MICROSOFT_365_INTEGRATION.md`, `docs/TICKET_MERGING.md`, and `docs/AI_ASSISTANT.md`. Several older architecture/roadmap/editor/local-setup documents describe early milestones; current verified code takes precedence over stale statements such as "placeholder" or "not yet implemented".

## 4. Recent ticket work and regression boundaries

| Commit | Work |
| --- | --- |
| `cf2b8ed`, `7291f28` | Inbound CC participant capture and repair. |
| `57d8ca0` | Canonical repository ownership references. |
| `7a602c8` | Conversation layout and AI reply handling fixes. |
| `d1e28a6` | Empty ticket composer editability fix. |
| `a5d22ad` | AI draft selection boundary correction. |
| `fb62bb5` | Ticket meeting scheduling and calendar integration. |

The user reported clipped long email/conversation text, browser-dependent layout failures, a composer that could not receive input, and writing tools that included full conversations or signatures. The latest fixes address these paths. Preserve wrapping/containment for long content, editor focus/selection, an editable empty draft, signature separation, and the distinction between the current draft and conversation context.

Grammar, paraphrase and rewrite actions must operate on the intended draft/selection. Signatures are not generated response content. Context for drafting a reply must not become a verbatim copy of all conversations. AI suggestions require human acceptance; they never send replies automatically. Preserve autocomplete cursor spacing and preview/send cleanup.

Inbound mail synchronization must retain Message-ID deduplication, initial sync date behavior, direct/forwarded modes, attachment pagination, and normalized CC participants. Legacy Graph delta projections can omit `ccRecipients`; the existing projection-version change uses a bounded overlap to recover recipients without duplicating tickets. Inspect the implementation before changing sync cursors.

## 5. Ticket meetings: implemented behavior

- One ticket can have multiple independently tracked meetings.
- The title defaults to the ticket number and subject. Organizer defaults to the current user, with Microsoft principal name/email resolution.
- Default attendees come from the requester and stored conversation participants, including captured CC participants. Users can add/remove participants and mark them required or optional. The backend normalizes/deduplicates recipients and filters excluded addresses.
- Users choose start/end, timezone, organizer, location, optional Microsoft Teams meeting, and agenda.
- Agenda starts empty: users explicitly choose what ticket information to share. Internal notes and full conversation history are not automatically copied into calendar invitations.
- Actions include Save Draft, Send Invitations, Save & Send Update, Retry Sync, Cancel Meeting and Complete.
- Meeting states: `DRAFT`, `SCHEDULED`, `CANCELLED`, `COMPLETED`. Calendar sync states are separate: `NOT_SYNCED`, `PENDING`, `SYNCED`, `FAILED`.
- Calendar provider IDs, Outlook/Teams links, timestamps and sync errors are retained. Activities appear in the ticket timeline and sensitive operations are audited.
- Completed/cancelled meetings are protected from editing; the organizer cannot change after invitations have been sent.
- Completing a meeting records meeting progress without closing or completing the ticket. The ticket remains available for subsequent work and additional meetings.
- This is not a claim of bidirectional Outlook synchronization, RSVP polling, recurring-meeting support or a dedicated meeting-minutes subsystem. Inspect code before promising these extensions; internal ticket notes remain available for follow-up records.

API base: `/api/tickets/:ticketId/meetings`. Existing routes cover list/create/update, schedule, retry, cancel and complete. Permissions are `ticket_meetings.view`, `.create`, `.update`, `.cancel`. New tables/models include `TicketMeeting`, `TicketMeetingAttendee` and `TicketActivity`; migration: `20260904120000_ticket_meetings`.

The shared `microsoft-calendar` service is used with the existing calendar settings. Microsoft Graph application permission `Calendars.ReadWrite`, administrator consent and access to the organizer mailbox are prerequisites. Scope mailbox access appropriately. Settings being enabled and credential references being present do not prove Graph permission or mailbox policy acceptance.

## 6. Local development and validation

This Mac uses Apple Silicon. Previously verified tooling was Homebrew under `/opt/homebrew`, nvm, and Colima with Docker Compose. Do not assume Docker Desktop or a particular Node version is currently active. Check tools and existing processes before starting or installing anything. Local services were stopped after the earlier implementation; their state was not checked on 2026-09-08.

Use the existing local environment if present. Do not overwrite `.env`, copy production credentials into local testing, recreate an initial migration, or seed an existing database merely to resume work. Inspect database target and migration status before any persistent operation. Compose provides PostgreSQL, Redis and Mailpit; start only the local services needed for the task.

Established commands:

```bash
git status --short --branch
git fetch --prune origin
git rev-list --left-right --count HEAD...origin/main
git diff --stat
npm run prisma:generate
npm run lint:api
npm run lint:web
npm test
npm run build
npm run test:browser
```

The API/web `lint` scripts currently perform TypeScript no-emit checks. `npm test` runs backend Jest tests, and browser tests are separate. New schema work uses a focused new migration; production uses `migrate deploy`, never `migrate dev` or an initialization seed.

Local URLs: web `http://localhost:3000`, API health `http://localhost:4000/api/health`, Mailpit `http://localhost:8025`. `npm run dev` starts API/web; start it when runtime checks are needed.

Historical release validation from 2026-09-04: Prisma generation/validation, API/web type checks, 28 API suites with 114 tests, full build, 30 browser tests across Chromium/Firefox/WebKit, and a local API smoke check passed. These are prior release results, not fresh results from this handoff. Browser layout coverage does not establish complete end-to-end acceptance of every workflow or every mobile device.

## 7. Production continuity

- Native Ubuntu/systemd host, checkout `/opt/avidity/app`, service user `avidity`.
- Services: `avidity-api` and `avidity-web`; internal API port 4000, web port 3000.
- Main application: `https://one.aviditytechnologies.com`.
- Event Portal: `https://events.aviditytechnologies.com`.
- Support Portal: `https://support.aviditytechnologies.com`.
- Runtime configuration is in `.env.production`. Keep `API_URL=http://localhost:4000` unless live topology inspection demonstrates a change. Browser-facing values and origins use the configured public domains.
- Prisma requires explicit loading of `.env.production` using `DOTENV_CONFIG_PATH=.env.production node -r dotenv/config ...`.
- Build with the documented Node dotenv wrapper. Do not set `NODE_OPTIONS="-r dotenv/config"`; this previously broke Next worker processes.
- Existing Docker production instructions and old single-domain examples are historical; do not deploy them over the native systemd installation.

Last deployment, 2026-09-04:

1. `fb62bb5` was pushed to canonical `main`.
2. Server starting revision was `d1e28a6`; it was fast-forwarded to `fb62bb5`, including the intervening AI selection fix.
3. The server lacked a reusable Git credential. Deployment used an incremental Git bundle verified by checksum and `git bundle verify`, transferred through the authenticated Tactical RMM remote terminal/file browser. It did not require exposing a GitHub password or token.
4. Prisma client generation, the ticket-meetings migration and application build succeeded. Both systemd services were restarted and active.
5. API health was 200; main login and both public portals responded successfully. The authenticated ticket UI displayed Meetings. The final journal error check had no entries.
6. Production and local Git worktrees were clean. An install-generated server lockfile metadata change was reviewed and restored only because the pre-install tree had been confirmed clean. This is not permission to discard future server changes.
7. Four meeting permissions and 17 role assignments were observed. Calendar integration was enabled and its required configuration references were populated.
8. No real invitation, update or cancellation was sent in production. That acceptance test remains pending.
9. Temporary deployment bundles were removed from the server and moved to the local Trash.

For a future authorized deployment, inspect server revision/status as `avidity`, verify a backup/recovery approach for any new migration, update with a fast-forward, load the correct environment, generate/migrate/build, restart the relevant services, then verify revision, health, logs and actual UI. Do not treat the historical health checks as current evidence.

## 8. Open items and boundaries for the next module

- **Git deployment authentication:** future normal server `git pull` operations still need a usable read-only deploy key/token unless configuration has since changed. An approved token shown in GitHub was not enough because its secret was not installed on the server. Never ask for account passwords in chat; do not include credentials in URLs or shell history.
- **Calendar acceptance:** run a controlled create/update/cancel test with designated participants when authorized. Confirm actual Microsoft permission, mailbox access and Teams support. Do not send invitations to real customers merely to smoke-test a release.
- **Dependency findings:** the September 4 install reported 13 vulnerabilities (6 moderate, 7 high); GitHub reported 28 alerts (20 high, 8 moderate). These are historical tool counts, not a current exploitability assessment. Refresh and assess separately before choosing compatible fixes; do not force automatic upgrades.
- **Documentation drift:** early roadmap/setup/editor documents lag implementation. This handoff corrects continuity but is not a complete rewrite of all project documentation.
- **TacticalRMM:** remote administration of the host through its web interface is distinct from implementing its integration inside Avidity One. Verify actual integration code before making capability claims.
- **Security backlog:** older docs mention CSRF, attachment scanning/content checks and proxy hardening. Assess current implementation before treating each historical item as an open vulnerability or completed protection.
- **New module:** its requirements have not yet been supplied. Reuse existing organization/client/user/permission/settings/audit/project/ticket relationships instead of creating duplicate infrastructure.

Prior planning context, not implemented functionality: a Microsoft Cloud / Microsoft Cloud Center initiative was paused. It proposed multi-client Microsoft 365/Entra/Exchange/Teams/SharePoint/Intune/Defender and later Azure administration, using Lighthouse/GDAP and appropriate APIs, starting read-only and later adding controlled, audited actions and licensing workflows. If the user's new request resumes this initiative, first verify the original requirements and current vendor contracts/permissions. Do not infer that this is the unnamed next module or that tenant administration/purchases are authorized.

## 9. Engineering and collaboration rules

- Read before modifying; protect working behavior and pre-existing local/contributor changes.
- Inspect Git, fetch canonical origin and compare upstream before implementation. Never reset, force-push or silently discard work.
- Keep changes focused and compatible with existing NestJS/Next/Prisma patterns; no unrelated refactors or dependency upgrades.
- Keep code, labels, comments, tests and repository documentation in English.
- Branding, presentation, portal fields and relevant behavior are Settings-driven. Keep Users under Settings > General, Profile separate, and operational UI responsive and scannable.
- Use permission strings and server-side organization scoping; UI visibility alone is not authorization. Audit sensitive actions and preserve existing soft-delete/audit conventions.
- Sanitize untrusted HTML before save/render; preserve private attachment access and avoid putting internal ticket content or secrets into external invitations/AI prompts.
- No secrets, environment files, logs, database dumps or storage contents belong in Git or a handoff.
- Use explicit user scope for implementation, publication, external messages and production changes. The previous deployment authorization does not authorize deployment of a future unspecified module.
- Report concrete validation and limitations. Do not claim an end-to-end workflow was tested from a passing build or a visible button alone.

## 10. Suggested first steps in the new chat

1. Read `AGENTS.md`, the continuity update in `PROJECT_HANDOFF.md`, and this document.
2. Verify current Git state and inspect the two local documentation changes before editing.
3. Read the user's new module requirements; identify affected modules, relationships, permissions, public/external effects and migration needs.
4. Inspect source/tests at those integration points. Present a concrete scope and implementation plan when the request is for analysis; implement when authorized.
5. Validate in proportion to the change, preserve the ticket/editor/calendar regression boundaries, and publish/deploy only within the user's authorization.

No new chat was automatically created, and no application code, production configuration, credentials or persistent data were changed while preparing this handoff.
