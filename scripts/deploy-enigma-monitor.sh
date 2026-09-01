#!/usr/bin/env bash
set -Eeuo pipefail

# Pull-based deployment for the specialized administrative-integrity monitor.
# This script intentionally refuses to manage any other container or host port.

readonly CONTAINER_NAME="${CONTAINER_NAME:-monitor-integridad-main}"
readonly ROLLBACK_NAME="${ROLLBACK_NAME:-monitor-integridad-rollback}"
readonly HOST_PORT="${HOST_PORT:-8144}"
readonly CONTAINER_PORT="8080"
readonly DOCKER_NETWORK="${DOCKER_NETWORK:-intel-inmobiliario_default}"
readonly GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-diazaraujo/monitor-integridad-administrativa}"
readonly REPOSITORY_URL="${REPOSITORY_URL:-https://github.com/${GITHUB_REPOSITORY}.git}"
readonly DEPLOY_ROOT="${DEPLOY_ROOT:-${HOME}/.local/state/monitor-integridad-autodeploy}"
readonly CONTAINER_ENV_FILE="${CONTAINER_ENV_FILE:-${HOME}/.config/monitor-integridad-administrativa/container.env}"
readonly IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-monitor-integridad-administrativa}"
readonly HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-60}"
readonly HEALTH_INTERVAL_SECONDS="${HEALTH_INTERVAL_SECONDS:-5}"
readonly GITHUB_API_URL="${GITHUB_API_URL:-https://api.github.com}"

if [[ "$CONTAINER_NAME" != "monitor-integridad-main" || "$HOST_PORT" != "8144" ]]; then
  echo "Refusing deployment outside monitor-integridad-main:8144" >&2
  exit 2
fi

for command_name in curl docker flock git python3 tar; do
  command -v "$command_name" >/dev/null || {
    echo "Missing required command: $command_name" >&2
    exit 2
  }
done

if [[ ! -f "$CONTAINER_ENV_FILE" ]]; then
  echo "Missing container environment file: $CONTAINER_ENV_FILE" >&2
  exit 2
fi

env_mode=$(stat -c '%a' "$CONTAINER_ENV_FILE")
if (( 10#$env_mode % 100 != 0 )); then
  echo "Container environment file must not be accessible by group/others (mode: $env_mode)" >&2
  exit 2
fi

mkdir -p "$DEPLOY_ROOT"
exec 9>"$DEPLOY_ROOT/deploy.lock"
if ! flock -n 9; then
  echo "Another Enigma deployment is already running"
  exit 0
fi

readonly BARE_REPOSITORY="$DEPLOY_ROOT/repository.git"
readonly DEPLOYED_SHA_FILE="$DEPLOY_ROOT/deployed-sha"
build_directory=''
canary_name=''

cleanup() {
  if [[ -n "$canary_name" ]]; then
    docker rm -f "$canary_name" >/dev/null 2>&1 || true
  fi
  if [[ -n "$build_directory" && -d "$build_directory" ]]; then
    rm -rf -- "$build_directory"
  fi
}
trap cleanup EXIT

if [[ ! -d "$BARE_REPOSITORY" ]]; then
  git clone --bare --filter=blob:none "$REPOSITORY_URL" "$BARE_REPOSITORY"
fi
git --git-dir="$BARE_REPOSITORY" fetch --quiet --prune origin \
  '+refs/heads/main:refs/remotes/origin/main'
candidate_sha=$(git --git-dir="$BARE_REPOSITORY" rev-parse refs/remotes/origin/main)

if [[ -f "$DEPLOYED_SHA_FILE" && "$(<"$DEPLOYED_SHA_FILE")" == "$candidate_sha" ]]; then
  echo "Enigma already runs $candidate_sha"
  exit 0
fi

gate_state=$(
  curl --fail --silent --show-error \
    --header 'Accept: application/vnd.github+json' \
    "$GITHUB_API_URL/repos/$GITHUB_REPOSITORY/commits/$candidate_sha/status" |
    python3 -c 'import json,sys
data=json.load(sys.stdin)
states=[item.get("state") for item in data.get("statuses", []) if item.get("context")=="gate"]
print(states[0] if states else "missing")'
)
if [[ "$gate_state" != "success" ]]; then
  echo "Not deploying $candidate_sha: gate=$gate_state"
  exit 0
fi

docker network inspect "$DOCKER_NETWORK" >/dev/null
build_directory=$(mktemp -d "$DEPLOY_ROOT/build.XXXXXXXX")
git --git-dir="$BARE_REPOSITORY" archive "$candidate_sha" | tar -x -C "$build_directory"

image_tag="$IMAGE_REPOSITORY:$candidate_sha"
docker build \
  --label "org.opencontainers.image.revision=$candidate_sha" \
  --label 'cl.monitor.role=administrative-integrity' \
  --tag "$image_tag" \
  "$build_directory"

wait_for_container_health() {
  local target_container="$1"
  local attempt status
  for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt += 1)); do
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
      "$target_container" 2>/dev/null || true)
    if [[ "$status" == "healthy" ]]; then
      return 0
    fi
    if [[ "$status" == "unhealthy" || "$status" == "exited" || "$status" == "dead" ]]; then
      docker logs --tail 100 "$target_container" >&2 || true
      return 1
    fi
    sleep "$HEALTH_INTERVAL_SECONDS"
  done
  docker logs --tail 100 "$target_container" >&2 || true
  return 1
}

canary_name="monitor-integridad-canary-${candidate_sha:0:12}"
docker rm -f "$canary_name" >/dev/null 2>&1 || true
docker run --detach \
  --name "$canary_name" \
  --network "$DOCKER_NETWORK" \
  --env-file "$CONTAINER_ENV_FILE" \
  --label "cl.monitor.deployed-sha=$candidate_sha" \
  --publish '127.0.0.1::8080' \
  "$image_tag" >/dev/null
wait_for_container_health "$canary_name"
canary_port=$(docker port "$canary_name" '8080/tcp' | awk -F: 'NR==1 {print $NF}')
curl --fail --silent --show-error "http://127.0.0.1:$canary_port/api/sidecar-health" >/dev/null
docker rm -f "$canary_name" >/dev/null
canary_name=''

restore_previous_container() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  if docker container inspect "$ROLLBACK_NAME" >/dev/null 2>&1; then
    docker rename "$ROLLBACK_NAME" "$CONTAINER_NAME"
    docker start "$CONTAINER_NAME" >/dev/null
  fi
}

if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  docker rm -f "$ROLLBACK_NAME" >/dev/null 2>&1 || true
  if ! docker stop --time 30 "$CONTAINER_NAME" >/dev/null; then
    echo "Could not stop $CONTAINER_NAME; leaving it in place" >&2
    exit 1
  fi
  if ! docker rename "$CONTAINER_NAME" "$ROLLBACK_NAME"; then
    docker start "$CONTAINER_NAME" >/dev/null || true
    echo "Could not stage rollback container; restored $CONTAINER_NAME" >&2
    exit 1
  fi
fi

if ! docker run --detach \
  --name "$CONTAINER_NAME" \
  --network "$DOCKER_NETWORK" \
  --env-file "$CONTAINER_ENV_FILE" \
  --restart unless-stopped \
  --label "cl.monitor.deployed-sha=$candidate_sha" \
  --publish "$HOST_PORT:$CONTAINER_PORT" \
  "$image_tag" >/dev/null; then
  restore_previous_container
  exit 1
fi

if ! wait_for_container_health "$CONTAINER_NAME" \
  || ! curl --fail --silent --show-error "http://127.0.0.1:$HOST_PORT/api/sidecar-health" >/dev/null; then
  restore_previous_container
  exit 1
fi

printf '%s\n' "$candidate_sha" >"$DEPLOYED_SHA_FILE"
echo "Deployed $candidate_sha to $CONTAINER_NAME on Enigma port $HOST_PORT"
