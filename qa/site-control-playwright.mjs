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
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:width===390?"reduce":"no-preference",extraHTTPHeaders:{"X-QA-Site-Mode":"coming_soon","X-CQRTV-Site-Mode":"open"}});
  const page=await context.newPage();
  const response=await page.goto(baseUrl+"/",{waitUntil:"domcontentloaded"});
  assert.equal(response?.status(),200);
  assert.equal(await page.title(),"CQRTV — скоро");
  assert.equal(await page.getByRole("heading",{name:"CQRTV скоро откроется"}).isVisible(),true);
  assert.equal(await page.getByRole("button",{name:"Что такое CQRTV?"}).isVisible(),true);
  const adminLink=page.getByRole("link",{name:"Вход для администратора"});
  assert.equal(await adminLink.isVisible(),true,"coming-soon page should expose the standard protected admin login");
  assert.equal(await adminLink.getAttribute("href"),"/admin/login?next=%2F");
  if(width===390){await adminLink.click();assert.equal(new URL(page.url()).pathname,"/admin/login");assert.equal(new URL(page.url()).searchParams.get("next"),"/");assert.equal(await page.title(),"Вход администратора · CQRTV");await page.goBack();}
  const apiStatuses=await page.evaluate(async()=>{const me=await fetch("/api/auth/me",{cache:"no-store"});const register=await fetch("/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});return [me.status,register.status]});
  assert.deepEqual(apiStatuses,[503,503],"direct API requests must stay closed even when the browser spoofs an open mode header");
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
   assert.equal(await button.evaluate(x=>x===document.activeElement),true,"focus should return to the launch page 