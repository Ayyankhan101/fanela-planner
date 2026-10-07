#!/usr/bin/env bash
# Start a local app instance. Usage: ./scripts/start.sh  (PORT=3002 ./scripts/start.sh to override)
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
PIDFILE=".run/app.pid"
LOG="logs/local.log"
URL="http://localhost:$PORT"

echo "==> preflight"
if [ ! -f .env ]; then
  echo "missing .env — run: cp .env.example .env && npm run setup" >&2
  exit 1
fi
mkdir -p .run logs

if [ -f "$PIDFILE" ]; then
  read -r PID PP <"$PIDFILE" || true
  if [ -n "${PID:-}" ] && ps -p "$PID" -o command= 2>/dev/null | grep -Eq "next-server|next start"; then
    echo "already running (pid $PID, port ${PP:-?}) → http://localhost:${PP:-?}"
    if [ "${PP:-}" != "$PORT" ]; then
      echo "wanted port $PORT — run ./scripts/stop.sh first, or use PORT=${PP}"
    fi
    exit 0
  fi
  rm -f "$PIDFILE"
fi

if lsof -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "port $PORT in use by another process:" >&2
  lsof -iTCP:"$PORT" -sTCP:LISTEN -P 2>/dev/null | tail -1 >&2
  echo "stop it, or run: PORT=<other> ./scripts/start.sh" >&2
  exit 1
fi

if [ ! -d .next ]; then
  echo "==> no .next — building (npm run build)"
  npm run build
fi

echo "==> starting next start -p $PORT (log: $LOG)"
nohup ./node_modules/.bin/next start -p "$PORT" >>"$LOG" 2>&1 &
echo "$! $PORT" >"$PIDFILE"

echo "==> health-wait $URL"
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$URL/login" 2>/dev/null || true)
  if [ "$code" = "200" ]; then
    api=$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/audit" 2>/dev/null || true)
    if [ "$api" = "401" ]; then
      echo "==> up: $URL"
      echo "    login: $URL/login  (admin@fanela.local / ChangeMe123! / TOTP JBSWY3DPEHPK3PXP)"
      exit 0
    fi
    echo "==> app up but DB probe returned $api (want 401) — check DATABASE_URL, run npm run setup; tail $LOG" >&2
    exit 1
  fi
  sleep 1
done
echo "==> did not come up in 60s — last log lines:" >&2
tail -20 "$LOG" >&2
exit 1
