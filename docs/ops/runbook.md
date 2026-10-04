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
```

Config lives in `.env` (`DATABASE_URL`, optional seed overrides). Never commit
`.env`. Schema changes = `npm run db:migrate && npm run db:security`
(`db:security` re-applies grants + RLS — required after any migration).

## 2. B1 — Nightly backup + restore drill

### Backup (cron, daily 01:30)

```bash
STAMP=$(date +%Y%m%d)
DEST=/backups/fanela            # on a different disk/host than the DB
mkdir -p "$DEST"
pg_dump --format=custom --no-owner \
  --dbname="$DATABASE_URL" \
  --file="$DEST/fanela-$STAMP.dump"
# B1: mirror off-box (MinIO/S3 when available; MVP: rsync/scp to second host)
rsync -a "$DEST/" offbox-host:/backups/fanela/
# retention ≥30 d
find "$DEST" -name 'fanela-*.dump' -mtime +30 -delete
```

`pg_dump --format=custom` = compressed + single-file + restorable to any
PG ≥ version of origin.

### Restore drill (quarterly, and after any migration)

```bash
# 1. restore to a scratch DB — never over prod
createdb fanela_restore_drill
pg_restore --dbname=fanela_restore_drill \
  --no-owner --exit-on-error \
  /backups/fanela/fanela-YYYYMMDD.dump

# 2. spot-check: counts + newest audit row
psql -d fanela_restore_drill -c \
  "SELECT (SELECT count(*) FROM jobs),
          (SELECT count(*) FROM stock_events),
          (SELECT max(ts) FROM operational_audit);"

# 3. app boots against it (temporary DATABASE_URL) — login + one list page
# 4. drop scratch, log drill date in this file
```

**Drill log:** `2026-10-03 — procedure written; first drill scheduled with
first nightly dump.` → append `date + result` after every drill.

## 3. B2 — Export artefact retention

The original legacy JSON (and any import artefacts) are the migration
evidence. Keep the pre-cutover export **≥ 90 days after go-live** in
`storage/uploads/` (already uploaded by the import wizard) **and** one copy
off-box with the nightly backups. Delete only after the owner signs off the
cutover in `TODOS.md`.

## 4. L4 — Nightly integrity check (cron, 02:00)

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

Alert on nonzero (a)/(b), or on query error. Script it as
`scripts/l4-check.sh` + cron if you want mail/webhook delivery.

## 4b. Storage sweep (cron, 03:00)

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

## 6. Uptime probe (cron every 5 min)

```bash
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:3000/login)
[ "$CODE" = "200" ] || echo "fanela down: HTTP $CODE" >&2   # pipe to mail/push
```

Two consecutive failures → page whoever owns the box. (No `/api/health`
endpoint by design; `/login` is the cheapest unauthenticated 200.)

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
