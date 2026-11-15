# CQRTV Immutable Digest Release and Rollback

This document records the intended deployment design and its limits for PR #11. It does not authorize or execute a release. The current Hostinger workflow is not yet switched to this design; a production-workflow change is pending separate approval.

## Confirmed baseline

The owner verified these exact running image digests on Hostinger before PR #11:

- Web: `ghcr.io/fnatika1996/playcqrtv-platform@sha256:eca2d70ca29e8311b04f00696e95291b8f7ae7a22c28d1b6ec1485f345a5e190`
- API: `ghcr.io/fnatika1996/playcqrtv-api@sha256:80252038a08b731657686703704ce8ee35b8871af64662134633fbd56c11f2fb`

The owner also reported an isolated restore test for the PostgreSQL logical dump dated 2026-11-15. Before an actual release, the owner must confirm that the protected local file is still available and its age is acceptable for the agreed RPO. No dump, password, or key belongs in GitHub.

## Release Compose generation

`docker-compose.yml` keeps the verified baseline images pinned by digest and sets application image pull policy to `missing`. This is a safe default if the base file is used directly; it cannot silently resolve to `:latest`.

After each future image build-and-push, Buildx must provide its registry manifest digest. A generator renders one complete Compose document by replacing both baseline refs with the exact new web/API registry digests. It rejects a missing or malformed digest and emits application services with `pull_policy: missing`. The generated document must pass:

```sh
docker compose -f docker-compose.release.yml config --quiet
docker compose -f docker-compose.release.yml config --images
```

The effective file must list exactly one immutable registry ref for web and API and retain `secret-init`, `db`, all named volumes, networks, Caddy settings, and existing environment defaults. Do not publish or use local image IDs as a registry digest.

## Hostinger transfer constraint and chosen integration

The current `hostinger/deploy-on-vps@v2` action constructs a GitHub blob URL from `github.sha` and one `docker-compose-path`; it cannot point at a file generated later in the runner workspace. A generated manifest cannot be passed reliably through that action's current inputs.

Hostinger's documented Docker API accepts the Compose YAML directly in the `content` field, in addition to a URL. The viable design is therefore: render and validate the digest-pinned Compose in the workflow, then submit that raw manifest to the same Hostinger API endpoint used by the action. Keep the existing push-to-main trigger, project name, VM target, and secret boundary. Remove mutable `:latest` build tags from the workflow. Add a read-only post-deploy API query to Hostinger's project containers endpoint and require the reported web/API image refs to equal the exact digests submitted.

Relevant source documentation:

- Hostinger action inputs and implementation: https://github.com/hostinger/deploy-on-vps/blob/main/action.yaml
- Hostinger Docker API: https://developers.hostinger.com/

This integration has not been sent to Hostinger or tested against a production account. No deployment was run. The current branch still contains the pre-existing deploy action until the deployment-workflow code change receives the required approval.

## Pre-merge and release sequence

1. Confirm the exact approved PR/head, review status, and green non-production CI.
2. Owner confirms local backup file integrity, protected storage, and acceptable age/RPO; if a fresher backup is needed, obtain separate permission and test only in isolated PostgreSQL.
3. Confirm the proposed workflow uses Buildx registry digests, generates one effective Compose file, and does not publish or deploy on pull_request.
4. Review Hostinger raw-content API request code; require the API key only in the main deployment job. Never log the authorization header or secrets.
5. Owner separately approves the exact PR/head for release, knowing that merging to main triggers production deployment. Do not invoke `workflow_dispatch` without a separate explicit authorization.
6. After the approved deployment, record commit and both digest refs; check Hostinger deployment response, live health, and that Hostinger's read-only container API reports the exact submitted refs.
7. Keep admin unassigned and do not perform suspend/unsuspend actions in this initial release.

## Fail-closed rollback

Rollback uses the same complete Compose document with digest refs, not a VPS-only override and not `:latest`. Compose named volumes remain unchanged because the manifest retains the same project, volume names, and network:

- `postgres_data`
- `db_secret`
- `caddy_data`
- `caddy_config`

For a web-only rollback, retain the currently approved API digest and replace only the web ref with the verified baseline. For a full application rollback, select the two baseline refs above only if API compatibility criteria below permit it. Render and validate the rollback document before an operator submits that exact document to Hostinger.

Never use `docker compose down -v`, remove named volumes, restore a database over production, or reverse the additive migration with destructive SQL.

### API rollback stop rule

The PR API checks `account_status`; the base API does not. Non-production characterization on the migrated schema confirmed that the base API starts but returns 200 for a synthetic suspended account, while the PR API returns 401. Therefore:

- Before any admin mutation, a baseline API rollback is still subject to the tested migration/schema compatibility and exact-digest check.
- After any suspend/unsuspend, unknown admin session state, or user/session status mutation, **do not roll back the API to the baseline**. Stop, preserve DB and volumes, notify the owner, and use a forward fix after the owner's decision.
- Do not claim universal API rollback safety. Admin grant, MFA, and RBAC remain separately gated.

## Incident steps

1. Freeze further merges/rollouts and record the commit, submitted refs, reported running refs, service health, and error time.
2. Notify the owner. Do not change DB, secrets, or named volumes.
3. If the issue is isolated to web, consider a web-only digest rollback while retaining the current API.
4. For API, auth/session, DB, or admin incidents, apply the stop rule above. Do not switch API images automatically.
5. Once a rollback lock is active, prevent a concurrent normal deployment from replacing it. The eventual main workflow must always submit its own digest-pinned Compose; do not rely on an unmanaged override file.
6. After recovery, record the effective Compose refs and CI/deployment run; return to normal digest-pinned release only after owner approval.

## Status

- Generator and no-deploy CI validation: intended for PR-only implementation.
- Hostinger API raw-content deployment: design supported by public API documentation, but not implemented or production-verified yet.
- API migration compatibility: structural start passed in disposable CI; suspend rollback incompatibility reproduced in disposable CI.
- Release: not approved or executed by this document.
