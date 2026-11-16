import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync("assets/icons/cqrtv/admin-icon-manifest.json", "utf8"));
const iconDir = path.join(root, "assets/icons/cqrtv/ui");
const compatibility = [
  "search.svg", "bell.svg", "chat.svg", "home.svg", "gamepad.svg",
  "gamepad-minimalistic.svg", "ranking.svg", "users.svg", "settings.svg",
  "edit.svg", "check.svg", "dashboard.svg", "chart.svg", "medal.svg",
  "cup.svg", "play.svg", "shield.svg", "invite.svg", "mail.svg", "lock.svg",
  "eye.svg", "eye-closed.svg", "login.svg", "logout.svg", "arrow-left.svg"
];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}
function referencedIcons() {
  const files = walk(root).filter(file => {
    if (!/\.(?:html|css|mjs|js)$/i.test(file)) return false;
    const rel = path.relative(root, file).replaceAll("\\", "/");
    return !/(^|\/)(?:\.git|node_modules|qa|docs|assets\/icons\/cqrtv\/ui)(\/|$)/i.test(rel)
      && !/(^|\/)api\/test(\/|$)/i.test(rel);
  });
  const source = files.map(file => fs.readFileSync(file, "utf8"));
  return manifest.icons.filter(icon => {
    const file = icon.file.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
    const key = icon.key.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
    return source.some(text =>
      new RegExp("/ui/" + file + "(?:[?#\"'\\s]|$)", "i").test(text) ||
      new RegExp("['\"]" + key + "['\"]").test(text)
    );
  }).map(icon => icon.file);
}

test("curated CQRTV icon pack preserves legacy paths and contains the mapped assets", () => {
  assert.equal(manifest.icons.length, 38, "the curated pack must keep its reviewed size");
  const files = manifest.icons.map(icon => icon.file);
  assert.equal(new Set(files).size, files.length, "output aliases must be unique");
  for (const file of compatibility) assert.ok(files.includes(file), "legacy icon path " + file + " must remain");
  const map = JSON.parse(fs.readFileSync(path.join(iconDir, "admin-icon-map.json"), "utf8"));
  assert.deepEqual(map.icons.map(icon => icon.file), files);
  const sprite = fs.readFileSync(path.join(iconDir, "admin-icon-sprite.svg"), "utf8");
  assert.equal((sprite.match(/<symbol\b/g) || []).length, manifest.icons.length, "the production sprite should contain one symbol for every curated alias");
  assert.match(sprite, /--icon-primary/);
  assert.match(sprite, /--icon-secondary/);
  assert.match(manifest.icons.find(icon => icon.key === "logout")?.source || "", /Logout-6--playcqrtv\.svg$/, "Logout must use the reviewed door-and-arrow icon source");
  for (const icon of manifest.icons) {
    const asset = fs.readFileSync(path.join(iconDir, icon.file), "utf8");
    assert.match(asset, /<svg(?:\s|>)/i, icon.file + " must contain SVG");
    assert.doesNotMatch(asset, /<script\b|<foreignObject\b|<iframe\b|<object\b|<embed\b|<!ENTITY\b|@import\b|\bon[a-z]+\s*=|(?:href|xlink:href)\s*=\s*["'](?:https?:|javascript:|data:|\/\/)/i, icon.file + " must be inert");
  }
  const actual = referencedIcons();
  assert.ok(actual.length >= 18, "expected a meaningful in-use set, found " + actual.length);
  console.log("CQRTV_ICON_USAGE " + JSON.stringify({selected: files.length, referencedByProductionCode: actual.length, aliases: actual}));
});

test("admin UI loads the safe shared sprite for public and privileged icons", () => {
  const module = fs.readFileSync(path.join(root, "assets/admin/admin-icons.mjs"), "utf8");
  assert.match(module, /createElementNS/);
  assert.match(module, /admin-icon-sprite\.svg#/);
  assert.doesNotMatch(module, /innerHTML|DOMParser/);
  for (const page of ["index.html", "auth.html", "site-closed.html", "admin.html", "admin-login.html", "site-control-admin.html"]) {
    assert.match(fs.readFileSync(path.join(root, page), "utf8"), /admin-icons\.mjs/);
  }
});

test("the build pipeline rejects active markup and external SVG references", async () => {
  const os = await import("node:os");
  const { spawnSync } = await import("node:child_process");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cqrtv-svg-"));
  try {
    const source = path.join(temp, "source");
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, "unsafe.svg"), '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const manifestPath = path.join(temp, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({version:1,icons:[{key:"unsafe",file:"unsafe.svg",source:"unsafe.svg"}]}));
    const result = spawnSync(process.execPath, ["scripts/build-cqrtv-admin-icons.mjs", "--source", source, "--manifest", manifestPath], {cwd:root,encoding:"utf8"});
    assert.notEqual(result.status, 0, "the builder must fail closed for active SVG markup");
    assert.match(result.stderr, /Unsafe SVG content/);
    fs.writeFileSync(path.join(source, "unsafe.svg"), '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="url(https://evil.example/a.svg#x)" d="M0 0"/></svg>');
    const external = spawnSync(process.execPath, ["scripts/build-cqrtv-admin-icons.mjs", "--source", source, "--manifest", manifestPath], {cwd:root,encoding:"utf8"});
    assert.notEqual(external.status, 0, "the builder must fail closed for external SVG paint references");
  } finally {
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
