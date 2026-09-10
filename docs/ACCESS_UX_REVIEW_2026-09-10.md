# People & Access UX review — September 10, 2026

## Status

Published to canonical `main` and `codex/access-management-ux` as `895ac09d304e2764b7917dd568b2c4f39690acf4`, based on `e6ef778`. The canonical origin was fetched and the working tree was clean and synchronized before implementation. The user authorized publication and production deployment on September 10. Production verification is recorded below.

## Behavior

- Settings uses horizontal Users, Groups, and Roles & Permissions tabs, with a contextual create action, search, counts, empty states, and explicit edit/view actions.
- All three editors use a bounded native modal dialog with a scrollable body and continuously visible actions. Labels, pending-change status, saving state, error feedback, cancel/Escape discard confirmation, and browser unload protection make the save lifecycle explicit. System group/role deletion restrictions remain enforced by the existing API and are explained in the UI.
- Permission modules are collapsible and searchable by module, action, description, or permission key. Selected-only filtering and module selection operate on visible permissions while preserving selections outside the filter. The permission catalog and all assignment IDs come from existing authenticated endpoints.
- User membership and group role editors preview the union of permissions inherited after saving. Role editors show affected groups and distinct member accounts. Group editors show membership impact and direct administrators to the existing per-user membership editor.
- Read-only administrators can inspect details without save controls. API reads and action visibility follow permission strings. Missing catalogs do not clear existing assignments. Metadata-only updates omit unchanged membership/role/permission arrays.
- Profile includes My Access, using only `/profile` and `/auth/me` to display the user's group-to-role relationships and server-calculated effective permissions. The Account role summary refreshes without replacing unsaved account, signature, or notification drafts.
- Access invalidation after successful access mutations refreshes open navigation, profiles, ticket permission controls, and QC permission controls. Other tabs receive an invalidation signal without any permission data in browser storage. Refresh also occurs on focus/visibility and every 60 seconds while visible. The server continues to enforce authorization for every protected request. Transient refresh failures preserve open work; rejected authenticated sessions still redirect to login.

## Scope and preservation

No backend authorization rules, database models, migrations, dependencies, production environment variables, or real user/group/role assignments were changed. Existing CRUD endpoints, organization scoping, audit logging, soft deletion, MFA reset, and group/role inheritance remain the authority.

The existing user list endpoint returns at most 250 users. The UI identifies this limit when reached; impact counts use group membership records, while member names are limited to the loaded user list. No new pagination API was introduced.

## Validation

- `npm run lint:web`: passed.
- `npm run build`: shared packages, API, and production Next build passed.
- `npm test`: 30 suites / 125 tests passed. Two QC database suites / 21 tests were skipped because `QC_TEST_DATABASE_URL` was not configured. No shared database was used.
- Browser regression suite: 84 passed before the final read-only inspection scenario was added; final targeted access suite: 30 passed across Chromium, Firefox, and WebKit. Together these cover 30 new access scenarios and 57 existing editor, conversation, meetings, and QC scenarios.
- Browser tests mount real React components with isolated synthetic API fixtures. They verify permission-ID payloads and readback, failed-save retention, discard behavior, role/group creation and deletion, assignment inheritance, metadata-only preservation, unavailable catalogs, read-only controls, live permission revocation, profile refresh, navigation refresh, and responsive containment.
- Screenshots reviewed at desktop and mobile sizes, including dark mode. These are synthetic component previews, not production acceptance or evidence of changes to actual account grants.
- `git diff --check`: passed.

## Production deployment

- Deployment completed on `avidityhelpdesk` at `2026-09-10T17:41:16Z`, under `/opt/avidity/app`. The clean checkout fast-forwarded from `e6ef7789a9c37e2f61347de6b64a88f53c18c049` to the published application commit `895ac09d304e2764b7917dd568b2c4f39690acf4`.
- Persistent server Git credentials remain pending. Tactical RMM transferred the incremental Git bundle; SHA-256 `9c195b00047e1e0bfc47e08e51ca4cb6010073c8552b05dc54a4b587dd45bf4f` and Git prerequisites were verified before the fast-forward. No credentials were copied or changed.
- Recovery files are retained at `/opt/avidity/access-backup-895ac09.gBqxQi`, including the previous source archive, previous commit, web build and environment checksum. Deployment log: `/tmp/deploy-access-895ac09.log`.
- Only the web application was rebuilt and `avidity-web` restarted. `avidity-api` remained running. Both services are active. No migrations, dependency installation, environment edits, infrastructure changes or real access assignments were performed.
- The production web build passed compilation and TypeScript checks. The built API rewrite points to `http://localhost:4000/api/:path*`; the production environment checksum remained unchanged.
- Main login, public API health, Event Portal and Support Portal returned HTTP 200. No error-priority API/web journal entries were observed after the deployment completion timestamp.
- Authenticated production smoke checks verified Settings Users, Groups and Roles, role search and the bounded editor with visible Save/Cancel, and Profile > My Access. The existing session showed 10 users, 4 groups, 9 roles, and its existing 97 effective permissions. No save or account-grant mutation was used for acceptance testing; write behavior was validated by the local browser scenarios above.
- No GitHub Actions run was listed for the application commit; local validation and the observed production build are the release evidence. A follow-up records this deployment and removes a trailing blank line only; it does not change application behavior.
