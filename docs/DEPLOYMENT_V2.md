# CQRTV Deployment V2 — gated release and recovery

## Architecture decision

The current Hostinger Docker Manager update operation is not a suitable source-of-truth deployment interface for immutable releases. The published API documents POST /docker/{projectName}/update as updating the saved project, with no Compose-manifest request body. Its create endpoint accepts Compose but replaces a project with the same name. The latest visible production run failed while polling an unknown Hostinger action state.

Preferred target: standard Docker Compose on the existing VPS, invoked over OpenSSH after approval. The runner transfers the exact digest-pinned release manifest and uses the existing named project only after read-only container and volume reconciliation. It does not call Hostinger create/replace or update endpoints.

| Path | Benefits | Risks and gates |
| --- | --- | --- |
| Hostinger API | Provider-maintained auth and action/container endpoints | Update uses saved Compose, not the just-built manifest; create can replace a same-name project; action state has previously been unknown. Not selected for V2. |
| SSH plus Docker Compose | One tracked source manifest, immutable refs, direct read-only inventory, deterministic reconciliation | SSH/Docker access is effectively host-privileged; needs pinned host key, restricted deploy identity, verified project/volume names, remote .env, GHCR read-only auth and staging proof. Compose can briefly interrupt service while recreating web/API. |

## Required GitHub setup

The workflow has no push trigger. Merging a PR to main runs PR/main CI only. Production release can start only from manual workflow_dispatch on main, with the exact release_sha, previous running web/API RepoDigests and backup attestation supplied. Every external action in the production release workflow is pinned to an immutable upstream commit SHA; the PR CI checks this invariant.

Before enabling release, the owner must create GitHub Environments `release-artifacts` and `production`, set required owner reviewers, disable administrator bypass, and store SSH credentials only in the production Environment. A YAML environment name alone does not create reviewer protection. Read-only GitHub Environment metadata was unavailable to this audit connection, so existence/protection are unverified.

Owner UI checklist (do not paste secret values into Issue #4):
1. Repository **Settings → Environments**: confirm both environment names exist.
2. For each: configure required owner reviewers; enable **Prevent self-review** where available; enable **Prevent administrators from bypassing configured protection rules**; restrict deployment branches to `main`.
3. In `production`, verify variable names below and secret name `CQRTV_SSH_PRIVATE_KEY` exist. Record only name/presence in the owner checklist; never expose values in logs or issue comments.
4. In `release-artifacts`, verify required reviewers are configured before allowing GHCR write permission.
5. Keep SSH private key limited to the `production` environment; pin the host key in `CQRTV_SSH_KNOWN_HOSTS`, do not generate it dynamically during deployment.

Required production Environment variables:
- CQRTV_SSH_HOST
- CQRTV_SSH_USER
- CQRTV_SSH_KNOWN_HOSTS (pinned host-key line; release does not use ssh-keyscan)
- CQRTV_PROJECT_ROOT (owner-verified absolute directory containing the existing .env and release manifests)

Required production Environment secret:
- CQRTV_SSH_PRIVATE_KEY for a restricted deploy identity. Docker access is effectively host-privileged; restrict its source/command where possible and rotate it.

The VPS must already have a read-only GHCR credential for image pulls and an existing .env file. The workflow never transfers registry credentials or application secrets to the host. The remote account needs Docker Compose, Python 3 and flock. A live inventory must confirm project label playcqrtv and candidate volume names match current mounts; the script refuses to continue otherwise.

## Controlled release

1. Ensure required PR-only checks are green on the exact main SHA. Review the intended site mode and approved PRs.
2. In GitHub Actions select CQRTV gated release, choose ref main, enter that same exact SHA as release_sha, and provide the previously read-only observed web/API RepoDigests.
3. Before approving release-artifacts, verify a protected PostgreSQL backup is available, its checksum matches, its age fits the agreed RPO, and an isolated restore test exists. The backup reference/checksum inputs are owner attestations; they do not independently prove the backup.
4. Approve release-artifacts. The workflow builds and publishes commit-tagged images (no latest), captures Buildx digests, renders the tracked Compose with those exact refs and retains the manifest as a same-run artifact.
5. Inspect the digest summary and approve the production Environment only if the release SHA, backup and previous refs are correct.
6. Runner transfers the exact manifest with pinned SSH. On the VPS, the script validates service set, exact web/API refs, absence of latest, required persistent volumes and current mounted volume names before pulling either app image.
7. It pulls both immutable app refs before changing services, then runs only docker compose up -d --no-build --no-deps api caddy. It never stops/removes the project or updates the database service.
8. Read-only reconciliation checks actual image RepoDigests and runtime health. Already-running target refs produce no-op success. Exact previous refs plus healthy containers permit first apply. Mixed, unknown or unhealthy state stops without retry or rollback.
9. Read-only public smoke checks homepage (open or closed gate), /api/health, /auth.html, /admin/login and SVG MIME.

## Recovery and retries

- A rerun of the same workflow run reuses its retained Compose artifact and exact digest outputs. If target refs are already healthy, reconciliation returns success. If both services remain at the recorded old refs and healthy, the same approved deployment can proceed. Mixed state is an operator hold.
- Build, test or pull failure occurs before Compose up; current services remain running. Pulling immutable images may add cache entries only.
- A network interruption or timeout after up is not proof of failure or success. Run read-only inventory first. No blind retry or automatic rollback.
- Web rollback is an owner-approved new gated release using the previous pinned web digest, after checking the rollback manifest and API compatibility.
- API rollback is fail-closed. After any auth/admin-state or schema change, or any uncertainty, use a forward fix. Even with compatibility evidence, API rollback requires explicit owner review.
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

- Main SHA at audit: b66d804ace3688cbaecc0fcadd1681db6cd3e2dd.
- Latest visible production run #63 built/pushed images but stopped at unknown state; live smoke was skipped. Current running refs, container health, Site Control mode and saved Compose remain unverified by Codex.
- Owner reports a PostgreSQL backup completed yesterday (2026-11-16). This audit did not access or verify its checksum, protected storage, age/RPO or isolated restore evidence. It is not treated as absent; no replacement backup was created.
- GitHub Environment metadata could not be read with the available read-only GitHub connection (the Environments endpoint was rejected by its endpoint allowlist). Environment existence, reviewers/bypass, variables and secret presence are unverified. The owner UI checklist above is required.
- SSH access, server environment path, project labels and volume IDs are intentionally not guessed. No secret/token belongs in Issue #4.
- The last main auto-deploy risk remains until PR #23 is merged. Safe order: (1) pause/avoid all other main merges; review and approve PR #23 specifically; (2) merge #23 alone; (3) verify main contains the manual-only deploy workflow and inspect Actions to confirm no production run was triggered; (4) only then merge PR #21 after a separate owner sequencing approval. Do not merge #21 first: its push would still invoke the current main auto-deploy workflow. PR #22 must not be merged unchanged.
- This PR does not authorize merge or deployment. Release remains blocked until environment protection, staging proof, current read-only inventory, verified owner-reported backup, exact main SHA and owner approval are present.

References:
- Hostinger VPS Docker Manager API: https://github.com/hostinger/api-python-sdk/blob/main/docs/VPSDockerManagerApi.md
- GitHub Actions deployment environments: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments
