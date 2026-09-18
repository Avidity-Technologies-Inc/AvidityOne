import path from "node:path";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { expect, test, Page, Locator } from "@playwright/test";

const root = path.resolve(".");
const bundled = buildSync({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {TicketDetailWorkspace} from './apps/web/src/components/tickets/TicketDetailWorkspace'; createRoot(document.getElementById('root')).render(<TicketDetailWorkspace ticketId="LAYOUT-1"/>);`, resolveDir: root, loader: "tsx" },
  bundle: true, write: false, format: "iife", jsx: "automatic",
  alias: { "@": path.join(root, "apps/web/src"), "next/link": "./tests/browser/fixtures/qc-link.tsx", "next/navigation": "./tests/browser/fixtures/ticket-navigation.ts" },
  define: { "process.env.NODE_ENV": '"test"', "process.env.NEXT_PUBLIC_API_URL": '"/api"' }
});

async function mount(page: Page, fileCount = 24) {
  const messages: Record<string, unknown>[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const state = { failSend: false, uploaded: 0, messages, errors };
  const ticket = {
    id: "synthetic-ticket", ticketNumber: "LAYOUT-1", subject: "Attachment layout regression", description: null,
    status: "OPEN", priority: "NORMAL", source: "EMAIL", senderEmail: "customer@example.invalid", createdAt: "2026-09-18T12:00:00Z",
    assignees: [], watchers: [], externalSpecialists: [], mergedTickets: [], attachments: [],
    conversationParticipants: Array.from({ length: 12 }, (_, i) => ({ id: `cc-${i}`, email: `participant-${i}@example.invalid`, userId: null, user: null })),
    messages: Array.from({ length: 8 }, (_, i) => ({ id: `message-${i}`, direction: "INBOUND", visibility: "PUBLIC", bodyText: "Synthetic conversation history. ".repeat(100), sanitizedBodyHtml: null, attachments: [], attachmentImportFailures: [], ccEmails: [], senderEmail: "customer@example.invalid", createdAt: "2026-09-18T12:00:00Z" }))
  };
  await page.route("https://composer.test/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "application/javascript", body: bundled.outputFiles[0].text });
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div style="height:64px">Synthetic app header</div><main id="root" style="padding:12px"></main><script src="/fixture.js"></script></body></html>' });
    if (url.pathname.endsWith("/attachments") && request.method() === "POST") {
      const id = ++state.uploaded;
      return route.fulfill({ json: { id: `file-${id}`, originalFilename: `attachment-${id}-${"long-name-".repeat(8)}.txt`, mimeType: "text/plain", fileSize: 1024 } });
    }
    if (url.pathname.endsWith("/messages") && request.method() === "POST") {
      messages.push(request.postDataJSON());
      return state.failSend ? route.fulfill({ status: 500, json: { message: "Synthetic delivery unavailable" } }) : route.fulfill({ json: {} });
    }
    const data: Record<string, unknown> = {
      "/api/tickets/LAYOUT-1": ticket,
      "/api/auth/me": { user: { id: "operator", firstName: "Test", lastName: "Operator", permissions: ["tickets.view", "tickets.reply"] } },
      "/api/tickets/assignment-options": [], "/api/ticket-teams": [], "/api/external-specialists": [], "/api/ticket-workflow/statuses": [],
      "/api/profile/signature": { htmlSignature: "<p>Test Operator<br>Support Team<br>Example Company</p>", useSignatureByDefault: true },
      "/api/tickets/LAYOUT-1/ai/complete-draft": { text: "" }
    };
    if (url.pathname in data) return route.fulfill({ json: data[url.pathname] });
    return route.fulfill({ status: 503, json: { message: "Unrelated fixture service" } });
  });
  await page.goto("https://composer.test");
  await page.addStyleTag({ content: readFileSync(path.join(root, "apps/web/src/app/globals.css"), "utf8") });
  await expect(page.getByRole("textbox", { name: "Public reply body" })).toBeVisible();
  await expect(page.locator("[data-editor-signature]")).toHaveText(/Test Operator/);
  await page.locator("[data-editor-draft]").fill("Please review the attached files.\n".repeat(30));
  await page.locator(".ticket-composer-extras > summary").click();
  if (fileCount) {
    await page.locator('input[type="file"]').setInputFiles(Array.from({ length: fileCount }, (_, i) => ({ name: `synthetic-${i}.txt`, mimeType: "text/plain", buffer: Buffer.from("Synthetic test attachment") })));
    await expect(page.locator(".attachment-row")).toHaveCount(fileCount);
  }
  return state;
}

async function expectReachable(locator: Locator) {
  await expect.poll(() => locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return rect.top >= 0 && rect.bottom <= innerHeight + 1 && rect.left >= 0 && rect.right <= innerWidth + 1 && !!hit && element.contains(hit);
  })).toBe(true);
}

async function pin(page: Page) {
  await page.getByRole("button", { name: "More send actions" }).focus();
  await page.evaluate(() => window.scrollTo(0, 450));
  await expect(page.locator(".ticket-composer-panel")).toHaveClass(/scroll-pinned/);
}

test("many attachments keep send and its menu reachable, preserving payload on failure", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  const state = await mount(page);
  const send = page.getByRole("button", { name: "Send", exact: true });
  await expectReachable(send);
  await pin(page);
  await expectReachable(send);
  const scroller = page.locator(".ticket-reply-scroll-content");
  await scroller.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expectReachable(send);
  await expectReachable(page.getByRole("button", { name: "Remove", exact: true }).last());
  await page.getByRole("button", { name: "More send actions" }).click();
  await expectReachable(page.getByRole("menuitem", { name: "Send and Close", exact: true }));
  await page.screenshot({ path: testInfo.outputPath("composer-desktop.png") });
  await page.getByRole("button", { name: "More send actions" }).click();
  state.failSend = true;
  await send.click();
  await expect(page.getByText(/Unable to send reply/)).toBeVisible();
  await expectReachable(send);
  expect(state.messages[0].attachmentIds).toHaveLength(24);
  expect(state.messages[0].ccEmails).toHaveLength(12);
  expect(state.messages[0].bodyText).toContain("Please review the attached files.");
  expect(state.messages[0].bodyText).toContain("Test Operator");
  await expect(page.locator(".attachment-row")).toHaveCount(24);
  state.failSend = false;
  await send.click();
  await expect.poll(() => state.messages.length).toBe(2);
  await expect(page.locator(".attachment-row")).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test("collapse preserves uploaded files and draft; scroll hiding and resize still work", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  const state = await mount(page, 8);
  const draft = await page.getByRole("textbox", { name: "Public reply body" }).innerText();
  await page.getByRole("button", { name: "Collapse composer" }).click();
  await expect(page.getByRole("group", { name: "Reply actions" })).toBeHidden();
  await page.getByRole("button", { name: "Expand composer" }).click();
  await expect(page.locator(".attachment-row")).toHaveCount(8);
  expect(await page.getByRole("textbox", { name: "Public reply body" }).innerText()).toBe(draft);
  await pin(page);
  await page.locator(".ticket-composer-panel").evaluate(el => { if (el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur(); });
  await page.evaluate(() => window.scrollBy(0, 150));
  await expect(page.locator(".ticket-composer-panel")).toHaveClass(/scroll-hidden/);
  await page.evaluate(() => window.scrollBy(0, -100));
  await expect(page.locator(".ticket-composer-panel")).toHaveClass(/scroll-pinned/);
  await expectReachable(page.getByRole("button", { name: "Send", exact: true }));
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.locator(".ticket-composer-panel").evaluate(el => el.scrollIntoView({ block: "start" }));
  await expectReachable(page.getByRole("button", { name: "Send", exact: true }));
  expect(state.messages).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

for (const viewport of [{ width: 390, height: 600 }, { width: 844, height: 390 }]) {
  test(`actions fit small screens and long internal notes at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const state = await mount(page, 16);
    await page.getByRole("button", { name: "Internal Note", exact: true }).click();
    await page.locator(".ticket-composer-panel").evaluate(el => el.scrollIntoView({ block: "start" }));
    await page.locator(".ticket-reply-scroll-content").evaluate(el => { el.scrollTop = el.scrollHeight; });
    const send = page.locator(".split-action-main");
    await expectReachable(send);
    await page.getByRole("button", { name: "More send actions" }).click();
    await expectReachable(page.getByRole("menuitem", { name: "Send Note and Close", exact: true }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await expect(page.getByRole("menuitem", { name: "Save Note", exact: true })).toHaveCSS("color", "rgb(229, 237, 248)");
    await page.screenshot({ path: testInfo.outputPath(`composer-${viewport.width}-dark.png`) });
    await page.getByRole("menuitem", { name: "Save Note", exact: true }).click();
    await expect.poll(() => state.messages.length).toBe(1);
    expect(state.messages[0]).toMatchObject({ visibility: "internal", action: "save_note" });
    expect(state.messages[0].attachmentIds).toHaveLength(16);
    expect(state.errors).toEqual([]);
  });
}
