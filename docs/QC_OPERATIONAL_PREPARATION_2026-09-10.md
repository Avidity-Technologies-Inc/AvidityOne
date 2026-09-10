# QC operational preparation — September 10, 2026

## Scope and release state

The user approved the browser-led QC review recommendations, then clarified that operating targets and evaluation criteria are not available yet. Implement configurable preparation and clear next steps; do not invent values or activate measurement or delivery.

Application release `4119f61d2418750b8ec7b32bb1bda0c99c57c7df` is published on canonical `main` and deployed to production with explicit user authorization. It was based on `c226446`; the canonical remote was fetched with zero divergence and the existing worktree was preserved before publication.

## Application changes

- Move the existing ticket QC link from the title row into Ticket Tools, labeled **QC reviews**, preserving its actual ticket ID, permission check and destination. Its tooltip explains the action.
- Show the selected ticket number and subject above its review queue, with links back to the source ticket, QC work records and all permitted reviews. Fetch this context through the existing scoped QC ticket endpoint.
- Offer **Request inspection** to users with both `qc.reviews_assign` and `qc.view_all`. Reuse the existing audited, idempotent review endpoint and show the returned inspection link. Retain the reason after a failed request; do not imply that a view or click automatically evaluates work.
- Explain empty queues and provide an entry point to locate work. Show capture, processing and delivery state, saved configuration gaps and an explanation of the current user's QC access.
- Add authenticated `GET /api/qc/readiness`, requiring `qc.view`. It returns only the three activation switches and existing readiness messages from the current organization; it does not expose configuration identities, provider identifiers or credential references. No report scan is needed for this status.
- Add a setup guide, saved-revision readiness checklist and a sticky save bar. Distinguish **Save setup draft**, configuration updates and activation. Preserve partial valid program configuration while leaving activation off. Warn before discarding unsaved setup on subsection changes or browser unload. Rubric and notification setup tabs follow their respective permissions.
- No schema, migration, dependencies, existing authorization rules, SLA targets, sampling defaults or provider settings were changed.

## Authorized production configuration performed through Chrome

Using the existing authenticated Settings interface:

1. Created the separate **QC Administrator** role with all 15 existing QC permissions from the actual permission catalog. No unrelated permissions were included.
2. Added that role to **Administrators**, preserving **Super Admin** and **QC Reviewer**, existing memberships and other groups. The group editor reported nine membership records. The combined access preview increased from 100 to 112 permissions.
3. Confirmed successful role creation, group update and access to QC Settings with the current session.
4. Saved configuration revision **1** with `historicalMeasurement = INCLUDE_HISTORY`, recording the previously approved historical scope. Capture, processing and delivery all remain **false**. The save was acknowledged and its values read back in the UI.

The configuration work did not send customer messages or Teams/Outlook notices, mutate tickets, create inspections, verify providers, process history or run production migrations. No operating owner, percentage, threshold, rubric or SLA value was invented. The application deployment below subsequently updated and restarted API and web.

## Remaining activation work

- Select the responsible QC owner and leadership recipients.
- Define sampling percentage, period, minimum and dimensions; queue deadline and mandatory labor threshold.
- Define and publish service rubrics, weighted criteria, pass thresholds and reinspection counts; choose the failure consequence.
- Configure applicable client agreements, effective dates, calendars, time zones, pauses, first-response definition and SLA targets. Missing contractual applicability remains incomplete evidence.
- Define creative deliverables and checkpoints when that workflow is ready. Configure the internal Teams/Outlook/RMM integration details only with the real intended audience and provider values.
- Activate capture and processing only after configuration validation. Perform a controlled real inspection, follow-up, verification and closure pilot, then validate internal delivery and provider behavior separately.

The retained-historical setting alone does not import or process history while capture and processing are disabled. Local synthetic checks are not a claim of full operational production acceptance.

## Validation

- `npm run lint:web` and `npm run lint:api`: passed.
- `npm run build`: shared packages, Nest API and Next production build passed.
- Full backend suite with the isolated QC database: **32 suites / 147 tests passed**. The new authenticated runtime case verifies organization-scoped readiness, omission of configuration details, viewer/configurator permission boundaries, partial historical configuration persistence, immutable revision count and rejection of incomplete activation.
- Full browser suite: **99 tests passed** across Chromium, Firefox and WebKit. New cases cover ticket context, actual ID/reason payloads, permission limits, failed-request retention, opening the returned inspection, partial setup readback, unsaved subsection changes and responsive containment.
- Reviewed generated desktop/mobile setup and ticket-context screenshots. A separate Chrome preview mounted the actual updated TicketDetailWorkspace with synthetic local API responses and confirmed the QC link in Ticket Tools and the preserved header/composer layout.
- Runtime data used only a new disposable `postgres:16-alpine` container named `avidity-qc-readiness-validation`, bound to `127.0.0.1:55473`, database `qc_validation`. Existing project/production databases were not migrated or seeded.
- The disposable database container and the local preview server were stopped after validation.
- The initial browser failure was a new test's exact label locator; the visible control was correctly named as a combobox. The locator was corrected to use its role and accessible name; the full suite then passed.

## Production deployment and verification

- Published application release `4119f61` to canonical `main` and `codex/qc-operational-readiness`; GitHub advertised the exact expected SHA. No GitHub Actions run was listed for this commit; the local validation above and production checks below provide release evidence.
- Inspected the native `avidityhelpdesk` server through Tactical RMM: clean checkout at `c226446`, both services active and sufficient disk space before release.
- Transferred an incremental Git bundle through Tactical File Browser, checked SHA-256 and Git prerequisites, then fast-forwarded to the published commit. Persistent server Git credentials remain pending; no credentials were copied or created.
- Preserved previous source and shared/API/web build artifacts under `/opt/avidity/qc-readiness-backup-4119f61.0GNbFb`. The deployment script includes recovery to the previous source and artifacts if build or health checks fail.
- Stopped API and web for the in-place build, ran the full shared/API/web production build as `avidity`, then started both services. No dependency installation, database migration, infrastructure change or environment edit was needed.
- Verified the unchanged `.env.production` checksum and built API rewrite to `http://localhost:4000/api/:path*`.
- API health, main login, Event Portal and Support Portal returned HTTP 200. Both services are active, Git is clean, and no error-priority API/web journal entries were observed in the post-deployment check. Unauthenticated `/api/qc/readiness` returned HTTP 401.
- Authenticated Chrome checks confirmed the new setup guide and save bar, revision 1 with retained historical evidence, six pending program settings, and capture/processing/delivery all off.
- Verified the real ticket header and composer layout, **QC reviews** in Ticket Tools, and navigation to that ticket's actual filtered review queue. The queue displays the selected ticket, setup status, permission-aware links and manual inspection form. No inspection request was submitted and no customer message or ticket change was made.

QC remains in configurable preparation. Real business-rule activation, historical processing and provider pilot acceptance remain pending as listed above.
