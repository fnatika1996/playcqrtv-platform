import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const playwrightRoot = process.env.PLAYWRIGHT_PACKAGE;
if (!playwrightRoot) throw new Error("PLAYWRIGHT_PACKAGE must point to the pinned Playwright install.");
const { chromium } = await import(pathToFileURL(`${playwrightRoot}/index.mjs`).href);
const baseUrl = process.env.CQRTV_QA_BASE_URL || "http://playcqrtv.com:8765";
const widths = [1440, 1024, 760, 390, 375, 320];
const screenshotDir = fileURLToPath(new URL("../qa-artifacts/", import.meta.url));
await mkdir(screenshotDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--host-resolver-rules=MAP playcqrtv.com 127.0.0.1"]
});
try {
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
    let loginPosts = 0;
    page.on("request", request => {
      if (request.method() === "POST" && request.url().includes("/api/admin/login")) loginPosts++;
    });
    const response = await page.goto(`${baseUrl}/admin/login`, { waitUntil: "domcontentloaded" });
    assert.equal(response?.status(), 200, `admin login must load at ${width}px`);
    assert.equal(await page.title(), "Вход администратора · CQRTV", `admin login document should parse its title at ${width}px`);
    await page.screenshot({ path: path.join(screenshotDir, `admin-login-${width}.png`), fullPage: true });
    const heroCount = await page.locator(".hero img").count();
    assert.equal(heroCount, 1, `expected the admin hero on ${page.url()} at ${width}px; document title: ${await page.title()}`);
    await page.locator(".hero img").evaluate(image => image.decode());
    assert.equal(await page.getByLabel("Рабочий email", { exact: true }).isVisible(), true);
    assert.equal(await page.getByLabel("Пароль", { exact: true }).isVisible(), true);
    assert.equal(await page.getByRole("button", { name: "Войти в панель" }).isVisible(), true);
    const loginTargets = await page.evaluate(() => ["#email", "#password", "#eye", "#submit"].map(selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { selector, width: Math.round(rect.width), height: Math.round(rect.height) };
    }));
    assert.ok(loginTargets.filter(target => target.selector !== "#eye").every(target => target.height >= 44), "login fields and submit target should be at least 44px high");
    assert.ok(loginTargets.find(target => target.selector === "#eye").width >= 44, "password visibility target should be at least 44px wide");
    console.log(`Login click targets at ${width}px: ${JSON.stringify(loginTargets)}`);
    const hero = await page.locator(".hero img").evaluate(image => ({
      loaded: image.naturalWidth > 0 && image.naturalHeight > 0,
      fit: getComputedStyle(image).objectFit,
      height: Math.round(image.parentElement.getBoundingClientRect().height)
    }));
    assert.equal(hero.loaded, true);
    assert.equal(hero.fit, "cover");
    assert.equal(hero.height, width <= 760 ? 148 : Math.min(200, Math.max(142, Math.round(width * 0.22))));
    const loginOverflow = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth, viewport: window.innerWidth, html: {scrollWidth:doc