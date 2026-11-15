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
  for (const icon of manifest.icons) {
    const asset = fs.readFileSync(path.join(iconDir, icon.file), "utf8");
    assert.match(asset, /<svg(?:\s|>)/i, icon.file + " must contain SVG");
    assert.doesNotMatch(asset, /<script\b|<foreignObject\b|<iframe\b|<object\b|<embed\b|<!ENTITY\b|@import\b|\bon[a-z]+\s*=|(?:href|xlink:href)\s*=\s*["'](?:https?:|javascript:|data:|\/\/)/i, icon.file + " must be inert");
  }
  const actual = referencedIcons();
  assert.ok(actual.length >= 18, "expected a meaningful in-use set, found " + actual.length);
  console.log("CQRTV_ICON_USAGE " + JSON.stringify({selected: files.length, referencedByProductionCode: actual.length, aliases: actual}));
});
