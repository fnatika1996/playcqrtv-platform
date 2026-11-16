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
 const maintenanceAdminLink=maintenancePage.getByRole("link",{name:"Вход для администратора"});
 assert.equal(await maintenanceAdminLink.isVisible(),true,"maintenance page should also expose protected admin login");
 assert.equal(await maintenanceAdminLink.getAttribute("href"),"/admin/login?next=%2F");
 await maintenanceContext.close();
 const recoveryContext=await browser.newContext({viewport:{width:390,height:844},extraHTTPHeaders:{"X-QA-Site-Mode":"maintenance","X-CQRTV-Site-Mode":"open","X-Forwarded-Uri":"/"}});
 const recovery=await recoveryContext.newPage();
 const offlineResponse=await recovery.goto(baseUrl+"/",{waitUntil:"domcontentloaded"});
 assert.equal(offlineResponse?.status(),200);
 assert.equal(await recovery.title(),"CQRTV — скоро","an anonymous visitor should continue to see the closed page");
 await recovery.getByRole("link",{name:"Вход для администратора"}).click();
 assert.equal(new URL(recovery.url()).pathname,"/admin/login","the offline link should open the standard admin login");
 assert.equal(new URL(recovery.url()).searchParams.get("next"),"/","the link should request only the safe public homepage return");
 assert.equal(await recovery.title(),"Вход администратора · CQRTV","admin login remains reachable while the site is closed");
 const unavailableLogin=await recovery.evaluate(async()=>{const response=await fetch("/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json","X-QA-DB-Down":"yes"},body:"{}"});return response.status});
 assert.equal(unavailableLogin,503,"admin login API fails closed while the test database is unavailable");
 const spoofedAdmin=await recovery.goto(baseUrl+"/admin/site-control",{waitUntil:"domcontentloaded"});
 assert.equal(spoofedAdmin?.status(),401,"Caddy must overwrite a spoofed X-Forwarded-Uri and protect admin pages");
 await recoveryContext.addCookies([{name:"cqrtv_qa_admin",value:"expired",domain:"playcqrtv.com",path:"/"}]);
 const expiredAdmin=await recovery.goto(baseUrl+"/admin/site-control",{waitUntil:"domcontentloaded"});
 assert.equal(expiredAdmin?.status(),401,"an expired admin session must not unlock the control panel");
 await recoveryContext.addCookies([{name:"cqrtv_qa_admin",value:"valid",domain:"playcqrtv.com",path:"/"}]);
 await recovery.goto(baseUrl+"/admin/login?next=%2F",{waitUntil:"domcontentloaded"});
 const failedLoginUrl=recovery.url();
 await recovery.getByLabel("Рабочий email",{exact:true}).fill("wrong@example.test");
 await recovery.getByLabel("Пароль",{exact:true}).fill("wrong-password");
 await recovery.getByRole("button",{name:"Войти в панель"}).click();
 await recovery.getByRole("alert").waitFor({state:"visible"});
 assert.equal(recovery.url(),failedLoginUrl,"failed login must stay on the login screen");
 await recovery.getByLabel("Рабочий email",{exact:true}).fill("qa-admin@example.test");
 await recovery.getByLabel("Пароль",{exact:true}).fill("qa-only-password");
 await recovery.getByRole("button",{name:"Войти в панель"}).click();
 await recovery.waitForURL(url=>url.pathname==="/",{timeout:5000});
 assert.equal(await recovery.title(),"CQRTV - CS2 Matchmaking","successful login from the offline page returns to the public homepage");
 const validCookie=(await recoveryContext.cookies()).find(cookie=>cookie.name==="cqrtv_qa_admin");
 assert.equal(validCookie?.value,"valid","successful mock login should set the expected admin session cookie");
 await recoveryContext.close();
 const rejectedNextValues=["","?next=https%3A%2F%2Fevil.example","?next=%2F%2Fevil.example","?next=%252F%252Fevil.example","?next=javascript%3Aalert%281%29","?next=%5C%5Cevil.example","?next=%2Fadmin"];
 const redirectContext=await browser.newContext({viewport:{width:390,height:844}});
 const redirectPage=await redirectContext.newPage();
 await redirectPage.route("**/admin",route=>route.fulfill({status:200,contentType:"text/html",body:"<!doctype html><title>QA admin destination</title>"}));
 for(const query of rejectedNextValues){
  await redirectPage.goto(baseUrl+"/admin/login"+query,{waitUntil:"domcontentloaded"});
  await redirectPage.getByLabel("Рабочий email",{exact:true}).fill("qa-admin@example.test");
  await redirectPage.getByLabel("Пароль",{exact:true}).fill("qa-only-password");
  await redirectPage.getByRole("button",{name:"Войти в панель"}).click();
  await redirectPage.waitForURL(url=>url.pathname==="/admin",{timeout:5000});
  assert.equal(new URL(redirectPage.url()).origin,new URL(baseUrl).origin,"untrusted next values must not navigate off-origin");
 }
 await redirectContext.close();
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
  assert.equal(await page.getByRole("heading",{name:"Управление сайтом"}).isVisible(),true);
  assert.equal(await page.getByLabel("Режим сайта").isVisible(),true);
  const adminOverflow=await page.evaluate(()=>({page:document.documentElement.scrollWidth>innerWidth,scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,offenders:[...document.querySelectorAll("body *")].map(element=>{const rect=element.getBoundingClientRect();return{tag:element.tagName,id:element.id,className:typeof element.className==="string"?element.className:"",left:Math.round(rect.left),right:Math.round(rect.right),width:Math.round(rect.width),text:(element.innerText||"").slice(0,70)}}).filter(item=>item.id!=="shell"&&!item.className.includes("aside")&&item.right>innerWidth+1).slice(0,15)}));
  assert.equal(adminOverflow.page,false,"admin site control must not overflow at "+width+"px: "+JSON.stringify(adminOverflow));
  if(width===1440){
   await page.getByRole("button",{name:"Изменить"}).click();
   const packagedIcon=page.getByLabel("Использовать иконку CQRTV вместо загруженной");
   assert.equal(await packagedIcon.isChecked(),false,"an existing uploaded icon is initially selected");
   await packagedIcon.check();
   await page.getByRole("button",{name:"Сохранить ссылку"}).click();
   await page.waitForFunction(()=>document.querySelector("#social-list .admin-icon use")?.getAttribute("href")==="/assets/icons/cqrtv/ui/admin-icon-sprite.svg#chat");
   assert.equal(socialPayload?.iconAssetId,null,"switching an existing social link to a packaged icon must clear its prior uploaded asset");
   assert.equal(socialPayload?.iconKey,"chat");
   await page.screenshot({path:new URL("site-control-admin-desktop.png",dir).pathname,fullPage:true});
  }
  if(width===390){await page.locator("#menu").click();assert.equal(await page.locator("#shell").evaluate(element=>element.classList.contains("open")),true,"mobile Site Control menu should open");await page.locator('aside a[href="#social-form"]').click();assert.equal(await page.locator("#shell").evaluate(element=>element.classList.contains("open")),false,"selecting a real section should close the mobile menu");await page.screenshot({path:new URL("site-control-admin-mobile.png",dir).pathname,fullPage:true});}
  await context.close();
 }
 console.log("PASS site control desktop/mobile, modal keyboard flow, maintenance mode, admin preview, spoofed-header denial, expired-session recovery and packaged-icon replacement.");

}finally{await browser.close()}
