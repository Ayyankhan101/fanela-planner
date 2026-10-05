# Fanela — Production Ops Runbook

Audience: whoever owns the box this runs on. MVP deploy = single host,
Node `next start` + local PostgreSQL 18 + local-disk storage
(`storage/uploads`, E5). Update this file when any of that changes.

Related register rules: **B1** (nightly dump + restore drill),
**B2** (JSON artefact ≥90 d), **L4** (append-only grants + nightly
sequence-integrity check). Go-live gate: `TODOS.md` → *Prod-ops runbook*.

---

## 1. Service

```bash
npm run build          # deploy step; typecheck+tests must be green first
npm start               # serves :3000 — run under a supervisor
```

Supervisor (pick one, one host only):

```bash
# systemd unit ExecStart=/usr/bin/npm start  (Restart=always)
# or pm2 start npm --name fanela -- start
# this box: launchd KeepAlive — ~/Library/LaunchAgents/com.fanela.app.plist
```

### Scheduled jobs (launchd user agents)

Four recurring jobs run as launchd agents; versioned plists live in
`ops/launchd/`, installed copies in `~/Library/LaunchAgents/`:

| Label | When | Script |
|---|---|---|
| `com.fanela.backup` | daily 01:30 | `scripts/nightly-backup.sh` |
| `com.fanela.integrity` | daily 02:00 | `scripts/l4-check.sh` |
| `com.fanela.sweep` | daily 03:00 | `npm run storage:sweep` |
| `com.fanela.uptime` | every 5 min | `scripts/uptime-probe.sh` |

```bash
# install/refresh after editing a plist:
cp ops/launchd/*.plist ~/Library/LaunchAgents/
for l in com.fanela.backup com.fanela.integrity com.fanela.sweep com.fanela.uptime; do
  launchctl bootout "gui/$(id -u)/$l" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/$l.plist
done
# logs: logs/{backup,integrity,sweep,uptime}.{out,err}.log (*.log gitignored)
```

Config lives in `.env` (`DATABASE_URL`, optional seed overrides). Never commit
`.env`; keep it `chmod 600` — secrets inventory + rotation procedures live in
[secrets.md](secrets.md). Schema changes = `npm run db:migrate && npm run db:security`
(`db:security` re-applies grants + RLS — required after any migration).

## 2. B1 — Nightly backup + restore drill

### Backup (launchd `com.fanela.backup`, daily 01:30)

```bash
scripts/nightly-backup.sh
# → ~/backups/fanela/fanela-YYYYMMDD.dump, retention 30 d (log: logs/backup.*.log)
# Dump runs as local superuser over the unix socket (peer auth): pg_dump runs
# with row_security=off and 003's FORCE ROW LEVEL SECURITY rejects that even
# for the table owner — only a superuser bypasses (spec §6.3). Never point the
# dump directly at $DATABASE_URL (owner role) — it errors on artwork_events.
```

`pg_dump --format=custom` = compressed + single-file + restorable to any
PG ≥ version of origin.

**Off-box mirror (B1): pending** — no second host yet (MVP dest `~/backups/fanela`
is the same disk as the DB). When a target exists: mirror nightly, including
`storage/uploads/` (§8):
`rsync -a ~/backups/fanela/ offbox-host:/backups/fanela/`

### Restore drill (quarterly, and after any migration)

```bash
# 1. restore to a scratch DB — never over prod (create as owner/superuser,
#    hand ownership to the app role so the boot check runs with prod perms;
#    fanela has no CREATEDB)
psql -d fanela -c "CREATE DATABASE fanela_restore_drill"
psql -d fanela -c "ALTER DATABASE fanela_restore_drill OWNER TO fanela"
SCRATCH="${DATABASE_URL%/*}/fanela_restore_drill"
pg_restore --dbname="$SCRATCH" --no-owner --exit-on-error \
  ~/backups/fanela/fanela-YYYYMMDD.dump

# 2. spot-check: counts + newest audit row
psql "$SCRATCH" -c \
  "SELECT (SELECT count(*) FROM jobs),
          (SELECT count(*) FROM stock_events),
          (SELECT max(ts) FROM operational_audit);"

# 3. app boots against it (temporary DATABASE_URL) — login + one list page
DATABASE_URL="$SCRATCH" PORT=3001 npm start   # curl :3001/login, login+MFA, /jobs

# 4. drop scratch, log drill date in this file
psql -d fanela -c "DROP DATABASE fanela_restore_drill"
```

**Drill log:**
- `2026-10-03 — procedure written; first drill scheduled with first nightly dump.`
- `2026-10-05 — PASS (first drill): 10 MB dump → restore OK (6955 jobs / 6142
  users / 32428 audit / 1526 stock / 1247 artwork) → app boot :3001 (login
  page 200, login `{"mfa":true}`, MFA `{"mfa":false}`, /jobs 200, /api/jobs 200)
  → dropped.`

## 3. B2 — Export artefact retention

The original legacy JSON (and any import artefacts) are the migration
evidence. Keep the pre-cutover export **≥ 90 days after go-live** in
`storage/uploads/` (already uploaded by the import wizard) **and** one copy
off-box with the nightly backups. Delete only after the owner signs off the
cutover in `TODOS.md`.

## 4. L4 — Nightly integrity check (launchd `com.fanela.integrity`, 02:00)

```bash
psql "$DATABASE_URL" <<'SQL'
-- (a) app role must hold INSERT+SELECT only on the append-only logs
SELECT c.relname, p.perm
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL (VALUES
  ('INSERT'), ('SELECT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(perm)
WHERE n.nspname = 'public'
  AND c.relname IN ('stock_events','operational_audit')
  AND has_table_privilege('fanela_app', c.oid, p.perm)
  AND p.perm NOT IN ('INSERT','SELECT');
-- expect: 0 rows (any row = privilege drift → run npm run db:security)

-- (b) correction FK integrity: every corrects_event_id resolves
SELECT count(*) FROM stock_events s
WHERE s.corrects_event_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM stock_events t WHERE t.id = s.corrects_event_id);
-- expect: 0

-- (c) both logs non-empty since go-live (0 before first write is fine)
SELECT (SELECT count(*) FROM stock_events)  AS stock_events,
       (SELECT count(*) FROM operational_audit) AS audit_rows;
SQL
```

Alert on nonzero (a)/(b), or on query error. Installed as
`scripts/l4-check.sh` (exits nonzero on violation; alert = `logs/integrity.err.log`).

## 4b. Storage sweep (launchd `com.fanela.sweep`, 03:00)

```bash
npm run storage:sweep     # storage/uploads: orphans >24 h + originals >UPLOAD_RETENTION_DAYS (90 d)
```

Quota: uploads are capped (`STORAGE_QUOTA_BYTES`, default 5 GB) — over-cap
uploads get HTTP 413 `import_storage_quota`, so the sweep also keeps the box
out of ENOSPC. Include `storage/uploads/` in the nightly off-box copy (§8).

## 4c. Outbox worker (15 s tick — DPD/Xero groundwork)

The outbox (`integration_outbox`) is the transactional queue for outbound
DPD/Xero calls (spec §4.9 / phase0 §4.9). The **table owns all retry state**
(backoff 30 s ×2, 5 attempts → `failed`, stuck `sending` reclaim after 5 min);
pg-boss only fires the tick — no delayed pg-boss retries, so the two schedulers
cannot race.

```bash
npm run outbox:worker    # needs DATABASE_URL; supervise with Restart=always / KeepAlive
```

One instance is fine (claims use `FOR UPDATE SKIP LOCKED`, so extra instances
are safe, not faster than 25 rows/tick). pg-boss creates its own `boss` schema
under `DATABASE_URL` — no `fanela_app` grants needed. The `outbox-tick`
schedule (every 15 s) is created idempotently at worker start.

Monitor weekly / on alert:

```sql
-- failed or stuck rows — should be empty once adapters are live
SELECT id, kind, status, attempts, last_error, ts
FROM integration_outbox
WHERE status IN ('failed', 'sending')
ORDER BY ts DESC LIMIT 20;
```

Manual retry: `POST /api/admin/outbox/{id}/retry` (admin/ops, empty JSON
body) — requeues `failed` / stuck rows immediately; `sent` rows 409.

## 5. Log capture

- App logs to stdout — the supervisor owns rotation
  (systemd journal / pm2 logs). Keep **≥ 30 days**.
- Auth failures are in-table: `SELECT * FROM login_attempts ORDER BY ts DESC LIMIT 50`
  (rate-limit lockouts live here — check before "user can't log in").
- HTTP 5xx: grep app log for the request path + `requestId`; audit trail of
  data changes = `GET /api/audit` (or `operational_audit` directly).

## 6. Uptime probe (launchd `com.fanela.uptime`, every 5 min)

```bash
scripts/uptime-probe.sh    # curl /login, alert to logs/uptime.err.log
```

Alert sink is **log-only for now** (no mailer/push on this box) — grep
`logs/uptime.err.log`, or wire a sink when one exists. Two consecutive
failures → page whoever owns the box. (No `/api/health` endpoint by design;
`/login` is the cheapest unauthenticated 200.)

## 7. First red is blocker (native R10)

Every push runs `.github/workflows/ci.yml` (lint, `next typegen`+`tsc`,
378 tests, fresh postgres). **First red on `main` = drop-what-you're-doing**;
fix-forward before merging anything else. Never "merge over" red CI.

## 8. Storage (E5) — MinIO/S3 checkpoint

MVP stores imports under `storage/uploads/` on local disk. When
multi-instance hosting appears: mirror the directory to MinIO/S3
(same keys, `*.json` by `randomUUID()`), switch `UPLOAD_DIR` resolution to
the object store, keep the ≥90 d B2 rule. Until then: the nightly off-box
copy must include `storage/uploads/`.

## 9. Daily reconciliation (from cutover parallel-run)

```sql
-- days where Fanela job count changed — compare against legacy tallies
SELECT date_trunc('day', ts) d, count(*)
FROM operational_audit
WHERE action LIKE '%job%' OR entity_type = 'job'
GROUP BY 1 ORDER BY 1 DESC LIMIT 14;
```

Exit criterion (TODOS cutover draft): Δ=0 every day for 14 working days.

---

### Contacts / ownership

- Backup + box owner: **TBD (client)** — fill before go-live.
- Cutover sign-off owner: **client** (see `TODOS.md` cutover draft).
