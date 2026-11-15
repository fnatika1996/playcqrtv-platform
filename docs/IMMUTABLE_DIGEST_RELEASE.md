# CQRTV Immutable Digest Release and Rollback

This document records the digest-pinned deployment design implemented in PR #11. It does not authorize or execute a release.

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

Hostinger's `deploy-on-vps@v2` action constructs a GitHub blob URL from `github.sha` and one `docker-compose-path`; it cannot point at a file generated later in the runner workspace. PR #11 therefore replaces that action with a direct request to the documented Hostinger Docker API, which accepts the complete Compose YAML in the `content` field. The workflow renders and validates that raw manifest after Buildx has pushed both images and returned registry digests. It keeps the push-to-main and workflow_dispatch triggers, serializes production deploy jobs, keeps mutable `:latest` out of image tags/config, and uses a read-only project-containers API query to require the reported refs to match the submitted web/API digests.

The deployment workflow change is code only. It has not been executed, and no Hostinger API call was made.

Relevant source documentation:

- Hostinger action inputs and implementation: https://github.com/hostinger/deploy-on-vps/blob/main/action.yaml
- Hostinger Docker API: https://developers.hostinger.com/

The generated Compose and workflow wiring are tested in PR-only CI. The raw-content request and Hostinger runtime response have not been exercised against Hostinger. No deployment was run.

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

- Generator and PR-only CI validation: implemented and tested with synthetic digests plus the verified baseline rollback refs.
- Future Hostinger workflow: now submits the generated raw Compose content using Buildx registry digests; code and workflow wiring are covered by a static regression test, but the Hostinger API has not been called.
- API migration compatibility: structural start passed in disposable CI; suspend rollback incompatibility reproduced in disposable CI.
- Release: not approved or executed by this document.
