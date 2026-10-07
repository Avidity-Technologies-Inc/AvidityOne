# QC operational follow-up - October 7, 2026

## Release scope

Development approved after the operational QC review. Work started on canonical `main` at `d5049328c22fb1b1d3e17f795bc7c5b1872bc00a`. This release does not seed business rules, change live settings, grant access, activate providers or deploy itself. Existing sample configurations remain editable application records.

| Area | Implemented behavior |
| --- | --- |
| Coaching & actions | Consistent owner display; search, owner, type, status, client and overdue filters; total-aware pagination; reassignment, deadline/feedback edits with a reason; acknowledgment, completion evidence, verification and return for correction; per-action audit history. Reassignment requires fresh acknowledgment. |
| Inspections | Persisted partial drafts with version checks; unsaved-change warnings; criterion/finding links for follow-up; failed coaching-mode reviews require verified follow-up or an authorized documented exception. Closing a QC review does not close the source ticket. |
| Reinspection | Original failed review shows remaining closures to select and the actual linked follow-up inspections with their states and scores. Selection is explicitly distinguished from completed review. |
| Queue | Search, reviewer, reason, severity and ordering; atomic bulk reviewer assignment; reasoned exclusion of unscored irrelevant/test records. Exclusion is not a passing grade; finalized failures cannot be excluded. |
| Definitions | Edit unpublished rubric/policy drafts with optimistic checks; copy an existing definition into its next revision. Published revisions and existing historical evaluations remain immutable. New revisions are not automatically activated. |
| Creative work | Owner/stage/search filters; audited metadata edits, reassignment and cancellation; cancelled work excluded from active delivery metrics and reminders. Checkpoint generation respects capture/processing activation. |
| Work records | Links between source tickets, inspections and work records; time corrections prefill the original start time and retain original entries. |
| Metrics | Unknown historical reopen measurements stay unmeasurable, not zero. Scorecards include response/resolution measurements, reopen denominator and follow-up links; completed-inspection trends and creative project/technician cohorts are visible. |
| Exports | PDF, Excel and CSV with selectable internal sections, real records, explicit measurement basis, numeric Excel values and CSV formula protection. Client exports use the separate service-only projection; private coaching, grades and evidence are excluded. |
| Delivery audit | State/channel/recipient filters, identifiable notification context and pending-delivery explanation. Notices include work reference/context after recipient authorization. Cancelled creative work and excluded inspections stop relevant pending reminders. |

## Boundaries retained deliberately

- Creative deliverables remain attached to Projects, with the existing optional Event & Services relationship and private evidence. A separate ticket-only creative intake workflow is not added by this release; broader Event & Services redesign still requires its own agreement.
- Existing organization/identity permissions remain authoritative. `qc.view` alone does not grant organization-wide inspection, coaching management, verification, configuration or export rights.
- Coaching managers can verify or return submitted actions; action owners can acknowledge and submit their own work. A completed action still awaits verification.
- Billing holds remain separate from coaching. This release does not integrate an external invoicing product.
- Reports preserve explicit cohorts: cycle start, review creation and creative record creation for current summaries; finalization date for quality trends. Historical evidence is not promoted to contractual SLA compliance.
- External Outlook/Teams delivery was not activated or tested against live recipients. Provider identity, channel membership, quiet hours and recipients need the separate configuration review.
- Browser checks use real React components with isolated API fixtures. Database/runtime checks use synthetic local PostgreSQL, not production data. Production acceptance follows deployment.

## Schema and compatibility

Migration `20261007140000_qc_operational_follow_up` adds nullable `draftSavedAt` and `failureConsequence` to reviews and nullable `criterionId` and `findingId` to actions, with a finding foreign key. No records are deleted, backfilled or seeded. Existing reviews resolve historical failure handling from audit metadata when the new field is absent. Existing `/qc/actions` array responses remain available; the new `/qc/action-page` supplies totals for the new UI.

No dependency, environment, infrastructure, permission catalog or shared ticket/mail processing changes are included.

## Validation

- API and web TypeScript checks and complete production build passed.
- Full backend run: 298 passed, 30 unrelated database-dependent cases skipped because their dedicated test databases were not supplied.
- Dedicated local PostgreSQL: all repository migrations applied successfully, including the additive QC migration; QC database/runtime cases passed. Coverage includes draft conflicts, access scope, action return/reassignment, follow-up/closure concurrency, atomic bulk assignment, exclusions, immutable published definitions, creative cancellation and safe exports.
- QC browser suite: 39 cases passed across Chromium, Firefox and WebKit, including desktop/tablet/mobile layouts, light/dark captures, draft guards, action transitions, rubric copies and export selection.
- PDF pages rendered and inspected; footer pagination regression covered. Excel reopened and numeric/string/header behavior verified.
- Deployment simulation: success and recovery after database backup, migration, build, schema and health-check failures passed using command stubs; no live service was touched.
- Read-only QC schema check passed against the disposable database.

## Production update

Use `scripts/deploy-qc-operations.sh <full-published-sha>` extracted from the fetched release before updating the server checkout. The helper requires native host `avidityhelpdesk`, `/opt/avidity/app`, service user `avidity`, clean `main`, canonical origin, the verified base revision or a retry of this release, unchanged dependencies and exactly the expected migration.

The helper backs up source/runtime/database, applies the additive migration, generates Prisma, builds the complete application, checks the new schema, starts both `avidity-api` and `avidity-web`, and probes local API/web plus the three public domains. There is maintenance downtime while the services are stopped for backup/build. `.env.production` is checksum-verified and unchanged. No `NODE_OPTIONS` dotenv preload is used.

If a guarded step fails, the previous runtime is restored and both services restarted. The additive columns remain, and Git stays at the attempted revision; inspect the printed recovery directory and health before retrying. The database backup is for controlled manual recovery, never an automatic destructive restore.

## Acceptance and next configuration review

1. Open an existing coaching action: confirm owner and linked inspection, then test acknowledgment, submission, return, resubmission and verification with authorized internal users.
2. Save a partial inspection draft, leave/reopen it and finalize after completing the checklist. Confirm that required follow-up prevents premature closure.
3. Verify a failed review's reinspection list and distinguish pending selection from pending scoring.
4. Copy a rubric to an unpublished revision and confirm the active program still references the previous published revision.
5. Filter the queue and actions; verify Profile's own-action link. Test internal and client-safe exports with a selected client and period.
6. Review Mary Ann's inherited permissions, the selected owner/reviewers, sampling/deadline rules, rubric revisions, SLA policies/calendars and creative checkpoints.
7. Review notification recipients, internal Microsoft identities/channel, quiet hours and delivery limits before a separately authorized provider test.
