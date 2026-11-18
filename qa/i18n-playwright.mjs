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
async function installSyntheticAuthFixture(page) {
  const requests=[];
  await page.route("**/api/auth/**",async route=>{
    const url=new URL(route.request().url());
    requests.push({path:url.pathname,method:route.request().method()});
    let status=200,body={message:"Запрос завершён."};
    if(url.pathname==="/api/auth/login"){status=401;body={error:"Неверный email или пароль."};}
    else if(url.pathname==="/api/auth/forgot"){body={message:"Если подтверждённый аккаунт с таким email существует, мы отправили письмо."};}
    else if(url.pathname==="/api/auth/reset"){status=400;body={error:"Ссылка недействительна или устарела."};}
    else if(url.pathname==="/api/auth/verify"){
      const payload=route.request().postDataJSON();
      if(payload?.token?.startsWith("qa-success-token"))body={message:"Email подтверждён. Теперь можно войти."};
      else {status=400;body={error:"Ссылка недействительна или устарела."};}
    } else {status=404;body={error:"Not found"};}
    await route.fulfill({status,contentType:"application/json",body:JSON.stringify(body)});
  });
  return requests;
}
async function check(page,route,locale,width,height,screenshot=false,statusMode=null) {
  await page.unroute("**/api/admin/**");
  await page.unroute("**/api/site-control/public");
  if(route==="/site-closed.html"){
    const mode=statusMode||"coming_soon";
    const status={statusLabel:"QA COMING SOON STATUS",heading:"CQRTV coming soon",subtitle:"QA coming soon subtitle",description:"QA coming soon description",maintenanceStatusLabel:"QA MAINTENANCE STATUS",maintenanceHeading:"CQRTV maintenance",maintenanceSubtitle:"QA maintenance subtitle",maintenanceDescription:"QA maintenance description"};
    await page.route("**/api/site-control/public",route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({mode,...status,aboutButtonLabel:"About CQRTV",aboutTitle:"About CQRTV",aboutBody:"Play. Unite. Grow.",launchAt:null,countdownEnabled:false,animationEnabled:false,socialLinks:[]})}));
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
    const i18nRuntime=await readFile(new URL("../assets/i18n.mjs",import.meta.url),"utf8");
    await page.route("**/assets/i18n.mjs",request=>request.fulfill({status:200,contentType:"text/javascript; charset=utf-8",body:i18nRuntime}));
    const adminIcons=await readFile(new URL("../assets/admin/admin-icons.mjs",import.meta.url),"utf8");
    await page.route("**/assets/admin/admin-icons.mjs",request=>request.fulfill({status:200,contentType:"text/javascript; charset=utf-8",body:adminIcons}));
    await page.route(`**${route}`,request=>request.fulfill({status:200,contentType:"text/html; charset=utf-8",body}));
  }
  await page.goto(new URL(route,base).href,{waitUntil:"domcontentloaded",timeout:30000});
  if(adminReady)await adminReady;
  const switcher=page.locator("[data-cqrtv-language-switcher]");
  const trigger=switcher.locator(".cqrtv-language-trigger");
  if(adminRequests)assert.ok(adminRequests.some(path=>path==="/api/admin/me"),`synthetic authorized fixture must protect and load ${route}`);
  try{await selector.waitFor({state:"visible",timeout:8000});}catch(error){const state=await page.evaluate(()=>({url:location.href,title:document.title,lang:document.documentElement.lang,hasRuntime:!!window.CQRTVI18n,scriptUrls:[...document.scripts].map(script=>script.src)}));throw new Error(`${error.message}; locale fixture diagnostics: ${JSON.stringify(state)}; page errors: ${errors.join("; ")}`)}
  for(const nextLocale of [...locales,locale]){
    await trigger.click();
    await switcher.locator(`[role="option"][data-locale="${nextLocale}"]`).click();
    await page.waitForFunction(expected=>document.documentElement.lang===expected,nextLocale);
    const activeLabel=await trigger.getAttribute("aria-label");
    assert.ok(activeLabel?.length>0,`accessible selected-language name missing for ${nextLocale}`);
  }
  await page.waitForTimeout(60);
  const state=await page.evaluate(()=>{
    const ignored='[data-i18n-ignore],.user-generated,.custom-announcement,.social-links,#header-user-nickname,#profile-nickname,.profile-header-nickname,.profile-nickname,.profile-about-list dd,#social-links a,.social-item strong,.social-item small';
    const texts=[];
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){const node=walker.currentNode;if(node.parentElement?.closest(`${ignored},script,style,noscript`))continue;const value=node.nodeValue?.trim();if(value)texts.push(value)}
    const attributes=[];
    for(const element of document.querySelectorAll('[placeholder],[title],[aria-label],[alt]')){if(element.closest(ignored))continue;for(const attr of ['placeholder','title','aria-label','alt']){const value=element.getAttribute(attr);if(value)attributes.push(value)}}
    return {title:document.title,description:document.querySelector('meta[name="description"]')?.content||null,statusText:document.querySelector('#status-text')?.textContent||null,scrollWidth:document.documentElement.scrollWidth,width:innerWidth,texts,attributes,locale:document.documentElement.lang,flag:document.querySelector(".cqrtv-language-current-flag svg")?.outerHTML||null,closedSwitcherText:document.querySelector("[data-cqrtv-language-switcher] .cqrtv-language-trigger")?.innerText||"",audit:window.CQRTVI18n.audit()};
  });
  assert.ok(state.title,`localized title missing on ${route}`);
  assert.ok(state.scrollWidth<=state.width+1,`horizontal overflow at ${width}px on ${route}: ${state.scrollWidth}`);
  assert.ok(state.flag?.includes(`viewBox="0 0 60 36"`),`current-language flag missing on ${route} ${locale}`);
  assert.equal(state.closedSwitcherText,"",`closed switcher must show flag only on ${route} ${locale}`);
  assert.deepEqual(state.audit,[],`unbound app-owned UI on ${route} ${locale}: ${JSON.stringify(state.audit)}`);
  await trigger.click();
  const choices=await switcher.locator('[role="option"]').evaluateAll(nodes=>nodes.map(node=>({locale:node.dataset.locale,name:node.innerText,flag:!!node.querySelector("svg")})));
  assert.deepEqual(choices.map(item=>item.locale),["ru","en","ro"],`all language choices are accessible on ${route}`);
  assert.ok(choices.every(item=>item.name.length>0&&item.flag),`every locale choice has a flag and native name on ${route}`);
  await switcher.locator('[role="option"][aria-selected="true"]').press("Escape");
  await trigger.click();
  await switcher.locator(`[role="option"][data-locale="${locale}"]`).click();
  if(route==="/site-closed.html")assert.equal(state.statusText,statusMode==="maintenance"?"QA MAINTENANCE STATUS":"QA COMING SOON STATUS",`status page should render requested ${statusMode} mode in ${locale}`);
  if(locale!=="ru"){
    assert.ok(!/[\u0400-\u04ff]/.test(state.title),`title remains Russian: ${state.title}`);
    if(state.description)assert.ok(!/[\u0400-\u04ff]/.test(state.description),`meta description remains Russian: ${state.description}`);
    const residual=[...state.texts,...state.attributes].filter(value=>/[\u0400-\u04ff]/.test(value));
    assert.deepEqual(residual,[],`unlocalized rendered text or attributes on ${route}: ${residual.join(" | ")}`);
  }
  if(route==="/"){
    await page.locator("#hero-signup").click();
    const signupDialog=page.locator("#signup-dialog");
    await signupDialog.waitFor({state:"visible",timeout:5000});
    const signupState=await page.evaluate(()=>{
      const audit=window.CQRTVI18n.audit();
      const form=document.querySelector("#signup-form");
      return {open:document.querySelector("#signup-dialog")?.open===true,valid:form?.checkValidity()??true,audit};
    });
    assert.equal(signupState.open,true,"registration dialog opens in the synthetic fixture");
    assert.equal(signupState.valid,false,"registration fields remain required before any submission");
    assert.deepEqual(signupState.audit,[],`registration dialog contains untranslated UI on ${locale}: ${JSON.stringify(signupState.audit)}`);
    await page.locator("#country-picker-button").click();
    await page.locator("#country-menu").waitFor({state:"visible",timeout:5000});
    await page.locator("#country-search").fill(locale==="ru"?"Румы":locale==="en"?"Roman":"Româ");
    const countryOptions=page.locator('#country-options [role="option"]');
    await countryOptions.first().waitFor({state:"visible",timeout:5000});
    assert.equal(await countryOptions.count(),1,"country search filters the synthetic list to RO");
    const countryName=await countryOptions.first().innerText();
    assert.equal(countryName,locale==="ru"?"Румыния":locale==="en"?"Romania":"România",`country picker language updates for ${locale}`);
    await page.locator("#country-picker-button").click();
    await page.locator("#signup-close").click();
    await signupDialog.waitFor({state:"hidden",timeout:5000});
  }
  if(route==="/auth.html"){
    const probe=await page.evaluate(async()=>{
      const host=document.createElement('div');host.hidden=true;
      const input=document.createElement('input');input.placeholder='Выбрать язык';host.append(input);document.body.append(host);
      window.CQRTVI18n.bind(host);
      input.setAttribute('data-i18n-placeholder','common.language.choose');
      await new Promise(resolve=>setTimeout(resolve,20));
      const first=input.placeholder;
      input.removeAttribute('data-i18n-placeholder');
      input.placeholder='Введите пароль';
      input.dataset.i18nPlaceholder='auth.password.placeholder';
      await new Promise(resolve=>setTimeout(resolve,20));
      const second=input.placeholder;
      let missing=null;const onMissing=event=>{missing=event.detail.key};window.addEventListener('cqrtv:i18nmissing',onMissing,{once:true});
      const interpolation=window.CQRTVI18n.t('С возвращением, {nickname}',{nickname:'QA_PLAYER'});
      const fallback=window.CQRTVI18n.t('qa.fixture.unknown',{},'Safe fallback');window.removeEventListener('cqrtv:i18nmissing',onMissing);
      return {first,second,interpolation,fallback,missing};
    });
    assert.equal(probe.first,locale==='ru'?'Выбрать язык':locale==='en'?'Choose language':'Alege limba',`dynamic attribute binding for ${locale}`);
    assert.equal(probe.second,locale==='ru'?'Введите пароль':locale==='en'?'Enter your password':'Introdu parola',`dynamic attribute rebinding for ${locale}`);
    assert.equal(probe.interpolation,locale==='ru'?'С возвращением, QA_PLAYER':locale==='en'?'Welcome back, QA_PLAYER':'Bine ai revenit, QA_PLAYER',`interpolation in ${locale}`);
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
    const dialog=page.locator('#modal [role="dialog"]');
    await dialog.waitFor({state:"visible",timeout:5000});
    const dialogText=await dialog.innerText();
    assert.ok(dialogText.length>0,"synthetic admin confirmation dialog is rendered");
    if(locale!=="ru")assert.ok(!/[\u0400-\u04ff]/.test(dialogText),`admin confirmation remains Russian in ${locale}: ${dialogText}`);
    await page.locator("#cancel").click();
    assert.ok(await page.locator("#modal").evaluate(element=>element.classList.contains("hidden")),"cancel closes the synthetic confirmation dialog without an API mutation");
  }
  if(screenshot)await page.screenshot({path:new URL(`i18n-${route.replaceAll("/","")||"home"}-${locale}-${statusMode||"default"}-${width}.png`,artifactDir).pathname,fullPage:true});
  return true;
}
try {
  for(const locale of locales){
    const context=await browser.newContext({locale:locale==="ru"?"ru-RU":locale==="ro"?"ro-RO":"en-US",viewport:{width:1440,height:1000}});
    const page=await context.newPage();
    for(const route of routes){
      const modes=route==="/site-closed.html"?["coming_soon","maintenance"]:[null];
      for(const mode of modes)try{await check(page,route,locale,1440,1000,true,mode)}catch(error){failures.push(`${route} ${locale} ${mode||""} desktop: ${error.message}`)}
    }
    for(const route of routes)for(const width of [390,320]){
      const modes=route==="/site-closed.html"?["coming_soon","maintenance"]:[null];
      for(const mode of modes)try{await check(page,route,locale,width,844,width===390,mode)}catch(error){failures.push(`${route} ${locale} ${mode||""} ${width}px: ${error.message}`)}
    }
    await context.close();
  }
  for(const locale of locales){
    const context=await browser.newContext({locale:locale==="ru"?"ru-RU":locale==="ro"?"ro-RO":"en-US",viewport:{width:390,height:844}});
    const page=await context.newPage();
    const errors=[];
    page.on("pageerror",error=>errors.push(error.message));
    const authRequests=await installSyntheticAuthFixture(page);
    const localeQuery=`?lang=${locale}`;
    await page.goto(new URL("/auth.html"+localeQuery,base).href,{waitUntil:"domcontentloaded"});
    await page.locator("#email-input").fill("qa@example.test");
    await page.locator("#password-input").fill("SyntheticPass123!");
    await page.locator("#submit").click();
    await page.waitForFunction(()=>document.querySelector("#status")?.textContent.trim().length>0);
    const loginError=await page.locator("#status").innerText();
    assert.equal(loginError,locale==="ru"?"Неверный email или пароль.":locale==="en"?"Incorrect email or password.":"E-mail sau parolă incorectă.",`synthetic login error is localized for ${locale}`);

    await page.goto(new URL(`/auth.html?mode=forgot&lang=${locale}`,base).href,{waitUntil:"domcontentloaded"});
    assert.equal(await page.locator("#passwordrow").isVisible(),false,"forgot mode hides the password field");
    await page.locator("#email-input").fill("qa@example.test");
    await page.locator("#submit").click();
    await page.waitForFunction(()=>document.querySelector("#status")?.textContent.trim().length>0);
    const forgotMessage=await page.locator("#status").innerText();
    assert.equal(forgotMessage,locale==="ru"?"Если подтверждённый аккаунт с таким email существует, мы отправили письмо.":locale==="en"?"If a verified account with that email exists, we’ve sent a message.":"Dacă există un cont confirmat cu această adresă de e-mail, am trimis un mesaj.",`synthetic recovery response is localized for ${locale}`);

    await page.goto(new URL(`/auth.html?mode=reset&token=qa-invalid-token&lang=${locale}`,base).href,{waitUntil:"domcontentloaded"});
    const newPassword=page.locator('[name="newPassword"]');
    await newPassword.fill("weakpassword123!");
    assert.equal(await newPassword.evaluate(input=>input.validity.customError),true,`weak reset password is rejected for ${locale}`);
    assert.ok((await newPassword.evaluate(input=>input.validationMessage)).length>0,`reset password error is exposed to the browser for ${locale}`);
    await newPassword.fill("SyntheticPass123!");
    await page.locator("#submit").click();
    await page.waitForFunction(()=>document.querySelector("#status")?.textContent.includes("Ссылка")||document.querySelector("#status")?.textContent.includes("link")||document.querySelector("#status")?.textContent.includes("Link"));
    const resetMessage=await page.locator("#status").innerText();
    assert.equal(resetMessage,locale==="ru"?"Ссылка недействительна или устарела.":locale==="en"?"This link is invalid or has expired.":"Acest link nu este valid sau a expirat.",`synthetic invalid reset token is localized for ${locale}`);

    await page.goto(new URL(`/auth.html?mode=verify&token=qa-success-token-12345678901234567890&lang=${locale}`,base).href,{waitUntil:"domcontentloaded"});
    await page.locator("#verify-success").waitFor({state:"visible",timeout:10000});
    const verifySuccess=await page.locator("#verify-success").innerText();
    if(locale!=="ru")assert.ok(!/[\u0400-\u04ff]/.test(verifySuccess),`verify success remains Russian in ${locale}: ${verifySuccess}`);
    await page.goto(new URL(`/auth.html?mode=verify&token=qa-invalid-token-1234567890123456&lang=${locale}`,base).href,{waitUntil:"domcontentloaded"});
    await page.locator("#verify-failure").waitFor({state:"visible",timeout:10000});
    const verifyFailure=await page.locator("#verify-error-message").innerText();
    assert.equal(verifyFailure,locale==="ru"?"Ссылка недействительна или устарела.":locale==="en"?"This link is invalid or has expired.":"Acest link este invalid sau a expirat.",`invalid verify token is localized for ${locale}`);
    assert.ok(authRequests.some(request=>request.path==="/api/auth/login")&&authRequests.some(request=>request.path==="/api/auth/forgot")&&authRequests.some(request=>request.path==="/api/auth/reset")&&authRequests.filter(request=>request.path==="/api/auth/verify").length===2,`synthetic auth fixture exercised every expected endpoint for ${locale}`);
    assert.deepEqual(errors,[],`auth flow browser errors for ${locale}: ${errors.join("; ")}`);
    await context.close();
  }
  for(const locale of locales){
    const context=await browser.newContext({locale:"fr-FR",viewport:{width:390,height:844}});
    const page=await context.newPage();
    await page.goto(new URL("/auth.html",base).href,{waitUntil:"domcontentloaded"});
    await page.waitForSelector("[data-cqrtv-language-switcher] .cqrtv-language-trigger");
    const defaultLocale=await page.evaluate(()=>document.documentElement.lang);
    assert.equal(defaultLocale,"ru","unsupported browser locales fall back to Russian");
    for(const next of ["en","ro","ru"]){
      const switcher=page.locator("[data-cqrtv-language-switcher]");
      await switcher.locator(".cqrtv-language-trigger").click();
      await switcher.locator(`[role="option"][data-locale="${next}"]`).click();
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
    const verifyState=await page.evaluate(()=>({lang:document.documentElement.lang,text:document.querySelector("#verify-error-message")?.textContent||"",switcher:!!document.querySelector("[data-cqrtv-language-switcher] .cqrtv-language-trigger")}));
    assert.equal(verifyState.lang,"en","auth link locale overrides prior preference");
    assert.ok(verifyState.text&&!/[\u0400-\u04ff]/.test(verifyState.text),"network error is visible and localized");
    assert.ok(verifyState.switcher,"language switcher remains available during API network error");
    await page.unroute("**/api/auth/verify");
    await page.route("**/api/site-control/public",route=>route.abort("failed"));
    await page.goto(new URL("/site-closed.html",base).href,{waitUntil:"domcontentloaded"});
    const closedSwitcher=page.locator("[data-cqrtv-language-switcher] .cqrtv-language-trigger");
    await closedSwitcher.waitFor({state:"visible",timeout:8000});
    await closedSwitcher.click();
    await page.locator('[data-cqrtv-language-switcher] [role="option"][data-locale="ro"]').click();
    await page.waitForFunction(()=>document.documentElement.lang==="ro");
    assert.ok(await closedSwitcher.isVisible(),"language switcher remains available when status API is offline");
    await context.close();
  }
} finally { await browser.close(); }
if(failures.length)throw new Error(failures.join("\n"));
console.log("CQRTV i18n browser QA passed for RU/EN/RO, responsive public pages, locale persistence, and verification network errors.");
