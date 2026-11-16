import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { classifyLiveHomepage } from "./live-home-smoke.mjs";

const publicHome = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const closedGate = fs.readFileSync(new URL("../site-closed.html", import.meta.url), "utf8");

test("live smoke accepts the approved Phase 1 public homepage", () => {
  assert.equal(classifyLiveHomepage(publicHome), "open");
});

test("live smoke accepts the established Coming Soon and Maintenance gate page", () => {
  assert.equal(classifyLiveHomepage(closedGate), "coming-soon-or-maintenance");
});

test("live smoke rejects unrelated pages and invalid text", () => {
  assert.throws(() => classifyLiveHomepage("<html><body>Not CQRTV</body></html>"), /neither the approved CQRTV/);
  assert.throws(() => classifyLiveHomepage("<html>�</html>"), /not valid CQRTV HTML/);
});
