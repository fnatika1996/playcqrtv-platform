import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path) => readFile(new URL("../../" + path, import.meta.url), "utf8");
const moduleSource = await read("assets/i18n.mjs");
const match = moduleSource.match(/const dictionaries = (\{[\s\S]*?\});\nconst ui =/);
assert.ok(match, "localization dictionaries are embedded in the first-party module");
const dictionaries = JSON.parse(match[1]);
const locales = ["ru", "en", "ro"];

test("all locale dictionaries have complete matching keys", () => {
  for (const locale of locales) assert.ok(dictionaries[locale], `missing locale ${locale}`);
  const reference = Object.keys(dictionaries.ru).sort();
  for (const locale of locales) {
    assert.deepEqual(Object.keys(dictionaries[locale]).sort(), reference, `${locale} dictionary key parity`);
    for (const [key, value] of Object.entries(dictionaries[locale])) {
      assert.equal(typeof value, "string", `${locale}: ${key} must be a string`);
      assert.ok(value.length, `${locale}: ${key} must not be empty`);
    }
  }
});

test("every static visible text node on routed pages has an authored translation", async () => {
  const pages = ["index.html","profile.html","auth.html","admin-login.html","admin.html","site-control-admin.html","site-closed.html","rules.html","privacy.html"];
  const missing = [];
  for (const path of pages) {
    let html = await read(path);
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ");
    for (const node of html.matchAll(/>([^<>]+)</g)) {
      const source = node[1].replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
      if (/[\u0400-\u04ff]/.test(source) && !Object.hasOwn(dictionaries.ru, source)) missing.push(`${path}: ${source}`);
    }
  }
  assert.deepEqual(missing, [], "static Russian UI text must be present in the authored dictionary");
});

test("dynamic API messages used by account and admin UI are translated", async () => {
  const serverFiles = ["api/server.mjs","api/admin-routes.mjs","api/site-control.mjs"];
  const missing = [];
  for (const path of serverFiles) {
    const source = await read(path);
    for (const literal of source.matchAll(/["']([^"'\n]*[\u0400-\u04ff][^"'\n]*)["']/g)) {
      const phrase = literal[1].trim();
      if (phrase.length < 250 && !phrase.includes("${") && !Object.hasOwn(dictionaries.ru, phrase)) missing.push(`${path}: ${phrase}`);
    }
  }
  assert.deepEqual(missing, [], "fixed server messages must map to localized UI messages");
});
