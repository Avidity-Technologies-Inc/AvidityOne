import path from "node:path";
import {readFileSync} from "node:fs";
import {buildSync} from "esbuild";
import {test,expect,Page} from "@playwright/test";
const root=path.resolve(".");
const bundle=buildSync({stdin:{contents:'import React,{useState} from "react"; import {createRoot} from "react-dom/client"; import {SystemHealthPanel} from "./apps/web/src/components/settings/SystemHealthPanel"; const onSummary=()=>{}; function App(){const [n,setN]=useState(0);return <><button onClick={()=>setN(n+1)}>Refresh Settings</button><SystemHealthPanel refreshToken={n} onSummary={onSummary}/></>} createRoot(document.getElementById("root")).render(<App/>);',resolveDir:root,loader:"tsx"},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",alias:{"@":path.join(root,"apps/web/src")},define:{"process.env.NODE_ENV":'"test"',"process.env.NEXT_PUBLIC_API_URL":'"/api"'}}).outputFiles[0].text;
async function mount(page:Page){
 let summaryReads=0;let checks=0;let failHistory=false;
 const historyQueries:URL[]=[];
 const stamp="2026-10-01T15:00:00Z";
 const components=[{key:"devices",name:"Devices / RMM Sync",status:"warning",message:"Synchronization was postponed while mailbox work was running.",checkedAt:stamp,metadata:{state:"deferred",intervalMinutes:30,lastAttemptAt:stamp,lastSuccessAt:"2026-10-01T14:30:00Z",nextRunAt:"2026-10-01T15:05:00Z",latestOutcome:{checkedAt:stamp,metadata:{total:249,created:0,updated:249,durationMs:2300}}}},...['database','mail','storage','antivirus','audit_logs'].map(key=>({key,name:key,status:'ok',message:'Recorded diagnostic evidence.',checkedAt:stamp})),{key:'ai',name:'AI providers',status:'disabled',message:'AI assistant is disabled in Settings.',checkedAt:stamp}];
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/fixture.js')return route.fulfill({contentType:'application/javascript',body:bundle});
  if(url.pathname.startsWith('/api/')){
   if(url.pathname==='/api/system-health/summary'||url.pathname==='/api/system-health/check'){
    summaryReads++;if(route.request().method()==='POST')checks++;
    return route.fulfill({json:{status:'warning',severity:'orange',checkedAt:stamp,serverTime:stamp,timezone:'America/Chicago',dateFormat:'MMM dd, yyyy',timeFormat:'12h',recorded:checks>0,automaticCheckIntervalMinutes:15,links:{devices:true,rmm:true},components}});
   }
   if(url.pathname==='/api/system-health/timeline')return route.fulfill({json:{from:'2026-09-30T15:00:00Z',to:stamp,components:components.map(c=>({key:c.key,name:c.name,healthyPercent:100,coveragePercent:4.2,buckets:Array.from({length:24},(_,i)=>({id:c.key+i,start:stamp,end:stamp,status:i===0?'ok':'unknown',message:i===0?'1 observation':'No observations recorded.'}))}))}});
   if(url.pathname==='/api/system-health/history'){
    historyQueries.push(url);if(failHistory)return route.fulfill({status:503,json:{message:'History unavailable'}});
    const pageNumber=Number(url.searchParams.get('page')??1);
    return route.fulfill({json:{total:701,page:pageNumber,totalPages:29,totals:{ok:700,warning:1,error:0,disabled:0,unknown:0},snapshots:[{id:String(pageNumber),name:'Devices / RMM Sync',component:'devices',status:'ok',source:'rmm_auto',message:pageNumber===1?'First page evidence':'Second page evidence',checkedAt:stamp}]}});
   }
   throw Error('Unexpected request: '+url.pathname);
  }
  return route.fulfill({contentType:'text/html',body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main class="settings-page" id="root" style="padding:16px;min-width:0"></main><script src="/fixture.js"></script></body></html>'});
 });
 await page.goto('https://health.test/');
 await page.addStyleTag({content:readFileSync(path.join(root,'apps/web/src/app/globals.css'),'utf8')});
 await expect(page.getByRole('region',{name:'System Health'})).toHaveAttribute('aria-busy','false');
 return {historyQueries,get reads(){return summaryReads},get checks(){return checks},fail:()=>{failHistory=true}};
}
test('renders real sync details, coverage, neutral states and consistent timezone',async({page},info)=>{
 await page.setViewportSize({width:1440,height:1100});await mount(page);
 await expect(page.getByText('30 minutes',{exact:true})).toBeVisible();
 await expect(page.getByText('249 processed',{exact:false})).toBeVisible();
 await expect(page.getByText('Last successful inventory sync')).toBeVisible();
 await expect(page.getByText('100% OK in assessed intervals · 4.2% coverage').first()).toBeVisible();
 await expect(page.getByRole('columnheader',{name:'Time (America/Chicago)'})).toBeVisible();
 await expect(page.getByText(/Oct 1, 2026(?:,| at) 10:00 AM/).first()).toBeVisible();
 await expect(page.locator('.system-health-card.disabled')).toContainText('AI providers');
 await page.screenshot({path:info.outputPath('health-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await expect(page.getByText("First page evidence")).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('health-mobile.png'),fullPage:true});
});
test('filters and paginates full history, refreshes from parent, records only explicit checks',async({page})=>{
 const state=await mount(page);expect(state.checks).toBe(0);
 await page.getByRole('button',{name:'Next',exact:true}).click();await expect(page.getByText('Second page evidence')).toBeVisible();
 expect(state.historyQueries.at(-1)?.searchParams.get('page')).toBe('2');
 await page.getByLabel('Health component',{exact:true}).selectOption('devices');await expect(page.getByText('First page evidence')).toBeVisible();
 await page.getByLabel('Health status',{exact:true}).selectOption('warning');
 await expect.poll(()=>state.historyQueries.at(-1)?.searchParams.get('status')).toBe('warning');
 await page.getByRole('button',{name:'Refresh Settings'}).click();await expect.poll(()=>state.reads).toBeGreaterThan(3);
 await expect(page.getByRole('region',{name:'System Health'})).toHaveAttribute('aria-busy','false');
 await page.getByRole('button',{name:'Run Check',exact:true}).click();await expect.poll(()=>state.checks).toBe(1);
});
test('preserves diagnostic summary and makes history failure visible',async({page})=>{
 const state=await mount(page);state.fail();await page.getByRole('button',{name:'Refresh Settings'}).click();
 await expect(page.getByRole('alert')).toContainText('History unavailable');
 await expect(page.getByText('Refresh needs attention')).toBeVisible();
 await expect(page.getByText('30 minutes',{exact:true})).toBeVisible();
});
