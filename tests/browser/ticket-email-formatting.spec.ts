import path from "node:path";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";
import { expect, test } from "@playwright/test";

// Exercise the actual server sanitizer before rendering its output with the application styles.
const entry = path.resolve("apps/api/src/common/html/html-sanitizer.service.ts");
const compiled = buildSync({ entryPoints: [entry], bundle: true, packages: "external", platform: "node", format: "cjs", write: false });
const loaded = { exports: {} as { HtmlSanitizerService: new () => { sanitizeEmail(html: string): string } } };
new Function("require", "module", "exports", compiled.outputFiles[0].text)(createRequire(entry), loaded, loaded.exports);
const sanitizer = new loaded.exports.HtmlSanitizerService();
const signature = '<table cellpadding="0" cellspacing="0" style="width:500px;font-family:Arial;font-size:12px"><tr><td style="width:143px;border-right:1px solid #3e59ff"><img src="https://email.test/photo.png" width="116" height="116" alt="Synthetic portrait"></td><td style="width:26px"></td><td style="width:331px"><strong>Test Operator</strong><br>Technical Support<br><br>Phone: 555-0100<br><a href="mailto:operator@example.invalid">operator@example.invalid</a><br>Example Company</td></tr></table>';
const incoming = '<table align="left" cellpadding="0" cellspacing="0" style="width:96%"><tr><td style="padding:7px;background-color:#fff4ce"><strong>EXTERNAL:</strong> This message originated outside the organization. Review attachments carefully.</td></tr></table><p>I think one of the ways is to receive the form with all the information. Please review the request.</p><p>Best regards,</p>' + signature;

for (const theme of ["light", "dark", "oled"]) {
  test(`email banners and signature columns retain their layout in ${theme}`, async ({ page }, testInfo) => {
    await page.route("https://email.test/photo.png", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="116" height="116"><rect width="116" height="116" fill="#9aa7bd"/><circle cx="58" cy="42" r="22" fill="#eef2f8"/><path d="M18 116V95a40 40 0 0 1 80 0v21" fill="#eef2f8"/></svg>' }));
    await page.setContent(`<html data-theme="${theme}"><body><main style="padding:16px;max-width:1150px"><article class="panel message"><div class="message-body" id="incoming">${sanitizer.sanitizeEmail(incoming)}</div></article><article class="panel message"><div class="message-body" id="outgoing">${sanitizer.sanitizeEmail('<p>Current reply.</p>' + signature)}</div></article></main></body></html>`);
    await page.addStyleTag({ path: path.resolve("apps/web/src/app/globals.css") });
    for (const width of [1280, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const metrics = await page.evaluate(() => {
        const body = document.querySelector<HTMLElement>("#incoming")!;
        const banner = body.querySelector("table")!;
        const reply = body.querySelector("p")!;
        const signature = document.querySelector<HTMLTableElement>("#outgoing table")!;
        const cells = signature.rows[0].cells;
        return {
          float: getComputedStyle(banner).float,
          bannerBottom: banner.getBoundingClientRect().bottom,
          replyTop: reply.getBoundingClientRect().top,
          signatureWidth: signature.getBoundingClientRect().width,
          spacerWidth: cells[1].getBoundingClientRect().width,
          portraitWidth: cells[0].getBoundingClientRect().width,
          border: getComputedStyle(cells[0]).borderRightWidth,
          pageOverflow: document.documentElement.scrollWidth - innerWidth,
          incomingOverflow: body.scrollWidth - body.clientWidth,
          outgoingOverflow: document.querySelector('#outgoing')!.scrollWidth - document.querySelector('#outgoing')!.clientWidth
        };
      });
      expect(metrics.float).toBe("none");
      expect(metrics.replyTop).toBeGreaterThanOrEqual(metrics.bannerBottom);
      expect(metrics.pageOverflow).toBeLessThanOrEqual(1);
      expect(metrics.incomingOverflow).toBeLessThanOrEqual(1);
      expect(metrics.outgoingOverflow).toBeLessThanOrEqual(1);
      expect(metrics.border).toBe("1px");
      expect(metrics.spacerWidth).toBeGreaterThan(8);
      if (width >= 768) {
        expect(metrics.signatureWidth).toBeCloseTo(500, 0);
        expect(metrics.spacerWidth).toBeCloseTo(26, 0);
        expect(metrics.portraitWidth).toBeCloseTo(143, 0);
      }
      if (width !== 768) await page.screenshot({ path: testInfo.outputPath(`email-${theme}-${width}.png`) });
    }
  });
}
