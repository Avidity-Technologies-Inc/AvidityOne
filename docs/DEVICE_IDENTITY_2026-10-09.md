# Device identity and RMM installation history

## Problem and verified scope

The previous synchronization matched an agent by provider ID **or client and hostname**. Two different Tactical installations with the same hostname could therefore overwrite one equipment record, including its remote connection. The old summary counted processed agents as updated devices.

Read-only production inspection on October 9 confirmed 253 distinct Tactical agent IDs and 250 active Avidity equipment records. All six agents in the three suspected pairs were inspected through provider detail reads. Two Apple pairs had matching hardware serials and models. The Dell pair had matching BIOS serial, manufacturer and model despite different sites; only the older installation reported a hardware UUID. Each pair had an older inactive observation and a newer observation. This supports retaining three equipment identities with separate installation histories. Actual customer names, serials and agent IDs are not embedded in this release.

Production was verified at `6db6232dbbd0369341199ca326bdf31cd63eb107`. Inspection did not modify equipment, configuration or Tactical. Production consolidation remains a post-deployment operation; the migration does not guess the current installation or merge data.

## Behavior

- A Device UUID remains the stable equipment identity. Existing IDs, favorites and dependent records are preserved.
- A new installation registry identifies each Tactical installation by organization, provider and exact agent ID. Hostnames no longer authorize overwriting another device.
- System serial and hardware UUID are primary evidence, with manufacturer/model corroboration. MAC and hostname matches generate review candidates only. Generic identifiers, missing evidence, cloned/virtual hardware and conflicts do not authorize automatic linking.
- One current installation supplies the equipment's current name, site, status, inventory and remote connection. Earlier names and historical installations are retained. Missing agents are marked absent from the last complete inventory, not deleted.
- Conflicting client or hardware changes on an already linked agent preserve its equipment projection and require review. Remote actions and QC provider evidence are blocked while that current identity is disputed.
- Inventory reconciliation and operator decisions share a transaction lock; database constraints enforce unique provider IDs and one current installation per equipment record. Incomplete or malformed inventories fail before identity reconciliation.
- Counts distinguish equipment, observed agents, historical installations and pending reviews. Sync health reports pending reviews and detail failures as warnings.

## Operator workflow

1. After deployment, allow the next configured sync or use **Devices > Sync RMM**. The first sync reads details for previously untracked agents and bootstraps current links from exact existing provider IDs.
2. Open **Devices > Identity review**. Compare serial, UUID when available, manufacturer/model, site and last-seen evidence for each pair. Recheck the live evidence if activity has changed since the inspection.
3. If the pending agent is older, choose **Keep as historical installation** and the matching equipment. If the pending agent is the verified newer installation, choose **Use as current installation**; the previous installation becomes historical. For different hardware, choose **Create separate equipment**.
4. Enter a verification note. Decisions use the existing `remote_access.configure` permission and write audit records. Users with `devices.view` can inspect the evidence without applying decisions.
5. Inspect the equipment's **Identity and installation history** and current remote action target. After resolving the three verified pairs, 253 observed agents and 250 equipment records is an expected result, with three historical installations, if the source inventory remains unchanged.

**Settings > RMM Integration > Equipment identity and reinstallations** exposes the policy. Automatic linking defaults to **off**; the configurable minimum inactivity defaults to seven days. When explicitly enabled, linking requires one unambiguous same-client equipment candidate, strong hardware evidence, a known older inactive installation beyond the configured window, and no unresolved conflict. Existing sync intervals and credentials are preserved.

This release does not delete, uninstall, rename or otherwise mutate Tactical agents. It does not automatically move equipment between clients, merge existing Device records, or treat a matching MAC alone as proof. Historical-link corrections and cross-client transfers require a verified repair rather than an automatic reassignment.

## Validation

- API and web TypeScript checks and full production build passed.
- Full API suite: 290 passed across 44 suites; 67 unrelated tests in eight suites remained skipped because their separate database test environments were not configured.
- Identity database tests ran on disposable local PostgreSQL, including a 250-equipment/253-agent scenario, legacy ID and favorite preservation, manual decisions, strict automatic linking, stale observations, hardware conflict handling, tenant boundaries, concurrency and real Devices/RemoteAccess service integration.
- All existing migrations plus the new additive migration were applied on that disposable database. The read-only deployment schema checker passed.
- Browser tests: 27 passed across Chromium, Firefox and WebKit, including identity decisions, read-only permissions, narrow-screen layout and existing inventory filtering/sorting. Mobile output was visually inspected; browser APIs used synthetic fixtures.
- Deployment simulations passed for success and backup, migration, build, schema-check and health failures, including runtime recovery. No live production update was performed as part of these checks.

## Deployment and recovery

Run the published `scripts/deploy-device-identity.sh` from the exact release after fetching origin. It accepts the verified base above or the target release for retries, requires clean canonical `main`, checks dependency/migration scope, and backs up source, runtime and PostgreSQL before migration. It stops and starts both dependent services, builds API/web, checks schema constraints and verifies local/public endpoints. A maintenance interruption is expected during the build.

The helper leaves `.env.production`, systemd, Nginx, secrets and saved RMM settings unchanged. On failure it restores the previous runtime and starts both services. The additive schema is retained and Git remains at the attempted revision; inspect the reported recovery directory and service health before retrying. It never automatically restores a database dump over newer data.

After deployment, verify inventory counts, all three identity decisions, the current installation's remote actions, and the next automatic sync. These are production acceptance checks, not claims made by the local test run.
