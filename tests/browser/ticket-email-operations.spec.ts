import path from "node:path";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { test, expect, Page } from "@playwright/test";
const root = path.resolve(".");
const bundle = (own = false) => buildSync({ stdin: { contents: `import React from "react";import {createRoot} from "react-dom/client";import {TicketEmailPanel} from "./apps/web/src/components/notifications/TicketEmailPanel";createRoot(document.getElementById("root")).render(<TicketEmailPanel own={${own}}/>);`, resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", alias: { "@": path.join(root, "apps/web/src") }, define: { "process.env.NODE_ENV": '"test"', "process.env.NEXT_PUBLIC_API_URL": '"/api"' } }).outputFiles[0].text;
const policy = { enabled: false, repliesEnabled: false, closeEnabled: false, includeHistory: true, includeAttachments: true, includeInternal: false, includeTeams: false, includeGroups: false, includeWatchers: true, attachmentBudgetMb: 2, confirmationMinutes: 30 };
async function mount(page: Page, own = false, editable = true) {
  const writes: Array<{ method: string; body: unknown; url: string }> = [];
  await page.route("https://email.test/**", async (route) => {
    const req = route.request(); const url = new URL(req.url());
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: { user: { permissions: ["tickets.view", ...(editable ? ["system_settings.update"] : [])] } } });
    if (url.pathname.startsWith("/api/ticket-email/")) {
      if (["PATCH", "POST"].includes(req.method())) { writes.push({ method: req.method(), body: req.postDataJSON(), url: url.pathname }); return route.fulfill({ json: req.method() === "PATCH" ? req.postDataJSON() : { queued: true } }); }
      return route.fulfill({ json: { policy, deliveries: [{ id: "delivery", ticketId: "synthetic-ticket", ticketNumber: "SYN-100", userName: "Synthetic Specialist", userEmail: "specialist@example.test", subject: "Synthetic ticket reply", eventType: "ticketReplyOnAssignedTicket", status: "REVIEW_REQUIRED", attempts: 1, error: "Provider acceptance is uncertain.", createdAt: "2026-09-21T15:00:00Z" }], actions: [{ id: "action", ticketId: "synthetic-ticket", ticketNumber: "SYN-100", userName: "Synthetic Specialist", userEmail: "specialist@example.test", mode: "PUBLIC", closeTicket: true, status: "AWAITING_CONFIRMATION", createdAt: "2026-09-21T15:00:00Z" }] } });
    }
    return route.fulfill({ contentType: "text/html", body: `<html><body><main id="root"></main><style>${readFileSync(path.join(root, "apps/web/src/app/globals.css"), "utf8")}</style><script>${bundle(own)}</script></body></html>` });
  });
  await page.goto("https://email.test/"); await expect(page.getByRole("heading", { name: "Ticket email operations" })).toBeVisible();
  return writes;
}
test("email policy is explicit, saveable and prevents close without replies", async ({ page }, info) => {
  const writes = await mount(page);
  const close = page.getByRole("checkbox", { name: /^Allow \[Closed\] command/ });
  await expect(close).toBeDisabled();
  await page.getByRole("checkbox", { name: /^Full ticket email/ }).check();
  await page.getByRole("checkbox", { name: /^Allow replies from email/ }).check();
  await close.check();
  await expect(page.getByText("Unsaved email policy changes")).toBeVisible();
  await page.getByRole("button", { name: "Save ticket email settings" }).click();
  expect(writes[0].body).toMatchObject({ enabled: true, repliesEnabled: true, closeEnabled: true });
  await expect(page.getByRole("button", { name: "Save ticket email settings" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /^Allow replies from email/ }).uncheck();
  await expect(close).not.toBeChecked(); await expect(close).toBeDisabled();
  await page.screenshot({ path: info.outputPath("ticket-email-settings.png"), fullPage: true });
});
test("own profile explains policy and exposes only own records without admin mutations", async ({ page }, info) => {
  await mount(page, true);
  await expect(page.getByRole("button", { name: "Save ticket email settings" })).toHaveCount(0);
  await page.getByText("Recent deliveries and email actions", { exact: true }).click();
  await expect(page.getByText("Synthetic ticket reply")).toBeVisible();
  await expect(page.getByRole("link", { name: "SYN-100" }).first()).toHaveAttribute("href", "/tickets/synthetic-ticket");
  await expect(page.getByRole("button", { name: "Retry delivery" })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("AWAITING CONFIRMATION")).toBeVisible();
  await page.screenshot({ path: info.outputPath("ticket-email-profile-mobile.png"), fullPage: true });
});
test("ambiguous retry requires acknowledging possible duplicate delivery", async ({ page }) => {
  const writes = await mount(page);
  await page.getByText("Recent deliveries and email actions", { exact: true }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Retry delivery" }).click(); expect(writes).toHaveLength(0);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Retry delivery" }).click();
  await expect.poll(() => writes.length).toBe(1); expect(writes[0].url).toBe("/api/ticket-email/deliveries/delivery/retry");
});
test("settings readers cannot change policy", async ({ page }) => {
  await mount(page, false, false);
  await expect(page.getByRole("checkbox", { name: /^Full ticket email/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save ticket email settings" })).toHaveCount(0);
});
