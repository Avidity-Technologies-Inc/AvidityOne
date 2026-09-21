import path from "node:path";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { test, expect, Page } from "@playwright/test";
const root = path.resolve(".");
const bundle = buildSync({ stdin: { contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import {ReportsWorkspace} from "./apps/web/src/components/reports/ReportsWorkspace"; createRoot(document.getElementById("root")).render(<ReportsWorkspace/>);', resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", alias: { "@": path.join(root, "apps/web/src"), "next/link": "./tests/browser/fixtures/qc-link.tsx" }, define: { "process.env.NODE_ENV": '"test"', "process.env.NEXT_PUBLIC_API_URL": '"/api"' } }).outputFiles[0].text;
const grants = ["reports.view", "reports.export", "reports.manage", "reports.send", "tickets.view", "event_services.view", "projects.view", "qc.view"];
const subject = "A complete subject that remains readable without truncation: investigate repeated calendar invitations and attachment delivery for the client team.";
const report = { generatedAt: "2026-09-21T15:00:00Z", filters: { startDate: "2026-08-01", endDate: "2026-08-31", timeZone: "America/Chicago", dateBasis: "createdAt" }, options: { clients: [{ id: "client", name: "ISFA" }], users: [], teams: [], priorities: ["NORMAL", "HIGH"], statuses: ["OPEN", "CLOSED"], statusDefinitions: [{ id: "status", name: "Awaiting Equipment" }], sources: ["EMAIL"] }, summary: { totalTickets: 2105, activeTickets: 2105, closedTickets: 0, resolvedTickets: 0, unassignedTickets: 0, highPriorityTickets: 0, withAttachments: 2105, withoutAttachments: 0, estimatedTotal: null }, activity: [{ period: "2026-08-01", label: "2026-08-01", created: 5, resolved: 0, closed: 0 }, { period: "2026-08-02", label: "2026-08-02", created: 10, resolved: 0, closed: 0 }], byStatus: [{ label: "Awaiting Equipment", count: 2105 }], byClient: [{ label: "ISFA", count: 2105 }], byTechnician: [{ label: "Mary Ann Smith", count: 2105 }], byPriority: [{ label: "NORMAL", count: 2105 }], detail: Array.from({ length: 25 }, (_, i) => ({ id: `ticket-${i}`, ticketNumber: `SYN-${i + 1}`, subject, clientName: "ISFA", status: "OPEN", statusDefinition: { name: "Awaiting Equipment" }, priority: "NORMAL", assignedTo: "Mary Ann Smith, Luis Mena", createdAt: "2026-08-15T14:30:00Z", attachmentCount: 8 })), totalMatched: 2105, page: 1, pageSize: 25, totalPages: 85 };
async function mount(page: Page, permissions = grants) {
  const requests: Array<{ method: string; url: string; body?: unknown }> = [];
  await page.route("https://reports.test/**", async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (url.pathname.startsWith("/api")) {
      requests.push({ method: request.method(), url: url.pathname + url.search, body: request.method() === "GET" ? undefined : request.postDataJSON() });
      if (url.pathname.endsWith("configuration")) return route.fulfill({ json: { timeZone: "America/Chicago", locale: "en", currencies: ["CAD", "USD"], permissions } });
      if (url.pathname.endsWith("summary")) return route.fulfill({ json: { ...report, page: Number(url.searchParams.get("page") ?? "1") } });
      if (url.pathname.endsWith("definitions") && request.method() === "POST") return route.fulfill({ json: { id: "saved", ...request.postDataJSON() } });
      if (url.pathname.endsWith("export")) return route.fulfill({ contentType: "application/pdf", headers: { "content-disposition": 'attachment; filename="synthetic.pdf"' }, body: "%PDF synthetic" });
      if (url.pathname.endsWith("send")) return route.fulfill({ json: { sent: true, status: "accepted" } });
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><main id="root" style="padding:20px;max-width:1500px;margin:auto"></main><script src="/fixture.js"></script></body></html>' });
  });
  await page.goto("https://reports.test/reports"); await page.addStyleTag({ content: readFileSync(path.join(root, "apps/web/src/app/globals.css"), "utf8") });
  await expect(page.getByRole("heading", { name: "Report detail", exact: true })).toBeVisible();
  return requests;
}
test("reports retain full subjects and true zero bars across responsive themes", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await mount(page);
  await expect(page.getByText(subject).first()).toBeVisible();
  expect(await page.locator('.report-trend-bars i[data-value="0"]').first().evaluate((node) => node.getBoundingClientRect().height)).toBe(0);
  for (const width of [1440, 768, 390]) { await page.setViewportSize({ width, height: 950 }); const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth); expect(overflow).toBe(false); }
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.screenshot({ path: testInfo.outputPath("reports-overview.png"), fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark")); await page.screenshot({ path: testInfo.outputPath("reports-dark.png"), fullPage: true });
  expect(errors).toEqual([]);
});
test("pending filters cannot export stale results; page scope and ordered columns reach the server", async ({ page }, testInfo) => {
  const requests = await mount(page);
  await page.getByLabel("Search", { exact: true }).fill("calendar");
  await expect(page.getByRole("button", { name: "Export / send" })).toBeDisabled();
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect.poll(() => requests.filter((r) => r.url.includes("search=calendar")).length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Export / send" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Export scope").selectOption("page");
  await dialog.getByLabel("Requester", { exact: true }).check();
  await dialog.getByRole("button", { name: "Move Subject up", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("reports-export.png"), fullPage: true });
  await dialog.getByRole("button", { name: "Download PDF" }).click();
  await expect.poll(() => requests.filter((r) => r.url.includes("/export?")).length).toBe(1);
  const exported = new URL(`https://reports.test${requests.find((r) => r.url.includes("/export?"))!.url}`);
  expect(exported.searchParams.get("scope")).toBe("page"); expect(exported.searchParams.get("columns")?.startsWith("subject,ticketNumber")).toBe(true);
  expect(exported.searchParams.get("startDate")).toBe("2026-08-01"); expect(exported.searchParams.get("period")).toBe("custom");
});
test("read-only users can configure visible columns but cannot send, export or manage", async ({ page }) => {
  await mount(page, ["reports.view"]);
  await expect(page.getByRole("button", { name: "Export / send" })).toHaveCount(0);
  await page.getByRole("button", { name: "Choose columns" }).click();
  await expect(page.getByRole("button", { name: "Download PDF" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send email" })).toHaveCount(0);
  await page.getByRole("button", { name: "Close export options" }).click();
  await page.getByRole("button", { name: "Saved reports", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save as new" })).toHaveCount(0);
});
test("saving persists private visibility, relative period and presentation", async ({ page }) => {
  const requests = await mount(page);
  await page.getByRole("combobox", { name: "Period", exact: true }).selectOption("previousMonth"); await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("button", { name: "Export / send" })).toBeEnabled();
  await page.getByRole("button", { name: "Saved reports", exact: true }).click(); await page.getByLabel("Report name", { exact: true }).fill("Synthetic monthly review");
  await page.getByRole("button", { name: "Save as new" }).click();
  await expect.poll(() => requests.filter((r) => r.method === "POST").length).toBe(1);
  expect(requests.find((r) => r.method === "POST")!.body).toMatchObject({ isShared: false, filters: { period: "previousMonth", columns: "ticketNumber,subject,clientName,status,priority,assignedTo,createdAt,attachmentCount", orientation: "landscape" } });
});
