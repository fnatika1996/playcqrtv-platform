import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");

test("staging artifacts have fixed isolated identity and no production mounts", () => {
  const gate = read("qa/deployment-v2-staging-gate.py");
  const compose = read("ops/cqrtv-v2-staging/compose.smoke.yml");
  const gateCompose = read("ops/cqrtv-v2-staging/docker-compose.gate.yml");
  const config = read("ops/cqrtv-v2-staging/config.example.json");
  const smoke = read("qa/vps-staging-compose-smoke.sh");
  const apiDocker = read("ops/cqrtv-v2-staging/images/api/Dockerfile");
  const webDocker = read("ops/cqrtv-v2-staging/images/web/Dockerfile");
  const apiSource = read("ops/cqrtv-v2-staging/images/api/server.mjs");
  const webPage = read("ops/cqrtv-v2-staging/images/web/index.html");
  assert.match(gate, /PROJECT_NAME = "cqrtv-v2-staging"/);
  assert.match(gate, /PROJECT_ROOT = "\/opt\/cqrtv-v2-staging"/);
  assert.match(gate, /CONFIG_PATH = "\/etc\/cqrtv-v2-staging\/config.json"/);
  assert.match(gate, /OVERRIDE_FILE = "\/var\/lib\/cqrtv-v2-staging\/release.override.yml"/);
  assert.match(config, /"project_name": "cqrtv-v2-staging"/);
  assert.match(apiDocker, /org.cqrtv.environment="staging-only"/);
  assert.match(webDocker, /org.cqrtv.environment="staging-only"/);
  assert.match(apiSource, /environment: "staging-only"/);
  assert.match(webPage, /CQRTV STAGING ONLY/);
  assert.match(compose, /127\.0\.0\.1:18080:80/);
  assert.match(compose, /cqrtv-v2-staging_postgres_data/);
  assert.match(gateCompose, /127\.0\.0\.1:18080:80/);
  assert.match(gateCompose, /cqrtv-v2-staging_postgres_data/);
  assert.doesNotMatch(gateCompose, /playcqrtv|\/docker\/playcqrtv|\/var\/run\/docker\.sock/);
  assert.doesNotMatch(compose, /playcqrtv|\/docker\/playcqrtv|\/var\/run\/docker\.sock/);
  assert.match(smoke, /production path or socket reference found/);
  assert.match(smoke, /docker context show/);
  assert.match(smoke, /No cleanup was performed/);
});

test("root staging gate rejects production project identity and images in unit fixtures", () => {
  const tests = read("qa/deployment_v2_staging_deploy_test.py");
  assert.match(tests, /production_config/);
  assert.match(tests, /ghcr\.io\/fnatika1996\/playcqrtv-api/);
});
