import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "create-deploy-status-request.mjs");

test("status request binds an opaque workflow run ID to read-only status operation", () => {
  const result = spawnSync(process.execPath, [script], { encoding: "utf8", env: { ...process.env, GITHUB_RUN_ID: "123456" } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { schema_version: 1, operation: "status", run_id: "123456" });
});

test("status request rejects missing or malformed workflow run IDs", () => {
  for (const value of ["", "0", "../etc/passwd", "1\noperation=deploy"]) {
    const result = spawnSync(process.execPath, [script], { encoding: "utf8", env: { ...process.env, GITHUB_RUN_ID: value } });
    assert.notEqual(result.status, 0);
  }
});
