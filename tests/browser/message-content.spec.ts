import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import ts from "typescript";

test.beforeEach(async ({ page }) => {
  const source = await fs.readFile(path.resolve("apps/web/src/lib/message-content.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  await page.setContent('<div id="body"></div>');
  await page.addScriptTag({ content: `const exports = {}; ${compiled}; window.MessageContent = exports;` });
});

test("separates plain iPhone signatures and quoted history", async ({ page }) => {
  const sections = await page.evaluate(() => {
    const api = (window as unknown as { MessageContent: typeof import("../../apps/web/src/lib/message-content") }).MessageContent;
    return api.splitPlainMessage(
      "Please send the findings to my office.\n\nSent from my iPhone\n\n> On Sep 2, 2026, Support wrote:\n> Previous response"
    );
  });

  expect(sections.main).toBe("Please send the findings to my office.");
  expect(sections.signature).toBe("Sent from my iPhone");
  expect(sections.quote).toContain("Previous response");
});

test("collapses iPhone HTML sections without nesting them twice", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = (window as unknown as { MessageContent: typeof import("../../apps/web/src/lib/message-content") }).MessageContent;
    const body = document.querySelector<HTMLElement>("#body")!;
    body.innerHTML = `
      <div>Current customer message</div>
      <div>Sent from my iPhone</div>
      <div>&gt; On Sep 2, 2026, Support wrote:</div>
      <div>&gt; Previous response</div>
    `;
    api.enhanceEmailMessageBody(body);
    api.enhanceEmailMessageBody(body);
    return {
      details: body.querySelectorAll("details").length,
      signature: body.querySelector(".message-signature-collapsible")?.textContent,
      quote: body.querySelector(".message-collapsible:not(.message-signature-collapsible)")?.textContent,
      visible: body.firstElementChild?.textContent
    };
  });

  expect(result.details).toBe(2);
  expect(result.visible).toBe("Current customer message");
  expect(result.signature).toContain("Sent from my iPhone");
  expect(result.quote).toContain("Previous response");
});

test("collapses Gmail signature and quoted history", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = (window as unknown as { MessageContent: typeof import("../../apps/web/src/lib/message-content") }).MessageContent;
    const body = document.querySelector<HTMLElement>("#body")!;
    body.innerHTML = `
      <div>Current reply</div>
      <div class="gmail_signature">Support Team</div>
      <blockquote class="gmail_quote">Earlier customer message</blockquote>
    `;
    api.enhanceEmailMessageBody(body);
    return Array.from(body.querySelectorAll("details")).map((details) => ({
      className: details.className,
      text: details.textContent
    }));
  });

  expect(result).toHaveLength(2);
  expect(result.some((item) => item.className.includes("message-signature-collapsible") && item.text?.includes("Support Team"))).toBe(true);
  expect(result.some((item) => !item.className.includes("message-signature-collapsible") && item.text?.includes("Earlier customer message"))).toBe(true);
});
