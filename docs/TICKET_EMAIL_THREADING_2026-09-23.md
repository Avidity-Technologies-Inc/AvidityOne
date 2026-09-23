# Ticket email threading — September 23, 2026

## Verified cause

Read-only production/Microsoft inspection linked the new AIT-100673 reply to the outbound attachment message from AIT-100645. That outbound message had been submitted through the access-denied fallback from createReply to JSON sendMail, with no original References/In-Reply-To, no ticket number and no persisted actual Internet Message-ID. The client's reply carried a new Graph conversation ID and referenced only that outbound email. It was correctly ingested but could not be associated with the original ticket. Eight attachment sends across five tickets had used this transport since September 18; this is an exposure count, not a confirmed duplicate count.

## Correction

- Customer/public mail uses RFC MIME via Graph /reply with the current Mail.Send grant, including ordinary attachments, related inline images and alternative HTML/text. It does not create writable drafts or fall back to unrelated mail after rejection. Forwarded ingestion uses the configured public sending mailbox, explicit recipients and RFC references via MIME sendMail.
- MIME includes a unique RFC Message-ID and ordered parent/ancestor references. A single bounded Sent Items read retrieves Graph metadata when available. Indexing/readback failure logs a pending diagnostic and retains the submitted RFC ID; it never retries an accepted send. An acceptance receipt remains distinct from a Graph ID. Unknown send outcomes explicitly tell the operator to check Sent Items before resending.
- Ticket replies and acknowledgments include the existing record's ticket number in subject and body. Branding/prefixes are not hardcoded. The stored conversation ID no longer contains an Internet Message-ID; public replies retain their parent/reference metadata.
- Inbound matching prioritizes the direct parent and newest ancestors, then a unique subject ticket number, then Graph conversation, then a unique body ticket number. Number-only recovery requires an existing requester/contact/conversation participant or public message sender/CC. Multiple number mentions and same-subject text alone do not trigger association. Existing organization/deletion scope, merges and customer-reply reopening are retained.
- Staff operational copies and direct [Closed] processing keep their existing recipient, permission, attachment and action contracts.

Microsoft documentation: [reply in MIME with Mail.Send](https://learn.microsoft.com/en-us/graph/api/message-reply?view=graph-rest-1.0), [sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).

## Validation and limits

API type checking and build passed. The full API run with the disposable email PostgreSQL database passed 223 tests across 39 suites; 28 existing QC/activity database cases in three separate suites were skipped because their dedicated database was not started. Threading database tests verify changed-conversation replies stay in/reopen the original ticket, participant-only numeric fallback and organization isolation. Independent Python email parsing verifies Unicode subjects/filenames, text/HTML, CID images and byte-exact attachments. Four isolated deployment checks cover startup, build/health recovery and rejection of an unreviewed baseline.

No dependency, schema, environment or Microsoft permission change. No unsolicited real email is sent for validation. Real Outlook/Exchange round-trip acceptance is a post-deployment user check; local tests do not prove tenant delivery. Already delivered old mail cannot gain the new number/reference headers retroactively. Existing duplicates are not merged or replayed automatically; inspect and merge confirmed cases through the normal workflow.

## Production procedure

`scripts/deploy-ticket-email-threading.sh <full-published-sha>` accepts clean canonical main at `367354e16b6d47ce118fb6ee4bd715399794cca4` or the target for a retry. It checks current health, backs up source/API, rebuilds only API, and explicitly starts both API and web because web requires API. It verifies configuration checksums and local/public endpoints, and restores the previous API runtime on failure. No database migration or customer-message replay occurs.

Publication/deployment are authorized and pending at commit time. Independently verify revision, services, health endpoints and authenticated UI after execution.
