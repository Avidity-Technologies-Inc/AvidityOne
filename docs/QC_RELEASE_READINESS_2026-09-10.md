# QC local release candidate and activation runbook

Updated September 10, 2026. Canonical repository: `Avidity-Technologies-Inc/AvidityOne`. Working branch: `codex/qc-module`; base `113955d42179f33e9c3300942f5f562224250e31`. This is local, uncommitted implementation. No QC push, production migration, server restart, external message or provider registration was performed.

The source specification, [implementation plan](QC_IMPLEMENTATION_PLAN.md) and [requirements matrix](QC_REQUIREMENTS_MATRIX.md) remain the scope ledger. The local application paths are implemented; **controlled production pilot and full business/provider acceptance (M5) remain pending**. Do not equate synthetic validation with production acceptance.

## Delivered application paths

- Permission-scoped QC workspace, queue, read-only inspection evidence, weighted published rubrics, safe bulk disposition, flags, private coaching/corrective actions, acknowledgment, verification, recognition and subsequent-work reinspection.
- Persisted agreement types/categories, effective-dated client/project/category/priority policies, configurable first public response or technical touch, timezone/working-hours/holiday clocks, selected pause states and scheduled holds. Published policy and rubric revisions remain attached to historical results.
- Atomic source capture for ticket changes and accepted human messages, separate reopened cycles, deterministic auditable sampling, mandatory pulls and seven configurable exception rules. A late exception preserves the completed score and creates a linked follow-up review.
- Structured resolution evidence and append-only labor/corrections; actual client/device/Tactical RMM check correlation with retained verification state and observation freshness. No device remediation is performed by QC.
- Creative project deliverables, optional linked Event & Services request and Knowledge Base procedure, proof/approval/revision/final-delivery history, original versus revised commitments, private versioned proof files and labor. Proof and final-delivery review checkpoints are configurable.
- Scoped technician/client/creative metrics, sample sizes, incomplete/historical evidence labels, period trends, internal CSV and dedicated client-safe export. Personal context is linked from Profile; Tickets, Clients, Projects, Operations, Reports and Settings link to QC.
- Configurable coaching or billing hold on failure. Held ticket work is blocked in the existing per-ticket financial estimate, including its shared report execution path. `GET /api/qc/tickets/{ticketId}/billing-eligibility` exposes ticket eligibility for future invoice consumers. There is no external invoice-system enforcement or newly invented invoice module.
- Durable recipient/channel/tier outbox, explicit attempts, accepted/failed/unknown states, acknowledgment, quiet hours, urgent exceptions, rate limits, daily/weekly summaries and escalation delays. In-app delivery is connected; Outlook reuses existing Microsoft mail delivery; Teams uses a bot with authenticated callbacks for acknowledgment, review assignment and private note.

Implementation locations: `apps/api/src/modules/qc/`, `apps/web/src/components/qc/`, `apps/web/src/app/qc/`, `packages/shared/src/qc.ts`, `prisma/schema.prisma` and eight `20260910*_qc_*` migrations. Existing-module changes are limited to registration, navigation/context, RMM observation, retention and the financial estimate hold. The existing ClamAV test fixture now waits for complete TCP framing; production scanner behavior is unchanged. No dependency or lockfile changes were required.

## Configuration and identity

All three program switches initially remain off: **capture, processing, delivery**. Installing the schema does not create a populated QC program or enable business rules. No names, client IDs, addresses, calendars, SLA targets, sampling percentages or provider credentials are seeded.

An existing authorized access administrator can assign new QC permissions through the normal Settings groups/roles UI after deployment. The migration provisions an **unassigned** `QC Reviewer` role with `qc.view`, `qc.view_all`, `qc.reviews_perform`. Existing roles and memberships are preserved; inspect combined group memberships before describing anyone as reviewer-only. Existing user sessions may need refresh/sign-in after grants.

Suggested capability sets to configure, not automatic grants:

| Responsibility | Permissions |
| --- | --- |
| Technician | `qc.view`, `qc.work_record`, `qc.actions_complete_own`; own-work scope |
| Reviewer | `qc.view`, `qc.view_all`, `qc.reviews_perform`; no source ticket mutation permission required |
| QC program administrator | `qc.view`, `qc.view_all`, `qc.settings_manage`, `qc.rubrics_manage`, `qc.reviews_assign`, `qc.coaching_manage`; add bulk/override/export only when needed |
| Delivery administrator | `qc.view`, `qc.view_all`, `qc.notifications_manage`; settings permission needed to edit overall program configuration |
| Billing release authority | `qc.view`, `qc.view_all`, `qc.billing_release`; reason and verified corrective work required |

Create/publish the actual service and creative rubrics. Configure owner, leadership identities, anchor clients, sampling period/percentage/minimum/dimensions, queue age, labor threshold, enabled flags and thresholds, failure consequence and historical mode. Create agreement types and applicable SLA policies with the correct timezone/coverage and first-response definition. Missing or ambiguous SLA applicability is displayed as incomplete; it never becomes a fabricated pass.

The user chose to measure historical work. Select **Include history** in the real program after the administrator validates scope. Historical import occurs in small, idempotent batches while processing is enabled; no separate production seed/backfill command is needed. Retained creation/messages/close evidence is used, missing old ownership/pauses/reopens remain unknown, and historical elapsed-time statistics are distinguished from contractual business-time compliance. Do not claim that applying today's SLA recreates an undocumented old agreement.

Changes create audited configuration revisions. Published policies/rubrics are immutable and must be replaced by a new revision. Selected cycle configuration/policy and finalized scores remain retained. No timestamp/backdating or score-overwrite API is exposed.

## Teams, Outlook and external-contact boundary

The user selected the **internal organization Teams channel**. Configure the real tenant ID, bot application ID, `env:` secret reference, team ID and channel ID. The application displays callback/setup diagnostics without exposing credentials. Actual tenant registration, permissions, bot installation, internal identity linking and channel audience validation must occur during a separately authorized provider setup. No incoming webhook is treated as an authenticated interactive bot.

The Teams setup view returns the callback under the configured application URL: `/api/qc/teams/{organizationId}/activities`. Only signed Microsoft connector activities with the configured tenant, application and internal linked actor are accepted. Installation/conversation references are retained from verified activities. Card actions enforce current permissions, intended recipient, record version, expiry and single-use action IDs. Provider acceptance is not human acknowledgment.

Channel cards omit private reviewer/coaching text. The optional basic-work-details setting should be enabled only after the whole channel's audience is validated. Personal actions remain restricted to eligible internal identities. **External client/contact addressing is not enabled; a future request must validate the named external audience explicitly before implementation/activation.**

Outlook uses a configured active Microsoft mailbox and linked internal recipient identity. Select actual routes, delivery timezone/hours/holidays, hourly limits, urgent override, daily time and weekly day/time. Escalation can optionally stop on acknowledgment; acknowledgment does not complete the underlying work. Unknown outcomes require manual reconciliation before retry to avoid duplicate external sends.

Required live pilot: authorized internal channel and personal card, Outlook mail, wrong/uninstalled identity, provider rejection/throttle/timeout, ambiguous acceptance, acknowledge/assign/note, expiry/replay, quiet hours, tier stop and daily/weekly digest. No such live provider test is claimed in this release candidate.

Provider references used for the implementation:

- [Microsoft connector authentication](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication?view=azure-bot-service-4.0)
- [Teams proactive messaging](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages)
- [Teams card actions](https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-actions)
- [Tactical RMM API](https://docs.tacticalrmm.com/functions/api/)
- [Tactical agent route definitions](https://github.com/amidaware/tacticalrmm/blob/develop/api/tacticalrmm/agents/urls.py)

RMM reads the existing configured provider connection and agent-scoped check result. Configure the actual device/check ID, alert time, verification mode, freshness and acceptable statuses. Installed production provider version/response shape and a real corresponding observation remain pilot checks. Unavailable, stale or missing evidence is never reported as verified.

## Processing, retention and recovery

QC uses a 60-second Nest polling loop with PostgreSQL advisory locks, event receipts and durable outbox. It introduces no separate queue service or systemd unit. Processing handles batches of pending events, active work and historical tickets; repeated passes do not duplicate sampled reviews, reinspection consumption or accepted in-app notifications. A failed pass records a generic error/last-success timestamp; pending source events remain retained. Inspect QC Overview and Delivery audit during activation.

An interrupted external dispatch can have an unknown outcome. The attempt ledger retains that state for authorized reconciliation; automatic blind replay is not used. Delivery retry and acceptance reconciliation require reasons. Disabled/removed routes, lost recipient access, acknowledged optional tiers and completed work are reevaluated before sending.

Reports reject datasets exceeding 10,000 records per dataset and require a narrower scope rather than silently truncating results. Historical import is 20 tickets per batch. Synthetic tests do not establish production volume capacity or all integration outage behavior; monitor backlog/processing time during the pilot.

QC events, configuration/rubric history, time corrections, sampling populations, RMM observations and attachment records are retained through database constraints/triggers. This protects application operations, not a database superuser. Maintenance excludes QC-retained tickets and their files from permanent recycle-bin cleanup. Existing ticket soft deletion is preserved. A future retention/erasure policy requires an explicit migration-safe archival design; no blanket purge is introduced.

Private creative uploads reuse existing attachment validation/storage/ClamAV settings. CLEAN/PENDING/BLOCKED status remains visible; pending files follow the existing application policy, not an invented scan guarantee. Blocked/suspicious files cannot be downloaded. New proof files preserve earlier revisions. Existing quarantine administration covers ticket/event attachments; creative blocked files remain retained and a corrected proof can be uploaded separately.

Recovery after activation first disables QC delivery and processing using the new application, retaining capture/history if operationally healthy. Prefer a forward fix. **Do not blindly roll back to an old binary after QC capture:** old Maintenance code does not know QC retention and could remove files before a database foreign-key failure. A prior build is acceptable only after its maintenance/retention behavior is made compatible and verified. Do not drop QC tables/triggers, rewrite history or reset the database as rollback.

## Local validation evidence

All migration and integration operations used a disposable `postgres:16-alpine` container named `avidity-qc-validation`, bound only to `127.0.0.1:55473`, database `qc_validation`. The application `.env` database and production data were not migrated or seeded. Integration suites refuse any other hostname/port/database and use independent synthetic organizations. Real provider calls were replaced only inside tests.

Final validation on September 10, 2026:

| Check | Observed result |
| --- | --- |
| API tests with the explicit isolated QC database | **32 suites, 146 tests passed**, including 32 QC tests |
| `npm run lint:api` and `npm run lint:web` | Both passed |
| `npm run build` | Shared packages, Nest API and Next web passed; QC dynamic route included |
| `npm run test:browser` | **57 passed** across Chromium, Firefox and WebKit (12 QC, 45 existing regression fixtures) |
| Prisma generation/migrations | Passed against the dedicated synthetic database only |
| `git diff --check` | Passed |

The final full API run initially exposed an existing scanner test TCP-fragmentation race (`write after end`). Its server fixture was corrected to wait for the terminating zero-length frame and now asserts the entire transmitted payload. The final full run passed without changing production scanner behavior. Playwright WebKit omits uploaded file bytes from intercepted post data; the browser test verifies its actual FormData bytes as well as the request route/filename, while the authenticated runtime test verifies real multipart upload, stored hash and downloaded bytes.

- Prisma generate and all 88 migrations (80 existing plus eight QC) applied successfully to the isolated database, including immutable constraints and the unassigned role.
- `qc.rules.spec.ts`: working intervals, DST/holidays/holds, score validation and deterministic sampling.
- `qc.database.spec.ts`: source capture, immutable history, owner/organization scope, claim race, safe bulk work, rubric/scoring/failure, verified corrections/billing release, historical completeness, late-flag follow-up and two subsequent reinspection closures.
- `qc.runtime.spec.ts`: actual Nest module with session/permission guards and PostgreSQL; invalid sessions/DTOs, policy revision retention, creative proof/revision/approval/reschedule/delivery, private upload/download/blocked files, RMM unavailable/verified fixtures, concurrent in-app dispatch/acknowledgment stop, sampling, evidence pagination and signed Teams callback rejection scenarios.
- `qc.teams.spec.ts`: restricted connector/identity paths without a real tenant.
- Browser tests mount actual QC React components/styles with isolated API responses: responsive light/dark overview, configuration with selected record IDs, failed scoring comments/current version and private creative upload. Existing editor/selection/signature/Meetings fixtures also run. These are not a live authenticated browser-to-production acceptance test.
- Visual inspection of overview light/dark, Settings, inspection and creative proof layout uses generated local screenshots. No screenshots, storage payloads, logs, credentials or test databases belong in Git.

### Reproduce isolated integration validation

Use an unused container name/port and the existing local PostgreSQL image. These commands intentionally target only a new disposable database. Do not substitute an application or shared database URL. The test suites skip database scenarios if `QC_TEST_DATABASE_URL` is absent.

```bash
docker run --name avidity-qc-validation --rm -d -p 127.0.0.1:55473:5432 -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_USER=qc_validation -e POSTGRES_DB=qc_validation postgres:16-alpine
```

After that dedicated database is accepting connections:

```bash
DATABASE_URL=postgresql://qc_validation@127.0.0.1:55473/qc_validation npm run prisma:generate
DATABASE_URL=postgresql://qc_validation@127.0.0.1:55473/qc_validation node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma
npm run build:shared
QC_TEST_DATABASE_URL=postgresql://qc_validation@127.0.0.1:55473/qc_validation npm test
npm run lint:api
npm run lint:web
npm run test:browser
npm run build
docker stop avidity-qc-validation
```

The final command removes only that test container and its synthetic data. Leave other project containers and the shared container runtime running. The validation container used for this task was stopped after the final successful checks.

## Authorized release procedure, not executed

Publication and server update are separate next actions after review. Recheck canonical Git divergence and preserve the two handoff files before composing the QC commit. This document intentionally contains no invented release SHA. Review and publish a concrete commit, then record its SHA and CI result.

On a future authorized maintenance window, inspect `/opt/avidity/app`, revision, Git status, ownership, runtime versions, `.env.production` key names, backup/restore readiness, pending migrations, API/web service health and real database target without printing secrets. Preserve `API_URL=http://localhost:4000` unless inspected topology proves otherwise. No Nginx/systemd/DNS changes are required by QC.

The following existing commands are the application update steps **after** the reviewed release is published, the server target and backup are verified, and deployment is authorized. Do not run the initial-install seed or Docker section of the older deployment guide. Avoid building Next into a running checkout during user traffic; use the approved maintenance window and stop services before the in-place build.

```bash
cd /opt/avidity/app
git status --short
git fetch --prune origin
git log -5 --oneline
```

Confirm the expected approved commit is the revision that will be pulled and the checkout is clean. Then:

```bash
git pull --ff-only origin main
sudo systemctl stop avidity-api avidity-web
sudo -u avidity bash -lc 'cd /opt/avidity/app && DOTENV_CONFIG_PATH=.env.production node -r dotenv/config ./node_modules/prisma/build/index.js generate --schema prisma/schema.prisma'
sudo -u avidity bash -lc 'cd /opt/avidity/app && DOTENV_CONFIG_PATH=.env.production node -r dotenv/config ./node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma'
sudo -u avidity bash -lc 'cd /opt/avidity/app && node -e "require(\"dotenv\").config({ path: \".env.production\" }); const { spawnSync } = require(\"node:child_process\"); const result = spawnSync(\"npm\", [\"run\", \"build\"], { stdio: \"inherit\", env: process.env }); process.exit(result.status ?? 1);"'
sudo systemctl start avidity-api avidity-web
sudo systemctl is-active avidity-api avidity-web
git rev-parse HEAD
```

Run each stage only after the previous stage succeeds; a failed build/migration requires inspection before starting services. Never pass `NODE_OPTIONS="-r dotenv/config"` to the Next build. Dependency versions are unchanged; restore exact locked packages only if the server inspection shows they are missing/out of sync. Record backup/recovery and service health using the established operational procedure.

Verify the new revision, authenticated QC access, permissions, initially disabled switches, current ticket composition/Enter/selection/signatures, replies, Meetings independence, portal intake, Projects/Event links, file downloads and existing report generation. Then configure QC, activate capture, validate representative source events, enable processing with approved rules, review historical completeness/backlog, and only later enable delivery after real provider pilot acceptance.

Release acceptance remains open until the program owner accepts service, failure/correction/reinspection, creative, historical, privacy, provider and recovery journeys in the requirements matrix. Pending real Meetings invitation testing and persistent server Git credentials are separate continuity items; this QC implementation did not resolve them.
