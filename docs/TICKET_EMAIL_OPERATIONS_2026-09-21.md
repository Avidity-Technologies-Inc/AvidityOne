# Ticket operational email

## Current direct-reply behavior

The direct-reply release supersedes the original confirmation workflow. When enabled, a specialist replies to their own operational notification, keeping the ticket/AO reference in the subject. Avidity One checks the registered sender, organization, mailbox, current ticket membership and action permissions, then records and sends the new reply directly. No `[Confirm ...]` step is required.

A standalone `[Closed]` on the first line of newly authored text requests reply-and-close. The command is removed from the posted body. Commands in quoted history are never executed. A close-only email uses the existing close workflow and audit trail. Replies with content/files use the existing public reply or internal-note operations, so activity and QC behavior remain connected.

A later customer reply reactivates the same closed ticket through the established inbound workflow. A subsequent public specialist reply without `[Closed]` follows the existing technician-reply workflow (normally Waiting on Customer); internal notes do not reopen a ticket merely because a note was added. Automated mail and operational receipts do not act as specialist commands.

## Configuration and access

Settings > Notifications > Ticket email operations configures full copies, assignment history, attachment inclusion, teams/groups/followers, internal notes, replies and close commands. Profile > Notifications shows the policy and the current user's delivery/action history. Existing per-user master/email event switches determine which copies are sent. Existing settings are retained at deployment; the release does not enable previously disabled organizations or change memberships.

Only currently eligible registered users with the relevant permissions can execute email actions. External specialist contact records are not automatically granted command access. Public replies go to the current requester/conversation recipients; internal notes remain staff-only. Mail matched only by an unrelated/forwarded identity is not executed. A pending password-change requirement is explained explicitly, with Profile > Password as the remedy.

Confirmation validity is no longer shown or used for new replies. Historical confirmation fields remain in storage for compatibility, without creating a migration. Legacy pending/expired proposals must be resubmitted as new replies; they are not executed on deployment, duplicate mailbox ingestion, or an old confirmation response.

## Content and attachments

Assignment copies include public history according to settings; subsequent copies contain the new communication. Safe HTML, signature layout and inline references use the existing sanitizer. Fresh reply extraction recognizes Outlook Mac/Windows and Gmail quote structures, removing cited history consistently from HTML and text. Unrecognized ambiguous formatting can still fall back to safe text instead of copying old conversation content.

Original reply attachments pass through existing upload permissions, validation and scanning before the ticket operation. Inline images belonging only to the removed quoted thread are not imported as fresh signature content. Normal files and the new signature's referenced inline images remain included.

Operational notification attachments have a configurable 1–2 MB total raw-byte budget for the current Microsoft transport. Original files take priority over additional downloadable image copies; both count toward that budget. Labels identify embedded images, attached files and any omission. Blocked/suspicious, unreadable, oversized or unauthorized files are not silently reported as included. Existing scanner behavior for PENDING files is retained. Conversations exceeding the 1 MB body safety limit fail visibly instead of being truncated.

## Processing, traceability and recovery

A unique source key claims the email before executing any reply/closure. Concurrent or repeated mailbox processing cannot execute that action twice. Previously rejected emails remain rejected even if permissions subsequently change; send a new reply after resolving the reason. Legacy confirmations are not replayed. Current policy/membership is checked again after retrieving files.

Successful actions record COMPLETED and issue an informational receipt; this receipt asks for no further action. A failure of that receipt does not make the completed ticket operation retryable. Preparation rejection and potentially partial execution are distinguished as REJECTED and REVIEW REQUIRED. Inspect the ticket and sent mail before resubmitting an interrupted action.

Operational copies use Microsoft sendMail with existing Mail.Send permission. No Mail.ReadWrite grant, draft creation or new credentials are needed. Mail.Read continues to support ingestion. Provider acceptance is distinct from proof of inbox receipt. AO references link specialist replies; native Outlook conversation grouping is not guaranteed.

The outbound worker polls every five seconds with bounded concurrency and per-recipient ordering. Source attachment imports may briefly defer copies; provider throttling and mailbox synchronization still determine delivery timing. Known rejection, throttling and uncertain provider acceptance remain distinct. Uncertain deliveries are never automatically replayed.

## Validation and deployment

The direct-reply release passed 233 tests in 39 API suites with isolated PostgreSQL, including direct close, duplicate claims, current permissions, old proposal suppression, signature/attachment preservation and failure handling. All 12 Settings/Profile browser checks passed across Chromium, Firefox and WebKit. API/web type checks and the full production build passed. No real customer/staff email was sent for these checks.

Use `scripts/deploy-ticket-email-direct.sh <full-release-sha>` from the reviewed `daedfde` production baseline or the exact target for retry. The helper preserves source and both application runtimes, rebuilds API/web, starts both systemd services and verifies local/public health. It does not change the schema, dependencies, environment, notification policy or access grants. It restores both old runtimes after a failed build/health check; Git remains at the attempted revision for inspection/retry.

Both services must be managed together: the native avidity-web unit requires avidity-api. The earlier API-only restart defect is documented in PROJECT_HANDOFF.md. Actual Outlook delivery/rendering remains a post-deployment acceptance check, separate from synthetic validation.
