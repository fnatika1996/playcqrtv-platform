import assert from "node:assert/strict";
import {test} from "node:test";
import {apiRollbackDecision,classifyObservedState,deploymentAllowed,validateReleaseEvidence} from "./deployment-v2-policy.mjs";

const webOld="ghcr.io/fnatika1996/playcqrtv-platform@sha256:"+"a".repeat(64);
const apiOld="ghcr.io/fnatika1996/playcqrtv-api@sha256:"+"b".repeat(64);
const webNew="ghcr.io/fnatika1996/playcqrtv-platform@sha256:"+"c".repeat(64);
const apiNew="ghcr.io/fnatika1996/playcqrtv-api@sha256:"+"d".repeat(64);
const healthy=ref=>({repoDigest:ref,running:true,health:"healthy"});

test("main merge cannot deploy; only explicit main dispatch is permitted",()=>{
  assert.equal(deploymentAllowed("push","refs/heads/main"),false);
  assert.equal(deploymentAllowed("workflow_dispatch","refs/heads/feature"),false);
  assert.equal(deploymentAllowed("workflow_dispatch","refs/heads/main"),true);
});

test("release inputs require exact SHA, backup evidence and previous immutable refs",()=>{
  const valid={RELEASE_SHA:"a".repeat(40),WORKFLOW_SHA:"a".repeat(40),BACKUP_REFERENCE:"owner-db-backup-2026-11-17",BACKUP_SHA256:"e".repeat(64),BACKUP_VERIFIED:"true",PREVIOUS_WEB_REF:webOld,PREVIOUS_API_REF:apiOld};
  assert.equal(validateReleaseEvidence(valid),true);
  assert.throws(()=>validateReleaseEvidence({...valid,WORKFLOW_SHA:"f".repeat(40)}),/exact SHA/);
  assert.throws(()=>validateReleaseEvidence({...valid,BACKUP_VERIFIED:"false"}),/protected backup/);
  assert.throws(()=>validateReleaseEvidence({...valid,PREVIOUS_WEB_REF:"ghcr.io/fnatika1996/playcqrtv-platform:latest"}),/immutable RepoDigests/);
});

test("same healthy target digests are idempotent no-op success",()=>{
  assert.equal(classifyObservedState({targetWebRef:webNew,targetApiRef:apiNew,previousWebRef:webOld,previousApiRef:apiOld,web:healthy(webNew),api:healthy(apiNew)}),"already-applied");
});

test("only the exact healthy previous state permits first apply",()=>{
  const args={targetWebRef:webNew,targetApiRef:apiNew,previousWebRef:webOld,previousApiRef:apiOld};
  assert.equal(classifyObservedState({...args,web:healthy(webOld),api:healthy(apiOld)}),"safe-to-apply");
  assert.equal(classifyObservedState({...args,web:healthy(webNew),api:healthy(apiOld)}),"stop");
  assert.equal(classifyObservedState({...args,web:healthy(webOld),api:{...healthy(apiOld),health:"unhealthy"}}),"stop");
  assert.equal(classifyObservedState({...args,web:{...healthy(webOld),running:false},api:healthy(apiOld)}),"stop");
});

test("API rollback remains forward-only unless compatibility is proven and owner reviews",()=>{
  assert.equal(apiRollbackDecision({schemaAuthCompatibilityVerified:false,accountOrAdminStateMayHaveChanged:false}),"forward-fix-only");
  assert.equal(apiRollbackDecision({schemaAuthCompatibilityVerified:true,accountOrAdminStateMayHaveChanged:true}),"forward-fix-only");
  assert.equal(apiRollbackDecision({schemaAuthCompatibilityVerified:true,accountOrAdminStateMayHaveChanged:false}),"manual-owner-review-required");
});
