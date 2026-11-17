import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";

const read = (path) => readFile(new URL("../../" + path, import.meta.url), "utf8");
const moduleSource = await read("assets/i18n.mjs");
const legacyHtmlBaseline = JSON.parse(await read("docs/i18n-legacy-html-baseline.json"));
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
    for (const node of html.matchAll(/<([a-z][\w:-]*)(\s[^<>]*?)?>([^<>]+)</gi)) {
      const attrs=node[2]||"";
      const source=node[3].replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/\s+/g," ").trim();
      if(!/[\u0400-\u04ff]/.test(source))continue;
      const key=attrs.match(/\bdata-i18n="([^"]+)"/i)?.[1];
      if(key){for(const locale of locales)if(!Object.hasOwn(dictionaries[locale]||{},key))missing.push(path+": "+locale+" "+key);}
      else if(!Object.hasOwn(dictionaries.ru,source))missing.push(path+": "+source);
    }  }
  assert.deepEqual(missing, [], "static Russian UI text must be present in the authored dictionary");
});

test("dynamic API messages used by account and admin UI are translated", async () => {
  const serverFiles = ["api/server.mjs","api/admin-routes.mjs","api/site-control.mjs"];
  const missing = [];
  for (const path of serverFiles) {
    const source = await read(path);
    missing.push(...inspectRawSourceLiterals(source, path));
  }
  assert.deepEqual(missing, [], "fixed server messages must map to localized UI messages");
});


const projectRoot = new URL("../../", import.meta.url);
function selectRootHtmlEntrypoints(entries) {
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => entry.name).sort();
}
async function discoverRootPages() {
  return selectRootHtmlEntrypoints(await readdir(projectRoot, { withFileTypes: true }));
}
function decodeHtml(value) {
  return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&#x27;/gi, "'");
}
function isHumanText(value) {
  const normalized = decodeHtml(value).replace(/\s+/g, " ").trim();
  if (!normalized || !/[\p{L}]/u.test(normalized)) return false;
  return !/^(CQRTV|CS2|Counter-Strike 2|ELO|Steam|FACEIT|RU|EN|RO|ID|K\/D|© CQRTV)$/i.test(normalized);
}
function inspectMarkup(html, path, catalogs = dictionaries, baseline = legacyHtmlBaseline) {
  const errors = [];
  const source = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  for (const match of source.matchAll(/<([a-z][\w:-]*)(\s[^<>]*?)?>([^<>]+)</gi)) {
    const attrs = match[2] || "";
    const text = decodeHtml(match[3]).replace(/\s+/g, " ").trim();
    if (!isHumanText(text) || /\bdata-i18n-ignore(?:=|\s|$)/i.test(attrs)) continue;
    const binding = attrs.match(/\bdata-i18n="([^"]+)"/i)?.[1];
    if (binding) {
      for (const locale of locales) if (!Object.hasOwn(catalogs[locale] || {}, binding)) errors.push(`${path}: missing ${locale} translation for ${binding}`);
    } else if (!Object.hasOwn(catalogs.ru || {}, text) || !baseline.pages?.[path]?.text?.includes(text)) errors.push(`${path}: unbound UI text “${text}”`);
  }
  for (const meta of source.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = Object.fromEntries([...meta[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((item) => [item[1], item[2]]));
    if (attrs.name?.toLowerCase() !== "description") continue;
    const key = attrs["data-i18n-content"];
    const content = decodeHtml(attrs.content || "").trim();
    if (key) {
      for (const locale of locales) if (!Object.hasOwn(catalogs[locale] || {}, key)) errors.push(`${path}: missing ${locale} meta translation for ${key}`);
    } else if (!Object.hasOwn(catalogs.ru || {}, content) || !baseline.pages?.[path]?.metaDescription?.includes(content)) {
      errors.push(`${path}: unbound meta description “${content}”`);
    }
  }
  for (const match of source.matchAll(/<([a-z][\w:-]*)(\s[^<>]*?)?>/gi)) {
    const attrs = match[2] || "";
    const values = Object.fromEntries([...attrs.matchAll(/([\w:-]+)="([^"]*)"/g)].map((item) => [item[1], item[2]]));
    for (const attr of ["aria-label", "title", "placeholder", "alt"]) {
      const value = values[attr];
      if (!value || !isHumanText(value) || /\bdata-i18n-ignore(?:=|\s|$)/i.test(attrs)) continue;
      const binding = values[`data-i18n-${attr}`];
      if (binding) {
        for (const locale of locales) if (!Object.hasOwn(catalogs[locale] || {}, binding)) errors.push(`${path}: missing ${locale} translation for ${binding}`);
      } else if (!Object.hasOwn(catalogs.ru || {}, decodeHtml(value).trim()) || !baseline.pages?.[path]?.attributes?.includes(decodeHtml(value).trim())) errors.push(`${path}: unbound ${attr} “${value}”`);
    }
  }
  return errors;
}

function inspectRawSourceLiterals(source, path, catalogs = dictionaries, allowEmbeddedMarkup = false) {
  const errors = [];
  const baseline = legacyHtmlBaseline.sourceLiterals?.[path] || [];
  for (const literal of source.matchAll(/(["'\x60])((?:\\.|[\s\S])*?)\1/g)) {
    const rawValue = literal[2];
    const phrase = rawValue.trim();
    if (!phrase || phrase.length >= 1000 || !/\p{L}/u.test(phrase)) continue;
    if (allowEmbeddedMarkup) {
      const keys = [...phrase.matchAll(/data-i18n(?:-[\w-]+)?="([\w.-]+)"/g)].map((match) => match[1]);
      if (keys.length) {
        for (const key of keys) if (!Object.values(catalogs).every((catalog) => Object.hasOwn(catalog, key))) errors.push(path + ": unknown embedded translation key " + key);
        continue;
      }
    }
    const semanticKey = Object.values(catalogs).every((catalog) => Object.hasOwn(catalog, phrase));
    if (!semanticKey && !baseline.includes(rawValue)) errors.push(path + ": new raw source literal “" + phrase + "”; use a semantic translation key or add a reviewed non-human exemption");
  }
  for (const reference of source.matchAll(/(?:\.t|\bt|data-i18n(?:-[\w-]+)?)\s*(?:\(|=)\s*["']([\w.-]+)["']/g)) {
    const key = reference[1];
    if (!Object.values(catalogs).every((catalog) => Object.hasOwn(catalog, key))) errors.push(path + ": unknown translation key " + key);
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
  assert.ok(selectRootHtmlEntrypoints([{name:"index.html",isFile:()=>true},{name:"future-page.html",isFile:()=>true},{name:"notes.md",isFile:()=>true}]).includes("future-page.html"),"new root HTML routes are discovered automatically");
  const raw = inspectMarkup("<!doctype html><html lang=\"ru\"><body><main><h1>New competitive dashboard</h1></main></body></html>", "future-page.html");
  assert.ok(raw.some((item) => item.includes("unbound UI text")), "new raw page text must fail CI even if someone adds it to the legacy Russian-keyed catalog");
  const catalogs = {
    ru: { "fixture.dashboard.title": "Новая соревновательная панель", "New competitive dashboard": "Новая панель", "fixture.meta": "Описание" },
    en: { "fixture.dashboard.title": "New competitive dashboard", "fixture.meta": "Description" },
    ro: { "fixture.dashboard.title": "Panou competitiv nou", "fixture.meta": "Descriere" }
  };
  const catalogOnlyRaw = inspectMarkup("<!doctype html><html lang=\"ru\"><body><main><h1>New competitive dashboard</h1></main></body></html>", "future-page.html", catalogs, { pages: {} });
  assert.ok(catalogOnlyRaw.some((item) => item.includes("unbound UI text")), "adding an untranslated literal to the legacy-key catalog cannot bypass semantic binding");
  const semantic = inspectMarkup("<!doctype html><html lang=\"ru\"><head><meta name=\"description\" content=\"Описание\" data-i18n-content=\"fixture.meta\"></head><body><main><h1 data-i18n=\"fixture.dashboard.title\">Новая соревновательная панель</h1></main></body></html>", "future-page.html", catalogs);
  // Validate fixture catalog parity through the same key contract as production catalogs.
  for (const locale of locales) assert.equal(typeof catalogs[locale]["fixture.dashboard.title"], "string");
  assert.deepEqual(semantic, [], "a new page with an authored semantic key should pass");
});

test("future UI source literals require semantic keys", () => {
  const catalogs = {
    ru: { "fixture.panel.title": "Панель пользователя", "fixture.future": "Новая функция" },
    en: { "fixture.panel.title": "User dashboard", "fixture.future": "New feature" },
    ro: { "fixture.panel.title": "Panoul utilizatorului", "fixture.future": "Funcție nouă" }
  };
  for (const rawText of ["Новая функция", "Future dashboard"]) {
    const raw = inspectRawSourceLiterals('const heading = "' + rawText + '";', "assets/future-panel.mjs", catalogs);
    assert.ok(raw.some((item) => item.includes("new raw source literal")), "new raw JS UI text must fail CI regardless of language");
  }
  const semantic = inspectRawSourceLiterals('const heading = t("fixture.panel.title");', "assets/future-panel.mjs", catalogs);
  assert.deepEqual(semantic, [], "new UI text using a stable semantic key with three authored translations should pass");
  const unknown = inspectRawSourceLiterals('const heading = t("fixture.panel.unknown");', "assets/future-panel.mjs", catalogs);
  assert.ok(unknown.some((item) => item.includes("unknown translation key")), "unknown semantic references must fail CI");
});

test("locale catalogs preserve interpolation parameters", () => {
  const placeholders = (value) => [...value.matchAll(/\{([\w]+)\}/g)].map((match) => match[1]).sort();
  for (const [key, russian] of Object.entries(dictionaries.ru)) {
    for (const locale of locales) {
      assert.deepEqual(placeholders(dictionaries[locale][key]), placeholders(russian), `${locale}: placeholder parity for ${key}`);
    }
  }
});

test("fixed client UI literals and semantic references are covered", async () => {
  const clientFiles=["assets/auth-header.mjs","assets/player-experience.mjs","assets/player-profile.mjs","assets/registration-roles.mjs","assets/admin/admin-icons.mjs"];
  const allValues=new Set(Object.values(dictionaries).flatMap((catalog)=>Object.values(catalog)));
  const missing=[];
  for(const path of clientFiles){
    const source=await read(path);
    missing.push(...inspectRawSourceLiterals(source, path));
  }
  assert.deepEqual(missing,[],"client fixed UI literals must have authored translations and every semantic reference must resolve");
});

test("inline page scripts use catalogued fixed UI text and known translation references", async () => {
  const pages=await discoverRootPages();
  const allValues=new Set(Object.values(dictionaries).flatMap((catalog)=>Object.values(catalog)));
  const missing=[];
  for(const path of pages){
    const html=await read(path);
    for(const block of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
      if(/\bsrc=/i.test(block[1]))continue;
      missing.push(...inspectRawSourceLiterals(block[2], "inline:" + path, dictionaries, true));
    }
  }
  assert.deepEqual(missing,[],"inline dynamic UI must use authored translations and known semantic keys");
});
