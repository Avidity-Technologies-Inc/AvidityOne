# Production maintenance — October 9, 2026

## Completed work

The owner authorized the follow-up after the live server audit. Application release `2e2c37f511aac271b414a89c2a3b927ae8e2c598` was deployed from canonical `main` on `avidityhelpdesk`, under `/opt/avidity/app`. Subsequent documentation-only continuity updates do not change its compiled application artifacts.

- Fixed the false deployment rollback caused by Next's generated root-parameter declaration. The exact previously generated file and patch were backed up before normalization. All unrelated dirty-file protections remain active.
- System Health now distinguishes identity review warnings, incomplete device details, combined outcomes and unknown evidence. Organization scoping and scheduler diagnostics remain intact.
- Backed up database, PostgreSQL globals, application/host configuration, installed-package inventory and LVM metadata in `/root/avidity-maintenance-20261009.It6YCrKe`. The database dump listing and configuration archive were checked. Runtime recovery is retained in `/opt/avidity/security-dependencies-backup.ZL9zRfA6`; the earlier recovery directory was preserved.
- Expanded the existing root logical volume and ext4 filesystem online from 19 to 29 GiB; 9 GiB remains free in the volume group. Final root usage was 64%, with approximately 10 GiB available. No partition recreation or backup deletion was performed.
- Applied 37 reviewed package upgrades and 18 new dependencies from the existing official repositories. The new dependencies are Ubuntu's split firmware packages. Node is 22.23.3, npm 10.9.9 and cloudflared 2026.10.0. No packages were removed, repositories added, or configuration/credentials replaced.
- Reboot completed at 14:48:33 America/Chicago into kernel `6.8.0-146-generic`. No reboot remains pending.
- Rechecked the three installation pairs in the UI using serial/model, observation history and supporting MAC evidence. Retained the older installations as history with individual audit notes. Current equipment IDs, sites and remote connections remain intact. Nothing was deleted in Tactical RMM.
- The server-only `ui-modernization` branch pointed to June commit `a1b32ff`, with 164 commits behind main and zero unique commits. It was archived in a verified complete Git bundle under the maintenance backup and deleted with `git branch -d`. Local development, GitHub and production now use only `main`; no force push or history rewrite was used.

## Verification

- API/web type checks, full production build, 296 backend cases and all 28 focused health cases passed locally. The 79 database-gated cases were skipped in this narrow follow-up; the preceding dependency release exercised its full isolated-database suite. No schema change was introduced here.
- Five deployment test methods cover success, exact generated-file recovery, rejection of unrelated/unreviewed edits, preflight failures, and complete runtime restoration after install, gate, build, health or unexpected post-build source changes.
- Production clean installation, patched dependency/native-library gate, Prisma generation, shared/API/web build, read-only identity schema checks, and deployment exit code all passed. Environment checksum and clean server working tree were verified.
- Running Linux libraries: Next 16.3.8, Sharp 0.35.5, sanitize-html 2.17.7, libheif 1.23.5 and librsvg 2.63.2. The 17-family gate passed again after reboot.
- API, web, Nginx, PostgreSQL, Redis, ClamAV and cloudflared are active. No failed systemd units or unexpected API/web restarts were found. PostgreSQL accepted connections and Redis returned PONG. No application WARN/ERROR/FATAL entries were observed after reboot at the final check.
- API health, main login, Events and Support endpoints returned HTTP 200 from the server and independently from outside it. Authenticated Devices and System Health rendered correctly in Chrome.
- Automatic sync completed at 14:47:45. A full manual verification after reboot completed at 14:50:34: 255 unique agents, 252 equipment records updated, three historical installations, zero identity reviews pending, and all 255 detail refreshes completed. The next automatic run remains scheduled using the existing 15-minute setting.
- System Health showed zero warnings and zero errors. Earlier warning observations remain visible in history; they were not erased. No test emails, customer communications or synthetic production records were created.

## Remaining upstream items and limits

Production `npm audit --omit=dev` reports zero known vulnerabilities at verification time. Full npm audit still reports 34 development dependency entries derived from two unpatched advisories, braces and sprintf-js; GitHub currently shows one open development-only sprintf-js alert. These remain documented and enabled, not dismissed. See [dependency details](SECURITY_DEPENDENCIES_2026-10-09.md). Deprecation notices from transitive build dependencies may still appear during installation; unsupported major replacements were not forced merely to hide notices.

Ubuntu retains `open-iscsi` and `libopeniscsiusr` in its 10% phased rollout. The normal upgrade plan has no other available upgrades, and all installed snaps are current. Provider phasing was respected. This verification establishes the observed release and host state, not a guarantee against future vulnerabilities or untested business workflows; real customer mail/calendar/AI actions were not sent as tests.
