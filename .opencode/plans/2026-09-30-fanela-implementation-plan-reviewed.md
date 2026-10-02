# Fanela Central System — Implementation Plan

**Date:** 2026-09-30 · **Revised:** 2026-10-01 (plan-eng-review, 17 findings, all approved) · **Input:** design spec (2026-09-27, §1–§20, all open items resolved) + `docs/phase0/` (decisions locked) · **No live data** — import screen ships in MVP.

> Review revisions applied: stack/layout corrected to as-built (1A), CI moved into P3 (2A), `import_batches.version` added (3A), upload cap (4A), import = Admin/Ops (5A), import diagram + failure lines (6A), `withTransaction` (7A), dead deps removed (8A), export view enum fixed (9A), test mapping fixed (10A), E-rule DoD split (11A), UAT checkpoint formalized (12A), import error-path tests (13A), automated reconciliation (14A), export test depth (15A), single-query export mandate (16A), readiness rebuild on import (17A), ExcelJS chosen.

## 0. Kickoff corrections (applied before code)

1. Spec §6 departments = 9 keys (corrected in spec): `print|dtg|dtf|embroidery|sewing|screens|warehouse|packing|dispatch`.
2. Department seed + role mapping from `phase0/04` (7 roles, 13→7 legacy map).
3. Rule register `phase0/01` = the test backlog; fixture inventory `phase0/05 §4` = test data.
4. **Stack (as-built, corrected 2026-10-01):** Next.js **16.3.7** (App Router, TS) · Drizzle + PostgreSQL **18.4** (Homebrew; `docker-compose.yml` exists but unused by tests — see TODOS) · Auth = **hand-rolled session cookies + Argon2id + TOTP** (two-step `pending_mfa`; `next-auth` dep never wired — removed, along with `pg-boss` which returns with P5) · raw `db/security/*.sql` after Drizzle migrations.

## 1. Layout (as-built)

```text
app/            UI + Route Handlers
lib/            auth, permissions, validation, services/<domain> (as-built — no modules/)
db/             drizzle schema/, migrations/, security/*.sql, seed
fixtures/       generate.mjs + generated JSON (FX-1…11)  [P3, new]
.github/        ci.yml [P3, new]
docs/           spec, phase0, meeting-brief (unchanged)
```

## 2. Phases

### P1 — Foundation (DONE 2026-09-30, 113 tests)
- Scaffold Next.js + Drizzle + Postgres + migration runner; `db/security/*.sql`.
- Seed: 9 departments, 7 roles, full permission catalogue (`role_permissions`).
- Auth: register/seed users, Argon2id, two-step MFA, sessions 2h idle/12h absolute, login rate limit.
- Jobs: create/edit with customer snapshot, product/size grid, stages (auto Dispatch stage), queue sort/search (J6/J9), archive flag (no delete, F4).

**DoD:** tests for rules C1–C4, J1–J9, B3–B6 green; permission probe suite (7 roles × endpoints) green. ✅

### P1.5 — Prerequisite hardening (new, before P3)
- **[7A]** `withTransaction(fn)` in `lib/db.ts` (pool.connect → BEGIN/COMMIT/ROLLBACK); wrap the 5 spec §14-line-406 atomic sites: stock receipt/correction, stage completion + job rollup, swatch decision, shipment transition, artwork revise. Failure-injection test: mid-tx throw → rollback, state unchanged. Existing 195 tests must stay green.
- **[8A]** `npm uninstall next-auth pg-boss` (zero source usage verified). pg-boss reinstalls with P5.

**DoD:** `npm test` 195+ green incl. new rollback test; `npm ls next-auth pg-boss` empty.

### P2 — Gates + history (DONE 2026-10-01, 195 tests)
- Readiness server function (G1–G8 incl. F8/FX-5); artwork A1–A5; swatch S1–S10 + gate; stock events L1; audit 8 kinds L2–L5; stages D1–D10; dispatch P1–P9; optimistic locking + 409; RLS finals.

**DoD:** full rule register 01 green; invalid transitions → 422; concurrency tests; FX-5 passes. ✅
**UAT checkpoint [12A]:** retro-log §14 coverage row in `08-open-items-tracker.md` (which §14 rows map to shipped tests; remaining rows → P4 `tests/uat.test.ts`).

### P3 — Import screen + fixtures
- **[T3] Fixture generator FX-1…11** (`fixtures/generate.mjs`).
- **Import pipeline** (atomic per batch, `05 §3` single transaction — uses `withTransaction` from P1.5):

```text
Upload ──► Parse ──► Validate ──► Preview ──► Confirm ──► Execute ──► Audit ──► Result
 ≤25MB      shape      05 §2      create/      typed      single      import_    created/
 [4A] 413   A/B/C ✔    issue      skip/error   confirm    tx/batch    batches    skipped/
            D ✗→F9     classes    rows [13A]   [3A:ver]   [7A]        row +      errors
            message               FX-9 all                readiness   original
                                   flagged                 rebuild     file kept
                                                           [17A]       [E5]
 failure: any step error → rollback, batch status=failed, errors[] surfaced on batch row (never silent, never partial)
```

- **[3A]** Migration: `import_batches.version integer NOT NULL DEFAULT 1`; confirm/execute guard `WHERE status=… AND version=$n` → 0 rows = 409 + `current` (matches every P2 sub-entity).
- **[4A]** Upload: check `Content-Length`/`file.size` early → **413 beyond 25 MB** (spec size decision line 510); spike test for Next 16 proxy truncation >1MB — set `next.config` body-size only if reproduced.
- **[5A]** **Admin/Ops UI** (E6 — plan's original "Admin-only" corrected); probe: admin/ops=200, director/office/dispatch/dept=403, anon=401.
- **[17A]** After batch commit: `updateReadinessCache(jobId)` per imported job (one pass); reconciliation asserts `readiness_cache` non-null + FX-5 colours.
- **[14A]** Reconciliation **automated**: `tests/reconciliation.test.ts` imports FX-1…11 through the same route handlers the screen calls → per-table count assertions → Δ=0 (FX-10 500 jobs, generous timeout).
- **[13A]** `tests/rules-e.test.ts` explicit rows: (1) shape A/B/C → preview renders; (2) shape D → 4xx + exact F9 message string; (3) FX-9 four classes each flagged (dup job_number → skip, bad date → error, orphan ref → error/warn, blank SKU → error); (4) mid-execute SQL failure → rollback + `failed` + `errors[]`.
- Reconciliation report in admin UI (counts table).

**DoD:** [11A] **E3, E4, E5, E6** green; FX-1…11 import through real route handlers + reconciliation **automated Δ=0**; import error-path rows green; permission probe green.
*(E1/E2/E7 deferred to P4 — they need the export code.)*

### P4 — Excel + reports
- **Generic route** `/api/exports/[view]` (Step-0 decision — one route, not nine): **[9A]** view enum = E1's nine verbatim: `jobs | filtered-jobs | department | stock-shortage | swatches | shipments | audit | customers | products`.
- **[ExcelJS]** server-side streaming writer; **[16A]** one SQL statement per view with joins — export must NOT call `getJob`/`computeReadiness` per row (500-job export must not fan out to ~6500 queries); lift `listJobs` LIMIT for export.
- **[M4]** column stripping at write time (worker decides columns; never generate-then-redact).
- Reports on snapshots (**E2**).
- **[12A]** `tests/uat.test.ts`: spec §14 acceptance suite (Excel round-trip row, MFA row, remaining un-taken checkpoint rows).
- **[15A]** Tests: unknown view → 4xx (no default fallthrough); 9 views × 7 roles allow/deny (reuse `assertClasses` probe pattern); **byte-level M4 assert** — generated workbook for Office/Dispatch/Packing/dept contains no cost column.

**DoD:** [11A] **E1, E2, E7** + export-permission matrix tests; **M1–M4** green (M4 proven at file level); uat.test.ts green.

### P5 — Later (gated)
- DPD API (prereq D1–D6), Xero (X1–X5) via outbox — **reinstall pg-boss here**; notifications/dashboards after schema stable.

## 3. Test mapping [10A fixed]

| Source | Becomes |
|---|---|
| `phase0/01` rules — **all 76 IDs: A1–A5, B1–B6, C1–C4, D1–D10, E1–E7, G1–G8, J1–J9, L1–L5, M1–M4, P1–P9, S1–S10** | unit/integration test files per domain, one per rule ID |
| `phase0/04` matrix | permission-probe test: role × endpoint → allow/deny exact |
| `phase0/03` machines | transition tests: valid path + every invalid → 422 |
| `phase0/05 §4` FX-1…11 | fixture suite + **automated** import reconciliation |
| spec §14 UAT | `tests/uat.test.ts` at P4 (P2 rows retro-logged in tracker) |

## 4. Definition of done (global)

lint + typecheck + tests green before each phase closes · **CI (`.github/workflows/ci.yml`) runs all three on every push [2A]** · no commits unless asked · each P closes with phase0 checklist row updated · real-data late arrival runs `analyze-backup.mjs` + P3 screen unchanged.

## 5. Sequence

```
Kickoff → P1 ✅ → P1.5 (withTransaction + dep cleanup) → P2 ✅ → P3 → P4 → (P5 when prereqs green)
                                  └── UAT: P2 retro-log at P3 close, full §14 at P4 ──┘
```

## NOT in scope

- **P5 integrations** (DPD, Xero, notifications, dashboards) — gated on schema stability + external prereqs (plan line 57).
- **Real-data import execution** — no data exists (OI-8); `analyze-backup.mjs` procedure runs when data arrives, P3 screen unchanged.
- **Excel-shaped imports** — import accepts JSON only (shape A–D per `05 §1`); XLSX parse not required by any rule.
- **`modules/` directory refactor** — as-built layout (`lib/services/`) kept; no speculative restructure [1A].
- **Auth.js/next-auth adoption** — hand-rolled sessions proven by 195 tests; dep removed [8A].
- **pg-boss/outbox** — P5 only [8A].
- **Docker-based local DB** — Homebrew PG 18.4 works; compose reconciliation deferred to TODOS.
- **UI design/polish of import & export screens** — functional + permission-gated only; design review separate.
- **Readiness cache invalidation via DB triggers** — app-level `updateReadinessCache` pattern retained (as-built convention).
- **Export file storage/persistence** — exports stream and discard; no export history table.

## What already exists (reused, not rebuilt)

- **`lib/services/*`** (8 domains, 26 exports) — P3 import writes through existing job/stock/swatch services where possible (e.g. `updateReadinessCache`, `refreshJobStatus`, `audit()`); does not reimplement readiness/stage logic.
- **`lib/http.ts` `err`/`toResponse`/`requirePermission`/`requireAdminOrOps`** — all new routes (import, export) reuse; 409 `current` merge already implemented.
- **Probe harness** (`tests/probe-p2.test.ts` `assertClasses`) — E6 import probe [5A] and export role matrix [15A] extend the same pattern with one `X-Forwarded-For` per request.
- **`import_batches` + `files` tables** (migration 0000) — P3 adds only `version` column [3A]; status enum already covers pipeline.
- **Fixtures contract** (`05 §1–§4` + `06 migrateState` rules) — validation logic is specified, not invented.
- **Rule register 01 as test backlog** — E/M/L rule IDs map 1:1 to test files; DoD split [11A] matches phase → code → test.
- **`analyze-backup.mjs`** — real-data-late procedure already scripted (plan line 71).
- **Stock/audit append-only RLS** (`db/security/003`) — import inserts go through same app role grants.

## Failure modes (new codepaths)

| Codepath | Realistic production failure | Test? | Error handling? | User sees? |
|---|---|---|---|---|
| Import execute | Mid-batch SQL error → partial rows committed, batch stuck `confirmed` | [13A] failure-injection test | [7A] `withTransaction` rollback → `failed` | Batch row + `errors[]` |
| Import confirm race | Double-click/race → batch executed twice, duplicated jobs | [3A] double-confirm 409 test | CAS on `version`+`status` | 409 + current batch |
| Import upload | 30MB dump → OOM/truncation → parse-garbage masquerading as validation error | [4A] 413 test + truncation spike | Early size check | Clear 413 |
| Import → queue | Imported jobs have NULL `readiness_cache` → wrong gate colour in queue | [17A] FX-5 colour assert | Rebuild in execute | Correct colour |
| Export | Unknown/typo view silently falls through to default view → wrong data exposed | [15A] unknown-view 4xx test | Strict enum validation | 4xx |
| Export | Cost columns leak to Office/Dispatch/dept (M4 violation) | [15A] byte-level workbook assert | Write-time column selection | — (prevented) |
| Export | Per-row `getJob` fan-out → 6.5k queries, request timeout at 500 jobs | [16A] row-count/completion test | Single-query mandate | Slow/failed download |
| withTransaction refactor | Behaviour drift in 5 wrapped sites (e.g. lost audit row) | 195 existing tests + new rollback test | ROLLBACK on throw | — (caught in CI [2A]) |
| CI | Local-green/CI-red (PG version/env mismatch) | — | postgres service block in workflow | Red badge instead of silent merge |

**Critical gaps:** 0 — every flagged gap has both a test and error handling assigned above.

## Worktree parallelization

No git repo yet — lanes are sequencing guidance for when version control lands (or for parallel sessions):

| Step | Modules touched | Depends on |
|------|----------------|------------|
| T1 withTransaction | `lib/db.ts`, `lib/services/*` | — |
| T8 CI | `.github/` | — |
| T7 dep cleanup | `package.json` | — |
| T2/T3/T4/T5/T6 import | `lib/services/import`, `app/api/admin/import`, `fixtures/`, `tests/` | T1 (execute uses tx) |
| T9/T15 export + uat | `app/api/exports`, `lib/services/export`, `tests/` | — (parallel to P3) |

- **Lane A:** T8 → T7 (tiny, independent) · **Lane B:** T1 (touches lib/services — serialize with nothing else) · **Lane C:** P3 import suite after T1 · **Lane D:** P4 export suite (shares only `tests/` naming — parallel to C after T1).
- **Conflict flags:** T1 and P3 both touch `lib/services/` — run T1 first, not concurrent. Lanes C and D both add `tests/*.test.ts` — distinct files, low risk.

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~3h / CC: ~30min)** — db/lib — Add `withTransaction` and wrap 5 spec-atomic sites + failure-injection test
  - Surfaced by: Code quality — spec line 406 atomicity vs `lib/db.ts` query()-only multi-writes (stock.ts:45/266/271 etc.)
  - Files: `lib/db.ts`, `lib/services/{stock,stages,swatch,dispatch,artwork}.ts`
  - Verify: `npm test` (195 green) + new rollback test
- [ ] **T2 (P1, human: ~1h / CC: ~10min)** — db — Add `import_batches.version` + CAS guard on confirm/execute
  - Surfaced by: Architecture — spec line 405 per-sub-entity version missing (`db/schema/audit.ts:38-49`)
  - Files: `db/migrations/`, `lib/services/import.ts`
  - Verify: double-confirm 409 test, stale-version 409 test
- [ ] **T3 (P1, human: ~2h / CC: ~30min)** — fixtures — Build `fixtures/generate.mjs` FX-1…11
  - Surfaced by: Plan P3 bullet; `phase0/05 §4` inventory
  - Files: `fixtures/generate.mjs`
  - Verify: `node fixtures/generate.mjs` emits 11 valid files
- [ ] **T4 (P1, human: ~1d / CC: ~3h)** — import — Import pipeline (service+route+UI) per diagram: atomic execute, readiness rebuild, audit+batch row
  - Surfaced by: Architecture 6A diagram/failure lines; Performance 17A readiness cache
  - Files: `lib/services/import.ts`, `app/api/admin/import/route.ts`, import UI
  - Verify: `npm test` — E3/E5/E6 rows + readiness colours
- [ ] **T5 (P1, human: ~30min / CC: ~15min)** — import — Upload 25MB cap → 413 + truncation spike test
  - Surfaced by: Architecture — spec line 510; Next 16 proxy footgun (conf 7/10)
  - Files: import route, `next.config.ts` (only if spike reproduces), `tests/rules-e.test.ts`
  - Verify: 26MB file → 413
- [ ] **T6 (P1, human: ~30min / CC: ~10min)** — import — E6 permission probe (admin/ops 200; others 403; anon 401)
  - Surfaced by: Architecture 5A — plan said Admin-only vs register E6
  - Files: `tests/rules-e.test.ts`
  - Verify: `npm test`
- [ ] **T7 (P2, human: ~10min / CC: ~5min)** — deps — Uninstall `next-auth` + `pg-boss`
  - Surfaced by: Code quality — zero source usage; pg-boss returns at P5
  - Files: `package.json`
  - Verify: `npm ls next-auth pg-boss` empty; `npm test` green
- [ ] **T8 (P1, human: ~30min / CC: ~10min)** — ci — Add `.github/workflows/ci.yml` (lint + typecheck + test, postgres service)
  - Surfaced by: Architecture — P1 promised CI (plan line 26), none exists
  - Files: `.github/workflows/ci.yml`
  - Verify: workflow run green (needs postgres service + migration step)
- [ ] **T9 (P1, human: ~1d / CC: ~3h)** — export — Generic `/api/exports/[view]`: 9-view enum, ExcelJS, single-query-per-view, M4 write-time stripping
  - Surfaced by: Step-0 decision; Issues 9A/16A; ExcelJS decision
  - Files: `app/api/exports/[view]/route.ts`, `lib/services/export.ts`
  - Verify: `npm test` — export matrix + unknown-view 4xx
- [ ] **T10 (P2, human: ~2h / CC: ~30min)** — uat — `tests/uat.test.ts` (spec §14) + tracker P2 §14 retro-log row
  - Surfaced by: Tests 12A — P2 checkpoint never logged
  - Files: `tests/uat.test.ts`, `docs/phase0/08-open-items-tracker.md`
  - Verify: `npm test`
- [ ] **T11 (P3, human: ~10min / CC: ~5min)** — todo — Create `TODOS.md` with dev-DB drift item (compose unused vs Homebrew vs CI postgres:18)
  - Surfaced by: TODO candidate 1 (approved A)
  - Files: `TODOS.md`
  - Verify: file exists, format matches `TODOS-format.md`

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | NOT RUN | — |
| Outside Review | — | Independent 2nd opinion | 0 | NOT RUN (outside voice skipped — no codex/aside available) | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 17 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | NOT RUN | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | NOT RUN | — |

- **OUTSIDE COVERAGE:** none — outside voice skipped this run (Aside unavailable, codex not invoked); no external completion claimed.
- **VERDICT:** ENG CLEARED — ready to implement (T1→T11 order in Implementation Tasks).

NO UNRESOLVED DECISIONS
