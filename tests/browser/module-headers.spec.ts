import path from "node:path";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { test, expect, Page } from "@playwright/test";
const root = path.resolve(".");
const bundle = buildSync({ stdin: { contents: `
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import Dashboard from './apps/web/src/app/dashboard/page';
import {AppShell} from './apps/web/src/components/layout/AppShell';
import {ModuleSection} from './apps/web/src/components/layout/ModuleHeader';
function App(){const [section,setSection]=useState('System Health'); return location.pathname==='/dashboard' ? <Dashboard/> : <AppShell>{location.pathname==='/settings' ? <><ModuleSection label={section}/><button onClick={()=>setSection('RMM Integration')}>Change section</button></> : location.pathname==='/tickets/SYN-001' ? <h1>#SYN-001</h1> : <p>Module content</p>}</AppShell>}
createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "iife", jsx: "automatic", alias: { "@": path.join(root, "apps/web/src"), "next/link": "./tests/browser/fixtures/qc-link.tsx", "next/navigation": "./tests/browser/fixtures/access-navigation.ts" }, define: { "process.env.NODE_ENV": '"test"', "process.env.NEXT_PUBLIC_API_URL": '"/api"' } }).outputFiles[0].text;
const stats = {timeZone:'America/Chicago',summary:{totalOpen:35,newTickets:3,closedTickets:480,unassignedTickets:0,highPriorityTickets:1,awaitingCustomer:25,awaitingTechnician:4,noRecentUpdate:12},byStatus:[{status:'NEW',label:'New',count:3,filter:{statuses:['NEW']}}],byPriority:[],bySource:[],byClient:[{clientId:'sample',name:'Sample client',count:3}],workload:[],activityByDay:Array.from({length:30},(_,i)=>({date:`2026-09-${i+1}`,label:`Sep ${i+1}`,created:i%5,closed:i%7})),createdByHour:[],insightTickets:{critical:[],unassigned:[],stale:[]}};
async function mount(page: Page, url='/dashboard') {
 const writes: string[]=[];
 await page.route('https://headers.test/**', route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname==='/fixture.js')return route.fulfill({contentType:'application/javascript',body:bundle});
  if(pathname.startsWith('/api/')){
   if(route.request().method()!=='GET')writes.push(pathname);
   const payload:Record<string,unknown>={
    '/api/auth/me':{user:{id:'user',firstName:'Sample',lastName:'Operator',email:'operator@example.test',permissions:['tickets.view','devices.view','system_settings.view','operations.view','projects.view','event_services.view','reports.view','qc.view','clients.view','knowledge_base.view']}},
    '/api/tickets/statistics':stats,'/api/event-services':[], '/api/dashboard/device-statistics':null,
    '/api/dashboard/preferences':route.request().method()==='GET'?{layout:['ticketKpis','ticketActivity','ticketsByClient','ticketsByStatus'],hiddenWidgets:['eventKpis','specialistTrend','specialistPerformance','deviceOverview','deviceSignals','technicianWorkload','ticketAging','staleBySpecialist','ticketsByPriority','ticketsBySource','createdByHour','criticalTickets','unassignedTickets','staleTickets']}:route.request().postDataJSON(),
   };
   return pathname in payload ? route.fulfill({json:payload[pathname]}) : route.fulfill({status:503,json:{message:'Isolated unrelated service'}});
  }
  return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'});
 });
 await page.goto('https://headers.test'+url);
 for(const file of ['globals.css','operational-ui.css'])await page.addStyleTag({content:readFileSync(path.join(root,'apps/web/src/app',file),'utf8')});
 return writes;
}
test('dashboard prioritizes metrics, retains filters and layout controls across sizes and themes',async({page},info)=>{
 await page.setViewportSize({width:1860,height:1000}); const writes=await mount(page);
 await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toHaveCount(1);
 const cards=page.locator('.dashboard-ticket-kpi-grid');await expect(cards).toBeVisible();
 expect((await cards.boundingBox())!.y).toBeLessThan(210);
 await expect(page.locator('.dashboard-page-header')).toHaveCount(0);
 await expect(page.locator('.topbar-company')).toHaveCount(0);
 await expect(page.getByText('Calendar timezone: America/Chicago')).toBeVisible();
 await expect(page.getByRole('link',{name:/Sample client/})).toHaveAttribute('href',/clientId=sample/);
 await page.screenshot({path:info.outputPath('dashboard-desktop.png')});
 await page.getByRole('button',{name:'Customize',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Customize Dashboard'})).toBeVisible();
 await page.getByRole('button',{name:'Save layout'}).click();
 await expect.poll(()=>writes.includes('/api/dashboard/preferences')).toBe(true);
 await page.getByRole('button',{name:'Done',exact:true}).click();
 for(const width of [1024,768,390]){
  await page.setViewportSize({width,height:900});
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.getByRole('button',{name:'Customize',exact:true})).toBeInViewport();
 }
 await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));
 await page.screenshot({path:info.outputPath('dashboard-mobile-dark.png'),animations:'disabled'});
 await page.getByRole('button',{name:'Notifications',exact:true}).click();
 await expect(page.locator('.notification-panel')).toBeVisible();
 expect((await page.locator('.notification-panel').boundingBox())!.y).toBeGreaterThanOrEqual((await page.locator('.topbar').boundingBox())!.height);
 await page.getByRole('button',{name:'Notifications',exact:true}).click();
 await page.getByRole('button',{name:'User menu',exact:true}).click();
 await expect(page.getByRole('menuitem',{name:'Profile',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'User menu',exact:true}).click();
 await page.getByRole('button',{name:'Open navigation',exact:true}).click();
 await expect(page.getByRole('button',{name:'Close navigation',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Close navigation',exact:true}).click();
 await expect(page.locator('.sidebar')).not.toHaveClass(/mobile-open/);
});
test('module identity follows routes and live section labels while record headings stay intact',async({page})=>{
 await mount(page,'/settings');
 await expect(page.locator('.module-title')).toHaveText('Settings');
 await expect(page.locator('.module-section')).toHaveText('System Health');
 await page.getByRole('button',{name:'Change section'}).click();await expect(page.locator('.module-section')).toHaveText('RMM Integration');
 for(const [route,title,section] of [['/projects','Operations','Projects'],['/projects/new','Operations','Projects / New project'],['/event-services/calendar','Event & Services','Calendar'],['/devices','Devices',''],['/reports','Reports',''],['/qc','Quality Control',''],['/tickets/SYN-001','Tickets','']]){
  await page.goto('https://headers.test'+route);
  await expect(page.locator('.module-title')).toHaveText(title);
  if(section)await expect(page.locator('.module-section')).toHaveText(section);
  else await expect(page.locator('.module-section')).toHaveCount(0);
 }
 await expect(page.getByRole('heading',{level:1})).toHaveText('#SYN-001');
});
