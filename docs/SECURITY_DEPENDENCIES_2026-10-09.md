# Security dependency update — October 9, 2026

## Scope and compatibility

This update starts from canonical `main` at `489792fff703ed916dc90c27b1542a01955c9857`. It addresses the previously reviewed GitHub dependency alerts and additional patched advisories returned by the current npm audit. It changes dependencies, focused compatibility tests and deployment safeguards; application workflows, permissions, database schema, saved settings and external integrations remain unchanged.

| Dependency | Selected version |
| --- | --- |
| Next.js | 16.3.8 |
| Sharp | 0.35.5 |
| sanitize-html | 2.17.7 |
| Multer, scoped to Nest's Express adapter | 2.4.0 |
| PostCSS | 8.5.23 |
| qs | 6.16.0 |
| js-yaml | 3.15.2 / 4.3.2, preserving the consumer's major version |
| fast-uri | 3.1.8 |
| browserslist / baseline-browser-mapping | 4.28.7 / 2.11.0 |
| brace-expansion | 1.1.21 / 2.1.7 / 5.0.12 |
| nanoid / shell-quote | 3.3.18 / 1.11.0 |
| uuid, scoped to ExcelJS | 11.1.1 |
| proxy-addr / source-map-js / handlebars | 2.0.8 / 1.2.2 / 4.7.10 |

Native Sharp and Next binaries and required parser/browser data dependencies follow those versions in the lockfile. The Nest CLI override retains the already installed Webpack 5.107.2 and resolves its declared-version mismatch. Nest, React and Prisma are not upgraded. ExcelJS still uses the compatible CommonJS `v4()` API; extended conditional formatting is exercised explicitly.

**Node >=22.12 is required by the patched HTML parser.** The deployment helper checks this before stopping services. Jest 29 receives a narrow ESM transformation for the parser dependency chain; application runtime imports and sanitization policy are not replaced or mocked. Existing safe signature tables, CID images and formatting remain allowed.

`scripts/check-security-dependencies.cjs` validates the lockfile floors, the installed package versions, and the native libraries actually loaded by Sharp: libheif >=1.23.2 and librsvg >=2.63.2. The latter also covers [Sharp's librsvg advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w), including a globally supplied library rather than assuming that the package version alone is sufficient.

## Validation and limits

Validation ran in a disposable local copy with a fresh `npm ci --include=dev`, Node 24.18.0 and dedicated synthetic PostgreSQL/Redis services. Production data, mail delivery and provider actions were not used.

- `npm ls --all`: passed; no invalid dependency tree.
- `npm audit --omit=dev`: **zero reported vulnerabilities** at verification time.
- Full `npm audit`: still reports 34 affected development-package entries derived from two underlying advisories: [braces 3.0.3](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and [sprintf-js 1.1.3](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). Neither has a patched npm release at verification time. They are development-only dependencies of build/test tooling; they are not in the audited production dependency graph. No alert was dismissed and no unreviewed major tooling upgrade or forced audit fix was applied. This is not a claim that the entire development tree is vulnerability-free.
- API and web type checks: passed.
- Complete shared/API/web production build: passed.
- Full API suite: **366 passed, 53 suites, no skipped tests**, with all three database-gated environments available. A subsequently added safe SVG regression also passed in the final 10-case focused dependency suite.
- Browser suite: **270 passed** across Chromium, Firefox and WebKit. These exercise application components with synthetic API fixtures.
- Separate real Next production-server and Nest checks: API rewrites, protected-route redirect, both public host rewrites, login and portal hydration, legitimate PNG optimization and rejection of an unapproved remote optimizer URL all passed.
- Focused dependency coverage: real Nest buffered multipart uploads and limits; safe HTML signatures and rejection of active markup; PNG/JPEG/AVIF/SVG decoding; Excel conditional formatting; existing report PDF/Excel/CSV rendering tests.
- Deployment simulations: success; preflight rejection for old Node, schema changes and pending migrations; recovery after install, dependency gate, build and health failures. Restored root/workspace dependencies, Prisma client and API/web builds were checked. Shell syntax and final diff checks passed.
- Independent read-only candidate review found no concrete surviving bypass or regression.

Security evidence combines the patched advisory ranges, actual installed/native versions and focused boundary/compatibility tests. It does not claim an exploit reproduction for every advisory. Local native execution was on macOS; Ubuntu services, native Linux binaries and live integration acceptance are checked during deployment and the later authorized server review.

## Deployment and recovery

Use `scripts/deploy-security-dependencies.sh <full-published-sha>` from the fetched release, without pulling the server checkout first. The helper requires:

- Host `avidityhelpdesk`, root execution and clean canonical `main`.
- Existing checkout `489792fff703ed916dc90c27b1542a01955c9857`, reviewed recovered checkout `14ade61657bd5f0f7a5057c48efa47e139fcaad1`, or the requested release for a retry. If the previous Devices release has not been deployed, stop and complete that deployment first; this helper does not apply its migration.
- Node >=22.12, both services active, existing build/dependency artifacts, no pending migrations, and enough disk space for recovery.

The helper backs up tracked source, API/web/shared builds, root `node_modules`, and existing nested workspace dependencies. It stops both dependent services, fast-forwards to the exact release, runs a clean install including build tools, checks patched versions/native libraries, regenerates Prisma, builds, performs the existing read-only device schema check, then starts and checks `avidity-api` and `avidity-web` plus local/public endpoints. Expect a maintenance interruption during installation and build.

Failure after services stop restores the previous complete runtime and dependencies and restarts both services. Newly introduced nested dependency directories are moved aside as well. The reported recovery directory retains failed artifacts; Git remains at the attempted revision, so inspect health and the failure before retrying. No migration or database rollback is performed. `.env.production` is checksummed and is not changed; no operating-system package, systemd, Nginx or credential update is included.

After deployment, confirm login, a ticket's messages/signature, a small attachment upload, a PDF/Excel export, Devices and both public portals. OS/runtime/package inventory and any further server security updates belong to the separate server review requested by the owner.

## Recovered deployment follow-up

Production inspection found that the original deployment passed the endpoint checks but then restored the old runtime because Next 16.3.8 added `root-params.d.ts` to `next-env.d.ts`. Git revision alone therefore did not establish the running dependency versions. The expected generated import is now tracked. Only the byte-identical generated change on the reviewed recovered revision is eligible for backup and normalization; unrelated changes still block deployment. Failures report their script line and unexpected source changes explicitly.

Regression simulations cover the generated file, preservation of its recovery copy, rejection of unrelated/unreviewed changes, and rollback after an unexpected post-build edit. A real complete build and both type checks passed; no additional declaration change was produced. The complete backend run passed 296 cases with 79 database-gated cases skipped in this follow-up, while the earlier full dependency validation above used all isolated databases. All 28 focused System Health cases passed. These tests do not substitute for the separately recorded live acceptance.
