import path from "node:path";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { expect, test, Page } from "@playwright/test";
const root = path.resolve(".");
const bundle = buildSync({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {TicketReplyEditor} from './apps/web/src/components/tickets/TicketReplyEditor'; import {ComposerPreferencesPanel} from './apps/web/src/components/composer/ComposerPreferencesPanel'; import * as helpers from './apps/web/src/lib/composer-content'; window.helpers=helpers; createRoot(document.getElementById('root')).render(location.pathname==='/profile'?<ComposerPreferencesPanel/>:<section className="ticket-composer-panel"><TicketReplyEditor ticketId="FORMAT-1"/></section>);`, resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.join(root, "apps/web/src") }, define: { "process.env.NODE_ENV": '"test"', "process.env.NEXT_PUBLIC_API_URL": '"/api"' } });
const defaults = { fontFamily: "Arial", fontSize: 14, color: "#172033", lineHeight: 1.5, pasteMode: "adapt", allowPersonalFormatting: true };
async function mount(page: Page, pathname = "/") {
  const state = { overrides: {} as Record<string, unknown>, messages: [] as any[], patches: [] as any[], failPreference: false, aiDraft: "", aiDelay: 0, aiTransform: (text: string) => text.replace("helo", "Hello") };
  await page.route("https://format.test/**", async route => {
    const req = route.request(); const url = new URL(req.url());
    if (url.pathname === "/fixture.js") return route.fulfill({ contentType: "application/javascript", body: bundle.outputFiles[0].text });
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root" style="max-width:1100px;margin:20px auto"></main><script src="/fixture.js"></script></body></html>' });
    if (url.pathname === "/api/profile/composer") {
      if (req.method() === "PATCH") {
        const patch = req.postDataJSON(); state.patches.push(patch);
        if (state.failPreference) return route.fulfill({ status: 503, json: { message: "Synthetic save failure" } });
        state.overrides = patch.reset ? {} : { ...state.overrides, ...patch };
      }
      return route.fulfill({ json: { defaults, overrides: state.overrides, effective: { ...defaults, displayScale: 100, ...state.overrides }, fonts: ["Arial", "Calibri", "Georgia"], canManage: true } });
    }
    if (url.pathname.endsWith("/signature")) return route.fulfill({ json: { htmlSignature: '<table style="width:320px;color:#785522"><tbody><tr><td style="width:100px">Operator</td><td style="border-left:2px solid #3344aa">Support signature</td></tr></tbody></table>', useSignatureByDefault: true } });
    if (url.pathname.endsWith("/messages")) { state.messages.push(req.postDataJSON()); return route.fulfill({ json: {} }); }
    if (url.pathname.endsWith("/complete-draft")) return route.fulfill({ json: { text: "" } });
    if (url.pathname.includes("/ai/")) {
      state.aiDraft = req.postDataJSON().draft;
      await new Promise(resolve => setTimeout(resolve, state.aiDelay));
      return route.fulfill({ json: { text: state.aiTransform(state.aiDraft) } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto(`https://format.test${pathname}`);
  await page.addStyleTag({ content: readFileSync(path.join(root, "apps/web/src/app/globals.css"), "utf8") });
  if (pathname === "/") await expect(page.locator("[data-editor-signature]")).toContainText("Support signature");
  return state;
}
async function paste(page: Page, html: string, text: string) {
  await page.locator("[data-editor-draft]").click();
  await page.locator(".ticket-message-surface").evaluate((editor, value) => {
    const data = new DataTransfer(); data.setData("text/html", value.html); data.setData("text/plain", value.text);
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data });
    Object.defineProperty(event, "clipboardData", { value: data });
    editor.dispatchEvent(event);
  }, { html, text });
}
async function selectDraft(page: Page) {
  await page.locator("[data-editor-draft]").evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
}
test("paste modes strip foreign colors by default, preserve safe source on demand, and send real formatting without reading zoom", async ({ page }, info) => {
  const state = await mount(page);
  const html = '<div style="background-color:#202020;color:#eeeeee;font-size:24px" onclick="alert(1)">Office update <a href="https://example.invalid/help">Help</a></div>';
  await paste(page, html, "Office update Help");
  await expect(page.locator("[data-editor-draft]")).toContainText("Office update");
  expect(await page.locator("[data-editor-draft]").innerHTML()).not.toContain("background");
  await expect(page.locator("[data-editor-draft] a")).toHaveAttribute("href", "https://example.invalid/help");
  await page.getByRole("button", { name: "Format & paste" }).click();
  await page.getByLabel("Paste behavior").selectOption("keep");
  await expect.poll(() => state.overrides.pasteMode).toBe("keep");
  await page.locator("[data-editor-draft]").fill("");
  await paste(page, html, "Office update Help");
  await expect(page.locator('[data-editor-draft] [style*="background"]')).toHaveCSS("background-color", "rgb(32, 32, 32)");
  await expect(page.locator('[data-editor-draft] [style*="background"]')).toHaveCSS("color", "rgb(238, 238, 238)");
  expect(await page.locator("[data-editor-draft]").innerHTML()).not.toContain("onclick");
  state.overrides.displayScale = 150;
  await page.evaluate(() => { document.documentElement.setAttribute("data-theme", "dark"); window.dispatchEvent(new Event("focus")); });
  await expect(page.locator(".ticket-message-surface")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.screenshot({ path: info.outputPath("formatting-dark.png") });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => state.messages.length).toBe(1);
  expect(state.messages[0].bodyHtml).toContain("font-size: 14px");
  expect(state.messages[0].bodyHtml).not.toContain("zoom");
  expect(state.messages[0].bodyHtml).toContain('width:320px;color:#785522');
});
test("link dialog inserts, edits and removes safe destinations; selected text formatting leaves signature intact", async ({ page }) => {
  await mount(page);
  await page.locator("[data-editor-draft]").fill("Read the guide"); await selectDraft(page);
  await page.getByRole("button", { name: "Link", exact: true }).click();
  await page.getByLabel("Link address").fill("javascript:alert(1)"); await page.getByRole("button", { name: "Apply link" }).click();
  await expect(page.getByText(/Enter a valid https/)).toBeVisible();
  await page.getByLabel("Link address").fill("https://example.invalid/guide"); await page.getByRole("button", { name: "Apply link" }).click();
  await expect(page.locator("[data-editor-draft] a")).toHaveAttribute("href", "https://example.invalid/guide");
  await selectDraft(page);
  await page.getByRole("button", { name: "Format & paste" }).click();
  await page.getByLabel("Selected text size").selectOption("20");
  await expect(page.locator('[data-editor-draft] [style*="font-size"]')).toHaveCSS("font-size", "20px");
  await expect(page.locator("[data-editor-signature] table")).toHaveAttribute("style", "width:320px;color:#785522");
  await page.locator("[data-editor-draft] a").evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); getSelection()!.removeAllRanges(); getSelection()!.addRange(range); document.dispatchEvent(new Event("selectionchange")); });
  await page.getByRole("button", { name: "Link", exact: true }).click();
  await page.getByRole("button", { name: "Remove link" }).click();
  await expect(page.locator("[data-editor-draft] a")).toHaveCount(0);
});
test("AI review preserves protected links and signature, supports undo, and rejects stale draft overwrite", async ({ page }) => {
  const state = await mount(page);
  await paste(page, 'helo, please visit <a href="https://example.invalid/help">the portal</a>.', "helo, please visit the portal.");
  const signature = await page.locator("[data-editor-signature]").innerHTML();
  await page.getByRole("button", { name: "Rewrite Draft" }).click();
  await expect(page.getByRole("region", { name: "AI writing suggestion" })).toBeVisible();
  expect(state.aiDraft).not.toContain("Support signature");
  expect(state.aiDraft).toContain("[[AVIDITY_CONTENT_1]]");
  await expect(page.getByRole("region", { name: "AI writing suggestion" }).locator("a")).toHaveAttribute("href", "https://example.invalid/help");
  await page.getByRole("button", { name: "Apply suggestion" }).click();
  await expect(page.locator(".ticket-message-surface")).toContainText("Hello");
  expect(await page.locator("[data-editor-signature]").innerHTML()).toBe(signature);
  await page.getByRole("button", { name: "Undo last AI edit" }).click();
  await expect(page.locator(".ticket-message-surface")).toContainText("helo");
  state.aiDelay = 500;
  await page.getByRole("button", { name: "Rewrite Draft" }).click();
  await page.locator("[data-editor-draft]").fill("New edits while waiting");
  await expect(page.getByText(/Your draft changed while/)).toBeVisible();
  await expect(page.locator(".ticket-message-surface")).toContainText("New edits while waiting");
});
test("profile autosaves, retries failed changes without losing other fields, and resets to inheritance", async ({ page }) => {
  const state = await mount(page, "/profile");
  await page.getByLabel("Message size (px)").selectOption("18");
  await expect(page.getByRole("status")).toHaveText("Saved automatically");
  state.failPreference = true;
  await page.getByRole("combobox", { name: "Message font", exact: true }).selectOption("Georgia");
  await expect(page.getByRole("alert")).toContainText("Synthetic save failure");
  state.failPreference = false;
  await page.getByLabel("Reading zoom — only your view").selectOption("125");
  await expect(page.getByRole("status")).toHaveText("Saved automatically");
  expect(state.overrides).toMatchObject({ fontSize: 18, fontFamily: "Georgia", displayScale: 125 });
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Message font", exact: true })).toHaveValue("Georgia");
  await page.getByRole("button", { name: "Restore organization defaults" }).click();
  await expect(page.getByRole("combobox", { name: "Message font", exact: true })).toHaveValue("Arial");
  await expect.poll(() => Object.keys(state.overrides).length).toBe(0);
});
test("clipboard helpers reject active markup and plain mode retains literal text", async ({ page }) => {
  await mount(page);
  const values = await page.evaluate(() => {
    const h = (window as any).helpers;
    return [h.normalizeClipboard('<script>alert(1)</script><div data-editor-signature="true" style="background:url(https://example.invalid/pixel);color:red"><a href="javascript:alert(1)">safe</a><svg onload="alert(1)"></svg></div>', 'safe', 'keep'), h.normalizeClipboard('<b>Bold</b>', '<b>literal</b>\nhttps://example.invalid', 'text')];
  });
  expect(values[0]).not.toMatch(/script|javascript|onload|url\(|data-editor-signature/);
  expect(values[1]).toBe('&lt;b&gt;literal&lt;/b&gt;<br>https://example.invalid');
});
test("AI cannot silently discard links, and formatting never targets a selected signature", async ({ page }) => {
  const state = await mount(page);
  await paste(page, 'helo <a href="https://example.invalid/keep">keep this link</a>', "helo keep this link");
  const before = await page.locator(".ticket-message-surface").innerHTML();
  state.aiTransform = () => "Hello, please check the portal.";
  await page.getByRole("button", { name: "Rewrite Draft" }).click();
  await expect(page.getByText(/changed a protected link or image/)).toBeVisible();
  expect(await page.locator(".ticket-message-surface").innerHTML()).toBe(before);
  await page.locator(".ticket-message-surface").evaluate(editor => { const range = document.createRange(); range.selectNodeContents(editor); getSelection()!.removeAllRanges(); getSelection()!.addRange(range); });
  await page.getByRole("button", { name: "Remove formatting", exact: true }).click();
  expect(await page.locator(".ticket-message-surface").innerHTML()).toBe(before);
});
test("font sizing survives outgoing HTML and keyboard undo remains available", async ({ page }) => {
  const state = await mount(page);
  await page.locator("[data-editor-draft]").fill("A formatted message"); await selectDraft(page);
  await page.getByRole("button", { name: "Format & paste" }).click();
  await page.getByLabel("Selected text size").selectOption("20");
  await expect(page.locator('[data-editor-draft] [style*="font-size"]')).toHaveCSS("font-size", "20px");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  // Browsers may group adjacent typing/formatting transactions; redo must restore the complete edit.
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator(".ticket-message-surface")).toContainText("A formatted message");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => state.messages.length).toBe(1);
  expect(state.messages[0].bodyHtml).toContain("font-size: 20px");
  expect(state.messages[0].bodyHtml).not.toContain("<font");
});
test("format-only draft edits survive reload without requiring extra typing", async ({ page }) => {
  await mount(page);
  await page.locator("[data-editor-draft]").fill("Persist this formatting"); await selectDraft(page);
  await page.getByRole("button", { name: "Format & paste" }).click();
  await page.getByLabel("Selected text size").selectOption("22");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("ticket-reply-draft:FORMAT-1"))).toContain("22px");
  await page.reload();
  await expect(page.locator('[data-editor-draft] [style*="font-size"]')).toHaveCSS("font-size", "22px");
  await expect(page.locator("[data-editor-signature]")).toHaveCount(1);
});
