import path from "node:path";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { expect, test, Page } from "@playwright/test";

const root = path.resolve(".");
const organizer = { id: "11111111-1111-4111-8111-111111111111", firstName: "Test", lastName: "Organizer", email: "organizer@example.invalid" };
const participant = { email: "customer@example.invalid", displayName: "Customer", type: "REQUIRED", source: "REQUESTER" };
const defaults = { organizer, title: "[ACT-1] Planned support", startAt: "2030-09-20T15:00:00.000Z", endAt: "2030-09-20T16:00:00.000Z", timeZone: "America/Chicago", attendees: [participant] };
const grants = ["ticket_meetings.view", "ticket_meetings.create", "ticket_meetings.update", "ticket_meetings.cancel"];
const existing = { id: "activity-1", organizerUserId: organizer.id, title: "Existing meeting", agenda: "Original agenda", startAt: defaults.startAt, endAt: defaults.endAt, timeZone: defaults.timeZone, location: "", isOnlineMeeting: true, status: "SCHEDULED", syncStatus: "SYNCED", providerEventId: "calendar-1", providerWebLink: "https://outlook.example/event", onlineMeetingJoinUrl: "https://teams.example/join", attendees: [participant] };

async function mount(page: Page, options: { meetings?: object[]; permissions?: string[]; closeout?: boolean; failedSave?: boolean } = {}) {
  const requests: { method: string; path: string; body: any }[] = [];
  const data = { meetings: options.meetings ?? [], activity: [], defaults };
  const bundled = buildSync({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {TicketMeetingDrawer} from './apps/web/src/components/tickets/TicketMeetingDrawer'; import {TicketActivityCloseout} from './apps/web/src/components/tickets/TicketActivityCloseout'; function Fixture(){const [data,setData]=React.useState(${JSON.stringify(data)});const [open,setOpen]=React.useState(${!options.closeout});const [id,setId]=React.useState(data.meetings[0]?.id);const permissions=new Set(${JSON.stringify(options.permissions ?? grants)});const reload=async()=>setData(await (await fetch('/api/tickets/ACT-1/meetings')).json());return <><button onClick={()=>setOpen(true)}>Open activities</button>${options.closeout ? '<TicketActivityCloseout ticketId="ACT-1" meetings={data.meetings} permissions={permissions} onChanged={reload} onOpen={id=>{setId(id);setOpen(true)}}/>' : ''}<TicketMeetingDrawer open={open} ticketId="ACT-1" data={data} initialMeetingId={id} users={[${JSON.stringify(organizer)}]} permissions={permissions} onChanged={reload} onClose={()=>setOpen(false)}/></>};createRoot(document.getElementById('root')).render(<Fixture/>);`, resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.join(root, "apps/web/src") }, define: { "process.env.NODE_ENV": '"test"', "process.env.NEXT_PUBLIC_API_URL": '"/api"' } });
  await page.route("https://activities.test/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "application/javascript", body: bundled.outputFiles[0].text });
    if (url.pathname.startsWith("/api/")) {
      const method = route.request().method();
      if (method === "GET") return route.fulfill({ json: data });
      const body = route.request().postData() ? route.request().postDataJSON() : null;
      requests.push({ method, path: url.pathname, body });
      if (options.failedSave) return route.fulfill({ status: 400, json: { message: "Synthetic save rejected" } });
      const previous: any = data.meetings[0] ?? {};
      const saved = { ...previous, ...body, id: previous.id ?? "new-activity", status: url.pathname.endsWith("/cancel") ? "CANCELLED" : /\/complete/.test(url.pathname) ? "COMPLETED" : url.pathname.endsWith("/schedule") ? "SCHEDULED" : previous.status ?? "DRAFT", attendees: body?.attendees ?? previous.attendees ?? [], syncStatus: "SYNCED" };
      data.meetings = [saved]; return route.fulfill({ json: saved });
    }
    return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>' });
  });
  await page.goto("https://activities.test");
  await page.addStyleTag({ content: readFileSync(path.join(root, "apps/web/src/app/globals.css"), "utf8") });
  await expect(page.getByRole(options.closeout ? "heading" : "dialog", { name: options.closeout ? "Ticket closed — review scheduled activities" : "Scheduled Activities" })).toBeVisible();
  return requests;
}

test("work defaults reserve actual schedule without sending customer invitations", async ({ page }) => {
  const requests = await mount(page);
  await expect(page.getByRole("combobox", { name: "Activity type", exact: true })).toHaveValue("WORK_SESSION");
  await expect(page.getByText(/Organizer only: reserves time/)).toBeVisible();
  await page.getByRole("button", { name: "Reserve in calendar", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[0].body).toMatchObject({ activityType: "WORK_SESSION", modality: "REMOTE", isOnlineMeeting: false, attendees: [], startAt: defaults.startAt, endAt: defaults.endAt, organizerUserId: organizer.id });
  expect(requests[1].path).toBe("/api/tickets/ACT-1/meetings/new-activity/schedule");
});

test("on-site drafts allow a missing location but calendar scheduling requires it", async ({ page }) => {
  const requests = await mount(page);
  await page.getByRole("combobox", { name: "Activity type", exact: true }).selectOption("SERVICE_VISIT");
  await expect(page.getByRole("combobox", { name: "Modality", exact: true })).toHaveValue("ON_SITE");
  await expect(page.getByLabel("Create a Microsoft Teams meeting")).not.toBeChecked();
  await page.getByRole("button", { name: "Reserve in calendar", exact: true }).click();
  await expect(page.getByText("Enter the location before scheduling this activity.")).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "Save Draft", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  await page.getByLabel("Location", { exact: true }).fill("Client campus, room 101");
  await page.getByRole("button", { name: "Reserve in calendar", exact: true }).click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[1].body.location).toBe("Client campus, room 101");
});

test("hybrid meeting invites only explicitly added participants", async ({ page }) => {
  const requests = await mount(page);
  await page.getByRole("combobox", { name: "Activity type", exact: true }).selectOption("MEETING");
  await page.getByRole("combobox", { name: "Modality", exact: true }).selectOption("HYBRID");
  await page.getByLabel("Location", { exact: true }).fill("Conference room");
  await expect(page.getByLabel("Create a Microsoft Teams meeting")).toBeChecked();
  await page.getByRole("button", { name: "Add suggested ticket participants" }).click();
  await page.getByRole("button", { name: "Schedule & send invitations" }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[0].body).toMatchObject({ modality: "HYBRID", isOnlineMeeting: true, attendees: [participant] });
});

test("legacy Teams is preserved and failed changes remain editable", async ({ page }) => {
  const requests = await mount(page, { meetings: [existing], failedSave: true });
  await expect(page.getByRole("combobox", { name: "Modality", exact: true })).toHaveValue("");
  await expect(page.getByLabel("Create a Microsoft Teams meeting")).toBeDisabled();
  await page.getByRole("textbox", { name: "Agenda", exact: true }).fill("Updated agenda");
  await page.getByRole("button", { name: "Save & send update" }).click();
  await expect(page.getByText("Synthetic save rejected")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Agenda", exact: true })).toHaveValue("Updated agenda");
  expect(requests[0].body.isOnlineMeeting).toBe(true);
  expect(requests[0].body.modality).toBeUndefined();
});

test("dirty close is explicit and focus stays inside the activity dialog", async ({ page }) => {
  await mount(page);
  await page.getByLabel("Title", { exact: true }).fill("Unsaved title");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Close scheduled activities" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Reserve in calendar" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Schedule activity", exact: true })).toBeFocused();
  page.once("dialog", dialog => dialog.accept());
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("closed ticket requires explicit early completion and calendar release", async ({ page }) => {
  const requests = await mount(page, { closeout: true, meetings: [{ ...existing, activityType: "WORK_SESSION", modality: "REMOTE", isOnlineMeeting: false, attendees: [] }] });
  expect(requests).toHaveLength(0);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Work done early · free calendar" }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].path).toContain("/complete-and-release");
  await expect(page.getByRole("heading", { name: "Ticket closed — review scheduled activities" })).toHaveCount(0);
});

test("future visits are not auto-completed and release actions respect permissions", async ({ page }) => {
  const requests = await mount(page, { closeout: true, permissions: ["ticket_meetings.view"], meetings: [{ ...existing, activityType: "SERVICE_VISIT", modality: "ON_SITE" }] });
  await expect(page.getByRole("button", { name: "Review / keep scheduled" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark performed" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /free calendar|Cancel & notify/ })).toHaveCount(0);
  expect(requests).toHaveLength(0);
});

test("activity editor fits desktop and mobile in light and dark themes", async ({ page }, testInfo) => {
  await mount(page); await page.getByRole("combobox", { name: "Activity type", exact: true }).selectOption("SERVICE_VISIT");
  await page.getByLabel("Location", { exact: true }).fill("Client site · Building A");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const box = await page.getByRole("dialog").boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: testInfo.outputPath(`activities-${width}.png`) });
  }
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.screenshot({ path: testInfo.outputPath("activities-dark.png") });
});
