# Compact report controls — 2026-09-21

Follow-up to the Reports workspace release at `6189269fe34ee6916f572060e0cd440f95a9f79a`. Work remains on canonical `main` without additional branches or worktrees.

## User-visible changes

- The oversized Reports banner is removed. The page title shares the report-type/action toolbar. Filters, navigation and indicator cards use less vertical space, filters can collapse, and success notices can be dismissed.
- **Customize report content** and **Export options** share one selection of individual indicators, activity, distributions, applied criteria and detail. Tickets support client, technician, status, priority, source and team breakdowns. Events support service and task-status breakdowns. Projects expose health and their executive indicators. Options come from a shared catalog; values still come from scoped source records.
- **Include all sections** and **Detail only** provide starting points. The manual estimate indicator is available only when estimates are configured. At least one section remains selected. Columns and their order are independently configurable.
- All detail columns support ascending/descending order, including requester, configured status names, full technician text, file/task counts and project decision signals. Text uses case/accent-insensitive natural alphabetical order; numeric values and dates use their real types. Missing values sort last. Priority/status text sorts alphabetically, not by enum storage position. Stable IDs break ties.
- **Exclude** removes an individual record from this report's source set; it does not modify the original ticket, request or project. Totals, activity, breakdowns, pagination and exports all use that reduced set. **Restore excluded records** clears exclusions. Up to 100 explicit IDs are supported to keep request URLs bounded; use existing filters for broader selection. Exclusions and sort order persist with saved reports and scheduled exports.
- Content selection controls both the view and PDF/Excel. Excel contains only selected sheets/metrics/distributions. CSV remains a flat selected-column detail export, as described in the dialog. Detail-only PDFs start their table on the first page instead of adding a mostly empty cover. Basic PDF identification, period, scope and timezone remain visible even when detailed criteria are excluded.

## Compatibility and correctness

No schema, migration, environment, dependency or permission-grant changes. Existing organization scoping, private/shared report visibility, QC financial holds and schedule-owner authorization remain enforced. No source records or real messages were changed during implementation.

Legacy saved `summary`/`charts` section values expand into the granular catalog; missing selections retain the complete report. New saves use explicit section keys. Existing JSON definition storage carries the new selection/exclusion fields without a migration.

To support every displayed/computed column consistently, ticket/event detail now sorts the metadata snapshot already loaded for totals, then paginates that ordered snapshot. This replaces the previous second database detail query; it does not load ticket conversation bodies or attachments. Both view and export use the same ordering. As before, exceptionally large report cohorts consume application memory and may require a narrower date range; there is no silent result cap.

## Validation and release

API/web type checks and the shared/API/web production build passed. The full API suite passed 158 tests, with 28 existing database-gated cases skipped because an isolated database URL was not supplied. All 28 focused report cases passed after the final renderer changes. All 21 browser cases passed across Chromium, Firefox and WebKit. Browser coverage uses the real React workspace with synthetic API responses and covers compact/responsive layouts, light/dark themes, granular selection, saved report reload, project ordering, exclusions, export parameters and existing read-only permissions.

Synthetic PDF/Excel exports verified selected-only sections, preserved accents, last-record inclusion and one-page detail-only layout. PDF pages were rendered and visually inspected. No production query acceptance or real mail delivery was performed.

Deploy with `scripts/deploy-report-controls.sh <full-published-sha>` after fetching `origin`. It requires clean production `main` at the reviewed base or the exact target for retry, rejects database/dependency changes, backs up source and compiled runtime, fast-forwards to the exact release, rebuilds shared/API/web and checks local/public endpoints. Both services are stopped during the build. Configuration is read without modification. On failure it attempts runtime recovery without resetting Git; inspect health before retrying.

After deployment, verify a known report, hide individual indicators/charts, sort a calculated column, exclude/restore a record, save/reload the configuration and compare a PDF/Excel export. Existing schedules continue using their saved settings.
