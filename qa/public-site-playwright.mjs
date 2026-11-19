import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const playwrightRoot=process.env.PLAYWRIGHT_PACKAGE;
if(!playwrightRoot)throw new Error("PLAYWRIGHT_PACKAGE must point to the pinned Playwright install.");
const {chromium}=await import(pathToFileURL(`${playwrightRoot}/index.mjs`).href);
const baseUrl=process.env.CQRTV_QA_BASE_URL||"http://playcqrtv.com:8765";
const screenshotDir=fileURLToPath(new URL("../qa-artifacts/",import.meta.url));
await mkdir(screenshotDir,{recursive:true});
const widths=[1440,1024,760,390,375,320];
const browser=await chromium.launch({headless:true,args:["--host-resolver-rules=MAP playcqrtv.com 127.0.0.1"]});
const player={nickname:"ClutchAce",country:"MD",primary_role:"awper",secondary_roles:["rifler"],nickname_available_at:null};
try{
  const beforeBaseUrl=process.env.CQRTV_QA_BEFORE_URL;
  if(!beforeBaseUrl)throw new Error("CQRTV_QA_BEFORE_URL must point to an isolated baseline built from the PR base.");
  for(const width of [1440,390]){
    const context=await browser.newContext({locale:"ru-RU",viewport:{width,height:900},deviceScaleFactor:1});
    await context.route("**/api/**",async route=>{
      const body=route.request().url().endsWith("/api/auth/me")?{user:null}:{};
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
    });
    await context.addInitScript(()=>localStorage.setItem("cqrtv.locale","ru"));
const page=await context.newPage();
    const response=await page.goto(beforeBaseUrl,{waitUntil:"domcontentloaded"});
    assert.equal(response?.status(),200,`baseline homepage should load at ${width}px`);
    assert.match(await page.title(),/CQRTV/);
    await page.waitForTimeout(300);
    await page.screenshot({path:path.join(screenshotDir,`home-v31-before-${width}.png`),fullPage:true});
    await context.close();
    console.log(`PASS baseline homepage screenshot at ${width}px`);
  }
  for(const width of widths){
    const context=await browser.newContext({locale:"ru-RU",viewport:{width,height:900},deviceScaleFactor:1});
    let user=null,registerPosts=0,logoutPosts=0,meCalls=0;
    await context.route("**/api/auth/me",async route=>{meCalls++;await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({user})})});
    await context.route("**/api/auth/register",async route=>{registerPosts++;await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"registration unavailable in QA"})})});
    await context.route("**/api/auth/logout",async route=>{logoutPosts++;user=null;await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({message:"Вы вышли."})})});
    await context.route("**/api/account/nickname",async route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({nickname:"ClutchAce"})}));
    await context.addInitScript(()=>localStorage.setItem("cqrtv.locale","ru"));
const page=await context.newPage();
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    const response=await page.goto(baseUrl,{waitUntil:"domcontentloaded"});
    assert.equal(response?.status(),200,`public home should load at ${width}px`);
    assert.match(await page.title(),/CQRTV/);
    assert.equal((await page.locator("#home-title").innerText()).replace(/\\s+/g," ").trim(),"ТВОЯ ИГРА. ТВОЙ РЕЙТИНГ.");
    await page.locator(".home-hero").waitFor({state:"visible"});
    assert.equal(await page.locator(".home-feature").count(),4);
    assert.equal(await page.locator(".home-metric").count(),4);
    assert.deepEqual(await page.locator(".home-metric strong").allTextContents(),["—","—","—","—"],"unverified platform figures must remain placeholders");
    assert.equal(await page.locator(".home-roadmap-list li").count(),4);
    assert.equal(await page.locator(".home-platform-status .status-development").textContent(),"В разработке");
    assert.equal(await page.locator(".home-feature .status-soon").count(),4);
    assert.equal(await page.locator(".home-hero-actions a[href=\"#features\"]").count(),1);
    assert.equal(await page.locator(".home-hero-art img").evaluate(image=>image.complete&&image.naturalWidth>0),true,"approved local hero art should load");
    assert.equal(await page.locator("#guest-actions").isVisible(),true);
    assert.equal(await page.locator("#player-profile").isVisible(),false);
    assert.equal(await page.locator("#auth-user-menu").isVisible(),false);
    assert.equal(await page.locator("#login-link").getAttribute("href"),"/auth.html");
    assert.equal(await page.locator('.home-hero-actions a[href="/profile.html"]').count(),1);
    for(const href of ["/rules.html","/privacy.html"])assert.equal(await page.locator(`footer.home-footer a[href="${href}"]`).count(),1,`footer should keep ${href}`);
    assert.equal(await page.locator(".site-rail").count(),1,"the desktop navigation rail should be available");
    assert.equal(await page.locator(".site-rightbar,.mobile-bottom-nav,.home-dashboard-grid").count(),0,"the new homepage must not introduce mock dashboard chrome");
    assert.equal(await page.locator(".site-nav-unavailable").count(),2,"unimplemented settings must be truthfully marked in the rail and mobile nav");
    for(const href of ["#home","#play","#leaderboard","#tournaments","#teams","#community","#features"])
      assert.equal(await page.locator(`[id="${href.slice(1)}"]`).count(),1,`in-page destination ${href} should resolve`);
    for(const forbidden of ["CQRTV Open #1","1 246","игроков онлайн","матчей сегодня","Начать играть через Steam","Смотреть трейлер"])
      assert.equal(await page.getByText(forbidden,{exact:false}).count(),0,`homepage must not promise ${forbidden}`);
    const iconCount=await page.locator(".pack-icon").count();
    assert.ok(iconCount>=10,"homepage should reuse the CQRTV SVG icon pack");
    const icons=await page.locator(".pack-icon").evaluateAll(nodes=>nodes.filter(node=>node.querySelector("svg")||node.querySelector("use")).length);
    assert.ok(icons>0,"CQRTV pack icons should load into the header and homepage");
    const overflow=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));
    assert.ok(overflow.scrollWidth<=overflow.clientWidth,`horizontal overflow at ${width}px: ${JSON.stringify(overflow)}`);
    if(width>1024){
      assert.equal(await page.locator(".site-topbar .site-nav").isVisible(),true);
      assert.equal(await page.locator("#mobile-menu-toggle").isVisible(),false);
    }else{
      assert.equal(await page.locator("#mobile-menu-toggle").isVisible(),true);
      if(width<=760)assert.equal(await page.locator(".site-rail").isVisible(),false,"tablet and phone navigation should use the accessible menu");
      else assert.equal(await page.locator(".site-rail").isVisible(),true,"tablet layout retains the side rail");
      await page.locator("#mobile-menu-toggle").focus();
      await page.keyboard.press("Enter");
      assert.equal(await page.locator("#mobile-navigation").isVisible(),true);
      assert.equal(await page.locator("#mobile-menu-toggle").getAttribute("aria-expanded"),"true");
      await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(()=>document.activeElement?.id),"mobile-menu-toggle","Escape should restore focus to the mobile menu button");
      assert.equal(await page.locator("#mobile-navigation").isVisible(),false);
      assert.equal(await page.locator("#mobile-menu-toggle").getAttribute("aria-expanded"),"false");
    }
    if(width===390){
      for(const height of [667,1024]){
        await page.setViewportSize({width,height});
        const heightOverflow=await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth);
        assert.equal(heightOverflow,true,`no horizontal overflow at 390x${height}`);
      }
      await page.setViewportSize({width,height:900});
      await page.evaluate(()=>{document.documentElement.style.zoom="2"});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true,"page should not overflow at simulated 200% zoom");
      await page.evaluate(()=>{document.documentElement.style.zoom=""});
      await page.emulateMedia({reducedMotion:"reduce"});
      assert.equal(await page.evaluate(()=>matchMedia("(prefers-reduced-motion: reduce)").matches),true);
      assert.equal(await page.locator(".home-feature").first().evaluate(element=>getComputedStyle(element).transitionDuration.split(",").every(value=>parseFloat(value)===0)),true,"reduced-motion should disable feature transitions");
      await page.emulateMedia({reducedMotion:"no-preference"});
      await page.locator("#hero-signup").click();
      assert.equal(await page.locator("#signup-dialog").evaluate(dialog=>dialog.open),true,"homepage signup should open the existing registration dialog");
      await page.locator("#signup-close").click();
      assert.equal(registerPosts,0,"opening signup should not submit to the registration API");
    }
    await page.screenshot({path:path.join(screenshotDir,`home-v31-guest-${width}.png`),fullPage:true});
    assert.ok(meCalls>=1,"existing session endpoint should still initialize the header");
    if([1440,390].includes(width)){
      user=player;
      await page.reload({waitUntil:"domcontentloaded"});
      await page.locator("#player-profile:not([hidden])").waitFor({state:"visible"});
      assert.equal(await page.locator("#profile-nickname").textContent(),"ClutchAce");
      assert.equal(await page.locator("#profile-country-flag").textContent(),"🇲🇩");
      assert.equal(await page.locator("#profile-role").textContent(),"AWPer");
      assert.equal(await page.locator("#profile-secondary-roles").textContent(),"Rifler");
      assert.equal(await page.locator("#profile-email-verified").isVisible(),true);
      assert.equal(await page.locator("#guest-actions").isVisible(),false);
      assert.equal(await page.locator("#member-actions").isVisible(),true);
      assert.equal(await page.locator("#mobile-menu-profile-link").getAttribute("href"),"/profile.html");
      assert.equal(await page.locator("#auth-user-menu .avatar").getAttribute("href"),"/profile.html");
      assert.equal(await page.locator("#player-profile").locator("#profile-edit-btn").isVisible(),true);
      assert.equal(await page.locator("#player-profile").locator("text=ELO").count(),0,"large dashboard profile metrics should not return to the homepage");
      await page.screenshot({path:path.join(screenshotDir,`home-v31-player-${width}.png`),fullPage:true});
      if(width===390){
        await page.locator("#logout-btn").click();
        assert.equal(logoutPosts,1);
        await page.locator("#guest-actions").waitFor({state:"visible"});
        assert.equal(await page.locator("#player-profile").isVisible(),false,"logout must clear private account data");
      }
    }
    assert.deepEqual(errors,[],`uncaught browser errors at ${width}px: ${errors.join("; ")}`);
    await context.close();
    console.log(`PASS approved homepage at ${width}px`);
  }
  const offlineContext=await browser.newContext({locale:"ru-RU",viewport:{width:390,height:844}});
  await offlineContext.setExtraHTTPHeaders({"X-QA-Site-Mode":"coming_soon"});
  await offlineContext.addInitScript(()=>localStorage.setItem("cqrtv.locale","ru"));
  const offline=await offlineContext.newPage();
  const offlineResponse=await offline.goto(baseUrl,{waitUntil:"domcontentloaded"});
  assert.equal(offlineResponse?.status(),200);
  assert.equal(await offline.locator("#player-profile").count(),0,"offline gate must not expose the player profile");
  const adminLink=offline.getByRole("link",{name:"Вход для администратора"});
  assert.equal(await adminLink.count(),1);
  assert.equal(new URL(await adminLink.getAttribute("href"),baseUrl).pathname,"/admin/login");
  await offline.screenshot({path:path.join(screenshotDir,"home-v31-offline.png"),fullPage:true});
  await offline.close();
}finally{
  await browser.close();
}

await import("./i18n-playwright.mjs");
