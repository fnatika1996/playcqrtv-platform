import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
const pickerStart = html.indexOf("const countrySelect=document.getElementById");
const pickerEnd = html.indexOf("const signupDialog=", pickerStart);
const formStart = html.indexOf("signupForm.addEventListener(\"submit\",async event=>{", pickerEnd);
const formEnd = html.indexOf("\n\n\nconst nicknameDialog", formStart);
assert.ok(pickerStart >= 0 && pickerEnd > pickerStart, "registration country picker source exists");
assert.ok(formStart > pickerEnd && formEnd > formStart, "registration submit handler exists");
const pickerScript = html.slice(pickerStart, pickerEnd);
const submitScript = html.slice(formStart, formEnd);

function makeNode(initial = {}) {
  const listeners = new Map();
  return Object.assign({
    value: "", textContent: "", hidden: false, disabled: false, src: "", alt: "",
    children: [], attributes: {}, classList: {
      add() {}, remove() {}, toggle() {},
    },
    addEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    async emit(type, event = {}) {
      for (const listener of listeners.get(type) || []) await listener({ target: this, ...event });
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    focus() { this.focused = true; },
    scrollIntoView() {},
    setCustomValidity(message) { this.validationMessage = message; },
    reportValidity() { return !this.validationMessage; },
    closest() { return null; },
  }, initial);
}

function createPage(fetchImpl) {
  const placeholder = { value: "", textContent: "Выберите страну" };
  const select = makeNode({ options: [placeholder], append(...options) { this.options.push(...options); } });
  Object.defineProperty(select, "value", {
    get() { return this.options.find(option => option.selected)?.value ?? this._value ?? ""; },
    set(value) {
      const option = this.options.find(item => item.value === value);
      this.options.forEach(item => { item.selected = false; });
      this._value = option ? value : "";
      if (option) option.selected = true;
    },
  });
  const countryField = makeNode();
  const countryStatus = makeNode();
  const countryButton = makeNode();
  const countryMenu = makeNode({ hidden: true });
  const countrySearch = makeNode();
  const countryOptions = makeNode();
  const countryName = makeNode({ textContent: "Выберите страну" });
  const countryFlag = makeNode({ src: "https://flagcdn.com/w40/un.png" });
  const password = makeNode({ value: "ValidPassword123!", validationMessage: "" });
  const confirmation = makeNode({ value: "ValidPassword123!", validationMessage: "" });
  const nickname = makeNode({ value: "PlayerOne" });
  const nicknameStatus = makeNode();
  const signupStatus = makeNode();
  const successEmail = makeNode();
  const successDialog = makeNode({ showModal() { this.open = true; } });
  const signupDialog = makeNode({ close() { this.open = false; } });
  const submitButton = makeNode();
  const fields = {
    nickname: "PlayerOne", email: "player@example.test", password: password.value,
    passwordConfirm: confirmation.value, country: select.value, primaryRole: "rifler",
    secondaryRoles: [], terms: "on",
  };
  const formListeners = new Map();
  const form = makeNode({
    elements: { password, passwordConfirm: confirmation },
    addEventListener(type, listener) {
      const listeners = formListeners.get(type) || [];
      listeners.push(listener); formListeners.set(type, listeners);
    },
    querySelector() { return submitButton; },
    reportValidity() { return true; },
    reset() {
      select.value = "";
      fields.country = "";
    },
  });
  const ids = {
    "signup-country": select, "country-status": countryStatus,
    "country-picker-button": countryButton, "country-menu": countryMenu,
    "country-search": countrySearch, "country-options": countryOptions,
    "country-selected-name": countryName, "country-selected-flag": countryFlag,
    "signup-dialog": signupDialog, "signup-form": form, "signup-status": signupStatus,
    "signup-nickname": nickname, "nickname-status": nicknameStatus,
    "signup-success-dialog": successDialog, "signup-success-email": successEmail,
  };
  const calls = [];
  const formDataCountries = [];
  const document = {
    getElementById(id) { return ids[id] || makeNode(); },
    querySelector(selector) {
      if (selector === ".country-field") return countryField;
      if (selector.startsWith("[data-password-rule=")) return makeNode();
      return makeNode();
    },
    querySelectorAll() { return []; },
    createElement(tag) {
      const el = makeNode({ tag });
      if (tag === "option") {
        Object.defineProperty(el, "selected", { value: false, writable: true });
      }
      return el;
    },
    createTextNode(text) { return { textContent: text }; },
    addEventListener() {},
  };
  class TestFormData {
    constructor() {
      fields.country = select.value;
      formDataCountries.push(fields.country);
      this.values = { ...fields };
    }
    get(key) { return this.values[key] ?? null; }
    getAll(key) { return key === "secondaryRoles" ? this.values.secondaryRoles : []; }
  }
  const context = vm.createContext({
    document, Intl, URL, URLSearchParams, FormData: TestFormData,
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      return fetchImpl(url, options);
    },
    setTimeout, clearTimeout, console,
    validatePasswordStrength: () => true,
    validatePasswordMatch: () => {},
    checkNickname: async () => true,
  });
  vm.runInContext(pickerScript, context);
  vm.runInContext('const signupDialog=document.getElementById("signup-dialog"),signupForm=document.getElementById("signup-form"),signupStatus=document.getElementById("signup-status"),nicknameInput=document.getElementById("signup-nickname"),nicknameStatus=document.getElementById("nickname-status");const signupSuccessDialog=document.getElementById("signup-success-dialog"),signupSuccessEmail=document.getElementById("signup-success-email");', context);
  vm.runInContext(submitScript, context);
  return { select, countryButton, countryOptions, countryName, countryFlag, countryStatus, countryField, form, formListeners, fields, calls, formDataCountries };
}

function response(ok, body) {
  return { ok, async json() { return body; } };
}

test("choosing and changing a country keeps picker, select, FormData, and registration payload synchronized", async () => {
  const page = createPage(async () => response(true, { message: "ok" }));
  await page.countryButton.emit("click");
  const ruOption = page.countryOptions.children.find(option => option.getAttribute?.("data-code") === "RU")
    || page.countryOptions.children.find(option => option.children.some(child => child.textContent === "Россия"));
  assert.ok(ruOption, "country picker renders Russia as a selectable option");
  await ruOption.emit("click");
  assert.equal(page.select.value, "RU");
  assert.equal(page.countryName.textContent, "Россия");
  assert.match(page.countryFlag.src, /ru\.png$/);

  await page.countryButton.emit("click");
  const selectedRu = page.countryOptions.children.find(option => option.children.some(child => child.textContent === "Россия"));
  assert.equal(selectedRu.attributes["aria-selected"], "true");
  const deOption = page.countryOptions.children.find(option => option.children.some(child => child.textContent === "Германия"));
  assert.ok(deOption, "reopened picker renders Germany");
  await deOption.emit("click");
  assert.equal(page.select.value, "DE");
  assert.equal(page.countryName.textContent, "Германия");
  assert.match(page.countryFlag.src, /de\.png$/);

  await page.formListeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(page.calls.length, 1);
  assert.equal(page.calls[0].url, "/api/auth/register");
  assert.deepEqual(page.formDataCountries, ["DE"]);
  const payload = JSON.parse(page.calls[0].options.body);
  assert.equal(payload.country, "DE");
  assert.equal(page.countryName.textContent, "Выберите страну");
  assert.equal(page.select.value, "");
  assert.match(page.countryFlag.src, /un\.png$/);
});

test("submitting without a country shows validation and never sends registration", async () => {
  const page = createPage(async () => response(true, { message: "should not send" }));
  await page.formListeners.get("submit")[0]({ preventDefault() {} });
  assert.equal(page.calls.length, 0);
  assert.equal(page.countryStatus.textContent, "Выберите страну из списка, чтобы продолжить.");
  assert.ok(page.countryField.classList);
  assert.equal(page.countryButton.focused, true);
});
