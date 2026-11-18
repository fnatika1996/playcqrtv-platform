# CQRTV Deployment V2 — gated release and recovery

## Architecture decision

The current Hostinger Docker Manager update operation is not a suitable source-of-truth deployment interface for immutable releases. The published API documents POST /docker/{projectName}/update as updating the saved project, with no Compose-manifest request body. Its create endpoint accepts Compose but replaces a project with the same name. The latest visible production run failed while polling an unknown Hostinger action state.

Preferred target: standard Docker Compose on the existing VPS through a dedicated SSH account forced to a root-owned, no-argument deploy gate. The runner signs a canonical request containing only fixed project identity, release SHA, manifest hash and exact CQRTV web/API digests. The VPS never executes uploaded Compose or shell input: the root gate validates the request and generates a minimal image-only override against the pinned root-owned Compose file. It uses the existing named project after read-only container and volume reconciliation and does not call Hostinger create/replace/update endpoints. See [Restricted VPS deploy access](RESTRICTED_VPS_DEPLOY.md).

| Path | Benefits | Risks and gates |
| --- | --- | --- |
| Hostinger API | Provider-maintained auth and action/container endpoints | Update uses saved Compose, not the just-built manifest; create can replace a same-name project; action state has previously been unknown. Not selected for V2. |
| SSH plus Docker Compose | One tracked source manifest, immutable refs, direct read-only inventory, deterministic reconciliation | SSH/Docker access is effectively host-privileged; needs pinned host key, restricted deploy identity, verified project/volume names, remote .env, GHCR read-only auth and staging proof. Compose can briefly interrupt service while recreating web/API. |

## Required GitHub setup

The release workflow has a no-input workflow_dispatch and is enabled only on main. It checks out the immutable `github.sha` selected by that run; users cannot provide an arbitrary SHA or image reference. A preflight job tests that exact checkout before any image is built. The protected release-artifacts and production environments remain mandatory.

After production approval, the runner makes an authenticated read-only status request through the pinned-host-key, forced-command SSH channel. The root-owned gate returns only the run ID, the current running web/API RepoDigests, and a fresh backup manifest reference/checksum. The runner validates their formats and binds them into the signed release request. The deployment gate rechecks the backup manifest and observed RepoDigests under the same exclusive deployment lock before image pulls or Compose changes; stale evidence, state drift, overlap, or missing state fails closed. It never accepts caller-provided refs or executes caller shell commands. External production actions remain pinned to immutable upstream commit SHAs.

Before enabling release, the owner must create GitHub Environments `release-artifacts` and `production`, set required owner reviewers, disable administrator bypass, and store SSH credentials only in the production Environment. A YAML environment name alone does not create reviewer protection. Read-only GitHub Environment metadata was unavailable to this audit connection, so existence/protection are unverified.

Owner UI checklist (do not paste secret values into Issue #4):
1. Repository **Settings → Environments**: confirm both environment names exist.
2. For each: configure required owner reviewers; enable **Prevent self-review** where available; enable **Prevent administrators from bypassing configured protection rules**; restrict deployment branches to `main`.
3. In `production`, verify variable names below and secret names `CQRTV_SSH_PRIVATE_KEY` and `CQRTV_RELEASE_SIGNING_KEY` exist. Record only name/presence in the owner checklist; never expose values in logs or issue comments.
4. In `release-artifacts`, verify required reviewers are configured before allowing GHCR write permission.
5. Keep both private keys limited to the `production` environment; the SSH and signing keys must be separate. Pin the host key in `CQRTV_SSH_KNOWN_HOSTS`, do not generate it dynamically during deployment.

Required production Environment variables:
- CQRTV_SSH_HOST
- CQRTV_SSH_USER
- CQRTV_SSH_KNOWN_HOSTS (pinned host-key line; release does not use ssh-keyscan)
- CQRTV_PROJECT_ROOT (must be `/docker/playcqrtv` only after the owner confirms it matches the pinned root-owned Compose/project labels)

Required production Environment secret:
- CQRTV_SSH_PRIVATE_KEY for the forced-command SSH identity.
- CQRTV_RELEASE_SIGNING_KEY: a separate Ed25519 OpenSSH signing private key; its public key is pinned in the root-owned allowed-signers file.

The SSH account is not in the Docker group and has no general sudo. Its only sudo command is the fixed root-owned wrapper with no arguments. Access to Docker control is root-equivalent; this narrows the command surface but is not a full sandbox: a signed approved application image can still access the database privileges of its service.

The VPS must already have root-scoped read-only GHCR credential access for image pulls and an existing .env file. The restricted SSH account must not read .env or the Docker socket. The workflow never transfers registry credentials or application secrets to the host. The root environment needs Docker Compose, Python 3, OpenSSH `ssh-keygen`, `flock` and existing root-scoped read-only GHCR pull access. The SSH account itself does not need Docker socket access. A live inventory must confirm project label playcqrtv and candidate volume names match current mounts; the script refuses to continue otherwise.

## Controlled release

1. Review the intended site mode and approved PRs. Start the no-input workflow only from `main`; it pins the release to that run's immutable `github.sha`.
2. The release-preflight job checks out that exact commit and runs the request, policy, digest-pinning, and restricted-gate tests. Image building cannot start unless these tests pass on that SHA.
3. Approve the protected `release-artifacts` Environment. The workflow builds commit-tagged images (no `latest`), captures Buildx digests, renders the tracked Compose file with those refs, and retains the same-run artifact.
4. Approve the protected `production` Environment. The runner then sends a signed, run-scoped read-only status request through the pinned-host-key forced SSH command. It receives only sanitized backup evidence and current web/API RepoDigests.
5. Policy checks bind the server evidence to this run's exact release SHA. If evidence is absent/stale, the services are unhealthy, refs are mixed, or the SSH status check fails, deployment stops.
6. The runner signs the same-run manifest hash, attested backup reference/checksum, and exact current image RepoDigests. The root gate checks signature and replay state, reacquires the exclusive deployment lock, and revalidates the backup and current services before pulling images. Any status-to-deploy drift stops before Compose changes.
7. The root gate combines only the two strict image digests with the pinned root-owned Compose file; it never executes the uploaded manifest. It validates service set, image refs, `.env` permissions, persistent volumes, and current mounts before pulling either app image.

## One-time legacy image handoff

The release request is schema V2 and includes a signed `legacy_handoff_approved` boolean which defaults false. For the first tag-to-digest migration only, the owner can set it true after confirming the live configured references, exact container identities, and previous RepoDigests through authorized read-only inspection; the protected `production` reviewer remains a separate approval. The current root-owned server Compose file is pinned by its own hash and must be audited where it is; it is not assumed to equal or replaced by the repository file.

When true, the root gate accepts only the exact owner-reported `ghcr.io/fnatika1996/...:latest` configured refs with matching signed previous RepoDigests obtained by inspecting each container's `.Image` ID, expected project/service labels and mount identities. It pulls only the new immutable target digests using the image-only override, updates only `api` and `caddy`, then verifies the project identity, target RepoDigests, DB container ID and mounts. The root Compose hash must remain unchanged. A successful handoff writes a root-owned completion marker; a same-request repeat on target is a no-op, a new handoff request is denied, and routine releases must leave the attestation false and use digest refs. No `:latest` pull is allowed. Changed hash, wrong tag/digest, mixed state or identity mismatch stops before image pull.

The generated override is kept at the stable root-owned path `/var/lib/cqrtv-deploy/release.override.yml` (mode 0600) and atomically rewritten with validated digest refs for each request. Compose records a `com.docker.compose.project.config_files` label for every file in the invocation: before the first app update API/Caddy labels must be the base Compose path; after `up`, those two services must have exactly `<base>,/var/lib/cqrtv-deploy/release.override.yml`. DB and secret-init remain base-only. The gate rejects arbitrary or temporary override paths so a later invocation can reconcile the containers.

Docker's documented `compose up` behavior is to recreate selected changed services while preserving mounted volumes. Compose-managed containers carry project/service identity labels. The gate rechecks the required labels and mounts after `up` and confirms that PostgreSQL's container ID did not change. This code-level behavior does not prove Hostinger-specific labels or volume ownership; that exact compatibility must pass isolated staging before any release. [Docker Compose up](https://docs.docker.com/reference/cli/docker/compose/up/), [Compose labels](https://docs.docker.com/reference/compose-file/services/), [Moby image inspect fields](https://github.com/moby/moby/blob/master/api/types/image/image_inspect.go).

## Recovery and retries

- A rerun of the same workflow run reuses its retained Compose artifact and exact digest outputs. If target refs are already healthy, reconciliation returns success. If both services remain at the recorded old refs and healthy, the same approved deployment can proceed. Mixed state is an operator hold.
- Build, test or pull failure occurs before Compose up; current services remain running. Pulling immutable images may add cache entries only.
- A network interruption or timeout after up is not proof of failure or success. Run read-only inventory first. No blind retry or automatic rollback.
- The workflow exposes no rollback input and this PR adds no rollback operation. Recorded previous digests are used only to reconcile the currently running state; rollback remains unavailable through this gate.
- If recovery is required, stop and prepare a separate owner-reviewed recovery design with compatibility evidence and staging proof. Never make a previous digest an implicit target or automatically roll back API/database state.
- Never use docker compose down -v, remove/recreate PostgreSQL or Caddy volumes, overwrite a database from a backup, or reverse migrations destructively.

## Staging and reliability checks

PR CI uses a disposable Docker Compose project with a unique name, its own network and PostgreSQL volume, an ephemeral staging-only DB credential, and an HTTP port bound only to runner loopback. It verifies clean startup and HTTP response, repeat deployment with stable container IDs, named-volume/data preservation, a deliberately failed Dockerfile build and failed pull from a closed loopback port (existing containers/data remain unchanged), web candidate apply/rollback, and PostgreSQL dump/restore into a second disposable database. It runs the new read-only inventory tool and checks its output does not contain the staging password. CI cleanup is scoped to this unique QA project and is the only place in this PR using `down --volumes`.

Policy tests cover release SHA, missing backup attestation, mutable refs, target no-op, old-state apply, mixed/interrupted and unhealthy states, and API rollback fail-closed. This is runner-local Docker staging, not a Hostinger/VPS test; it cannot reproduce provider networking, SSH permissions, Hostinger project labels/volume names, or production credentials. No safe staging VPS/access was supplied, so those host-specific checks remain blocked. Web rollback is a new owner-approved gated release using a verified old digest and compatible manifest; actual rollback is not exercised against production. CI only verifies the fail-closed state policy; it does not mutate or restore live services.

## Read-only operator inventory

Run `bash qa/deployment-v2-inventory.sh <compose-project>` on an authorized host before any migration/release. It reads Compose labels, configured image refs, local RepoDigests, runtime/health state, and mounted volume names/targets; it intentionally never inspects or prints container environment, .env, or credential values. It exits non-zero if no containers match. Compare the output with the candidate manifest and owner records. The tool is included in disposable CI; it has not been run against production.

## One-time Hostinger-to-Compose handoff

This is a separate owner-approved maintenance-window task, not part of PR merge or routine deployment.

1. Capture read-only current image RepoDigests, project/service labels, container state/health, exact named-volume names and mount targets, .env presence/mode, Site Control mode, Caddy routes and public health.
2. Confirm and protect a fresh database backup and required Caddy/config/secret volumes; verify restore in isolated staging and confirm RPO/RTO with the owner.
3. On isolated VPS staging, prove Compose using the chosen project name discovers the expected service labels and named volumes without creating new production-like volumes.
4. Compare candidate Compose with saved project configuration without printing .env values. Confirm release only touches api and caddy.
5. During the approved window, hand off using the tested manifest procedure. Do not remove the Hostinger project, call create/replace, delete resources or rename volumes. Expect possible brief service interruption; do not promise zero downtime.
6. If volume identity or Compose ownership is ambiguous, stop and request a separately designed migration.

## Current evidence and release gate

- Main SHA at this task: 57616f6099263706a4a9ffe982b770a18a5c519c. PR #21 and PR #23 are already in this main snapshot; this PR is based on that exact commit.
- Earlier deployment notes recorded production run #63 stopping at an unknown provider action state and a PostgreSQL backup owner reported on 2026-11-16. Those are historical owner/report observations only; this task made no production API, SSH, backup or site checks.
- This PR introduces a signed, restricted deployment entrypoint and does not invoke it. GitHub Environment protections and secret presence remain unverified; configure and verify them privately before any release.
- SSH access, current server environment path, live Compose labels and volume identities are intentionally not guessed. No secret/token belongs in Issue #4.
- Current deployment workflow is manual-only (workflow_dispatch) on main. PR CI validates its configuration but never starts it. A future release still requires isolated staging proof, current read-only inventory, protected backup evidence, exact main SHA and separate owner approval.
- This PR does not authorize merge or deployment. Release remains blocked until the restricted account and root-owned gate are installed and verified by an authorized operator, GitHub Environment protection is confirmed, and staging/inventory/backup gates pass.

References:
- Hostinger VPS Docker Manager API: https://github.com/hostinger/api-python-sdk/blob/main/docs/VPSDockerManagerApi.md
- GitHub Actions deployment environments: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments


## One-click workflow migration gate

The PR's GitHub workflow is not compatible with the currently installed root gate until the owner installs the reviewed gate revision on the VPS. Do not merge or start a release before that separately approved migration. This repository change does not connect to or change the VPS.

The server status request uses a signed, canonical, run-scoped `CQRTV-DEPLOY-STATUS-V1` frame over the existing forced-command SSH identity. The host key is still pinned. The root gate acquires the same exclusive lock used by deployments, checks the trusted Compose/project/mount identities, and returns sanitized JSON only. The subsequent signed deploy request still carries those exact values; the root gate repeats all checks under lock, closing the status-to-deploy race. No arbitrary SSH command, shell string, credential, or backup content is sent or returned.

Before enabling this workflow, the owner must install the reviewed root gate and configure the backup producer to atomically write `/var/lib/cqrtv-deploy/backup-manifest.json` as a root-owned file in a protected root-owned directory. Schema 1 contains only: `schema_version`, `backup_reference`, `backup_sha256`, `created_at` (timezone-aware ISO-8601), `rpo_seconds` (1–86400), `isolated_restore_verified` (`true`), `restore_verified_at`, and `restore_sha256`. The trusted backup job must write this manifest only after checksum verification and a successful isolated PostgreSQL restore of that exact backup. The release gate rejects missing/malformed evidence, a checksum mismatch, future timestamps, backup age beyond its RPO, and restore evidence older than 30 days. It logs no secret, dump content, or checksum source path.

Gate migration should be performed only after reviewing the exact VPS Compose, backup producer, ownership/mode, and forced-command wrapper. Install the new root-owned script/config atomically with a retained copy of the prior script and verified SHA-256; test the signed status operation and release refusal cases against an isolated staging project; then enable the GitHub workflow. Rollback is restoring the prior root-owned script/config atomically and disabling the input-free workflow until its old schema is restored. No implicit configuration replacement or production deployment is included in this PR.
