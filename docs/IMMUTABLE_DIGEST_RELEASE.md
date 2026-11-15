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

## Hostinger existing-project update and saved Compose preflight

The historical Hostinger action sends POST /docker with a GitHub Compose URL; the documented operation creates a project and replaces an existing project with the same name. PR #11 does not use that path.

For the temporary launch flow, Buildx publishes each new web/API image with both a mutable :latest tag and a commit-SHA tag. The workflow records the actual Buildx digests for traceability. Before changing the running project, the runtime client performs a read-only GET of the existing playcqrtv project contents. A Ruby safe-YAML preflight rejects missing or unexpected content, checks both service images are the expected :latest refs with pull_policy: always, and verifies the expected service/volume bindings (postgres_data, db_secret, caddy_data, caddy_config). It does not print saved Compose content or the separate project environment. A mismatch fails before any POST.

Only after that preflight does the workflow call Hostinger's POST /docker/playcqrtv/update endpoint. It polls the returned action resource to a recognized success state, then checks the read-only container list for the expected refs and running health. It never retries UPDATE, automatically replaces the project, or rolls back after a partial failure. Unknown action states fail closed. The post-update public page, icon and API checks are GET-only.

Hostinger documents the project update operation as pulling latest images and recreating containers while preserving data volumes. This API behavior has not been exercised on the live project. The actual saved Compose, image refs and volume bindings have not been inspected by Codex; PR CI uses synthetic mock responses only.

The tracked docker-compose.yml in this branch retains the verified baseline digest refs and remains useful for characterization/rollback planning. The existing-project update does not submit that file; it uses the saved Hostinger Compose. Therefore the saved config preflight is a hard gate, and :latest remains mutable rather than a rollback identity. The commit-SHA tags and Buildx digest outputs are recorded for traceability.

Official references:

- Hostinger Docker Manager API, including create/replace semantics and update-project volume behavior: https://github.com/hostinger/api-python-sdk/blob/main/docs/VPSDockerManagerApi.md
- Hostinger action source: https://github.com/hostinger/deploy-on-vps/blob/main/action.yaml
- Action resource schema: https://github.com/hostinger/api-python-sdk/blob/main/docs/VPSV1ActionActionResource.md
- Container resource schema: https://github.com/hostinger/api-python-sdk/blob/main/docs/VPSV1DockerManagerContainerResource.md

## Pre-merge and release sequence

1. Confirm the exact approved PR/head and green PR-only CI.
2. Owner verifies the saved Hostinger project Compose through the read-only UI/API view and confirms :latest web/API refs, pull_policy: always, and the expected volume bindings. The deploy workflow repeats this check at runtime and stops before UPDATE if it fails.
3. Immediately before any separately approved merge, owner confirms a fresh, verified, protected PostgreSQL backup and protected volume backups, with acceptable RPO. No backup command is run by CI.
4. Owner separately approves the exact PR/head, knowing that merging to main triggers the production workflow. Do not invoke workflow_dispatch without separate explicit authorization.
5. After deployment, record commit-SHA tags and Buildx digests, action ID/state, container refs/state, and read-only site/API health.
6. Keep admin unassigned and do not perform suspend/unsuspend actions in this initial release.

## Fail-closed rollback

The current UPDATE workflow is not an automated rollback mechanism. :latest is mutable, and the update endpoint uses the saved project Compose rather than accepting an arbitrary rollback manifest. Commit-SHA tags and baseline digests are traceability/recovery references only; no automatic rollback is performed.

On a failed action, unexpected refs, unhealthy service, or failed smoke check: stop further deployments, record the action ID and expected/observed refs, preserve database and volumes, and escalate to the owner. Do not retry UPDATE blindly or call the create/replace endpoint as an automatic fallback. A separately approved recovery procedure must establish an exact ref and a volume-preserving method before it is used.

Never use docker compose down -v, remove named volumes, restore a database over production, or reverse the additive migration with destructive SQL.

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

- Generator and digest characterization tests: retained for synthetic release/rollback reference checks.
- Existing-project update workflow: implemented in PR #11 with a fail-closed saved-Compose preflight, action-state polling, container verification and read-only smoke checks. No Hostinger API request has been made.
- PR-only synthetic tests and CI: safe mocks only; no Hostinger credentials or production workflow execution.
- Actual Hostinger state vocabulary, saved Compose compatibility, image-ref representation and live volume behavior: unverified.
- Release: not approved or executed by this document.
