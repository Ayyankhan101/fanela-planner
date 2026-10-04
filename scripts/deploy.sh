#!/usr/bin/env bash
# Rebuild + restart after pulling updates. Usage: ./scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> pulling"
git pull --ff-only

echo "==> installing deps"
npm ci --no-audit --no-fund

echo "==> building"
npm run build

echo "==> restarting app service"
launchctl kickstart -k "gui/$(id -u)/com.fanela.app"

echo "==> done — tail logs/app.err.log to watch boot"
