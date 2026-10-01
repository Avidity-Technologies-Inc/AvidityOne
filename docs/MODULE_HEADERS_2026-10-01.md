# Shared module headers and compact Dashboard

## Scope

Approved from clean, synchronized `main` at `9396908`. Module identity replaces company/contact text in the authenticated topbar. Sidebar branding and all public branding settings remain unchanged.

- Titles reuse the navigation catalog. Settings publishes its current section label; QC publishes its active view. Projects and Event Calendar retain module/subsection context.
- Repeated static page headers are removed from Dashboard, Operations, Projects, Knowledge Base, Tickets, Devices, Clients, Reports, Profile, Settings and Event Services. Record headings (ticket number, device name and event reference), actions, filters, permissions and live data remain in their workspaces.
- Dashboard removes the introductory block, reduces section/chart heading spacing and retains calendar timezone, chart scope and saved widget customization.
- Responsive titles preserve mobile navigation and global actions. Dropdown and Settings navigation offsets follow measured topbar height.
- No API, schema, dependencies, environment or public portal presentation changes.

## Validation

- `npm run lint:web` and `npm run build:web` passed.
- Browser coverage: 120 distinct cases passed across Chromium, Firefox and WebKit, including shared header routing/section changes, Dashboard layout saving and filter links, responsive overflow, mobile navigation/notification menus, Devices, QC, Reports, access permissions, Operations/Clients and the ticket composer layout. Isolated fixtures use synthetic API responses; this is not a production acceptance run.
- Browser fixtures that previously mounted standalone workspaces now also mount the real shared module heading where necessary; existing heading assertions remain in place.
- Deployment tests cover success, retry and build/health failure recovery. The API must remain running and its artifacts unchanged.

## Deployment

Run `scripts/deploy-module-headers.sh <full-published-commit>` as root after fetching canonical origin. Obtain the script from the target commit before running it; do not pull first. The helper accepts the reviewed baseline `939690897a5c6294bd19edcc6b7732c03d2b001f` or a retry of the same release.

The helper checks the native host, clean main checkout, ancestry, unchanged dependencies/schema/backend, active services and installed migrations. It backs up the source and web build, stops only `avidity-web`, fast-forwards to the pinned release, builds the web workspace with the existing production configuration and verifies local/public endpoints. The web UI is briefly unavailable during the build; API and background processing remain running.

On failure it restores the previous web build and restarts the web service. Git stays at the attempted release and the recovery directory is printed. Do not manually reset the server or remove recovery files while investigating.

After deployment, check Dashboard widget placement/customization, module titles and Settings/QC section labels, detail record headings/actions and mobile menu access. Production execution is left to the user.
