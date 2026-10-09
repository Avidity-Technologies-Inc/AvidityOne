import path from "node:path";
import {readFileSync} from "node:fs";
import {buildSync} from "esbuild";
import {test,expect,Page} from "@playwright/test";
const root=path.resolve('.');
const bundle=buildSync({stdin:{contents:'import React from "react";import{createRoot}from"react-dom/client";import{DeviceIdentityReview}from"./apps/web/src/components/devices/DeviceIdentityReview";createRoot(document.getElementById("root")).render(<DeviceIdentityReview canManage={!location.search.includes("readonly")} onChange={()=>{}}/>);',resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',alias:{'@':path.join(root,'apps/web/src'),'next/link':'./tests/browser/fixtures/qc-link.tsx'},define:{'process.env.NODE_ENV':'"test"','process.env.NEXT_PUBLIC_API_URL':'"/api"'}}).outputFiles[0].text;
async function mount(page:Page,readonly=false){
 const writes:any[]=[];let resolved=false;
 const evidence={hostname:'Workstation renamed',remoteIdentifier:'synthetic-agent-new',serialNumber:'SYNTHETIC-SERIAL',hardwareUuid:null,manufacturer:'Vendor',model:'Desktop',clientId:'client',client:{name:'Synthetic client'},site:'Main office',lastSeenAt:'2026-10-09T12:00:00Z',present:true,status:'INACTIVE',reviewReason:'Matching hardware. Review which installation is current.'};
 const item={...evidence,id:'new',state:'PENDING',deviceId:null,device:null,candidates:[{...evidence,id:'old',state:'CURRENT',deviceId:'equipment',device:{id:'equipment',name:'Workstation',clientId:'client'},hostname:'Workstation',remoteIdentifier:'synthetic-agent-old',lastSeenAt:'2026-01-01T00:00:00Z',reviewReason:null,match:'strong'}]};
 await page.route('https://identity.test/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/fixture.js')return route.fulfill({contentType:'application/javascript',body:bundle});
  if(url.pathname==='/api/devices/identity-review')return route.fulfill({json:{items:resolved?[]:[item]}});
  if(url.pathname==='/api/devices/identity-review/new'){writes.push(route.request().postDataJSON());resolved=true;return route.fulfill({json:{deviceId:'equipment',state:'HISTORICAL'}});}
  return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root"></main><script src="/fixture.js"></script></body></html>'});
 });
 await page.goto(`https://identity.test/${readonly?'?readonly':''}`);
 await page.addStyleTag({content:readFileSync(path.join(root,'apps/web/src/app/globals.css'),'utf8')});
 await expect(page.getByText('Matching hardware. Review which installation is current.',{exact:true})).toBeVisible();return writes;
}
test('review compares evidence and requires explicit equipment and verification note',async({page})=>{
 const writes=await mount(page);
 await expect(page.locator('.device-identity-candidate')).toContainText('Matching hardware');
 await page.getByRole('button',{name:'Apply identity decision'}).click();expect(writes).toHaveLength(0);
 await page.getByLabel('Existing equipment').selectOption('equipment');
 await page.getByLabel('Verification note').fill('Serial and model verified by administrator');
 await page.getByRole('button',{name:'Apply identity decision'}).click();
 await expect(page.getByText('No identities need review.')).toBeVisible();expect(writes[0]).toEqual({action:'historical',deviceId:'equipment',reason:'Serial and model verified by administrator'});
});
test('separate decision explains outcome and sends no target ID',async({page})=>{
 const writes=await mount(page);await page.getByRole('combobox',{name:'Decision',exact:true}).selectOption('separate');
 await expect(page.getByLabel('Existing equipment')).toHaveCount(0);
 await page.getByLabel('Verification note').fill('Different equipment verified');await page.getByRole('button',{name:'Apply identity decision'}).click();
 await expect(page.getByText('No identities need review.')).toBeVisible();expect(writes[0].deviceId).toBeUndefined();
});
test('read-only users inspect evidence without mutation controls',async({page})=>{
 await mount(page,true);await expect(page.getByRole('button',{name:'Apply identity decision'})).toHaveCount(0);
 await expect(page.getByText('RMM configuration permission is required to resolve identities.')).toBeVisible();
});
test('identity evidence wraps on narrow screens',async({page})=>{
 await page.setViewportSize({width:430,height:900});await mount(page);
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);expect(overflow).toBe(false);
 await page.screenshot({path:'output/device-identity/review-mobile.png',fullPage:true});
});
