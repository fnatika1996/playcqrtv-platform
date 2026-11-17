import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builder = path.join(repoRoot, "qa", "create-staging-deploy-request.mjs");
const webDigest = "sha256:" + "a".repeat(64);
const apiDigest = "sha256:" + "b".repeat(64);
const env = {
  ...process.env,
  PROJECT_NAME: "cqrtv-v2-staging",
  CQRTV_PROJECT_ROOT: "/opt/cqrtv-v2-staging",
  RELEASE_SHA: "c".repeat(40),
  GITHUB_RUN_ID: "123456",
  LEGACY_HANDOFF_APPROVED: "false",
  WEB_IMAGE_REF: "127.0.0.1:5000/cqrtv-v2-staging-web@" + webDigest,
  API_IMAGE_REF: "127.0.0.1:5000/cqrtv-v2-staging-api@" + apiDigest,
  PREVIOUS_WEB_REF: "127.0.0.1:5000/cqrtv-v2-staging-web@sha256:" + "d".repeat(64),
  PREVIOUS_API_REF: "127.0.0.1:5000/cqrtv-v2-staging-api@sha256:" + "e".repeat(64),
};

function invoke(manifestPath, overrides = {}) {
  return spawnSync(process.execPath, [builder, manifestPath], {
    encoding: "utf8",
    env: { ...env, ...overrides },
  });
}

function validManifest() {
  return [
    "services:",
    "  api:",
    "    image: " + env.API_IMAGE_REF,
    "    pull_policy: never",
    "  caddy:",
    "    image: " + env.WEB_IMAGE_REF,
    "    pull_policy: never",
    "",
  ].join("\n");
}

test("request builder binds fixed project, exact digest refs and manifest hash", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cqrtv-request-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const manifestPath = path.join(directory, "docker-compose.release.yml");
  const manifest = validManifest();
  fs.writeFileSync(manifestPath, manifest, { mode: 0o600 });
  const result = invoke(manifestPath);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schema_version, 2);
  assert.equal(payload.legacy_handoff_approved, false);
  assert.equal(payload.project_root, "/opt/cqrtv-v2-staging");
  assert.equal(payload.web_image_ref, env.WEB_IMAGE_REF);
  assert.equal(payload.api_image_ref, env.API_IMAGE_REF);
  assert.equal(payload.manifest_sha256, crypto.createHash("sha256").update(manifest).digest("hex"));
});

test("request builder rejects symlinks, mutable images and mismatched refs", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cqrtv-request-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const realPath = path.join(directory, "manifest.yml");
  fs.writeFileSync(realPath, validManifest());
  const linkPath = path.join(directory, "linked.yml");
  fs.symlinkSync(realPath, linkPath);
  assert.notEqual(invoke(linkPath).status, 0);
  fs.writeFileSync(realPath, validManifest().replace(env.API_IMAGE_REF, "ghcr.io/attacker/api:latest"));
  assert.notEqual(invoke(realPath).status, 0);
  fs.writeFileSync(realPath, validManifest());
  assert.notEqual(invoke(realPath, { CQRTV_PROJECT_ROOT: "/tmp/attacker" }).status, 0);
  assert.notEqual(invoke(realPath, { WEB_IMAGE_REF: "127.0.0.1:5000/cqrtv-v2-staging-web:latest" }).status, 0);
  assert.notEqual(invoke(realPath, { LEGACY_HANDOFF_APPROVED: "yes" }).status, 0);
  const approved = invoke(realPath, { LEGACY_HANDOFF_APPROVED: "true" });
  assert.equal(approved.status, 0, approved.stderr);
  assert.equal(JSON.parse(approved.stdout).legacy_handoff_approved, true);
});

test("staging request builder rejects production project and registry identities", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cqrtv-staging-request-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const manifestPath = path.join(directory, "manifest.yml");
  fs.writeFileSync(manifestPath, validManifest());
  assert.notEqual(invoke(manifestPath, { PROJECT_NAME: "playcqrtv" }).status, 0);
  assert.notEqual(invoke(manifestPath, { WEB_IMAGE_REF: "ghcr.io/fnatika1996/playcqrtv-platform@sha256:" + "a".repeat(64) }).status, 0);
});
