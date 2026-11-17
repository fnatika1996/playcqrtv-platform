import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const playwrightRoot = process.env.PLAYWRIGHT_PACKAGE;
if (!playwrightRoot) throw new Error("PLAYWRIGHT_PACKAGE must point to the pinned Playwright install.");
const { chromium } = await import(pathToFileURL(`${playwrightRoot}/index.mjs`).href);
const baseUrl = process.env.CQRTV_QA_BASE_URL || "http://127.0.0.1:8765";
const base = new URL(baseUrl);
if (base.protocol !== "http:" || !base.port || base.port === "443" || base.hostname === "playcqrtv.com" && base.port !== "8765") {
  throw new Error("i18n browser QA requires an isolated HTTP preview with an explicit non-production port.");
}
const artifactDir = new URL("../qa-artifacts/", import.meta.url);
await mkdir(artifactDir, { recursive: true });
const routes = ["/","/profile.html","/auth.html","/rules.html","/privacy.html","/site-closed.html","/admin-login.html","/admin.html","/site-control-admin.html"];
const locales = ["ru","en","ro"];
const viewports = [{width:1440,height:1000},{width:390,height:844},{width:320,height:720}];
const browser = await chromium.launch({headless:true});
const failures=[];
try {
  for (const route of routes) {
    for (const locale of locales) {
      for (const viewport of viewports) {
        const context=await browser.newContext({viewport,locale:locale==="ru"?"ru-RU":locale==="ro"?"ro-RO":"en-US"});
        const page=await context.newPage();
        const pageErrors=[];
        page.on("pageerror",error=>pageErrors.push(error.message));
        try {
          await page.goto(new URL(route,base).href,{waitUntil:"networkidle",timeout:30000});
          const selector=page.locator("[data-cqrtv-language-switcher] select");
          if (await selector.count()===0) {
            const current=new URL(page.url());
            if (route==="/admin.html"||route==="/site-control-admin.html") {
              console.log(`SKIP protected route without test admin session: ${route}`);
              await context.close(); continue;
            }
            throw new Error(`language switcher missing on ${route}`);
          }
          await selector.selectOption(locale);
          await page.waitForFunction(expected=>document.documentElement.lang===expected,locale);
          await page.waitForTimeout(80);
          const state=await page.evaluate(()=>({title:document.title,scrollWidth:document.documentElement.scrollWidth,width:innerWidth}));
          assert.ok(state.title,"localized document title is present");
          assert.ok(state.scrollWidth<=state.width+1,`horizontal overflow at ${viewport.width}px: ${state.scrollWidth}`);
          if (locale!=="ru") assert.ok(!/[\u0400-\u04ff]/.test(state.title),`title remains Russian on ${route} (${locale}): ${state.title}`);
          if (viewport.width===390 && (route==="/"||route==="/auth.html"||route==="/site-closed.html")) {
            await page.screenshot({path:new URL(`i18n-${route.replaceAll("/","")||"home"}-${locale}-390.png`,artifactDir).pathname,fullPage:true});
          }
          assert.deepEqual(pageErrors,[],`browser errors on ${route} in ${locale}`);
        } catch(error) { failures.push(`${route} ${locale} ${viewport.width}: ${error.message}`); }
        await context.close();
      }
    }
  }
} finally { await browser.close(); }
if (failures.length) throw new Error(failures.join("\n"));
console.log("CQRTV i18n browser QA passed for available routes/locales/viewports.");
