import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const renderer = path.join(repoRoot, "qa", "pin-compose-digests.mjs");
const sourceCompose = path.join(repoRoot, "docker-compose.yml");
const deploymentWorkflow = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "deploy.yml"), "utf8");
const prWorkflow = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "auth-tests.yml"), "utf8");
const webDigest = `sha256:${"a".repeat(64)}`;
const apiDigest = `sha256:${"b".repeat(64)}`;

function render(directory, web = webDigest, api = apiDigest, filename = "docker-compose.release.yml") {
  const output = path.join(directory, filename);
  const result = spawnSync(process.execPath, [renderer, sourceCompose, output, web, api], { encoding: "utf8" });
  return { output, result };
}

test("renderer fails closed when either digest is missing or malformed", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cqrtv-compose-invalid-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  for (const [web, api] of [[webDigest, ""], ["", apiDigest], ["sha256:bad", apiDigest], [webDigest, "sha256:bad"]]) {
    const { output } = render(directory, webDigest, apiDigest);
    fs.writeFileSync(output, "stale deployable manifest");
    const failed = render(directory, web, api);
    assert.notEqual(failed.result.status, 0, "invalid or incomplete digest input must fail");
    assert.equal(fs.existsSync(output), false, "failed render must not leave a deployable output");
  }
});

test("rendered release and rollback manifests contain exactly pinned web/API refs and preserve Compose state", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cqrtv-compose-valid-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { output, result } = render(directory);
  assert.equal(result.status, 0, result.stderr);

  const json = JSON.parse(execFileSync("docker", ["compose", "-f", output, "config", "--format", "json"], { cwd: repoRoot, encoding: "utf8" }));
  const images = execFileSync("docker", ["compose", "-f", output, "config", "--images"], { cwd: repoRoot, encoding: "utf8" })
    .trim().split(/\r?\n/).filter(Boolean);
  const expectedWeb = `ghcr.io/fnatika1996/playcqrtv-platform@${webDigest}`;
  const expectedApi = `ghcr.io/fnatika1996/playcqrtv-api@${apiDigest}`;

  assert.equal(json.services.api.image, expectedApi);
  assert.equal(json.services.caddy.image, expectedWeb);
  assert.equal(json.services.api.pull_policy, "always");
  assert.equal(json.services.caddy.pull_policy, "always");
  assert.equal(images.filter(image => image === expectedWeb).length, 1);
  assert.equal(images.filter(image => image === expectedApi).length, 1);
  assert.equal(images.some(image => /:latest$/.test(image)), false);
  assert.deepEqual(Object.keys(json.services).sort(), ["api", "caddy", "db", "secret-init"]);
  assert.deepEqual(Object.keys(json.volumes).sort(), ["caddy_config", "caddy_data", "db_secret", "postgres_data"]);
  assert.deepEqual(Object.keys(json.networks).sort(), ["default", "internal"]);
  assert.deepEqual(json.services.db.volumes.map(volume => volume.type).sort(), ["volume", "volume"]);
  assert.equal(json.services["secret-init"].volumes[0].source, "db_secret");
  assert.deepEqual(json.services.caddy.volumes.map(volume => volume.source).sort(), ["caddy_config", "caddy_data"]);
});
test("confirmed baseline digests render as a separate fail-closed rollback manifest", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cqrtv-compose-rollback-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const web = "sha256:eca2d70ca29e8311b04f00696e95291b8f7ae7a22c28d1b6ec1485f345a5e190";
  const api = "sha256:80252038a08b731657686703704ce8ee35b8871af64662134633fbd56c11f2fb";
  const { output, result } = render(directory, web, api, "docker-compose.rollback.yml");
  assert.equal(result.status, 0, result.stderr);
  const images = execFileSync("docker", ["compose", "-f", output, "config", "--images"], { cwd: repoRoot, encoding: "utf8" });
  assert.match(images, new RegExp(`ghcr\\.io/fnatika1996/playcqrtv-platform@${web}`));
  assert.match(images, new RegExp(`ghcr\\.io/fnatika1996/playcqrtv-api@${api}`));
  assert.doesNotMatch(images, /:latest/);
});


test("deploy workflow pushes traceable tags and uses fail-closed existing-project update outside PR CI", () => {
  const deployClient = fs.readFileSync(path.join(repoRoot, "qa", "hostinger-deploy.mjs"), "utf8");
  const composePreflight = fs.readFileSync(path.join(repoRoot, "qa", "hostinger-compose-preflight.rb"), "utf8");
  assert.match(deploymentWorkflow, /branches:\s*\[main\]/);
  assert.ok(deploymentWorkflow.includes("workflow_dispatch:"));
  assert.match(deploymentWorkflow, /concurrency:[\s\S]*?cancel-in-progress: false/);
  assert.ok(deploymentWorkflow.includes("id: build-web"));
  assert.ok(deploymentWorkflow.includes("id: build-api"));
  assert.ok(deploymentWorkflow.includes("docker/build-push-action@v6"));
  assert.ok(deploymentWorkflow.includes("ghcr.io/fnatika1996/playcqrtv-platform:latest"));
  assert.ok(deploymentWorkflow.includes("ghcr.io/fnatika1996/playcqrtv-api:latest"));
  assert.ok(deploymentWorkflow.includes("ghcr.io/fnatika1996/playcqrtv-platform:" + "$" + "{{ github.sha }}"));
  assert.ok(deploymentWorkflow.includes("ghcr.io/fnatika1996/playcqrtv-api:" + "$" + "{{ github.sha }}"));
  assert.ok(deploymentWorkflow.includes("WEB_IMAGE_DIGEST: " + "$" + "{{ steps.build-web.outputs.digest }}"));
  assert.ok(deploymentWorkflow.includes("API_IMAGE_DIGEST: " + "$" + "{{ steps.build-api.outputs.digest }}"));
  assert.ok(deploymentWorkflow.includes("node qa/hostinger-deploy.mjs"));
  assert.ok(deploymentWorkflow.includes("HOSTINGER_API_KEY: " + "$" + "{{ secrets.HOSTINGER_API_KEY }}"));
  assert.ok(deploymentWorkflow.includes("WEB_IMAGE_REF: ghcr.io/fnatika1996/playcqrtv-platform@" + "$" + "{{ steps.build-web.outputs.digest }}"));
  assert.ok(deploymentWorkflow.includes("API_IMAGE_REF: ghcr.io/fnatika1996/playcqrtv-api@" + "$" + "{{ steps.build-api.outputs.digest }}"));
  assert.ok(deploymentWorkflow.includes("node qa/pin-compose-digests.mjs"));
  assert.ok(deploymentWorkflow.includes("Upload immutable release Compose handoff"));
  assert.match(composePreflight, /@sha256:\[a-f0-9\]\{64\}/);
  assert.doesNotMatch(deploymentWorkflow, /WEB_IMAGE_REF: [^\n]*:latest|API_IMAGE_REF: [^\n]*:latest/);
  assert.ok(!deploymentWorkflow.includes("hostinger/deploy-on-vps@v2"));
  assert.doesNotMatch(deploymentWorkflow, /pull_request:/);
  assert.ok(deployClient.includes("/update"));
  assert.ok(deployClient.includes("validateSavedCompose"));
  assert.ok(deployClient.includes("Do not retry UPDATE"));
  assert.ok(deployClient.includes("/actions/"));
  assert.ok(deployClient.includes("/containers"));
  assert.ok(deployClient.includes("unknown state; stopping safely"));
  assert.ok(composePreflight.includes("postgres_data"));
  assert.ok(composePreflight.includes("caddy_data"));
  assert.ok(composePreflight.includes("db_secret"));
  assert.ok(composePreflight.includes("pull_policy"));
  assert.match(prWorkflow, /pull_request:/);
  assert.ok(prWorkflow.includes("qa/hostinger-deploy.test.mjs"));
  assert.doesNotMatch(prWorkflow, /secrets\.HOSTINGER_API_KEY|hostinger\/deploy-on-vps@v2|packages:\s*write|docker login|workflow_dispatch:/);
});
