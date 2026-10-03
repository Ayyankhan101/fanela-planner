# Changelog

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
