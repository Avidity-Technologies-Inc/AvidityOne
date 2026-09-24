import path from "node:path";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { test, expect, Page } from "@playwright/test";
const root = path.resolve(".");
const bundle = buildSync({ stdin: { contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import {ClientsWorkspace} from "./apps/web/src/components/clients/ClientsWorkspace"; import {OperationsWorkspace} from "./apps/web/src/components/operations/OperationsWorkspace"; createRoot(document.getElementById("root")).render(location.pathname === "/clients" ? <ClientsWorkspace/> : <OperationsWorkspace/>);', resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", alias: { "@": path.join(root, "apps/web/src"), "next/link": "./tests/browser/fixtures/qc-link.tsx", "next/navigation": "./tests/browser/fixtures/ticket-navigation.ts" }, define: { "process.env.NODE_ENV": '"test"', "process.env.NEXT_PUBLIC_API_URL": '"/api"' } }).outputFiles[0].text;
const grants = ["qc.view", "clients.view", "tickets.view", "devices.view", "projects.view", "operations.view", "ticket_meetings.view"];
const clients = Array.from({length: 61}, (_, i) => ({id: `client-${i}`, name: `Institution ${String(i + 1).padStart(2, "0")}`, shortName: null, status: "ACTIVE", notes: null, domains: [{id: `domain-${i}`, domain: `client${i}.example`, isActive: true, isVerified: true}], contacts: []}));
const item = { id: "ticket", kind: "TICKET", reference: "SYN-001", title: "Review the maintenance plan", clientName: "Synthetic client", status: "OPEN", priority: "NORMAL", owner: "Alex Example", teamName: null, dueAt: null, updatedAt: "2026-09-24T14:00:00Z", href: "/tickets/SYN-001", attention: true, internalOwners: ["Alex Example", "Alex Example"], internalOwnerIds: ["user-a", "user-b"] };
const overview = { currentUserId: "user-a", generatedAt: "2026-09-24T15:00:00Z", agendaEnd: "2026-10-22T15:00:00Z", sources: {tickets:true,events:false,projects:false}, summary: {activeTickets:1,unassignedTickets:0,activeEvents:0,upcomingEvents:0,activeProjects:0,atRiskProjects:0,openProjectDecisions:0,projectCommitments:0,unassignedProjectCommitments:0,blockedTasks:0,attentionItems:1,overdueItems:0,overCapacity:0,nearCapacity:0,capacityBaseline:12,capacityWarningPercent:75,dueSoonDays:7}, capabilities: {}, items: [item], decisions: [], workload: ["user-a", "user-b"].map(ownerId => ({ownerId,owner:"Alex Example",operational:1,projectCommitments:0,total:1,attention:1,capacityPercent:8,capacityStatus:"AVAILABLE",details:[item]})), forecast: {weeks:[],owners:[]}, agenda: ["user-a", "user-b"].map((id, i) => ({id: `activity-${i}`, title: `Scheduled visit ${i + 1}`, startAt:"2026-09-25T15:00:00Z", endAt:"2026-09-25T16:00:00Z", timeZone:"America/Chicago", activityType:"ONSITE_VISIT", modality:"IN_PERSON", location:"Client office", syncStatus:"SYNCED", organizer:{id,firstName:"Alex",lastName:"Example"}, attendees:[],ticket:{ticketNumber:"SYN-001",status:"OPEN",client:{name:"Synthetic client"}}})) };
async function mount(page: Page, routePath: string) {
  const writes: string[] = [];
  await page.route("https://audit.test/**", async route => {
    const req = route.request(); const url = new URL(req.url());
    if (url.pathname === "/fixture.js") return route.fulfill({contentType:"application/javascript",body:bundle});
    if (url.pathname.startsWith("/api/")) {
      if (req.method() !== "GET") writes.push(req.method() + " " + url.pathname);
      if (url.pathname === "/api/auth/me") return route.fulfill({json:{user:{id:"user-a",permissions:grants}}});
      if (url.pathname === "/api/clients") return route.fulfill({json:clients});
      if (url.pathname === "/api/operations/overview") return route.fulfill({json:overview});
      if (url.pathname.includes("executive-summary")) return route.fulfill({status:403,json:{message:"Not permitted"}});
      return route.fulfill({json:[]});
    }
    return route.fulfill({contentType:"text/html",body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><main id="root" style="padding:16px"></main><script src="/fixture.js"></script></body></html>'});
  });
  await page.goto(`https://audit.test${routePath}`);
  await page.addStyleTag({content: ["globals.css", "operational-ui.css"].map(file => readFileSync(path.join(root,"apps/web/src/app",file),"utf8")).join("\n")});
  return writes;
}

test("clients retain records beyond 50, filter and navigate with read-only grants", async ({page}, info) => {
  const writes = await mount(page,"/clients");
  await expect(page.getByText("61 matching clients")).toBeVisible();
  await expect(page.getByRole("button",{name:"Add Institution",exact:true})).toBeDisabled();
  await expect(page.getByRole("button",{name:"Edit institution",exact:true}).first()).toBeDisabled();
  await page.getByRole("button",{name:"Next",exact:true}).click();
  await page.getByRole("button",{name:"Next",exact:true}).click();
  await expect(page.getByRole("button",{name:/Institution 61/})).toBeVisible();
  await page.getByLabel("Search clients").fill("client60.example");
  await expect(page.getByText("1 matching clients")).toBeVisible();
  await page.getByRole("button",{name:/Institution 61/}).click();
  await expect(page.getByRole("link",{name:"Tickets",exact:true})).toHaveAttribute("href","/tickets?clientId=client-60");
  for (const width of [1440,768,390]) { await page.setViewportSize({width,height:950}); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  await page.setViewportSize({width:1440,height:950}); await page.screenshot({path:info.outputPath("client-context.png"),fullPage:true});
  expect(writes).toEqual([]);
});

test("agenda keeps personal scope, activity links and identity-based owners", async ({page}, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await mount(page,"/operations");
  await expect(page.getByRole("heading",{name:"Scheduled ticket activities",exact:true})).toBeVisible();
  await expect(page.getByRole("link",{name:"QC queue",exact:true})).toBeVisible();
  await page.setViewportSize({width:1440,height:950});
  expect(await page.getByRole("region",{name:"Operations filters"}).evaluate(node => node.getBoundingClientRect().height)).toBeLessThan(100);
  await expect(page.getByRole("region",{name:"Operations filters"}).getByRole("button",{name:"All",exact:true})).toBeInViewport();
  await expect(page.locator(".audit-agenda article")).toHaveCount(1);
  await expect(page.locator(".audit-agenda a").first()).toHaveAttribute("href","/tickets/SYN-001?activity=activity-0");
  await page.getByLabel("My activities",{exact:true}).uncheck();
  await expect(page.locator(".audit-agenda article")).toHaveCount(2);
  await expect(page.getByRole("combobox",{name:"Filter by owner"}).locator('option[value="user-a"]')).toHaveCount(1);
  await expect(page.getByRole("combobox",{name:"Filter by owner"}).locator('option[value="user-b"]')).toHaveCount(1);
  await expect(page.getByRole("heading",{name:"Workload against item baseline"})).toBeVisible();
  for (const width of [1440,768,390]) { await page.setViewportSize({width,height:950}); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  await page.setViewportSize({width:1440,height:1000}); await page.screenshot({path:info.outputPath("operations.png"),fullPage:true});
  await page.evaluate(() => document.documentElement.setAttribute("data-theme","dark")); await page.screenshot({path:info.outputPath("operations-dark.png"),fullPage:true});
  expect(errors).toEqual([]);
});
