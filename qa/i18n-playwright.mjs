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
  await page.unroute("**/api/admin/**");
  await page.unroute("**/api/site-control/public");
  if(route==="/site-closed.html"){
    const mode=locale==="ro"?"maintenance":"coming_soon";
    const status=mode==="maintenance"?{statusLabel:"ТЕХНИЧЕСКИЕ РАБОТЫ",heading:"CQRTV на техобслуживании",subtitle:"Мы настраиваем платформу и скоро вернёмся.",description:"Проводятся технические работы",maintenanceStatusLabel:"ТЕХНИЧЕСКИЕ РАБОТЫ",maintenanceHeading:"CQRTV на техобслуживании",maintenanceSubtitle:"Мы настраиваем платформу и скоро вернёмся.",maintenanceDescription:"Проводятся технические работы"}:{statusLabel:"ПЛАТФОРМА ГОТОВИТСЯ",heading:"CQRTV скоро откроется",subtitle:"Следите за анонсами",description:"Мы готовим пространство для игроков и команд: подбор матчей, турниры, статистика и развитие esports-сцены.",maintenanceStatusLabel:"ТЕХНИЧЕСКИЕ РАБОТЫ",maintenanceHeading:"CQRTV на техобслуживании",maintenanceSubtitle:"Мы настраиваем платформу и скоро вернёмся.",maintenanceDescription:"Проводятся технические работы"};
    await page.route("**/api/site-control/public",route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({mode,...status,aboutButtonLabel:"Что такое CQRTV?",aboutTitle:"Что такое CQRTV?",aboutBody:"Играй. Объединяйся. Развивайся.",launchAt:null,countdownEnabled:false,animationEnabled:false,socialLinks:[]})}));
  }
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
  const state=await page.evaluate(()=>{
    const ignored='[data-i18n-ignore],.user-generated,.custom-announcement,.social-links,#header-user-nickname,#profile-nickname,.profile-header-nickname,.profile-nickname,.profile-about-list dd,#social-links a,.social-item strong,.social-item small';
    const texts=[];
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){const node=walker.currentNode;if(node.parentElement?.closest(ignored))continue;const value=node.nodeValue?.trim();if(value)texts.push(value)}
    const attributes=[];
    for(const element of document.querySelectorAll('[placeholder],[title],[aria-label],[alt]')){if(element.closest(ignored))continue;for(const attr of ['placeholder','title','aria-label','alt']){const value=element.getAttribute(attr);if(value)attributes.push(value)}}
    return {title:document.title,scrollWidth:document.documentElement.scrollWidth,width:innerWidth,texts,attributes};
  });
  assert.ok(state.title,`localized title missing on ${route}`);
  assert.ok(state.scrollWidth<=state.width+1,`horizontal overflow at ${width}px on ${route}: ${state.scrollWidth}`);
  if(locale!=="ru"){
    assert.ok(!/[\u0400-\u04ff]/.test(state.title),`title remains Russian: ${state.title}`);
    const residual=[...state.texts,...state.attributes].filter(value=>/[\\u0400-\\u04ff]/.test(value));
    assert.deepEqual(residual,[],`unlocalized rendered text or attributes on ${route}: ${residual.join(" | ")}`);
  }
  if(route==="/auth.html"){
    const probe=await page.evaluate(()=>{
      const host=document.createElement('div');host.hidden=true;
      const label=document.createElement('span');label.dataset.i18n='common.language.label';label.dataset.i18nFallback='Язык';
      const input=document.createElement('input');input.dataset.i18nPlaceholder='common.language.choose';input.placeholder='Выбрать язык';
      host.append(label,input);document.body.append(host);window.CQRTVI18n.bind(host);
      const first={label:label.textContent,placeholder:input.placeholder};
      label.textContent='Язык';input.placeholder='Выбрать язык';window.CQRTVI18n.bind(host);
      return {first,repeat:{label:label.textContent,placeholder:input.placeholder}};
    });
    const expected=locale==='ru'?{label:'Язык',placeholder:'Выбрать язык'}:locale==='en'?{label:'Language',placeholder:'Choose language'}:{label:'Limbă',placeholder:'Alege limba'};
    assert.deepEqual(probe.first,expected,`semantic dynamic binding for ${locale}`);
    assert.deepEqual(probe.repeat,expected,`repeated dynamic binding for ${locale}`);
  }
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
    for(const route of routes)for(const width of [390,320])try{await check(page,route,locale,width,844,width===390)}catch(error){failures.push(`${route} ${locale} ${width}px: ${error.message}`)}
    await context.close();
  }
  for(const locale of locales){
    const context=await browser.newContext({locale:"fr-FR",viewport:{width:390,height:844}});
    const page=await context.newPage();
    await page.goto(new URL("/auth.html",base).href,{waitUntil:"domcontentloaded"});
    await page.waitForSelector("[data-cqrtv-language-switcher] select");
    const defaultLocale=await page.evaluate(()=>document.documentElement.lang);
    assert.equal(defaultLocale,"ru","unsupported browser locales fall back to Russian");
    for(const next of ["en","ro","ru"]){
      await page.locator("[data-cqrtv-language-switcher] select").selectOption(next);
      await page.waitForFunction(expected=>document.documentElement.lang===expected,next);
      assert.equal(await page.evaluate(()=>localStorage.getItem("cqrtv.locale")),next,"active language choice persists");
    }
    await page.goto(new URL("/rules.html",base).href,{waitUntil:"domcontentloaded"});
    await page.waitForFunction(()=>document.documentElement.lang==="ru");
    await page.reload({waitUntil:"domcontentloaded"});
    await page.waitForFunction(()=>document.documentElement.lang==="ru");
    await page.route("**/api/auth/verify",route=>route.abort("failed"));
    await page.goto(new URL("/auth.html?mode=verify&token=cqrtv-invalid-qa&lang=en",base).href,{waitUntil:"domcontentloaded"});
    await page.waitForFunction(()=>{const failure=document.querySelector("#verify-failure"),message=document.querySelector("#verify-error-message")?.textContent||"";return failure&&!failure.hidden&&message&&message!=="Ссылка недействительна или устарела."},{timeout:10000});
    const verifyState=await page.evaluate(()=>({lang:document.documentElement.lang,text:document.querySelector("#verify-error-message")?.textContent||"",switcher:!!document.querySelector("[data-cqrtv-language-switcher] select")}));
    assert.equal(verifyState.lang,"en","auth link locale overrides prior preference");
    assert.ok(verifyState.text&&!/[\\u0400-\\u04ff]/.test(verifyState.text),"network error is visible and localized");
    assert.ok(verifyState.switcher,"language switcher remains available during API network error");
    await page.unroute("**/api/auth/verify");
    await page.route("**/api/site-control/public",route=>route.abort("failed"));
    await page.goto(new URL("/site-closed.html",base).href,{waitUntil:"domcontentloaded"});
    const closedSwitcher=page.locator("[data-cqrtv-language-switcher] select");
    await closedSwitcher.waitFor({state:"visible",timeout:8000});
    await closedSwitcher.selectOption("ro");
    await page.waitForFunction(()=>document.documentElement.lang==="ro");
    assert.ok(await closedSwitcher.isVisible(),"language switcher remains available when status API is offline");
    await context.close();
  }
} finally { await browser.close(); }
if(failures.length)throw new Error(failures.join("\n"));
console.log("CQRTV i18n browser QA passed for RU/EN/RO, responsive public pages, locale persistence, and verification network errors.");
