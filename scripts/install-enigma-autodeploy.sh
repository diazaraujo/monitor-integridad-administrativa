#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$(uname -s)" != "Linux" ]] || ! command -v systemctl >/dev/null; then
  echo 'Run this installer on Enigma (Linux with systemd).' >&2
  exit 2
fi

readonly project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
readonly lib_directory="$HOME/.local/lib/monitor-integridad-autodeploy"
readonly unit_directory="$HOME/.config/systemd/user"
readonly config_directory="$HOME/.config/monitor-integridad-administrativa"
readonly deploy_environment="$config_directory/deploy.env"
readonly container_environment="$config_directory/container.env"

install -d -m 700 "$lib_directory" "$config_directory"
install -d -m 755 "$unit_directory"
install -m 700 "$project_root/scripts/deploy-enigma-monitor.sh" \
  "$lib_directory/deploy-enigma-monitor.sh"
install -m 644 "$project_root/ops/enigma/monitor-integridad-autodeploy.service" "$unit_directory/"
install -m 644 "$project_root/ops/enigma/monitor-integridad-autodeploy.timer" "$unit_directory/"

if [[ ! -f "$deploy_environment" ]]; then
  umask 077
  printf '%s\n' \
    'CONTAINER_NAME=monitor-integridad-main' \
    'HOST_PORT=8144' \
    'DOCKER_NETWORK=intel-inmobiliario_default' \
    'GITHUB_REPOSITORY=diazaraujo/monitor-integridad-administrativa' \
    >"$deploy_environment"
fi

if [[ ! -f "$container_environment" ]]; then
  echo "Missing $container_environment" >&2
  echo 'Bootstrap it once from the current specialized container as documented in ops/enigma/README.md.' >&2
  exit 2
fi
chmod 600 "$deploy_environment" "$container_environment"

systemctl --user daemon-reload
systemctl --user enable --now monitor-integridad-autodeploy.timer
systemctl --user start monitor-integridad-autodeploy.service
systemctl --user --no-pager status monitor-integridad-autodeploy.timer

