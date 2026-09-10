import path from "node:path";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { test, expect, Page } from "@playwright/test";

const root = path.resolve(".");
const bundled = buildSync({ absWorkingDir: root, stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {UsersWorkspace} from './apps/web/src/components/users/UsersWorkspace'; import {ProfileAccess} from './apps/web/src/components/profile/ProfileAccess'; import {AppShell} from './apps/web/src/components/layout/AppShell'; createRoot(document.getElementById('root')).render(location.pathname === '/shell' ? <AppShell><p>Access test</p></AppShell> : location.pathname === '/profile' ? <ProfileAccess /> : <UsersWorkspace />);`, resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "iife", jsx: "automatic", loader: { ".css": "empty" }, alias: { "next/link": "./tests/browser/fixtures/qc-link.tsx", "next/navigation": "./tests/browser/fixtures/access-navigation.ts" }, define: { "process.env.NODE_ENV": '"test"', "process.env.NEXT_PUBLIC_API_URL": '"/api"' } });
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const catalog = ["users", "groups", "roles"].flatMap(scope => ["view", "create", "update", "delete"].map(action => `${scope}.${action}`)).concat(["permissions.view", "qc.view", "qc.reviews_perform", "tickets.view"], Array.from({ length: 25 }, (_, i) => `module_${i}.view`)).map((name, index) => ({ id: id(index + 100), name, description: `Allows ${name.replace(/[._]/g, " ")}` }));
const qc = catalog.find(permission => permission.name === "qc.view")!;
const tickets = catalog.find(permission => permission.name === "tickets.view")!;
async function mount(page: Page, options: { shell?: boolean; profile?: boolean; grants?: string[]; failResource?: string } = {}) {
  const state = {
    grants: options.grants ?? catalog.map(permission => permission.name),
    permissions: catalog,
    roles: [{ id: id(1), name: "Service Reviewer", description: "Review service quality", isSystem: false, permissions: [{ permission: tickets }], groups: [{ groupId: id(2) }] }, { id: id(4), name: "Protected Role", description: "System role", isSystem: true, permissions: [], groups: [] }],
    groups: [{ id: id(2), name: "Service Team", description: "Support access", isSystem: false, roleIds: [id(1)] }],
    users: [{ id: id(3), firstName: "Synthetic", lastName: "Operator", email: "operator@example.test", isActive: true, mfaEnabled: true, forcePasswordChange: false, groupIds: [id(2)] }],
    failSave: false
  };
  const reads: string[] = [];
  const writes: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
  const groupData = () => state.groups.map(group => ({ ...group, users: state.users.filter(user => user.groupIds.includes(group.id)).map(user => ({ userId: user.id })), roles: group.roleIds.map(roleId => ({ role: state.roles.find(role => role.id === roleId)! })) }));
  const userData = () => state.users.map(user => ({ ...user, groups: groupData().filter(group => user.groupIds.includes(group.id)).map(group => ({ group })) }));
  await page.route("https://access.test/**", async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/fixture.js") return route.fulfill({ contentType: "application/javascript", body: bundled.outputFiles[0].text });
    if (!pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><main id="root" class="settings-page" style="padding:20px;max-width:1100px;margin:auto"></main><script src="/fixture.js"></script></body></html>' });
    const key = pathname.slice(4);
    if (request.method() === "GET") {
      reads.push(key);
      if (key === options.failResource) return route.fulfill({ status: 500, json: { message: "Synthetic load failure" } });
      const data: Record<string, unknown> = { "/auth/me": { user: { ...state.users[0], permissions: state.grants } }, "/users": userData(), "/groups": groupData(), "/roles": state.roles, "/permissions": state.permissions, "/profile": { user: userData()[0] } };
      if (!(key in data)) return route.fulfill({ status: 503, json: { message: "Isolated unrelated service" } });
      return route.fulfill({ json: data[key] });
    }
    const body = request.postData() ? request.postDataJSON() : {};
    writes.push({ path: key, method: request.method(), body });
    if (state.failSave) return route.fulfill({ status: 500, json: { message: "Synthetic save failure" } });
    const [resource, recordId] = key.split("/").filter(Boolean);
    if (resource === "roles") {
      if (request.method() === "DELETE") state.roles = state.roles.filter(role => role.id !== recordId);
      else {
        const role = state.roles.find(role => role.id === recordId);
        const permissions = body.permissionIds?.map((permissionId: string) => ({ permission: catalog.find(permission => permission.id === permissionId)! }));
        if (role) Object.assign(role, body, permissions ? { permissions } : {});
        else state.roles.push({ ...body, id: id(8), isSystem: false, groups: [], permissions: permissions ?? [] });
      }
    }
    if (resource === "groups") {
      if (request.method() === "DELETE") state.groups = state.groups.filter(group => group.id !== recordId);
      else { const group = state.groups.find(group => group.id === recordId); if (group) Object.assign(group, body); else state.groups.push({ ...body, id: id(9), isSystem: false }); }
    }
    if (resource === "users") { const user = state.users.find(user => user.id === recordId); if (user) Object.assign(user, body); }
    return route.fulfill({ json: { saved: true } });
  });
  await page.goto(`https://access.test/${options.shell ? "shell" : options.profile ? "profile" : "settings"}`);
  for (const file of ["apps/web/src/app/globals.css", "apps/web/src/components/users/access.css"]) await page.addStyleTag({ content: readFileSync(path.join(root, file), "utf8") });
  if (!options.shell) await expect(page.getByRole("heading", { name: options.profile ? "My Access" : "People & Access", exact: true })).toBeVisible();
  if (!options.profile && !options.shell) await expect(page.getByRole("button", { name: /Roles & Permissions/ })).toBeVisible();
  return { state, writes, reads };
}
async function editRole(page: Page) {
  await page.getByRole("button", { name: /Roles & Permissions/ }).click();
  await page.getByRole("row").filter({ hasText: "Service Reviewer" }).getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test("role edits keep save visible, retain failed drafts and persist real permission IDs", async ({ page }, info) => {
  const { state, writes } = await mount(page);
  await editRole(page);
  const save = page.getByRole("button", { name: "Save Role", exact: true });
  await expect(save).toBeDisabled();
  await expect(page.getByText("Impact: 1 assigned groups · 1 member accounts")).toBeVisible();
  await page.getByLabel("Search permissions").fill("qc.view");
  await page.getByRole("checkbox", { name: "View Allows qc view qc.view", exact: true }).check();
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    await expect(save).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    const dialog = page.getByRole("dialog");
    expect(await dialog.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
  }
  await page.screenshot({ path: info.outputPath("access-role-desktop.png"), fullPage: true, animations: "disabled" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.setViewportSize({ width: 390, height: 850 });
  await expect(page.getByLabel("Role name", { exact: true })).toHaveCSS("background-color", "rgb(16, 24, 39)");
  await page.screenshot({ path: info.outputPath("access-role-mobile-dark.png"), fullPage: true, animations: "disabled" });
  state.failSave = true;
  await save.click();
  await expect(page.getByRole("alert")).toContainText("Synthetic save failure");
  await expect(page.getByRole("checkbox", { name: "View Allows qc view qc.view", exact: true })).toBeChecked();
  state.failSave = false;
  await save.click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".success-banner[role=status]")).toHaveText("Role updated.");
  expect(writes[1].body.permissionIds).toEqual(expect.arrayContaining([tickets.id, qc.id]));
  expect(writes[1].body.permissionIds).toHaveLength(2);
  await editRole(page);
  await page.getByLabel("Search permissions").fill("qc.view");
  await expect(page.getByRole("checkbox", { name: "View Allows qc view qc.view", exact: true })).toBeChecked();
});

test("dirty cancellation requires explicit discard and does not save", async ({ page }) => {
  const { writes } = await mount(page);
  await editRole(page);
  await page.getByLabel("Role name", { exact: true }).fill("Unsaved name");
  page.once("dialog", dialog => dialog.dismiss());
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Role name", { exact: true })).toHaveValue("Unsaved name");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(writes).toEqual([]);
});

test("group and user assignments show inherited access and persist selected record IDs", async ({ page }, info) => {
  const { writes } = await mount(page);
  await page.getByRole("button", { name: /^Groups/ }).click();
  await page.getByRole("row").filter({ hasText: "Service Team" }).getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByText("Members affected by role changes: 1")).toBeVisible();
  await page.getByRole("checkbox", { name: /Service Reviewer/ }).uncheck();
  await expect(page.getByText("0 permissions across 0 modules")).toBeVisible();
  await page.getByRole("button", { name: "Save Group" }).click();
  await expect(page.locator(".success-banner[role=status]")).toHaveText("Group updated.");
  expect(writes[0]).toMatchObject({ path: `/groups/${id(2)}`, body: { roleIds: [] } });
  await page.getByRole("button", { name: /^Users/ }).click();
  await page.getByRole("row").filter({ hasText: "operator@example.test" }).getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByText("0 permissions across 0 modules")).toBeVisible();
  await page.getByRole("checkbox", { name: /Service Team/ }).uncheck();
  await page.screenshot({ path: info.outputPath("access-user.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Save User" }).click();
  await expect(page.locator(".success-banner[role=status]")).toHaveText("User updated.");
  expect(writes[1]).toMatchObject({ path: `/users/${id(3)}`, body: { groupIds: [] } });
  expect(writes[1].body).not.toHaveProperty("password");
  await expect(page.getByRole("row").filter({ hasText: "operator@example.test" })).toContainText("No groups");
});

test("role and group creation, deletion and protected system roles are clear", async ({ page }, info) => {
  const { writes } = await mount(page);
  await page.getByRole("button", { name: /Roles & Permissions/ }).click();
  await expect(page.getByRole("button", { name: "Delete Protected Role" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add User" })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("access-roles-list.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Add Role" }).click();
  await page.getByLabel("Role name", { exact: true }).fill("New reviewer");
  await page.getByLabel("Search permissions").fill("qc.view");
  await page.getByRole("checkbox", { name: /Select all shown/ }).check();
  await page.getByRole("button", { name: "Create Role" }).click();
  await expect(page.locator(".success-banner[role=status]")).toHaveText("Role created.");
  await page.getByRole("button", { name: /^Groups/ }).click();
  await page.getByRole("button", { name: "Add Group" }).click();
  await page.getByLabel("Group name", { exact: true }).fill("Review group");
  await page.getByRole("checkbox", { name: /New reviewer/ }).check();
  await page.getByRole("button", { name: "Create Group" }).click();
  await expect(page.locator(".success-banner[role=status]")).toHaveText("Group created.");
  expect(writes[1].body.roleIds).toEqual([id(8)]);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete Review group" }).click();
  await expect(page.locator(".success-banner[role=status]")).toHaveText("Group deleted.");
  await page.getByRole("button", { name: /Roles & Permissions/ }).click();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Delete New reviewer" }).click();
  await expect(page.locator(".success-banner[role=status]")).toHaveText("Role deleted.");
});

test("missing catalogs preserve assignments and partial failures do not hide other sections", async ({ page }) => {
  const { writes } = await mount(page, { failResource: "/permissions" });
  await expect(page.getByRole("alert")).toContainText("Unable to load permissions");
  await expect(page.getByText("operator@example.test", { exact: true })).toBeVisible();
  await editRole(page);
  await expect(page.getByText("Permission editing is unavailable.", { exact: false })).toBeVisible();
  await page.getByLabel("Description", { exact: true }).fill("Updated description");
  await page.getByRole("button", { name: "Save Role" }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body).not.toHaveProperty("permissionIds");
});

test("read-only access hides mutations and revocation disables an open editor", async ({ page }) => {
  const { state } = await mount(page, { grants: ["users.view", "groups.view", "roles.view", "roles.update", "permissions.view"] });
  await expect(page.getByRole("button", { name: "Add User" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  await editRole(page);
  await page.getByLabel("Description", { exact: true }).fill("Unsaved description");
  state.grants = ["users.view", "groups.view", "roles.view", "permissions.view"];
  await page.evaluate(() => window.dispatchEvent(new Event("avidity:access-changed")));
  await expect(page.getByRole("button", { name: "Save Role" })).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("no longer have permission");
});

test("own profile shows server-effective access and refreshes on cross-tab invalidation", async ({ page }, info) => {
  const { state, reads } = await mount(page, { profile: true, grants: ["tickets.view"] });
  await expect(page.getByText("1 permissions across 1 modules")).toBeVisible();
  await expect(page.getByText("Service Team", { exact: true })).toBeVisible();
  state.grants = ["qc.view", "tickets.view"];
  state.roles[0].name = "Updated Reviewer";
  await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "avidity:access-changed", newValue: "updated" })));
  await expect(page.getByText("2 permissions across 2 modules")).toBeVisible();
  await expect(page.getByText("Updated Reviewer", { exact: true })).toBeVisible();
  expect(reads.every(key => ["/auth/me", "/profile"].includes(key))).toBe(true);
  await page.screenshot({ path: info.outputPath("profile-access.png"), fullPage: true, animations: "disabled" });
});


test("navigation reflects changed permissions without reloading the open page", async ({ page }) => {
  const { state } = await mount(page, { shell: true, grants: ["tickets.view"] });
  const navigation = page.getByRole("navigation", { name: "Main navigation", exact: true });
  await expect(navigation.getByRole("link", { name: "Tickets", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Quality Control", exact: true })).toHaveCount(0);
  state.grants = ["qc.view"];
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(navigation.getByRole("link", { name: "Quality Control", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Tickets", exact: true })).toHaveCount(0);
  await expect(page.getByText("Access test", { exact: true })).toBeVisible();
});

test("metadata-only edits preserve unchanged group and role assignments", async ({ page }) => {
  const { writes } = await mount(page);
  await page.getByRole("row").filter({ hasText: "operator@example.test" }).getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("First name", { exact: true }).fill("Renamed");
  await page.getByRole("button", { name: "Save User" }).click();
  await expect(page.locator(".success-banner")).toHaveText("User updated.");
  expect(writes[0].body).not.toHaveProperty("groupIds");
  await editRole(page);
  await page.getByLabel("Description", { exact: true }).fill("New description");
  await page.getByRole("button", { name: "Save Role" }).click();
  await expect(page.locator(".success-banner")).toHaveText("Role updated.");
  expect(writes[1].body).not.toHaveProperty("permissionIds");
});


test("view-only administrators can inspect details without save controls", async ({ page }) => {
  const { writes } = await mount(page, { grants: ["users.view", "groups.view", "roles.view", "permissions.view"] });
  await page.getByRole("button", { name: /Roles & Permissions/ }).click();
  await page.getByRole("row").filter({ hasText: "Service Reviewer" }).getByRole("button", { name: "View", exact: true }).click();
  await expect(page.getByRole("heading", { name: "View Role", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save Role" })).toHaveCount(0);
  await expect(page.getByLabel("Role name", { exact: true })).toBeDisabled();
  await page.getByRole("dialog").locator("summary").filter({ hasText: "Tickets" }).click();
  await expect(page.getByRole("checkbox", { name: /View Allows tickets view/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /View Allows tickets view/ })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(writes).toEqual([]);
});
