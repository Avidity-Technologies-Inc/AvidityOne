# Ticket scheduled activities — September 15, 2026

## Release state

Implemented locally on `codex/ticket-scheduled-activities`, based on canonical `main` at `c083b19`. The initial worktree was clean; canonical origin was fetched with zero divergence. Publication is authorized for this release. Production deployment has not been performed; the server remains at its previously verified release until the deployment commands are executed.

## User workflow

Ticket Tools now opens **Activities**, retaining the existing meeting API and permission strings. The **Scheduled Activities** panel supports work sessions, service visits and meetings. Explicit modality is remote, on-site or hybrid; Teams remains a separate capability for remote activities, is disabled for on-site activities, and is required for hybrid activities.

New activities default to a remote work reservation for the selected responsible person/organizer, with no attendees and no Teams. Suggested participants come from the existing ticket records and are added explicitly. The actual attendee list determines whether scheduling reserves only the organizer calendar or sends invitations. Existing meetings preserve their attendees, locations, organizer and Teams link.

A draft can be saved before a physical location is known. Scheduling on-site/hybrid work, or updating an already published activity into those modes, requires a location. The ticket target date remains independent of the scheduled start/end and timezone. The next unfinished calendar activity is shown beneath the ticket header.

The panel uses a document-body portal, bounded scrolling, keyboard focus containment, Escape/close handling, unsaved-change confirmation, mobile layouts and visible save/schedule actions. Activity type, modality and location appear in its list and timeline. Settings and Profile access previews use the Scheduled Activities label while retaining `ticket_meetings.*` grants.

## Ticket closure and calendar consequences

When a closed ticket is displayed, unresolved draft/scheduled activities appear in a closeout panel. This covers closure through a status change or reply-and-close after the detail reloads, and previously closed/bulk-closed tickets when opened. No calendar action occurs merely because a ticket is closed or reopened.

Each activity can be reviewed and retained, marked performed, or explicitly cancelled subject to existing permissions. Marking performed retains the calendar event and records completion in Avidity One; it does not close the ticket. Future activities require explicit confirmation before being marked performed.

A future work session without invited attendees additionally offers **Work done early · free calendar**. It requires both update and cancellation permissions. The API validates eligibility, removes the personal calendar reservation, and records actual completion with the release fact in ticket activity history. A provider failure leaves the activity unfinished with visible failure information. Sequential retries after successful completion do not duplicate the completion record.

Cancelling a personal reservation uses Microsoft event DELETE; cancelling an invited meeting uses the existing cancellation endpoint and notifies invitees. Before personal deletion the adapter reads Outlook attendees, refusing to delete when the provider audience differs or cannot be verified. This guards against treating an unsynchronized invited event as a personal reservation. A missing provider event is treated as already removed. This does not implement continuous Outlook synchronization or a Microsoft To Do task.

## Compatibility and implementation

- Additive migration `20260915140000_ticket_scheduled_activities` introduces `TicketActivityType` and `TicketActivityMode`, adds `activityType` (default `MEETING`) and nullable `modality` to `ticket_meetings`.
- Existing rows remain meetings with unspecified modality. No address-based historical classification, mass record rewrite, attendee change or provider call occurs during migration.
- Existing routes and four permission strings remain. New `POST /tickets/:ticketId/meetings/:meetingId/complete-and-release` requires both `ticket_meetings.update` and `ticket_meetings.cancel` and uses the existing organization/ticket lookup.
- Graph PATCH now includes Teams activation when requested, fixing the prior local-only conversion from a non-Teams event. Existing Microsoft-generated Teams body content is retained. An already online event cannot be converted to offline; the UI explains retaining Teams via remote/hybrid or explicitly replacing the event.
- Responsible users, ticket references, attendees, calendar credentials and timezone defaults reuse existing records/configuration. No invented client locations, new credentials, dependencies or external providers are introduced.
- Main files: ticket-meetings DTO/controller/service, microsoft-calendar service, TicketMeetingDrawer, TicketActivityCloseout, TicketDetailWorkspace and scoped styles. Database evidence retains the existing TicketMeeting/TicketActivity model names.

## Validation

- Prisma client generation and all 89 migrations applied successfully to a new disposable PostgreSQL 16 database only.
- `npm run lint:api`, `npm run lint:web` and full `npm run build`: passed.
- API: **33 suites / 155 tests passed**, with `QC_TEST_DATABASE_URL` set to the dedicated synthetic database. New authenticated runtime cases cover session/permission validation, invalid modalities, personal reservations, legacy preservation, location requirements, explicit invited hybrid events, early completion permission/failure/retry behavior and terminal activity protection. Calendar adapter tests cover Teams PATCH, personal deletion/idempotency and mismatched provider audience.
- Browser: **123 tests passed** across Chromium, Firefox and WebKit. New tests mount the actual activity components and cover payloads, invite selection, draft/scheduling validation, legacy Teams, failed saves, dirty close/focus handling, closeout permissions and responsive light/dark layout. Existing QC, access, editor, conversation and meeting-layout regression tests also passed.
- Reviewed generated desktop and mobile activity screenshots. Browser and Microsoft provider fixtures are synthetic; no real invitation, cancellation, calendar deletion or production activity was performed during validation.
- `git diff --check`: passed.

The disposable database is `qc_validation` at `127.0.0.1:55473`, container `avidity-activities-validation`. No existing application database was migrated or seeded. The validation container and task-started local container runtime are stopped after checks.

## Deployment and acceptance

Server deployment remains pending. The release includes `scripts/deploy-ticket-activities.sh`, which takes the full published commit SHA and updates both API and web after applying the additive migration and generating Prisma. No environment, service, DNS or Microsoft credential changes are required. Preserve production settings and prior build artifacts.

After deployment, run a controlled authorized calendar pilot: personal reservation, on-site invitation, hybrid/Teams update, cancel with invitees, early work completion and release, calendar failure recovery, and ordinary ticket closure/reopening. Validate final Outlook display and audience before routine use. Completed activity state is stored in Avidity One; it is not an Outlook task completion flag. Existing concurrency/provider outage limits require avoiding simultaneous conflicting edits during the pilot.

### Native server procedure

Run the helper as root only on `avidityhelpdesk`, after fetching the published commit into `/opt/avidity/app`. Extract it from that exact commit with `git show <release-sha>:scripts/deploy-ticket-activities.sh` into a temporary file, then run `bash <temporary-file> <release-sha>`. Run Git commands as the `avidity` account. A verified incremental Git bundle can supply the commit if the server still lacks persistent GitHub authentication. Do not change credentials or bypass a failed preflight.

The helper requires a clean checkout at `c083b199e6144fd0b128cc1cb62141fb73ed77c8`, active API/web services, unchanged dependency manifests, only the expected new migration, and the existing database migrations applied. It records the previous source, build artifacts, generated Prisma client and a PostgreSQL custom-format backup under `/opt/avidity/activities-backup.*`. There is downtime while services are stopped for the consistent backups, migration and build. Configuration files and service definitions are not modified.

On failure after stopping, the helper attempts to restore the previous source/builds and restart the services. It retains additive database changes and does not restore or delete database data. A failed recovery leaves the services stopped and prints the recovery directory for manual inspection. Successful deployment requires local/public health checks, active services and the exact clean release checkout. The helper was syntax-checked locally; it has not been executed against production.
