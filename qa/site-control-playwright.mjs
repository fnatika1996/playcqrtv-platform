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
   assert.equal(await button.evaluate(x=>x===document.activeElement),true,"focus should return to the launch page button");
   const duration=await page.locator("#scene").evaluate(x=>getComputedStyle(x,"::before").animationDuration);const durationValue=parseFloat(duration);assert.ok(duration.endsWith("ms")?durationValue<=0.01:durationValue<=0.00001,"reduced motion should disable background motion");
   await page.screenshot({path:new URL("site-control-mobile.png",dir).pathname,fullPage:true});
  }
  await context.close();
 }
 const maintenanceContext=await browser.newContext({viewport:{width:390,height:844},extraHTTPHeaders:{"X-QA-Site-Mode":"maintenance","X-CQRTV-Site-Mode":"open"}});
 const maintenancePage=await maintenanceContext.newPage();
 await maintenancePage.goto(baseUrl+"/",{waitUntil:"domcontentloaded"});
 await maintenancePage.getByRole("heading",{name:"CQRTV на обслуживании"}).waitFor({state:"visible"});
 assert.equal(await maintenancePage.getByText("Выполняются плановые технические работы.").isVisible(),true);
 await maintenanceContext.close();
 const recoveryContext=await browser.newContext({viewport:{width:390,height:844},extraHTTPHeaders:{"X-QA-Site-Mode":"maintenance","X-CQRTV-Site-Mode":"open","X-Forwarded-Uri":"/"}});
 const recovery=await recoveryContext.newPage();
 const loginResponse=await recovery.goto(baseUrl+"/admin/login",{waitUntil:"domcontentloaded"});
 assert.equal(loginResponse?.status(),200,"admin login page must stay reachable without a session while the site is closed");
 const unavailableLogin=await recovery.evaluate(async()=>{const response=await fetch("/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json","X-QA-DB-Down":"yes"},body:"{}"});return response.status});
 assert.equal(unavailableLogin,503,"admin login API fails closed while the test database is unavailable");
 const spoofedAdmin=await recovery.goto(baseUrl+"/admin/site-control",{waitUntil:"domcontentloaded"});
 assert.equal(spoofedAdmin?.status(),401,"Caddy must overwrite a spoofed X-Forwarded-Uri and protect admin pages");
 await recoveryContext.addCookies([{name:"cqrtv_qa_admin",value:"expired",domain:"playcqrtv.com",path:"/"}]);
 const expiredAdmin=await recovery.goto(baseUrl+"/admin/site-control",{waitUntil:"domcontentloaded"});
 assert.equal(expiredAdmin?.status(),401,"an expired admin session must not unlock the control panel");
 await recoveryContext.addCookies([{name:"cqrtv_qa_admin",value:"valid",domain:"playcqrtv.com",path:"/"}]);
 const loginAgain=await recovery.goto(baseUrl+"/admin/login",{waitUntil:"domcontentloaded"});
 assert.equal(loginAgain?.status(),200,"login recovery page remains reachable after an expired session");
 const preview=await recovery.goto(baseUrl+"/",{waitUntil:"domcontentloaded"});
 assert.equal(preview?.status(),200);
 assert.notEqual(await recovery.title(),"CQRTV — скоро","a validated admin session should bypass the closed page");
 await recoveryContext.close();
 for(const width of [1440,760,390,320]){
  const context=await browser.newContext({viewport:{width,height:900}});
  await context.addCookies([{name:"cqrtv_qa_admin",value:"valid",domain:"playcqrtv.com",path:"/"}]);
  const page=await context.newPage();
  let socialPayload=null;
  const siteControlState={settings:{mode:"open",heading:"Heading",subtitle:"Subtitle",description:"Description",statusLabel:"READY",maintenanceHeading:"Maintenance",maintenanceSubtitle:"Back soon",maintenanceDescription:"Updating.",maintenanceStatusLabel:"MAINTENANCE",launchAt:"",countdownEnabled:false,aboutButtonLabel:"About CQRTV",aboutTitle:"CQRTV",aboutBody:"Players, teams and matches.",animationEnabled:false,backgroundAssetId:null},socialLinks:[{id:"11111111-1111-4111-8111-111111111111",label:"Telegram QA",url:"https://t.me/cqrtv",iconKey:"chat",iconAssetId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",enabled:true,sortOrder:0}]};
  await page.route("**/api/site-control/media/**",route=>route.fulfill({status:200,contentType:"image/png",body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pZcAAAAASUVORK5CYII=","base64")}));
  await page.route("**/api/admin/**",async route=>{
   const url=new URL(route.request().url());let data;
   if(url.pathname==="/api/admin/me")data={user:{nickname:"QA Admin"},csrfToken:"qa-token"};
   else if(url.pathname==="/api/admin/site-control")data=siteControlState;
   else if(url.pathname==="/api/admin/site-control/social-links"&&route.request().method()==="POST"){socialPayload=route.request().postDataJSON();siteControlState.socialLinks=[socialPayload];data={message:"saved"};}
   else return route.fulfill({status:404,contentType:"application/json",body:'{"error":"unknown mock"}'});
   return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(data)});
  });
  const response=await page.goto(baseUrl+"/admin/site-control",{waitUntil:"domcontentloaded"});
  assert.equal(response?.status(),200);
  await page.locator("#social-list .social-item").waitFor({state:"visible"});
  assert.equal(await page.getByRole("heading",{name:"Режим и публичная страница"}).isVisible(),true);
  assert.equal(await page.getByLabel("Режим сайта").isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,"admin site control must not overflow at "+width+"px");
  if(width===1440){
   await page.getByRole("button",{name:"Изменить"}).click();
   assert.equal(await page.getByLabel("Использовать иконку CQRTV вместо загруженной").isChecked(),true);
   await page.getByRole("button",{name:"Сохранить ссылку"}).click();
   await page.waitForFunction(()=>document.querySelector("#social-list img")?.getAttribute("src")==="/assets/icons/cqrtv/ui/chat.svg");
   assert.equal(socialPayload?.iconAssetId,null,"switching an existing social link to a packaged icon must clear its prior uploaded asset");
   assert.equal(socialPayload?.iconKey,"chat");
   await page.screenshot({path:new URL("site-control-admin-desktop.png",dir).pathname,fullPage:true});
  }
  if(width===390)await page.screenshot({path:new URL("site-control-admin-mobile.png",dir).pathname,fullPage:true});
  await context.close();
 }
 console.log("PASS site control desktop/mobile, modal keyboard flow, maintenance mode, admin preview, spoofed-header denial, expired-session recovery and packaged-icon replacement.");

}finally{await browser.close()}
