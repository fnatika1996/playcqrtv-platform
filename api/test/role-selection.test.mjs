import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { bindRegistrationRoles } from "../../assets/registration-roles.mjs";

const indexHtml = await readFile(new URL("../../index.html", import.meta.url), "utf8");
const apiSource = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const roleValues = ["rifler", "entry", "support", "awper", "igl", "lurker", "anchor", "flex"];

function input(value) {
  const listeners = new Map();
  return {
    value, checked: false, disabled: false,
    addEventListener(type, callback) { listeners.set(type, callback); },
    emit(type = "change") { listeners.get(type)?.({ target: this }); },
  };
}

function makeForm() {
  const primary = roleValues.map(input);
  const secondary = roleValues.map(input);
  const status = { textContent: "" };
  const formListeners = new Map();
  return {
    primary, secondary, status,
    querySelectorAll(selector) {
      if (selector === 'input[name="primaryRole"]') return primary;
      if (selector === 'input[name="secondaryRoles"]') return secondary;
      return [];
    },
    querySelector(selector) { return selector === "#secondary-role-status" ? status : null; },
    addEventListener(type, callback) { formListeners.set(type, callback); },
    emit(type) { formListeners.get(type)?.({ type }); },
  };
}

test("registration keeps one required primary role and offers the same eight roles as optional secondary checkboxes", () => {
  const primary = [...indexHtml.matchAll(/name="primaryRole" value="([^"]+)"/g)].map(match => match[1]);
  const secondary = [...indexHtml.matchAll(/name="secondaryRoles" value="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(primary, roleValues);
  assert.deepEqual(secondary, roleValues);
  assert.match(indexHtml, /name="primaryRole" value="rifler" required/);
  assert.match(indexHtml, /class="signup-role-section signup-secondary"/);
  assert.match(indexHtml, /\.signup-secondary \.signup-role-grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}/);
  assert.match(indexHtml, /\.signup-role-grid,\.signup-secondary \.signup-role-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
});

test("registration sends the selected optional roles using the API's existing contract", () => {
  assert.match(indexHtml, /secondaryRoles:fd\.getAll\("secondaryRoles"\)/);
  assert.match(apiSource, /secondary\.length>2\|\|secondary\.some\(x=>!roles\.has\(x\)\|\|x===primaryRole\)/);
});

test("secondary roles are optional, capped at two, and duplicate primary role is disabled and cleared", () => {
  const form = makeForm();
  bindRegistrationRoles(form);
  assert.match(form.status.textContent, /до двух/);

  const supportSecondary = form.secondary[2];
  supportSecondary.checked = true;
  supportSecondary.emit();
  assert.match(form.status.textContent, /1 из 2/);

  const awperSecondary = form.secondary[3];
  awperSecondary.checked = true;
  awperSecondary.emit();
  assert.match(form.status.textContent, /2 из 2/);

  const entrySecondary = form.secondary[1];
  entrySecondary.checked = true;
  entrySecondary.emit();
  assert.equal(entrySecondary.checked, false);
  assert.match(form.status.textContent, /не более двух/);

  const supportPrimary = form.primary[2];
  supportPrimary.checked = true;
  supportPrimary.emit();
  assert.equal(supportSecondary.checked, false);
  assert.equal(supportSecondary.disabled, true);
  assert.equal(awperSecondary.disabled, false);
});

test("changing the primary role clears a conflicting secondary selection", () => {
  const form = makeForm();
  bindRegistrationRoles(form);
  const entrySecondary = form.secondary[1];
  entrySecondary.checked = true;
  entrySecondary.emit();

  const entryPrimary = form.primary[1];
  entryPrimary.checked = true;
  entryPrimary.emit();
  assert.equal(entrySecondary.checked, false);
  assert.equal(entrySecondary.disabled, true);

  const riflerPrimary = form.primary[0];
  entryPrimary.checked = false;
  riflerPrimary.checked = true;
  riflerPrimary.emit();
  assert.equal(entrySecondary.disabled, false);
});

test("form reset clears the primary-role exclusion state", async () => {
  const form = makeForm();
  bindRegistrationRoles(form);
  form.primary[0].checked = true;
  form.primary[0].emit();
  assert.equal(form.secondary[0].disabled, true);

  form.primary[0].checked = false;
  form.emit("reset");
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(form.secondary[0].disabled, false);
  assert.match(form.status.textContent, /до двух/);
});

