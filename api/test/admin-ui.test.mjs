import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const login = await readFile(new URL("../../admin-login.html", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../../admin.html", import.meta.url), "utf8");
const siteControl = await readFile(new URL("../../site-control-admin.html", import.meta.url), "utf8");
const iconManifest = JSON.parse(await readFile(new URL("../../assets/icons/cqrtv/admin-icon-manifest.json", import.meta.url), "utf8"));
const migration = await readFile(new URL("../migrations/001_admin_mvp.sql", import.meta.url), "utf8");
const deployWorkflow = await readFile(new URL("../../.github/workflows/deploy.yml", import.meta.url), "utf8");
const testWorkflow = await readFile(new URL("../../.github/workflows/auth-tests.yml", import.meta.url), "utf8");
const adminHero = await readFile(new URL("../../assets/admin/admin-hero.png", import.meta.url));

test("admin login UI exposes only the intended credential flow", () => {
  assert.match(login, /id="login-form"/);
  assert.match(login, /type="email"/);
  assert.match(login, /autocomplete="current-password"/);
  assert.match(login, /aria-label="Показать пароль"/);
  assert.match(login, /aria-pressed/);
  assert.match(login, /fetch\('\/api\/admin\/login'/);
  assert.match(login, /credentials:'same-origin'/);
  assert.match(login, /get\('next'\)==='\/'\?'\/'\:'\/admin'/);
  assert.match(login, /location\.assign\(returnTo\)/);
  assert.doesNotMatch(login, /localStorage|sessionStorage|mode=forgot|Создать аккаунт/);
  assert.match(login, /assets\/icons\/cqrtv\/ui\/shield\.svg/);
  assert.match(login, /src="\/assets\/admin\/admin-hero\.png" alt="" aria-hidden="true"/);
  assert.doesNotMatch(login, /filter:\s*(?:brightness|grayscale|saturate)/i, "icon colors must not depend on destructive CSS filters");
  assert.doesNotMatch(login, /assets\/auth\/login-hero\.jpg/);
  assert.deepEqual([...adminHero.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const width = adminHero.readUInt32BE(16);
  const height = adminHero.readUInt32BE(20);
  assert.ok(width >= height * 2, "the separate admin hero is a wide banner for desktop/mobile cropping");
  for (const icon of ["mail", "lock", "eye", "eye-closed", "login", "arrow-left"]) assert.ok(login.includes(`/assets/icons/cqrtv/ui/${icon}.svg`));
  assert.match(login, /eye-closed\.svg/);
  assert.doesNotMatch(login, /<svg/);
});

test("admin dashboard uses selected CQRTV pack assets and safe DOM text rendering", () => {
  for (const icon of ["dashboard", "users", "chart", "settings", "logout", "user", "user-circle", "reorder", "close"]) {
    assert.ok(dashboard.includes("/assets/icons/cqrtv/ui/" + icon + ".svg"), "missing selected CQRTV icon " + icon);
  }
  for (const icon of ["user-check", "user-block", "letter-open", "shield-warning"]) {
    assert.ok(dashboard.includes("'" + icon + "'"), "missing dynamic user state icon " + icon);
  }
  for (const icon of ["chat", "gamepad", "upload"]) {
    assert.ok(siteControl.includes("/assets/icons/cqrtv/ui/" + icon + ".svg") || siteControl.includes(icon + ":'" + icon + "'"), "missing Site Control icon " + icon);
  }
  assert.ok(siteControl.includes("'lock-open'"), "open mode uses the branded open-state icon");
  assert.doesNotMatch(dashboard, /<button disabled>/, "navigation must not expose dead placeholder sections");
  assert.match(dash