# Reports workspace and export release — 2026-09-21

## Scope and semantics

Implemented on canonical `main` from `52896197e99b1dd3b5158304a706d699a6c6dafc`. No extra branch or worktree was created. Production deployment is a separate, pending operation.

- Tickets, Event & Services, and the executive project portfolio share an export column catalog and document renderer. QC remains a separate, permission-controlled link. No QC activation or ticket workflow changes are included.
- Ticket cohorts can use created, last resolved, or last closed timestamps. Event cohorts use created timestamp or the stored event calendar date. Start/end dates are inclusive and timestamp boundaries use the organization timezone or the explicitly chosen timezone. Event calendar dates retain their stored date without applying an offset twice.
- Relative periods include last 7/30 days, current month to date, previous calendar month, and previous Monday–Sunday week. Fixed saved dates remain fixed. Weekly activity buckets use their Monday date.
- Summary counts describe the **current state of matching records**, not a reconstructed historical status snapshot. Activity counts only retained created/resolved/closed or completed/cancelled timestamps inside the selected period, within that cohort. It does not reconstruct every historical reopen/closure cycle.
- Summary queries read all matching metadata in batches inside a repeatable-read transaction; detail pages use database pagination and deterministic ordering. The previous 2,000-record, 80-row PDF and 45-project PDF caps are removed. Metadata is still aggregated in application memory; exceptionally large datasets can require a narrower period or a later asynchronous export architecture. There is no silent truncation.
- Deleted attachments are excluded. File counts include active regular and inline attachments. Unassigned-ticket counts mean no technician **and** no team. Technician breakdowns count a matching record once per assigned technician, so shared assignments can make their total exceed the record count. Event assignments include request and task technicians, deduplicated by user ID. Identically named people/clients are counted separately.
- Estimates are optional manual values, not recorded revenue or invoices. Users choose an ISO currency and a nonnegative value explicitly; zero remains zero. Currency/rate persist with the saved report. Existing QC billing holds continue blocking financial estimates. Legacy estimate definitions without a currency require configuration rather than silently assuming USD.

## Interface

Reports has separate Overview, Saved reports, Schedules, and Export history sections. Filters apply explicitly; pending or failed queries cannot export stale results. Request cancellation prevents older responses from replacing newer selections. Source links preserve existing ticket and event routes and require the corresponding source-view permission.

The detail table preserves full text, allows ordered column selection and supported database sorting, and scrolls horizontally on narrow screens. Charts show true zero values and all categories in bounded lists. Light/dark themes use existing application colors. The export dialog contains its own scrollable body, persistent actions, focus containment and Escape handling.

Export options include PDF/Excel/CSV, selected ordered columns, all matching records or current detail page, document title, paper, orientation and summary/breakdown/detail sections. The dialog previews the scope and sample rows. Screen totals refer to all matches even when only a detail page is exported. Export generation re-queries the data using the displayed date boundaries, so intervening record changes can legitimately change the snapshot.

## Documents

- PDF: organization Settings provide company/app name, primary color and uploaded logo. Stored branding assets are read through the existing local provider; remote URLs are not fetched. Missing/unusable logos fall back to the company name. Embedded Liberation Sans fonts retain Latin accents; the bundled SIL OFL license is included. Summary cards use fixed origins, activity/distribution graphics preserve zeros, and rows wrap with repeated headers and page numbers. Wide tables are split into sections with the first selected column repeated. Very tall rows continue across pages; no record cap is applied.
- Excel: Criteria, optional Summary/Activity/Distributions, and optional Detail sheets. Dates and numbers are genuine Excel values, including local wall-clock timestamps documented with their timezone. Currency formats include the chosen code. Headers, banding, wrapping, freeze panes, filters and print settings are applied. Very wide detail sheets print across pages with the first column repeated, retaining readable type.
- CSV: remains a rectangular detail dataset with selected column order, correct escaping and formula-injection protection. It does not embed mixed-width metadata/summary rows. PDF and Excel provide those sections.
- Column names are validated against the shared server catalog; unsupported fields cannot expose arbitrary database fields.

## Saved reports, permissions and delivery

Existing definitions and schedules are retained. New definitions default to private. Read/update/delete access respects organization and private/shared visibility. Changes to definitions/schedules and their audit entries commit together. Report managers can manage accessible shared definitions. Each user manages their own schedules and sees their own export history.

Scheduling requires `reports.view`, `reports.manage` and `reports.send`, with `projects.view` for project reports. The scheduler derives the owner's **current** grants from existing group/role/permission relationships, checks the active account, organization and definition visibility, and preserves QC holds at execution. No real user permissions are added by this release.

Schedules persist frequency, local time, IANA timezone, weekday or month day. Days 29–31 clamp to the final calendar day of shorter months. Nonexistent spring-forward times move forward to a valid hour. Existing schedules retain their next occurrence; when explicit timing is absent, the next occurrence and organization timezone establish the recurrence.

An atomic compare-and-set claims and advances each due occurrence before generation/delivery. A process guard prevents overlapping local polls. This avoids automatic duplicate sends; an interrupted occurrence may require manual verification rather than automatic retry. A `running` result after interruption means delivery requires verification. Future regular occurrences can still execute.

History distinguishes file `generated`, provider `accepted`, `simulated`, and `failed`. Provider acceptance does not prove recipient delivery. Disabled outbound delivery raises an error and records failure. Mock providers never claim a real send. Legacy `downloaded`/`emailed` rows remain labeled as legacy entries.

## Validation

- Prisma client generation and schema diff verified: only nullable JSON `report_schedules.timing` is added. No existing rows are rewritten by the migration.
- API and web TypeScript checks and full production build passed.
- Full API regression run: 149 passed, with 28 existing database-gated tests skipped because no isolated database URL was supplied. After additional event/date/legacy-definition cases, all 22 focused report tests passed (152 distinct API cases verified across the runs).
- Full browser regression run: 158/159 passed. The existing Firefox ticket-composer scroll test failed once under concurrent execution and passed on its isolated rerun; no ticket code or test was changed. All 12 new report cases across Chromium/Firefox/WebKit passed. These mount real React components against synthetic API responses.
- Synthetic PDF/Excel/CSV generated through the actual compiled renderer. PDF text inspection verified the final record, accent preservation, page footers and absence of footer-only pages. Representative PDF pages and every workbook sheet were rendered and visually inspected. Excel tests verify all 114 rows, dates, zero currency, custom status names and styles.
- No real emails were sent. Live PostgreSQL migration/runtime queries and real Microsoft delivery were not executed in this turn. Production acceptance remains required after deploying.

## Deployment and recovery

Run `scripts/deploy-reports-workspace.sh <full-published-sha>` as root on `avidityhelpdesk`, after fetching canonical `origin`. It accepts clean `main` at the reviewed base above or the target for retries, validates migration/dependency scope, and stops if the server state differs.

The helper backs up source, compiled runtimes and PostgreSQL, applies the one additive migration, regenerates Prisma and builds shared/API/web packages using the existing `.env.production` without changing it. Both application services are stopped during this work. It then checks services and local/public endpoints.

On failure, it attempts to restore previous runtime artifacts and the prior generated Prisma client. It does not reset Git or restore/roll back live data. The nullable database column is compatible with the previous runtime and is retained. Git remains at the attempted revision; inspect the recovery directory and application health before retrying.

After deployment: open Reports, verify a known client's fixed date range, compare screen totals against PDF/Excel, inspect saved reports and a schedule's next run, and use an explicitly authorized recipient for a controlled mail-delivery test. Existing active schedules resume automatically; this release creates none.
