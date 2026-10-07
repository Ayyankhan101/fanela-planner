#!/usr/bin/env bash
# Restart the local instance. Usage: ./scripts/restart.sh  (PORT respected)
set -euo pipefail
cd "$(dirname "$0")/.."

./scripts/stop.sh
exec ./scripts/start.sh
