#!/usr/bin/env python3
"""Root-only CQRTV deploy gate. Never executes an uploaded Compose document."""
import base64
import fcntl
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import time

CONFIG_PATH = "/etc/cqrtv-deploy/config.json"
PROJECT_NAME = "playcqrtv"
PROJECT_ROOT = "/docker/playcqrtv"
COMPOSE_FILE = "/docker/playcqrtv/docker-compose.yml"
ENV_FILE = "/docker/playcqrtv/.env"
ALLOWED_SIGNERS = "/etc/cqrtv-deploy/allowed_signers"
STATE_FILE = "/var/lib/cqrtv-deploy/state.json"
LOCK_FILE = "/run/lock/cqrtv-deploy.lock"
DOCKER = "/usr/bin/docker"
SSH_KEYGEN = "/usr/bin/ssh-keygen"
MAX_FRAME = 32768
MAX_PAYLOAD = 8192
MAX_CONFIG = 8192
MAX_STATE = 4096
SERVICES = ("api", "caddy", "db", "secret-init")
LEGACY_IMAGE_REF = {
    "api": "ghcr.io/fnatika1996/playcqrtv-api:latest",
    "caddy": "ghcr.io/fnatika1996/playcqrtv-platform:latest",
}
EXPECTED_CONTAINER_NAMES = {"api": "playcqrtv-api-1", "caddy": "playcqrtv-web"}
VOLUME_NAMES = {
    "postgres_data": "playcqrtv_postgres_data",
    "db_secret": "playcqrtv_db_secret",
    "caddy_data": "playcqrtv_caddy_data",
    "caddy_config": "playcqrtv_caddy_config",
}
EXPECTED_MOUNTS = {
    "api": {("volume", VOLUME_NAMES["db_secret"], "/run/db-secret")},
    "db": {
        ("volume", VOLUME_NAMES["postgres_data"], "/var/lib/postgresql/data"),
        ("volume", VOLUME_NAMES["db_secret"], "/run/db-secret"),
    },
    "caddy": {
        ("volume", VOLUME_NAMES["caddy_data"], "/data"),
        ("volume", VOLUME_NAMES["caddy_config"], "/config"),
    },
    "secret-init": {("volume", VOLUME_NAMES["db_secret"], "/run/db-secret")},
}
EXPECTED_LOGICAL_MOUNTS = {
    "api": {("db_secret", "/run/db-secret")},
    "db": {
        ("postgres_data", "/var/lib/postgresql/data"),
        ("db_secret", "/run/db-secret"),
    },
    "caddy": {("caddy_data", "/data"), ("caddy_config", "/config")},
    "secret-init": {("db_secret", "/run/db-secret")},
}
EXPECTED_IMAGE = {
    "api": re.compile(r"^ghcr\.io/fnatika1996/playcqrtv-api@sha256:[a-f0-9]{64}$"),
    "caddy": re.compile(r"^ghcr\.io/fnatika1996/playcqrtv-platform@sha256:[a-f0-9]{64}$"),
}
REQUEST_KEYS = (
    "schema_version", "release_sha", "run_id", "project_root", "manifest_sha256",
    "web_image_ref", "api_image_ref", "previous_web_ref", "previous_api_ref",
    "legacy_handoff_approved",
)
ROOT_ENV = {"PATH": "/usr/bin:/bin", "HOME": "/root", "LC_ALL": "C"}


class DeployError(Exception):
    pass


def _reject_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise DeployError("Duplicate JSON key.")
        result[key] = value
    return result


def _json(data, limit, label):
    if len(data) > limit:
        raise DeployError(label + " is too large.")
    try:
        return json.loads(data.decode("utf-8"), object_pairs_hook=_reject_duplicate_keys)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DeployError(label + " is invalid JSON.") from error


def _safe_b64(value):
    try:
        return base64.b64decode(value, validate=True)
    except Exception as error:
        raise DeployError("Signed request framing is invalid.") from error


def _trusted_file(path, owner_uid, *, directory=False, writable=False, max_size=MAX_CONFIG):
    if not os.path.isabs(path):
        raise DeployError("Configured path must be absolute.")
    parts = path.strip("/").split("/")
    current = ""
    for part in parts[:-1] if not directory else parts:
        current += "/" + part
        try:
            st = os.lstat(current)
        except OSError as error:
            raise DeployError("Required trusted path is missing.") from error
        if (not stat.S_ISDIR(st.st_mode) or stat.S_ISLNK(st.st_mode) or
                st.st_uid not in (owner_uid, 0)):
            raise DeployError("Trusted directory ownership or type is invalid.")
        if st.st_mode & 0o022:
            raise DeployError("Trusted directory is group/world writable.")
    try:
        st = os.lstat(path)
    except OSError as error:
        raise DeployError("Required trusted file is missing.") from error
    expected = stat.S_ISDIR(st.st_mode) if directory else stat.S_ISREG(st.st_mode)
    if not expected or stat.S_ISLNK(st.st_mode) or st.st_uid != owner_uid:
        raise DeployError("Trusted file ownership or type is invalid.")
    if st.st_mode & 0o022:
        raise DeployError("Trusted file is group/world writable.")
    if not writable and st.st_mode & 0o222:
        # Root-owned configuration may be root-writable, but never group/world writable.
        if owner_uid == 0:
            pass
        else:
            raise DeployError("Trusted file is writable.")
    if not directory and st.st_size > max_size:
        raise DeployError("Trusted file is too large.")
    return st


def _read_root_json(path, *, limit, owner_uid=0):
    st = _trusted_file(path, owner_uid, max_size=limit)
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
        with os.fdopen(fd, "rb") as stream:
            opened = os.fstat(stream.fileno())
            if not stat.S_ISREG(opened.st_mode) or opened.st_ino != st.st_ino or opened.st_uid != owner_uid:
                raise DeployError("Trusted file changed while opening.")
            raw = stream.read(limit + 1)
    except OSError as error:
        raise DeployError("Could not safely open trusted file.") from error
    return _json(raw, limit, "Trusted JSON file")


def validate_config(config, owner_uid=0):
    required = {
        "schema_version", "project_name", "project_root", "compose_file",
        "compose_sha256", "allowed_signers", "state_file", "volume_names",
    }
    if not isinstance(config, dict) or set(config) != required:
        raise DeployError("Deployment config schema mismatch.")
    if config["schema_version"] != 1 or config["project_name"] != PROJECT_NAME:
        raise DeployError("Deployment config identity mismatch.")
    if config["project_root"] != PROJECT_ROOT or config["compose_file"] != COMPOSE_FILE:
        raise DeployError("Deployment path differs from the owner-approved fixed project.")
    if config["allowed_signers"] != ALLOWED_SIGNERS or config["state_file"] != STATE_FILE:
        raise DeployError("Deployment trust paths do not match fixed locations.")
    if not re.fullmatch(r"[a-f0-9]{64}", str(config["compose_sha256"])):
        raise DeployError("Pinned Compose SHA-256 is invalid.")
    if config["volume_names"] != VOLUME_NAMES:
        raise DeployError("Configured volume identities do not match the observed project.")
    _trusted_file(config["allowed_signers"], owner_uid, max_size=4096)
    _trusted_file(os.path.dirname(config["state_file"]), owner_uid, directory=True)
    _trusted_file(config["compose_file"], owner_uid, max_size=256 * 1024)
    _trusted_file(ENV_FILE, owner_uid, max_size=4 * 1024 * 1024)
    _trusted_file(config["project_root"], owner_uid, directory=True)
    compose_hash = _file_sha256(config["compose_file"])
    if compose_hash != config["compose_sha256"]:
        raise DeployError("Root-owned Compose file differs from the pinned owner-approved file.")
    env_stat = os.stat(ENV_FILE, follow_symlinks=False)
    if not stat.S_ISREG(env_stat.st_mode) or env_stat.st_uid != owner_uid or env_stat.st_mode & 0o077:
        raise DeployError("Root .env must be a regular owner-only file.")
    return config


def _file_sha256(path):
    digest = hashlib.sha256()
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags)
        with os.fdopen(fd, "rb") as stream:
            while True:
                chunk = stream.read(65536)
                if not chunk:
                    break
                digest.update(chunk)
    except OSError as error:
        raise DeployError("Could not safely hash trusted file.") from error
    return digest.hexdigest()


def _verify_signature(payload_bytes, signature_bytes, allowed_signers, *, runner=subprocess.run, owner_uid=0):
    _trusted_file(allowed_signers, owner_uid, max_size=4096)
    with tempfile.TemporaryDirectory(prefix="cqrtv-verify-") as work:
        os.chmod(work, 0o700)
        payload_path = os.path.join(work, "request.json")
        signature_path = os.path.join(work, "request.json.sig")
        for path, data in ((payload_path, payload_bytes), (signature_path, signature_bytes)):
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
        result = runner(
            [SSH_KEYGEN, "-Y", "verify", "-f", allowed_signers, "-I", "cqrtv-release",
             "-n", "cqrtv-release", "-s", signature_path],
            input=payload_bytes, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            env=ROOT_ENV, timeout=10, check=False,
        )
        if result.returncode != 0:
            raise DeployError("Signed release request verification failed.")


def decode_frame(raw, allowed_signers, *, runner=subprocess.run, owner_uid=0):
    if not raw or len(raw) > MAX_FRAME or b"\r" in raw:
        raise DeployError("Signed request frame is invalid or too large.")
    lines = raw.split(b"\n")
    if lines and lines[-1] == b"":
        lines.pop()
    if len(lines) != 3 or lines[0] != b"CQRTV-DEPLOY-REQUEST-V2":
        raise DeployError("Signed request frame version mismatch.")
    signature = _safe_b64(lines[1])
    payload_bytes = _safe_b64(lines[2])
    if not signature or len(signature) > 4096 or not payload_bytes or len(payload_bytes) > MAX_PAYLOAD:
        raise DeployError("Signed request field size is invalid.")
    _verify_signature(payload_bytes, signature, allowed_signers, runner=runner, owner_uid=owner_uid)
    payload = _json(payload_bytes, MAX_PAYLOAD, "Signed release request")
    if not isinstance(payload, dict) or tuple(payload.keys()) != REQUEST_KEYS:
        raise DeployError("Signed release request schema mismatch.")
    canonical = (json.dumps(payload, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")
    if canonical != payload_bytes:
        raise DeployError("Signed release request is not canonical.")
    return payload, hashlib.sha256(payload_bytes).hexdigest()


def validate_request(payload, config):
    if type(payload["schema_version"]) is not int or payload["schema_version"] != 2:
        raise DeployError("Unsupported signed request schema.")
    if type(payload["legacy_handoff_approved"]) is not bool:
        raise DeployError("Legacy handoff attestation must be an explicit boolean.")
    if payload["project_root"] != config["project_root"]:
        raise DeployError("Signed request project root does not match fixed server config.")
    if not isinstance(payload["release_sha"], str) or not re.fullmatch(r"[a-f0-9]{40}", payload["release_sha"]):
        raise DeployError("Release SHA is invalid.")
    if not isinstance(payload["run_id"], str) or not re.fullmatch(r"[1-9][0-9]{0,19}", payload["run_id"]):
        raise DeployError("Workflow run ID is invalid.")
    if not isinstance(payload["manifest_sha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", payload["manifest_sha256"]):
        raise DeployError("Same-run manifest SHA-256 is invalid.")
    for key, service in (("web_image_ref", "caddy"), ("previous_web_ref", "caddy"),
                         ("api_image_ref", "api"), ("previous_api_ref", "api")):
        value = payload[key]
        if not isinstance(value, str) or not EXPECTED_IMAGE[service].fullmatch(value):
            raise DeployError("Image reference is outside the fixed CQRTV repository and digest policy.")
    return payload


def _command(args, *, input_bytes=None, runner=subprocess.run, timeout=60):
    result = runner(args, input=input_bytes, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    env=ROOT_ENV, timeout=timeout, check=False)
    if result.returncode != 0:
        raise DeployError("A fixed Docker/Compose operation failed; deployment stopped for operator review.")
    return result.stdout


def _compose_base(config):
    return [
        DOCKER, "compose", "--project-name", config["project_name"],
        "--env-file", ENV_FILE, "--file", config["compose_file"],
    ]


def _build_override(target_web, target_api, path):
    # Reject direct callers too; no arbitrary YAML or shell metacharacters enter this file.
    if not EXPECTED_IMAGE["caddy"].fullmatch(target_web) or not EXPECTED_IMAGE["api"].fullmatch(target_api):
        raise DeployError("Generated Compose override accepts only CQRTV registry digests.")
    content = (
        "services:\n"
        "  api:\n"
        f"    image: {target_api}\n"
        "    pull_policy: never\n"
        "  caddy:\n"
        f"    image: {target_web}\n"
        "    pull_policy: never\n"
    ).encode("ascii")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


def _inspect_container(container_id, service, config, *, runner=subprocess.run):
    fmt = ("{{.Id}}\t{{.Name}}\t{{index .Config.Labels \"com.docker.compose.project\"}}"
           "\t{{index .Config.Labels \"com.docker.compose.service\"}}"
           "\t{{index .Config.Labels \"com.docker.compose.project.config_files\"}}"
           "\t{{index .Config.Labels \"com.docker.compose.project.working_dir\"}}"
           "\t{{.Config.Image}}\t{{.Image}}\t{{.State.Status}}"
           "\t{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}\t{{.State.ExitCode}}")
    line = _command([DOCKER, "inspect", "--format", fmt, container_id], runner=runner).decode().strip()
    fields = line.split("\t")
    if len(fields) != 11:
        raise DeployError("Container metadata is incomplete.")
    keys = ("id", "name", "project", "service", "config_files", "working_dir",
            "configured_image", "image_id", "status", "health", "exit_code")
    item = dict(zip(keys, fields))
    if item["project"] != config["project_name"] or item["service"] != service:
        raise DeployError("Container Compose project/service labels do not match.")
    if service in EXPECTED_CONTAINER_NAMES and item["name"].lstrip("/") != EXPECTED_CONTAINER_NAMES[service]:
        raise DeployError("Application container name differs from the owner-observed project identity.")
    if item["config_files"] != config["compose_file"] or item["working_dir"] != config["project_root"]:
        raise DeployError("Container Compose ownership labels do not match the verified project.")
    mounts_text = _command([
        DOCKER, "inspect", "--format",
        '{{range .Mounts}}{{printf "%s\\t%s\\t%s\\n" .Type .Name .Destination}}{{end}}',
        container_id,
    ], runner=runner).decode()
    mounts = set()
    for row in mounts_text.splitlines():
        parts = row.split("\t")
        if len(parts) != 3:
            raise DeployError("Container mount inventory is malformed.")
        mounts.add(tuple(parts))
    if mounts != EXPECTED_MOUNTS[service]:
        raise DeployError("Container mount names or targets differ from the approved project.")
    if service in ("api", "caddy"):
        # Inspect the immutable image ID attached to this exact container, never the mutable tag.
        image_rows = _command(
            [DOCKER, "image", "inspect", "--format", "{{json .RepoDigests}}", item["image_id"]],
            runner=runner,
        )
        try:
            item["repo_digests"] = json.loads(image_rows.decode())
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise DeployError("Container RepoDigest metadata is invalid.") from error
    return item


def _one_container(service, config, *, runner=subprocess.run):
    result = _command([
        DOCKER, "ps", "-aq",
        "--filter", "label=com.docker.compose.project=" + config["project_name"],
        "--filter", "label=com.docker.compose.service=" + service,
    ], runner=runner).decode()
    ids = [line.strip() for line in result.splitlines() if line.strip()]
    if len(ids) != 1:
        raise DeployError("Expected exactly one existing Compose container for " + service + ".")
    return _inspect_container(ids[0], service, config, runner=runner)


def _volume_name_map(compose_config):
    volumes = compose_config.get("volumes")
    if not isinstance(volumes, dict):
        raise DeployError("Compose volume configuration is invalid.")
    return {key: value.get("name") for key, value in volumes.items() if isinstance(value, dict)}


def _validate_compose_config(document, config, payload):
    if not isinstance(document, dict):
        raise DeployError("Rendered Compose document is invalid.")
    services = document.get("services")
    volumes = document.get("volumes")
    if not isinstance(services, dict) or set(services) != set(SERVICES):
        raise DeployError("Compose service set differs from the approved CQRTV project.")
    if not isinstance(volumes, dict) or set(volumes) != set(VOLUME_NAMES):
        raise DeployError("Compose named-volume set differs from the approved CQRTV project.")
    expected = {"api": payload["api_image_ref"], "caddy": payload["web_image_ref"]}
    for service, image in expected.items():
        definition = services.get(service)
        if not isinstance(definition, dict):
            raise DeployError("Compose service definition is invalid.")
        if definition.get("image") != image or definition.get("pull_policy") != "never":
            raise DeployError("Generated Compose override did not preserve exact digest refs.")
        if "build" in definition:
            raise DeployError("App services may not build arbitrary images on the server.")
    for service, definition in services.items():
        if not isinstance(definition, dict) or not isinstance(definition.get("image"), str):
            raise DeployError("Every fixed Compose service must have one image.")
        if definition["image"].endswith(":latest") or "build" in definition:
            raise DeployError("Fixed Compose services may not use a floating image or build context.")
        mounts = set()
        for mount in definition.get("volumes", []):
            if not isinstance(mount, dict) or mount.get("type") != "volume":
                raise DeployError("Only the approved named volume mounts are allowed.")
            mounts.add((mount.get("source"), mount.get("target")))
        if mounts != EXPECTED_LOGICAL_MOUNTS[service]:
            raise DeployError("Rendered Compose logical volume mounts differ from the approved project.")
    names = _volume_name_map(document)
    if names != config["volume_names"]:
        raise DeployError("Rendered Compose resolved to unexpected physical volume names.")
    return document


def _inventory(config, *, runner=subprocess.run):
    services = {name: _one_container(name, config, runner=runner) for name in SERVICES}
    db = services["db"]
    if db["status"] != "running" or db["health"] != "healthy":
        raise DeployError("The single existing PostgreSQL container is not healthy.")
    if services["secret-init"]["status"] != "exited" or services["secret-init"]["exit_code"] != "0":
        raise DeployError("The existing secret-init container is not completed successfully.")
    for service in ("api", "caddy"):
        if services[service]["status"] != "running" or services[service]["health"] not in ("healthy", "none"):
            raise DeployError("An existing application container is not healthy.")
    return services


def _classify_refs(services, payload):
    current = {}
    for service, target_key, previous_key in (
        ("api", "api_image_ref", "previous_api_ref"),
        ("caddy", "web_image_ref", "previous_web_ref"),
    ):
        digests = services[service]["repo_digests"]
        target = payload[target_key]
        previous = payload[previous_key]
        if not isinstance(digests, list):
            raise DeployError("Container RepoDigest list is invalid.")
        if target in digests:
            current[service] = "target"
        elif previous in digests:
            current[service] = "previous"
        else:
            raise DeployError("Observed running image is neither the exact target nor recorded previous digest.")
    if current["api"] == "target" and current["caddy"] == "target":
        return "target"
    if current["api"] == "previous" and current["caddy"] == "previous":
        return "previous"
    raise DeployError("Observed web/API state is mixed or unknown; operator review required.")


def _read_state(path, owner_uid=0):
    try:
        state = _read_root_json(path, limit=MAX_STATE, owner_uid=owner_uid)
    except DeployError as error:
        if not os.path.exists(path):
            return {"schema_version": 2, "run_id": "0", "payload_sha256": "", "legacy_handoff_completed": False}
        raise error
    if (not isinstance(state, dict) or
            set(state) != {"schema_version", "run_id", "payload_sha256", "legacy_handoff_completed"} or
            state["schema_version"] != 2 or
            not isinstance(state["run_id"], str) or not re.fullmatch(r"[0-9]{1,20}", state["run_id"]) or
            not isinstance(state["payload_sha256"], str) or
            (state["payload_sha256"] and not re.fullmatch(r"[a-f0-9]{64}", state["payload_sha256"])) or
            type(state["legacy_handoff_completed"]) is not bool):
        raise DeployError("Protected deployment replay state is invalid.")
    return state


def _write_state(path, state):
    directory = os.path.dirname(path)
    fd, temp_path = tempfile.mkstemp(prefix=".state-", dir=directory)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write((json.dumps(state, sort_keys=True, separators=(",", ":")) + "\n").encode())
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_path, path)
        dir_fd = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    except Exception:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise


def _check_replay(state, payload, payload_hash):
    last_id = int(state.get("run_id", "0"))
    run_id = int(payload["run_id"])
    if run_id < last_id:
        raise DeployError("Signed workflow request is older than the last accepted release.")
    if run_id == last_id and state.get("payload_sha256") != payload_hash:
        raise DeployError("Workflow run ID was already used for a different signed request.")


def _validate_configured_app_images(services, payload, state, payload_hash, *, allow_handoff_convergence=False):
    current = _classify_refs(services, payload)
    configured = {
        "api": services["api"].get("configured_image"),
        "caddy": services["caddy"].get("configured_image"),
    }
    target = {"api": payload["api_image_ref"], "caddy": payload["web_image_ref"]}
    previous = {"api": payload["previous_api_ref"], "caddy": payload["previous_web_ref"]}
    handoff_requested = payload["legacy_handoff_approved"]
    handoff_completed = state["legacy_handoff_completed"]

    if handoff_requested:
        if handoff_completed:
            same_accepted_request = (
                state["run_id"] == payload["run_id"] and state["payload_sha256"] == payload_hash
            )
            if same_accepted_request and current == "target" and configured == target:
                return "target", True
            raise DeployError("The one-time legacy handoff was already completed.")
        if current == "previous" and configured == LEGACY_IMAGE_REF:
            # Only the explicitly observed legacy tags qualify; the signed previous refs
            # must match RepoDigests inspected by each container's image ID.
            return "previous", True
        if allow_handoff_convergence and current == "target" and configured == target:
            # This is reachable only after the fixed Compose up operation. The
            # preflight path never accepts a target with an incomplete marker.
            return "target", True
        raise DeployError("Legacy handoff state differs from the exact owner-attested tags and digests.")

    expected = previous if current == "previous" else target
    if configured != expected:
        raise DeployError("Running configured image refs do not match the signed target/previous RepoDigests.")
    return current, handoff_completed


def _safe_project_files(config, owner_uid=0):
    _trusted_file(config["project_root"], owner_uid, directory=True)
    _trusted_file(config["compose_file"], owner_uid, max_size=256 * 1024)
    _trusted_file(ENV_FILE, owner_uid, max_size=4 * 1024 * 1024)
    env_stat = os.stat(ENV_FILE, follow_symlinks=False)
    if env_stat.st_uid != owner_uid or env_stat.st_mode & 0o077:
        raise DeployError("Root .env must be owner-only.")
    if _file_sha256(config["compose_file"]) != config["compose_sha256"]:
        raise DeployError("Pinned root Compose file changed; no deployment applied.")


def perform_deployment(payload, payload_hash, config, *, runner=subprocess.run, sleep=time.sleep, attempts=30, owner_uid=0):
    _safe_project_files(config, owner_uid=owner_uid)
    lock_fd = os.open(LOCK_FILE, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    lock_stat = os.fstat(lock_fd)
    if lock_stat.st_uid != owner_uid or not stat.S_ISREG(lock_stat.st_mode) or lock_stat.st_mode & 0o077:
        os.close(lock_fd)
        raise DeployError("Deployment lock file ownership or permissions are unsafe.")
    with os.fdopen(lock_fd, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = _read_state(config["state_file"], owner_uid=owner_uid)
        _check_replay(state, payload, payload_hash)
        with tempfile.TemporaryDirectory(prefix="cqrtv-compose-") as work:
            os.chmod(work, 0o700)
            override = os.path.join(work, "release.override.yml")
            _build_override(payload["web_image_ref"], payload["api_image_ref"], override)
            base = _compose_base(config)
            _safe_project_files(config, owner_uid=owner_uid)
            config_bytes = _command(base + ["--file", override, "config", "--format", "json"], runner=runner)
            _safe_project_files(config, owner_uid=owner_uid)
            document = _json(config_bytes, 2 * 1024 * 1024, "Rendered Compose")
            _validate_compose_config(document, config, payload)
            before = _inventory(config, runner=runner)
            for service in ("db", "secret-init"):
                if before[service]["configured_image"] != document["services"][service]["image"]:
                    raise DeployError("Database/secret-init image differs from the pinned Compose definition.")
            current, handoff_completed = _validate_configured_app_images(before, payload, state, payload_hash)
            if current == "target":
                _write_state(config["state_file"], {
                    "schema_version": 2, "run_id": payload["run_id"], "payload_sha256": payload_hash,
                    "legacy_handoff_completed": handoff_completed,
                })
                return "Already-running target digests are healthy; no-op success."
            # Explicit pulls happen before any service update.
            _safe_project_files(config, owner_uid=owner_uid)
            _command(base + ["--file", override, "pull", "api", "caddy"], runner=runner, timeout=300)
            for service, key in (("api", "api_image_ref"), ("caddy", "web_image_ref")):
                image_ref = payload[key]
                output = _command([DOCKER, "image", "inspect", "--format", "{{json .RepoDigests}}", image_ref], runner=runner)
                digests = _json(output, 16384, "Pulled image RepoDigests")
                if not isinstance(digests, list) or image_ref not in digests:
                    raise DeployError("Pulled image does not expose the exact approved RepoDigest.")
            up_error = None
            _safe_project_files(config, owner_uid=owner_uid)
            try:
                _command(base + ["--file", override, "up", "-d", "--no-build", "--no-deps", "api", "caddy"], runner=runner, timeout=300)
            except DeployError as error:
                up_error = error
            final = None
            for attempt in range(attempts):
                try:
                    observed = _inventory(config, runner=runner)
                    if observed["db"]["id"] != before["db"]["id"]:
                        raise DeployError("PostgreSQL container identity changed during app deployment.")
                    if not isinstance(observed, dict):
                        raise DeployError("Observed post-update container inventory is invalid.")
                    observed_state, observed_handoff = _validate_configured_app_images(
                        observed, payload, state, payload_hash, allow_handoff_convergence=True,
                    )
                    if observed_state == "target" and observed_handoff == handoff_completed:
                        final = observed
                        break
                except DeployError:
                    if attempt == attempts - 1:
                        raise
                if attempt < attempts - 1:
                    sleep(4)
            if final is None:
                if up_error:
                    raise DeployError("Compose update failed; state did not converge. No retry or rollback was attempted.")
                raise DeployError("Compose update did not converge. No retry or rollback was attempted.")
            _write_state(config["state_file"], {
                "schema_version": 2, "run_id": payload["run_id"], "payload_sha256": payload_hash,
                "legacy_handoff_completed": handoff_completed,
            })
            return "Exact web/API target digests are running; PostgreSQL identity is unchanged."


def main():
    try:
        if len(sys.argv) != 1:
            raise DeployError("This fixed entrypoint accepts no command-line arguments.")
        config = _read_root_json(CONFIG_PATH, limit=MAX_CONFIG)
        validate_config(config)
        raw = sys.stdin.buffer.read(MAX_FRAME + 1)
        payload, payload_hash = decode_frame(raw, config["allowed_signers"])
        validate_request(payload, config)
        result = perform_deployment(payload, payload_hash, config)
        print("CQRTV restricted deployment: " + result)
    except DeployError as error:
        print("CQRTV restricted deployment stopped: " + str(error), file=sys.stderr)
        return 1
    except (OSError, subprocess.TimeoutExpired, ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
        # Do not dump exception reprs, command output, environment or request payload to logs.
        print("CQRTV restricted deployment stopped safely (" + type(error).__name__ + ").", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
