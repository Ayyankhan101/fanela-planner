#!/bin/sh
# Full migration run: Drizzle schema → app role → grants → RLS (spec §6.3 order).
# Usage: [DATABASE_URL=...] [APP_PASSWORD=...] ./db/migrate-all.sh
set -e
cd "$(dirname "$0")/.."

DATABASE_URL="${DATABASE_URL:-postgres://fanela:fanela_dev@localhost:5432/fanela}"
APP_PASSWORD="${APP_PASSWORD:-fanela_app_dev}"

echo "== drizzle migrations"
node db/migrate.mjs

echo "== app role"
EXISTS=$(psql "$DATABASE_URL" -tAc "SELECT 1 FROM pg_roles WHERE rolname='fanela_app'")
if [ "$EXISTS" != "1" ]; then
  # URL user may lack CREATEROLE (dev: fanela) — fall back to local peer-auth superuser
  psql "$DATABASE_URL" -c "CREATE ROLE fanela_app LOGIN PASSWORD '${APP_PASSWORD}'" \
    || psql -d fanela -c "CREATE ROLE fanela_app LOGIN PASSWORD '${APP_PASSWORD}'"
  echo "created role fanela_app"
fi

echo "== security migrations"
for f in db/security/*.sql; do
  echo "-- $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "== done (schema → role → grants → rls)"
