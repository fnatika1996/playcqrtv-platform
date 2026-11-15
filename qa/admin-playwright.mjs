import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const playwrightRoot = process.env.PLAYWRIGHT_PACKAGE;
if (!playwrightRoot) throw new Error("PLAYWRIGHT_PACKAGE must point to the pinned Playwright install.");
const { chromium } = await import(pathToFileURL(`${playwrightRoot}/index.mjs`).href);
const baseUrl = process.env.CQRTV_QA_BASE_URL || "http://playcqrtv.com:8765";
const widths = [1440, 1024, 760, 390, 375, 320];
const screenshotDir = new URL("../qa-artifacts/", import.meta.url);
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
    await page.screenshot({ path: new URL(`admin-login-${width}.png`, screenshotDir).pathname, fullPage: true });
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
    assert.equal(hero.height, width <= 580 ? 135 : 170);
    const loginOverflow = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > window.innerWidth, viewport: window.innerWidth, document: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll("body *")].map(element => ({ tag: element.tagName, className: element.className?.baseVal || element.className, id: element.id, right: Math.round(element.getBoundingClientRect().right) })).filter(element => element.left < -1 || element.right > window.innerWidth + 1).slice(0, 12) }));
    assert.equal(loginOverflow.overflow, false, `login page has horizontal overflow at ${width}px: ${JSON.stringify(loginOverflow)}`);
    if (width === 390) {
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement.matches(".back")), true, "first keyboard focus should reach the back link");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      const focusVisible = await page.locator("#eye").evaluate(button => ({
        focused: button.matches(":focus-visible"),
        outlineWidth: getComputedStyle(button).outlineWidth
      }));
      assert.equal(focusVisible.focused, true, "password toggle should show keyboard focus");
      assert.equal(focusVisible.outlineWidth, "2px");
      await page.getByLabel("Пароль", { exact: true }).fill("qa-only-not-a-real-password");
      await page.locator("#eye").click();
      assert.equal(await page.getByLabel("Пароль", { exact: true }).getAttribute("type"), "text");
      assert.equal(await page.locator("#eye").getAttribute("aria-pressed"), "true");
      await page.locator("#eye").click();
      assert.equal(await page.getByLabel("Пароль", { exact: true }).getAttribute("type"), "password");
      assert.equal(loginPosts, 0, "eye toggle must not submit credentials");
    }
    await page.close();
    console.log(`PASS admin login viewport ${width}px`);
  }

  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
    let suspendCalls = 0;
    let logoutCalls = 0;
    await page.route("**/api/admin/**", async route => {
      const request = route.request();
      const url = new URL(request.url());
      let data;
      if (url.pathname === "/api/admin/me") {
        data = { user: { id: 9001, nickname: "QA Operator", emailMasked: "q•••@example.test" }, csrfToken: "qa-csrf-token" };
      } else if (url.pathname === "/api/admin/stats") {
        data = { total_users: 3, verified_users: 2, suspended_users: 1 };
      } else if (url.pathname === "/api/admin/users") {
        data = {
          users: [
            { id: 9101, nickname: "Rifler QA", email: "qa-player@example.test", country: "US", primary_role: "rifler", secondary_roles: ["awper"], created_at: "2026-11-15T12:00:00Z", email_verified: true, account_status: "active" },
            { id: 9102, nickname: "Support QA", email: "qa-support@example.test", country: "SE", primary_role: "support", secondary_roles: [], created_at: "2026-11-14T12:00:00Z", email_verified: false, account_status: "suspended" }
          ],
          pagination: { limit: 20, offset: 0, total: 2 }
        };
      } else if (url.pathname === "/api/admin/audit") {
        data = { events: [{ id: 1, action: "suspend", reason: "QA fixture review", created_at: "2026-11-15T12:00:00Z", actor_user_id: 9001, actor_nickname: "QA Operator", target_user_id: 9102, target_nickname: "Support QA" }], pagination: { limit: 20, offset: 0, total: 1 } };
      } else if (url.pathname.endsWith("/suspend") && request.method() === "POST") {
        suspendCalls++;
        data = { message: "Тестовая блокировка подтверждена.", changed: true, status: "suspended" };
      } else if (url.pathname === "/api/admin/logout" && request.method() === "POST") {
        logoutCalls++;
        data = { message: "Вы вышли." };
      } else {
        return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Unknown QA mock route" }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    });

    const response = await page.goto(`${baseUrl}/admin`, { waitUntil: "domcontentloaded" });
    assert.equal(response?.status(), 200, `admin dashboard must load at ${width}px`);
    await page.locator("#admin-email").waitFor({ state: "visible" });
    assert.equal((await page.locator("#admin-email").innerText()).includes("example.test"), true);
    await page.getByText("3", { exact: true }).first().waitFor({ state: "visible" });
    const dashboardOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(dashboardOverflow, false, `dashboard has horizontal page overflow at ${width}px`);

    if (width === 1440 || width === 390 || width === 320) {
      await page.screenshot({ path: new URL(`admin-dashboard-${width}-overview.png`, screenshotDir).pathname, fullPage: true });
    }
    if (width <= 760) {
      await page.locator("#menu").click();
      assert.equal(await page.locator("#shell").evaluate(element => element.classList.contains("open")), true);
      await page.locator("#menu").click();
    }

    await page.locator('[data-view="users"]').click();
    await page.getByText("Rifler QA", { exact: true }).waitFor({ state: "visible" });
    if (width === 1440 || width === 390 || width === 320) {
      await page.screenshot({ path: new URL(`admin-dashboard-${width}-users.png`, screenshotDir).pathname, fullPage: true });
    }
    if (width <= 390) {
      const table = await page.locator("#users-view .table-wrap").evaluate(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
      assert.ok(table.scrollWidth >= table.clientWidth, "mobile user table should remain in its own horizontal scroll container");
    }

    if (width === 390) {
      await page.locator('[data-view="audit"]').click();
      await page.getByText("QA fixture review", { exact: true }).waitFor({ state: "visible" });
      await page.locator('[data-view="users"]').click();
      await page.locator('#users button[data-action="suspend"]').first().click();
      await page.locator("#reason").waitFor({ state: "visible" });
      assert.equal(await page.evaluate(() => document.activeElement.id), "reason", "confirmation modal should move keyboard focus to its reason field");
      await page.keyboard.press("Escape");
      await page.locator("#modal").waitFor({ state: "hidden" });
      await page.locator('#users button[data-action="suspend"]').first().click();
      await page.locator("#reason").fill("QA-only reason");
      await page.locator("#confirm").click();
      await page.locator("#modal").waitFor({ state: "hidden" });
      assert.equal(suspendCalls, 1, "confirm button should call only the mock API");
      await page.locator("#logout").click();
      await page.waitForURL("**/admin/login");
      assert.equal(logoutCalls, 1, "logout should call only the mock API");
    }
    await page.close();
    console.log(`PASS admin dashboard viewport ${width}px`);
  }
} finally {
  await browser.close();
}
