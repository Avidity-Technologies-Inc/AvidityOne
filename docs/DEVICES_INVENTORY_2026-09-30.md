# Device inventory search and ordering — September 30, 2026

## Scope and compatibility

Approved follow-up from clean canonical `main` at `88067364e57c54bf9c28f701f4d162429ec4ff59`. Changes are limited to Devices browsing, tests, documentation and a guarded deployment helper. No schema, dependency, credential, permission, synchronization-policy or environment changes. No production data edits or remote sessions were performed during validation.

- Search includes all stored local IPs, public IP, MAC addresses, site, OS version, serial number and asset tag alongside existing device/hostname/client/user/RMM ID fields. Matches are case-insensitive substrings, including IPv4 prefixes and IPv6 text; CIDR calculations and alternate IPv6 compression equivalence are not implied. Network matches are identified in the result, including addresses previously hidden behind the first interface.
- Device, Client/Site, Site/Client, OS and Status support natural ascending/descending ordering. Missing values sort last; names and IDs break ties. Favorites-first is explicit and can be disabled for strict alphabetical ordering. Default remains client order with favorites first.
- Site and only-favorites filters, clear filters, and column/direction controls work with the existing client/status/type/category controls. Saved-view JSON retains these controls; old views use compatible defaults. URL type filtering is restored and explicit URL criteria take precedence over the default view.
- API pagination operates after filtering, category counts and ordering over the complete candidate inventory, removing the old 500-record cutoff. Responses include `filteredTotal`, `categoryCounts`, `page`, `pageSize`, `totalPages`, `sites` and per-record `matchedNetwork`. Unpaged callers retain a full list; the Devices UI requests pages of 25/50/100. Tree view groups records on the current page, explicitly labeled as such.
- The server selects organization-scoped inventory summaries using Prisma, performs natural comparison and substring matching on the stored network JSON, then hydrates only the selected page. This deliberately avoids schema changes and repeated live RMM calls. Candidate scanning is linear per request; very large future inventories may justify a dedicated indexed network search projection. There is no silent truncation.
- Short input coalescing, request cancellation and response identity checks prevent stale search responses. Favorites are reloaded under current criteria after a change, keeping counts and paging accurate.
- Network has its own table column, copy controls and expandable LAN/WAN/MAC addresses. Cards and tree use the same network presentation. OS version and agent version have separate labels. Last-seen and inventory timestamps describe observations, not live connectivity.

## Validation

- API and web TypeScript checks; full shared/API/Next production build passed.
- API regression: 231 passed; 58 existing database-dependent cases skipped because their isolated test database variables were not configured. The 23 focused inventory/RMM cases passed, including more than 500 records, secondary IPs, natural ordering, nulls, invalid query controls, category counts, organization/user constraints and paged/unpaged compatibility.
- Twelve browser scenarios across Chromium, Firefox and WebKit cover ordering, paging, existing and updated saved views, IP/MAC/IPv6/WAN search, filters, URL state, favorite removal, all three views and stale responses. Screenshots inspected at desktop/mobile widths and in dark theme. Browser API responses use synthetic inventory; no production RMM requests or real record changes.
- Isolated deployment tests cover success, same-release retry, build failure recovery and health failure recovery, including both dependent systemd services. No real services are invoked by these tests.

## Deployment

Run `scripts/deploy-devices-inventory.sh <full-published-release-sha>` as root on the native production host after fetching canonical origin. It accepts the reviewed baseline `8806736` or the exact target on retry, requires clean `main` and active services, verifies schema status without applying migrations, preserves source/runtime, builds all workspaces, restarts API and web together, then checks internal health/login and all three public entry points. A failed build or health check restores the prior runtime. The recovery directory is printed; Git remains at the attempted revision after runtime recovery, as explicitly reported by the helper.

The build requires a brief maintenance window because both dependent services are stopped while their existing runtime directories are rebuilt. The script does not modify `.env.production`, services, dependencies or schema. If the server revision differs from the reviewed baseline, inspect it before proceeding instead of bypassing the check.

After deployment, verify a real known local/public IP, a secondary interface if available, both directions for each column, favorites first off, a saved view, and next-page navigation. Publication is authorized; production execution is left to the user in this request.
