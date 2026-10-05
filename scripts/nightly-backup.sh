#!/usr/bin/env bash
# Nightly pg_dump (runbook §2, B1) — launchd com.fanela.backup @ 01:30 daily.
# Local MVP dest: ~/backups/fanela (macOS root FS is read-only; off-box mirror
# is a pending §8 step). Retention ≥30 d.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a && . ./.env && set +a

STAMP=$(date +%Y%m%d)
DEST="$HOME/backups/fanela"
mkdir -p "$DEST"

# Dump as local superuser over the unix socket (peer auth): pg_dump runs with
# row_security=off, and db/security/003 FORCE ROW LEVEL SECURITY makes that an
# error even for the table owner — only a superuser bypasses (spec §6.3).
DB_NAME=$(node -p "new URL(process.env.DATABASE_URL).pathname.slice(1)")
/opt/homebrew/bin/pg_dump --format=custom --no-owner \
  -d "$DB_NAME" \
  --file="$DEST/fanela-$STAMP.dump"

find "$DEST" -name 'fanela-*.dump' -mtime +30 -delete
echo "$(date '+%F %T') backup ok: $DEST/fanela-$STAMP.dump ($(du -h "$DEST/fanela-$STAMP.dump" | cut -f1))"
