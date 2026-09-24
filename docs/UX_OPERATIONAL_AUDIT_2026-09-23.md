# Avidity One — UX and operational coherence audit

Date: September 23, 2026. Status: original assessment snapshot.

Implementation follow-up: see [September 24 release scope and remaining work](OPERATIONAL_REFINEMENT_2026-09-24.md). ISFA was already corrected by the user and is excluded from this release. The observations below describe the audited baseline, not the post-release state.

## Executive assessment

Avidity One has a useful operational foundation, but modules have evolved at different speeds. The next improvement should consolidate the experience around reliable metrics, shared presentation rules, contextual navigation, explicit configuration readiness, and consistent saving behavior. A wholesale redesign or new framework is not recommended.

The most consequential findings concern the meaning and completeness of displayed data, not decoration: Dashboard scope and drilldowns, Operations aggregation limits and scheduling coverage, RMM freshness/normalization, and tasks whose parent event is cancelled. Visual consolidation should follow these corrections.

No application code, production settings, permissions, records, notifications, or services were changed. This document is the only workspace addition. No commit, push, deployment, test email, public form submission, synchronization, or database repair was performed.

## Evidence and limits

- Canonical origin: `Avidity-Technologies-Inc/AvidityOne`. Local `main` and fetched `origin/main` matched at `f0a6ca1a2e62e6007af0f1c3063b1171bd453130`; ahead/behind was `0 / 0`. The worktree was clean before this report.
- Read project instructions, current handoff, continuity documentation, relevant API services/controllers, UI components, styles, and schema.
- Inspected the authenticated production application in Chrome using the current administrator session, including every main navigation module and every top-level Settings section. Inspected public support and event forms without submission.
- Reviewed desktop layouts and selected layouts at 1366×768 and 390×844. Mobile observations apply to the specific surfaces tested, not every screen. Temporary viewport overrides were reset.
- Live counts changed during the audit as the application continued operating. Counts below are examples observed during the session, not a frozen database snapshot.
- Production Git SHA was not independently inspected on the server during this audit. Matching local/GitHub revisions does not establish the currently running server SHA.
- No exhaustive database orphan/duplicate query, alternate-role impersonation, accessibility certification, dark/OLED visual pass, full keyboard journey, outgoing-message test, or full end-to-end workflow test was performed. Empty Projects and inactive QC prevented validation of populated production workflows.
- The inspected browser tab returned no captured console errors at the time checked. This is not a guarantee that every path is error-free.

Evidence labels: **Observed** = live UI; **Confirmed** = UI/source or deterministic source evidence; **Risk** = code-supported failure condition not reproduced against production data; **Opportunity** = proposed enhancement; **Configuration** = an explicit setup or business-policy decision.

Priorities: **P1** = correctness, misleading operational information, or consequential workflow gap; **P2** = substantial usability/accessibility/consistency improvement; **P3** = later product enhancement. These are implementation priorities, not security severity ratings.

## Coverage

| Area | Inspected surfaces |
| --- | --- |
| Shell | Main/subnavigation, top bar, loading transitions, mobile navigation |
| Dashboard | KPIs, activity, client/workload distributions, attention lists, device summaries, customization entry points |
| Operations / Projects | Queue, filters, workload and forecast; project portfolio, timeline/templates entry points and unsaved creation form |
| Tickets | List/views/filters; existing ticket details, composer, conversation, assignment, attachments, activity drawer |
| QC | Overview, review queue, coaching/actions, creative deliverables, scorecards, delivery audit, work records; Program, Agreements, Rubrics, Notifications settings |
| Events | Requests/detail, My Tasks, calendar, external-specialist directory |
| Devices | List and display modes, filters, device detail, RMM settings and freshness information |
| Clients | Directory, client overview, domains, requesters and QC entry point |
| Knowledge Base | Catalog, categories/search, unsaved article editor; import configuration |
| Reports | Tickets, Events & Services, Projects, saved reports, schedules, history, export configuration without export/send |
| Profile | Account, access, appearance, ticket writing, notifications, signature |
| Settings | All top-level sections; General subareas, access Users/Groups/Roles, Workflow Statuses/Rules/History, Spam Rules/Quarantine, Security tabs, Maintenance recycle bin/attachment quarantine |
| Public surfaces | Support request and event request forms; event portal mobile layout |

Not every nested dialog or record was opened. Sensitive knowledge articles, credential values and authentication setup were not inspected. Public-form conditional branches and integrations were not exercised by submitting data.

## 1. Correctness and operational coherence

### A01 — Dashboard client chart describes active work but counts historical tickets

**P1 · Confirmed.** The live dashboard showed roughly 40 active tickets while the client chart described “all active tickets” and displayed a client with 278 tickets. The API client grouping uses `baseWhere`, which excludes deleted/merged tickets but does not limit active states.

Evidence: `apps/api/src/modules/tickets/tickets.service.ts:271`; `apps/web/src/components/dashboard/DashboardWorkspace.tsx:1048`.

Recommendation: make the scope explicit and consistent. Either calculate active workload or label the chart as lifetime distribution, with a real scope selector if both are useful. Clicking a segment must open exactly that population. Acceptance: aggregate counts and filtered lists reconcile under the same scope and permissions.

### A02 — Attention and device indicators do not preserve their drilldown criteria

**P1 · Confirmed.** “No Recent Update” announces a seven-day threshold but opens an active-ticket list sorted by modification time without the cutoff. Device subtype/status indicators lead to the general device list without corresponding filters.

Evidence: Dashboard links around `DashboardWorkspace.tsx:908`; dashboard filter construction in `tickets.service.ts:493`; device card links in `DashboardWorkspace.tsx`.

Recommendation: serialize the complete criterion in a shared, validated filter contract. Acceptance: each count opens a list whose membership matches its definition, rather than merely placing likely matches first.

### A03 — Priority and calendar-day definitions differ between analytical surfaces

**P1 · Confirmed.** Dashboard “High Priority” counts only `HIGH`; its critical/high list and Reports include broader urgent/critical categories. Dashboard uses a rolling timestamp cutoff (`daysAgo(29)`) and UTC date keys, while Reports clearly presents organization-local calendar days. The first Dashboard day can be partial. This can produce different figures even when users believe they selected the same period.

Evidence: `tickets.service.ts:210`, `:249`, `:298`, `:401`, `:679`; live Reports timezone America/Chicago.

Recommendation: centralize metric definitions, timezone and inclusive/exclusive boundaries. Distinguish created-in-period cohorts from events-in-period and current backlog. Acceptance: a documented reconciliation test covers midnight, first-day boundaries, daylight saving and HIGH/URGENT/CRITICAL.

### A04 — Operations aggregates a capped sample as workload

**P1 · Risk.** Queries limit tickets, requests, tasks and project commitments to 80 each; ticket/event assignees are limited to three. Further queue/decision/workload limits apply. Workload and forecast are derived from these fetched collections. At higher volume, work or specialists can disappear from calculations without a clear completeness indicator.

Evidence: `apps/api/src/modules/operations/operations.service.ts:116`, `:119`, `:133`, `:136`, `:154`, `:193`, and aggregation methods.

Recommendation: calculate totals from complete authorized datasets and paginate display rows independently; retain all assignment IDs needed by aggregates. Acceptance: over-limit fixtures return correct totals, all assignees and explicit pagination. This audit did not establish current production data loss.

### A05 — Workload identity uses display names

**P1 · Risk.** Operations workload and forecast maps are keyed by owner names. Two different users with identical names can be combined.

Evidence: `operations.service.ts:399` and `:439` onwards.

Recommendation: aggregate by immutable user ID and use names only for display. Acceptance: two same-name users remain distinct throughout filters, workload and links.

### A06 — Scheduled ticket activities are not included in Operations planning

**P1 · Confirmed integration gap.** Ticket activities correctly distinguish work sessions, service visits and meetings. Operations forecasting reads ticket target dates rather than these scheduled activity intervals. The UI showed assigned items excluded for lacking target dates; scheduling an activity does not make that work visible in this forecast.

Evidence: `operations.service.ts:111` and work-item mapping; ticket Activities drawer. No ticket-meeting/activity query is present in the inspected Operations service.

Recommendation: display commitments from activities alongside due dates, with explicit source/type and links. Keep deadline and appointment distinct. Acceptance: a scheduled visit appears once in the relevant specialist agenda, while changing its time does not silently change the ticket deadline.

### A07 — Capacity percentages represent item counts, not time availability

**P2 · Confirmed semantics.** A configurable item baseline drives percentages and over-capacity labels. It does not measure assigned hours against working hours. A precise percentage can imply a stronger measurement than the data supports.

Recommendation: call this “workload against item baseline” now. Add an optional time-based model only when calendars, availability and estimated effort are configured. Never invent effort or staff availability.

### A08 — Event tasks remain actionable after their event is cancelled

**P1 · Observed and source-supported.** My Tasks showed two pending/in-progress tasks for cancelled event EVT-100005, without the parent cancellation state in that view. The list filters organization and soft deletion but not the request lifecycle.

Evidence: `apps/api/src/modules/event-services/event-services.service.ts:309`; My Event Tasks UI.

Recommendation: establish an explicit parent/child lifecycle policy. At minimum, show cancelled-parent context and exclude such tasks from the default active queue. Decide whether cancellation should cancel children or preserve separately actionable follow-up tasks. Do not silently mass-close historical tasks. Acceptance: active work, history and parent status remain coherent and auditable.

### A09 — Event assignment card counts requests, not specialists

**P1 · Confirmed.** “Assigned Specialists / Direct assignments” is backed by a count of requests with any internal, external or task assignment.

Evidence: `EventServicesWorkspace.tsx:265` and `:722`.

Recommendation: rename to “Assigned requests” or calculate distinct specialists, including a clear definition for task-only assignments. Acceptance: the number and label describe the same entity.

### A10 — RMM data freshness is insufficiently visible

**P1 · Observed; scheduler cause requires further verification.** Devices displayed an automatic-sync deferral message. A device marked active had a last-seen/updated time around 05:54 when inspected around 16:01. This does not prove the device was offline; it proves the displayed observation was old. General system health still showed OK.

The scheduler defers RMM when mailbox/report work is due within two minutes and retries after five minutes. There is no maximum-deferral fairness mechanism in the inspected method. Frequent mail schedules could repeatedly postpone inventory; production logs/settings were not examined to establish that cause.

Evidence: `devices.service.ts:923`, `:990`, `:1016`.

Recommendation: show last successful sync, last attempted sync, observation age, next attempt and deferral reason separately. Review bounded deferral/fair scheduling without delaying ticket mail. Acceptance: stale inventory cannot visually masquerade as live availability, and sustained mail activity does not indefinitely starve inventory.

### A11 — RMM OS and availability normalization have ambiguous fallbacks

**P1 · Confirmed mapping risk.** A live Ubuntu 24.04 device displayed OS Version 2.11.0, also its agent version. Normalization accepts generic `version` as OS version. The availability regex also matches `inactive` and `not ok` as positive states; a local deterministic check confirmed both matches. This does not prove those exact status strings are currently returned by the provider.

Evidence: `devices.service.ts:850`–`:853` and agent-version mapping.

Recommendation: distinguish provider OS build, agent version and explicit availability fields. Use documented exact status mappings, including unknown, and prioritize explicit booleans. Acceptance: fixtures for inactive, offline, unknown and separate OS/agent versions produce correct values.

### A12 — Client lookup silently stops at 50

**P1 · Risk.** Client list service returns at most 50 records without a pagination contract. Selectors depending on that response could omit valid clients after growth. Current directory showed 16, so the threshold was not reached during this audit.

Evidence: `apps/api/src/modules/clients/clients.service.ts:37`.

Recommendation: paginated/searchable lookup with explicit totals and a stable ID contract; avoid merely increasing the hidden cap. Acceptance: client 51+ is discoverable in directory and dependent selectors.

### A13 — UI capabilities are not consistently aligned with API permissions

**P1 · Code-supported risk; alternate-role runtime test pending.** Clients exposes create/edit/deactivate affordances without matching frontend permission gating, while its API correctly checks per-action permissions. Operations navigation permits `operations.view`, whereas its endpoint requires that plus `tickets.view` and `event_services.view`.

Evidence: Clients components and `clients.controller.ts`; `AppShell.tsx:100`, `:196`; `operations.controller.ts:15`; `permissions.guard.ts` uses `every`.

Recommendation: align visibility, disabled explanations and route capabilities with the same permission contract. Keep server checks. Decide explicitly whether Operations requires all source modules or supports a permitted subset. Acceptance: representative read-only and specialist roles see only usable actions; no permission expansion is necessary to make UI look complete.

## 2. Data relationships and configuration

### A14 — Client context is fragmented across modules

**P2 · Observed / Opportunity.** Client detail has Overview, Domains and Requesters, plus QC access, but lacks contextual tickets/devices/projects/activity summaries. Users repeatedly navigate away and reselect the client.

Recommendation: build a permission-aware client workspace with linked counts and filtered lists, reusing existing client IDs. Do not duplicate records. Acceptance: every count links to the same authorized population in its owning module.

### A15 — Potential split client identities and system buckets need classification

**P1 · Data-quality candidate, not a confirmed duplicate.** “ISFA” has contacts/domain mapping while “Illinois Sports Facilities Authority” appears separately and has devices. “Misc” and “Unmapped RMM Devices” appear as ordinary choices in business selectors.

Recommendation: verify source identifiers, ownership and intended relationships before proposing any consolidation. Introduce explicit client classifications and a reviewed RMM-to-client mapping if necessary. Acceptance: a preview lists affected tickets, contacts, devices, projects and policies before any authorized merge; operational buckets remain distinguishable from actual customers.

### A16 — Unmapped domains need triage rather than blanket association

**P2 · Observed.** Domain Mapping displayed 47 unmapped domains, which can include vendors, notifications and unrelated senders.

Recommendation: show source, affected counts, suggested candidate, deliberate ignore state and reviewed assignment. Never map all unknown domains automatically or infer client identity from similar display names.

### A17 — Device-to-ticket context is not a first-class normal workflow

**P2 · Opportunity.** Device detail offers RMM information/actions but no ordinary related-ticket journey. Ticket schema does not provide a direct normal asset relation; QC RMM evidence is a separate existing relationship.

Recommendation: add a deliberate many-to-many affected-assets association where justified, with client/permission validation and bidirectional links. Reuse device IDs rather than copying host names. This is new functionality, not evidence of lost records.

### A18 — QC is implemented but not operationally activated

**P1 · Configuration, not a display bug.** Capture, processing and delivery are off. The setup shows six pending decisions: accountable owner, sampling policy, published service rubric, review deadline, mandatory labor threshold and failure consequence. Historical evidence scope is selected, but that alone does not process history.

Recommendation: a setup checklist with readiness per dependency, links to the exact field, draft validation and an explicit controlled activation plan. Keep undefined policies unset. Acceptance: the UI clearly distinguishes installed, configured, activated, processing and delivering.

### A19 — QC setup and creative creation are difficult to discover

**P2 · Observed.** Large inactive banners repeat across QC pages. Technical enums and terms are prominent. Creative deliverable creation depends on the project filter above the form; no projects exist, and the disabled action does not offer a direct project-creation path.

Recommendation: compact persistent readiness status, descriptive labels, progressive sections for advanced policies, and an explicit required project selector for creation with a permission-aware prerequisite link. Replace native multi-select lists with searchable selected items. Preserve current safeguards and audit distinctions.

### A20 — Shared specialists have different identities and entry points

**P2 · Observed / Opportunity.** Internal users, access groups, ticket teams, CC recipients, external specialist contacts and project/QC owners serve different purposes. The external specialist directory is under Events although tickets also use it.

Recommendation: explain these distinctions consistently, add contextual links to the shared directory and show source of responsibility. Do not combine ticket teams with event service teams or equate an external user's role name with an external-contact record.

## 3. Visual and interaction consistency

### A21 — Oversized and repeated headers delay access to work

**P2 · Observed.** Events, Clients, Devices, KB and Profile use larger introductions than recently compacted Reports. Several pages repeat the module title in a hero, panel and table. Events pushes the first request close to the bottom of a desktop viewport; public portals devote approximately 390–420 pixels to branding before the form area.

Recommendation: one compact heading/breadcrumb, a brief optional description and one primary action. Reserve large promotional heroes for appropriate public presentation, with a compact form variant. Acceptance: useful data or initial fields are visible without unnecessary introductory scrolling at standard laptop dimensions.

### A22 — Typography and spacing lack a common operational scale

**P2 · Observed.** Settings labels can be 9–12px while nearby form labels are 16px; dense table data competes with oversized introductory cards. At 1366px, the main sidebar plus Settings navigation consume a substantial portion of width.

Recommendation: shared semantic tokens for title, body, label and metadata; consistent field/button heights; compact and comfortable density options. Keep essential data readable instead of shrinking everything. Provide a collapsible Settings navigation at intermediate widths. Small text alone is not automatically a WCAG failure.

### A23 — Save behavior varies without a uniform persistence signal

**P2 · Observed.** Ticket Writing autosaves, Appearance applies immediately, account/notification/signature forms have save buttons, and some forms always enable Save. QC and role dialogs already show useful pending/saved states and persistent actions.

Recommendation: autosave reversible personal preferences with Saving/Saved/Error feedback; explicitly save administrative or multi-field changes with a dirty-state bar. Warn on navigation only when unsaved edits really exist. Do not add confirmation to ordinary ticket replies or the already authorized email close command.

### A24 — Tables and filters use inconsistent interaction patterns

**P2 · Observed.** Reports offers sorting, column selection and applied criteria; Clients lacks equivalent discovery at scale; Events and QC use other layouts. Repeated requester email/date blocks enlarge ticket rows. Bulk/destructive actions sometimes occupy primary toolbar space even with no selection.

Recommendation: shared table toolbar with search, visible filter chips, clear/reset, column selection, sorting, pagination and conditional bulk actions, applied where useful rather than copied indiscriminately. Maintain explicit Apply for expensive filters. Save appropriate view preferences per user.

### A25 — Status labels and colors are not semantically consistent

**P2 · Confirmed.** Event `UNDER_REVIEW` appears as “Confirmed” in Requests and “Under Review” elsewhere. Waiting-state labels vary. Operations has two indistinguishable “New” options from different source types. QC exposes raw uppercase enum labels.

Recommendation: shared display-label helpers, module-qualified mixed-source filters and consistent semantic palettes. Preserve configurable ticket-status names and underlying workflow semantics. Acceptance: the same state has the same label across list, detail, calendar, reports and export, unless context explicitly explains a difference.

### A26 — Dashboard chart legend and bars disagree

**P2 · Confirmed.** Closed bars are green but the closed legend can be gray because a later Reports CSS rule targets `.dashboard-chart-legend .closed`. Minimum bar heights also render non-zero marks for zero values.

Evidence: `globals.css:8542` and `:10991`; Dashboard activity bar height calculation.

Recommendation: scope chart styles, use shared semantic series tokens, render zero as zero, add readable axes/values and keyboard-accessible data alternatives. Reports already provides a useful activity-values pattern to reuse.

### A27 — Global CSS creates cross-module regression risk

**P2 · Confirmed architectural risk.** The global stylesheet exceeds 16,000 lines, and A26 demonstrates an actual selector collision. This is evidence for controlled isolation, not justification for a wholesale rewrite.

Recommendation: extract touched component styles incrementally, introduce shared tokens and regression snapshots for representative screens. Acceptance: a Reports visual adjustment cannot change Dashboard colors or ticket composer geometry.

### A28 — Support Portal configuration has visibly inconsistent controls

**P2 · Observed and source-supported.** Many builder inputs, textareas and buttons use native/default styling rather than the established input/button components. All sections and technical field keys make the builder long and visually dense.

Evidence: `SupportPortalConfigPanel.tsx:492`, `:566`, `:669` and related markup.

Recommendation: consistent controls, expandable section summaries, searchable fields, clear save scope, and preview alongside editing. Put technical identifiers and conditional logic in an advanced editor. Preserve configurable schemas and existing submissions.

### A29 — Ticket detail repeats metadata and long quoted history

**P2 · Observed.** Status/priority appear in the header and Details. Goal placeholders repeat. Historical emails can reproduce long quotes/signatures inside successive timeline entries. “Sender” and “Domain” tools are not self-explanatory.

Recommendation: compact summary plus an obvious editing location; collapsible quoted history/signatures with original content available; explicit action labels and a secondary menu for administrative tools. Preserve message HTML, attachments, threading and the recently corrected composer/footer behavior. Do not destructively rewrite stored conversations.

### A30 — Read state and file counts need clearer definitions

**P2 · Observed.** Ticket “Read” can mean first opened by another user, rather than personal unread activity. File surfaces distinguish regular and inline attachments, while some totals include both.

Recommendation: distinguish “opened by” from “new activity for me,” and label regular files, inline images and totals consistently. Do not present an inline-only conversation as missing files.

### A31 — Report customization is powerful but increasingly dense

**P2 · Opportunity.** Reports already supports section selection, columns/order, sort direction, exclusions, saved reports and export layout. The long export configuration now needs hierarchy rather than more controls added vertically.

Recommendation: organize Content, Columns/Ordering and Layout into concise sections with a persistent summary/preview and actions. Improve empty ranges with “change period” guidance instead of many zero/empty charts. Do not remove current granular controls or change export semantics.

### A32 — Projects needs useful empty-state guidance

**P2 · Observed.** With no projects, users see portfolio/table/filter scaffolding and repeated headings without a concise setup journey.

Recommendation: Create Project or Use Template, brief explanation of milestones/tasks/owners, and links from dependent QC creative screens. Never populate fake production records. Populated project usability remains unverified.

### A33 — Knowledge Base taxonomy and browsing controls need consolidation

**P2 · Observed / Opportunity.** The catalog has 20 published entries under an Imported category; imported sections/pages and articles need clearer hierarchy. Colored card accents have no clear semantic meaning. Category creation/bulk controls compete with reading and searching.

Recommendation: consistent article/section/page terminology, meaningful categories/tags, owner/review date, contextual ticket links and secondary administration controls. Review classification/access of imported material separately; sensitive article content was not opened and no exposure is alleged.

### A34 — Loading transitions temporarily resemble unconfigured states

**P2 · Observed.** Route changes can briefly show fallback branding, reduced navigation, loading health and unresolved integration indicators before real values arrive.

Recommendation: retain authenticated shell/branding while loading route content; represent unknown/loading explicitly rather than false/zero/unconfigured. Acceptance: no transient “No credential resolved” or empty module count is mistaken for a real operational condition.

### A35 — Notification and integration status should explain actual readiness

**P2 · Observed / Opportunity.** Notification settings have useful per-user readiness and delivery history, but the large enabled-state notice uses warning-like visual emphasis. Integration setup mixes technical environment references, configured state and operational health.

Recommendation: neutral success/readiness status; concise blocking reasons; last success/error and next action. Keep accepted/sent/delivered distinctions. Link an affected ticket's delivery issue to its authorized diagnostic record rather than requiring manual navigation through Settings.

### A36 — Security and health pages mix live evidence with static guidance

**P2 · Confirmed.** Security Center includes fixed statements about transitive dependency findings and a future audit-scoping migration. These paragraphs are guidance, not fresh scan results. System Health checks database/storage/mail conditions but does not establish end-to-end notification delivery or fresh RMM inventory. Its healthy percentage requires an explicit coverage explanation.

Evidence: `SettingsWorkspace.tsx:5267`, `:5271`; system-health service aggregation and component checks.

Recommendation: separate “current checks, measured at” from documentation; date scan evidence; show unknown/unmeasured components and monitoring coverage. Remove or update stale project-development notes after verification. Do not turn an informational UI audit into an unapproved dependency upgrade.

## 4. Accessibility and public intake

### A37 — Event portal instruction contrast is below the normal-text target

**P2 · Measured observation.** The 16px instruction paragraph computes to `rgb(154,168,189)` on a near-white form. Its contrast on pure white is about 2.41:1, below WCAG AA's 4.5:1 normal-text target; the observed near-white background does not improve this sufficiently.

Recommendation: use a readable muted token, validate theme/brand-derived contrast and retain an accessible fallback. This is a specific measured issue, not a full conformance assessment.

### A38 — Some controls lack accessible names

**P2 · Observed DOM evidence.** The public event form has six hour/minute/AM-PM selects without associated labels or `aria-label`; some internal filters also present unnamed comboboxes. Visual neighboring text does not supply a programmatic name.

Recommendation: label every control, group related time inputs, distinguish first/last name, and test keyboard/focus behavior. Validate dialogs, tooltips and sticky bars at 200% zoom and narrow reflow widths. Do not rely on color alone for state.

### A39 — Support intake asks overlapping questions

**P2 · Observed.** “New or recurring?” overlaps “Has this happened before?”; affected people and Impact overlap. A long universal form asks diagnostic questions that may not apply to a service request.

Recommendation: conditional fields by request type/category, a minimal required core, clearer plain-language impact/urgency questions and optional diagnostic sections. Reuse the existing configurable form engine. Preserve historical fields and reporting mappings during any schema transition.

### A40 — Public support attachments require a separate email

**P3 · Explicit current limitation / Opportunity.** The live form says attachments are not accepted and instructs the requester to email them later with the ticket number. This creates a split intake journey.

Recommendation: consider bounded public attachment intake tied to a validated submission, with existing scanning, limits, private storage and abuse controls. This is a new feature requiring security review and controlled tests, not a simple style change.

### A41 — Public location choices may drift from the client directory

**P2 · Configuration/schema review candidate.** Support displays a curated location list rather than every client, which may be intentional. Its relationship to routing/client identity needs to be explicit.

Recommendation: use stable client/location references when a selection is intended to establish a relationship; retain intentionally curated choices and “Other.” Acceptance: changing a display name does not silently break routing, and administrators can see the mapping. No current incorrect assignment was proven.

## 5. Product practices worth adopting

### A42 — A contextual “My Work” workspace

**P3 · Opportunity.** Combine today's ticket activities, visits, event tasks, project commitments and QC actions for the current user, with clear source labels and permission-aware links. Reuse Operations and the existing entities. Start with an agenda and actionable queue, not another independent data store or redundant dashboard.

### A43 — A shared service context and deliberate request catalog

**P3 · Opportunity.** Standardized request types, service ownership, related client/assets/knowledge and clear workflow handoffs can reduce interpretation and repeated entry. Gradually add incident/problem/change relationships only where real usage justifies them. Avoid introducing an entire ITIL hierarchy as mandatory form fields.

### A44 — Explainable automation and configuration diagnostics

**P2 · Opportunity.** Workflow History, QC audit and ticket email readiness already provide useful foundations. Extend these with “why assigned,” “which rule changed status,” “why email was omitted,” and safe configuration validation. A disabled named reopen rule alone does not prove tickets cannot reopen: another active customer-reply rule targets any state. Show the effective result of rule priority rather than making users infer it from separate rows.

Recommendation: read-only rule previews and outcome explanations; do not execute a rule or send a notification merely to preview it. AI assistance should remain human-approved, preserve source links and never auto-send customer communications.

## External references reviewed

- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/): use as the accessibility baseline for contrast, control names, reflow, keyboard/focus visibility and target sizing. A formal audit requires more than this visual review.
- [IBM Carbon data-table guidance](https://carbondesignsystem.com/components/data-table/usage/): consistent toolbar, filtering, row actions, selection/batch behavior and appropriate density support the proposed shared table patterns.
- [Atlassian service request management guidance](https://www.atlassian.com/itsm/service-request-management/): standardized intake, service catalog and coherent fulfillment inform A39/A43. These are applicable practices, not a recommendation to copy another product's interface.

## Recommended implementation sequence

1. **Correct trust in the data.** A01–A05, A08–A13 and A26: metric/filter parity, calendar boundaries, complete aggregation, stable identities, cancellation context, RMM mapping/freshness, client pagination and UI/API capabilities. Reproduce each with targeted fixtures before editing.
2. **Establish reusable presentation and interaction rules.** Compact page header; table/filter toolbar; form field; save/status bar; drawer/dialog footer; empty/error/loading state; status badge; chart series and accessible values. Apply first to Settings/Support builder, Events, Clients and Devices. Preserve the recent Ticket Composer and Reports behavior.
3. **Connect existing work.** A06, A14–A20: activity agenda, client workspace, deliberate asset relationships and QC readiness. Separate missing configuration from new integration code. Any data repair needs a read-only inventory and reviewed impact plan first.
4. **Refine intake and daily work.** A31–A44: simpler report configuration, KB taxonomy, public intake, My Work and explainable rule outcomes. Prioritize using observed operator friction rather than adding every possible control.

Each stage should remain independently deployable. No branch/worktree proliferation or broad dependency upgrade is needed for this proposal. An implementation request must recheck current Git state and preserve contributor changes.

## Acceptance and regression plan for a future implementation

- Every KPI reconciles with its drilldown and export under the same permissions, filters, date basis and timezone.
- More than 80 operational items, more than three assignees, more than 50 clients and same-name users remain complete and distinguishable.
- Cancelled/completed parent work has an explicit child-task policy; history remains available and auditable.
- Scheduled work is visible without replacing deadlines; closure/reopening behavior remains consistent with established ticket activity rules.
- Save/autosave states are visible and accurate; failed saves retain input; action footers stay reachable with long forms, attachments and narrow viewports.
- Test representative administrator, technician, read-only, QC-reviewer and restricted-client scenarios without broadening permissions.
- Test desktop, laptop and narrow/mobile widths, 200% text zoom, keyboard-only operation and configured light/dark/OLED themes before claiming accessibility or responsive completion.
- Preserve inbound/outbound HTML, signatures, attachments, CC rules, internal-note privacy, reply threading and authorized email `[Closed]` handling. Use controlled test participants for real outbound checks.
- Preserve per-user report sections, columns, exclusions and sorting in PDF/Excel; distinguish provider acceptance from delivery.
- Run targeted API tests, API/web lint and appropriate build/runtime checks for implemented changes. This report itself did not require application tests or a build.
- Deploy only after explicit authorization, using the established guarded workflow with verified backup/recovery, revision, services, endpoints and live UI.

## Decisions still needed

- QC business configuration and pilot participants remain undecided; the audit does not supply invented values.
- Whether event cancellation automatically cancels open child tasks or retains selected follow-up work.
- Whether to add a time-based capacity model beyond the existing configurable item baseline.
- Whether candidate duplicate client records represent the same customer; source identifiers and ownership must decide this.
- Whether public attachment intake and additional service-catalog relationships belong in the first optimization release or a later stage.

No evidence in this review establishes generalized data loss or database corruption. Several observed inconsistencies are presentation/definition gaps, and others are concrete risks requiring targeted reproduction. The next change should address these distinctions explicitly rather than attempting a blanket cleanup of production data.
