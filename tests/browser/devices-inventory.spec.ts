import path from "node:path";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { test, expect, Page } from "@playwright/test";
import { inventoryNetwork, selectInventory } from "../../apps/api/src/modules/devices/device-inventory";
import type { DeviceQueryDto } from "../../apps/api/src/modules/devices/dto/device-query.dto";
const root = path.resolve(".");
const bundle = buildSync({ stdin: { contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import {DevicesWorkspace} from "./apps/web/src/components/devices/DevicesWorkspace"; import {ModuleHeader,ModuleHeaderProvider} from "./apps/web/src/components/layout/ModuleHeader"; createRoot(document.getElementById("root")).render(<ModuleHeaderProvider><ModuleHeader/><DevicesWorkspace/></ModuleHeaderProvider>);', resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", alias: { "@": path.join(root, "apps/web/src"), "next/navigation": "./tests/browser/fixtures/access-navigation.ts", "next/link": "./tests/browser/fixtures/qc-link.tsx" }, define: { "process.env.NODE_ENV": '"test"', "process.env.NEXT_PUBLIC_API_URL": '"/api"' } }).outputFiles[0].text;

async function mount(page: Page, initial = "", savedState?: object, compact = false) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {value:{writeText:async (value: string) => { (window as any).__copiedAddress = value; }}, configurable:true});
  });
  const requests: URL[] = []; const writes: Array<{path:string; body:any}> = [];
  const rows = Array.from({ length: 525 }, (_, i) => ({ id: String(i + 1), name: `PC${i + 1}`, hostname: `pc${i + 1}.example`, deviceGroupId: i % 2 ? "West" : "East", type: i % 5 === 0 ? "SERVER" : "DESKTOP", operatingSystem: i % 2 ? "Windows 11" : "Ubuntu 24.04", osVersion: "24H2", primaryUser: "Synthetic user", serialNumber: null, assetTag: null, remoteAccessId: String(i + 1), status: i % 2 ? "INACTIVE" : "ACTIVE", client: { id: "client-a", name: "Synthetic client", shortName: null }, favorites: i === 9 ? [{userId:"reader"}] : [], lastSeenAt: "2026-09-30T14:00:00Z", remoteAccessProfile: { detailSnapshot: { syncedAt:"2026-09-30T14:05:00Z", agent:{version:"2.9"}, network: { localIps: ["10.0.0.1", `192.168.${Math.floor(i / 250)}.${i % 250 + 1}`, "fe80::abcd"], publicIp:"203.0.113.9", macAddresses:["AA:BB:CC:DD:EE:FF"] } } }, actionUrls: { controlUrl:null, remoteBackgroundUrl:null, systemInfoUrl:null } }));
  const saved = [{id:"legacy", name:"Existing view", state:savedState ?? {search:"", clientId:"", status:"", type:"", view:"table", deviceTab:"all", pageSize:25}, scope:"PRIVATE", isDefault:true}];
  await page.route("https://inventory.test/**", async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname === "/fixture.js") return route.fulfill({contentType:"application/javascript", body:bundle});
    if (url.pathname.startsWith("/api/")) {
      if (request.method() !== "GET") writes.push({path:url.pathname, body:request.postDataJSON()});
      if (url.pathname === "/api/devices/views") return route.fulfill({json:request.method() === "GET" ? saved : {id:"new"}});
      if (url.pathname === "/api/devices/views/legacy") return route.fulfill({json:{}});
      if (/\/favorite$/.test(url.pathname)) {
        const record = rows.find(row => url.pathname === `/api/devices/${row.id}/favorite`)!;
        record.favorites = request.method() === "PUT" ? [{userId:"reader"}] : [];
        return route.fulfill({json:{}});
      }
      if (url.pathname === "/api/devices") {
        requests.push(url);
        const query = Object.fromEntries(url.searchParams) as unknown as DeviceQueryDto;
        const candidates = rows.filter(row => (!query.clientId || query.clientId === row.client.id) && (!query.site || row.deviceGroupId === query.site) && (!query.type || row.type === query.type) && (!query.status || row.status === query.status) && (query.favoritesOnly !== "true" || row.favorites.length));
        const {selected, counts} = selectInventory(candidates, query);
        const pageSize = Number(query.pageSize ?? 50); const totalPages = Math.max(1, Math.ceil(selected.length / pageSize)); const currentPage = Math.min(Number(query.page ?? 1), totalPages);
        const response = {devices:selected.slice((currentPage-1)*pageSize,currentPage*pageSize).map(row => ({...row, isFavorite:row.favorites.length>0, remoteAccessDetails:row.remoteAccessProfile.detailSnapshot, matchedNetwork:query.search ? inventoryNetwork(row).filter(value => value.toLowerCase().includes(query.search!.toLowerCase())) : []})), totalDevices:rows.length, filteredTotal:selected.length, page:currentPage, totalPages, categoryCounts:counts, sites:["East","West"], clients:[{id:"client-a", name:"Synthetic client"}], remoteAccess:{enabled:true, providerName:"RMM",lastSyncAt:"2026-09-30T14:05:00Z",lastSyncStatus:"success",lastSyncMessage:"Inventory updated",autoSyncEnabled:true,autoSyncIntervalMinutes:30,nextAutoSyncAt:"2026-09-30T14:35:00Z"}};
        if (query.search === "slow") await new Promise(resolve => setTimeout(resolve, 650));
        return route.fulfill({json:response}).catch(() => {});
      }
      throw new Error(`Unexpected API: ${request.method()} ${url.pathname}`);
    }
    return route.fulfill({contentType:"text/html",body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><main id="root" style="padding:16px;min-width:0"></main><script src="/fixture.js"></script></body></html>'});
  });
  await page.goto(`https://inventory.test/devices${initial}`);
  await page.addStyleTag({content:["globals.css","operational-ui.css"].map(file => readFileSync(path.join(root,"apps/web/src/app",file),"utf8")).join("\n")});
  await page.addStyleTag({ content: readFileSync(path.join(root, "apps/web/src/app/operational-ui.css"), "utf8") });
  await expect(page.locator(".device-results-panel")).toHaveAttribute("aria-busy","false");
  if (!compact) {
    await page.getByLabel("Device options",{exact:true}).click();
    await page.getByRole("button",{name:"Show filters and order",exact:true}).click();
  }
  return {requests,writes};
}

const names = (page: Page) => page.locator(".device-table-device-cell a");
test("sorts complete inventory, navigates pages, and restores saved ordering", async ({page}) => {
  const {writes} = await mount(page);
  await expect(page.getByLabel("Rows per page")).toHaveValue("25");
  await expect(names(page).first()).toHaveText("PC10");
  await page.getByLabel("Favorites first",{exact:true}).uncheck();
  await page.getByRole("columnheader",{name:"Device",exact:true}).getByRole("button").click();
  await expect(names(page).first()).toHaveText("PC1");
  await expect(names(page).nth(1)).toHaveText("PC2");
  await page.getByRole("button",{name:"Next",exact:true}).click();
  await expect(names(page).first()).toHaveText("PC26");
  await page.getByRole("columnheader",{name:"Device",exact:true}).getByRole("button").click();
  await expect(names(page).first()).toHaveText("PC525");
  await expect(page.getByRole("columnheader",{name:"Device",exact:true})).toHaveAttribute("aria-sort","descending");
  await expect(page.getByText("Page 1 of 21")).toBeVisible();
  for (const label of ["Client / Site", "OS", "Status"]) {
    await page.getByRole("columnheader",{name:label,exact:true}).getByRole("button").click();
    await expect(page.getByRole("columnheader",{name:label,exact:true})).toHaveAttribute("aria-sort","ascending");
    await expect(page.locator(".device-results-panel")).toHaveAttribute("aria-busy","false");
  }
  await page.getByLabel("Sort by",{exact:true}).selectOption("site");
  await page.getByLabel("Direction",{exact:true}).selectOption("desc");
  await page.getByLabel("Device options",{exact:true}).click();
  await page.getByRole("button",{name:"Saved views",exact:true}).click();
  await page.getByRole("button",{name:"Update View",exact:true}).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].body.state).toMatchObject({sortBy:"site",sortDirection:"desc",favoritesFirst:false,pageSize:25});
  await page.getByRole("button",{name:"Apply View",exact:true}).click();
  await expect(page.getByLabel("Sort by",{exact:true})).toHaveValue("client");
  await expect(page.getByLabel("Favorites first",{exact:true})).toBeChecked();
});

test("finds secondary IPs, WAN, MAC and IPv6, with clear filtered empty state", async ({page}) => {
  await mount(page);
  const search = page.getByLabel("Search devices");
  await search.fill("192.168.2.");
  await expect(page.getByText("Showing 1-25 of 25")).toBeVisible();
  await expect(names(page).first()).toHaveText("PC501");
  await expect(page.locator(".device-network").first()).toContainText("192.168.2.1");
  await expect(page.locator(".device-network").first()).toContainText("Match");
  await page.getByRole("button",{name:"Copy 192.168.2.1",exact:true}).first().click();
  expect(await page.evaluate(() => (window as any).__copiedAddress)).toBe("192.168.2.1");
  await page.locator(".device-network summary").first().click();
  await expect(page.locator(".device-network details").first()).toContainText("203.0.113.9");
  for (const term of ["203.0.113.9","AA:BB","FE80::AB"]) {
    await search.fill(term);
    await expect(page.getByText("Showing 1-25 of 525")).toBeVisible();
    await expect(page.locator(".device-network").first()).toContainText(term === "AA:BB" ? "AA:BB" : term.toLowerCase());
  }
  await search.fill("no such device");
  await expect(page.getByRole("heading",{name:"No devices found"})).toBeVisible();
  await expect(page.getByText(/Configure RMM Integration/)).toHaveCount(0);
  await page.getByRole("button",{name:"Clear filters"}).click();
  await expect(page.getByText("Showing 1-25 of 525")).toBeVisible();
});

test("keeps URL type filters, category counts, site and favorite controls across views", async ({page}, info) => {
  const {writes} = await mount(page,"?type=SERVER&sortBy=name&favoritesFirst=false");
  await expect(page.getByLabel("Device type")).toHaveValue("SERVER");
  await expect(page.getByText("Showing 1-50 of 105")).toBeVisible();
  await page.getByRole("button",{name:"Clear filters"}).click();
  await expect(page.getByText("Showing 1-50 of 525")).toBeVisible();
  await page.getByLabel("Site",{exact:true}).selectOption("East");
  await expect(page.getByText("Showing 1-50 of 263")).toBeVisible();
  await page.getByRole("button",{name:/^Servers 53$/}).click();
  await expect(page.getByText("Showing 1-50 of 53")).toBeVisible();
  await page.getByRole("button",{name:"Clear filters"}).click();
  await page.getByLabel("Only favorites").check();
  await expect(page.getByText("Showing 1-1 of 1")).toBeVisible();
  await expect(names(page)).toHaveText(["PC10"]);
  await page.getByLabel("Remove PC10 from favorites").click();
  await expect(page.getByRole("heading",{name:"No devices found"})).toBeVisible();
  expect(writes[0].path).toBe("/api/devices/10/favorite");
  await page.getByRole("button",{name:"Clear filters"}).click();
  await expect(page.getByText("Showing 1-50 of 525")).toBeVisible();
  await page.setViewportSize({width:1440,height:1000});
  const actionsFit = await page.locator(".device-table-action-cell").first().evaluate(cell => {
    const bounds = cell.getBoundingClientRect();
    const buttons = [...cell.querySelectorAll("button")].map(button => button.getBoundingClientRect());
    return buttons.every(button => button.right <= bounds.right && Math.abs(button.top - buttons[0].top) < 1);
  });
  expect(actionsFit).toBe(true);
  await page.getByLabel("Device options",{exact:true}).click();
  await page.getByRole("button",{name:"Hide filters and order",exact:true}).click();
  await page.screenshot({path:info.outputPath("devices-table.png"),fullPage:false,animations:"disabled"});
  for (const view of ["Cards","Tree"]) {
    await page.getByRole("button",{name:view,exact:true}).click();
    await expect(page.getByText(view === "Cards" ? "Showing 1-50 of 525" : "Showing 51-100 of 525")).toBeVisible();
    await page.getByRole("button",{name:"Next",exact:true}).click();
    await expect(page.getByText(view === "Cards" ? "Showing 51-100 of 525" : "Showing 101-150 of 525")).toBeVisible();
  }
  await page.getByRole("button",{name:"Table",exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath("devices-mobile.png"),fullPage:false,animations:"disabled"});
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(() => document.documentElement.setAttribute("data-theme","dark"));
  await page.screenshot({path:info.outputPath("devices-dark.png"),fullPage:false,animations:"disabled"});
});

test("ignores a delayed response after the search has changed", async ({page}) => {
  const {requests} = await mount(page);
  await page.getByLabel("Search devices").fill("slow");
  await expect.poll(() => requests.some(url => url.searchParams.get("search") === "slow")).toBe(true);
  await page.getByLabel("Search devices").fill("192.168.2.");
  await expect(page.getByText("Showing 1-25 of 25")).toBeVisible();
  await page.waitForTimeout(800);
  await expect(names(page).first()).toHaveText("PC501");
  await expect(page.getByRole("heading",{name:"No devices found"})).toHaveCount(0);
});

test("compact default preserves hidden criteria and exposes synchronization details", async ({page}) => {
  await mount(page,"?site=East",undefined,true);
  await expect(page.getByRole("region",{name:"Inventory filters and order"})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Filters: East",exact:true})).toBeVisible();
  await expect(page.locator(".device-network").first()).not.toContainText("Inventory:");
  await expect(page.getByRole("heading",{name:"Devices",exact:true})).toBeVisible();
  await page.getByLabel("Device options",{exact:true}).click();
  await page.getByRole("button",{name:"Synchronization details",exact:true}).click();
  await expect(page.getByRole("region",{name:"Synchronization details"})).toContainText("Next automatic sync");
  await expect(page.getByRole("button",{name:/Sync: success · Every 30 min/})).toBeVisible();
  await page.getByRole("button",{name:"Filters: East",exact:true}).click();
  await expect(page.getByLabel("Site",{exact:true})).toHaveValue("East");
});
