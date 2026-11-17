import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const script = fs.readFileSync(new URL("./deploy-compose-v2-remote.sh", import.meta.url), "utf8");
const agent = fs.readFileSync(new URL("./deployment-v2-restricted-deploy.py", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
const docs = fs.readFileSync(new URL("../docs/RESTRICTED_VPS_DEPLOY.md", import.meta.url), "utf8");

test("legacy user-context deployment entrypoint is disabled", () => {
  assert.match(script, /Direct user-context Compose deployment is disabled/);
  assert.doesNotMatch(script, /docker compose|docker\s+ps|docker\s+inspect|eval\s/);
});

test("root gate verifies signed stdin and rejects caller-selected commands", () => {
  assert.match(agent, /This fixed entrypoint accepts no command-line arguments/);
  assert.match(agent, /"-Y", "verify"/);
  assert.match(agent, /len\(sys\.argv\) != 1/);
  assert.match(workflow, /CQRTV-DEPLOY-REQUEST-V1/);
  assert.match(workflow, /ssh-keygen -Y sign/);
  assert.match(workflow, /ClearAllForwardings=yes/);
  assert.doesNotMatch(workflow, /\bscp\b|bash -s|sudoers|docker group/i);
});

test("installation docs explicitly state root-equivalent residual risk", () => {
  assert.match(docs, /not a full sandbox/i);
  assert.match(docs, /root-equivalent/i);
  assert.match(docs, /NOPASSWD/);
  assert.match(docs, /no[- ]argument/i);
});
