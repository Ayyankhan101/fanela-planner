#!/usr/bin/env bash
# L4 nightly integrity check (runbook §4) — launchd com.fanela.integrity @ 02:00.
# Exits nonzero on any violation so launchd's stderr log carries the alert.
#   (a) app role holds only INSERT+SELECT on append-only logs
#   (b) every stock_events.corrects_event_id resolves
set -euo pipefail
cd "$(dirname "$0")/.."
set -a && . ./.env && set +a

OUT=$(psql "$DATABASE_URL" -tA <<'SQL' | tr -d '[:space:]'
SELECT
  (SELECT count(*)
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   CROSS JOIN LATERAL (VALUES
     ('INSERT'), ('SELECT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(perm)
   WHERE n.nspname = 'public'
     AND c.relname IN ('stock_events','operational_audit')
     AND has_table_privilege('fanela_app', c.oid, p.perm)
     AND p.perm NOT IN ('INSERT','SELECT')),
  (SELECT count(*)
   FROM stock_events s
   WHERE s.corrects_event_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM stock_events t WHERE t.id = s.corrects_event_id));
SQL
)

IFS='|' read -r BAD_PRIVS ORPHANS <<<"$OUT"
if [ "${BAD_PRIVS:-x}" != "0" ] || [ "${ORPHANS:-x}" != "0" ]; then
  echo "$(date '+%F %T') L4 FAIL: bad_privs=$BAD_PRIVS orphans=$ORPHANS" >&2
  exit 1
fi
echo "$(date '+%F %T') L4 ok: bad_privs=0 orphans=0"
