import path from "node:path";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { test, expect, Page } from "@playwright/test";
import { emptyQcConfiguration } from "../../packages/shared/src/qc";
const root = path.resolve(".");
const user = { id: "11111111-1111-4111-8111-111111111111", firstName: "Synthetic", lastName: "Reviewer" };
const client = { id: "22222222-2222-4222-8222-222222222222", name: "Synthetic client" };
const rubric = { id: "33333333-3333-4333-8333-333333333333", name: "Synthetic service rubric", revision: 1, kind: "SERVICE", publishedAt: "2026-09-10T14:00:00Z", passThreshold: 90, reinspectionCount: 2, criteria: [{ id: "resolution", label: "Resolution evidence", weight: 60, critical: true, allowNotApplicable: false }, { id: "communication", label: "Client communication", weight: 40, critical: false, allowNotApplicable: true }] };
const permissions = ["qc.view", "qc.view_all", "qc.settings_manage", "qc.reviews_perform", "qc.reviews_assign", "qc.reviews_bulk", "qc.rubrics_manage", "qc.coaching_manage", "qc.actions_complete_own", "qc.notifications_manage", "qc.export_internal", "qc.export_client", "qc.work_record"];
const lookups = { currentUserId: user.id, permissions, users: [user], clients: [client], projects: [], categories: [], rubrics: [rubric] };
const configuration = emptyQcConfiguration();
const program = { version: 0, captureEnabled: false, processingEnabled: false, deliveryEnabled: false, configuration, startedAt: null, readiness: ["QC owner", "Sampling policy"] };
const service = { cycles: 0, completeCycles: 0, incompleteCycles: 0, firstResponseSample: 0, averageFirstResponseBusinessMinutes: null, resolutionSample: 0, averageResolutionBusinessMinutes: null, evaluatedObligations: 0, breachedObligations: 0, slaCompliancePercent: null, historical: { cycles: 0, firstResponseSample: 0, averageFirstResponseElapsedMinutes: null, resolutionSample: 0, averageResolutionElapsedMinutes: null, basis: "Retained evidence" } };
const overview = { generatedAt: "2026-09-10T14:00:00Z", period: { cohort: "Synthetic work cycles" }, program, pendingSourceEvents: 0, service, quality: { selected: 0, scored: 0, averageScore: null, passed: 0, pending: 0, flags: 0, bulkCleared: 0 }, followUp: { open: 0, overdue: 0, recognition: 0 }, creative: { total: 0, delivered: 0, onTime: 0, overdue: 0, averageRevisionRounds: null }, trends: [] };
// Mount the real QC React components; only Next navigation and server responses are isolated.
const bundled = buildSync({ absWorkingDir: root, stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {QcWorkspace} from './apps/web/src/components/qc/QcWorkspace'; createRoot(document.getElementById('root')).render(<QcWorkspace section={location.pathname.split('/').filter(Boolean).slice(1)} />);`, resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "next/link": "./tests/browser/fixtures/qc-link.tsx" }, define: { "process.env.NODE_ENV": '"test"', "process.env.NEXT_PUBLIC_API_URL": '"/api"' } });
async function mount(page: Page, route = "/qc", overrides: Record<string, unknown> = {}) {
  const requests: Array<{ path: string; body: unknown }> = [];
  const responses: Record<string, unknown> = { "/qc/lookups": lookups, "/qc/overview": overview, "/qc/settings": { ...lookups, program, policies: [], statuses: [], mailboxes: [], agreementTypes: [] }, "/qc/reviews": { items: [], total: 0, page: 1, pageSize: 25 }, ...overrides };
  await page.route("https://qc.test/**", async intercepted => {
    const url = new URL(intercepted.request().url());
    if (url.pathname === "/fixture.js") return intercepted.fulfill({ contentType: "application/javascript", body: bundled.outputFiles[0].text });
    if (url.pathname.startsWith("/api/")) {
      const key = url.pathname.slice(4);
      if (intercepted.request().method() !== "GET") { requests.push({ path: key, body: intercepted.request().headers()["content-type"]?.includes("multipart/form-data") ? intercepted.request().postData() : intercepted.request().postDataJSON() }); return intercepted.fulfill({ json: { updated: true } }); }
      return intercepted.fulfill({ json: responses[key] ?? {} });
    }
    return intercepted.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><main id="root" style="padding:20px;max-width:1600px;margin:auto"></main><script src="/fixture.js"></script></body></html>' });
  });
  await page.goto(`https://qc.test${route}`);
  await page.addStyleTag({ content: readFileSync(path.join(root, "apps/web/src/app/globals.css"), "utf8") });
  await page.addStyleTag({ content: readFileSync(path.join(root, "apps/web/src/components/qc/qc.css"), "utf8") });
  await expect(page.getByRole("heading", { name: "Quality Control", exact: true })).toBeVisible();
  return requests;
}
test("QC renders honest empty metrics and fits desktop, tablet and mobile", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await mount(page);
  await expect(page.getByText("QC processing is inactive.", { exact: false })).toBeVisible();
  await expect(page.getByText("Not measurable", { exact: true }).first()).toBeVisible();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  }
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("qc-overview.png"), fullPage: true, animations: "disabled" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.screenshot({ path: testInfo.outputPath("qc-overview-dark.png"), fullPage: true, animations: "disabled" });
});
test("QC configuration sends selected real record IDs and keeps activation off", async ({ page }, testInfo) => {
  const requests = await mount(page, "/qc/settings");
  await page.screenshot({ path: testInfo.outputPath("qc-settings.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("combobox", { name: "QC owner", exact: true }).selectOption(user.id);
  await page.getByLabel("Sample percentage", { exact: true }).fill("17");
  await page.getByLabel("Sampling period (days)", { exact: true }).fill("7");
  await page.getByLabel("Minimum per cohort", { exact: true }).fill("2");
  await page.getByRole("combobox", { name: "Historical measurement", exact: true }).selectOption("INCLUDE_HISTORY");
  await page.getByLabel("Reason for configuration change").fill("Synthetic configuration validation");
  await page.getByRole("button", { name: "Validate & save configuration" }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ path: "/qc/settings", body: { version: 0, captureEnabled: false, processingEnabled: false, deliveryEnabled: false, configuration: { ownerId: user.id, samplingPercent: 17, samplingMinimum: 2, historicalMeasurement: "INCLUDE_HISTORY" } } });
});
test("inspection requires a failed-criterion comment and submits the current version", async ({ page }, testInfo) => {
  const id = "44444444-4444-4444-8444-444444444444";
  const review = { id, ticketId: "55555555-5555-4555-8555-555555555555", deliverableId: null, status: "IN_REVIEW", version: 4, ownerId: user.id, reviewerId: user.id, owner: user, reviewer: user, ticket: { id: "55555555-5555-4555-8555-555555555555", ticketNumber: "SYN-QC-1", subject: "Synthetic source ticket", client }, deliverable: null, findings: [], selectionReasons: ["SAMPLE"], score: null, finalizedAt: null, acknowledgedAt: null, createdAt: "2026-09-10T14:00:00Z", rubric: null, policy: null, results: null, actions: [], history: [], billingState: "NOT_HELD" };
  const requests = await mount(page, `/qc/reviews/${id}`, { [`/qc/reviews/${id}`]: review, [`/qc/reviews/${id}/evidence`]: { ticket: { subject: "Synthetic source", qcProfile: null, messages: [{ id: "message", bodyText: "<script>alert('untrusted')</script>", direction: "INBOUND", createdAt: "2026-09-10T14:00:00Z", authorUser: null }] }, events: [], timeEntries: [] } });
  await page.getByLabel("Published rubric").selectOption(rubric.id);
  const fields = page.locator("fieldset.qc-divider");
  await fields.nth(0).getByRole("combobox", { name: "Result", exact: true }).selectOption("FAIL");
  await fields.nth(1).getByRole("combobox", { name: "Result", exact: true }).selectOption("PASS");
  await expect(page.getByRole("button", { name: "Finalize inspection" })).toBeDisabled();
  await fields.nth(0).getByLabel("Reviewer comment (required)").fill("Resolution evidence is missing in this synthetic case.");
  await page.screenshot({ path: testInfo.outputPath("qc-inspection.png"), fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Finalize inspection" }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ path: `/qc/reviews/${id}/score`, body: { version: 4, rubricId: rubric.id, results: [{ criterionId: "resolution", outcome: "FAIL" }, { criterionId: "communication", outcome: "PASS" }] } });
});

test("creative work uploads private proofs and exposes authenticated evidence links", async ({ page }, testInfo) => {
  const project = { id: "66666666-6666-4666-8666-666666666666", name: "Synthetic design project" };
  const id = "77777777-7777-4777-8777-777777777777";
  const attachmentId = "88888888-8888-4888-8888-888888888888";
  const item = { id, name: "Synthetic brand proof", kind: "Artwork", project, owner: user, status: "DRAFT", dueAt: "2026-09-20T14:00:00Z", deliveredAt: null, version: 0, timeEntries: [], history: [], attachments: [{ id: attachmentId, createdAt: "2026-09-10T14:00:00Z", deliverableVersion: 0, scanStatus: "CLEAN", storedFile: { originalFilename: "original-proof.txt", fileSize: 21, sha256Hash: "synthetic-fixture" } }] };
  // Inspect the browser's actual FormData: WebKit interception omits file bytes from postData.
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      if (init?.body instanceof FormData) {
        const file = init.body.get("file");
        if (file instanceof File) document.documentElement.dataset.proofUpload = await file.text();
      }
      return original(input, init);
    };
  });
  const requests = await mount(page, "/qc/creative", { "/qc/lookups": { ...lookups, projects: [project] }, "/qc/deliverables": { items: [item], total: 1, page: 1, pageSize: 25 }, [`/qc/deliverables/${id}`]: item, [`/qc/projects/${project.id}/evidence-options`]: { events: [], articles: [] } });
  await page.getByRole("button", { name: "Synthetic brand proof", exact: true }).click();
  await expect(page.getByRole("link", { name: "original-proof.txt" })).toHaveAttribute("href", `/api/qc/deliverables/${id}/attachments/${attachmentId}`);
  await page.getByLabel("Proof or approval file").setInputFiles({ name: "revised-proof.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic revised proof") });
  await page.getByRole("button", { name: "Save private proof" }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].path).toBe(`/qc/deliverables/${id}/attachments`); expect(requests[0].body).toContain("revised-proof.txt");
  await expect(page.locator("html")).toHaveAttribute("data-proof-upload", "Synthetic revised proof");
  await expect(page.getByRole("button", { name: "Save private proof" })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("qc-creative.png"), fullPage: true, animations: "disabled" });
});
