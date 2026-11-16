#!/usr/bin/env bash
# Isolated disposable Compose integration. Cleanup is scoped to a unique QA project only.
set -Eeuo pipefail
command -v docker >/dev/null
docker compose version
scratch=$(mktemp -d)
project="cqrtv-v2-qa-${GITHUB_RUN_ID:-local}-$$"
[[ "$project" =~ ^cqrtv-v2-qa-[A-Za-z0-9-]+$ ]]
cleanup() {
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

cat > "$scratch/compose.yml" <<'YAML'
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: staging
      POSTGRES_USER: staging
      POSTGRES_PASSWORD: staging-only
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U staging -d staging"]
      interval: 2s
      timeout: 2s
      retries: 30
  api:
    image: API_IMAGE_PLACEHOLDER
    depends_on:
      db:
        condition: service_healthy
  caddy:
    image: nginx:1.27-alpine
volumes:
  pgdata:
YAML
sed -i "s|API_IMAGE_PLACEHOLDER|$api_image|" "$scratch/compose.yml"
compose=(docker compose --project-name "$project" --file "$scratch/compose.yml")
"${compose[@]}" up -d --wait --wait-timeout 90

db_id=$("${compose[@]}" ps -q db)
api_id=$("${compose[@]}" ps -q api)
web_id=$("${compose[@]}" ps -q caddy)
test -n "$db_id" && test -n "$api_id" && test -n "$web_id"
volume_before=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "$db_id")
test -n "$volume_before"
docker exec "$db_id" psql -U staging -d staging -v ON_ERROR_STOP=1 -c 'CREATE TABLE release_probe (id integer primary key, marker text); INSERT INTO release_probe VALUES (1, '\''preserve-me'\'');' >/dev/null
docker exec "$db_id" pg_dump -U staging -d staging -Fc -f /tmp/cqrtv-qa-backup.dump
docker exec "$db_id" createdb -U staging restored_staging
docker exec "$db_id" pg_restore --no-owner -U staging -d restored_staging /tmp/cqrtv-qa-backup.dump
test "$(docker exec "$db_id" psql -U staging -d restored_staging -Atc 'SELECT marker FROM release_probe WHERE id=1')" = "preserve-me"
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
echo "PASS disposable Compose start, repeat idempotency, PostgreSQL volume preservation and isolated logical backup restore."
