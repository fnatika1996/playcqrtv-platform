# Restricted CQRTV VPS deployment

## Security model

The SSH account `cqrtvdeploy` must not belong to the `docker` group and must have no general sudo rule. Docker socket access is root-equivalent. The workflow connects without a remote command; sshd forces the single no-argument command `sudo -n /usr/local/sbin/cqrtv-deploy`.

The workflow signs a small canonical request (schema V2) with a separate Ed25519 OpenSSH signing key stored only as the `production` Environment secret `CQRTV_RELEASE_SIGNING_KEY`. The VPS verifies it against root-owned `allowed_signers`. An SSH key by itself cannot authorize deployment. The signed request binds release SHA, run ID, pinned project root, manifest SHA-256, target web/API RepoDigests, previously observed web/API RepoDigests, and an explicit legacy-handoff attestation bit. The root entrypoint rejects stale or reused run IDs.

The signed Compose artifact is retained in GitHub Actions and its hash is bound into the request, but the VPS never executes or parses an uploaded Compose file. It generates a temporary root-only override containing only the two validated CQRTV image digest references, combines that with the pinned root-owned Compose file, validates the resolved services and volume identities, then executes fixed Docker Compose argument lists. No request field becomes a command, file path, mount, service name or shell fragment. The wrapper updates only `api` and `caddy`; it checks DB health and identity and never runs `down`, updates `db`, or removes volumes.

This is a meaningful privilege reduction, not a full sandbox. A permitted application image is production code and can exercise the access already granted to its service, including API access to the database secret. A compromised approved release/signing key or an improperly protected GitHub Environment can therefore still cause serious damage. Keep owner approval, protected main, pinned images, backup and operator review.

## Required root-owned configuration

After a separate owner approval and an isolated staging proof, an authorized VPS administrator installs the reviewed file from the approved PR commit as root:

- `qa/deployment-v2-restricted-deploy.py` → `/usr/local/sbin/cqrtv-deploy`, root:root, mode 0755.
- `ops/cqrtv-deploy-config.example.json` → `/etc/cqrtv-deploy/config.json`, root:root, mode 0600. Set `compose_sha256` to the SHA-256 of the owner-reviewed existing `/docker/playcqrtv/docker-compose.yml`. The example is deliberately unusable until this value is replaced.
- One public signing-key entry → `/etc/cqrtv-deploy/allowed_signers`, root:root, mode 0600, with identity `cqrtv-release` and namespace `cqrtv-release`.
- `/var/lib/cqrtv-deploy`, root:root, mode 0700, for replay state (schema 2, including the one-time handoff marker).
- `/var/lib/cqrtv-deploy/release.override.yml` is a persistent root-owned mode-0600 generated override. The gate atomically rewrites this fixed path with only signed digest refs. Do not delete it or replace it manually: Compose stores its path in app-container labels, and the stable path lets later runs verify the same project identity.

The config pins `project_name=playcqrtv`, `project_root=/docker/playcqrtv`, the **actual existing server Compose file path and its privately recorded SHA-256**, and observed physical volumes: `playcqrtv_postgres_data`, `playcqrtv_db_secret`, `playcqrtv_caddy_data`, `playcqrtv_caddy_config`. Do not copy or replace the Hostinger-saved Compose file with the repository version merely to make hashes match; inspect it read-only, confirm its service/volume model, then pin that exact file. If its hash changes, the gate rejects before pull or update.
The wrapper fails closed if the Compose hash, owner/mode, project labels, exact observed app container names, resolved volume names, current mounts, DB health or running image refs differ. Original DB and secret-init labels must name only the base Compose file; app labels may name only the exact pair `<base Compose>,/var/lib/cqrtv-deploy/release.override.yml` after the first gated app update. Arbitrary/temp override paths are rejected. It inspects RepoDigests by the container's immutable `.Image` ID, not by the mutable configured tag. Do not change root ownership of the existing project, Compose file or `.env` to make this pass. `.env` must remain root-only (currently reported as 0600); the workflow does not read or print its values.

## One-time legacy `:latest` to digest handoff

The owner-reported live state is configured with exactly:
- `ghcr.io/fnatika1996/playcqrtv-api:latest` in container `playcqrtv-api-1`
- `ghcr.io/fnatika1996/playcqrtv-platform:latest` in container `playcqrtv-web`

and owner-reported current RepoDigests are API `ghcr.io/fnatika1996/playcqrtv-api@sha256:82d39fad5c6b416ed27a1748a776aee14472aa2bccfdcf38a53a93742ae3ddf4` and web `ghcr.io/fnatika1996/playcqrtv-platform@sha256:f92afb6a64a2d5f60b2f61cb7fda20a88ab5db77c26e7c6d239e1047f2e4608a`. These are Issue-reported observations, not freshly checked by this PR; read-only revalidate them immediately before any future handoff.

The new manual input `legacy_handoff_approved` defaults to `false`. Keep it false for every routine release. Setting it true is a separate owner attestation and still requires the protected `production` Environment reviewer. The root gate accepts true only while its root-owned replay state says no handoff has completed, both observed container names and Compose labels/mounts match, both configured refs are those exact legacy tags, both actual container Image IDs resolve to the signed previous RepoDigests, and the root Compose file still matches its pinned hash. It pulls only the newly built, signed digest refs; `:latest` is never a pull target or deployment authorization.

After success, the root-owned state records `legacy_handoff_completed=true`. An exact replay of the same signed workflow request may return no-op success only after the root-owned state records completion. If the target is running but the completion marker is absent (for example, state persistence failed after `up`), stop for read-only operator review; the gate does not infer or repeat the migration. Any different handoff request is rejected. Future routine requests must leave the attestation false and prove the configured image refs and actual RepoDigests match the signed target or previous digests. A `:latest` configured image, mismatched digest/tag, mixed services, different container name, changed Compose hash, unknown label/volume, or unhealthy DB is a hard stop before pull. There is no automatic repair, rollback, tag pull or Compose rewrite.

### Read-only proof expected before any handoff

1. Record exact app container names, IDs, project/service/config-file/working-directory labels, configured image strings, image IDs, health and mounted volume identities without printing environment values.
2. Run image inspection against each container's `.Image` ID and compare the full RepoDigest to the signed previous refs. The daemon reports image ID and RepoDigests as separate identifiers; the implementation deliberately inspects the immutable image ID attached to the container ([Moby image inspect response fields](https://github.com/moby/moby/blob/master/api/types/image/image_inspect.go)).
3. Hash and review the actual root Compose file privately; run its resolved model with the digest-only override in isolated staging. Never infer it matches the repository file or change it to match.
4. In isolated staging, confirm the real Docker Compose `com.docker.compose.project.config_files` label changes from the base file to exactly `<base>,/var/lib/cqrtv-deploy/release.override.yml` for api/caddy, remains base-only for db/secret-init, and is accepted by a subsequent routine run. Confirm target digests, exact named mounts, and unchanged PostgreSQL container ID/data.
5. Only a separately owner-approved release may set the boolean true. If any observation differs, use an operator-assisted migration plan; do not broaden this exception.

Compose documents that `up` can recreate changed selected services while preserving mounted volumes ([Docker Compose up](https://docs.docker.com/reference/cli/docker/compose/up/)); Compose-managed containers carry project and service labels ([Compose service labels](https://docs.docker.com/reference/compose-file/services/)). The gate checks those labels and mounts before and after the update and checks that the PostgreSQL container ID is unchanged. This is not a substitute for staging proof: the running Caddy process can still write to its own mounted certificate/data volumes.

### SSH and sudo restriction

Install a root-controlled authorized-keys file and an sshd Match block for only `cqrtvdeploy`; keep a separate active administrator SSH session during staging/validation. Example for a compatible OpenSSH host:

    Match User cqrtvdeploy
        AuthenticationMethods publickey
        PasswordAuthentication no
        KbdInteractiveAuthentication no
        AuthorizedKeysFile /etc/ssh/authorized_keys/%u
        AllowTcpForwarding no
        AllowAgentForwarding no
        X11Forwarding no
        PermitTTY no
        PermitTunnel no
        PermitUserRC no
        ForceCommand /usr/bin/sudo -n /usr/local/sbin/cqrtv-deploy

The account must have no other key, password access, writable authorized_keys, shell command, SFTP/SCP access, forwarding, Docker group, or sudo permission. Keep its normal shell enabled because sshd uses it to invoke ForceCommand; the forced command replaces the requested SSH command. Test the exact OpenSSH version/config in isolated staging.

The only sudoers command should be:

    Defaults:cqrtvdeploy !setenv
    cqrtvdeploy ALL=(root) NOPASSWD: /usr/local/sbin/cqrtv-deploy ""

The empty argument marker disallows command-line arguments. Validate with `visudo -cf`, `sshd -t`, and `sudo -l -U cqrtvdeploy`; expected output is only the fixed wrapper. Do not add a Docker group grant, wildcard command, `NOPASSWD: ALL`, writable wrapper/module/config, or user-controlled `PYTHONPATH`. Install the authorized key at a root-controlled path.

Generate a dedicated signing keypair offline with `ssh-keygen -t ed25519 -C cqrtv-release`. Store only the private signing key in the GitHub `production` Environment secret `CQRTV_RELEASE_SIGNING_KEY`; install only the public key in the root-owned allowed-signers file. Keep this separate from `CQRTV_SSH_PRIVATE_KEY`. The signing key is written only to a 0600 ephemeral runner file and never printed. Confirm required reviewers, administrator-bypass prevention and main-only branch restriction before exposing either Environment secret.

## GitHub environment values

Only after the administrator confirms the pinned host and installed forced-command account:

- `CQRTV_SSH_USER=cqrtvdeploy`
- `CQRTV_PROJECT_ROOT=/docker/playcqrtv` only if that exact root, root-owned Compose path and project labels have been confirmed compatible
- `CQRTV_SSH_HOST` and pinned `CQRTV_SSH_KNOWN_HOSTS`
- production secrets `CQRTV_SSH_PRIVATE_KEY` and `CQRTV_RELEASE_SIGNING_KEY`

Do not publish variable contents, keys, host paths beyond the approved project root, `.env`, image inventory output or backup files. The server must already have root-scoped read-only GHCR pull credentials and Docker Compose, Python 3, OpenSSH signing tools and flock. Do not run `docker login` as the SSH user.

## Owner installation and verification procedure

This is an installation checklist, not permission to change the current VPS. First test on an isolated staging VPS with separate project, network, volumes, credentials and domain/loopback port.

1. Re-read the PR diff and verify the helper SHA from the approved PR. Before any installation, perform a read-only inventory on the existing project and do not display environment values:
   - Check owner/mode for `/docker`, `/docker/playcqrtv`, the saved `docker-compose.yml`, and `.env`; Compose and project paths must be root-owned and not group/world writable, and `.env` must be root-only.
   - Record the saved Compose file SHA-256 privately. Review its resolved service set and configured image for **all four** services (`api`, `caddy`, `db`, `secret-init`) alongside the live containers' `.Config.Image`. API/Caddy must match the exact approved app refs for the intended stage; db and secret-init must exactly match their existing saved Compose definitions. Never include rendered environment values in logs, reports, or issue comments.
   - For every container, verify project, service, Compose-file and working-directory labels identify this exact existing project. Before the first gated app update, all four existing containers should identify only the saved base Compose file. After that update, only api and caddy should identify the exact pair `<base Compose>,/var/lib/cqrtv-deploy/release.override.yml`; db and secret-init remain base-only. The generated override must be root-owned mode 0600 and stay at that fixed path. Confirm exactly one container per service, the existing healthy DB, successful exited secret-init, and all four expected named volumes/mount targets. The current gate rejects all bind mounts and any extra/missing mount; if the saved Compose or a container uses one, stop for operator review. No mount is implicitly allowed just because it is read-only.
   - Compare the actual Compose service/volume model with the gate's fixed allowlist and run it with the generated digest-only override in isolated staging first. If any item differs, stop; do not chown, rewrite, or replace production files.
2. Install the helper/config/signing public key root-owned with the modes above only after the owner separately approves installation. Pin the SHA-256 of the exact reviewed server Compose file; don't overwrite it with repository `docker-compose.yml`. Keep that file at its existing path and leave `.env` root:root 0600. Ensure `/docker/playcqrtv` and parent directories are root-owned and not group/world writable.
3. Confirm `cqrtvdeploy` is not in `docker` and has no sudo except the fixed no-argument wrapper. Install the root-owned authorized key and sshd Match block; run `sshd -t` and `visudo -cf`, retain the current admin session, test a new key connection and confirm it cannot run a shell, scp, forwarding, arbitrary command or a call with arguments.
4. Confirm the signing public key verifies a V2 sample request in isolated staging. A modified payload/signature must be rejected. Reproduce the exact `:latest` configured tags plus owner-observed previous RepoDigests; prove false attestation is denied, true permits only the first digest handoff, exact same-run replay is a no-op, and later handoff requests fail. Confirm wrong registry/tag/digest, project path, service, container name, volume or Compose hash is rejected.
5. Verify root Docker can pull from GHCR with its preconfigured read-only credential. Never give the SSH user Docker access or print registry credentials.
6. In GitHub Settings → Environments, configure required owner reviewers, no administrator bypass and main-only deploy branch for `production`; check that both key secrets and the four expected variable names exist. Required CI checks should be `auth-tests` and `Admin browser and static image QA (non-production)`.
7. Keep Hostinger Docker Manager and gated Compose from making concurrent updates. Do not call its `/update` or `create/replace` API for this path. The first handoff must reuse the existing `playcqrtv` project and exact volume identities; never create a parallel project or remove/rename volumes.
8. Only after a separate owner release approval, perform a gated run with freshly observed previous digests, verified backup evidence and exact main SHA. For the first migration only, the owner must explicitly attest `legacy_handoff_approved=true` and pass the protected production reviewer gate; all routine runs use false. Any label, service, DB, health, path, Compose hash, volume, configured tag or digest mismatch is an operator hold before pull. Unknown state after Compose up is read-only reconciliation only; no blind retry or automatic rollback.

The CI unit tests exercise signatures, request replay, digest allowlists, exact :latest handoff, repeat/denial behavior, app container identities, RepoDigest lookup by the running Image ID, pinned Compose-hash mismatch, strict Compose shape and fail-closed state classification. Existing disposable Docker Compose CI checks data/volume preservation, repeat/no-op behavior, unavailable pull, failed build, web rollback and PostgreSQL dump/restore. These are runner-local tests, not proof of Hostinger SSH, root ownership, the live saved Compose, GHCR credentials, production Environment protection or an isolated Hostinger staging deployment. Those gates remain owner/operator verified.
