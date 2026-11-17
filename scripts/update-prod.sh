#!/usr/bin/env bash
# Explicitly authorized releases only. See docs/ops-script-safety.md.
# Usage: bash scripts/update-prod.sh --revision <full-commit> --services web|api|api,web
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
ROOT=$(pwd -P)
PROJECT=kayford-deploy
REVISION=''
SCOPE=''
fail() { echo "$*" >&2; exit 1; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --revision) [[ $# -ge 2 ]] || fail 'Missing revision.'; REVISION=$2; shift 2 ;;
    --services) [[ $# -ge 2 ]] || fail 'Missing service scope.'; SCOPE=$2; shift 2 ;;
    *) fail 'Usage: bash scripts/update-prod.sh --revision <full-commit> --services web|api|api,web' ;;
  esac
done
[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || fail 'An exact full commit SHA is required.'
case "$SCOPE" in
  web) SERVICES=(web) ;;
  api) SERVICES=(api) ;;
  api,web|web,api) SERVICES=(api web) ;;
  *) fail 'Explicit affected services required: web, api, or api,web.' ;;
esac

assert_clean_source() {
  local status head
  status=$(git status --porcelain=v1 --untracked-files=all --ignore-submodules=none)
  [[ -z "$status" ]] || fail 'Tracked or untracked changes exist. Use a clean verified checkout.'
  head=$(git rev-parse --verify HEAD)
  [[ "$head" == "$REVISION" ]] || fail 'HEAD does not match the requested revision.'
}
assert_clean_source
COMMIT=$(git rev-parse --verify "${REVISION}^{commit}")
[[ "$COMMIT" == "$REVISION" ]] || fail 'Revision is not the exact requested commit.'
REMOTE=$(git ls-remote --exit-code origin refs/heads/main) || fail 'Cannot verify live origin/main.'
[[ "$REMOTE" == "$REVISION"$'\trefs/heads/main' ]] || fail 'Requested revision does not match live origin/main.'
[[ -f "$ROOT/.env" ]] || fail 'Missing private runtime .env; no configuration was changed.'

# Only committed content enters Docker COPY, including when Git ignores local files.
# Retain this directory: Compose records its config paths for later inspection.
RELEASE_ROOT=${HRM_RELEASE_ROOT:-$HOME/kayford-releases}
mkdir -p "$RELEASE_ROOT"
RELEASE_ROOT=$(cd "$RELEASE_ROOT" && pwd -P)
case "$RELEASE_ROOT/" in "$ROOT/"*) fail 'Release storage must be outside the source checkout.' ;; esac
SOURCE=$(mktemp -d "$RELEASE_ROOT/${REVISION:0:12}.XXXXXX")
git archive --format=tar --output "$SOURCE/source.tar" "$REVISION"
tar -xf "$SOURCE/source.tar" -C "$SOURCE"
rm "$SOURCE/source.tar"
assert_clean_source

# Docker Desktop consumes native absolute paths inside YAML, not Git Bash /c paths.
yaml_path() {
  local value=$1
  if command -v cygpath >/dev/null 2>&1; then value=$(cygpath -m "$value"); fi
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || fail 'Unsupported newline in release path.'
  printf '%s' "${value//\'/\'\'}"
}
OVERRIDE="$SOURCE/release.override.yml"
printf 'services:\n' > "$OVERRIDE"
for service in "${SERVICES[@]}"; do
  cat >> "$OVERRIDE" <<EOF
  $service:
    image: $PROJECT-$service:$REVISION
    build:
      context: '$(yaml_path "$SOURCE/$service")'
      labels:
        org.opencontainers.image.revision: '$REVISION'
    labels:
      org.opencontainers.image.revision: '$REVISION'
EOF
done
if [[ " ${SERVICES[*]} " == *' api '* ]]; then
  cat >> "$OVERRIDE" <<EOF
  backup:
    volumes:
      - type: bind
        source: '$(yaml_path "$SOURCE/deploy/scripts/backup.sh")'
        target: /backup.sh
        read_only: true
EOF
fi
COMPOSE=(docker compose -p "$PROJECT" --project-directory "$ROOT" --env-file "$ROOT/.env"
  -f "$SOURCE/docker-compose.yml" -f "$SOURCE/docker-compose.prod.yml" -f "$OVERRIDE")
"${COMPOSE[@]}" config --quiet

# Record and pin the currently running images before any build or replacement.
RELEASE_ID="$(date +%Y%m%d_%H%M%S)-${SOURCE##*.}"
for service in "${SERVICES[@]}"; do
  container=$("${COMPOSE[@]}" ps -q "$service")
  [[ -n "$container" && "$container" != *$'\n'* ]] || fail "Expected one running $service container."
  owner=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$container")
  [[ "$owner" == "$PROJECT" ]] || fail 'Running container belongs to a different project.'
  actual_service=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.service" }}' "$container")
  [[ "$actual_service" == "$service" ]] || fail 'Running container service does not match.'
  old_image=$(docker inspect --format '{{.Image}}' "$container")
  [[ "$old_image" == sha256:* ]] || fail 'Cannot identify rollback image.'
  rollback="$PROJECT-$service:rollback-$RELEASE_ID"
  docker tag "$old_image" "$rollback"
  printf '%s %s %s\n' "$service" "$old_image" "$rollback" >> "$SOURCE/rollback-images.txt"
  echo "Rollback retained: $rollback"
done

"${COMPOSE[@]}" build "${SERVICES[@]}"
assert_clean_source
if [[ " ${SERVICES[*]} " == *' api '* ]]; then
  # API's existing entrypoint runs migrations. It must never start before backup.
  "${COMPOSE[@]}" --profile backup run --rm --no-deps backup
fi
"${COMPOSE[@]}" up -d --no-deps --no-build "${SERVICES[@]}"

for service in "${SERVICES[@]}"; do
  container=$("${COMPOSE[@]}" ps -q "$service")
  actual_revision=$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$container")
  [[ "$actual_revision" == "$REVISION" ]] || fail "Revision mismatch after replacing $service."
done
if [[ "$SCOPE" == api ]]; then
  # The existing Nginx resolves a static api upstream at load time. Wait for the
  # replacement API directly, then re-resolve it without replacing the Web image.
  api_container=$container
  readiness='const http=require("node:http"); const req=http.get("http://127.0.0.1:3000/api/v1/health",res=>{let body="";res.on("data",c=>body+=c);res.on("end",()=>{try{const v=JSON.parse(body);process.exit(res.statusCode===200&&v.code===0&&v.data?.status==="ok"&&v.data?.db==="ok"?0:1)}catch{process.exit(1)}})});req.setTimeout(3000,()=>req.destroy());req.on("error",()=>process.exit(1));'
  ready=false
  for ((attempt=1; attempt<=30; attempt++)); do
    if docker exec "$api_container" node -e "$readiness" >/dev/null 2>&1; then
      ready=true
      break
    fi
    sleep 2
  done
  [[ "$ready" == true ]] || fail 'Replacement API is not ready; Web reload was not attempted.'
  web_container=$("${COMPOSE[@]}" ps -q web)
  [[ -n "$web_container" && "$web_container" != *$'\n'* ]] || fail 'Expected one existing Web container for reload.'
  web_owner=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$web_container")
  web_service=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.service" }}' "$web_container")
  [[ "$web_owner" == "$PROJECT" && "$web_service" == web ]] || fail 'Existing Web project/service mismatch; refusing reload.'
  docker exec "$web_container" nginx -t
  docker exec "$web_container" nginx -s reload
fi
sleep 15
if ! curl --fail --silent --show-error --max-time 8 http://localhost/api/v1/health \
  | grep -q '"status":"ok"'; then
  fail "Health check failed. Inspect $SOURCE/rollback-images.txt; do not restore the database automatically."
fi
echo "Services replaced: $SCOPE at $REVISION. Release evidence: $SOURCE"
echo 'Local health only. External health, affected paths and real-role acceptance remain required.'
