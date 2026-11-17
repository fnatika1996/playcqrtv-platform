import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
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
  const pages = await discoverRootPages();
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


const projectRoot = new URL("../../", import.meta.url);
async function discoverRootPages() {
  const entries = await readdir(projectRoot, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => entry.name).sort();
}
function decodeHtml(value) {
  return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&#x27;/gi, "'");
}
function isHumanText(value) {
  const normalized = decodeHtml(value).replace(/\s+/g, " ").trim();
  if (!normalized || !/[\p{L}]/u.test(normalized)) return false;
  return !/^(CQRTV|CS2|Counter-Strike 2|ELO|Steam|FACEIT|RU|EN|RO)$/i.test(normalized);
}
function inspectMarkup(html, path, catalogs = dictionaries) {
  const errors = [];
  const source = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  for (const match of source.matchAll(/<([a-z][\w:-]*)(\s[^<>]*?)?>([^<>]+)</gi)) {
    const attrs = match[2] || "";
    const text = decodeHtml(match[3]).replace(/\s+/g, " ").trim();
    if (!isHumanText(text)) continue;
    const binding = attrs.match(/\bdata-i18n="([^"]+)"/i)?.[1];
    if (binding) {
      for (const locale of locales) if (!Object.hasOwn(catalogs[locale] || {}, binding)) errors.push(`${path}: missing ${locale} translation for ${binding}`);
    } else if (!Object.hasOwn(catalogs.ru || {}, text)) errors.push(`${path}: unbound UI text “${text}”`);
  }
  for (const match of source.matchAll(/<([a-z][\w:-]*)(\s[^<>]*?)?>/gi)) {
    const attrs = match[2] || "";
    const values = Object.fromEntries([...attrs.matchAll(/([\w:-]+)="([^"]*)"/g)].map((item) => [item[1], item[2]]));
    for (const attr of ["aria-label", "title", "placeholder", "alt"]) {
      const value = values[attr];
      if (!value || !isHumanText(value)) continue;
      const binding = values[`data-i18n-${attr}`];
      if (binding) {
        for (const locale of locales) if (!Object.hasOwn(catalogs[locale] || {}, binding)) errors.push(`${path}: missing ${locale} translation for ${binding}`);
      } else if (!Object.hasOwn(catalogs.ru || {}, decodeHtml(value).trim())) errors.push(`${path}: unbound ${attr} “${value}”`);
    }
  }
  return errors;
}

test("all root HTML entrypoints are discovered and localized, including attributes", async () => {
  const pages = await discoverRootPages();
  assert.ok(pages.length > 0, "the route inventory must not be empty");
  const errors = [];
  for (const path of pages) {
    const html = await read(path);
    const language = html.match(/<html\b[^>]*\blang="([^"]+)"/i)?.[1];
    assert.ok(locales.includes(language), `${path}: html lang must use a supported locale`);
    assert.match(html, /<script\b[^>]*src="[^"]*assets\/i18n\.mjs[^"]*"[^>]*>/i, `${path}: routed page must load the localization runtime`);
    errors.push(...inspectMarkup(html, path));
  }
  assert.deepEqual(errors, [], "all authored UI text and translatable attributes must be bound to a locale catalog");
});

test("a future raw UI literal is rejected while a semantically keyed new page passes", () => {
  const raw = inspectMarkup("<!doctype html><html lang=\"ru\"><body><main><h1>New competitive dashboard</h1></main></body></html>", "future-page.html");
  assert.ok(raw.some((item) => item.includes("unbound UI text")), "new raw page text must fail CI");
  const catalogs = {
    ru: { "fixture.dashboard.title": "Новая соревновательная панель" },
    en: { "fixture.dashboard.title": "New competitive dashboard" },
    ro: { "fixture.dashboard.title": "Panou competitiv nou" }
  };
  const semantic = inspectMarkup("<!doctype html><html lang=\"ru\"><body><main><h1 data-i18n=\"fixture.dashboard.title\">Новая соревновательная панель</h1></main></body></html>", "future-page.html", catalogs);
  // Validate fixture catalog parity through the same key contract as production catalogs.
  for (const locale of locales) assert.equal(typeof catalogs[locale]["fixture.dashboard.title"], "string");
  assert.deepEqual(semantic, [], "a new page with an authored semantic key should pass");
});

test("locale catalogs preserve interpolation parameters", () => {
  const placeholders = (value) => [...value.matchAll(/\{([\w]+)\}/g)].map((match) => match[1]).sort();
  for (const [key, russian] of Object.entries(dictionaries.ru)) {
    for (const locale of locales) {
      assert.deepEqual(placeholders(dictionaries[locale][key]), placeholders(russian), `${locale}: placeholder parity for ${key}`);
    }
  }
});
