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
const widths=[1440,1024,760,390,320];
const browser=await chromium.launch({headless:true,args:["--host-resolver-rules=MAP playcqrtv.com 127.0.0.1"]});
const player={nickname:"ClutchAce",country:"MD",primary_role:"awper",secondary_roles:["rifler"],nickname_available_at:null};
try{
  for(const width of widths){
    const context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:1});
    let user=null,registerPosts=0,apiMeCalls=0;
    await context.route("**/api/auth/me",async route=>{apiMeCalls++;await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({user})})});
    await context.route("**/api/auth/register",async route=>{registerPosts++;await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"registration unavailable in QA"})})});
    await context.route("**/api/auth/logout",async route=>{user=null;await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({message:"Вы вышли."})})});
    const page=await context.newPage();
    const errors=[];page.on("pageerror",error=>errors.push(error.message));
    const response=await page.goto(baseUrl,{waitUntil:"domcontentloaded"});
    assert.equal(response?.status(),200,`public home should load at ${width}px`);
    assert.match(await page.title(),/CQRTV/);
    await page.locator(".home-hero").waitFor({state:"visible"});
    await page.locator(".admin-icon use").first().waitFor({state:"attached"});
    assert.equal(await page.locator("#guest-actions").isVisible(),true,`guest CTA should be available at ${width}px`);
    assert.equal(await page.locator("#player-profile").isVisible(),false,`guest must not receive player profile at ${width}px`);
    assert.equal(await page.locator("#auth-user-menu").isVisible(),false);
    assert.equal(await page.getByText("Матчмейкинг пока недоступен",{exact:true}).count(),1);
    assert.equal(await page.locator(".home-feature").filter({hasText:"Матчмейкинг"}).getByRole("button").count(),0,"unimplemented features must not expose fake buttons");
    const overflow=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,viewport:innerWidth}));
    assert.ok(overflow.scrollWidth<=overflow.clientWidth,`public page overflows at ${width}px: ${JSON.stringify(overflow)}`);
    if(width<=760){
      assert.equal(await page.locator(".mobile-bottom-nav").isVisible(),true);
      assert.equal(await page.locator("#mobile-menu-toggle").isVisible(),true);
      await page.locator("#mobile-menu-toggle").click();
      assert.equal(await page.locator("#mobile-navigation").isVisible(),true);
      assert.equal(await page.locator("#mobile-menu-toggle").getAttribute("aria-expanded"),"true");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#mobile-navigation").isVisible(),false);
      assert.equal(await page.locator("#mobile-menu-toggle").getAttribute("aria-expanded"),"false");
    }
    if(width===390){
      await page.locator("#hero-signup").click();
      assert.equal(await page.locator("#signup-dialog").evaluate(dialog=>dialog.open),true,"signup CTA should still open the real existing form");
      await page.locator("#signup-close").click();
      assert.equal(registerPosts,0,"opening the signup dialog must not submit registration");
    }
    await page.screenshot({path:path.join(screenshotDir,`public-home-guest-${width}.png`),fullPage:true});
    assert.ok(apiMeCalls>=1,"session state should come from the existing /api/auth/me endpoint");

    if([1440,390,320].includes(width)){
      user=player;
      await page.reload({waitUntil:"domcontentloaded"});
      await page.getByText("С возвращением, ClutchAce",{exact:true}).waitFor({state:"visible"});
      assert.equal(await page.locator("#player-profile").isVisible(),true);
      assert.equal(await page.locator("#guest-actions").isVisible(),false);
      assert.equal(await page.locator("#profile-nickname").textContent(),"ClutchAce");
      assert.equal(await page.locator("#profile-country-flag").textContent(),"🇲🇩");
      assert.equal(await page.locator("#profile-role").textContent(),"AWPer");
      assert.equal(await page.locator("#profile-secondary-roles").textContent(),"Rifler");
      assert.equal(await page.locator("#profile-email-verified").isVisible(),true);
      assert.equal(await page.getByText("1 246",{exact:true}).count(),0);
      await page.locator("#player-profile").scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(screenshotDir,`public-home-player-${width}.png`),fullPage:true});
      if(width===390){
        await page.locator("#logout-btn").click();
        await page.getByRole("link",{name:"Войти",exact:true}).first().waitFor({state:"visible"});
        assert.equal(await page.locator("#player-profile").isVisible(),false,"logout must hide private profile fields");
      }
    }
    assert.deepEqual(errors,[],`browser errors at ${width}px: ${errors.join("; ")}`);
    await context.close();
    console.log(`PASS public site viewport ${width}px`);
  }

  const offlineContext=await browser.newContext({viewport:{width:390,height:844}});
  await offlineContext.setExtraHTTPHeaders({"X-QA-Site-Mode":"coming_soon"});
  const offline=await offlineContext.newPage();
  const offlineResponse=await offline.goto(baseUrl,{waitUntil:"domcontentloaded"});
  assert.equal(offlineResponse?.status(),200);
  assert.equal(await offline.locator("#player-profile").count(),0,"offline gate must not serve the private player page to a guest");
  assert.equal(await offline.getByRole("link",{name:"Вход для администратора"}).count(),1,"offline page should keep only the intended admin login route");
  assert.equal(new URL(await offline.getByRole("link",{name:"Вход для администратора"}).getAttribute("href"),baseUrl).pathname,"/admin/login");
  await offline.screenshot({path:path.join(screenshotDir,"public-home-offline-guest.png"),fullPage:true});
  await offline.close();
}finally{
  await browser.close();
}
