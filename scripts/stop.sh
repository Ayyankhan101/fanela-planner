#!/usr/bin/env bash
# Stop the local instance started by scripts/start.sh. Usage: ./scripts/stop.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PIDFILE=".run/app.pid"

if [ ! -f "$PIDFILE" ]; then
  echo "not running (no $PIDFILE)"
  exit 0
fi

read -r PID PP <"$PIDFILE" || true

# kill only our recorded pid, and only if it is still our next server
# listening on the port we recorded (guards pid reuse)
if [ -z "${PID:-}" ] || [ -z "${PP:-}" ] ||
  ! ps -p "$PID" -o command= 2>/dev/null | grep -Eq "next-server|next start" ||
  ! lsof -nP -iTCP:"$PP" -sTCP:LISTEN -t 2>/dev/null | grep -qx "$PID"; then
  echo "stale pidfile ($PIDFILE no longer owns a next server on ${PP:-?}) — cleared"
  rm -f "$PIDFILE"
  exit 0
fi

echo "==> stopping pid $PID (port $PP)"
kill "$PID" 2>/dev/null || true
for _ in $(seq 1 10); do
  ps -p "$PID" >/dev/null 2>&1 || break
  sleep 0.5
done
if ps -p "$PID" >/dev/null 2>&1; then
  echo "==> still alive after 5s — SIGKILL"
  kill -9 "$PID" 2>/dev/null || true
fi
rm -f "$PIDFILE"
echo "==> stopped"
