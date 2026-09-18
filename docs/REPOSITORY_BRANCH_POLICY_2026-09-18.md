# Repository branch policy and cleanup — September 18, 2026

## Approved workflow

The project owner requested a single `main` branch locally and on canonical GitHub (`Avidity-Technologies-Inc/AvidityOne`). Work directly on `main`; additional branches/worktrees require explicit authorization for the current task. Fetch and compare first, preserve existing work, and publish only explicitly authorized changes without rewriting shared history.

Dependency upgrades are handled by manual review and testing. The version-update PR limit is zero, and repository-level automated security-fix PR creation is disabled. Dependabot vulnerability alerts remain enabled. Closing upgrade proposals does not fix or dismiss their vulnerabilities. No application dependency versions are changed by this cleanup.

## Starting state and recovery

- Application baseline: `409a48b0138b313744286e39c6395e5226e66023`. The current checkout matched GitHub, but local `main` was eight commits behind at `113955d`. The worktree was clean.
- Inventoried 24 remote branches, seven local branches and 17 open Dependabot PRs. All six non-default development branches and the local-only `codex/qc-module` were already contained in `main`.
- The cleanup removes redundant development branches and closes unmerged dependency proposals after preserving their exact commits. It does not merge dependency updates or deploy production.
- A full Git bundle, branch/PR inventories, prior settings and action receipts are retained locally in `.git/branch-cleanup-backups/20260918T134833Z/`. This recovery directory is not published.
- Bundle: `all-branches.bundle`; SHA-256: `9caa752985ae8e638df10423a3c1249a9a6a16658ddab672163936e6f3879bc9`.
- Recovery was verified by cloning the bundle into an independent bare repository and running `git fsck --full --no-reflogs`. All recorded remote references were checked against the bundle.

To inspect an archived proposal, use the retained `restore-check.git` with `git --git-dir=<backup>/restore-check.git show <commit>`, or clone `all-branches.bundle` into a separately authorized recovery directory. Restore/publish branches only when explicitly requested; do not overwrite the working `main` or restore dependencies wholesale.

## Archived remote branches

| Branch | Preserved tip | Disposition |
| --- | --- | --- |
| `agent/events-detail-workspace-redesign` | `6fe1135dae03bad8a079d3ae4a7ea61609bbad2e` | All commits already included in main |
| `codex/access-management-ux` | `c226446b1619a87aefb0062e0ec263311e6c819a` | All commits already included in main |
| `codex/qc-operational-readiness` | `c083b199e6144fd0b128cc1cb62141fb73ed77c8` | All commits already included in main |
| `codex/server-security-maintenance` | `07a97553940b72175f934a2e608d8206e6d8dafb` | All commits already included in main |
| `codex/ticket-scheduled-activities` | `409a48b0138b313744286e39c6395e5226e66023` | All commits already included in main |
| `dependabot/npm_and_yarn/archiver-8.0.0` | `d4cd4e76609b924e7e8280f7a038101518edb7e8` | PR [#7](https://github.com/Avidity-Technologies-Inc/AvidityOne/pull/7) closed without merging; manual dependency review pending |
| `dependabot/npm_and_yarn/baseline-browser-mapping-2.11.22` | `c6b3c51751de550bf90102ae161fbeb8a0227b70` | PR [#19](https://github.com/Avidity-Technologies-Inc/AvidityOne/pull/19) closed without merging; manual dependency review pending |
| `dependabot/npm_and_yarn/browserslist-4.28.8` | `653c9cd8c4c9db56c66f77220aa041bba9ad1362` | PR [#18](https://github.com/Avidity-Technologies-Inc/AvidityOne/pull/18) closed without merging; manual dependency review pending |
| `dependabot/npm_and_yarn/dotenv-17.4.2` | `fb1430b2de44f7ba25b4d4685410a8617b3b3bbd` | PR [#3](https://github.com/Avidity-Technologies-Inc/AvidityOne/pull/3) closed without merging; manual dependency review pending |
| `dependabot/npm_and_yarn/fast-uri-3.1.7` | `7f371ab4d133ea1b1f68dce790dcdef053095bff` | PR [#16](https://github.com/Avidity-Technologies-Inc/AvidityOne/pull/16) closed without merging; manual dependency review pending |
| `dependabot/npm_and_yarn/multi-c5ebbb4833` | `721c87b43a1b456a8e3b2e2bacfb563e0dc30741` | PR [#22](https://github.com/Avidity-Technologies-Inc/AvidityOne/pull/22) closed without merging; manual dependency review pending |
| `dependabot/npm_and_yarn/nanoid-3.3.18` | `667ac1324f343af95f0b50458cd1e63edbd7dbba` | PR [#10](https://github.com/Avidity-Technologies-Inc/AvidityOne/pull/10) closed without merging; manual dependency review pending |
| `dependabot/npm_and_yarn/next-16.3.3` | `47cab6dc05cc298bd7ff9d512d281307beb8bac3` | PR [#21](https://github.com/Avidity-Technologies-Inc/AvidityOne/pull/21) closed without merging; manual dependency review pending |
| `dependabot/npm_and_yarn/postcss-8.5.23` | `2032680b900afcf14740e125e0a670275848656e` | PR [#11](https://github.com/Avidity-Technologies-Inc/AvidityOne/pull/11) closed without merging; manual dependency review pending |
| `dependabot/npm_and_yarn/postcss-8.5.26` | `1d4a133a43718c9515fd68a61e97d9f87218fa81` | PR [#15](https://github.com/Avidity-Technologies-Inc/AvidityOne/pull/15) closed without merging; manual dependency review pending |
| `dependabot/npm_and_yarn/prisma-7.10.0` | `0bca17f69beb470120bf1474d7934ee73f6bee2a` | PR [#13](https://github.com/Avidity-Technologies-Inc/AvidityOne/pull/13) closed without merging; manual dependency review pending |
| `dependabot/npm_and_yarn/qs-6.16.0` | `9788322aab34a4c0a40d3342c4e5036bf1865a53` | PR [#17](https://github.com/Avidity-Technologies-Inc/AvidityOne/pull/17) closed without merging; manual dependency review pending |
| `dependabot/npm_and_yarn/rxjs-7.8.2` | `7bfb0ba540f4d37ba82c823532b5c6460aeb403c` | PR [#5](https://github.com/Avidity-Technologies-Inc/AvidityOne/pull/5) closed without merging; manual dependency review pending |
| `dependabot/npm_and_yarn/sanitize-html-2.17.5` | `ae3922072aaa1f119d9565ab5affd46b0f649f01` | PR [#8](https://github.com/Avidity-Technologies-Inc/AvidityOne/pull/8) closed without merging; manual dependency review pending |
| `dependabot/npm_and_yarn/sanitize-html-2.17.7` | `4922ddb9771d5e7cd4c83a806733936659b51d05` | PR [#14](https://github.com/Avidity-Technologies-Inc/AvidityOne/pull/14) closed without merging; manual dependency review pending |
| `dependabot/npm_and_yarn/sharp-0.35.4` | `0ea934fe4bd8e6a86cd4214b357b1a564a64d58a` | PR [#20](https://github.com/Avidity-Technologies-Inc/AvidityOne/pull/20) closed without merging; manual dependency review pending |
| `dependabot/npm_and_yarn/types/node-26.4.0` | `037967c6e5b910ef33bfae16c47b4040c67ab47c` | PR [#12](https://github.com/Avidity-Technologies-Inc/AvidityOne/pull/12) closed without merging; manual dependency review pending |
| `ui-modernization` | `a1b32ffd1f5b4918b76f34f2191011e909e1d8f1` | All commits already included in main |

## Boundaries and checks

Application source, migrations, package manifests and lockfiles remain identical to the baseline. Production, credentials and repository visibility are unchanged. Validation for this administrative change consists of backup restoration, YAML parsing, exact branch/PR/settings readback, clean local state and equality with canonical `origin/main`; application builds/tests are not rerun for documentation and Git-policy changes alone.

The ticket composer attachment/scroll defect remains a separate pending implementation.
