#!/usr/bin/env bash
# Disposable Compose integration only; cleanup is strictly scoped to this unique QA project.
set -Eeuo pipefail
command -v docker >/dev/null
docker compose version
scratch=$(mktemp -d)
project="cqrtv-v2-qa-${GITHUB_RUN_ID:-local}-${BASHPID}"
label_project="cqrtv-v2-label-${GITHUB_RUN_ID:-local}-${BASHPID}"
[[ "$project" =~ ^cqrtv-v2-qa-[A-Za-z0-9-]+$ ]]
STAGING_HTTP_PORT=$(shuf -i 20000-45000 -n 1)
STAGING_DB_PASSWORD=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
export STAGING_HTTP_PORT STAGING_DB_PASSWORD
cleanup() {
  docker compose --project-name "$label_project" --project-directory "$scratch/labels" -f "$scratch/labels/docker-compose.yml" down --volumes --remove-orphans >/dev/null 2>&1 || true
  docker compose --project-name "$project" -f "$scratch/compose.yml" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf -- "$scratch"
}
trap cleanup EXIT

cat > "$scratch/Dockerfile.api" <<'DOCKER'
FROM alpine:3.21
CMD ["sh", "-ec", "while true; do sleep 1; done"]
DOCKER
api_image="cqrtv-v2-qa-api:${GITHUB_SHA:-local}"
docker build --file "$scratch/Dockerfile.api" --tag "$api_image" "$scratch"

cat > "$scratch/Dockerfile.web-rollback" <<'DOCKER'
FROM nginx:1.27-alpine
RUN printf 'rollback-image\n' > /usr/share/nginx/html/index.html
DOCKER
cat > "$scratch/Dockerfile.web-candidate" <<'DOCKER'
FROM nginx:1.27-alpine
RUN printf 'candidate-image\n' > /usr/share/nginx/html/index.html
DOCKER
web_rollback_image="cqrtv-v2-qa-web:rollback-${GITHUB_SHA:-local}"
web_candidate_image="cqrtv-v2-qa-web:candidate-${GITHUB_SHA:-local}"
docker build --file "$scratch/Dockerfile.web-rollback" --tag "$web_rollback_image" "$scratch"
docker build --file "$scratch/Dockerfile.web-candidate" --tag "$web_candidate_image" "$scratch"

cat > "$scratch/compose.yml" <<'YAML'
services:
  db:
    image: postgres:17-alpine
    networks: [qa]
    environment:
      POSTGRES_DB: staging
      POSTGRES_USER: staging
      POSTGRES_PASSWORD: ${STAGING_DB_PASSWORD:?ephemeral staging password required}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U staging -d staging"]
      interval: 2s
      timeout: 2s
      retries: 30
  api:
    image: API_IMAGE_PLACEHOLDER
    networks: [qa]
    depends_on:
      db:
        condition: service_healthy
  caddy:
    image: QA_WEB_ROLLBACK_PLACEHOLDER
    ports:
      - "127.0.0.1:${STAGING_HTTP_PORT}:80"
    networks: [qa]
volumes:
  pgdata:
networks:
  qa:
YAML
sed -i "s|API_IMAGE_PLACEHOLDER|$api_image|" "$scratch/compose.yml"
sed -i "s|QA_WEB_ROLLBACK_PLACEHOLDER|$web_rollback_image|" "$scratch/compose.yml"
compose=(docker compose --project-name "$project" --file "$scratch/compose.yml")
"${compose[@]}" up -d --wait --wait-timeout 90

db_id=$("${compose[@]}" ps -q db)
api_id=$("${compose[@]}" ps -q api)
web_id=$("${compose[@]}" ps -q caddy)
test -n "$db_id" && test -n "$api_id" && test -n "$web_id"
test -n "$(curl --silent --show-error --fail "http://127.0.0.1:$STAGING_HTTP_PORT/")"
inventory_output=$(bash qa/deployment-v2-inventory.sh "$project")
tab=$(printf '\t')
grep -Fq "project${tab}$project" <<<"$inventory_output"
grep -Fq "container${tab}$db_id${tab}" <<<"$inventory_output"
grep -Fq "mount${tab}$db_id${tab}db${tab}volume:" <<<"$inventory_output"
if grep -Fq "$STAGING_DB_PASSWORD" <<<"$inventory_output"; then
  echo "Read-only inventory leaked the disposable staging credential." >&2
  exit 1
fi
volume_before=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$db_id")
test -n "$volume_before"
docker exec "$db_id" psql -U staging -d staging -v ON_ERROR_STOP=1 -c 'CREATE TABLE release_probe (id integer primary key, marker text); INSERT INTO release_probe VALUES (1, '\''preserve-me'\'');' >/dev/null
docker exec "$db_id" pg_dump -U staging -d staging -Fc -f /tmp/cqrtv-qa-backup.dump
docker exec "$db_id" createdb -U staging restored_staging
docker exec "$db_id" pg_restore --no-owner -U staging -d restored_staging /tmp/cqrtv-qa-backup.dump
test "$(docker exec "$db_id" psql -U staging -d restored_staging -Atc 'SELECT marker FROM release_probe WHERE id=1')" = "preserve-me"

# An unavailable registry must leave running containers and PostgreSQL data unchanged.
cp "$scratch/compose.yml" "$scratch/compose.known-good.yml"
sed -i "s|image: $web_rollback_image|image: 127.0.0.1:1/cqrtv/unavailable:qa|" "$scratch/compose.yml"
if "${compose[@]}" pull caddy >/dev/null 2>&1; then
  echo "The intentionally unavailable local registry unexpectedly returned an image." >&2
  exit 1
fi
test "$("${compose[@]}" ps -q db)" = "$db_id"
test "$("${compose[@]}" ps -q api)" = "$api_id"
test "$("${compose[@]}" ps -q caddy)" = "$web_id"
test "$(docker exec "$db_id" psql -U staging -d staging -Atc 'SELECT marker FROM release_probe WHERE id=1')" = "preserve-me"
cp "$scratch/compose.known-good.yml" "$scratch/compose.yml"

# A failed image build must not change the running stack or its database.
cat > "$scratch/Dockerfile.failed" <<'DOCKER'
FROM alpine:3.21
THIS_IS_NOT_A_VALID_DOCKERFILE_INSTRUCTION
DOCKER
if docker build --file "$scratch/Dockerfile.failed" --tag "cqrtv-v2-qa-invalid:${GITHUB_SHA:-local}" "$scratch" >/dev/null 2>&1; then
  echo "The intentionally invalid Dockerfile unexpectedly built." >&2
  exit 1
fi
test "$("${compose[@]}" ps -q db)" = "$db_id"
test "$("${compose[@]}" ps -q api)" = "$api_id"
test "$("${compose[@]}" ps -q caddy)" = "$web_id"
test "$(docker exec "$db_id" psql -U staging -d staging -Atc 'SELECT marker FROM release_probe WHERE id=1')" = "preserve-me"

# Apply candidate web and return to the exact previous disposable image.
sed -i "s|image: $web_rollback_image|image: $web_candidate_image|" "$scratch/compose.yml"
"${compose[@]}" up -d --no-deps --wait --wait-timeout 60 caddy
candidate_web_id=$("${compose[@]}" ps -q caddy)
test -n "$candidate_web_id" && test "$candidate_web_id" != "$web_id"
test "$("${compose[@]}" ps -q db)" = "$db_id"
test "$("${compose[@]}" ps -q api)" = "$api_id"
curl --silent --show-error --fail "http://127.0.0.1:$STAGING_HTTP_PORT/" | grep -q "candidate-image"

sed -i "s|image: $web_candidate_image|image: $web_rollback_image|" "$scratch/compose.yml"
"${compose[@]}" up -d --no-deps --wait --wait-timeout 60 caddy
rollback_web_id=$("${compose[@]}" ps -q caddy)
test -n "$rollback_web_id" && test "$rollback_web_id" != "$candidate_web_id"
test "$("${compose[@]}" ps -q db)" = "$db_id"
test "$("${compose[@]}" ps -q api)" = "$api_id"
curl --silent --show-error --fail "http://127.0.0.1:$STAGING_HTTP_PORT/" | grep -q "rollback-image"
test "$(docker exec "$db_id" psql -U staging -d staging -Atc 'SELECT marker FROM release_probe WHERE id=1')" = "preserve-me"
web_id=$rollback_web_id

api_image_id_before=$(docker inspect --format '{{.Image}}' "$api_id")
web_image_id_before=$(docker inspect --format '{{.Image}}' "$web_id")
"${compose[@]}" up -d --wait --wait-timeout 90
test "$("${compose[@]}" ps -q db)" = "$db_id"
test "$("${compose[@]}" ps -q api)" = "$api_id"
test "$("${compose[@]}" ps -q caddy)" = "$web_id"
test "$(docker inspect --format '{{.Image}}' "$api_id")" = "$api_image_id_before"
test "$(docker inspect --format '{{.Image}}' "$web_id")" = "$web_image_id_before"
test "$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$db_id")" = "$volume_before"
test "$(docker exec "$db_id" psql -U staging -d staging -Atc 'SELECT marker FROM release_probe WHERE id=1')" = "preserve-me"

# Exercise real Compose config_files labels across a base + stable override update.
label_dir="$scratch/labels"
mkdir -p "$label_dir"
label_api_base="$api_image"
label_api_target="cqrtv-v2-qa-api-target:${GITHUB_SHA:-local}"
label_web_base="$web_rollback_image"
label_web_target="cqrtv-v2-qa-web-target:${GITHUB_SHA:-local}"
docker tag "$label_api_base" "$label_api_target"
docker tag "$label_web_base" "$label_web_target"
cat > "$label_dir/docker-compose.yml" <<YAML
services:
  api:
    image: $label_api_base
    command: ["sh", "-ec", "while true; do sleep 1; done"]
    volumes: [api_data:/data]
  caddy:
    image: $label_web_base
    volumes: [caddy_data:/data, caddy_config:/config]
  db:
    image: $label_api_base
    command: ["sh", "-ec", "while true; do sleep 1; done"]
    volumes: [postgres_data:/var/lib/postgresql/data, db_secret:/run/db-secret]
  secret-init:
    image: $label_api_base
    command: ["sh", "-ec", "touch /run/db-secret/initialized"]
    volumes: [db_secret:/run/db-secret]
volumes:
  api_data: {name: ${label_project}_api_data}
  caddy_data: {name: ${label_project}_caddy_data}
  caddy_config: {name: ${label_project}_caddy_config}
  postgres_data: {name: ${label_project}_postgres_data}
  db_secret: {name: ${label_project}_db_secret}
YAML
cat > "$label_dir/release.override.yml" <<YAML
services:
  api:
    image: $label_api_target
    pull_policy: never
  caddy:
    image: $label_web_target
    pull_policy: never
YAML
label_compose=(docker compose --project-name "$label_project" --project-directory "$label_dir" --file "$label_dir/docker-compose.yml")
"${label_compose[@]}" up -d api caddy db secret-init
label_api_id_before=$("${label_compose[@]}" ps -q api)
label_caddy_id_before=$("${label_compose[@]}" ps -q caddy)
label_db_id=$("${label_compose[@]}" ps -q db)
label_secret_id=$("${label_compose[@]}" ps -q secret-init)
test -n "$label_api_id_before" && test -n "$label_caddy_id_before" && test -n "$label_db_id" && test -n "$label_secret_id"
label_base_api=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$label_api_id_before")
label_base_db=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$label_db_id")
echo "Observed Compose config_files before: api=$label_base_api db=$label_base_db ids=$label_api_id_before/$label_db_id"
test "$label_base_api" = "$label_dir/docker-compose.yml"
test "$label_base_db" = "$label_dir/docker-compose.yml"

"${label_compose[@]}" --file "$label_dir/release.override.yml" up -d --no-deps api caddy
label_api_id_after=$("${label_compose[@]}" ps -q api)
label_caddy_id_after=$("${label_compose[@]}" ps -q caddy)
label_after_api=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$label_api_id_after")
label_after_caddy=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$label_caddy_id_after")
expected_label_files="$label_dir/docker-compose.yml,$label_dir/release.override.yml"
echo "Observed Compose config_files before: api=$label_base_api db=$label_base_db"
echo "Observed Compose config_files after two-file up: api=$label_after_api caddy=$label_after_caddy"
test "$label_after_api" = "$expected_label_files"
test "$label_after_caddy" = "$expected_label_files"
test "$("${label_compose[@]}" ps -q db)" = "$label_db_id"
test "$("${label_compose[@]}" ps -q secret-init)" = "$label_secret_id"
label_db_mounts=$(docker inspect --format '{{range .Mounts}}{{.Name}}:{{.Destination}};{{end}}' "$label_db_id")
[[ "$label_db_mounts" == *"$label_project_db_secret:/run/db-secret;"* ]]
[[ "$label_db_mounts" == *"$label_project_postgres_data:/var/lib/postgresql/data;"* ]]
label_api_target_id=$label_api_id_after
label_caddy_target_id=$label_caddy_id_after

# A routine subsequent run keeps the stable config_files label and protected services untouched.
"${label_compose[@]}" --file "$label_dir/release.override.yml" up -d --no-deps api caddy
test "$("${label_compose[@]}" ps -q api)" = "$label_api_target_id"
test "$("${label_compose[@]}" ps -q caddy)" = "$label_caddy_target_id"
test "$("${label_compose[@]}" ps -q db)" = "$label_db_id"
test "$("${label_compose[@]}" ps -q secret-init)" = "$label_secret_id"
test "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$label_api_target_id")" = "$expected_label_files"

echo "PASS disposable loopback staging; existing data/volumes preserved; Compose labels observed across base+stable override and repeat; DB/secret-init identities untouched."
