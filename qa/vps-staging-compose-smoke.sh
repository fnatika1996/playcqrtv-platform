#!/usr/bin/env bash
set -Eeuo pipefail
set +x
readonly ROOT="/opt/cqrtv-v2-staging"
readonly PROJECT="cqrtv-v2-staging"
readonly COMPOSE_FILE="$ROOT/compose.smoke.yml"
readonly OVERRIDE_FILE="$ROOT/smoke.override.yml"
readonly ENV_FILE="$ROOT/staging.env"
readonly NETWORK="cqrtv-v2-staging-net"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
readonly IMAGE_ROOT="$REPO_ROOT/ops/cqrtv-v2-staging/images"
fail() { printf 'CQRTV staging smoke stopped: %s\n' "$1" >&2; exit 1; }
[[ "$#" -eq 0 ]] || fail "this fixed script accepts no arguments"
[[ "$(id -u)" -eq 0 ]] || fail "run as root"
[[ -d "$ROOT" && ! -L "$ROOT" ]] || fail "staging root missing or symlink"
[[ "$(stat -c '%u:%a' "$ROOT")" == "0:700" ]] || fail "root must be root:root 0700"
[[ -f "$COMPOSE_FILE" && ! -L "$COMPOSE_FILE" ]] || fail "fixed Compose missing"
[[ "$(stat -c '%u:%a' "$COMPOSE_FILE")" == "0:600" ]] || fail "fixed Compose must be root-owned mode 600"
[[ ! -e "$OVERRIDE_FILE" && ! -L "$OVERRIDE_FILE" ]] || fail "staging override already exists"
[[ "$(docker context show)" == "default" ]] || fail "Docker context is not local default"
docker context inspect default --format '{{.Endpoints.docker.Host}}' | grep -Fxq 'unix:///var/run/docker.sock' || fail "not the local socket"
if grep -Eq '/docker/playcqrtv|playcqrtv_(postgres_data|db_secret|caddy_data|caddy_config)|/var/run/docker\.sock' "$COMPOSE_FILE"; then fail "production path or socket reference found"; fi
if [[ -n "$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT")" ]]; then fail "staging project already has containers"; fi
for volume in cqrtv-v2-staging_postgres_data cqrtv-v2-staging_db_secret cqrtv-v2-staging_caddy_data cqrtv-v2-staging_caddy_config; do
  if docker volume inspect "$volume" >/dev/null 2>&1; then fail "staging volume already exists"; fi
done
if docker network inspect "$NETWORK" >/dev/null 2>&1; then fail "staging network already exists"; fi
if ss -Hlt '( sport = :18080 )' | grep -q .; then fail "port 18080 occupied"; fi


[[ ! -e "$ENV_FILE" && ! -L "$ENV_FILE" ]] || fail "staging.env already exists"
staging_password="$(openssl rand -hex 32)"
umask 077
printf 'STAGING_DB_PASSWORD=%s\n' "$staging_password" > "$ENV_FILE"
unset staging_password
chown root:root "$ENV_FILE"
chmod 0600 "$ENV_FILE"
docker build --quiet --build-arg STAGING_VARIANT=latest --tag cqrtv-v2-staging-api:latest --file "$IMAGE_ROOT/api/Dockerfile" "$IMAGE_ROOT/api" >/dev/null
docker build --quiet --build-arg STAGING_VARIANT=target --tag cqrtv-v2-staging-api:target --file "$IMAGE_ROOT/api/Dockerfile" "$IMAGE_ROOT/api" >/dev/null
docker build --quiet --build-arg STAGING_VARIANT=latest --tag cqrtv-v2-staging-web:latest --file "$IMAGE_ROOT/web/Dockerfile" "$IMAGE_ROOT/web" >/dev/null
docker build --quiet --build-arg STAGING_VARIANT=target --tag cqrtv-v2-staging-web:target --file "$IMAGE_ROOT/web/Dockerfile" "$IMAGE_ROOT/web" >/dev/null

compose=(docker compose --project-name "$PROJECT" --project-directory "$ROOT" --env-file "$ENV_FILE" --file "$COMPOSE_FILE")
"${compose[@]}" up -d
for attempt in $(seq 1 45); do
  api_id="$("${compose[@]}" ps -q api)"
  web_id="$("${compose[@]}" ps -q caddy)"
  db_id="$("${compose[@]}" ps -q db)"
  secret_id="$("${compose[@]}" ps -aq secret-init)"
  if [[ -n "$api_id" && -n "$web_id" && -n "$db_id" && -n "$secret_id" ]] && [[ "$(docker inspect --format '{{.State.Health.Status}}' "$db_id")" == "healthy" ]] && [[ "$(docker inspect --format '{{.State.Status}}' "$secret_id")" == "exited" ]] && [[ "$(docker inspect --format '{{.State.ExitCode}}' "$secret_id")" == "0" ]]; then
    break
  fi
  [[ "$attempt" -lt 45 ]] || fail "staging services not ready"
  sleep 2
done
curl --fail --silent --show-error http://127.0.0.1:18080/ | grep -Fq "CQRTV STAGING ONLY"
docker exec "$db_id" psql -U cqrtv_stage -d cqrtv_staging -v ON_ERROR_STOP=1 -c "CREATE TABLE release_probe (id integer primary key, marker text); INSERT INTO release_probe VALUES (1, 'staging-data-preserved');" >/dev/null


read_label() { docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' "$1"; }
api_label="$(read_label "$api_id")"
web_label="$(read_label "$web_id")"
db_label="$(read_label "$db_id")"
secret_label="$(read_label "$secret_id")"
[[ "$api_label" == "$COMPOSE_FILE" && "$web_label" == "$COMPOSE_FILE" && "$db_label" == "$COMPOSE_FILE" && "$secret_label" == "$COMPOSE_FILE" ]] || fail "base-only staging Compose labels differ"
[[ "$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$db_id")" == "$PROJECT" ]] || fail "unexpected database project label"
[[ "$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.service" }}' "$db_id")" == "db" ]] || fail "unexpected database service label"
db_before="$db_id"
secret_before="$secret_id"
db_marker_before="$(docker exec "$db_id" psql -U cqrtv_stage -d cqrtv_staging -Atc "SELECT marker FROM release_probe WHERE id=1")"
[[ "$db_marker_before" == "staging-data-preserved" ]] || fail "database probe missing"
umask 077
cat > "$OVERRIDE_FILE" <<'YAML'
services:
  api:
    image: cqrtv-v2-staging-api:target
    pull_policy: never
  caddy:
    image: cqrtv-v2-staging-web:target
    pull_policy: never
YAML
chown root:root "$OVERRIDE_FILE"
chmod 0600 "$OVERRIDE_FILE"
compose=(docker compose --project-name "$PROJECT" --project-directory "$ROOT" --env-file "$ENV_FILE" --file "$COMPOSE_FILE" --file "$OVERRIDE_FILE")
"${compose[@]}" up -d --no-deps api caddy
api_id="$("${compose[@]}" ps -q api)"
web_id="$("${compose[@]}" ps -q caddy)"
db_after="$("${compose[@]}" ps -q db)"
secret_after="$("${compose[@]}" ps -aq secret-init)"
expected_pair="$COMPOSE_FILE,$OVERRIDE_FILE"
[[ "$(read_label "$api_id")" == "$expected_pair" && "$(read_label "$web_id")" == "$expected_pair" ]] || fail "stable override labels do not match exact base/override paths"
[[ "$(read_label "$db_after")" == "$COMPOSE_FILE" && "$(read_label "$secret_after")" == "$COMPOSE_FILE" ]] || fail "non-app staging labels changed"
[[ "$db_before" == "$db_after" && "$secret_before" == "$secret_after" ]] || fail "DB or secret-init container was recreated"
db_marker_after="$(docker exec "$db_after" psql -U cqrtv_stage -d cqrtv_staging -Atc "SELECT marker FROM release_probe WHERE id=1")"
[[ "$db_marker_after" == "$db_marker_before" ]] || fail "database data changed during app-only update"
"${compose[@]}" up -d --no-deps api caddy
api_repeat="$("${compose[@]}" ps -q api)"
web_repeat="$("${compose[@]}" ps -q caddy)"
db_repeat="$("${compose[@]}" ps -q db)"
[[ "$(read_label "$api_repeat")" == "$expected_pair" && "$(read_label "$web_repeat")" == "$expected_pair" ]] || fail "repeat run changed stable override labels"
[[ "$db_repeat" == "$db_before" ]] || fail "repeat run changed DB container identity"
[[ "$(docker exec "$db_repeat" psql -U cqrtv_stage -d cqrtv_staging -Atc "SELECT marker FROM release_probe WHERE id=1")" == "$db_marker_before" ]] || fail "repeat run changed isolated DB data"
echo "PASS compose-only isolation smoke: project=$PROJECT port=127.0.0.1:18080 labels=base,stable-override db-container=unchanged marker=staging-data-preserved"
echo "No cleanup was performed; run only the guarded staging cleanup procedure after review."
