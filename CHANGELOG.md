# Changelog

## [0.2.1] - 2026-10-04

### Added
- Dashboard landing (`/dashboard`, root `/` redirects): readiness mix (white/amber/green/unknown), stage matrix by department, approval queue counts (swatch awaiting / artwork awaiting / stock issues), due + overdue dispatch list, recent audit activity (gated `audit.view`), active jobs only — `lib/services/dashboard.ts`
- In-app notifications: `notifications` table (`0006_curved_kabuki.sql`, grants in `002_grants.sql`), `emitNotification` role fan-out with actor exclusion, `GET /api/notifications` + `POST /api/notifications/read` (idempotent, owner-scoped), nav bell with unread badge + dropdown (admin/ops only, 60s poll + focus refresh)
- Emit triggers: swatch → `awaiting`, artwork `submit` → `awaiting`, import execute-fail — all inside `withTransaction` (rollback ⇒ no phantom rows)
- Tests: `tests/notifications.test.ts` + `tests/dashboard.test.ts` (10 tests; suite 407/407)

### Changed
- `scripts/deploy.sh` now runs `db:migrate` + `db:security` before restart (runbook deploy gap)
- `tests/security-p3.test.ts` T13 honors `AUTH_COOKIE_SECURE` LAN opt-out (production default asserted with flag unset)

## [0.2.0] - 2026-10-03

### Added
- Import pipeline (E3–E6): upload → preview → typed confirm → atomic execute with readiness rebuild in-tx, original-file persistence (`storage/uploads/`), CAS version guard, reconciliation suite importing FX-1…11 through real route handlers (tests/reconciliation.test.ts)
- Export: generic `/api/exports/[view]` (9 views), ExcelJS buffer-then-send, single-query-per-view, M4 write-time cost-column stripping, export dropdown UI, 100k row cap
- Security: CSRF origin check (`proxy.ts`), upload rate limit (`upload_attempts`), session fixation/rotation tests, cookie-flags tests (`tests/security-p3.test.ts`)
- `lib/errors.ts` frozen message/code taxonomy; `tests/http-errors.test.ts`
- Spec §14 UAT suite (`tests/uat.test.ts`, 11 tests); `tests/rules-e/m.test.ts`, `tests/transaction.test.ts`
- CI workflow (`.github/workflows/ci.yml`, postgres 18 + bootstrap); `npm run setup` chain incl. `typegen` (fresh-clone typecheck fix); `fixtures/generate.mjs` FX-1…11
- README getting-started + error contract; AGENTS.md; D19 cold-start record (11s through seed vs 2–5 min target)

### Changed
- Vitest `fileParallelism: false` (shared-PG fixture races across test files)
- T13 security checklist records (P3-close + pre-P4 remainder) in plan Review record
- TODOS gates recorded: C3 owner/date, C5 demo, C7 metrics, C9 kill triggers

### Fixed
- Next 16 `middleware.ts` → `proxy.ts` (root middleware broke `/api` responses)
- Upload rate-limit window (100/hour/user) aligned with rules-e caps tests
