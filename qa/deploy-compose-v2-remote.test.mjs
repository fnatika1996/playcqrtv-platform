import assert from "node:assert/strict";
import fs from "node:fs";
import {test} from "node:test";

const script=fs.readFileSync(new URL("./deploy-compose-v2-remote.sh",import.meta.url),"utf8");

test("deployment validates manifest, persistent volumes and DB health before any pull",()=>{
  const volumeCheck=script.indexOf("done < \"$volume_map\"");
  const dbHealthCheck=script.indexOf('$(db_health)" != "running|healthy"');
  const pull=script.indexOf("compose pull api caddy");
  assert.ok(volumeCheck>=0 && dbHealthCheck>volumeCheck && pull>dbHealthCheck);
  assert.match(script,/Database is not the single healthy existing service/);
  assert.match(script,/Database identity or health changed during app update/);
});

test("deployment only updates application services and never removes data",()=>{
  assert.match(script,/compose up -d --no-build --no-deps api caddy/);
  assert.doesNotMatch(script,/compose\s+down\b|docker\s+volume\s+rm\b|docker\s+rm\b|system\s+prune/i);
});

test("deployment refuses ambiguous volume and state before mutating services",()=>{
  assert.match(script,/Candidate volume differs from existing/);
  assert.match(script,/mixed, unexpected or unhealthy state/);
  assert.ok(script.indexOf("mixed, unexpected or unhealthy state")<script.indexOf("compose pull api caddy"));
});

test("remote dotenv file must not be group or world readable",()=>{
  assert.match(script,/8#\$env_mode & 077/);
  assert.match(script,/group\/world-readable; refusing deployment/);
});
