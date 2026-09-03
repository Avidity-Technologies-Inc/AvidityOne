import path from "node:path";
import { expect, test } from "@playwright/test";

const viewports = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 900 },
  { width: 1280, height: 900 },
  { width: 1920, height: 1080 }
];

const safeLink = `https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.com%2F${"long-segment-".repeat(180)}&data=${"A".repeat(500)}`;

test("ticket conversations contain long email content at desktop, tablet, and mobile widths", async ({ page }) => {
  await page.setContent(`
    <main style="width:100%;padding:12px">
      <section class="ticket-detail-layout">
        <div class="ticket-main-workspace">
          <div class="panel ticket-conversation-panel">
            <div class="ticket-conversation-scroll">
              <div class="timeline ticket-timeline">
                <article class="message inbound" data-testid="link-message">
                  <header class="message-header"><strong>Customer</strong></header>
                  <div class="message-cc-list"><strong>CC</strong><span>${"person@example.com, ".repeat(80)}</span></div>
                  <div class="message-body"><div>Please review <a href="#">${safeLink}</a></div></div>
                </article>
                <article class="message inbound" data-testid="table-message">
                  <div class="message-body"><table style="width:1800px;white-space:nowrap"><tbody><tr><td>${"wide email table ".repeat(120)}</td></tr></tbody></table></div>
                </article>
              </div>
            </div>
          </div>
        </div>
        <aside class="panel ticket-rail-panel">Ticket details</aside>
      </section>
    </main>
  `);
  await page.addStyleTag({ path: path.resolve("apps/web/src/app/globals.css") });

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const metrics = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>(".ticket-conversation-panel")!;
      const linkMessage = document.querySelector<HTMLElement>('[data-testid="link-message"]')!;
      const tableMessage = document.querySelector<HTMLElement>('[data-testid="table-message"]')!;
      const linkBody = linkMessage.querySelector<HTMLElement>(".message-body")!;
      const panelRect = panel.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        panelRight: panelRect.right,
        linkMessageRight: linkMessage.getBoundingClientRect().right,
        tableMessageRight: tableMessage.getBoundingClientRect().right,
        linkBodyClientWidth: linkBody.clientWidth,
        linkBodyScrollWidth: linkBody.scrollWidth
      };
    });

    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.linkMessageRight).toBeLessThanOrEqual(metrics.panelRight + 1);
    expect(metrics.tableMessageRight).toBeLessThanOrEqual(metrics.panelRight + 1);
    expect(metrics.linkBodyScrollWidth).toBeLessThanOrEqual(metrics.linkBodyClientWidth + 1);
  }
});
