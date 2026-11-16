import assert from "node:assert/strict";
import fs from "node:fs";
import {test} from "node:test";

const script=fs.readFileSync(new URL("./deployment-v2-inventory.sh",import.meta.url),"utf8");

test("read-only inventory lists only refs, labels, runtime health and mount identities",()=>{
  assert.match(script,/docker ps -aq/);
  assert.match(script,/docker inspect --format/);
  assert.match(script,/RepoDigests/);
  assert.match(script,/\.Mounts/);
  assert.doesNotMatch(script,/docker\s+(?:compose\s+)?(?:up|down|rm|stop|start|restart|volume\s+rm|system\s+prune)\b/i);
});

test("inventory never reads or prints environment values or secret files",()=>{
  assert.doesNotMatch(script,/\.Config\.Env|--env-file|\.env|password|secret|token|private.key/i);
  assert.match(script,/Deliberately never inspects or prints container env/);
});

test("inventory restricts project selector and refuses empty inventory",()=>{
  assert.match(script,/\^\[A-Za-z0-9\]\[A-Za-z0-9_-\]\{0,62\}\$/);
  assert.match(script,/No containers found for Compose project/);
});
