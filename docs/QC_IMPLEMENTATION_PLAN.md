# QC implementation plan

Prepared on 2026-09-08 against `fb62bb5` on the canonical `Avidity-Technologies-Inc/AvidityOne` repository.

This plan defines how to deliver the complete Quality Control specification through connected, independently verifiable increments. The source is `Avidity-One-QC-Module-Feature-Specification.docx`, dated August 27, 2026. All 35 numbered features, seven automatic flags, eight suggested notification routes, and five success measures are tracked in [the requirements matrix](QC_REQUIREMENTS_MATRIX.md).

Status updated September 10, 2026: local implementation on `codex/qc-module`, based on canonical `113955d42179f33e9c3300942f5f562224250e31`. QC schema, API, UI, processing, provider adapters and local verification are implemented. Eight additive migrations were exercised only against a disposable PostgreSQL database with synthetic records. No QC commit, push, production migration, provider registration or deployment has occurred. The two pre-existing handoff changes remain preserved.

The design below is the original implementation proposal. The following implementation decisions supersede its tentative architecture and permission names. See [release readiness and activation](QC_RELEASE_READINESS_2026-09-10.md) for the actual operational contract and [requirements matrix](QC_REQUIREMENTS_MATRIX.md) for local evidence versus pending pilot acceptance.

## Implemented decisions and user direction

- Schedules, timezone, holidays, agreement types, policy targets, first public response versus internal technical touch, sampling, weights, thresholds and notification routes are editable persisted configuration. Business values start unset; capture, processing and delivery start disabled.
- Historical measurement is supported through `INCLUDE_HISTORY`, selected by the program administrator. Retained evidence is imported idempotently with provenance and missing-history labels. Historical elapsed-time metrics do not manufacture contractual compliance, lost status transitions or old ownership.
- Failed inspections support configurable coaching or a billing hold. Holds are enforced in the existing per-ticket financial estimate and exposed through a billing eligibility API. No separate invoice platform exists in this repository; that future consumer must enforce eligibility before invoice creation.
- Creative work uses existing Projects, optional linked Event & Services requests and Knowledge Base procedures. Editable deliverable types, original/revised commitments, proof/revision/approval/delivery events, private proof files, labor and configurable proof/final review checkpoints are connected. This is the suggested workflow pending business pilot acceptance.
- Teams targets the configured internal organization tenant/team/channel and linked internal user identities. External contact notification is not enabled. Any future external audience requires separate explicit validation. Channel cards hide private feedback; basic work identifiers require the channel-audience setting.
- Source events are captured atomically through PostgreSQL triggers. QC uses durable database receipts/outbox and a Nest timer with advisory locks, not an additional BullMQ queue. A pass runs every 60 seconds; event, active-work and historical batches are bounded. The database remains the authoritative recovery state across processes/restarts.
- Existing groups and role permissions remain additive. The migration adds an **unassigned** QC Reviewer role with source-evidence/QC-scoring rights only; it does not grant new access to existing users or roles. Actual permission keys use the existing flat underscore convention in `packages/shared/src/index.ts`.
- Published policies/rubrics and source events/history/time corrections are retained. New configuration applies by recorded revisions; completed scores are not rewritten. A new flag after finalization creates a linked follow-up inspection.
- M1-M4 application paths are present and locally validated. M5 remains pending: business configuration, actual participant/provider tests, production release and acceptance. Local fixtures are not provider acceptance.


## Delivery principles

- Complete the entire requested scope. An incomplete provider integration or untested workflow remains pending; a visible button, mock result, or successful build is not end-to-end acceptance.
- Reuse the existing organization, user, group, role, permission, client, contact, ticket, project, event, device, storage, notification, report, and audit foundations.
- Make business configuration editable through permission-scoped Settings screens and validated APIs. Do not embed named people, customer identifiers, addresses, channel IDs, SLA targets, calendars, rubric weights, sampling percentages, or escalation thresholds in application code.
- Keep security and integrity invariants enforced in code and database constraints. Configurability does not permit bypassing authorization, editing historical event times, disclosing coaching, or running arbitrary scripts from Settings.
- Preserve existing ticket behavior and public contracts. Add source events and QC relations without replacing working ticket, event, meeting, editor, or mailbox workflows.
- Use additive migrations and gradual activation. Preserve existing records and local changes. Never use an initialization seed to install QC into an existing environment.
- Finish each increment across persistence, API, authorization, UI, background processing where required, tests, and operational diagnostics.

## Verified starting point

Fresh `git fetch --prune origin` and comparison on 2026-09-08 confirmed `main` and `origin/main` at `fb62bb5`, with ahead/behind `0/0`. Before adding these planning documents, the only local changes were `PROJECT_HANDOFF.md` and `docs/PROJECT_CONTINUITY_2026-09-08.md`.

The installed local tools used for validation were Node `v24.18.0` and npm `11.16.0`. The previously inspected lockfile pins NestJS `11.1.28`, Next.js `16.2.11`, React `18.3.1`, Prisma `5.22.0`, and BullMQ `5.77.6`. No dependency upgrade is proposed to start QC.

| Check | Fresh result on 2026-09-08 | What it establishes |
| --- | --- | --- |
| `npm run lint:api` | Passed | API TypeScript checking |
| `npm run lint:web` | Passed | Web TypeScript checking |
| `npm test` | Passed, 28 suites and 114 tests | Existing API unit and service regression coverage |
| `npm run test:browser` | Passed, 39 tests across Chromium, Firefox, and WebKit | Existing editor/content and layout regression coverage |
| `npm run build` | Passed, shared packages, API and web compiled; 22 static pages generated | Shared package, API, and Next.js compilation |

The browser tests use local fixtures and selected application code/styles. They are not full authenticated application acceptance. No database migration, real Microsoft message, RMM operation, or production check was run. Production's last documented verification remains September 4 at `fb62bb5`.

## Business configuration and integrity

| Configuration area | Editable values and relationships | Required validation and version behavior |
| --- | --- | --- |
| Program | Enabled capabilities, source types, QC owner, substitutes, leadership groups, pilot client scope | Reference existing active organization records; no hardcoded personal defaults |
| Service commitments | Agreement type, client, optional project/work association, effective dates, coverage, response/resolution targets, applicability by category/priority | Resolve exactly one applicable policy or expose a configuration gap; freeze the policy version used by a measured cycle |
| Calendars | IANA timezone, working intervals, holidays, observed dates, exceptions and extended coverage | Validate overlapping intervals and timezone; version calendar changes; do not couple SLA coverage to mailbox polling hours |
| Pauses | Eligible source status definitions, allowed reasons, scheduled resume conditions, clocks affected | Preserve start/end events; distinguish waiting for staff from approved holds; do not let changing policy erase a recorded breach |
| Sampling | Percentage, population dimensions, period, minimum count/rounding, mandatory rules, anchor clients, reinspection count | Publish explicit selection behavior; preserve rule version and selection reason; deduplicate overlapping selections |
| Rubrics | Work type, criteria, weights, scoring scales, pass threshold, failed-criterion rules, not-applicable behavior, critical criteria | Validate weights and applicability; published versions are immutable; finalized reviews retain their version and results |
| Flags | Enabled state, severity, thresholds, windows, applicability and supported evidence | Preserve rule version and observed evidence; disabling a rule does not delete its historical findings |
| Notifications | Event, audience, channel, delay, escalation, quiet hours, critical exceptions, rate limits and digest schedules | Resolve actual recipients; restrict content by audience; prevent silent loss of required escalation through ordinary personal preferences |
| Retention and exports | Approved retention periods, permitted external fields, export branding and recipient policy | Enforce server-side field allowlists and organization/client scoping; never export coaching through a generic template |

Suggested configuration lifecycle: draft, validated, active, retired. Editing active business rules creates a draft revision with an effective time. A preview shows example timing, selection, recipients, and content before activation. Store actor, change reason, validation outcome, and prior version.

Missing business values remain unset and visibly incomplete. Synthetic local fixtures may contain illustrative values, clearly separated from production configuration. Do not silently assign a 24/7 calendar, a passing threshold, a sampling percentage, or leadership recipients to make a screen appear ready.

Technical constants such as API identifiers, supported event types, enum transitions, permission keys, and database uniqueness rules remain code-controlled. Display text uses existing branding and label conventions. Credentials remain secure environment references; they are never editable plaintext business settings or report content.

## Architecture and source ownership

Add a focused `QcModule` under `apps/api/src/modules/qc`, with services for review selection, inspections, rubrics, findings, coaching, and query projections. Keep SLA calculation and provider delivery behind focused interfaces that other modules can consume. Use the existing NestJS/Prisma patterns and REST API style.

QC observes source work and owns quality records. It must not copy tickets, replace Projects, or create a second user/client directory. Reviews reference their source record and its measured cycle or creative checkpoint. Use explicit foreign keys and a constraint that each review has one primary source. Context links to a project, event, client, or device do not create duplicate primary reviews.

| Source or surface | Integration work | Boundary to preserve |
| --- | --- | --- |
| Tickets and ticket workflow | Capture creation, qualified intervention, public response, assignment, hold, resolution, close, reopen and merge events; expose SLA/QC summaries | All manual, bulk, composer, rule-driven, inbound and routing paths must be covered; preserve current state transitions |
| Mailboxes and auto replies | Carry trusted provider receipt time and ingestion time separately; record accepted outbound messages and classify automated replies | Preserve deduplication, CC, direct/forwarded modes, initial sync boundaries and private attachments; automated acknowledgments are not automatically human responses |
| Clients and contacts | Link agreements, coverage and anchor-client designation; provide client performance views | A client can have concurrent agreements; preserve domain matching and existing text profiles during migration |
| Projects | Link applicable commitments, creative deliverables, review results and corrective work | Do not substitute milestones for proof approval or revision rounds; preserve work items and dependencies |
| Event and Services | Link relevant creative/service work and optional review checkpoints | Its statuses, tasks and teams retain domain-specific behavior; general event inspection requires an explicit program rule |
| Devices and RMM | Reuse existing agent sync and detail retrieval; add ticket-alert-device correlation and verification evidence | No remote remediation is implied by QC; device freshness alone is not universal proof of alert clearance |
| Operations and Dashboard | Show permitted attention items, workload and summaries; deep-link to QC | Aggregate complete QC data, not the limited display lists in Operations; do not expose another technician's private quality record |
| Reports | Add internal QC and explicitly client-safe report types with shared metric definitions | Revalidate execution and export scope, including scheduled jobs; internal data must not enter external report payloads |
| Settings and identity | Add scoped QC configuration, roles and permissions; use Microsoft identity mappings | Keep Profile separate and Users under Settings; reviewer-only access must not gain ticket mutation rights |
| Meetings | Expose authorized context and optional source evidence | Completing or scheduling a meeting does not close work, stop an SLA, or certify a corrective action |
| Knowledge and files | Reference procedures, client brand standards and private evidence | Preserve file scanning, sanitization and authenticated download rules; evidence attachments need explicit QC access rules |
| Public portals | Observe work created by existing intake paths | Do not expose internal reviews, coaching, scores, or unrestricted report URLs |
| Audit, maintenance and health | Audit QC changes, retain evidence and expose worker/provider failures | Define deletion/retention semantics before adding cascading relations; existing purge routines must not silently remove required QC history |
| AI | Optional later suggestions using approved context | Not required for the supplied scope; no automatic pass/fail, coercive staff decisions, or automatic customer messages |

Key implementation references: `prisma/schema.prisma`; `apps/api/src/modules/tickets/tickets.service.ts`; `ticket-workflow/ticket-workflow.service.ts`; `mailboxes/providers/microsoft-graph-mail.provider.ts`; `devices/devices.service.ts`; `projects/projects.service.ts`; `operations/operations.service.ts`; `reports/reports.service.ts`; `notifications/notifications.service.ts`; `audit-logs/audit-logs.service.ts`; `roles/roles.service.ts`; `packages/shared/src/index.ts`; `packages/ui/src/index.ts`; and `apps/web/src/components/layout/AppShell.tsx`.

Permission catalog changes must cover both shared definitions and backend catalog validation, plus focused migration/setup behavior for existing organizations. Do not rely on rerunning the whole seed or silently expanding existing people's access.

## Persistence contract

Names below are proposed design names, not implemented Prisma models. Final schema review must check existing migration conventions, indexes, foreign-key behavior, organization isolation and query needs.

| Record family | Required content |
| --- | --- |
| Work events and cycles | Organization, source, event identity/type, actor/origin, trusted occurrence time, server recording time, provider correlation, cycle, before/after operational state where relevant; unique source-event identity |
| Agreements and SLA | Existing client/project links, agreement type and effective period; published policy and calendar revisions; measured cycle, clock type, accumulated working time, due time, pause intervals, warning and breach events |
| Time and categorization | Organization-scoped service categories; source, technician, duration, performed-work interval, description, recorded time and correction history; category at measurement time |
| Creative work | Deliverable type, client/project/context links, owner, committed due-date history, proof versions, sent/approved evidence, revision rounds and delivered time |
| Reviews | Primary source/cycle/checkpoint, context, selection reasons and versions, assigned reviewer, concurrency version, status, timestamps and retained evidence snapshot/references |
| Rubrics and results | Rubric identity, immutable published revision, criterion definitions/weights, criterion result and failure comment, applicability, total and final disposition |
| Findings and follow-up | Rule/criterion, evidence and severity, affected technician(s), visibility, recognition or deficiency, coaching acknowledgment, corrective owner/due/status, completion evidence and reinspection counters |
| RMM evidence | Provider/organization scope, external alert and agent IDs, ticket/device association, observed status and check-in/clearance times, retrieval time, freshness and verification result |
| Delivery and outbox | Unique event/recipient/channel/escalation-stage key, restricted payload reference, attempts, provider message ID, state, error category, next retry, explicit acknowledgment actor/time and action replay key |

Keep event history append-only for all application roles. Generate local event times on the server; preserve separately validated provider occurrence times without exposing a backdating API. Historical corrections append an auditable adjustment with provenance. Evaluate database enforcement under the existing connection model; do not claim protection against a database superuser merely because the UI is read-only.

Freeze classification, applicable policy/calendar and attribution needed to explain historical results. A renamed client, reassigned technician, edited due date, or changed rubric must not silently rewrite past performance. Any approved restatement is separately identified.

Do not apply blanket cascading deletion to QC history. Specify retention, minimal snapshots and source deletion behavior with Maintenance before schema release. Do not retain unrestricted copies of entire conversations or attachment contents by default.

## Processing and API contract

Record source events and the durable pending-work record in the same local database transaction wherever source state is committed. A publisher/worker processes that record through the existing Redis/BullMQ infrastructure. Consumers are idempotent and can recover from restart or repeated delivery. Use uniqueness constraints and optimistic concurrency for reviews and actions.

External mail/Teams/RMM calls cannot be part of the database transaction. Record intent and outcomes with stable correlation; handle ambiguous provider outcomes without blindly duplicating messages. Report accepted, failed, unknown and explicitly acknowledged states truthfully. Critical delivery failures remain visible and trigger the configured fallback/escalation path.

Proposed REST surfaces include `/api/qc/overview`, `/api/qc/reviews`, review evidence/claim/disposition routes, `/api/qc/rubrics`, `/api/qc/findings`, coaching and corrective-action routes, scorecards, delivery diagnostics, and scoped configuration preview/validation/activation routes. Use dedicated mutation actions for workflow transitions; do not expose unrestricted updates to score history or timestamps.

Define API contracts before implementation: validated DTOs, pagination/filtering, permitted fields, expected errors, organization/client/user scope, transition preconditions and idempotency behavior. Query evidence without invoking the ticket detail side effect that sets `firstReadAt`; a QC inspection must not qualify as technician work or reset inactivity.

Evaluate clock rules against business intervals, holidays, timezone transitions and approved holds. First intervention, first human public response, subsequent response obligations, resolution and closure remain distinct measurements. Define inbound receipt versus ingestion semantics, reopening policy, merges, cancellation, late events and source downtime before activating compliance reporting.

Sampling has a defined population and period, published rounding/minimum policy and reproducible selection record. Mandatory reasons and reinspection take precedence without generating duplicate active reviews for the same source/checkpoint. Reopened work can create a new cycle review while preserving the earlier result.

Use one metric calculation/projection contract for screen, digest and export. Define denominator, period basis, timezone, exclusions, ownership attribution, sample size and data completeness. Separate sampled reviews from mandatory-risk reviews and administrative bulk dispositions so reports do not imply an unbiased quality rate or fabricated scores.

## Permissions and UI

Proposed capabilities: `qc.view`, `qc.view_own`, `qc.view_all`, `qc.reviews.perform`, `qc.reviews.assign`, `qc.reviews.bulk_dispose`, `qc.rubrics.manage`, `qc.coaching.manage`, `qc.coaching.acknowledge`, `qc.actions.manage`, `qc.actions.complete_own`, `qc.flags.override`, `qc.settings.manage`, `qc.notifications.manage`, `qc.reports.export_internal`, and `qc.reports.export_client`. Refine the smallest useful set during contract review.

The dedicated reviewer permission set grants source evidence reading and QC writes, not ticket edits/replies/assignment/closure. Existing permissions are additive across groups, so verify combined membership when provisioning a reviewer-only identity. Each Teams action must enforce the effective permission of its authenticated actor; service credentials do not lend their authority to that actor.

Technicians can see only their own scores/coaching and authorized actions. Management/reviewers see the scope granted to them within their organization. Check API filtering, detail endpoints, search, exports, dashboard counts, audit metadata, notifications, attachment access and cached/projection data. Sharing a ticket or team does not automatically grant access to other people's coaching.

Add `/qc` as a first-class permission-controlled workspace using the current shell and visual patterns. Deliver overview, queue, inspection workspace, SLA/flags, coaching/actions, performance and integration status. Add compact contextual links in Tickets, Clients, Projects and Operations. Personal results belong in Profile/My Quality; administrative configuration belongs in Settings with QC-scoped access rather than requiring general system administration.

The inspection screen shows source evidence read-only, rubric/version, failed-criterion comments, total, disposition, transition history and follow-up. Finalized scores require an explicit revision workflow. Flagged cases cannot be cleared through a bulk endpoint. Administrative bulk disposition must not manufacture an individual score.

Client-safe report queries construct an explicit external field allowlist. Exclude internal scores, reviewer commentary, coaching, recognition personnel records, private evidence and sensitive metadata before rendering. Scheduled execution must recheck its permitted report audience and scope.

## Microsoft 365 and RMM prerequisites

Reuse existing Graph email delivery and Microsoft user identity fields where applicable. Teams cards and writeback require a separately verified supported Teams application path; the existing mail/calendar token is not evidence of Teams messaging permission.

Recommended implementation candidate: a Teams app/bot for proactive cards and authenticated action callbacks, with the necessary tenant registration, installation scopes, user/conversation mappings and selected restricted channels. Keep Graph for applicable email/identity operations. Validate against current official documentation when implementing and obtain the required tenant-specific authorization. This plan does not register an app or change permissions.

Provider references consulted in the preceding scope review:

- [Graph message permissions](https://learn.microsoft.com/en-us/graph/api/chatmessage-post?view=graph-rest-1.0)
- [Teams proactive messages](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages)
- [Teams card actions](https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-actions)
- [Graph mail delivery semantics](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)

Cards must restrict visible data to their whole audience, not merely secure the deep link. Validate tenant/user identity, organization membership, action permission, record version, expiry and replay protection on callbacks. Acknowledge, assign review/action, assign ticket and add internal note are distinct capabilities; resolve the requested assignment semantics before enabling buttons.

Capture each delivery attempt and acknowledgment. Required exception routes must not disappear because a technician disabled ordinary email notifications. The final policy must reconcile quiet hours with immediate critical escalation. Test revoked access, blocked/uninstalled Teams app, provider throttling, lost response, duplicate callback and inactive recipient handling.

For RMM, inspect the actual installed API version and available alert/check evidence read-only when that integration is authorized. Existing `DevicesService` agent sync is reusable. Add explicit alert/device/ticket mapping; do not infer a verified alert from a hostname, email subject or stale snapshot. Define not-configured, unavailable, stale, verified and unverified outcomes. RMM QC is observation and verification, not authorization to execute device remediation.

## Open decisions and work that can proceed

The source assigns nine decision areas. Their exact values are not yet approved. They gate affected policy activation and acceptance, not all independent implementation work.

| ID | Decision | Owner in specification | Proposed approach and dependency |
| --- | --- | --- | --- |
| D01 | Definition of first response | QC owner | Capture touch and public response separately; choose contractual metric and eligible communication types before activating SLA |
| D02 | Business hours and extended coverage | Executive sponsor | Version calendars per coverage; needs timezone, hours, holidays and covered clients |
| D03 | SLA tiers and targets | Executive sponsor | Effective-dated agreements/policies; define contract, category/priority precedence and handling when no agreement matches |
| D04 | Sampling targets | Executive sponsor, configured by QC owner | Define period, percentage, dimensions, rounding/minimum and mandatory precedence before running real selection |
| D05 | Failure consequence | Executive sponsor | Coaching is one possible policy; invoice blocking requires identifying the billing system and validating a real enforcement integration |
| D06 | Creative scope and checkpoint | QC owner | Choose deliverable types, proof/final checkpoints, revision semantics and source records before activating creative review |
| D07 | Leadership audience and timing | Executive sponsor | Resolve users/groups, substitutes, real-time versus digest, and unacknowledged escalation before external delivery |
| D08 | Teams structure | QC owner | Select channel/conversation scope and audiences compatible with coaching privacy |
| D09 | Historical measurement | Developer with program stakeholders | Recommend forward reliable measurement; any backfill requires provenance, completeness flags and explicit environment/data authorization |

Additional required definitions: anchor-client designation; technician ownership/attribution including multiple assignees and external specialists; service taxonomy; meaningful technical activity; resolution-note evidence; pause eligibility/resume rules; reopen and cancellation treatment; pass thresholds and critical criteria; reinspection count; RMM verification freshness; retention; client-safe metrics; and whether Teams assignment targets a ticket, review or corrective action.

Independent work can establish schemas/contracts, permission boundaries, draft configuration screens, synthetic test fixtures, source-event plumbing, review UI and mock adapters. Do not invent missing business targets or present draft policy calculations as live contractual compliance. Application work follows the user's authorized implementation scope; publication, credential changes, provider activation and production operations retain their existing repository authorization boundaries.

## Implementation milestones

Milestone identifiers below are used by the requirements matrix. Preserve all features through rollout rather than removing difficult integrations from the definition of done.

| Milestone | Deliverable | Exit evidence |
| --- | --- | --- |
| M0 Planning and baseline | This plan, feature matrix, decision register, verified starting checks | Every source requirement mapped; baseline results recorded; no existing work overwritten |
| M1 QC foundation | Additive schema, scoped permissions, program/draft settings, read-only evidence access, event/outbox foundation and initial QC navigation | Isolated integration tests demonstrate identity reuse, access boundaries, immutable records, configuration validation and no change to existing work behavior |
| M2 Measurement and exceptions | Agreements/calendars/SLA, source instrumentation, categories/resolution evidence, time-entry foundation, flags, RMM correlation, basic queue capture and initial Teams/Outlook delivery | Representative client policies and real authorized provider tests verify clocks, all required high-severity flags, durable notifications and recovery; any missing RMM/Teams acceptance remains explicitly pending |
| M3 Inspection and scoring | Sampling, mandatory pulls, queue aging, review transitions/concurrency, weighted/versioned rubrics, safe bulk disposition; creative deliverable/proof/revision capture and creative QC; configurable routing and card actions | A sampled and a flagged service ticket plus a creative deliverable complete inspection; all score/version/privacy and callback scenarios pass |
| M4 Coaching and reporting | Acknowledgments, corrective actions, reinspection, recognition, technician/client/creative metrics, daily/weekly digests and client-safe export | Fail-to-correction-to-reinspection and positive recognition flows complete; screens and outputs agree; external export contains only permitted data |
| M5 Controlled pilot and full acceptance | Approved real configuration, designated pilot participants/clients, provider checks, monitored recovery and release runbook | Every matrix row has evidence; outstanding decisions resolved; recovery verified; program owner and sponsor accept outcomes |

M1-M2 establish the specification's measurement phase; M3 covers inspection/scoring; M4 delivers coaching/visibility. Permissions, audit, deduplication and minimum delivery controls move earlier because every phase depends on them. Creative and time data capture must precede the features that consume them. M5 is required to call the entire module complete.

The first application increment should be M1: make the QC foundation, validated draft configuration and source-evidence contract operational in an isolated local environment. It should not activate real SLA targets or external alerts merely because the module loads.

## End-to-end acceptance journeys

1. **Service work:** create through existing intake; resolve the applicable agreement; measure technical touch/public responses, holds and resolution; close with evidence; select for QC; inspect and finalize; reflect the same result in authorized reports.
2. **Failure and improvement:** detect an exception; insert one required review; deliver to the right audience; fail a criterion with a comment; obtain technician acknowledgment; assign and complete a corrective action; inspect the configured next work items; preserve the original failure and follow-up outcome.
3. **Creative delivery:** create a deliverable in its real project context; record commitment, proof, approval/revision events and delivery; inspect with the published creative rubric; report throughput, on-time delivery and revision rounds by project/member.
4. **RMM alert:** correlate a real authorized alert to its ticket/device; retain timely provider evidence; close work; verify the configured evidence rule; distinguish failure from unavailable data; review and audit any override.
5. **Privacy:** technician A cannot retrieve technician B's scores through any UI/API/export/card path; reviewer-only identity cannot edit source tickets; cross-organization/client access fails; client report excludes internal data at the query boundary.
6. **Recovery:** stop/restart QC workers in an isolated test environment; repeat source events and card actions; simulate provider timeout/throttling and revoked permissions; verify pending work is visible and recovered without duplicate final actions or lost escalation.
7. **Regression:** preserve public intake, mailbox deduplication/CC, ticket status/bulk/merge behavior, editor input/selection/signatures/AI boundaries, Meetings independence, Projects/Event relationships and authenticated attachments.

Test business hours over weekends, holidays, overnight coverage and daylight-saving transitions; policy revision boundaries; response events arriving late; reopening after a prior review; overlapping mandatory reasons; concurrent review claims; stale bulk eligibility; insufficient time-entry history; canceled/merged/deleted source work; old and new due-date/rubric versions; and historical data without full evidence.

Client and technician metrics must specify their cohorts and denominators. Measure baseline and later trends for response/compliance, reopen/undocumented closure, documentation completeness, alert/acknowledgment latency and client-safe reporting. A sampled pass rate and a mandatory-risk pass rate are not interchangeable.

## Rollout and recovery

- Use a `codex/` feature branch or isolated worktree for application implementation, preserving the uncommitted handoff documents and other contributors' changes.
- Inspect the actual local database target before any migration. Validate schema and additive migrations on an isolated, disposable database with synthetic fixtures. Do not seed existing local or shared data.
- Start disabled/unconfigured. Enable capture, calculation, review and external delivery through explicit readiness controls, with visible missing prerequisites. Simulation and production reporting must be clearly distinguished.
- Complete the relevant checks per increment: API/web type checks, focused unit/integration tests, browser/runtime tests and applicable build. Use fresh evidence rather than repeatedly claiming the baseline results cover new code.
- Complete the entire scope in local/integration validation before the final pilot acceptance. Use designated authorized recipients for live provider tests; never customer addresses chosen merely because they exist on a ticket.
- Before an authorized production release, inspect server state, backup/recovery and migration compatibility, deploy through the existing native `/opt/avidity/app` process, verify revision/services/logs/UI, and confirm readiness of each provider.
- Recovery first disables QC delivery/processing via controlled settings while retaining captured history. Use a migration-compatible prior application build where validated. Do not propose destructive down migrations or database resets as routine rollback.
- Existing missing server Git credentials and pending Meetings calendar acceptance remain separate continuity items. Resolve any deployment prerequisite explicitly; do not treat earlier deployment authorization as permission for this release.

## Completion rule

QC is complete only when all required matrix rows are implemented, configured, connected to their real source data, permission-tested, and accepted across their complete workflows. Record evidence and limitations for every row. No feature is complete solely because it exists in the schema, renders in the UI, passes a unit test, or uses a mock provider.

Conditional decisions such as invoicing enforcement are resolved explicitly. If selected, they become required integration work; if rejected by the authorized business owner, record that decision. Unresolved decisions are not silently treated as exclusions.
