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
    assert.equal((await page.locator("#home-title").innerText()).replace(/\s+/g," ").trim(),"ТВОЯ ИГРА. ТВОЙ РЕЙТИНГ.");
    await page.locator(".home-hero").waitFor({state:"visible"});
    await page.screenshot({path:path.join(screenshotDir,`home-v2-guest-ru-${width}-viewport.png`),fullPage:false});
    if(width===1440||width===390)await page.screenshot({path:path.join(screenshotDir,`home-v2-guest-ru-${width}-full.png`),fullPage:true});
    assert.equal(await page.locator(".home-feature").count(),4);
    const featureArt=await page.locator(".home-feature-art").evaluateAll(nodes=>nodes.map(node=>{const style=getComputedStyle(node),motif=getComputedStyle(node,"::before");return {background:style.backgroundImage,motif:motif.backgroundImage,motifContent:motif.content}}));
    assert.ok(featureArt.every(art=>art.background!=="none"&&art.motif!=="none"&&art.motifContent!=="none"),"each feature card has a visible CSS illustration treatment");
    assert.equal(new Set(featureArt.map(art=>art.motif)).size,4,"feature illustration treatments remain distinct without locking exact palette values");
    assert.equal(await page.locator(".home-metric").count(),4);
    assert.deepEqual(await page.locator(".home-metric strong").allTextContents(),["—","—","—","—"],"unverified platform figures must remain placeholders");
    assert.equal(await page.locator(".home-roadmap-list li").count(),4);
    assert.equal(await page.locator(".home-platform-status .status-development").textContent(),"В разработке");
    assert.equal(await page.locator(".home-feature .status-soon").count(),4);
    assert.equal(await page.locator(".home-hero-actions a[href=\"#features\"]").count(),2,"guest and signed-in hero states each have the informational link");
    assert.equal(await page.locator(".home-hero-art img").evaluate(image=>image.complete&&image.naturalWidth>0),true,"approved local hero art should load");
    const artVisibility=await page.locator(".home-hero").evaluate(hero=>{
      const art=hero.querySelector(".home-hero-art"),image=art?.querySelector("img"),copy=hero.querySelector(".home-hero-copy"),heroRect=hero.getBoundingClientRect();
      const artStyle=getComputedStyle(art),copyStyle=getComputedStyle(copy),overlayStyle=getComputedStyle(hero,"::before");
      const probeX=heroRect.left+heroRect.width*.9,probeY=heroRect.top+Math.min(70,heroRect.height*.22);
      return {artZ:artStyle.zIndex,copyZ:copyStyle.zIndex,overlayZ:overlayStyle.zIndex,overlayPointerEvents:overlayStyle.pointerEvents,artRect:art.getBoundingClientRect().toJSON(),probeIncludesImage:document.elementsFromPoint(probeX,probeY).includes(image),probeX,probeY};
    });
    assert.equal(artVisibility.artZ,"0",`hero image layer must sit above the card background: ${JSON.stringify(artVisibility)}`);
    assert.equal(artVisibility.overlayZ,"1");
    assert.equal(artVisibility.copyZ,"2");
    assert.equal(artVisibility.overlayPointerEvents,"none");
    assert.ok(artVisibility.probeIncludesImage,`the right hero art remains in the visible browser paint stack and is not hidden by the overlay: ${JSON.stringify(artVisibility)}`);
    assert.equal(await page.locator("#guest-actions").isVisible(),true);
    assert.equal(await page.locator("#player-profile").isVisible(),false);
    assert.equal(await page.locator("#auth-user-menu").isVisible(),false);
    assert.equal(await page.locator("#login-link").getAttribute("href"),"/auth.html");
    assert.equal(await page.locator('.home-hero-actions a[href="/profile.html"]').count(),1);
    for(const href of ["/rules.html","/privacy.html"])assert.equal(await page.locator(`footer.home-footer a[href="${href}"]`).count(),1,`footer should keep ${href}`);
    assert.equal(await page.locator(".site-rail").count(),1,"the desktop navigation rail should be available");
    assert.equal(await page.locator(".site-topbar .site-nav a").count(),0,"desktop top navigation must not duplicate game destinations");
    assert.equal(await page.locator(".site-topbar .site-nav .site-nav-unavailable").count(),4,"desktop top navigation exposes only the four honest commercial Soon sections");
    const topNavFont=await page.locator(".site-topbar .site-nav .site-nav-unavailable").first().evaluate(item=>getComputedStyle(item).fontFamily);
    assert.match(topNavFont,/Teko/i,"commercial menu uses the approved Teko typeface");
    if(width>760){
      const rail=page.locator(".site-rail");
      assert.equal(await rail.isVisible(),true,`sidebar should be visible at ${width}px`);
      const navItems=rail.locator(".rail-btn[href]");
      assert.equal(await navItems.count(),7,"all available sidebar destinations, including the session-aware profile, should exist");
      assert.equal(await rail.locator(".site-nav-unavailable").count(),2,"Players and Settings are explicitly unavailable");
      const railGeometry=await navItems.evaluateAll(items=>items.map(item=>{const r=item.getBoundingClientRect();return {text:item.innerText.trim(),top:r.top,bottom:r.bottom,height:r.height,visible:r.width>0&&r.height>0&&getComputedStyle(item).visibility!=="hidden"}}));
      assert.ok(railGeometry.every(item=>item.visible),`every sidebar destination is visible: ${JSON.stringify(railGeometry)}`);
      assert.ok(railGeometry.every(item=>item.height>=40&&item.height<=44),`sidebar items should be about 42px: ${JSON.stringify(railGeometry)}`);
      const railFont=await rail.locator(".rail-btn").first().evaluate(item=>getComputedStyle(item).fontFamily);
      assert.match(railFont,/Teko/i,"sidebar menu uses the approved Teko typeface");
      assert.deepEqual(await rail.locator(".rail-btn[href] span[data-i18n]").allTextContents(),["ГЛАВНАЯ","МАТЧИ","РЕЙТИНГ ELO","ТУРНИРЫ","КОМАНДЫ","СТАТИСТИКА","ПРОФИЛЬ"]);
      assert.ok(railGeometry.every((item,index)=>index===0||item.top>=railGeometry[index-1].bottom-0.5),`sidebar links must not overlap: ${JSON.stringify(railGeometry)}`);
      if(width===1440){
        const railBounds=await rail.boundingBox(),headerBounds=await page.locator(".site-topbar").boundingBox();
        assert.ok(railBounds&&headerBounds&&railBounds.y>=headerBounds.y+headerBounds.height-1,"sidebar starts below the sticky header");
      }
    }
    if(width<=760){
      const wordmark=page.locator(".site-topbar .brand-name");
      assert.equal(await wordmark.isVisible(),true,"mobile header keeps the complete CQRTV wordmark");
      assert.equal((await wordmark.innerText()).replace(/\\s+/g,"").trim(),"CQRTV");
      const wordmarkWidth=await wordmark.evaluate(node=>node.getBoundingClientRect().width);
      assert.ok(wordmarkWidth>=40,`complete wordmark should have usable width: ${wordmarkWidth}px`);
      assert.ok(await wordmark.evaluate(node=>node.scrollWidth<=node.clientWidth+1),"complete wordmark must not be clipped");
      for(const selector of ["#mobile-menu-toggle","#login-link",".site-topbar [data-cqrtv-language-switcher] .cqrtv-language-trigger"]){
        const control=page.locator(selector);
        assert.equal(await control.isVisible(),true,`mobile header control ${selector} remains visible`);
        const box=await control.boundingBox();
        assert.ok(box&&box.width>=40&&box.height>=40,`mobile header target ${selector} stays at least 40px: ${JSON.stringify(box)}`);
      }
      const headerRects=await page.locator(".site-topbar .mobile-menu-toggle,.site-topbar .brand,.site-topbar .site-actions").evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}}));
      assert.ok(headerRects.every((item,index)=>index===0||item.left>=headerRects[index-1].right-0.5),`mobile header groups must not overlap: ${JSON.stringify(headerRects)}`);
    }
    const headingState=await page.locator("#home-title").evaluate(node=>({width:node.clientWidth,scrollWidth:node.scrollWidth,lines:[...node.querySelectorAll("span")].map(span=>({text:span.innerText,color:getComputedStyle(span).color,width:span.clientWidth,scrollWidth:span.scrollWidth}))}));
    assert.ok(headingState.scrollWidth<=headingState.width+1,`hero title must not clip at ${width}px: ${JSON.stringify(headingState)}`);
    assert.equal(headingState.lines.length,2,"hero title keeps the approved two-line hierarchy");
    assert.ok(headingState.lines.every(line=>line.width>=line.scrollWidth-1),`each hero title line fits without wrapping: ${JSON.stringify(headingState)}`);
    assert.equal(headingState.lines[0].color,"rgb(243, 243, 242)","first hero line uses the light text color");
    assert.equal(headingState.lines[1].color,"rgb(255, 118, 41)","second hero line uses the CQRTV orange accent");
    assert.equal(await page.locator(".site-rightbar,.home-dashboard-grid").count(),0,"the new homepage must not introduce mock dashboard chrome");
    assert.equal(await page.locator(".mobile-bottom-nav .mobile-tab").count(),5,"mobile bottom navigation has exactly five primary tabs");
    assert.equal(await page.locator(".home-metric-icon .pack-icon").count(),4,"each unverified metric has its own icon-pack glyph");
    assert.equal(await page.locator(".site-nav-unavailable").count(),12,"not-yet-available commercial, players and settings sections are clearly marked");
    if(width<=760){
      const bottom=page.locator("#mobile-bottom-nav");
      assert.equal(await bottom.isVisible(),true,`fixed primary tabs are visible at ${width}px`);
      assert.equal(await page.locator(".site-topbar .site-nav").isVisible(),false,"mobile header does not duplicate the primary game navigation");
      const tabs=await bottom.locator(".mobile-tab").evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {name:node.innerText.trim(),width:r.width,height:r.height,aria:node.getAttribute("aria-label"),current:node.getAttribute("aria-current")}}));
      assert.equal(tabs.length,5);
      assert.ok(tabs.every(tab=>tab.height>=44&&tab.width>=44&&tab.name.length>0),`bottom tabs retain accessible 44px targets and names: ${JSON.stringify(tabs)}`);
      assert.equal(tabs.filter(tab=>tab.current==="page").length,1,"exactly one bottom tab exposes current-page state");
      assert.equal(tabs[0].current,"page");
      const activeStyle=await bottom.locator(".mobile-tab[aria-current=page]").evaluate(node=>{
        const style=getComputedStyle(node),rgb=style.backgroundColor.match(/[0-9.]+/g)?.slice(0,3).map(Number)||[];
        const linear=rgb.map(value=>{const channel=value/255;return channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4});
        const luminance=.2126*linear[0]+.7152*linear[1]+.0722*linear[2];
        const fg=getComputedStyle(node).color.match(/[0-9.]+/g)?.slice(0,3).map(Number)||[];
        const fgLinear=fg.map(value=>{const channel=value/255;return channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4});
        const fgLuminance=.2126*fgLinear[0]+.7152*fgLinear[1]+.0722*fgLinear[2];
        return {background:style.backgroundColor,color:style.color,contrast:(Math.max(luminance,fgLuminance)+.05)/(Math.min(luminance,fgLuminance)+.05),chroma:rgb.length?Math.max(...rgb)-Math.min(...rgb):0,border:style.borderTopColor,shadow:style.boxShadow};
      });
      assert.ok(activeStyle.contrast>=4.5,"active tab text contrast meets WCAG AA");
      assert.ok(activeStyle.chroma>=100,"active tab has a distinctive saturated accent background");
      assert.notEqual(activeStyle.border,"rgba(0, 0, 0, 0)","active tab has a visible selected-state edge");
      assert.notEqual(activeStyle.shadow,"none","active tab has a restrained brand halo");
    }else assert.equal(await page.locator("#mobile-bottom-nav").isVisible(),false,"bottom tabs are mobile-only");
    for(const href of ["#home","#play","#leaderboard","#tournaments","#teams","#stats","#features","#community"])
      assert.equal(await page.locator(`[id="${href.slice(1)}"]`).count(),1,`in-page destination ${href} should resolve`);
    for(const forbidden of ["CQRTV Open #1","1 246","игроков онлайн","матчей сегодня","Начать играть через Steam","Смотреть трейлер"])
      assert.equal(await page.getByText(forbidden,{exact:false}).count(),0,`homepage must not promise ${forbidden}`);
    const iconCount=await page.locator(".pack-icon").count();
    assert.ok(iconCount>=10,"homepage should reuse the CQRTV SVG icon pack");
    const icons=await page.locator(".pack-icon").evaluateAll(nodes=>nodes.filter(node=>node.querySelector("svg")||node.querySelector("use")).length);
    assert.ok(icons>0,"CQRTV pack icons should load into the header and homepage");
    const overflow=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));
    assert.ok(overflow.scrollWidth<=overflow.clientWidth,`horizontal overflow at ${width}px: ${JSON.stringify(overflow)}`);
    if(width>760){
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
      assert.equal(await page.locator("#mobile-navigation a[href=\"#home\"],#mobile-navigation a[href=\"#play\"],#mobile-navigation a[href=\"#leaderboard\"],#mobile-navigation a[href=\"#tournaments\"]").count(),0,"overflow menu must not duplicate the five primary bottom tabs");
      assert.equal(await page.locator("#mobile-navigation .mobile-drawer-section").count(),2,"overflow menu separates commercial and additional destinations");
      assert.equal(await page.locator("#mobile-navigation .site-nav-unavailable").count(),6,"all not-yet-launched overflow destinations are explicitly marked");
      await page.keyboard.press("Escape");
      assert.equal(await page.evaluate(()=>document.activeElement?.id),"mobile-menu-toggle","Escape should restore focus to the mobile menu button");
      assert.equal(await page.locator("#mobile-navigation").isVisible(),false);
      assert.equal(await page.locator("#mobile-menu-toggle").getAttribute("aria-expanded"),"false");
      if(width<=760){
        const bottomBox=await page.locator("#mobile-bottom-nav").boundingBox();
        await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
        await page.waitForTimeout(30);
        const footerBox=await page.locator(".home-footer").boundingBox();
        assert.ok(bottomBox&&footerBox&&footerBox.y+footerBox.height<=bottomBox.y+1,`fixed tabs must not cover the final page content after scrolling: footer=${JSON.stringify(footerBox)} tabs=${JSON.stringify(bottomBox)}`);
      }
    }
    if(width===390){
      for(const height of [667,1024]){
        await page.setViewportSize({width,height});
        const heightOverflow=await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth);
        assert.equal(heightOverflow,true,`no horizontal overflow at 390x${height}`);
      }
      await page.setViewportSize({width:195,height:450});
      const zoomOverflow=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,offenders:[...document.querySelectorAll("body *")].map(element=>{const rect=element.getBoundingClientRect();return {tag:element.tagName,className:typeof element.className==="string"?element.className:"",id:element.id,right:Math.round(rect.right),left:Math.round(rect.left),width:Math.round(rect.width)}}).filter(item=>item.right>innerWidth+1||item.left< -1).slice(0,8)}));
      assert.ok(zoomOverflow.scrollWidth<=zoomOverflow.clientWidth,`half-width CSS viewport overflow at simulated 200% zoom: ${JSON.stringify(zoomOverflow)}`);
      await page.setViewportSize({width,height:900});
      await page.emulateMedia({reducedMotion:"reduce"});
      assert.equal(await page.evaluate(()=>matchMedia("(prefers-reduced-motion: reduce)").matches),true);
      assert.equal(await page.locator(".home-feature").first().evaluate(element=>getComputedStyle(element).transitionDuration.split(",").every(value=>parseFloat(value)===0)),true,"reduced-motion should disable feature transitions");
      await page.emulateMedia({reducedMotion:"no-preference"});
      await page.locator("#hero-signup").click();
      assert.equal(await page.locator("#signup-dialog").evaluate(dialog=>dialog.open),true,"homepage signup should open the existing registration dialog");
      await page.locator("#signup-close").click();
      assert.equal(registerPosts,0,"opening signup should not submit to the registration API");
    }
    if(width!==1440&&width!==390)await page.screenshot({path:path.join(screenshotDir,`home-v2-guest-ru-${width}-full.png`),fullPage:true});
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
      assert.equal(await page.locator("#sidebar-profile-link").getAttribute("href"),"/profile.html");
      assert.equal(await page.locator("#auth-user-menu .avatar").getAttribute("href"),"/profile.html");
      assert.equal(await page.locator("#player-profile").locator("#profile-edit-btn").isVisible(),true);
      assert.equal(await page.locator("#player-profile").locator("text=ELO").count(),0,"large dashboard profile metrics should not return to the homepage");
      await page.screenshot({path:path.join(screenshotDir,`home-v2-player-ru-${width}-viewport.png`),fullPage:false});
      await page.screenshot({path:path.join(screenshotDir,`home-v2-player-ru-${width}-full.png`),fullPage:true});
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
