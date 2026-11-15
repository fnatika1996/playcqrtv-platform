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
  assert.match(login, /location\.assign\('\/admin'\)/);
  assert.doesNotMatch(login, /localStorage|sessionStorage|mode=forgot|Создать аккаунт/);
  assert.match(login, /assets\/icons\/cqrtv\/ui\/shield\.svg/);
  assert.match(login, /src="\/assets\/admin\/admin-hero\.png" alt="" aria-hidden="true"/);
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
  assert.match(dashboard, /new URLSearchParams\(location\.search\)/, "the Site Control Users link must open the working Users view");
  for (const route of ["/api/admin/me", "/api/admin/stats", "/api/admin/users", "/api/admin/audit"]) {
    assert.ok(dashboard.includes(route));
  }
  for (const route of ["/api/admin/me", "/api/admin/stats", "/api/admin/users", "/api/admin/audit"]) {
    assert.ok(dashboard.includes(route));
  }
  assert.match(dashboard, /cache:'no-store'/);
  assert.match(dashboard, /credentials:'same-origin'/);
  assert.match(dashboard, /X-CSRF-Token/);
  assert.match(dashboard, /td\.textContent=text\(value\)/);
  assert.doesNotMatch(dashboard, /innerHTML|localStorage|sessionStorage/);
  assert.match(dashboard, /@media\(max-width:760px\)/);
  assert.match(dashboard, /@media\(max-width:390px\)/);
  assert.match(dashboard, /reason\.length<5\|\|reason\.length>500/);
  assert.match(dashboard, /pending\.action/);
});

test("admin migration grants no existing account by default", () => {
  assert.match(migration, /is_admin BOOLEAN NOT NULL DEFAULT false/);
  assert.match(migration, /account_status TEXT NOT NULL DEFAULT 'active'/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS admin_sessions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS admin_audit_log/);
  assert.doesNotMatch(migration, /UPDATE\s+users\s+SET\s+is_admin\s*=\s*true/i);
});


test("deploy maps the selected archive glyphs explicitly and verifies the bundle", () => {
  const mappings = [
    ["Messages Conversation/Letter--playcqrtv.svg", "mail.svg"],
    ["Security/Lock-Keyhole-Minimalistic--playcqrtv.svg", "lock.svg"],
    ["Security/Eye--playcqrtv.svg", "eye.svg"],
    ["Security/Eye-Closed--playcqrtv.svg", "eye-closed.svg"],
    ["Arrows Action/Login--playcqrtv.svg", "login.svg"],
    ["Arrows Action/Logout--playcqrtv.svg", "logout.svg"],
    ["Arrows/Alt-Arrow-Left--playcqrtv.svg", "arrow-left.svg"]
  ];
  for (const [source, file] of mappings) {
    assert.ok(iconManifest.icons.some(icon => icon.source === source && icon.file === file), "manifest should preserve " + file);
  }
  assert.equal(iconManifest.icons.length, 38);
  assert.match(deployWorkflow, /scripts\/build-cqrtv-admin-icons\.mjs/);
  assert.match(deployWorkflow, /-eq 38/);
  assert.match(testWorkflow, /node --test qa\/admin-icon-pack\.test\.mjs/);
  assert.match(testWorkflow, /--include='\*\.svg'/);
  assert.match(testWorkflow, /<script\|<foreignObject\|href=/);
});

