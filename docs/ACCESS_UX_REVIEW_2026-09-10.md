# People & Access UX review — September 10, 2026

## Status

Implemented locally on `codex/access-management-ux`, based on `e6ef778`. The canonical origin was fetched and the working tree was clean and synchronized before implementation. The user authorized publication to the canonical repository and a production update on September 10. Production verification is recorded in the deployment follow-up once completed.

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

## Release follow-up

Publish the validated branch, then deploy through the established native systemd release procedure under the user's authorization. No additional migration or environment change is required by this UX patch. Verify the real Settings and Profile flows with an authorized test account after deployment; do not alter a live administrator's grants merely to test the UI.
