#!/usr/bin/env bash
# Read-only Docker Compose inventory. Deliberately never inspects or prints container env.
set -Eeuo pipefail

project=${1:?Usage: deployment-v2-inventory.sh COMPOSE_PROJECT}
[[ "$project" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$ ]] || {
  echo "Invalid Compose project name." >&2
  exit 2
}
command -v docker >/dev/null || { echo "docker CLI is required." >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 is required." >&2; exit 2; }

mapfile -t ids < <(docker ps -aq --filter "label=com.docker.compose.project=$project" | sort)
if [[ ${#ids[@]} -eq 0 ]]; then
  echo "No containers found for Compose project $project." >&2
  exit 1
fi

printf 'project\t%s\tcontainers=%s\n' "$project" "${#ids[@]}"
for id in "${ids[@]}"; do
  metadata=$(docker inspect --format '{{.Id}}|{{.Name}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.Config.Image}}|{{.Image}}|{{.State.Status}}' "$id")
  IFS='|' read -r full_id name found_project service configured_image image_id state <<<"$metadata"
  health=$(docker inspect --format '{{json .State}}' "$id" | python3 -c 'import json,sys; s=json.load(sys.stdin); print((s.get("Health") or {}).get("Status") or "none")')
  [[ "$found_project" == "$project" ]] || { echo "Compose project label mismatch." >&2; exit 1; }
  repo_digests=$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image_id" 2>/dev/null | paste -sd ',' - || true)
  printf 'container\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$full_id" "${name#/}" "$service" "$configured_image" "$repo_digests" "$state" "$health" "$found_project"
  while IFS='|' read -r type volume destination; do
    [[ -n "$type$volume$destination" ]] || continue
    printf 'mount\t%s\t%s\t%s\t%s\n' "$full_id" "$service" "$type:${volume:-<bind>}" "$destination"
  done < <(docker inspect --format '{{range .Mounts}}{{printf "%s|%s|%s\n" .Type .Name .Destination}}{{end}}' "$id")
done
