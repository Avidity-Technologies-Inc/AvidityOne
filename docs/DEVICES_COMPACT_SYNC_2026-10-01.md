# Compact Devices and automatic RMM synchronization — October 1, 2026

## Scope

Approved follow-up from clean canonical `main` at `1d94fbff0b7cafbdba899083887fc941990edbe8`, verified equal to GitHub before editing. No schema, dependency, credential, permission or environment changes. Publication is authorized; production deployment is left to the user for this request.

- Compact header, synchronization summary and rows give more space to inventory. Connect, Remote BG and SysInfo use three aligned icon buttons with their existing accessible names and explanatory tooltips. Cards/tree retain labeled actions.
- The three-dot menu exposes advanced filters/order, saved views and synchronization details. Criteria remain active when hidden, with a visible indicator for site/only-favorites filters. Column ordering, search, pagination and saved views retain their existing behavior.
- Removed the per-row Inventory timestamp and repeated hostname/site text. Last observation remains visible; complete hardware details remain available through SysInfo. Matching network addresses remain prominent, otherwise a usable local IPv4 address is preferred over loopback/link-local addresses when available.

## Synchronization findings and correction

The live inventory showed a successful October 1 list synchronization and current last-seen values, while full hardware snapshots still carried September 29 timestamps. These timestamps represent different observations. Automatic inventory synchronization intentionally uses the lightweight RMM list endpoint; it does not call every device's hardware-detail endpoint each interval.

Previously, future mailbox/report schedules could repeatedly defer inventory until twice the configured interval elapsed. Only an actual recent mailbox synchronization lock now postpones a due run, for five minutes. Future due times do not block it. Minute polling and active mailbox work mean this is an interval schedule, not an exact wall-clock guarantee. A local scan guard and an atomic database claim prevent overlapping automatic scheduler runs.

The scheduler/settings fallback is now 30 minutes; explicitly saved values are preserved. Successful or failed attempts schedule the next run using that saved interval. Existing rich hardware snapshots now accept fresh network/agent fields from the list response instead of freezing them at the last full-detail fetch. Omitted detail fields and the full-detail timestamp are preserved.

The Devices header displays the saved interval/activation state; expandable details show the last attempt, result and next scheduled run. Settings > RMM Integration continues to control activation and interval.

## Validation and limits

- API/web TypeScript checks and full shared/API/Next production build passed.
- Backend: 236 passed, 58 existing isolated-database tests skipped because their test database configuration was not supplied. Focused inventory/RMM coverage: 28 cases, including interval calculation, fresh snapshot merging, atomic claims, overlapping scans and mailbox deferral.
- Fifteen browser cases passed across Chromium, Firefox and WebKit with synthetic inventory. Coverage includes one-line actions, hidden filter persistence, synchronization details, saved views, search, paging, all views and stale response protection. Desktop/mobile and light/dark screenshots were inspected.
- Three isolated deployment test methods cover success, same-release retry, build failure recovery and health failure recovery. They do not call real services.
- Production Chrome inspection was interrupted by another extension's open UI before RMM settings finished loading. The stored production interval was not confirmed or changed. No production synchronization or remote connection was triggered for testing.

## Deployment and 30-minute activation

Run `scripts/deploy-devices-compact.sh <full-published-release-sha>` as root on the native host after fetching canonical origin. It requires clean `main` at the reviewed `1d94fbf` baseline or the exact target on retry. It checks schema status without applying migrations, backs up source/runtime, builds all workspaces, starts both dependent services and checks local/public endpoints. Failure restores the prior runtime; Git remains at the attempted revision, as reported by the helper. Existing settings and environment are preserved.

Both services are stopped during the build, so use a maintenance window. A different server revision must be inspected rather than bypassing the guard.

After deployment:

1. In **Settings > RMM Integration**, keep the existing provider details, enable **automatic RMM sync**, set the interval to **30 minutes**, and save.
2. Open Devices > three-dot menu > Synchronization details. Confirm the saved interval, next run and subsequent result. Reopening/refreshing Devices fetches the current status; the page does not stream progress.
3. Verify actions fit on one line, additional filters toggle without clearing criteria, and known IP searches still find the expected devices. No ticket/mail/permission configuration needs changing.
