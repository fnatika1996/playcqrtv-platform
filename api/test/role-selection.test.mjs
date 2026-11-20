import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { bindRegistrationRoles } from "../../assets/registration-roles.mjs";

const indexHtml = await readFile(new URL("../../index.html", import.meta.url), "utf8");
const apiSource = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const roleValues = ["awper", "entry", "rifler", "support", "igl"];

function input(value) {
  const listeners = new Map();
  return {
    value, checked: false, disabled: false,
    addEventListener(type, callback) { listeners.set(type, callback); },
    emit(type = "change") { listeners.get(type)?.({ target: this }); },
  };
}

function button() {
  const listeners = new Map();
  return {
    disabled: false,
    addEventListener(type, callback) { listeners.set(type, callback); },
    click() { listeners.get("click")?.({ target: this }); },
  };
}

function makeForm() {
  const primary = roleValues.map(input);
  const secondary = roleValues.map(input);
  const counter = { textContent: "" };
  const reset = button();
  const otherField = { value: "keep this value" };
  const formListeners = new Map();
  return {
    primary, secondary, counter, reset, otherField,
    querySelectorAll(selector) {
      if (selector === 'input[name="primaryRole"]') return primary;
      if (selector === 'input[name="secondaryRoles"]') return secondary;
      return [];
    },
    querySelector(selector) {
      if (selector === "#secondary-role-counter") return counter;
      if (selector === "#secondary-role-reset") return reset;
      return null;
    },
    addEventListener(type, callback) { formListeners.set(type, callback); },
    emit(type) { formListeners.get(type)?.({ type }); },
  };
}

function signupRoleBlock(name) {
  const start = indexHtml.indexOf(`<fieldset class="signup-role-section${name === "secondaryRoles" ? " signup-secondary" : ""}"`);
  const end = indexHtml.indexOf("</fieldset>", start);
  assert.notEqual(start, -1, `${name} block exists`);
  assert.notEqual(end, -1, `${name} block closes`);
  return indexHtml.slice(start, end);
}

test("both role blocks offer only the five approved roles, keep primary required, and pass secondaryRoles to the API", () => {
  for (const name of ["primaryRole", "secondaryRoles"]) {
    const block = signupRoleBlock(name);
    const values = [...block.matchAll(new RegExp(`name="${name}" value="([^"]+)"`, "g"))].map(match => match[1]);
    assert.deepEqual(values, roleValues);
    assert.equal((block.match(/class="role-icon pack-icon/g) || []).length, 5);
    assert.equal((block.match(/class="role-indicator"/g) || []).length, 5);
  }
  assert.match(signupRoleBlock("primaryRole"), /name="primaryRole" value="awper" required/);
  assert.match(signupRoleBlock("secondaryRoles"), /id="secondary-role-counter"[^>]*>0\/2/);
  assert.match(signupRoleBlock("secondaryRoles"), /id="secondary-role-reset"[^>]*>Сбросить/);
  assert.match(indexHtml, /secondaryRoles:fd\.getAll\("secondaryRoles"\)/);
  assert.match(apiSource, /secondary\.length>2\|\|secondary\.some\(x=>!roles\.has\(x\)\|\|x===primaryRole\)/);
});

test("role cards use the approved compact grid, colors, radius, and responsive single-column layout", () => {
  assert.match(indexHtml, /\.signup-dialog \.signup-role-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:8px\}/);
  assert.match(indexHtml, /\.role-option>span\{[^}]*border-radius:8px;[^}]*background:#1C1E23/s);
  assert.match(indexHtml, /\.role-option:has\(input:checked\)>span\{border-color:var\(--role-color\);background:var\(--role-bg\)/);
  assert.match(indexHtml, /@media\(max-width:390px\)\{\.signup-dialog \.signup-role-grid\{grid-template-columns:1fr;gap:8px\}\}/);
});

test("role cards use distinct approved icons and role colors in both groups", () => {
  const roleStyles = { awper: ["#C09AFF", "#29203A"], entry: ["#FF7777", "#321D21"], rifler: ["#6BB7FF", "#172638"], support: ["#71D5A2", "#183027"], igl: ["#FFD16B", "#332C1D"] };
  const icons = new Map();
  for (const [role, [accent, selectedBackground]] of Object.entries(roleStyles)) {
    const labels = [...indexHtml.matchAll(new RegExp(`<label class="role-option" data-role="${role}">([\\s\\S]*?)</label>`, "g"))].map(match => match[1]);
    assert.equal(labels.length, 2, `${role} has primary and secondary cards`);
    const iconSignatures = labels.map(label => {
      const pack = label.match(/class="role-icon pack-icon" data-src="([^"]+)"/);
      if (pack) return `pack:${pack[1]}`;
      const start = label.indexOf("<svg"); const end = label.indexOf("</svg>", start) + 6;
      return start >= 0 && end > 5 ? `inline:${label.slice(start, end)}` : "";
    });
    assert.ok(iconSignatures.every(Boolean), `${role} has an icon in both groups`);
    assert.equal(iconSignatures[0], iconSignatures[1], `${role} icon matches across groups`);
    if (role === "support") assert.equal(iconSignatures[0], "pack:/assets/icons/cqrtv/ui/shield.svg", "Support uses the archive's matching shield-check icon");
    else assert.match(iconSignatures[0], /^inline:<svg[\s\S]*stroke="currentColor"/, `${role} keeps its distinct role glyph because the pack has no semantic match`);
    assert.match(labels[0], /aria-hidden="true"/);
    icons.set(role, iconSignatures[0]);
    assert.ok(indexHtml.includes(`.signup-dialog .role-option[data-role="${role}"]{--role-color:${accent};--role-bg:${selectedBackground}`));
  }
  assert.equal(new Set(icons.values()).size, 5, "each role has a unique icon");
  assert.ok(indexHtml.includes(":has(input:checked)>span{border-color:var(--role-color);background:var(--role-bg)"));
});

test("counter updates at 0/2, 1/2, and 2/2; at two choices only selected options remain enabled", () => {
  const form = makeForm();
  bindRegistrationRoles(form);
  assert.equal(form.counter.textContent, "0/2");

  form.secondary[0].checked = true;
  form.secondary[0].emit();
  assert.equal(form.counter.textContent, "1/2");

  form.secondary[1].checked = true;
  form.secondary[1].emit();
  assert.equal(form.counter.textContent, "2/2");
  assert.equal(form.secondary[0].disabled, false);
  assert.equal(form.secondary[1].disabled, false);
  assert.equal(form.secondary[2].disabled, true);

  form.secondary[0].checked = false;
  form.secondary[0].emit();
  assert.equal(form.counter.textContent, "1/2");
  assert.equal(form.secondary[2].disabled, false);
});

test("primary role is always excluded from secondary choices and changing it clears a conflict", () => {
  const form = makeForm();
  bindRegistrationRoles(form);
  form.secondary[1].checked = true;
  form.secondary[1].emit();

  form.primary[1].checked = true;
  form.primary[1].emit();
  assert.equal(form.secondary[1].checked, false);
  assert.equal(form.secondary[1].disabled, true);
  assert.equal(form.counter.textContent, "0/2");

  form.primary[1].checked = false;
  form.primary[2].checked = true;
  form.primary[2].emit();
  assert.equal(form.secondary[1].disabled, false);
});

test("secondary reset clears only additional roles and preserves the primary role and other form values", () => {
  const form = makeForm();
  bindRegistrationRoles(form);
  form.primary[0].checked = true;
  form.primary[0].emit();
  form.secondary[1].checked = true;
  form.secondary[1].emit();
  form.secondary[2].checked = true;
  form.secondary[2].emit();

  form.reset.click();
  assert.equal(form.counter.textContent, "0/2");
  assert.equal(form.reset.disabled, true);
  assert.equal(form.primary[0].checked, true);
  assert.equal(form.secondary.every(option => !option.checked), true);
  assert.equal(form.secondary[0].disabled, true);
  assert.equal(form.otherField.value, "keep this value");
});

test("native form reset refreshes role state after the browser restores default values", async () => {
  const form = makeForm();
  bindRegistrationRoles(form);
  form.primary[0].checked = true;
  form.primary[0].emit();
  assert.equal(form.secondary[0].disabled, true);

  form.primary[0].checked = false;
  form.emit("reset");
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(form.secondary[0].disabled, false);
  assert.equal(form.counter.textContent, "0/2");
});

