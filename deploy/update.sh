#!/usr/bin/env bash
#
# Pull, rebuild, restart.
#
#   sudo /opt/starkvisionz/deploy/update.sh
#
# Backs up first, because a schema migration runs on the next start and a backup
# taken after that is a backup of the new shape. Leaves the environment file,
# the certificate and the database alone.

set -euo pipefail

APP_USER=starkvisionz
DATA_DIR=/var/lib/starkvisionz
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '\n\033[1m==>\033[0m %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Run this with sudo." >&2; exit 1; }

say "Backup"
systemctl start starkvisionz-backup || echo "    (no backup timer installed — carrying on)"

say "Pull"
before="$(sudo -u "$APP_USER" git -C "$APP_DIR" rev-parse --short HEAD)"
sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only
after="$(sudo -u "$APP_USER" git -C "$APP_DIR" rev-parse --short HEAD)"

if [ "$before" = "$after" ]; then
  echo "    already at $after — rebuilding anyway"
else
  echo "    $before -> $after"
fi

say "Build"
sudo -u "$APP_USER" env -C "$APP_DIR" npm ci --no-audit --no-fund
sudo -u "$APP_USER" env -C "$APP_DIR" NODE_ENV=production npm run build

say "Restart"
systemctl restart starkvisionz
sleep 3

if systemctl is-active --quiet starkvisionz; then
  printf '\n  Running %s\n\n' "$after"
else
  journalctl -u starkvisionz -n 30 --no-pager || true
  printf '\n  Did not come back up. Roll back with:\n' >&2
  printf '    sudo -u %s git -C %s reset --hard %s && sudo %s/deploy/update.sh\n\n' \
    "$APP_USER" "$APP_DIR" "$before" "$APP_DIR" >&2
  exit 1
fi
