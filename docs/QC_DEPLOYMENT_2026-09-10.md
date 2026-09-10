# QC production deployment — September 10, 2026

The user explicitly authorized publishing QC and updating the production server through Tactical RMM. Application release **`b43bb7298b26be7fb9f7782367153425bfac1160`** was deployed successfully; this documentation-only follow-up does not change its application artifacts.

## Published changes

- `2f92274`: configurable QC schema, API, UI, measurement, inspection, follow-up, reporting and provider adapters.
- `b43bb72`: QC browser regression coverage.
- Canonical GitHub `main` was verified at the release SHA before transfer. No application CI workflow is configured in the repository and no CI run was reported for this SHA; validation is the observed local and production evidence below, not a claimed CI pass.
- Existing handoff edits were preserved and included with this deployment documentation.

## Server and update

- Target: `avidityhelpdesk`, native Ubuntu/systemd, `/opt/avidity/app`, service account `avidity`, Node `22.23.1`.
- Initial checkout was clean at `113955d42179f33e9c3300942f5f562224250e31`; `avidity-api` and `avidity-web` were active.
- Server `git fetch origin` still lacked a persistent GitHub credential. No credential was copied or created. The incremental Git bundle was uploaded through the authorized Tactical file browser, checked with SHA-256 and `git bundle verify`, then used to fast-forward the exact published release.
- Bundle SHA-256: `7c67b5e11b69688d1f89142ed05d64cd9d25cda5d5eb5fc0996018c8111ba609`.
- An online preflight database dump was verified through `pg_restore --list`. Services were then stopped for a second database backup and runtime/storage archive, followed by migration/build. No seed or destructive migration was run.
- All eight QC migrations applied; the deployment now has 88 migrations. Prisma generation and `npm run build` (shared packages, API, Next.js web) succeeded on the server.
- Both services started successfully; deployment completion and API health were observed at approximately `2026-09-10T16:56:36Z`.

## Verification

| Check | Result |
| --- | --- |
| Production application revision | `b43bb7298b26be7fb9f7782367153425bfac1160` |
| Service state | `avidity-api` and `avidity-web`: active |
| API health, local and public | HTTP 200, status OK |
| Main login, Event Portal, Support Portal | HTTP 200 |
| Unauthenticated `/api/qc/overview` | HTTP 401 |
| Authenticated Chrome session | Tickets and Dashboard loaded; system health reported database, storage, mail flow, portals, AI, scanner and audit OK |
| API/web error-priority journal after startup | No entries observed |
| QC program/capture | No program rows; zero captured events; capture/processing/delivery therefore inactive |
| Access catalog | 15 QC permissions; one unassigned QC Reviewer role; no new existing-user grants |
| Compiled API rewrite | `/api/:path*` to `http://localhost:4000/api/:path*` |
| Server Git worktree after application update | Clean |

The existing administrator session was redirected from QC to Dashboard because it has not been granted the new QC permissions. This confirms the access boundary; it is not full authorized-QC browser acceptance. An authorized administrator must select the intended roles/groups in Settings before the program owner can configure/use QC. Do not automatically grant QC to all technicians, managers or administrators.

Local acceptance before publication: 32 API suites/146 tests, 57 browser tests across Chromium/Firefox/WebKit, both TypeScript checks and full build passed. Database integration scenarios used only a disposable synthetic PostgreSQL database. Actual customer replies, calendar invitations, device changes, external notifications and production historical processing were not exercised during deployment.

## Environment clarification

Preflight initially halted before stopping services because legacy `API_URL` was `http://localhost:400`. The user asked about the consequences of changing it. Source inspection showed that current code reads `INTERNAL_API_ORIGIN` for the Next rewrite and `NEXT_PUBLIC_API_URL` for browser API requests; it does not read legacy `API_URL`. The deployment check was corrected to inspect the active variable, and the build's actual rewrite was confirmed at port 4000.

**No production environment variable, credential, Nginx or systemd definition was changed.** The initial proposed `API_URL` correction was not needed and was not performed.

## Recovery and remaining activation

- Main recovery directory: `/opt/avidity/qc-backup-b43bb72.p3iPyr` (restricted to root). Contains a custom PostgreSQL dump, verified catalog, runtime/storage archive, source archive at the previous revision, prior commit marker and checksums.
- An additional online preflight dump is retained under `/opt/avidity/qc-preflight-b43bb72.k1G1QI`.
- Deployment log: `/tmp/deploy-qc-b43bb72-final.log`, restricted to root. Database/backup contents were not copied off the server or committed.
- No restore was performed. Before any rollback after future QC capture, follow the retention warning in [the runbook](QC_RELEASE_READINESS_2026-09-10.md); older Maintenance code does not understand QC-retained files/history. Prefer a forward fix and disable processing/delivery first if needed.
- Configure intended user/group permissions, real business schedules/SLA/rubrics/sampling, historical mode and failure consequence before activation.
- Teams remains internal-only and needs actual tenant/bot/channel setup and authorized pilot. Outlook and RMM provider acceptance remain pending. External contacts require separate validation.
- The real Meetings invitation lifecycle and persistent server Git credential remain separate unresolved continuity items.
