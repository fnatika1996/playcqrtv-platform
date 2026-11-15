import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const playwrightRoot=process.env.PLAYWRIGHT_PACKAGE;
if(!playwrightRoot)throw new Error("PLAYWRIGHT_PACKAGE must point to the pinned Playwright install.");
const {chromium}=await import(pathToFileURL(playwrightRoot+"/index.mjs").href);
const baseUrl=process.env.CQRTV_QA_BASE_URL||"http://playcqrtv.com:8765";
const dir=new URL("../qa-artifacts/",import.meta.url);
await mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true,args:["--host-resolver-rules=MAP playcqrtv.com 127.0.0.1"]});
try{
 for(const width of [1440,1024,760,390,375,320]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:width===390?"reduce":"no-preference",extraHTTPHeaders:{"X-QA-Site-Mode":"coming_soon"}});
  const page=await context.newPage();
  const response=await page.goto(baseUrl+"/",{waitUntil:"domcontentloaded"});
  assert.equal(response?.status(),200);
  assert.equal(await page.title(),"CQRTV — скоро");
  assert.equal(await page.getByRole("heading",{name:"CQRTV скоро откроется"}).isVisible(),true);
  assert.equal(await page.getByRole("button",{name:"Что такое CQRTV?"}).isVisible(),true);
  const social=page.getByRole("link",{name:"Telegram QA"});await social.waitFor({state:"visible"});assert.equal(await social.getAttribute("href"),"https://t.me/cqrtv");
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  assert.equal(overflow,false,"coming soon page must not overflow horizontally at "+width+"px");
  if(width===1440)await page.screenshot({path:new URL("site-control-desktop.png",dir).pathname,fullPage:true});
  if(width===390){
   const button=page.getByRole("button",{name:"Что такое CQRTV?"});
   await button.focus();await page.keyboard.press("Enter");
   const dialog=page.getByRole("dialog");
   assert.equal(await dialog.isVisible(),true);
   assert.equal(await dialog.getByRole("heading",{name:"Играй. Объединяйся. Развивайся."}).isVisible(),true);
   await page.keyboard.press("Tab");
   assert.equal(await page.locator("#close-dialog").evaluate(x=>x===document.activeElement),true);
   await page.keyboard.press("Escape");
   assert.equal(await dialog.isHidden(),true);
   assert.equal(await button.evaluate(x=>x===document.activeElement),true,"focus should return to the launch page button");
   const duration=await page.locator("#scene").evaluate(x=>getComputedStyle(x,"::before").animationDuration);const durationValue=parseFloat(duration);assert.ok(duration.endsWith("ms")?durationValue<=0.01:durationValue<=0.00001,"reduced motion should disable background motion");
   await page.screenshot({path:new URL("site-control-mobile.png",dir).pathname,fullPage:true});
  }
  await context.close();
 }
 const maintenanceContext=await browser.newContext({viewport:{width:390,height:844},extraHTTPHeaders:{"X-QA-Site-Mode":"maintenance"}});
 const maintenancePage=await maintenanceContext.newPage();
 await maintenancePage.goto(baseUrl+"/",{waitUntil:"domcontentloaded"});
 await maintenancePage.getByRole("heading",{name:"CQRTV на обслуживании"}).waitFor({state:"visible"});
 assert.equal(await maintenancePage.getByText("Выполняются плановые технические работы.").isVisible(),true);
 await maintenanceContext.close();
 const previewContext=await browser.newContext({viewport:{width:1024,height:768},extraHTTPHeaders:{"X-QA-Admin-Preview":"yes"}});
 const preview=await previewContext.newPage();
 const response=await preview.goto(baseUrl+"/",{waitUntil:"domcontentloaded"});
 assert.equal(response?.status(),200);
 assert.notEqual(await preview.title(),"CQRTV — скоро","admin preview should bypass the closed public page");
 await previewContext.close();
 console.log("PASS site control desktop/mobile, modal keyboard flow, maintenance mode and admin preview.");
}finally{await browser.close()}
