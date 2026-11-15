import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setImmediate as nextTurn } from "node:timers/promises";
import { test } from "node:test";
import vm from "node:vm";
import { passwordError } from "../password-policy.mjs";

const authHtml = await readFile(new URL("../../auth.html", import.meta.url), "utf8");
const serverSource = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const inlineScript = authHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(inlineScript, "auth.html has an inline account-flow script");

function makeInput(value = "", required = false) {
  const listeners = new Map();
  return {
    value, required, hidden: false, validationMessage: "", customValidity: "",
    addEventListener(type, listener) { listeners.set(type, listener); },
    setCustomValidity(message) { this.customValidity = message; this.validationMessage = message; },
    reportValidity() { this.reported = true; return !this.customValidity; },
    emit(type) { listeners.get(type)?.({ target: this }); },
  };
}

function makePage(mode, fetchImpl = async () => response(true, { message: "ok" }), token = "test-token") {
  const calls = [];
  const input = {
    email: makeInput("player@example.test", true),
    password: makeInput("LoginPassword123!", true),
    newPassword: makeInput(""),
  };
  const formListeners = new Map();
  const form = {
    hidden: false, elements: input,
    addEventListener(type, listener) { formListeners.set(type, listener); },
    querySelector() { return button; },
  };
  const status = { textContent: "" };
  const title = { textContent: "" };
  const desc = { textContent: "" };
  const button = { textContent: "", hidden: false, disabled: false };
  const email = { hidden: false };
  const password = { hidden: false };
  const tokenRow = { hidden: true };
  const signup = { hidden: false, href: "" };
  const forgottenLinkParent = { before(link) { this.inserted = link; } };
  const nodes = {
    "#form": form, "#status": status, "#title": title, "#desc": desc, "#submit": button,
    "#emailrow": email, "#passwordrow": password, "#tokenrow": tokenRow, "#signup": signup,
    ".links": forgottenLinkParent,
  };
  const document = {
    querySelector(selector) { return nodes[selector]; },
    createElement() { return { style: {}, href: "", textContent: "" }; },
  };
  const location = { search: mode ? `?mode=${mode}&token=${token}` : "", href: "" };
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return fetchImpl(url, options);
  };
  vm.runInNewContext(inlineScript, {
    URLSearchParams, JSON, document, location, fetch,
    setTimeout: callback => { callback(); return 1; },
    console,
  });
  return {
    calls, form, input, status, title, desc, button, email, password, tokenRow, signup, location,
    async submit() {
      const handler = formListeners.get("submit");
      assert.ok(handler, "submit listener is attached");
      let prevented = false;
      await handler({ preventDefault() { prevented = true; } });
      assert.ok(prevented, "submission is handled by the page script");
    },
  };
}

function response(ok, body) {
  return { ok, status: ok ? 200 : 400, async json() { return body; } };
}

test("password policy covers registration and reset requirements", () => {
  assert.equal(passwordError("ValidPassword123!"), "");
  assert.match(passwordError("short"), /12 до 128/);
  assert.match(passwordError("lowercasepassword123!"), /заглавной/);
  assert.match(passwordError("UPPERCASE123!"), /строчную/);
  assert.match(passwordError("NoDigitsHere!!"), /цифру/);
  assert.match(passwordError("MissingSymbol123"), /специальный символ/);
  assert.match(passwordError("ValidPassword123!".repeat(9)), /12 до 128/);
  assert.equal(passwordError("ЖиваяСтрока123!"), "");
});

test("server applies the shared password policy to registration and reset before hashing", () => {
  assert.equal((serverSource.match(/passwordError\(password\)/g) || []).length, 2);
  const resetStart = serverSource.indexOf('url.pathname==="/api/auth/reset"');
  const resetPolicy = serverSource.indexOf("const passwordIssue=passwordError(password)", resetStart);
  const passwordHash = serverSource.indexOf("hashPassword(password)", resetStart);
  assert.ok(resetStart >= 0 && resetPolicy > resetStart && passwordHash > resetPolicy);
});

test("login submits credentials through the existing login route", async () => {
  const page = makePage("", async () => response(true, { message: "Вы вошли." }));
  await page.submit();
  assert.equal(page.calls[0].url, "/api/auth/login");
  assert.deepEqual(JSON.parse(page.calls[0].options.body), {
    email: "player@example.test", password: "LoginPassword123!",
  });
  assert.equal(page.location.href, "/");
});

test("login displays rejected credentials without redirecting", async () => {
  const page = makePage("", async () => response(false, { error: "Неверный email или пароль." }));
  await page.submit();
  assert.equal(page.status.textContent, "Неверный email или пароль.");
  assert.equal(page.location.href, "");
});

test("forgot mode submits with hidden password no longer required", async () => {
  const page = makePage("forgot", async () => response(true, { message: "Письмо отправлено." }));
  assert.equal(page.password.hidden, true);
  assert.equal(page.input.password.required, false);
  assert.equal(page.input.email.required, true);
  await page.submit();
  assert.equal(page.calls[0].url, "/api/auth/forgot");
  assert.deepEqual(JSON.parse(page.calls[0].options.body), { email: "player@example.test" });
});

test("reset mode submits valid password with hidden required fields disabled", async () => {
  const page = makePage("reset", async () => response(true, { message: "Пароль изменён." }));
  assert.equal(page.email.hidden, true);
  assert.equal(page.password.hidden, true);
  assert.equal(page.input.email.required, false);
  assert.equal(page.input.password.required, false);
  assert.equal(page.input.newPassword.required, true);
  page.input.newPassword.value = "ValidPassword123!";
  page.input.newPassword.emit("input");
  await page.submit();
  assert.equal(page.calls[0].url, "/api/auth/reset");
  assert.deepEqual(JSON.parse(page.calls[0].options.body), {
    token: "test-token", password: "ValidPassword123!",
  });
});

test("reset mode rejects a password that fails client policy", async () => {
  const page = makePage("reset");
  page.input.newPassword.value = "lowercasepassword123!";
  page.input.newPassword.emit("input");
  await page.submit();
  assert.equal(page.calls.length, 0);
  assert.match(page.status.textContent, /заглавной/);
  assert.match(passwordError(page.input.newPassword.value), /заглавной/);
});

test("reset client policy agrees with the server policy for each rule", async () => {
  const cases = [
    ["short", /12 до 128/],
    ["lowercasepassword123!", /заглавной/],
    ["UPPERCASE123!", /строчную/],
    ["NoDigitsHere!!", /цифру/],
    ["MissingSymbol123", /специальный символ/],
  ];
  for (const [value, expected] of cases) {
    const page = makePage("reset");
    page.input.newPassword.value = value;
    page.input.newPassword.emit("input");
    await page.submit();
    assert.equal(page.calls.length, 0);
    assert.match(page.status.textContent, expected);
    assert.equal(page.input.newPassword.validationMessage, passwordError(value));
  }
});

test("verify mode displays successful confirmation", async () => {
  const page = makePage("verify", async () => response(true, { message: "Email подтверждён." }));
  assert.equal(page.form.hidden, false);
  assert.equal(page.button.hidden, true);
  assert.equal(page.input.email.required, false);
  await nextTurn();
  await nextTurn();
  assert.equal(page.calls[0].url, "/api/auth/verify");
  assert.equal(page.status.textContent, "Email подтверждён.");
});

test("verify mode displays invalid-token errors", async () => {
  const page = makePage("verify", async () => response(false, { error: "Ссылка недействительна или уже использована." }));
  await nextTurn();
  await nextTurn();
  assert.equal(page.status.textContent, "Ссылка недействительна или уже использована.");
});

test("verify mode displays network errors", async () => {
  const page = makePage("verify", async () => { throw new Error("offline"); });
  await nextTurn();
  await nextTurn();
  assert.match(page.status.textContent, /Проверьте соединение/);
});

test("reset mode displays invalid-token responses", async () => {
  const page = makePage("reset", async () => response(false, { error: "Ссылка недействительна или устарела." }));
  page.input.newPassword.value = "ValidPassword123!";
  page.input.newPassword.emit("input");
  await page.submit();
  assert.equal(page.status.textContent, "Ссылка недействительна или устарела.");
});


