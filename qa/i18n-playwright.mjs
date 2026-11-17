import assert from "node:assert/strict";
import { mkdir, readFile, readdir } from "node:fs/promises";
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
const routes=(await readdir(new URL("../",import.meta.url),{withFileTypes:true})).filter(entry=>entry.isFile()&&entry.name.endsWith(".html")).map(entry=>entry.name==="index.html"?"/":`/${entry.name}`).sort();
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
    else if(url.pathname==="/api/admin/users") body={users:[{id:41,nickname:"QA_PLAYER",email:"qa@example.test",country:"RO",primary_role:"rifler",secondary_roles:[],created_at:"2026-11-17T12:00:00.000Z",email_verified:true,account_status:"active"}],pagination:{total:1,limit:20,offset:0}};
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
  if(adminRequests)await page.context().addCookies([{name:"cqrtv_qa_admin",value:"valid",domain:base.hostname,path:"/",httpOnly:true,sameSite:"Lax"}]);
  const adminReady=adminRequests?page.waitForResponse(response=>new URL(response.url()).pathname==="/api/admin/me",{timeout:10000}):null;
  await page.setViewportSize({width,height});
  if(adminRequests){
    // Serve checkout HTML only for this isolated visual fixture; Caddy forward-auth is covered by the dedicated admin security suite.
    const filename=route==="/admin.html"?"admin.html":"site-control-admin.html";
    const body=await readFile(new URL(`../${filename}`,import.meta.url),"utf8");
    await page.route(`**${route}`,request=>request.fulfill({status:200,contentType:"text/html; charset=utf-8",body}));
  }
  await page.goto(new URL(route,base).href,{waitUntil:"domcontentloaded",timeout:30000});
  if(adminReady)await adminReady;
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
    while(walker.nextNode()){const node=walker.currentNode;if(node.parentElement?.closest(`${ignored},script,style,noscript`))continue;const value=node.nodeValue?.trim();if(value)texts.push(value)}
    const attributes=[];
    for(const element of document.querySelectorAll('[placeholder],[title],[aria-label],[alt]')){if(element.closest(ignored))continue;for(const attr of ['placeholder','title','aria-label','alt']){const value=element.getAttribute(attr);if(value)attributes.push(value)}}
    return {title:document.title,description:document.querySelector('meta[name="description"]')?.content||null,scrollWidth:document.documentElement.scrollWidth,width:innerWidth,texts,attributes};
  });
  assert.ok(state.title,`localized title missing on ${route}`);
  assert.ok(state.scrollWidth<=state.width+1,`horizontal overflow at ${width}px on ${route}: ${state.scrollWidth}`);
  if(locale!=="ru"){
    assert.ok(!/[\u0400-\u04ff]/.test(state.title),`title remains Russian: ${state.title}`);
    if(state.description)assert.ok(!/[\u0400-\u04ff]/.test(state.description),`meta description remains Russian: ${state.description}`);
    const residual=[...state.texts,...state.attributes].filter(value=>/[\u0400-\u04ff]/.test(value));
    assert.deepEqual(residual,[],`unlocalized rendered text or attributes on ${route}: ${residual.join(" | ")}`);
  }
  if(route==="/auth.html"){
    const probe=await page.evaluate(()=>{
      const host=document.createElement('div');host.hidden=true;
      const label=document.createElement('span');label.dataset.i18n='common.language.label';label.dataset.i18nFallback='Язык';
      const input=document.createElement('input');input.dataset.i18nPlaceholder='common.language.choose';input.placeholder='Выбрать язык';
      const button=document.createElement('button');button.dataset.i18nTitle='common.language.choose';button.title='Выбрать язык';
      const image=document.createElement('img');image.dataset.i18nAlt='common.language.choose';image.alt='Выбрать язык';
      host.append(label,input,button,image);document.body.append(host);window.CQRTVI18n.bind(host);
      const first={label:label.textContent,placeholder:input.placeholder,title:button.title,alt:image.alt};
      label.textContent='Язык';input.placeholder='Выбрать язык';button.title='Выбрать язык';image.alt='Выбрать язык';window.CQRTVI18n.bind(host);
      let missing=null;const onMissing=event=>{missing=event.detail.key};window.addEventListener('cqrtv:i18nmissing',onMissing,{once:true});
      const fallback=window.CQRTVI18n.t('qa.fixture.unknown',{},'Safe fallback');window.removeEventListener('cqrtv:i18nmissing',onMissing);
      return {first,repeat:{label:label.textContent,placeholder:input.placeholder,title:button.title,alt:image.alt},fallback,missing};
    });
    const expected=locale==='ru'?{label:'Язык',placeholder:'Выбрать язык',title:'Выбрать язык',alt:'Выбрать язык'}:locale==='en'?{label:'Language',placeholder:'Choose language',title:'Choose language',alt:'Choose language'}:{label:'Limbă',placeholder:'Alege limba',title:'Alege limba',alt:'Alege limba'};
    assert.deepEqual(probe.first,expected,`semantic dynamic binding for ${locale}`);
    assert.deepEqual(probe.repeat,expected,`repeated dynamic binding for ${locale}`);
    assert.equal(probe.fallback,'Safe fallback');
    assert.equal(probe.missing,'qa.fixture.unknown',`missing translation must be observable for ${locale}`);
  }
  assert.deepEqual(errors,[],`browser errors on ${route}: ${errors.join("; ")}`);
  if(route==="/admin.html"||route==="/site-control-admin.html")assert.ok(adminRequests.length>0,`synthetic authorized fixture was not used for ${route}`);
  if(route==="/admin.html"&&width>=720){
    await page.locator('[data-view="users"]').first().click();
    const action=page.locator('#users button[data-action="suspend"]').first();
    await action.waitFor({state:"visible",timeout:8000});
    await action.click();
    const dialog=page.locator('#modal[role="dialog"]');
    await dialog.waitFor({state:"visible",timeout:5000});
    const dialogText=await dialog.innerText();
    assert.ok(dialogText.length>0,"synthetic admin confirmation dialog is rendered");
    if(locale!=="ru")assert.ok(!/[\u0400-\u04ff]/.test(dialogText),`admin confirmation remains Russian in ${locale}: ${dialogText}`);
    await page.locator("#cancel").click();
    assert.ok(await page.locator("#modal").evaluate(element=>element.classList.contains("hidden")),"cancel closes the synthetic confirmation dialog without an API mutation");
  }
  if(screenshot)await page.screenshot({path:new URL(`i18n-${route.replaceAll("/","")||"home"}-${locale}-${width}.png`,artifactDir).pathname,fullPage:true});
  return true;
}
try {
  for(const locale of locales){
    const context=await browser.newContext({locale:locale==="ru"?"ru-RU":locale==="ro"?"ro-RO":"en-US",viewport:{width:1440,height:1000}});
    const page=await context.newPage();
    for(const route of routes)try{await check(page,route,locale,1440,1000,true)}catch(error){failures.push(`${route} ${locale} desktop: ${error.message}`)}
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
    assert.ok(verifyState.text&&!/[\u0400-\u04ff]/.test(verifyState.text),"network error is visible and localized");
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
