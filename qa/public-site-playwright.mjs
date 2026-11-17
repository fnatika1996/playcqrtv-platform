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
  for(const width of widths){
    const context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:1});
    let user=null,registerPosts=0,logoutPosts=0,meCalls=0;
    await context.route("**/api/auth/me",async route=>{meCalls++;await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({user})})});
    await context.route("**/api/auth/register",async route=>{registerPosts++;await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"registration unavailable in QA"})})});
    await context.route("**/api/auth/logout",async route=>{logoutPosts++;user=null;await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({message:"Вы вышли."})})});
    await context.route("**/api/account/nickname",async route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({nickname:"ClutchAce"})}));
    const page=await context.newPage();
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    const response=await page.goto(baseUrl,{waitUntil:"domcontentloaded"});
    assert.equal(response?.status(),200,`public home should load at ${width}px`);
    assert.match(await page.title(),/CQRTV/);
    assert.equal(await page.getByRole("heading",{level:1}).textContent(),"Твой путь в соревновательный CS2");
    await page.locator(".home-hero").waitFor({state:"visible"});
    assert.equal(await page.locator(".v31-benefit").count(),4);
    assert.equal(await page.locator(".v31-step").count(),3);
    assert.equal(await page.locator("#tournaments").isVisible(),true);
    assert.match(await page.locator("#tournament-title").textContent(),/Турниры — скоро/);
    assert.equal(await page.locator(".v31-tournament-cta").isDisabled(),true);
    assert.equal(await page.locator("#guest-actions").isVisible(),true);
    assert.equal(await page.locator("#player-profile").isVisible(),false);
    assert.equal(await page.locator("#auth-user-menu").isVisible(),false);
    assert.equal(await page.locator("#login-link").getAttribute("href"),"/auth.html");
    assert.equal(await page.locator('.home-hero-actions a[href="/auth.html"]').count(),1);
    for(const href of ["/rules.html","/privacy.html"])assert.equal(await page.locator(`footer.v31-footer a[href="${href}"]`).count(),1,`footer should keep ${href}`);
    assert.equal(await page.locator(".site-rail,.site-rightbar,.mobile-bottom-nav,.home-dashboard-grid").count(),0,"homepage dashboard chrome must be removed");
    assert.equal(await page.locator(".site-nav-unavailable").count(),2,"unimplemented player catalogue must be truthfully marked in both navs");
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
      assert.equal(await page.locator("#mobile-menu-profile-link").getAttribute("href"),"#player-profile");
      assert.equal(await page.locator("#auth-user-menu .avatar").getAttribute("href"),"#player-profile");
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
    console.log(`PASS approved home v3.1 at ${width}px`);
  }
  const offlineContext=await browser.newContext({viewport:{width:390,height:844}});
  await offlineContext.setExtraHTTPHeaders({"X-QA-Site-Mode":"coming_soon"});
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
