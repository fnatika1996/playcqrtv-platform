const DIGEST = /^ghcr\.io\/fnatika1996\/playcqrtv-(?:platform|api)@sha256:[a-f0-9]{64}$/i;

export function isDigestRef(value, repository) {
  return typeof value === "string" && value.startsWith(repository + "@sha256:") && DIGEST.test(value);
}

export function validateReleaseEvidence(input) {
  const releaseSha=input.RELEASE_SHA||"";
  const workflowSha=input.WORKFLOW_SHA||"";
  const backupReference=input.BACKUP_REFERENCE||"";
  const backupSha=input.BACKUP_SHA256||"";
  const backupVerified=input.BACKUP_VERIFIED==="true";
  const previousWebRef=input.PREVIOUS_WEB_REF||"";
  const previousApiRef=input.PREVIOUS_API_REF||"";
  if(!/^[a-f0-9]{40}$/i.test(releaseSha)||releaseSha!==workflowSha)throw new Error("Release ref must be the exact SHA selected for this main workflow run.");
  if(!backupVerified||!/^[a-f0-9]{64}$/i.test(backupSha)||!/^[A-Za-z0-9._:/-]{1,120}$/.test(backupReference))throw new Error("Owner must confirm a protected backup, its checksum, age/RPO and isolated restore.");
  if(!isDigestRef(previousWebRef,"ghcr.io/fnatika1996/playcqrtv-platform")||!isDigestRef(previousApiRef,"ghcr.io/fnatika1996/playcqrtv-api")||previousWebRef===previousApiRef)throw new Error("Previous running web and API refs must be their separate immutable RepoDigests.");
  return true;
}

export function deploymentAllowed(eventName,ref){return eventName==="workflow_dispatch"&&ref==="refs/heads/main";}

export function classifyObservedState({targetWebRef,targetApiRef,previousWebRef,previousApiRef,api,web}){
  if(!isDigestRef(targetWebRef,"ghcr.io/fnatika1996/playcqrtv-platform")||!isDigestRef(targetApiRef,"ghcr.io/fnatika1996/playcqrtv-api")||!isDigestRef(previousWebRef,"ghcr.io/fnatika1996/playcqrtv-platform")||!isDigestRef(previousApiRef,"ghcr.io/fnatika1996/playcqrtv-api"))throw new Error("Reconciliation requires exact immutable image refs.");
  const ready=row=>row&&row.running===true&&["healthy","none"].includes(row.health);
  if(!ready(api)||!ready(web))return "stop";
  if(api.repoDigest===targetApiRef&&web.repoDigest===targetWebRef)return "already-applied";
  if(api.repoDigest===previousApiRef&&web.repoDigest===previousWebRef)return "safe-to-apply";
  return "stop";
}

export function apiRollbackDecision({schemaAuthCompatibilityVerified,accountOrAdminStateMayHaveChanged}){
  if(schemaAuthCompatibilityVerified===true&&accountOrAdminStateMayHaveChanged===false)return "manual-owner-review-required";
  return "forward-fix-only";
}
