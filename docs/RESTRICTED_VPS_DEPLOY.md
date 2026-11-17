# Restricted CQRTV VPS deployment

## Security model

The SSH account `cqrtvdeploy` must not belong to the `docker` group and must have no general sudo rule. Docker socket access is root-equivalent. The workflow connects without a remote command; sshd forces the single no-argument command `sudo -n /usr/local/sbin/cqrtv-deploy`.

The workflow signs a small canonical request with a separate Ed25519 OpenSSH signing key stored only as the `production` Environment secret `CQRTV_RELEASE_SIGNING_KEY`. The VPS verifies it against root-owned `allowed_signers`. An SSH key by itself cannot authorize deployment. The signed request binds release SHA, run ID, pinned project root, manifest SHA-256, target web/API RepoDigests and previously observed web/API RepoDigests. The root entrypoint rejects stale or reused run IDs.

The signed Compose artifact is retained in GitHub Actions and its hash is bound into the request, but the VPS never executes or parses an uploaded Compose file. It generates a temporary root-only override containing only the two validated CQRTV image digest references, combines that with the pinned root-owned Compose file, validates the resolved services and volume identities, then executes fixed Docker Compose argument lists. No request field becomes a command, file path, mount, service name or shell fragment. The wrapper updates only `api` and `caddy`; it checks DB health and identity and never runs `down`, updates `db`, or removes volumes.

This is a meaningful privilege reduction, not a full sandbox. A permitted application image is production code and can exercise the access already granted to its service, including API access to the database secret. A compromised approved release/signing key or an improperly protected GitHub Environment can therefore still cause serious damage. Keep owner approval, protected main, pinned images, backup and operator review.

## Required root-owned configuration

After a separate owner approval and an isolated staging proof, an authorized VPS administrator installs the reviewed file from the approved PR commit as root:

- `qa/deployment-v2-restricted-deploy.py` → `/usr/local/sbin/cqrtv-deploy`, root:root, mode 0755.
- `ops/cqrtv-deploy-config.example.json` → `/etc/cqrtv-deploy/config.json`, root:root, mode 0600. Set `compose_sha256` to the SHA-256 of the owner-reviewed existing `/docker/playcqrtv/docker-compose.yml`. The example is deliberately unusable until this value is replaced.
- One public signing-key entry → `/etc/cqrtv-deploy/allowed_signers`, root:root, mode 0600, with identity `cqrtv-release` and namespace `cqrtv-release`.
- `/var/lib/cqrtv-deploy`, root:root, mode 0700, for replay state.

The config pins `project_name=playcqrtv`, `project_root=/docker/playcqrtv`, the current Compose path/hash and observed physical volumes:
`playcqrtv_postgres_data`, `playcqrtv_db_secret`, `playcqrtv_caddy_data`, `playcqrtv_caddy_config`.
The wrapper fails closed if the Compose hash, owner/mode, project labels, resolved volume names, current mounts, DB health or running image refs differ. Do not change root ownership of the existing project, Compose file or `.env` to make this pass. `.env` must remain root-only (currently reported as 0600); the workflow does not read or print its values.

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

1. Re-read the PR diff and verify the helper SHA from the approved PR. Compare the live root-owned Compose file with the reviewed Compose content, record its SHA-256 privately, and verify labels/working directory and all four volume names match. If anything differs, stop; do not chown or rewrite production files.
2. Install the helper/config/signing public key root-owned with the modes above. Keep the verified root Compose at its existing path and leave `.env` root:root 0600. Ensure `/docker/playcqrtv` and parent directories are root-owned and not group/world writable.
3. Confirm `cqrtvdeploy` is not in `docker` and has no sudo except the fixed no-argument wrapper. Install the root-owned authorized key and sshd Match block; run `sshd -t` and `visudo -cf`, retain the current admin session, test a new key connection and confirm it cannot run a shell, scp, forwarding, arbitrary command or a call with arguments.
4. Confirm the signing public key verifies a sample request in isolated staging. A modified payload/signature must be rejected. Confirm wrong registry, tags, malformed SHA, project path, service or volume are rejected.
5. Verify root Docker can pull from GHCR with its preconfigured read-only credential. Never give the SSH user Docker access or print registry credentials.
6. In GitHub Settings → Environments, configure required owner reviewers, no administrator bypass and main-only deploy branch for `production`; check that both key secrets and the four expected variable names exist. Required CI checks should be `auth-tests` and `Admin browser and static image QA (non-production)`.
7. Keep Hostinger Docker Manager and gated Compose from making concurrent updates. Do not call its `/update` or `create/replace` API for this path. The first handoff must reuse the existing `playcqrtv` project and exact volume identities; never create a parallel project or remove/rename volumes.
8. Only after a separate owner release approval, perform a gated run with freshly observed previous digests, verified backup evidence and exact main SHA. Any label, service, DB, health, path, Compose hash, volume or digest mismatch is an operator hold before pull. Unknown state after Compose up is read-only reconciliation only; no blind retry or automatic rollback.

The CI unit tests exercise signatures, request replay, digest allowlists, strict Compose shape and fail-closed state classification. Existing disposable Docker Compose CI checks data/volume preservation, repeat/no-op behavior, unavailable pull, failed build, web rollback and PostgreSQL dump/restore. These are runner-local tests, not proof of Hostinger SSH, root ownership, the live saved Compose, GHCR credentials, production Environment protection or an isolated Hostinger staging deployment. Those gates remain owner/operator verified.
