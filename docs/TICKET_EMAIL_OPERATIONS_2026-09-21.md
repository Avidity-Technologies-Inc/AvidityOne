# Ticket operational email

Implemented from clean canonical `main` at `d8df408`. This release does not activate operational email, modify individual preferences, send test mail, grant permissions or deploy production.

## Behavior and configuration

Settings > Notifications > Ticket email operations configures complete ticket copies, history on assignment, attachments, current team/group membership, explicit followers, internal notes, email replies and the `[Closed]` command. Profile > Notifications shows the organization's policy and the current user's delivery/action history alongside existing personal notification preferences. Save and unsaved-state controls are explicit.

New behavior is opt-in: full ticket email, replies and closing default off. Existing per-user master/email event switches remain required for conversation copies. Confirmation/result receipts are responses to an explicit email operation and are sent separately from subscription preferences. Assigned users receive at their registered account addresses. Teams/groups/followers are selected from existing records and rechecked at delivery; external specialist records do not automatically receive private content or command authority. External addresses already included in a ticket's public conversation remain normal public recipients. Staff deliberately CC'd on public mail can receive both that public copy and their separate operational copy.

Assignment snapshots include available public history (or the latest message when history is disabled). Subsequent deliveries carry the new message. Internal notes use a separate staff-only context. Saved-but-unsent internal notes remain silent. Private attachments use existing access/storage/scanner rules, with a configurable 1–2 MB total raw attachment budget for the current small-attachment transport. Blocked, unreadable or oversized files are explicitly identified; a link alone is not presented as an offline copy. Files with the existing PENDING scan state continue to follow the existing outbound policy. Inline content IDs are disambiguated across messages in history. Conversations over the 1 MB body safety limit fail visibly rather than being silently truncated.

The Microsoft projection now reads the full body instead of `bodyPreview`. Safe HTML is preserved where the new response can be isolated; otherwise the new text is rendered safely. Source email HTML/text is retained in the email action record. Conversation HTML uses the existing email sanitizer.

## Reply and close workflow

1. Reply to the personal operational notification, retaining its `[AO:…]` subject reference and writing above the separator. Its PUBLIC/INTERNAL label determines the channel; email CC changes are not imported into the ticket.
2. Optionally place `[Closed]` on the first nonempty line. Text below the command is the proposed reply; a command alone closes without creating a customer message.
3. A separate confirmation is sent only to the current registered specialist address. It shows the new text, public recipients, action and attachment presence. Reply with the exact `[Confirm …]` first line within the configured 5–60 minute validity. No session or UI access is required.
4. At confirmation, the system rechecks identity by mailbox possession, active account, assignment/subscription, current permissions, public recipient snapshot and feature policy. A From address or a forwarded notification token alone cannot execute an action. Password-reset-required accounts cannot act by email.
5. Original-message attachments are imported through the existing validation/scanner path. Existing ticket reply/close services apply workflow transitions and produce the normal audit/QC source events. Activity/calendar changes continue to follow their existing closeout workflow; the email command does not invent completion times or cancel visits.
6. A result receipt distinguishes completion, expiry, rejection and a partial/uncertain operation requiring review.

Only newly authored first-line commands are accepted. Quoted/forwarded messages, HTML quote blocks and automatic replies cannot execute commands. PUBLIC and INTERNAL context tokens do not switch modes. Current `tickets.view`, `ticket_messages.view`, `tickets.reply`, relevant message-create permission and, for closure, `tickets.close` are required. File upload/download permissions are also respected. A removed assignee's automatic follow record is removed; deliberate followers remain subject to policy. Unlinked replies from eligible staff to an existing ticket are held out of the customer ingestion path and receive instructions to use their operational thread. Existing customer message ingestion and direct/forwarded mailbox modes remain intact.

## Persistence and recovery

One additive migration adds four operational email tables, a `suppressOperationalEmail` message flag, and transactional source-capture triggers. Capture is gated by the organization policy. No history is backfilled or emailed by the migration. Triggers retain events even if a process exits between saving the ticket and creating its recipient deliveries. Source capture and delivery queues use deduplication keys and atomic claims; confirmation and its receipt are created in one transaction. Queued messages recheck live permissions, recipients and preferences. Event capture emits neither mail nor external calls inside database transactions.

Pending preparations retry with bounded backoff; interrupted preparation leases recover. Provider-side uncertainty moves to REVIEW REQUIRED rather than an automatic resend. The administrator must inspect Sent Items before using Retry delivery, which explicitly warns about possible duplication. Email action retries are not automatic after partial/uncertain execution: inspect the ticket and mailbox, then submit a new operation if appropriate. Accepted means provider acceptance, not inbox receipt. Mock delivery is labeled Simulated. Personal confirmations are capped at five outstanding operations.

Operational copies use Microsoft draft/send and immutable IDs to continue the specialist's PUBLIC or INTERNAL conversation without inheriting customer recipients. This requires the existing app registration/mailbox policy to permit Mail.ReadWrite and Mail.Send for the sending mailbox. Missing Graph permissions fail visibly; no IAM grant or credential change is performed. References: [createReply](https://learn.microsoft.com/en-us/graph/api/message-createreply?view=graph-rest-1.0), [message identifiers](https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0).

## Deployment and acceptance

Use `scripts/deploy-ticket-email.sh <full-published-sha>` on the existing native host. It accepts clean production `main` at `d8df408` or the exact target for recovery, backs up source/runtime/database, applies the additive migration, regenerates Prisma, builds API/web and checks service/public health. It does not change environment files, dependencies, service definitions, permissions or active email policies. The recovery path retains additive schema changes and restores previous runtime artifacts; inspect before retrying.

After deployment, verify Settings/Profile, outbound mailbox permissions, auto-sync schedule and individual notification coverage. Enable the feature for a controlled internal pilot, then verify actual Outlook receipts, reply formatting/inline images, attachments, PUBLIC versus INTERNAL threads, commands, reassignment and failure recovery. Local synthetic checks do not establish Microsoft tenant acceptance. A server outage delays processing until the mailbox worker resumes; queued email cannot close a ticket while the server is offline.

## Validation record

- All 91 migrations applied to disposable PostgreSQL 16; schema comparison reports no differences for the new email models. Existing schema/migration differences in other modules were retained. Existing QC/activity suites used their separately guarded disposable database.
- API regression: 205 tests passed, no skips. Coverage includes atomic capture/claims, concurrent confirmation, live permission loss, recipient changes, forged/automatic/quoted messages, expiry, public/internal delivery, assignment versus explicit followers, attachment validation/inline metadata, blocked files, ambiguous send recovery and authenticated endpoint scoping.
- API/web TypeScript and complete production build passed; API rebuilt after the final follower handling correction.
- 36 focused browser cases passed across Chromium, Firefox and WebKit (new email controls, composer and email formatting); the final 12 email controls cases passed again. Desktop Settings and mobile Profile screenshots were visually inspected.
- No live Microsoft send, production mutation or server deployment was performed. Validate real tenant delivery in the controlled pilot.
