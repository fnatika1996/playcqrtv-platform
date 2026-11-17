# CQRTV isolated staging plan (PR #24)

## Decision and proof boundary

This PR adds a compile-time-fixed staging gate and a same-host Compose-only isolation smoke harness. It does not install either on a server. Production remains untouched.

A Docker Compose project named cqrtv-v2-staging isolates Compose names and named volumes; it does not isolate the host SSH daemon, sudoers, Docker daemon, users, firewall, or root. The supplied production VPS therefore must not be used to test the forced-command root gate. Full root-gate + sshd/sudo validation belongs on a separate disposable VPS that has no production credentials, Docker socket access to production, data, or SSH/signing keys. That disposable host has not been supplied, so this plan does not claim a successful end-to-end host test.

The same-host smoke exercises only local Compose behavior and synthetic test containers at loopback port 127.0.0.1:18080. It never installs the staging root gate, edits sshd/sudoers, opens a registry, or touches production project names. Its presence in this PR is not authorization to run it.

## Fixed staging identity

| Purpose | Fixed staging value |
| --- | --- |
| Compose project | cqrtv-v2-staging |
| Project root | /opt/cqrtv-v2-staging |
| Compose file | /opt/cqrtv-v2-staging/docker-compose.yml |
| Env file | /opt/cqrtv-v2-staging/staging.env |
| Gate config | /etc/cqrtv-v2-staging/config.json |
| Allowed signers | /etc/cqrtv-v2-staging/allowed_signers |
| Gate state | /var/lib/cqrtv-v2-staging/state.json |
| Stable image override | /var/lib/cqrtv-v2-staging/release.override.yml |
| Volumes | cqrtv-v2-staging_postgres_data, cqrtv-v2-staging_db_secret, cqrtv-v2-staging_caddy_data, cqrtv-v2-staging_caddy_config |
| Host-published port | 127.0.0.1:18080:80 only |

The staging Python gate has these values as constants. It cannot accept project root, config path, signer path, Compose path, or volume names from request/runtime arguments. It rejects a production config and production image references. Its release signer identity and OpenSSH namespace are cqrtv-v2-staging-release, distinct from production.

All staging images in ops/cqrtv-v2-staging/images are synthetic test services, not copies of CQRTV production API or website. They expose a test health endpoint and a page that says “CQRTV STAGING ONLY”. The example env file contains no password; the Compose smoke generates a synthetic password with mode 0600 and never prints it.

## A. Optional same-host Compose-only smoke

Run only after the owner independently decides to allocate staging resources on the existing VPS. Use one command at a time and inspect output before continuing. Do not run root-gate or sshd/sudo steps from section B on that host.

1. Read-only preflight. Expected: root-owned mode 700 staging directory, Docker context default on the local Unix socket, free port 18080, no staging containers/network/volumes. Stop if any check differs.

    id
    stat -c '%U:%G %a %n' /opt/cqrtv-v2-staging
    docker context show
    docker context inspect default --format '{{.Endpoints.docker.Host}}'
    ss -Hlt '( sport = :18080 )'
    docker ps -a --filter label=com.docker.compose.project=cqrtv-v2-staging
    docker volume ls --filter name=cqrtv-v2-staging_
    docker network ls --filter name=cqrtv-v2-staging-net

Expected context/socket: default and unix:///var/run/docker.sock. Expected staging resource listings are empty. The smoke script repeats these checks and refuses to reuse stage resources.

2. Obtain this PR checkout in a separate temporary directory on the operator workstation or staging host, then install only the smoke Compose file into the pre-created staging directory. Do not use production .env, certificates, mounted data, or keys. Verify that the directory remains empty before installing the file.

    install -o root -g root -m 0600 ops/cqrtv-v2-staging/compose.smoke.yml /opt/cqrtv-v2-staging/compose.smoke.yml

3. Run the Compose-only harness from the PR checkout. Expected final line starts with PASS compose-only isolation smoke; it reports project, loopback port, stable override labels, unchanged DB container, and the synthetic marker only. It does not print the generated password. It deliberately leaves stage containers and volumes for review.

    sudo bash qa/vps-staging-compose-smoke.sh

Expected checks: local test images are built with separate latest and target variants; project/network/volume names are staging-only; only port 18080 is published on loopback; health endpoint/page respond; the script writes and reads marker staging-data-preserved; app-only update leaves DB and secret-init IDs intact; API/Caddy labels become exactly <base compose>,<stable override>; the repeat operation keeps the same labels and marker. This is real Compose behavior only. It does not test signature verification, forced SSH command, sudoers, or production host setup.

Do not add --volumes to cleanup. Preserve evidence and DB marker until owner review. If cleanup is later approved, inspect the exact project and rendered config first:

    docker compose --project-name cqrtv-v2-staging --project-directory /opt/cqrtv-v2-staging --env-file /opt/cqrtv-v2-staging/staging.env --file /opt/cqrtv-v2-staging/compose.smoke.yml --file /opt/cqrtv-v2-staging/smoke.override.yml config --volumes
    docker compose --project-name cqrtv-v2-staging --project-directory /opt/cqrtv-v2-staging --env-file /opt/cqrtv-v2-staging/staging.env --file /opt/cqrtv-v2-staging/compose.smoke.yml --file /opt/cqrtv-v2-staging/smoke.override.yml down --remove-orphans

Then verify that exact-project containers and the named network are gone. Compose down intentionally retains named volumes. Volume deletion is a separate destructive action; never use broad prune commands.

## B. Full root-gate + SSH test (separate disposable VPS only)

Provision a disposable VPS dedicated to this test, with no production environment variables, application data, backups, credentials, host keys, registry credentials, or Docker socket sharing. Use an isolated private network/firewall and destroy the VPS after preserving nonsecret logs. Do not point this procedure at the existing production VPS: sshd Match blocks, sudoers, local registry trust, and Docker daemon changes are host-global.

Run one step at a time on the disposable host. Stop and investigate on unexpected identity or output.

1. Confirm this is the disposable host and staging path is empty. Expected: approved temporary hostname, empty staging resources, no production mounts or references.

    hostnamectl --static
    stat -c '%U:%G %a %n' /opt/cqrtv-v2-staging
    docker ps -a --filter label=com.docker.compose.project=cqrtv-v2-staging
    docker volume ls --filter name=cqrtv-v2-staging_

2. Install the staging gate only at a root-owned fixed path; use the example config and pinned checksum of the reviewed docker-compose.gate.yml. Keep config, env, Compose and signer files root-owned and non-writable to the deploy account. Generate a fresh staging-only Ed25519 signing key and a separate staging-only SSH key on the test runner. Never reuse production identities. Pin only the staging public signing key using identity/namespace cqrtv-v2-staging-release. Store private keys only in this disposable test's isolated runner; do not paste contents in logs or Issue #4.

Intended mapping: gate at /usr/local/sbin/cqrtv-v2-staging-deploy; config at /etc/cqrtv-v2-staging/config.json; Compose at /opt/cqrtv-v2-staging/docker-compose.yml; isolated env at /opt/cqrtv-v2-staging/staging.env; signer list at /etc/cqrtv-v2-staging/allowed_signers; state under /var/lib/cqrtv-v2-staging; lock under /run/lock/cqrtv-v2-staging.lock. Derive the Compose checksum after installing the exact reviewed file and replace its zero placeholder in a copy of config.example.json. Do not substitute runtime-provided paths.

3. Create a dedicated unprivileged SSH account for staging only. Give it no Docker group membership, no shell, and no general sudo. Configure a forced command that can invoke only a root-owned wrapper with no arguments; sudoers, if required by the selected OpenSSH arrangement, must grant only this one fixed wrapper. Pin the disposable server host key on the test runner. Verify a harmless/empty request is rejected and the SSH account cannot run arbitrary commands or access the Docker socket before sending any valid request.

Expected account checks: id cqrtv-v2-staging-deploy has no docker group; sudo -l -U cqrtv-v2-staging-deploy shows only the exact wrapper or no sudo if forced command is root-owned; test ! -r /var/run/docker.sock as that account succeeds. Keep changes confined to disposable VPS.

4. Create a private TLS registry used only by the disposable VPS and isolated runner, or another isolated test registry with equivalent pinned trust. Trust its test certificate only on that disposable VPS/runner. Build and push only synthetic images from this PR. Seed exact staging tags 127.0.0.1:5000/cqrtv-v2-staging-api:latest and 127.0.0.1:5000/cqrtv-v2-staging-web:latest; record their synthetic RepoDigests read-only. Install gate Compose with those refs. Only port 18080 may be host-published. Confirm all actual mounts resolve to the four cqrtv-v2-staging_* volumes and no bind mount/socket mount exists.

5. Send the first signed request with the staging-only legacy_handoff_approved=true attestation and exact observed staging :latest references/RepoDigests. The staging builder accepts only project cqrtv-v2-staging, root /opt/cqrtv-v2-staging, fixed test-registry repositories, immutable SHA-256 refs, and exact image lines in the staging manifest. Expected success: root gate verifies Ed25519 signature in namespace cqrtv-v2-staging-release, applies only the two immutable app digests to API/Caddy, and writes one-time handoff state. DB and secret-init IDs, labels, mounts and marker remain unchanged.

6. Test denials before another valid release. Alter one byte in the signed canonical payload; expected signature denial and no Docker/Compose pull/up. Re-send identical valid signed frame; expected idempotent no-op because target digests already run. Submit newly signed handoff request with legacy_handoff_approved=true; expected denial because handoff is consumed. Submit wrong signer/namespace, changed manifest hash, production project root/name/image, mutable target ref, or unknown volume label; expected fail-closed before pull/up. Record only exit status and sanitized error category.

7. Verify stable override and data preservation. Expected API/Caddy com.docker.compose.project.config_files labels equal exactly /opt/cqrtv-v2-staging/docker-compose.yml,/var/lib/cqrtv-v2-staging/release.override.yml; DB and secret-init remain base-file-only. Confirm override is root-owned mode 0600 and contains only approved digests. Verify DB container ID, named mounts, and marker row are unchanged.

8. Publish a subsequent routine staging release with new immutable synthetic digests and legacy_handoff_approved=false. Expected signed request accepted; only API/Caddy update; stable labels unchanged; DB identity and marker remain the same. Replay/tamper tests still deny before Compose mutation.

9. Save nonsecret evidence (head SHA, gate version, command exit codes, sanitized labels, synthetic image digests, before/after DB ID, volume names, marker result, override owner/mode and stable path). Never include private/public key material, synthetic password, env contents, signatures, registry credentials, or production identifiers/secrets in the report.

### Disposable VPS cleanup guard

After evidence review, stop only the exact staging project; do not prune globally and do not delete volumes until owner separately approves data removal.

    docker compose --project-name cqrtv-v2-staging --project-directory /opt/cqrtv-v2-staging --env-file /opt/cqrtv-v2-staging/staging.env --file /opt/cqrtv-v2-staging/docker-compose.yml down --remove-orphans
    docker ps -a --filter label=com.docker.compose.project=cqrtv-v2-staging
    docker volume ls --filter name=cqrtv-v2-staging_

Expected: no containers/network for that project; isolated volumes remain. Destroy the disposable VPS after evidence export and remove temporary test signing/SSH keys from runner. Never run commands against playcqrtv resources.

## CI evidence and limitations

PR CI tests the staging gate's isolated unit tests, signed request builder tests, production-identity rejection, shell syntax, and static checks that Compose exposes only loopback port 18080 and has no production paths/mounts/socket. Existing PR CI separately runs the production gate and disposable Compose label/data-preservation suite.

CI does not create a real sshd/sudoers boundary. Do not report root-gate + SSH as tested until section B runs on a separate disposable VPS. Same-host smoke has not been run by Codex; it requires owner-side host allocation and approval. No production VPS, GitHub secrets, SSH/sudo configuration, containers, backups, volumes, merge, or workflow dispatch were changed by this work.
