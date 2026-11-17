import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const playwrightRoot = process.env.PLAYWRIGHT_PACKAGE;
if (!playwrightRoot) throw new Error("PLAYWRIGHT_PACKAGE must point to the pinned Playwright install.");
const { chromium } = await import(pathToFileURL(`${playwrightRoot}/index.mjs`).href);
const baseUrl = process.env.CQRTV_QA_BASE_URL || "http://playcqrtv.com:8765";
const base = new URL(baseUrl);
if (base.protocol !== "http:" || !base.port || base.port !== "8765") {
  throw new Error("i18n browser QA is restricted to the isolated HTTP preview port 8765.");
}
const artifactDir = new URL("../qa-artifacts/", import.meta.url);
await mkdir(artifactDir, { recursive: true });
const routes = ["/","/profile.html","/auth.html","/rules.html","/privacy.html","/site-closed.html","/admin-login.html","/admin.html","/site-control-admin.html"];
const locales = ["ru","en","ro"];
const browser = await chromium.launch({headless:true,args:["--host-resolver-rules=MAP playcqrtv.com 127.0.0.1"]});
const failures=[];
async function installSyntheticAdminFixture(page) {
  const requests=[];
  await page.route("**/api/admin/**", async route => {
    const url=new URL(route.request().url());
    requests.push(url.pathname);
    let body={};
    if(url.pathname==="/api/admin/me") body={csrfToken:"qa-csrf",user:{emailMasked:"admin@example.test",nickname:"CQRTV QA"}};
    else if(url.pathname==="/api/admin/stats") body={total_users:0,verified_users:0,suspended_users:0};
    else if(url.pathname==="/api/admin/users") body={users:[],pagination:{total:0,limit:20,offset:0}};
    else if(url.pathname==="/api/admin/audit") body={events:[],pagination:{total:0,limit:20,offset:0}};
    else if(url.pathname==="/api/admin/site-control") body={settings:{mode:"open",heading:"",subtitle:"",description:"",statusLabel:"",maintenanceHeading:"",maintenanceSubtitle:"",maintenanceDescription:"",maintenanceStatusLabel:"",aboutButtonLabel:"",aboutTitle:"",aboutBody:"",launchAt:null,countdownEnabled:false,animationEnabled:false,backgroundAssetId:null},socialLinks:[]};
    await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
  });
  return requests;
}
async function check(page,route,locale,width,height,screenshot=false) {
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  const adminRequests=(route==="/admin.html"||route==="/site-control-admin.html")?await installSyntheticAdminFixture(page):null;
  await page.setViewportSize({width,height});
  await page.goto(new URL(route,base).href,{waitUntil:"domcontentloaded",timeout:30000});
  const selector=page.locator("[data-cqrtv-language-switcher] select");
  if(adminRequests)assert.ok(adminRequests.some(path=>path==="/api/admin/me"),`synthetic authorized fixture must protect and load ${route}`);
  await selector.waitFor({state:"visible",timeout:8000});
  await selector.selectOption(locale);
  await page.waitForFunction(expected=>document.documentElement.lang===expected,locale);
  await page.waitForTimeout(60);
  const state=await page.evaluate(()=>({title:document.title,scrollWidth:document.documentElement.scrollWidth,width:innerWidth}));
  assert.ok(state.title,`localized title missing on ${route}`);
  assert.ok(state.scrollWidth<=state.width+1,`horizontal overflow at ${width}px on ${route}: ${state.scrollWidth}`);
  if(locale!=="ru")assert.ok(!/[\u0400-\u04ff]/.test(state.title),`title remains Russian: ${state.title}`);
  assert.deepEqual(errors,[],`browser errors on ${route}: ${errors.join("; ")}`);
  if(route==="/admin.html"||route==="/site-control-admin.html")assert.ok(adminRequests.length>0,`synthetic authorized fixture was not used for ${route}`);
  if(screenshot)await page.screenshot({path:new URL(`i18n-${route.replaceAll("/","")||"home"}-${locale}-390.png`,artifactDir).pathname,fullPage:true});
  return true;
}
try {
  for(const locale of locales){
    const context=await browser.newContext({locale:locale==="ru"?"ru-RU":locale==="ro"?"ro-RO":"en-US",viewport:{width:1440,height:1000}});
    const page=await context.newPage();
    for(const route of routes)try{await check(page,route,locale,1440,1000)}catch(error){failures.push(`${route} ${locale} desktop: ${error.message}`)}
    for(const route of ["/","/auth.html","/site-closed.html"])for(const width of [390,320])try{await check(page,route,locale,width,844,width===390)}catch(error){failures.push(`${route} ${locale} ${width}px: ${error.message}`)}
    await context.close();
  }
  for(const locale of locales){
    const context=await browser.newContext({locale:"fr-FR",viewport:{width:390,height:844}});
    const page=await context.newPage();
    await page.goto(new URL("/auth.html",base).href,{waitUntil:"domcontentloaded"});
    await page.waitForSelector("[data-cqrtv-language-switcher] select");
    const defaultLocale=await page.evaluate(()=>document.documentElement.lang);
    assert.equal(defaultLocale,"ru","unsupported browser locales fall back to Russian");
    await page.evaluate(value=>localStorage.setItem("cqrtv.locale",value),"ro");
    await page.reload({waitUntil:"domcontentloaded"});
    await page.waitForFunction(()=>document.documentElement.lang==="ro");
    await page.route("**/api/auth/verify",route=>route.abort("failed"));
    await page.goto(new URL("/auth.html?mode=verify&token=cqrtv-invalid-qa&lang=en",base).href,{waitUntil:"domcontentloaded"});
    await page.waitForFunction(()=>document.querySelector("#verify-error-message")?.textContent?.length>0,{timeout:10000});
    const verifyState=await page.evaluate(()=>({lang:document.documentElement.lang,text:document.querySelector("#verify-error-message")?.textContent||""}));
    assert.equal(verifyState.lang,"en","auth link locale overrides prior preference");
    assert.ok(verifyState.text&&!/[\u0400-\u04ff]/.test(verifyState.text),"network error is visible and localized");
    await context.close();
  }
} finally { await browser.close(); }
if(failures.length)throw new Error(failures.join("\n"));
console.log("CQRTV i18n browser QA passed for RU/EN/RO, responsive public pages, locale persistence, and verification network errors.");
