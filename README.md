# Fanela Planner

Internal production planner: jobs, customers, stock, dispatch, swatches, shipments, imports and Excel exports. Next.js 16 + PostgreSQL (Drizzle) + vitest.

## Quickstart (2–5 min cold start)

Prerequisites: **PostgreSQL 18** (Homebrew: `brew install postgresql@18`), Node 26, and a PG role with `CREATEDB` + role-creation rights (the setup scripts create the `fanela_app` role).

```bash
npm install                                # 1. dependencies
createdb fanela                            # 2. database (peer-auth local role)
#    + role: CREATE ROLE fanela LOGIN PASSWORD 'fanela_dev';   # 3. TCP role matching .env (or run once with psql)
cp .env.example .env                       # 4. runtime contract (edit DATABASE_URL if needed)
npm run setup                              # 5. migrate → security → seed → lint → typecheck → test
npm run dev                                # 6. http://localhost:3000
```

- The `fanela` role needs password `fanela_dev` (or adjust `DATABASE_URL` in `.env`): `psql -c "CREATE ROLE fanela LOGIN PASSWORD 'fanela_dev' CREATEDB;"`. If your local superuser already is `fanela`, only the password is missing: `ALTER ROLE fanela PASSWORD 'fanela_dev';`
- **`npm run setup` timing (D19):** wall time counts through `db:seed` completion (login reachable) — that is the 2–5 min TTHW target. The lint/typecheck/test tail is recorded separately; suite runtime is *not* part of the target.

## First login (dev-only credentials)

| | |
|---|---|
| Email | `admin@fanela.local` |
| Password | `ChangeMe123!` |
| TOTP (dev secret) | `JBSWY3DPEHPK3PXP` — enroll in any authenticator, enter the 6-digit code |
| Recovery codes | printed once by `npm run db:seed` on first run (`admin recovery codes (shown once): …`) |

Dev-only defaults; override before seeding via `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` in `.env`.

### Reset dev MFA

Lost TOTP/recovery codes in dev:

```sql
UPDATE users SET totp_secret = NULL, recovery_codes = NULL WHERE email = 'admin@fanela.local';
```

then re-run `npm run db:seed` — the first-run branch in `db/seed.mts` re-arms the dev TOTP secret and regenerates recovery codes when either column is NULL.

## npm scripts

| Script | What it does | Success signal | First check on failure |
|---|---|---|---|
| `npm run dev` | Next.js dev server | http://localhost:3000 serves the login page | port 3000 already in use? |
| `npm run build` / `start` | Production build / serve | build completes, server boots | same |
| `npm run lint` | ESLint over the repo | silent exit 0 | run again — file:line listed |
| `npm run typecheck` | `next typegen && tsc --noEmit` (typegen runs automatically — fresh clones get `.next/types` route globals) | silent exit 0 | first type error listed |
| `npm test` / `test:watch` | vitest (needs live PG) | `N passed` | DB up? `.env` `DATABASE_URL` reachable? |
| `npm run db:generate` | Drizzle schema → SQL migration files | new `db/migrations/*.sql` | schema import errors |
| `npm run db:migrate` | Apply pending migrations (`node db/migrate.mjs`) | `applied N migration(s)` / already-migrated | `DATABASE_URL` reachable? |
| `npm run db:security` | **Applies RLS/grants via `db/migrate-all.sh`** — name mismatch is intentional: script says *migrate-all*, the step it adds is *security* (schema → `fanela_app` role → grants → RLS, spec §6.3 order) | `done (schema → role → grants → rls)` | first failing `db/security/*.sql` printed by `psql -v ON_ERROR_STOP=1`; if the role is missing: does `SELECT 1 FROM pg_roles WHERE rolname='fanela_app'` return a row? |
| `npm run db:seed` | Idempotent seed (`tsx db/seed.mts`) | `admin recovery codes (shown once): …` (first run) or quiet pass | `DATABASE_URL`; check `users` row exists |
| `npm run setup` | `db:migrate` → `db:security` → `db:seed` → lint → typecheck → test (D6 golden path; typecheck runs typegen first) | test tail green | walk the chain — first failing step's table row above |

## API

All responses use the envelope: **`{ "error": "<human message>", "code": "<machine code>" }`** on failure (HTTP status carries the class); success bodies are `{ ... }` or `{ job(s)/…: ... }` directly. Auth = session cookie (`fanela_session`), obtained through the two-step login below.

### Endpoints

| Family | Endpoints |
|---|---|
| Auth | `POST /api/auth/login` (step 1 → `{mfa:true}` + `mfa` cookie), `POST /api/auth/mfa` (step 2 → session), `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/mfa/setup`, `POST /api/auth/mfa/enroll`, `POST /api/auth/mfa` (recovery path) |
| Jobs | `GET/POST /api/jobs`, `GET/PATCH /api/jobs/:id`, `POST /api/jobs/:id/cancel`, `lines/:lineId`, `stages/:stageId`, `stock`, `dispatch`, `dispatch/finalise`, `shipments`, `screens`, `artwork`, `swatch`, `swatch/attempts[/:attemptId]` |
| Customers | `GET/POST /api/customers`, `GET/PATCH/DELETE /api/customers/:id` |
| Import (admin/ops) | `POST/GET /api/admin/import` (upload raw JSON body + `x-file-name`, history), `GET /api/admin/import/:id` (`?view=preview|original|errors`), `POST /api/admin/import/:id` (`action: confirm \| execute \| discard \| revalidate`, CAS `version`) |
| Export (admin/ops/office) | `GET /api/exports/:view` — 9 views, `?q=` for `filtered-jobs`, `.xlsx` attachment |
| Audit | `GET /api/audit` |

Permissions are enforced server-side (`requirePermission` / `requireAdminOrOps`) — see `docs/phase0/04-permission-matrix.md`.

### One curl per family

```bash
# auth (two-step: password → TOTP; cookie jar carries the session)
curl -sc jar.txt -X POST localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@fanela.local","password":"ChangeMe123!"}'     # → {"mfa":true}
curl -sb jar.txt -c jar.txt -X POST localhost:3000/api/auth/mfa \
  -H 'content-type: application/json' -d '{"token":"123456"}'       # → session

# jobs
curl -sb jar.txt localhost:3000/api/jobs | head -c 300

# import chain: upload → preview → confirm → execute
curl -sb jar.txt -X POST localhost:3000/api/admin/import \
  -H 'content-type: application/json' -H 'x-file-name: legacy.json' \
  --data-binary @legacy.json                                         # → {batch, counts}
curl -sb jar.txt 'localhost:3000/api/admin/import/<id>?view=preview&filter=all&page=1'
curl -sb jar.txt -X POST localhost:3000/api/admin/import/<id> \
  -H 'content-type: application/json' \
  -d '{"action":"confirm","version":1,"counts":{"create":10},"typedCount":10}'
curl -sb jar.txt -X POST localhost:3000/api/admin/import/<id> \
  -H 'content-type: application/json' \
  -d '{"action":"execute","version":2}'

# export
curl -sb jar.txt -o jobs-$(date +%F).xlsx localhost:3000/api/exports/jobs
```

### Error codes (`lib/errors.ts`)

Grouped by HTTP class — every value the API can emit (the Error & Rescue Registry anchors here).

| Class | Codes |
|---|---|
| **400 / 422** validation | `invalid_request`, `validation_error`, `confirm_required`, `nothing_to_update`, `invalid_receipt_quantity` |
| **401** auth | `unauthenticated`, `invalid_credentials`, `mfa_step_expired`, `mfa_invalid_code`, `mfa_invalid_recovery_code`, `mfa_enroll_invalid` |
| **403** permission | `forbidden`, `forbidden_admin_ops`, `csrf_origin_mismatch` (middleware origin check on mutating API calls) |
| **404** | `not_found`, `job_not_found`, `customer_not_found`, `dispatch_plan_not_found`, `file_not_found`, **`export_view_unknown`** |
| **409** conflicts | `stale_job`, `stale_batch`, `import_batch_invalid_state` (duplicate job numbers / PK clashes return 409 with a message but no code) |
| **413** caps | `import_file_too_large` (25 MB), `import_row_cap` (50,000 rows), `export_row_cap` (100,000 rows) |
| **429** | `rate_limited` (login throttling + import upload throttle, `UPLOAD_RATE_LIMIT` default 100/user/hour) |
| **F9 legacy shape** | `import_shape_invalid` — jobs-only dump, stock history + audit log missing (frozen copy: export a full localStorage dump) |
| **500** | `internal_error`, `import_storage_failed` |

### Known limits

- **Import preview has no error→skip downgrade:** rows marked `error` cannot be softened in preview — edit the source rows and re-upload the file.
- **Upload cap is 25 MB** (fixed by design). Larger legacy dump → procedure below.

### Legacy dump > 25 MB

1. Record the actual size/record count: `node docs/phase0/analyze-backup.mjs <file>` (D12 artifact — output records file type, record count, estimated manual re-entry hours vs pipeline cost).
2. Split the dump (per date range or entity) or re-export the source in ≤ 25 MB parts, then upload each part as its own batch.
3. The 25 MB cap is fixed by design — do not raise it.

## Database

Local dev + tests use **Homebrew PostgreSQL 18.4** — the single source of truth (CI uses `postgres:18`, same major; verified green 2026-10-03). The unused `docker-compose.yml` (PG16) was removed when the dev-DB drift gate closed (`TODOS.md` → Completed).

## Docs map

| File | One-liner |
|---|---|
| `docs/phase0/README.md` | Phase 0 index |
| `docs/phase0/01-rule-register.md` | Business rules E/M/C/R-tagged register (source of truth for behaviour) |
| `docs/phase0/02-er-model.md` | Entity-relationship model |
| `docs/phase0/03-state-machines.md` | Job/stage/import batch state machines |
| `docs/phase0/04-permission-matrix.md` | Role × capability matrix (API + UI gates) |
| `docs/phase0/05-data-quality-report.md` | Legacy data quality findings |
| `docs/phase0/06-migration-mapping.md` | Legacy → new field mapping |
| `docs/phase0/07-integrations-scope.md` | Integrations explicitly in/out of scope |
| `docs/phase0/08-open-items-tracker.md` | Open items with owners |
| `docs/phase0/analyze-backup.mjs` | D12 legacy-dump analyzer (size/record-count/effort estimate) |
| `docs/meeting-brief/README.md` | Stakeholder meeting brief |
| `docs/superpowers/specs/2026-09-27-fanela-central-system-design.md` | Approved design spec |
| `docs/superpowers/plans/2026-09-30-fanela-implementation-plan.md` | Active implementation plan (task checklist) |
| `docs/superpowers/spikes/` | Time-boxed spike records (ExcelJS ceiling, …) |
| `TODOS.md` | Deferred items (8 entries) |
