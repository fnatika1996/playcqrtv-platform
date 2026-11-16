#!/usr/bin/env bash
set -Eeuo pipefail

project_root=${1:?project root required}
manifest=${2:?release manifest required}
project=${3:?Compose project name required}
target_web=${4:?target web digest required}
target_api=${5:?target API digest required}
previous_web=${6:?previous web digest required}
previous_api=${7:?previous API digest required}

[[ "$project_root" =~ ^/[A-Za-z0-9/_-]+$ ]]
[[ "$manifest" == "$project_root/releases/"* ]]
[[ "$project" =~ ^[A-Za-z0-9_-]+$ ]]
[[ "$target_web" =~ ^ghcr\.io/fnatika1996/playcqrtv-platform@sha256:[a-f0-9]{64}$ ]]
[[ "$target_api" =~ ^ghcr\.io/fnatika1996/playcqrtv-api@sha256:[a-f0-9]{64}$ ]]
[[ "$previous_web" =~ ^ghcr\.io/fnatika1996/playcqrtv-platform@sha256:[a-f0-9]{64}$ ]]
[[ "$previous_api" =~ ^ghcr\.io/fnatika1996/playcqrtv-api@sha256:[a-f0-9]{64}$ ]]
[[ "$target_web" != "$previous_web" || "$target_api" != "$previous_api" ]]
[[ -f "$manifest" && -f "$project_root/.env" ]]
command -v stat >/dev/null
env_mode=$(stat -c '%a' "$project_root/.env")
if (( (8#$env_mode & 077) != 0 )); then
  echo "Remote .env is group/world-readable; refusing deployment." >&2
  exit 1
fi
command -v docker >/dev/null
command -v python3 >/dev/null
command -v flock >/dev/null

exec 9>"$project_root/.cqrtv-deploy.lock"
flock -n 9 || { echo "Another CQRTV release holds the deploy lock; stop for operator review." >&2; exit 1; }
tmp_dir=$(mktemp -d)
trap 'rm -rf -- "$tmp_dir"' EXIT
chmod 700 "$tmp_dir"
config_json="$tmp_dir/compose.json"
volume_map="$tmp_dir/volumes.tsv"

compose() {
  docker compose --project-name "$project" --env-file "$project_root/.env" -f "$manifest" "$@"
}

compose config --quiet
compose config --format json > "$config_json"
python3 - "$config_json" "$target_web" "$target_api" "$volume_map" <<'PY'
import json, sys
config_path, expected_web, expected_api, volume_path = sys.argv[1:]
with open(config_path, encoding="utf-8") as stream:
    doc = json.load(stream)
services, volumes = doc.get("services", {}), doc.get("volumes", {})
if sorted(services) != ["api", "caddy", "db", "secret-init"]:
    raise SystemExit("Compose service set mismatch; no change applied.")
if sorted(volumes) != ["caddy_config", "caddy_data", "db_secret", "postgres_data"]:
    raise SystemExit("Compose named-volume set mismatch; no change applied.")
init_mounts = [item for item in services.get("secret-init", {}).get("volumes", [])
               if item.get("target") == "/run/db-secret" and item.get("type") == "volume"]
if len(init_mounts) != 1 or init_mounts[0].get("source") != "db_secret":
    raise SystemExit("Compose secret initialization volume mismatch; no change applied.")
if services.get("api", {}).get("image") != expected_api:
    raise SystemExit("Compose API digest mismatch; no change applied.")
if services.get("caddy", {}).get("image") != expected_web:
    raise SystemExit("Compose web digest mismatch; no change applied.")
for service in services.values():
    image = service.get("image", "")
    if not image or image.endswith(":latest"):
        raise SystemExit("Compose contains a missing or floating latest image ref.")
expected_mounts = {
    ("db", "/var/lib/postgresql/data"), ("db", "/run/db-secret"),
    ("api", "/run/db-secret"), ("caddy", "/data"), ("caddy", "/config"),
}
rows = []
for service_name, target in sorted(expected_mounts):
    items = [item for item in services.get(service_name, {}).get("volumes", [])
             if item.get("target") == target and item.get("type") == "volume"]
    if len(items) != 1:
        raise SystemExit("Compose persistent volume binding mismatch; no change applied.")
    source = items[0].get("source")
    name = volumes.get(source, {}).get("name")
    if not source or not name:
        raise SystemExit("Compose volume name is unresolved; no change applied.")
    rows.append((service_name, target, name))
with open(volume_path, "w", encoding="utf-8") as stream:
    for row in rows:
        stream.write("\t".join(row) + "\n")
PY

# Compare every required candidate volume to the actual existing mount before any pull/update.
while IFS=$'\t' read -r service target expected_volume; do
  mapfile -t ids < <(docker ps -aq --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$service")
  if [[ ${#ids[@]} -ne 1 ]]; then
    echo "Read-only inventory did not find exactly one existing $service container; no change applied." >&2
    exit 1
  fi
  mounts=$(docker inspect --format '{{range .Mounts}}{{println .Name "|" .Destination "|" .Type}}{{end}}' "${ids[0]}")
  actual_volume=$(printf '%s\n' "$mounts" | awk -F'|' -v destination="$target" '$2 == destination && $3 == "volume" { print $1 }')
  if [[ "$actual_volume" != "$expected_volume" ]]; then
    echo "Candidate volume differs from existing $service mount; no change applied." >&2
    exit 1
  fi
  docker volume inspect "$actual_volume" >/dev/null
done < "$volume_map"

container_state() {
  docker inspect --format '{{json .State}}' "$1" |
    python3 -c 'import json,sys; s=json.load(sys.stdin); print(s.get("Status","unknown")+"|"+((s.get("Health") or {}).get("Status") or "none"))'
}

service_ref_and_health() {
  local service="$1" wanted_target="$2" wanted_previous="$3"
  mapfile -t ids < <(docker ps -aq --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$service")
  [[ ${#ids[@]} -eq 1 ]] || { printf 'unknown|stopped\n'; return; }
  local image_id repo_digests runtime state health ref=unknown
  image_id=$(docker inspect --format '{{.Image}}' "${ids[0]}")
  repo_digests=$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image_id" 2>/dev/null || true)
  runtime=$(container_state "${ids[0]}")
  state="${runtime%%|*}"
  health="${runtime#*|}"
  if grep -Fqx "$wanted_target" <<<"$repo_digests"; then ref=target
  elif grep -Fqx "$wanted_previous" <<<"$repo_digests"; then ref=previous
  fi
  if [[ "$state" == running && ( "$health" == healthy || "$health" == none ) ]]; then
    printf '%s|healthy\n' "$ref"
  else
    printf '%s|unhealthy\n' "$ref"
  fi
}

db_health() {
  mapfile -t ids < <(docker ps -aq --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=db")
  [[ ${#ids[@]} -eq 1 ]] || { printf 'unknown\n'; return; }
  container_state "${ids[0]}"
}
db_container_before=$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=db")
if [[ -z "$db_container_before" || "$(db_health)" != "running|healthy" ]]; then
  echo "Database is not the single healthy existing service; no change applied." >&2
  exit 1
fi

api_state=$(service_ref_and_health api "$target_api" "$previous_api")
web_state=$(service_ref_and_health caddy "$target_web" "$previous_web")
if [[ "$api_state" == "target|healthy" && "$web_state" == "target|healthy" ]]; then
  echo "Read-only reconciliation: exact target digests are already running; no-op success."
  exit 0
fi
if [[ "$api_state" != "previous|healthy" || "$web_state" != "previous|healthy" ]]; then
  echo "Read-only reconciliation found mixed, unexpected or unhealthy state; no retry or rollback was attempted." >&2
  exit 1
fi

# Pull both immutable app refs before updating either service.
compose pull api caddy
for ref in "$target_api" "$target_web"; do
  image_digests=$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$ref")
  grep -Fqx "$ref" <<<"$image_digests"
done

set +e
compose up -d --no-build --no-deps api caddy
up_status=$?
set -e
for attempt in $(seq 1 30); do
  db_container_after=$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=db")
  if [[ "$db_container_after" != "$db_container_before" || "$(db_health)" != "running|healthy" ]]; then
    echo "Database identity or health changed during app update; stop for operator review." >&2
    exit 1
  fi
  api_state=$(service_ref_and_health api "$target_api" "$previous_api")
  web_state=$(service_ref_and_health caddy "$target_web" "$previous_web")
  if [[ "$api_state" == "target|healthy" && "$web_state" == "target|healthy" ]]; then
    echo "Read-only reconciliation: exact web/API digests are running."
    exit 0
  fi
  sleep 4
done

if [[ $up_status -ne 0 ]]; then
  echo "Compose update failed and reconciliation is incomplete; stop for operator review. No automatic retry or rollback." >&2
else
  echo "Compose update did not converge; stop for operator review. No automatic retry or rollback." >&2
fi
exit 1
