import path from "node:path";
import { expect, test } from "@playwright/test";

const viewports = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 900 },
  { width: 1920, height: 1080 }
];

test("ticket meeting drawer contains its form at desktop, tablet, and mobile widths", async ({ page }) => {
  await page.setContent(`
    <div class="ticket-meeting-drawer-backdrop">
      <aside class="ticket-meeting-drawer">
        <header class="ticket-meeting-drawer-header"><div><span><strong>Ticket Meetings</strong><small>2 scheduled records</small></span></div></header>
        <div class="ticket-meeting-drawer-body">
          <nav class="ticket-meeting-list"><button><span><strong>${"Long meeting title ".repeat(12)}</strong><small>Sep 4, 2026</small></span><em class="ticket-meeting-status scheduled">Scheduled</em></button></nav>
          <form class="ticket-meeting-form">
            <div class="ticket-meeting-fields">
              <label class="field span-2"><span>Title</span><input class="input" value="Ticket meeting" /></label>
              <label class="field"><span>Start</span><input class="input" type="datetime-local" /></label>
              <label class="field"><span>End</span><input class="input" type="datetime-local" /></label>
              <label class="field span-2"><span>Agenda</span><textarea class="input">Agenda</textarea></label>
            </div>
            <section class="ticket-meeting-attendees"><div class="ticket-meeting-attendee-list"><div><span><strong>Requester</strong><small>${"requester-with-long-address".repeat(8)}@example.com</small></span><select><option>Required</option></select><button>X</button></div></div></section>
          </form>
        </div>
      </aside>
    </div>
  `);
  await page.addStyleTag({ path: path.resolve("apps/web/src/app/globals.css") });

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const metrics = await page.evaluate(() => {
      const drawer = document.querySelector<HTMLElement>(".ticket-meeting-drawer")!;
      const form = document.querySelector<HTMLElement>(".ticket-meeting-form")!;
      const drawerRect = drawer.getBoundingClientRect();
      const formRect = form.getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        drawerLeft: drawerRect.left,
        drawerRight: drawerRect.right,
        formLeft: formRect.left,
        formRight: formRect.right
      };
    });
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.drawerLeft).toBeGreaterThanOrEqual(-1);
    expect(metrics.drawerRight).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.formLeft).toBeGreaterThanOrEqual(metrics.drawerLeft - 1);
    expect(metrics.formRight).toBeLessThanOrEqual(metrics.drawerRight + 1);
  }
});
