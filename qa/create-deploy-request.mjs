import crypto from "node:crypto";
import fs from "node:fs";

function fail() {
  console.error("Could not create a valid signed CQRTV deployment request.");
  process.exit(1);
}

const manifestPath = process.argv[2];
if (!manifestPath) fail();

const env = process.env;
const shaPattern = /^[a-f0-9]{40}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const webPattern = /^ghcr\.io\/fnatika1996\/playcqrtv-platform@sha256:[a-f0-9]{64}$/;
const apiPattern = /^ghcr\.io\/fnatika1996\/playcqrtv-api@sha256:[a-f0-9]{64}$/;

if (env.PROJECT_NAME !== "playcqrtv" ||
    env.CQRTV_PROJECT_ROOT !== "/docker/playcqrtv" ||
    !shaPattern.test(env.RELEASE_SHA || "") ||
    !/^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID || "") ||
    !["true", "false"].includes(env.LEGACY_HANDOFF_APPROVED || "") ||
    !webPattern.test(env.WEB_IMAGE_REF || "") ||
    !apiPattern.test(env.API_IMAGE_REF || "") ||
    !/^[A-Za-z0-9._-]{1,120}$/.test(env.BACKUP_REFERENCE || "") ||
    !/^[a-f0-9]{64}$/.test(env.BACKUP_SHA256 || "") ||
    env.BACKUP_VERIFIED !== "true" ||
    !webPattern.test(env.PREVIOUS_WEB_REF || "") ||
    !apiPattern.test(env.PREVIOUS_API_REF || "")) fail();

let stat;
let manifest;
try {
  stat = fs.lstatSync(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 256 * 1024) fail();
  manifest = fs.readFileSync(manifestPath);
} catch {
  fail();
}

const text = manifest.toString("utf8");
const expectedWebLine = `    image: ${env.WEB_IMAGE_REF}`;
const expectedApiLine = `    image: ${env.API_IMAGE_REF}`;
if ((text.match(new RegExp(expectedWebLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length !== 1 ||
    (text.match(new RegExp(expectedApiLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length !== 1 ||
    text.includes(":latest") ||
    !text.includes("pull_policy: missing")) fail();

const payload = {
  schema_version: 2,
  release_sha: env.RELEASE_SHA,
  run_id: env.GITHUB_RUN_ID,
  project_root: env.CQRTV_PROJECT_ROOT,
  manifest_sha256: crypto.createHash("sha256").update(manifest).digest("hex"),
  web_image_ref: env.WEB_IMAGE_REF,
  api_image_ref: env.API_IMAGE_REF,
  backup_reference: env.BACKUP_REFERENCE,
  backup_sha256: env.BACKUP_SHA256,
  backup_verified: true,
  previous_web_ref: env.PREVIOUS_WEB_REF,
  previous_api_ref: env.PREVIOUS_API_REF,
  legacy_handoff_approved: env.LEGACY_HANDOFF_APPROVED === "true"
};
process.stdout.write(JSON.stringify(payload) + "\n");
