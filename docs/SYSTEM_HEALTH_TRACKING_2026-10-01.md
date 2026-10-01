# System Health and Devices synchronization tracking — October 1, 2026

## Scope

Approved implementation from clean canonical `main` at `d5cca7e13f908e328effd1fa48e843e5374334fd`. Publication is authorized; the user will execute the production update. No dependency, credential, environment, RMM interval, permission-assignment or infrastructure changes.

## Behavior

- Devices / RMM Sync uses saved provider/scheduling state and real synchronization outcomes. It distinguishes current, running, stalled, overdue, postponed, partial, failed, manual-only, disabled and not-yet-observed states. The card includes interval, last attempt and age, last successful inventory sync, next automatic run, latest processed/created/updated counts and duration when recorded. It links to Devices and RMM Settings only with their existing permissions.
- Last successful inventory synchronization is retained separately from last attempt. It begins populating after deployment; it is not inferred from old messages. Successful inventory imports with incomplete hardware detail retain a warning. Automatic and manual outcomes plus deferrals append organization-scoped health records. Monitoring write failures are logged without invalidating an inventory import. Reading System Health never starts a sync or sends a test message.
- Refresh in Settings also reloads Health. The panel refreshes every minute while visible. Late responses are discarded; diagnostic summary remains visible with a stale-history warning if history fails. Run Check explicitly records a snapshot. All displayed dates use the organization timezone and 12/24-hour choice.
- Current components precede history/timeline; warnings/errors are prioritized. Evidence labels distinguish live database/scanner checks, configuration checks and recorded state. Disabled RMM/AI/support portal integrations are neutral. Antivirus-disabled remains a warning because attachment scanning protection is absent.
- Timeline percentages refer to assessed intervals, not uptime. Coverage separately measures intervals containing observations. Unknown/disabled intervals are not counted as healthy. Yearly history/timeline both cover 365 days. Timeline data is aggregated in PostgreSQL rather than loading every individual snapshot into API memory.
- History has component/state filters, 25-row server pagination and totals across the entire matching period, without the previous 300-row truncation. Source labels distinguish automatic/manual checks and RMM outcomes. Snapshot timestamps are observations, not continuous monitoring.
- Automatic checks cover every organization, use the existing interval (15 minutes unless configured otherwise), and continue if another organization's check fails. Audit counts and health history are scoped to the authenticated organization. Clock reads share an organization cache for up to 15 seconds; users without Settings-view permission receive component names/states without diagnostic metadata.
- Database failure is returned even if saving its snapshot fails. Storage checks resolve the same path base as the storage provider. Individual check failures become unknown rather than suppressing the other results.

## Data compatibility

One transactional additive migration adds nullable organization ownership plus source to health snapshots, supporting indexes/FK, and a nullable last-success timestamp to system settings. Existing snapshots remain unchanged with null ownership and source `legacy`. They are retained in the existing table but excluded from organization views; ownership is never guessed. The new timeline will initially show unknown periods. Run Check adds the first scoped observations; the next real RMM run populates last-success/counts.

This release does not migrate historical snapshots to an organization, delete records, reconstruct missing sync runs, or enable integrations. Existing business data and RMM cadence remain unchanged.

## Validation

- Prisma client generation and schema-diff SQL comparison completed. The migration matches the generated additive changes and wraps them in a PostgreSQL transaction.
- API/web TypeScript and production shared/API/web builds passed. Backend regression: 256 tests passed; 58 existing isolated-database cases skipped without their database configuration. New tests cover RMM states, organization query scoping, totals beyond 300, pagination, coverage, invalid filters, recording failure, multi-organization scheduling and permission-aware diagnostics/navigation.
- 24 browser cases passed across Chromium, Firefox and WebKit (9 Health and 15 Devices). They cover filtering, paging, parent refresh, explicit checks, stale history errors, timezone, coverage, neutral states and retained inventory behavior. Desktop/mobile screenshots were inspected; mobile history remains scrollable and visible.
- Isolated deployment tests cover success and backup/migration/build/health failure recovery, without touching real services.
- A real local PostgreSQL migration was not executed: Docker is unavailable and the installed libpq tools lack the PostgreSQL server binary. No database engine was installed. The deployment therefore includes a read-only schema/query smoke check against an empty organization scope before services restart. Live production and the next real RMM outcome remain post-deployment acceptance checks.

## Deployment

Run `scripts/deploy-system-health.sh <full-published-release-sha>` as root after fetching canonical origin. It accepts clean production `main` at `d5cca7e` or the exact target on retry, verifies migration/dependency scope, backs up database/source/runtime, applies the one additive migration, generates Prisma, builds both apps, checks the new history queries, starts both dependent services and checks local/public endpoints. There is a maintenance interruption during the build.

On failure, the prior runtime is restored while additive columns and existing records are retained. Git remains at the attempted release; inspect the printed recovery directory and failure before retrying. A failed transactional migration may require manual Prisma migration-state review; the helper does not bypass it or restore a database automatically.

After `Deployment complete`, open Settings > System Health and Run Check. Verify scoped observations, timezone, component/state filters, timeline coverage and Devices scheduling details. Confirm the next real automatic RMM run appears with counts and last-success time. No RMM reconfiguration is needed for this update.
