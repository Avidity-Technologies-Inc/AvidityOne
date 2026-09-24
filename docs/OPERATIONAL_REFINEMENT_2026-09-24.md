# Operational accuracy and interface refinement

## Scope

Authorized follow-up to the September 23 UX/operational audit. Baseline: local main, canonical origin/main and the independently inspected production checkout all matched `f0a6ca1a2e62e6007af0f1c3063b1171bd453130`. Production API and web were active before work.

The user confirmed the ISFA duplicate was already corrected. This release does not merge clients, reassign historical tickets, activate QC, send test messages, or invent SLA/sampling rules. No schema, package, credentials or environment changes are required.

## Implemented behavior

- **Dashboard:** the active-client chart counts active tickets; high priority includes HIGH, URGENT and CRITICAL. Stale-ticket links carry the actual timestamp cutoff into the list and saved views. Unassigned excludes secondary assignees. Device cards preserve status/client/category filters. Activity and arrival-hour buckets use the organization's timezone and complete local calendar days, including daylight-saving transitions. Zero chart values have zero-height bars; the closed legend retains its chart color.
- **Operations:** removed silent 80-source/160-queue/12-owner and three-assignee truncation. Workload and deadline forecast use user IDs, preserving separate counts for same-name specialists and avoiding duplicate primary/secondary assignments. Groups and teams remain separate from individual workload. Source queries follow existing module view permissions; the overview still requires operations.view. Summary and queue count the same full active set. An agenda shows scheduled work sessions, visits and meetings for the next four weeks, with personal/all scope, actual activity timezone, organizer, location, calendar status and a direct link to the ticket activity drawer. Closed parent tickets are labeled when a future activity is intentionally retained. Workload labels explicitly describe item counts, not available labor hours.
- **Clients and Projects:** removed the silent 50-client cutoff while retaining the existing array API contract. Directory search, A–Z/Z–A ordering and 25-row UI pagination; create/edit/deactivate/contact/domain controls reflect actual grants and refresh after access updates. Client context links preserve client filters in Tickets, Devices and Projects. Project portfolio and timeline respect the client selection; empty projects explain the existing planning workflow.
- **Events:** My Tasks initially shows active tasks belonging to active requests. History remains accessible with the parent lifecycle visible; no tasks are mass-cancelled. Removed the 150-task lookup truncation. Unchanged task drafts cannot be saved accidentally. The assignment metric is labeled as assigned requests, and UNDER_REVIEW is no longer mislabeled Confirmed.
- **Devices:** exact status matching prevents inactive/not-ok strings from being considered online, and explicit online=false wins. OS version and agent version use distinct source fields. Inventory identifies its last observation and sync attempt rather than implying live availability. The scheduler yields to observed active mailbox locks, but future due mailbox/report times cannot indefinitely defer overdue inventory when a gap is available. It does not interrupt mailbox syncs or promise instantaneous RMM refresh.
- **QC:** compact readiness summary with expandable pending items and access explanation, readable review-state labels, and an explicit project prerequisite for creative deliverables. Activation settings remain unchanged.
- **Presentation:** compact headers and summary cards; scoped operational typography; styled Support Portal builder controls; public event form spacing and contrast; accessible names for time selectors; explicit ticket Block sender/Block domain and Opened/Not opened labels, separate inline-image/downloadable-file wording. A loading health indicator is neutral instead of warning. Security text distinguishes live evidence from migration history and dependency-audit guidance. Notification readiness only shows warning styling when users are actually blocked.

## Boundaries and remaining audit work

This is a consolidation release, not a claim that every proposed product enhancement in the audit has been implemented.

| Audit area | State after this release |
| --- | --- |
| A01–A06 | Corrected metric scope/filtering/calendar buckets, aggregation and identity; added activity agenda. |
| A07 | Corrected labels. True capacity in hours and availability calendars remain a future planning feature. |
| A08–A12 | Lifecycle context, metric naming, RMM handling and client completeness corrected. Task history remains editable through existing authorized actions; parent cancellation is not automatically propagated. |
| A13–A14 | Client controls, permitted Operations sources and client links improved. Exhaustive alternate-role journeys and a complete client 360 workspace remain broader work. |
| A15 | Already resolved by user; not touched. |
| A16–A18 | Unmapped-domain review, asset-to-ticket relationships and QC activation require deliberate business/data configuration; no automatic repair or activation. |
| A19, A21–A22, A25–A28 | Targeted readiness, density, status naming, chart and form fixes. Not a full design-system or CSS rewrite. |
| A20, A23–A24 | Existing specialist identities and save contracts retained; client filters and task-save affordances improved. Universal table/save components remain future consolidation. |
| A29–A30 | Tool/read/file labels clarified. Quoted-email collapsing, conversation grouping and a full attachment-count semantic redesign are deferred to avoid altering established message rendering. |
| A31–A34 | Reports behavior retained, project guidance improved, health loading made neutral. Report preset simplification, KB taxonomy and branding-loading skeletons remain future UX work. |
| A35–A38 | Notification/health/security wording, public contrast and time-control names improved. No claim of full WCAG certification or refreshed dependency security audit. |
| A39–A44 | Intake field redesign, public attachments, location-directory mapping, a dedicated My Work page, service catalog and automation explanations remain separate product work. |

Completeness currently uses projected full collections with UI pagination. Larger tenant volumes should move to database aggregates and independently paginated queues, preserving exact totals; this release does not claim a load-test result. Same-name users have separate IDs/counts; further display disambiguation by email can be added if needed. Operations deadline week grouping retains its existing server-calendar convention; the new activity agenda and Dashboard explicitly use their respective configured timezones.

## Validation and deployment

- API/web TypeScript checks and full production build passed during implementation.
- Full API suite: 209 passed, 58 database-gated tests skipped (no disposable integration database supplied in this run). New regressions cover >180 work items, >12 same-name specialists, duplicate assignments, group ownership, source permission boundaries, calendar/DST buckets, saved-filter validation, RMM status/version mapping and sync fairness.
- Chromium suite exercised 71 cases. A QC configuration-permission explanation regression was found and restored; the affected QC and new operational suites then passed all 30 cases across Chromium, Firefox and WebKit. Existing composer/email/report/activity tests remained passing. Final checks are recorded with the release verification.
- New UI cases cover >50 clients, search/pagination, read-only controls, context links, personal/all agenda, identity-based filters and desktop/tablet/mobile overflow. Synthetic fixtures do not mutate production data.
- Isolated deployment tests passed for success, build failure and failed health-check recovery. Both API and web are restored together; the web service depends on the API service.
- `scripts/deploy-operational-ui.sh <full-release-sha>` requires root on avidityhelpdesk, clean main at the reviewed baseline or retry release, published ancestry, unchanged dependencies/schema, healthy services and expected runtime artifacts. It checks migration status without applying migrations; backs up source/runtime; builds with the existing production environment loaded without NODE_OPTIONS; starts and checks both services and all three public domains. On failure it restores the prior runtime without resetting Git or touching database/environment. The script prints a recovery directory and final release SHA.
- Publication and production deployment are authorized. Do not infer deployed status merely from this document or a Git commit; verify the final SHA, clean checkout, services, endpoints and authenticated pages after deployment.
