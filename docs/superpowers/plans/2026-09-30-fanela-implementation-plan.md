<!-- /autoplan restore point: "/Users/mac/.gstack/projects/fanela-planner-paid-project/no-branch-autoplan-restore-20261001-175735.md" -->
## Implementation plan
# Fanela Central System — Implementation Plan

**Date:** 2026-09-30 · **Revised:** 2026-10-01 (plan-eng-review ×2: round 1 — 17 findings; autoplan Phase 3 round 2 native voice — 21 findings; all approved) · **Input:** design spec (2026-09-27, §1–§20, all open items resolved) + `docs/phase0/` (decisions locked) · **No live data** — import screen ships in MVP.

> Review revisions applied: stack/layout corrected to as-built (1A), CI moved into P3 (2A), `import_batches.version` added (3A), upload cap (4A), import = Admin/Ops (5A), import diagram + failure lines (6A), `withTransaction` (7A), dead deps removed (8A), export view enum fixed (9A), test mapping fixed (10A), E-rule DoD split (11A), UAT checkpoint formalized (12A), import error-path tests (13A), automated reconciliation (14A), export test depth (15A), single-query export mandate (16A), readiness rebuild on import (17A), ExcelJS chosen.

**Line refs:** `plan line N` = this document's 2026-09-30 original revision (pre-review); `spec §N` = design spec 2026-09-27. **C-labels:** bare `C1–C4` in DoD/test tables = rule-register customer rules; `CEO C1–C9` = Phase-1 scope proposals (Step 0 ledger).

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

**DoD:** P2-scope register IDs green (A, B, C, D, G, J, L, P, S); E and M complete at P3/P4; invalid transitions → 422; concurrency tests; FX-5 passes. ✅
**UAT checkpoint [12A]:** retro-log §14 coverage row in `08-open-items-tracker.md` (which §14 rows map to shipped tests — written by T10 at P4; remaining rows → P4 `tests/uat.test.ts`).

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
- **[4A]** Upload: check `Content-Length`/`file.size` early → **413 beyond 25 MB** (spec size decision line 510); spike test for Next 16 proxy truncation >1MB — set `next.config` body-size only if reproduced; header check alone skips chunked bodies — add a streaming size guard (chunked 26MB → 413 test) [X3]. Parse enforces the **50,000-row cap → 4xx + frozen message** (`lib/errors.ts` constant [T21]) [X1].
- **[5A]** **Admin/Ops UI** (E6 — plan's original "Admin-only" corrected); probe: admin/ops=200, director/office/dispatch/dept=403, anon=401.
- **[17A]** During execute, inside the batch transaction: `updateReadinessCache(jobId)` per imported job (one pass — same tx as import, no post-commit crash window); reconciliation asserts `readiness_cache` non-null + FX-5 colours.
- **[14A]** Reconciliation **automated**: `tests/reconciliation.test.ts` imports FX-1…11 through the same route handlers the screen calls → per-table count assertions → Δ=0 **+ spot-assert N sampled rows against the fixture (job_number, customer, date — count parity can hide mangled values)** (FX-10 500 jobs; explicit per-test timeout override — vitest default `testTimeout: 15_000` is not generous enough).
- **[13A]** `tests/rules-e.test.ts` explicit rows, contract-faithful to `phase0/05 §2`: (1) shape A/B/C → preview renders; (2) shape D → 4xx + exact F9 message string; (3) FX-9 severities per `05 §2` — new dup job_number → error (block row), existing-in-DB job_number → skip (E3), bad date → error, orphan ref → warn, blank SKU → warn — preview places rows by severity (create/skip/error counted; warn/info listed with badge, non-blocking); (4) mid-execute SQL failure → rollback + `failed` + `errors[]`; (5) E4: import writes no swatch/shipment/photo/audit-history rows (table-count asserts); (6) cancel at preview → zero writes; (7) TOCTOU: colliding `job_number` inserted AFTER preview → execute re-validates inside the tx and downgrades to skip (batch succeeds, skip count bumped — never a raw SQL failure) [X2]; (8) state-machine matrix: discard→re-upload, discard→resume→confirm (stale version → 409), resume→stale-confirm [T5].
- **[ENG A2] Parse persists validated rows:** parsed row set + severities stored at Parse (`import_batches.parsed jsonb` or `import_batch_rows`), bounded by the import row cap; Preview pagination/CSV, Resume-after-restart and the error CSV all read persisted rows — no 25MB re-parse per page; restart-session test: expired cookie → re-login → Resume shows identical preview [X4].
- Reconciliation report in admin UI (counts table).

**DoD:** [11A] **E3, E4, E5, E6** green; FX-1…11 import through real route handlers + reconciliation **automated Δ=0**; import error-path rows green; permission probe green; **UI Design Contract compliance** (anatomy, state-table copy, typed confirm, issues-first preview, tokens, a11y — Phase 2) + [13A] confirm-with-errors row green; **T13 P3-close subset green** (CSRF + upload authz/rate-limit) [S1].
- **[CEO C2 · 1.1/4.1] DoD gate — real-data execute only:** as soon as any legacy sample exists (owner via D12; target: before T3/T4 build), run `analyze-backup.mjs`; before any real-data execute, if the format is CSV/XLSX, settle converter-vs-extend-parser first (JSON shapes A–D remain the MVP import contract). Fixture execute in P3 is unaffected.
- **[CEO C3 · 1.1/2.9] DoD gate (conditional):** FX-only Δ=0 proves spec conformance, not business correctness: P3 close also requires one dry-run import of a real/sample dataset through the same route handlers (reconciliation Δ=0) when data is available; if still unavailable at P3 close, P4 close requires a named owner + date recorded in `TODOS.md` (hard gate, no silent skip).
*(E1/E2/E7 deferred to P4 — they need the export code.)*

### P4 — Excel + reports
- **Generic route** `/api/exports/[view]` (Step-0 decision — one route, not nine): **[9A]** view enum = E1's nine verbatim: `jobs | filtered-jobs | department | stock-shortage | swatches | shipments | audit | customers | products`.
- **[ExcelJS]** in-memory workbook builder → buffer-then-send response (streaming writer only if the C4 spike demands it — streaming into a buffer gains nothing) [H3]; **[16A]** one SQL statement per view with joins — export must NOT call `getJob`/`computeReadiness` per row (500-job export must not fan out to ~6500 queries); lift `listJobs` LIMIT for export.
- **[M4]** column stripping at write time (worker decides columns; never generate-then-redact).
- Reports on snapshots (**E2**).
- **[12A]** `tests/uat.test.ts`: spec §14 acceptance suite (Excel round-trip row, MFA row, remaining un-taken checkpoint rows).
- **[CEO C7]** Success metric defined with a named owner before cutover (definition tracked in `TODOS.md`, P1; value is user-defined).
- **[15A]** Tests: unknown view → 4xx (no default fallthrough); 9 views × 7 roles allow/deny (reuse `assertClasses` probe pattern); **M4 assert re-parses the workbook** (exceljs re-read + sharedStrings/cell scan — raw byte scan of a zipped xlsx is vacuously green): generated workbook contains no cost column (`Buying Cost`, `unit_price`) across **all 9 views** (jobs/filtered-jobs/department/stock-shortage/swatches/shipments/audit/customers/products — full coverage nearly free with the re-parse harness) [T1]; **E7**: audit export hides order-lines cost rows; **E2**: report snapshot rows immutable after job edit.

**DoD:** [11A] **E1, E2, E7** + export-permission matrix tests; **M1–M4** green (M1–M3 via `tests/rules-m.test.ts`, M4 proven at file level by re-parsing the workbook); uat.test.ts green; **T15 export dropdown shipped** + buffer-then-send (no truncated downloads) per UI Design Contract.
- **DX close [D19]:** T16–T21 complete and the timed cold-start run recorded vs the 2–5 min target (global DoD line) — first D19 run gates P4 close.

### P5 — Later (gated)
- DPD API (prereq D1–D6), Xero (X1–X5) via outbox — **reinstall pg-boss here**; notifications/dashboards after schema stable. Cutover plan (target date, parallel-run exit criteria, legacy-shutdown owner) required before go-live — tracked in `TODOS.md`.

## 3. Test mapping [10A fixed]

| Source | Becomes |
|---|---|
| `phase0/01` rules — **all 77 IDs: A1–A5, B1–B6, C1–C4, D1–D10, E1–E7, G1–G8, J1–J9, L1–L5, M1–M4, P1–P9, S1–S10** (verified 2026-10-01; prototype F-findings in the register are not rule IDs) | unit/integration test files per domain, one per rule ID where testable; **B1/B2/L4 are ops checks — verified via the prod-ops runbook TODOS entry, not tests** |
| `phase0/04` matrix | permission-probe test: role × endpoint → allow/deny exact |
| `phase0/03` machines | transition tests: valid path + every invalid → 422 |
| `phase0/05 §4` FX-1…11 | fixture suite + **automated** import reconciliation |
| spec §14 UAT | `tests/uat.test.ts` at P4 (P2 rows retro-logged in tracker) |

## 4. Definition of done (global)

lint + typecheck + tests green before each phase closes · **CI (`.github/workflows/ci.yml`) runs all three on every push [2A] — conditional on CEO C1 (repo+remote exist); until approved the same three run locally at each phase close** · no commits unless asked · each P closes with phase0 checklist row updated · real-data late arrival runs `analyze-backup.mjs` (output records file type, record count, estimated manual re-entry hours vs pipeline cost) + P3 screen unchanged · **DX acceptance [D19]: one timed cold-start run at P4 close — clean checkout (when VCS exists; else copy the tree to a fresh temp dir as the cold start) → `npm run setup` (wall time counted through seed/login; lint/typecheck/test recorded separately) → `npm run dev` → logged-in planner; record wall time (env noted, single n=1 run) against the 2–5 min TTHW target; misses → fix before close**.

## 5. Sequence

```
Kickoff → P1 ✅ → P1.5 (withTransaction + dep cleanup) → P2 ✅ → P3 → P4 → (P5 when prereqs green)
                                  └── [CEO C1 USER CHALLENGE → autoplan Phase 4 approval gate (pre-execution)] git init + remote + baseline commit (prereq for T8 CI); user rule "no commits unless asked" stands until approved ──┘
                                  └── NOTE: P2 shipped BEFORE P1.5 — the 5 spec-atomic sites are non-atomic in shipped code until T1 lands; run T1 before any import execute ──┘
                                  └── UAT: P2 retro-log via T10 (both rows at P4), full §14 at P4 ──┘
```

## NOT in scope

- **P5 integrations** (DPD, Xero, notifications, dashboards) — gated on schema stability + external prereqs (plan line 57).
- **Real-data import execution** — no data exists (OI-8); `analyze-backup.mjs` procedure runs when data arrives, P3 screen unchanged.
- **Excel-shaped imports** — import accepts JSON only (shape A–D per `05 §1`); XLSX parse not required by any rule.
- **`modules/` directory refactor** — as-built layout (`lib/services/`) kept; no speculative restructure [1A].
- **Auth.js/next-auth adoption** — hand-rolled sessions proven by 195 tests; dep removed [8A].
- **pg-boss/outbox** — P5 only [8A].
- **Docker-based local DB** — Homebrew PG 18.4 works; compose reconciliation deferred to TODOS.

- **UI visual polish beyond the UI Design Contract** — states/copy/placement/tokens are contracted (Phase 2); fine-grained pixels, motion, illustration stay out until production UX pass.
- **Full design system (DESIGN.md)** — deferred to TODOS.md (Q8.1: /design-consultation session before production UX work).
- **AI-generated mockups for import wizard** — deferred to TODOS.md (Q8.2: designer key 401'd; backfill when valid key available; text contract gates T4, visuals don't).
- **Readiness cache invalidation via DB triggers** — app-level `updateReadinessCache` pattern retained (as-built convention).
- **Export file storage/persistence** — exports stream and discard; no export history table (deviates from spec L422 pg-boss→MinIO signed-URL design — accepted Step-0 streaming decision; spec update pending).
- **MinIO/S3 for uploaded import files** — MVP stores originals on local disk (`storage/uploads/`, E5); object-store migration checkpoint in `TODOS.md` when multi-instance hosting appears.
- **Operator demo at P3 close (C5)** — deferred to TODOS.md: needs staff time; owner schedules (CEO 3.3 adoption loop).
- **Rule-ID/review-date tagging + rule audit at first real import (C6)** — deferred to TODOS.md: provenance hygiene, not a blocker.
- **Adoption/success metric definition (C7)** — deferred to TODOS.md: metric is user-defined.
- **Build-vs-buy kill-criterion / revisit checkpoint (CEO C9)** — deferred to TODOS.md: objective kill triggers recorded now; **review at P3 close, before P5 integrations** (native R5 amendment).
- **Runtime-tunable knobs / config system** — DX D18: limits stay fixed by design (25MB cap, typed-confirm ≥50, 200-row preview, 15s test timeout, dev TOTP); declared explicitly in the DX Contract knob table — no env/query overrides added.
- **Devcontainer / machine provisioning in setup path** — DX D5: TTHW measured from `npm install` with prereqs (Node, PG) assumed present; full provisioning = Champion tier, declined.
- **Generated API reference / docs site** — DX D15: README endpoint table is the contract (routes frozen post-T5); static-site toolchain out of scope for an internal tool.

## What already exists (reused, not rebuilt)

- **`lib/services/*`** (8 domains, 26 exports) — P3 import writes through existing job/stock/swatch services where possible (e.g. `updateReadinessCache`, `refreshJobStatus`, `audit()`); does not reimplement readiness/stage logic.
- **`lib/http.ts` `err`/`toResponse`/`requirePermission`/`requireAdminOrOps`** — all new routes (import, export) reuse; 409 `current` merge already implemented.
- **Probe harness** (`tests/probe-p2.test.ts` `assertClasses`) — E6 import probe [5A] and export role matrix [15A] extend the same pattern with one `X-Forwarded-For` per request.
- **`import_batches` + `files` tables** (migration 0000) — P3 adds only `version` column [3A]; status enum already covers pipeline.
- **Fixtures contract** (`05 §1–§4` + `06 migrateState` rules) — validation logic is specified, not invented.
- **Rule register 01 as test backlog** — E/M/L rule IDs map 1:1 to test files; DoD split [11A] matches phase → code → test.
- **`analyze-backup.mjs`** — real-data-late procedure already scripted (plan line 71).
- **Stock/audit append-only RLS** (`db/security/003`) — import inserts go through same app role grants.
- **Design vocabulary (as-built, reused by UI Design Contract)** — Tailwind + zinc palette, light/dark via `prefers-color-scheme`, header nav (`nav.tsx`, permission-gated link pattern), page shell `space-y-6`, bordered `rounded-lg` table cards with empty-state rows (`jobs/page.tsx`), `err`/`toResponse` error surfaces.

## Failure modes (new codepaths)

| Codepath | Realistic production failure | Test? | Error handling? | User sees? |
|---|---|---|---|---|
| Import execute | Mid-batch SQL error → partial rows committed, batch stuck `confirmed` | [13A] failure-injection test | [7A] `withTransaction` rollback → `failed` | Batch row + `errors[]` |
| Import confirm race | Double-click/race → batch executed twice, duplicated jobs | [3A] double-confirm 409 test | CAS on `version`+`status` | 409 + current batch |
| Import upload | 30MB dump → OOM/truncation → parse-garbage masquerading as validation error | [4A] 413 test + truncation spike | Early size check | Clear 413 |
| Import → storage | Original file not persisted (no backend) → `files` row points at nothing; E5 passes vacuously | T4 persistence test (file readable from `storage/uploads/` pre-execute and post-execute; rollback-order test) | Write-through at Upload (disk before tx); execute flips batch state only; fail → batch failed; orphan sweep + quota → TODOS | Batch row failed + message |
| Import → queue | Imported jobs have NULL `readiness_cache` → wrong gate colour in queue | [17A] FX-5 colour assert | Rebuild in execute | Correct colour |
| Export | Unknown/typo view silently falls through to default view → wrong data exposed | [15A] unknown-view 4xx test | Strict enum validation | 4xx |
| Export | Cost columns leak to Office/Dispatch/dept (M4 violation) | [15A] parse-based workbook assert (exceljs re-read) | Write-time column selection | — (prevented) |
| Export | Per-row `getJob` fan-out → 6.5k queries, request timeout at 500 jobs | [16A] row-count/completion test | Single-query mandate | Slow/failed download |
| withTransaction refactor | Behaviour drift in 5 wrapped sites (e.g. lost audit row) | 195 existing tests + new rollback test | ROLLBACK on throw | — (caught locally; CI once CEO C1 approved [2A]) |
| CI | No repo/remote exists — workflow cannot run at all (CEO 2.1 / C1) | — | **CEO C1 gate: git init + remote before T8** | Workflow absent until CEO C1 approved |
| CI | Local-green/CI-red (PG version/env mismatch) | — | postgres service block in workflow | Red badge instead of silent merge |

**Critical gaps:** 0 in this table — every row has both a test and error handling; structural risks live in the Phase-1 Review record (CEO C1 gate pending; adoption/ops items in `TODOS.md`).

## Worktree parallelization

No git repo yet — lanes are sequencing guidance for when version control lands (or for parallel sessions):

| Step | Modules touched | Depends on |
|------|----------------|------------|
| T1 withTransaction | `lib/db.ts`, `lib/services/*` | — |
| T8 CI | `.github/` | CEO C1 (repo+remote — autoplan Phase 4 gate) |
| T7 dep cleanup | `package.json` | — |
| T2/T3/T4/T5/T6 import | `lib/services/import`, `app/api/admin/import`, `fixtures/`, `tests/` | T1 (execute uses tx) |
| T9/T10 export + uat | `app/api/exports`, `lib/services/export`, `tests/` | — (parallel to P3) |

- **Lane A:** T7 alone (tiny); T8 parked until CEO C1 approved (repo exists) · **Lane B:** T1 (touches lib/services — serialize with nothing else) · **Lane C:** P3 import suite after T1 · **Lane D:** P4 export suite (shares only `tests/` naming — parallel to C, no T1 dependency).
- **Conflict flags:** T1 and P3 both touch `lib/services/` — run T1 first, not concurrent. Lanes C and D both add `tests/*.test.ts` — distinct files, low risk. T9 (export) reads live P2 data only — no import-data dependency, may start at P3 entry for early value (outside F12).

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.
  Priority tags: **P1** blocks ship · **P2** same branch · **P3** follow-up/TODO — priorities, not phase numbers (execution order: **T12 gate FIRST at the autoplan Phase 4 approval gate**, then T1→P1.5; T3→T4 [T2 lands with T4], T5, T6, T7→P3; T9 may start at P3 entry — no data dependency; T10, T13→P4; DX round 2: T21→T20 before T4 (freeze [13A] string literals first), T16/T17/T18 before the first D19 timed run at P4 close, T19 anytime, T14 pre-P4).

- [ ] **T1 (P1, human: ~3h / CC: ~30min)** — db/lib — Add `withTransaction` + **ambient transaction client in `query()`** (`query()` hardwires `pool.query`; use AsyncLocalStorage context so services/audit/readiness called inside `fn` run on the tx client, not a different session) and wrap 5 spec-atomic sites + failure-injection test
  - Surfaced by: Code quality — spec line 406 atomicity vs `lib/db.ts` query()-only multi-writes (stock.ts:45/266/271 etc.); outside F1 (mechanism unstated → [17A] rebuild would read outside the tx)
  - Files: `lib/db.ts`, `lib/services/{stock,stages,swatch,dispatch,artwork}.ts`, `db/schema/audit.ts` (audit writes inside tx)
  - Verify: `npm test` (195 green) + rollback test + same-session assertion: batch execute's audit row + `updateReadinessCache` observe uncommitted tx state + ALS-detached helper called outside `fn` documents fallback (no silent phantom reads) [A4]
- [ ] **T2 (P1, human: ~1h / CC: ~10min)** — db — Add `import_batches.version` + CAS guard on confirm/execute (version bumps on re-upload/re-preview — a content change — so a stale preview cannot execute)
  - Surfaced by: Architecture — spec line 405 per-sub-entity version missing (`db/schema/audit.ts:38-49`); outside F9 (semantics undefined)
  - Files: `db/migrations/`, `db/schema/audit.ts`, `lib/services/import.ts` (created by T4 — land the guard with T4)
  - Verify: double-confirm 409 test; re-preview → stale-confirm 409 test (exercises a real version bump); state-machine matrix discard→resume→confirm + resume→stale-confirm → 409 [T5]
- [ ] **T3 (P1, human: ~2h / CC: ~30min)** — fixtures — Build `fixtures/generate.mjs` FX-1…11
  - Surfaced by: Plan P3 bullet; `phase0/05 §4` inventory
  - Files: `fixtures/generate.mjs`
  - Verify: `node fixtures/generate.mjs` emits 11 valid files
- [ ] **T4 (P1, human: ~1d / CC: ~3h)** — import — Import pipeline (service+route+UI) per **UI Design Contract (Phase 2)**: atomic execute (single-flight per user via pg advisory lock; `SET LOCAL statement_timeout` inside the execute tx — pool `max: 10` + long txs would otherwise head-of-line block every route), readiness rebuild, audit+batch row, **original-file persistence — write-through at Upload (write file → `files` row → Parse; execute only flips batch state; disk write ordered before tx commit — tx fail keeps the original per E5, post-commit file-missing asserted by test; file readable pre-execute; local disk, non-web-served; `files.bucket='local'` + relative key) [E5]**, screen anatomy + stepper + batch history (Resume/Discard) + state-table copy + typed confirm (≥50 rows OR warn, count-back) + issues-first preview (≤200 rows) + severity tokens + a11y/responsive rules
  - Surfaced by: Architecture 6A diagram/failure lines; Performance 17A readiness cache; design F1–F11, F15–F16 (Q1.1/Q2.1/Q2.2/Q7.1–Q7.3)
  - Files: `lib/services/import.ts`, `app/api/admin/import/route.ts`, `app/(app)/admin/import/page.tsx`, `app/(app)/nav.tsx`, `storage/uploads/`, `db/schema/audit.ts` + migration (parsed-row persistence [A2]), authorized GET route for original file + error CSV (CSV writer neutralizes leading `=`/`+`/`-`/`@` [S2])
  - Verify: `npm test` — E3/E5/E6 rows + readiness colours + uploaded file readable from `storage/uploads/` pre-execute and post-execute + [13A] confirm-with-errors row + over-cap (50,001 rows) → 4xx [X1] + wrong typed count → 4xx [H2] + path-traversal: `files` key `../../etc/passwd` → 404, DB-key-only lookup [S4] + CSV formula-injection fixture `=cmd|'/c calc'!A0` round-trips inert [S2] + keyboard/emulated-viewport pass over wizard
- [ ] **T5 (P1, human: ~30min / CC: ~15min)** — import — Upload 25MB cap → 413 + truncation spike test
  - Surfaced by: Architecture — spec line 510; Next 16 proxy footgun (conf 7/10)
  - Files: import route, `next.config.ts` (only if spike reproduces), `tests/rules-e.test.ts`
  - Verify: 26MB file → 413 (Content-Length path) + chunked 26MB body → 413 (streaming guard — header check alone skips chunked) [X3]
- [ ] **T6 (P1, human: ~30min / CC: ~10min)** — import — E6 permission probe (admin/ops 200; others 403; anon 401)
  - Surfaced by: Architecture 5A — plan said Admin-only vs register E6
  - Files: `tests/rules-e.test.ts`
  - Verify: `npm test`
- [ ] **T7 (P2, human: ~10min / CC: ~5min)** — deps — Uninstall `next-auth` + `pg-boss`
  - Surfaced by: Code quality — zero source usage; pg-boss returns at P5
  - Files: `package.json`
  - Verify: `npm ls next-auth pg-boss` empty; `npm test` green
- [ ] **T8 (P1, human: ~30min / CC: ~10min)** — ci — Add `.github/workflows/ci.yml` (lint + typecheck + test, postgres 18 service + bootstrap: `db:migrate` + `db:security` + `db:seed` with `DATABASE_URL` — without these the first run is red regardless of CEO C1)
  - Surfaced by: Architecture — P1 promised CI (plan line 26), none exists
  - Blocked on CEO C1 (git repo + remote; autoplan Phase 4 approval gate, pre-execution) — conditional until approved
  - Files: `.github/workflows/ci.yml`
  - Verify: `ci.yml` valid; lint/typecheck/test commands run green locally; first workflow run deferred until C1 exists
- [ ] **T9 (P1, human: ~1d / CC: ~3h)** — export — Generic `/api/exports/[view]`: 9-view enum, ExcelJS, single-query-per-view, M4 write-time stripping, **buffer-then-send (Q7.4: full workbook in memory before headers — no truncated downloads; [CEO C4] spike peak RSS = ceiling evidence) + row-cap guard: ≥100,000 rows → abort before buffer blowup → non-2xx → inline banner (D18 knob row; final number validated by the C4 spike) [A3]** (first step **[CEO C4]**: 60-min ExcelJS spike — 10k-row workbook with styling + the M4 column-strip running on the production writer path, record peak RSS + wall time)
  - Surfaced by: Step-0 decision; Issues 9A/16A; ExcelJS decision
  - Files: `app/api/exports/[view]/route.ts`, `lib/services/export.ts`
  - Verify: `npm test` — export matrix + unknown-view 4xx + `tests/rules-m.test.ts` (M1–M3 cost-gate rows; M4 via parse-based workbook assert)
- [ ] **T10 (P2, human: ~2h / CC: ~30min)** — uat — `tests/uat.test.ts` (spec §14) + tracker P2 §14 retro-log row
  - Surfaced by: Tests 12A — P2 checkpoint never logged
  - Files: `tests/uat.test.ts`, `docs/phase0/08-open-items-tracker.md`
  - Verify: `npm test`
- [x] **T11 (P3, human: ~20min / CC: ~10min)** — todo — Create/extend `TODOS.md` with eight entries: dev-DB drift (compose unused vs Homebrew vs CI postgres:18), legacy data acquisition owner+deadline [D12, P0], operator demo at P3 close [C5], rule tagging + first-real-import audit [C6], adoption/success metric [C7], build-vs-buy revisit checkpoint [C9, review at P3 close], cutover plan [native R4], prod-ops runbook [native R11]
  - Surfaced by: TODO candidate 1 (approved A) + CEO D5–D7, D9, D12 + native R4/R11
  - Files: `TODOS.md`
  - Verify: file exists, format matches gstack `review/TODOS-format.md` (`~/.claude/skills/gstack/review/`), all eight entries present — done 2026-10-01 in Phase 1
- [ ] **T12 (P1, human: ~5min / CC: ~2min)** — gate — Surface the CEO C1 decision at the autoplan Phase 4 approval gate **before execution starts (runs FIRST of T1–T12)**, three options: **A** full C1 (git init + remote + baseline commit + branch protection), **B** local-only baseline commit (no remote — strictly smaller ask, still needs your permission), **C** no git (T8/CI deferred; T12 appends a TODOS entry); approved → unblocks T8
  - Surfaced by: CEO Step 0 D1/C1 (User Challenge — never auto-decided) + native R1 (local-git middle option) + outside F7 (gate ran last)
  - Files: `docs/superpowers/plans/2026-09-30-fanela-implementation-plan.md` (Review record) + `TODOS.md` if rejected/C
  - Verify: autoplan Phase 4 gate output names the CEO C1 decision and the chosen option explicitly; if rejected/C, TODOS.md carries the CI deferral

- [ ] **T13 (P2, human: ~1h / CC: ~15min)** — security — Auth security checklist in two gates: **P3-close subset (hard — first stateful admin write ships with P3): CSRF strategy on stateful handlers + upload endpoint authz + upload rate limit** (as-built mitigations verified: SameSite=Lax + HttpOnly, but no origin check/token yet); **pre-P4 remainder: cookie flags (Secure), session fixation/rotation, full rate-limit posture**; record per-item pass/fail in the Review record, failures → tickets
  - Surfaced by: Native CEO R6 — 195 tests prove behavior, not security
  - Files: `lib/auth.ts`, `lib/http.ts`, `app/api/admin/import/route.ts`, `tests/`
  - Verify: checklist completed pre-P4 with per-item result; any FAIL fixed or ticketed
- [ ] **T14 (P2, human: ~5min / CC: ~2min)** — design — Fix `app/globals.css:25` body font: use declared Geist vars (`--font-geist-sans`) or DM Sans; remove `Arial, Helvetica, sans-serif`
  - Surfaced by: Design review Pass 4 (universal rule — default font stack as body font) + Q4.1 decision
  - Files: `app/globals.css`
  - Verify: computed body font-family ≠ Arial; `npm run lint` + typecheck green
- [ ] **T15 (P1, human: ~2h / CC: ~30min)** — design/export — Export dropdown UI: header component on jobs/customers pages, 9 human-labelled views filtered by [15A] role matrix, carries current `?q=` for `filtered-jobs`, filename `view-YYYY-MM-DD.xlsx`, disabled + "Preparing…" while in flight, inline error banner on non-2xx (per UI Design Contract)
  - Surfaced by: Design Pass 1 F12 (Q1.2) + Pass 2 export states (Q2.2)
  - Files: `app/(app)/jobs/page.tsx`, `app/(app)/customers/page.tsx`, new `app/(app)/export-menu.tsx`
  - Verify: manual — dropdown lists only permitted views; filtered-jobs carries query; keyboard-navigable; `npm test` [15A] matrix still green
- [ ] **T16 (P1, human: ~2.5h / CC: ~40min)** — docs — Create `README.md`: quickstart (prereqs incl. PostgreSQL → install → `createdb fanela` + PG role/auth note → `.env` ← `.env.example` → `npm run setup` → `npm run dev` → http://localhost:3000, ≤7 commands), script table (every script, incl. `db:security` = applies RLS/grants via `db/migrate-all.sh` — note the name mismatch: script says migrate-all, step is security — success signal + failure first-check), first-login block (dev admin `admin@fanela.local` / `ChangeMe123!` + dev TOTP `JBSWY3DPEHPK3PXP` + recovery codes note — dev-only, override via `SEED_ADMIN_*`), reset-dev-MFA block (`UPDATE users SET totp_secret=NULL, recovery_codes=NULL WHERE email=…` → re-run `db:seed` re-arms via `db/seed.mts:54` first-run branch), compose note (unused — Homebrew PG 18.4 is source of truth; drift item in TODOS) + header comment in `docker-compose.yml` marking it unused, API endpoint table + one curl per family (auth/jobs/import chain upload→preview→confirm→execute/export) + `{error, code}` envelope + **error-code section** (every code value from `lib/errors.ts`, grouped by class 413/F9/409/500 — the README anchors for the Error & Rescue Registry) + >25MB legacy-dump procedure (record size in D12 `analyze-backup.mjs`; split/re-export source to ≤25MB — cap fixed by design) + known-limit line (no error→skip downgrade in preview — edit source rows and re-upload) + docs map (one line per `docs/` file), TTHW target line (2–5 min cold start)
  - Surfaced by: DX review D5/D6/D8/D9/D15/D16/D20 (plan-devex-review Phase 2.5)
  - Files: `README.md`
  - Verify: fresh-clone walkthrough top-to-bottom; every command copy-pastes clean; no step requires opening a second file
- [ ] **T17 (P2, human: ~20min / CC: ~5min)** — env — Create `.env.example` with the actual runtime contract: `DATABASE_URL` (required), `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (optional, dev defaults), `APP_DATABASE_URL` (optional — test-only app-role override, defaults to fanela_app TCP URL per `tests/db-security.test.ts:8`); README env table mirrors it and notes `AUTH_SECRET` in existing `.env` is vestigial (sessions are DB-backed — nothing reads it)
  - Surfaced by: DX D5 + native DX7 (undocumented second var)
  - Files: `.env.example`, `README.md`
  - Verify: `cp .env.example .env`, fill `DATABASE_URL` → all scripts run; grep of app source shows no undeclared `process.env.*` var (except `NODE_ENV`)
- [ ] **T18 (P2, human: ~15min / CC: ~5min)** — scripts — Add `npm run setup`: `db:migrate` → `db:security` → `db:seed` → lint → typecheck → test (the D6 golden path; timing source for the D19 acceptance line); D19 timing rule: wall time counted through `db:seed` completion (login reachable), lint/typecheck/test phase recorded separately — suite runtime is not part of the 2–5 min TTHW target
  - Surfaced by: DX D6 (magical moment = one command)
  - Files: `package.json`
  - Verify: `npm run setup` on prepared env exits 0; wall time recorded against the 2–5 min target
- [ ] **T19 (P2, human: ~30min / CC: ~10min)** — docs/agent — Extend `CLAUDE.md` with a **Conventions** block: add-an-endpoint recipe (`requirePermission`/`requireAdminOrOps` → service fn in `lib/services/` → `err(status, message, code)` → probe test via `assertClasses` pattern), error-contract pointer, test-bootstrap note (live PG required); plus a one-line `AGENTS.md` pointer to that block (the Codex half of the pair reads AGENTS.md, not CLAUDE.md)
  - Surfaced by: DX D10 (conventions live only in code today)
  - Files: `CLAUDE.md`
  - Verify: block present; recipe steps reference real files; existing skill-routing section untouched
- [ ] **T20 (P1, human: ~1h / CC: ~20min)** — http — Error contract upgrade in `lib/http.ts`: `err(status, message, code?)` and `toResponse` emit `{error, code}` on every response (runtime default `internal_error` when no code passed; type stays optional for back-compat with D13); dev-mode 500 detail (`NODE_ENV === "development"` only → include `e.message` — unset NODE_ENV must NOT leak SQL fragments/paths; production stays `Unexpected server error.` byte-identical); regression tests for code passthrough + default-code fill + dev/prod/unset 500 body split
  - Surfaced by: DX D13 (machine-readable codes) + D11 (dev-mode 500 detail)
  - Files: `lib/http.ts`, `tests/http-errors.test.ts`
  - Verify: 195 existing green + new rows; prod 500 path unchanged
- [ ] **T21 (P1, human: ~1.5h / CC: ~30min)** — errors — Extract frozen error strings to `lib/errors.ts` constants (F9 shape, 413 size, 422 batch, generic 500, 401/403 texts) **and define the full machine-readable code taxonomy there** (one exported code constant per failure, snake_case — e.g. `import_shape_invalid`, `file_too_large`, `stale_batch`, `internal_error`; required set = every code reachable from `err()`); `[13A]` tests import the constants; README error-code section (T16) lists every code; T20 tests assert every emitted code is in the exported set; Error & Rescue Registry + UI Design Contract cite constant names; closes the plan's own "reword BEFORE [13A] freezes" TODO by construction (runs before T4)
  - Surfaced by: DX D17 (triple-copy drift doc/code/tests)
  - Files: `lib/errors.ts`, route handlers, `tests/rules-e.test.ts`, plan UI Design Contract wording
  - Verify: single definition per frozen string (grep shows no duplicate literals); 195 green

## Dream state delta

What changes for Fanela Central when this plan lands (vs today: 195 tests, no import/export):

- **Ops:** legacy job data lands via an Admin/Ops-only import screen (upload → preview → typed confirm → atomic execute, reconciliation Δ=0) instead of manual re-entry — once a legacy file arrives (CEO C2 gate; acquisition tracked P0 in TODOS).
- **Anyone with export permission:** one generic `/api/exports/[view]` route serves all nine business views as .xlsx with role-scoped columns (M4 cost-gating enforced at write time).
- **Queue:** imported jobs appear with correct readiness colours (in-tx rebuild [17A]) and audit rows.
- **Unchanged by this plan:** dashboards, notifications, DPD/Xero (P5); production UX design (pipeline Phase 2); live-data validation (external dependency — TODOS P0).

## Error & Rescue Registry

Implementation-ready; Phase 3 re-verifies every row. **Fix / doc anchor column added by DX D14 — every row answers "what does the operator do next":** operator-facing anchors (413/F9/409/500 classes) resolve to README sections written by T16.

| Method / operation | What can go wrong | Failure class | Rescued? | Rescue action | User sees | Fix / doc anchor |
|---|---|---|---|---|---|---|
| `ImportService#upload` | >25MB body, proxy-truncated body | size/truncation | yes | early check → 413; truncation spike guards Next 16 proxy | `413 file too large` | Shrink file (25MB cap fixed by design — knob table); retry |
| `ImportService#upload` | disk write fails (space/permissions) | `StorageWriteError` (E5) | yes | batch → `failed`, no `files` row committed | batch row failed + message | Check free space + `storage/uploads/` writability; re-upload |
| `ImportService#parse` | malformed JSON, unknown shape | `ShapeError` (F9) | yes | 4xx + exact message string | validation error text | Re-export as shapes A–D (`phase0/05 §1`); message = `lib/errors.ts` constant [T21] |
| `ImportService#validate` | row-level contract violations | severity classes per `05 §2` | yes | preview flags rows; error rows block confirm | preview table with severities | Severity legend in preview; fix source rows per `05 §2` |
| `ImportService#confirm` | stale batch (re-previewed or already executed) | CAS miss on `version`+`status` | yes | 409 + `current` payload | 409 conflict, reload prompt | Reload latest batch; stale preview discarded by design (T2) |
| `ImportService#execute` | mid-batch SQL error | `SqlError` inside `withTransaction` | yes | ROLLBACK → batch `failed` + `errors[]` | batch row failed + errors | Read `errors[]` on batch row; fix data; re-upload — no partial state exists |
| `execute` → `updateReadinessCache` | cache write on a different session → invisible/lost | tx-session mismatch (outside F1) | yes | ambient tx client (T1) — same session | correct colours | T1 ambient client; if colours still stale, re-run readiness rebuild |
| `execute` → file persist | original missing at execute (never written at Upload) / post-commit file vanished | `StorageWriteError` (E5) | yes | write-through at Upload (disk before tx, H1 order); tx fail keeps the file; execute asserts file exists | batch failed | Check `storage/uploads/` permissions; original file never deleted |
| `ExportService#writeView` | unknown/typo view | `ViewError` | yes | strict enum → 4xx | 4xx message | View names listed in README endpoint table [T16] |
| `ExportService#query` | per-row fan-out / row explosion | query-count guard [16A] | yes | single-query mandate + row-count test | slow/failed download caught in test | `npm test` fails first — fix query before users see it |
| `withTransaction` | throw inside `fn` | any | yes | ROLLBACK + re-raise | — (state unchanged) | Dev: 500 body carries message (D11); prod: server console |
| auth probes | anon / wrong-role access | `requirePermission` | yes | as-built 401/403 | 401/403 | Sign in / check role grants; probe test T6 shows allow/deny classes |
| Login / MFA | bad TOTP, wrong password, rate-limit lockout, session expired mid-import | auth failure / 401 | yes | login form errors + rate limiter; session expiry → redirect to login; import batch keeps CAS state so a re-login + Resume resumes safely | login error text; 401 mid-import | README first-login block + reset-MFA SQL [D20/T16]; wait out rate limit; re-open batch row → Resume |
| File GET (original / error CSV) | missing file on disk, wrong role, bad path key | 404 / 403 / path guard | yes | authenticated route only; DB-key-only lookup (client path never joined — traversal test `../../etc/passwd` → 404); role check before read | 404 `File not found` / 403 | Check `storage/uploads/` (E5) — original never deleted; re-download from batch row |
| Export write | workbook exceeds RSS ceiling (CEO C4 spike) / request timeout | OOM / timeout | partial | spike records the ceiling before build; buffer-then-send guarantees clean failure, never a truncated file | non-2xx → inline banner near dropdown (state table) | Narrow the view (filtered-jobs + filters); ceiling evidence in the C4 spike record; server console |

## Scope Expansion Decisions

- **Accepted (in blast radius, auto-decided):** CEO C2/C3/C4 gates; T13 security checklist; E5 local-disk storage; ambient tx client; contract-faithful [13A]/[15A] tests; T12-first ordering; deepened C4 spike — full list in the accepted obligations block (Review record).
- **Deferred to `TODOS.md` (8 entries written 2026-10-01):** C5 demo, C6 tagging, C7 metric, C9 build-vs-buy (review at P3 close), D12 data acquisition (P0), cutover plan, prod-ops runbook, dev-DB drift.
- **Skipped:** C8 dashboard (duplicate of P5 scope); UI/UX polish (pipeline Phase 2 owns it).
- **User challenge (resolved at the Phase 4 gate, 2026-10-02):** CEO C1 git baseline → user chose **A** (full C1: git init + remote + baseline commit + branch protection). Repo setup never ran during review — no commits made; standing rule held through all phases.
- Narrative: `ceo-plans/2026-10-01-fanela-central-import-export.md`.

## Diagrams

```text
System architecture (as-built + this plan)
Browser ──► Next.js App Router (app/)
             ├─ route handlers  app/api/{jobs,customers,exports,admin/import}/*
             │    ├─ lib/http.ts  (requirePermission / requireAdminOrOps, err/toResponse)
             │    └─ lib/auth.ts  (session cookies, Argon2id, TOTP pending_mfa)
             ├─ lib/services/<domain> ── query() / withTransaction (ambient tx client) ──► PostgreSQL 18
             │    import + export orchestrate Drizzle; RLS via db/security/*.sql
             ├─ fixtures/generate.mjs (FX-1…11, P3)
             ├─ storage/uploads/ (E5 originals, local disk, non-web-served)
             └─ ExcelJS writer (.xlsx out, one SQL statement per view)
```

- **Data flow + error flow:** P3 pipeline diagram (§ P3: upload → … → result; failure → rollback + batch `failed`) — accurate post-17A.
- **State machine:** `import_batches.status` enum + CAS `version` guard (§ P3 [3A]) — accurate.
- **Rollback flow:** `withTransaction` BEGIN/COMMIT/ROLLBACK + ambient tx client (§ P1.5 + T1) — accurate.
- **Sequence:** § 5 fence (P2-before-P1.5 note, CEO C1 gate, UAT via T10) — accurate.

### Stale diagram audit (2026-10-01)

| Diagram | Touched in round 4? | Verdict |
|---|---|---|
| System architecture (above) | new | fresh |
| P3 pipeline | no (already in-tx wording) | fresh |
| Sequence fence | no | fresh |
| Failure table + critical-gaps line | reworded | fresh |
| TODOS items | 8 entries written | fresh |

## UI Design Contract (Phase 2 — plan-design-review, 9 decisions approved 2026-10-01)

Interaction contract for T4/T15 — pixel polish stays out (NOT in scope); states, copy, placement, tokens are in contract. Sources: in-host design review F1–F20 [subagent-only] + primary passes 1–7.

### Screen anatomy — `/admin/import` (Q1.1)

```text
┌ Header: "Import legacy data" + Admin/Ops badge ─────────────┐
│ Stepper: [1 Upload] → [2 Preview] → [3 Confirm] → [4 Result] │
│ ── primary step zone (below; only current step renders) ──   │
│ Batch history: newest-first table (bottom, persistent)       │
└──────────────────────────────────────────────────────────────┘
```
- Nav: add Import link to `app/(app)/nav.tsx` iff same permission class as E6 (mirror customers link pattern, nav.tsx:24); Export lives inside consuming pages (Q1.2), not nav.
- Page gate: non-admin/ops visiting `/admin/import` → redirect to `/jobs` (matches probe classes; no dead 403 page).
- Stage→step mapping: Parse+Validate = async work behind Preview spinner; F9/413 = error rendered ON Upload step (stay step 1); Execute = button → Result step in same view; Audit = never surfaced.
- Batch history columns: `file · uploaded · by · status · create/skip/error/warn · actions`; status→label+token (pending/parsed, confirmed, executed, failed); actions: Resume (confirmed), View errors (failed), View result (executed); empty state "No imports yet. Upload a legacy JSON export to start."; all Admin/Ops see all batches; newest-first.
- Persistence (Q7.3): batch `status` = source of truth; page loads latest non-terminal batch on mount; reload restores step from status; abandoned confirmed batch → Resume/Discard in history (Discard = status change, no writes); no TTL reaper for MVP.

### Export UI — T15 (Q1.2)

- `Export` dropdown in page headers (jobs, customers): items = 9 views with human labels, filtered by same role matrix as [15A]; `filtered-jobs` carries current `?q=`/filters live; filename `jobs-2026-10-01.xlsx` pattern; button disabled + "Preparing…" while request in flight; 0-row result → allow download (empty workbook valid).
- Buffer-then-send (Q7.4): workbook fully rendered in memory before response headers; truncated-download failure eliminated; [CEO C4] spike peak RSS is the memory ceiling evidence.

### Preview scale (Q2.1)

- Summary chips row first (create/skip/error/warn counts, clickable to filter); default view = rows with issues only; "show creates" toggle; server-side pagination 100/page; hard cap 200 rendered rows.
- Columns: `severity · job_number · customer · issues · disposition`; row click expands detail.

### Interaction state table (Q2.2)

| FEATURE | LOADING | EMPTY | ERROR | SUCCESS | PARTIAL |
|---|---|---|---|---|---|
| Upload | progress bar + input disabled | dropzone: "Drop your legacy JSON export (shapes A–D). JSON only, up to 25 MB." + `accept=".json,application/json"` | inline red banner above dropzone (413 exact copy; F9 exact copy with working help target — render `phase0/05` help or reword BEFORE [13A] freezes string), input reset | filename + size chip, advance to Preview | — |
| Preview | skeleton table + aria-live "Validating N rows…" | (n/a — empty upload precedes) | severity rows inline (existing); parser-level failure → banner on Upload | summary chips + table; reassurance footer (below) | warn/info badges listed, non-blocking |
| Confirm | — | — | 409 → banner "This import changed in another tab — reload" + Reload button (real, per Q7.3) | executes → Result | counts restated: "Import 480, skip 20 errored?" |
| Execute | button disabled + label "Importing…" (optimistic disable on click; CAS backstop) | — | failed → top-of-page banner + auto-expanded batch row, `errors[]` first 50 + count | Result step | non-error rows committed, errored rows zero-written (Q7.1) |
| Result | — | — | (fail state = Execute error) | counts card + reconciliation table (Δ) + error-list CSV download + "View N imported jobs → /jobs" link | created≠expected → highlighted Δ row |
| Export | button disabled "Preparing…" | 0-row → download valid empty workbook | non-2xx → inline banner near dropdown, no file | browser download (buffered-complete) | — |
- Cancel: "Discard import" text button on every pre-Execute step (status change → empty Upload); Execute irreversible once fired.
- Original file + error CSV: authenticated download route required (E5 file is non-web-served — add authorized GET to T4 Files).

### Reassurance arc (Q3.1) — mandated copy

1. Preview footer: "Nothing is written until you confirm. Swatch approvals, shipments, photos and audit history are never imported (E4)."
2. Confirm panel: restated counts (create/skip/error/warn) + what import won't do (E4 line).
3. Execute failure: top-of-page banner (not list-only).
4. Result: direct link to `/jobs` to verify readiness colours.

### Journey storyboard (Pass 3 artifact)

| STEP | USER DOES | USER FEELS | PLAN SPECIFIES? |
|---|---|---|---|
| 1 Upload | drags legacy dump | apprehensive (prod write from one file) | accept filter, size hint, 25MB cap |
| 2 Preview | scans chips, filters issues | cautious relief (sees problems first) | issues-first default, severity tokens |
| 3 Confirm | types row count (≥50 or warn) | peak anxiety | counts restated, E4 scope, typed gate |
| 4 Execute | watches disabled button | tense trust (nothing to do) | aria-live, CAS, banner on fail |
| 5 Result | reads Δ, clicks → /jobs | relief + verification | counts, reconciliation, jobs link |
| alt Fail | expands errors[] | panic → control | top banner, error CSV, Resume/Discard |

### Tokens & typography (Q4.1, Q5.1)

- Severity palette: `error=red-600`, `warn=amber-600`, `skip=zinc-500`, `create=zinc-700` (+check icon), `info=blue-600`; **green forbidden** (reserved readiness White/Amber/Green); every badge ships `dark:` variant.
- Body font: fix `globals.css:25` — use declared Geist vars (`--font-geist-sans`) or DM Sans; remove `Arial, Helvetica, sans-serif` (T14).
- All new components follow as-built vocabulary: zinc + `border` + `rounded-md/rounded-lg`, utility copy.

### Responsive & accessibility (Q6.1)

- `<md`: stepper stacks vertical; preview table → card rows per record (severity chip + job_number + issues); touch targets ≥44px.
- a11y: severity conveyed by icon + text (never color alone); `aria-live="polite"` for parse/execute progress; keyboard path through stepper (tab order = step order); focus rings themed from palette; contrast ≥4.5:1 body.

### Blocking + confirm decisions (Q7.1, Q7.2)

- Q7.1: error rows block **those rows only**; confirm allowed with counts restated; aligned with `phase0/05 §2`. **[13A] new row:** confirm with N error rows → executes rows minus errored, errored count in result, zero error-row writes.
- Q7.2: typed confirm when **≥50 rows OR any warn present**; token = previewed create-count typed back (e.g. `480`); placement = confirm-step panel above input showing counts; smaller/clean sets = plain Confirm button. **Server-side enforcement (not UI-only):** execute recomputes the create count inside the tx and requires `typedCount` === recomputed count → mismatch = 4xx (client-bypass backstop) [H2/T3]; test: wrong typed count → 4xx.

## Developer Experience Contract (Phase 2.5 — plan-devex-review, 19 decisions approved 2026-10-01)

### Persona card (D3)

- **Who:** Solo maintainer + AI-agent pair (Claude Code / Codex executes plan tasks; human owns domain + approvals).
- **Context:** Internal production planner, no git repo yet (CEO C1 pending), Homebrew PG 18.4, local-only.
- **Capability:** Expert in domain rules (77-rule register), intermediate with Next.js/Drizzle; the agent half knows the stack but not the project.
- **Day-2 loop:** agent writes endpoint/task → human reviews + runs tests → docs consulted only when behavior surprises.

### Empathy narrative (D4 — accurate)

Cold start on this repo costs ~10–15 minutes of archaeology: no README (CLAUDE.md is skill routing, not setup), no `.env.example`, `docker-compose.yml` present but unused (real DB = Homebrew), script order guessed from `package.json`, first login blocked by an undocumented MFA wall (creds + TOTP secret exist only in `db/seed.mts` console output). The agent re-derives this per fresh session. Root cause: the knowledge exists — in code, seed output, and this plan — but nowhere a new pair reads first.

### Competitive benchmark (D5 — target: Competitive 2–5 min)

| Reference | TTHW | Notes |
|---|---|---|
| `create-next-app` | ~2–4 min | scaffold-only, no DB/auth |
| internal-portal-template | ~5–10 min | env-example + db scripts + README |
| next-shadcn-dashboard-starter | ~3–5 min | one-command start |
| **This project today** | **~10–15 min** | no README/env-example/setup script; login wall |
| **Post-fix target** | **< 5 min** | `npm run setup` + documented login (D6/D9); measured by D19 acceptance |

Tier choice: Competitive (Champion — devcontainer/provisioning — declined; see NOT in scope).

### Magical moment (D6)

`npm run setup` → migrate → RLS/grants → seed → lint/typecheck/test, ending with a seeded planner at `localhost:3000` and a login that works on the first try (D9). One command, one golden path, no choose-your-own.

### Journey map (0F — stages, friction, resolution)

| Stage | Developer does | Friction found | Resolution |
|---|---|---|---|
| Discover | opens repo | no entry doc / no blurb | README quickstart + docs map (T16) |
| Install | `npm install` + DB | compose trap (D8); no env template (D5) | README compose note + `.env.example` (T17) |
| Hello World | seed → login | script-order guessing (D6); creds + TOTP undocumented (D9) | `npm run setup` (T18) + first-login block (T16) |
| Real Usage | add endpoint | conventions unwritten; CLAUDE.md = routing only (D10) | CLAUDE.md Conventions block (T19) |
| Debug | failing test / 500 | 500 body opaque even in dev (D11) | dev-mode 500 detail + `code` field (T20) |
| Upgrade | deps / VCS | no git/changelog/CI | covered by CEO C1 @ Phase 4 gate (no new action) |

### First-time developer confusion report (0G, D12 — all items approved D5–D11)

```
T+0:00  Open repo. No README. "Where do I start?"
T+0:30  Guess script order; docker-compose.yml visible → "which DB is real?"
T+1:00  Nearly run docker compose up (phantom DB — Homebrew PG is the real one).
T+2:00  migrate→security→seed OK (TOTP secret scrolls away). dev → login: guessed
        creds fail → grep seed.mts → admin@fanela.local. MFA demands code → grep
        again for JBSWY3DPEHPK3PXP.
T+3:00  Logged in, planner renders, ~15 min total, 3 greps, 1 phantom-DB scare.
```
Every confusion point maps to an approved fix (README / setup script / compose note / login block / conventions / dev-500s).

### Knobs & escape hatches (D18 — declared, mostly fixed by design)

| Knob | Default | Override |
|---|---|---|
| Import upload cap | 25MB | none (fixed by design); >25MB dump → record size in D12 `analyze-backup.mjs`, split/re-export the source (README procedure, T16) |
| Typed-confirm threshold | ≥50 rows | none (design decision Q7.2) |
| Preview cap | 200 rows (pagination + full CSV) | none |
| Import row cap | 50,000 rows/batch | none (fixed by design); Parse rejects over-cap → 4xx + frozen message (T21 constant) [X1] |
| Export row cap | 100,000 rows | none (fixed by design); abort before buffer blowup → non-2xx → inline banner; final number validated by the C4 spike [A3] |
| Test timeout | `testTimeout: 15_000` | vitest config (code-level, not env) |
| Dev TOTP secret | `JBSWY3DPEHPK3PXP` | pre-seed only; reset via documented SQL (T16) |
| Seed admin identity | `admin@fanela.local` | `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` |

### DX Scorecard (passes 1–8; initial → post-fix, POLISH mode)

| Pass | Initial → Final | Driver evidence |
|---|---|---|
| 1 Getting Started | 3 → **8** | no README/env/setup → T16/T17/T18 + D9/D19; ceiling 8: provisioning declined (D5) |
| 2 API design | 6 → **9** | `code` field (D13/T20), error constants (D17/T21); err/permission/409 patterns already strong |
| 3 Errors | 4 → **9** | dev-500 detail (D11), codes (D13), registry fix column (D14), constants (D17) |
| 4 Docs | 2 → **8** | README (T16), env contract (T17), CLAUDE.md conventions (T19); generated ref declared out |
| 5 Upgrade | 4 → **4\*** | \*blocked on CEO C1 (git/CI/changelog) — cross-phase note, no DX action |
| 6 Dev env | 5 → **8** | setup script (T18), script table (T16), env var contract (T17), TTHW gate (D19) |
| 7 Community | N/A | internal tool — CLAUDE.md (T19) = the pair's channel; "No issues, moving on" |
| 8 Measurement | 3 → **8** | D19 timed acceptance at DoD + post-ship devex-review TODO (D21) |

**Overall: 3 → 8** (min of applicable passes; Pass 5 excluded — external dependency, CEO C1; conditional on C1: 8 if a git baseline is approved, 4 if option C / rejected).

### DX implementation checklist

- [ ] T16 README (quickstart, scripts, login, reset-MFA, compose note, API table + curl, docs map)
- [ ] T17 `.env.example` + README env table (incl. `AUTH_SECRET` vestigial note)
- [ ] T18 `npm run setup` golden path
- [ ] T19 CLAUDE.md Conventions block
- [ ] T20 `err()` `code` + dev-mode 500 detail + tests
- [ ] T21 `lib/errors.ts` constants extraction
- [ ] D14 Error & Rescue Registry gains "Fix / doc anchor" column (this document)
- [ ] D19 timed cold-start acceptance in global DoD (this document)
- [ ] D21 post-ship devex-review TODO in TODOS.md
- [ ] Existing 195 tests stay green (this review changes plan text only until T20/T21 execute)

## Completion Summary — Phase 1 (CEO plan review)

```text
+===== AUTOPLAN PHASE 1 COMPLETION SUMMARY ======================+
| System audit ........... 195 tests green, no VCS, no CI,        |
|                          no live data, dev-DB drift (TODOS)      |
| Mode ................... SELECTIVE EXPANSION (0D: none needed)   |
| Sections reviewed ...... 11 of 11 + Step 0 + voices             |
| Spec loop .............. 3 iterations, scores 7/8/8, stopped     |
|                          per rule; 30 issues, 24 fixed, 6 →      |
|                          round 4                                |
| Voices ................. native CEO ×2 (last: approve with       |
|                          amendments, 16 findings); outside       |
|                          fallback ×1 (12 findings, revise-       |
|                          before-implement verdict); codex        |
|                          UNAVAILABLE (401 + no git)              |
| Round-4 dispositions ... S4 (6 residuals) + D13–D37 (25) = 31;   |
|                          block4 + approval PASS recorded         |
| Scope proposals ........ 9: 3 accepted, 4 deferred, 1 declined,  |
|                          1 user challenge (CEO C1)               |
| TODOS updates .......... 8 items written (1 converted + 7 new)   |
| Failure modes .......... 11 rows + E5 storage row; 0 critical    |
|                          gaps (table-scoped claim)               |
| Error/rescue registry .. 12 operations, all rescued + tested     |
| Diagrams ............... 1 new + 4 verified; 0 stale             |
| Approval readiness ..... PASS (ledger rows M, D1–D12, S2–S4,     |
|                          V1, D13–D37)                            |
| Lake score ............. N/A (auto-decided under /autoplan)      |
| Unresolved decisions ... 1: CEO C1 options A/B/C @ Phase 4 gate  |
| VERDICT ................ ENGINEERING + STRATEGY CLEAR pending    |
|                          CEO C1 gate decision; ready to          |
|                          implement after Phase 4                 |
+==================================================================+
```

## Completion Summary — Phase 2 (UI design review)

```text
+===== AUTOPLAN PHASE 2 COMPLETION SUMMARY ======================+
| Mode ................... text-only (designer key 401; no        |
|                          mockups; backfill → TODOS)             |
| Scope gate ............. UI scope = yes (auto-selected B)       |
| Passes ................. 7 of 7 (all runs)                     |
| Ratings ................ P1 3→8  P2 2→8  P3 3→8                |
|                          P4 5→8  P5 3→8  P6 1→8                |
|                          overall 1 → 8                         |
| Decisions .............. 11 of 11 answered (all A)             |
|                          0 unresolved this review              |
| Outside voice .......... in-host Reviewer 20 findings          |
|                          (F1–F20); Claude CLI dead;            |
|                          [subagent-only]                       |
| Adopted ................ UI Design Contract section;           |
|                          T4/T9 amended; T14 + T15 added;       |
|                          P3/P4 DoD + scope sections updated    |
| TODOS updates .......... +2 (design system, mockup backfill)   |
| Fix effort ............. ~3–4h (T14 5min, T15 2h, T4 in 1d)    |
| VERDICT ................ DESIGN CLEARED (text contract);        |
|                          mockups + DESIGN.md → TODOS           |
+==================================================================+
```

## Completion Summary — Phase 2.5 (DX plan review)

```text
+===== AUTOPLAN PHASE 2.5 COMPLETION SUMMARY =====================+
| Mode ................... DX POLISH (D7 — all passes, no scope)   |
| Scope gate ............. dxRequired: true (101 matches ≥ 2)     |
| Persona ................ solo maintainer + AI-agent pair (D3)    |
| Benchmark / target ..... Competitive tier, TTHW 2–5 min (D5)     |
| Magical moment ......... npm run setup → seeded planner (D6)     |
| Passes ................. 8 of 8 (7 applicable; Pass 7 N/A)       |
| Scorecard .............. P1 3→8  P2 6→9  P3 4→9  P4 2→8        |
|                          P5 4→4* (blocked CEO C1)  P6 5→8       |
|                          P8 3→8  overall 3 → 8                  |
| Decisions .............. 19 of 19 answered (D3–D21, all A)       |
|                          0 unresolved this review               |
| Native voice ........... in-host Reviewer 15+15 findings        |
|                          DX1–DX15 + r2 H/M/L all dispositioned; |
|                          outside providers dead →               |
|                          [subagent-only]                        |
| Adopted ................ DX Contract section (persona,           |
|                          narrative, benchmark, journey,         |
|                          confusion report, knobs, scorecard);   |
|                          T16–T21 added; DoD +1 line (D19);      |
|                          registry +fix column (D14);            |
|                          NOT-in-scope +3 (D18/D5/D15)           |
| TODOS updates .......... +1 (post-ship devex-review, D21)        |
| VERDICT ................ DX CLEARED (plan); fixes T16–T21        |
|                          + D19 acceptance land at execution;    |
|                          CEO C1 still pending @ Phase 4 gate    |
+==================================================================+
```

## Completion Summary — Phase 3 (Eng plan review — autoplan)

```text
+===== AUTOPLAN PHASE 3 COMPLETION SUMMARY =====================+
| Methodology ............ plan-eng-review, 4/4 ranges read       |
|                       (1999 lines, sha 030a62ba)               |
| Scope .................. final amended plan (impl sha 962a2b01) |
| Voice .................. native Reviewer via official create    |
|                       snapshot; INPUT sha matched; outside    |
|                       dead -> [subagent-only]                  |
| Findings ............... 21: A1-A4, X1-X4, T1-T5, S1-S5, H1-H3 |
| Pre-P3 critical ........ X1 row cap, A2 preview persistence,   |
|                       H2+T3 server-side typed confirm         |
| Dispositions ........... 21/21 plan-text amendments (blast-    |
|                       radius rule); accepted:eng x2 + fence    |
| Unresolved ............. 0 this review (CEO C1 remains)        |
| Verification ........... lint 0, tsc 0, 195 tests green        |
| VERDICT ................ ENG CLEARED (round 2 of final plan)   |
+==================================================================+
```

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 5 (Step 0 + 3 spec-loop + 2 native voices) | CLEAR (Phase 4 gate 2026-10-02: APPROVED as-is; CEO C1 → A) | 9 proposals: 3 accepted, 4 deferred, 1 declined, 1 user challenge; loop 30 issues/24 fixed; native 16 findings dispositioned |
| Outside Review | codex (attempted) | Independent 2nd opinion | 1 (attempt) | UNAVAILABLE — 401 `invalid_api_key` (sk-ceb3d…1579) + outside block requires git repo (none); same-harness native fallback ran, never counts as outside coverage | 12 fallback findings (D29–D37), not external |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 2 (round 1: 17 issues; round 2: native voice on the final amended plan) | CLEAR (PLAN) | Round 1: 17 issues, 0 critical gaps; round 2 native voice: 21 findings (A1–A4, X1–X4, T1–T5, S1–S5, H1–H3) all dispositioned as plan-text amendments; 0 unresolved this review |
| Design Review | `/plan-design-review` | UI/UX gaps | 7 passes + 11 decisions + in-host voice | CLEAR (PLAN) | Initial 1/10 → fixed to 8/10 (P1 3→8, P2 2→8, P3 3→8, P4 5→8, P5 3→8, P6 1→8); 20 in-host findings F1–F20; UI Design Contract adopted; 0 unresolved this review |
| DX Review | `/plan-devex-review` | Developer experience gaps | 8 passes + 19 decisions + native voice ×2 | CLEAR (PLAN) | Initial 3/10 → fixed to 8/10 (P1 3→8, P2 6→9, P3 4→9, P4 2→8, P6 5→8, P8 3→8; P5 4\* blocked on CEO C1); native voice ×2: DX1–DX15 + round-2 H1–H3/M1–M6/L1–L6, all dispositioned; DX Contract adopted; T16–T21 added; 0 unresolved this review |

- **OUTSIDE COVERAGE:** none — codex attempted once (401 + no git repo; error log `autoplan-ceo-NAi4pF/codex-ceo-err.log`); in-host design voice ran (20 findings F1–F20, never counts as outside coverage); in-host DX voice ran (2 rounds: DX1–DX15 + H1–H3/M1–M6/L1–L6, same rule); in-host eng voice ran (round 2: 21 findings A1–A4 / X1–X4 / T1–T5 / S1–S5 / H1–H3, same rule); Claude CLI outside voice attempted in Phase 2 — `OAuth session expired and could not be refreshed`; native same-harness fallback executed and never counts as outside coverage; `gstack-review-log` binary absent (attempted 2026-10-01), logged in Review record instead. Tags: [subagent-only].
- **VERDICT:** ENG CLEARED (round 1 + Phase-3 round 2 on the final amended plan — 21 findings dispositioned; pre-P3 set X1 row cap / A2 preview persistence / H2+T3 server-side typed confirm folded into T4/T5/D18) + DESIGN CLEARED (UI Design Contract, text-only — mockups deferred to TODOS, designer key 401) + DX CLEARED (DX Contract, 19 decisions, fixes T16–T21 + D19 acceptance) — ready to implement (T12 first at the autoplan Phase 4 approval gate, then T1→T21; T8 conditional on CEO C1). CEO findings dispositioned; design, DX and eng have 0 unresolved.

<!-- autoplan-accepted:ceo -->
- Review mode is SELECTIVE EXPANSION per the /autoplan Phase 1 override; every scope addition in this phase was auto-decided under the pipeline's stated principles, with standing user constraints (including "no commits unless asked") remaining in force until the autoplan Phase 4 gate decides CEO C1.
- P3 execute work is gated on a data-format check: run `analyze-backup.mjs` on the legacy export first — as soon as any legacy sample exists (owner via D12; target: before T3/T4 build); gate applies to real-data execute only (fixture execute unaffected); if the format is CSV/XLSX, record a converter-vs-extend-parser decision before coding; JSON shapes A–D remain the MVP import contract (CEO C2, accepted).
- P3 close requires one dry-run import of a real/sample dataset through the same route handlers with reconciliation Δ=0 when such data is available; fixtures-only Δ=0 proves spec conformance, not business correctness; if still unavailable at P3 close, P4 close requires a named owner + date recorded in TODOS.md (hard gate, no silent skip) (CEO C3, accepted).
- Task T9 starts with a 60-minute ExcelJS spike on a 10k-row styled workbook with the M4 column-strip running on the production writer path, recording peak RSS and wall time, before wiring the export route (CEO C4, accepted).
- Deferred to TODOS.md with matching NOT in scope entries: operator demo at P3 close (CEO C5), rule-ID/review-date tagging plus rule audit at first real import (CEO C6), adoption/success metric definition (CEO C7 — define before cutover with named owner), build-vs-buy revisit checkpoint (CEO C9 — triggers recorded now, reviewed at P3 close before P5 integrations).
- Legacy data acquisition (source, owner, deadline for the backup file) is a TODOS.md P0 entry; the real-data-late procedure stays the existing `analyze-backup.mjs` path (D12).
- CEO C1 (git init + remote + baseline commit + branch protection) is queued as a User Challenge for the autoplan Phase 4 approval gate (pre-execution), offered as options **A** full C1 / **B** local-only baseline commit / **C** no git; until approved the standing rule governs and task T8 (CI) stays blocked on repository existence; task T12 surfaces the CEO C1 decision at the gate (if rejected or option C, T12 appends the CI deferral to TODOS.md).
- P1.5 ordering fact recorded in the sequence diagram: P2 shipped before P1.5, so the five spec-atomic sites remain non-atomic in shipped code until T1 lands; T1 runs before any import execute work.
- Phase-1 evidence fixes accepted: ambient transaction client in `query()` (AsyncLocalStorage) so the [17A] readiness rebuild sees uncommitted batch rows (T1); local-disk upload storage under `storage/uploads/` for [E5] original-file keep (object-store migration checkpoint in TODOS); contract-faithful [13A]/[15A] tests per `phase0/05 §2` (blank SKU → warn, new dup job_number → error, orphan ref → warn; M4 assert re-parses the workbook instead of raw byte scan); T12 runs FIRST before T1–T11; T13 auth security checklist required before P4 (native R6); cutover plan + prod-ops runbook tracked as TODOS entries (native R4/R11).
- Verification for this phase's accepted items: P3 DoD carries the format gate and sample dry-run check, T9 carries the deepened spike, TODOS.md contains the eight entries (dev-DB drift plus seven CEO/native deferred) created by T11 (written 2026-10-01 in this phase), T13 exists as a pre-P4 task, T12 surfaces CEO C1 options at the autoplan Phase 4 gate, and the existing 195 tests stay green (this review changed no runtime behavior).
<!-- /autoplan-accepted:ceo -->
<!-- autoplan-accepted:design -->
- Design phase ran all 7 passes + 11 AskUserQuestion decisions (11/11 answered A); UI Design Contract adopted as plan section; initial overall rating 1/10 (min of six pass scores) → 8/10 after fixes, 0 unresolved.
- T4 amended to contract scope (anatomy, state table, typed confirm, issues-first preview, tokens, a11y + nav link + original-file download route); T9 amended to buffer-then-send; new T14 (body-font fix, `globals.css:25` Arial → Geist) and T15 (export dropdown UI, role-filtered); P3/P4 DoD carry design-compliance lines.
- Severity tokens: error=red-600, warn=amber-600, skip=zinc-500, create=zinc-700, info=blue-600; green forbidden (success-only semantics). Preview: issues-first, 100/page, ≤200-row cap with pagination + full CSV export. Confirm: row-level block on errors; typed confirm ≥50 rows OR warn (count-back); resume = server status (no TTL reaper).
- Deferred to TODOS (entries written 2026-10-01): full DESIGN.md design-system session (Q8.1); mockup backfill to `designs/import-wizard-20261001/` when valid designer key available (Q8.2 — 401 blocked). Text contract gates T4; mockups do not.
- Outside voice: in-host Reviewer 20 findings (F1–F20) incorporated; Claude CLI dead → [subagent-only]; designer 401 → text-only (mockup section omitted).
<!-- /autoplan-accepted:design -->
<!-- autoplan-accepted:dx -->
- DX phase ran all 8 passes (7 applicable — Pass 7 community N/A for internal tool) + 19 AskUserQuestion decisions (D3–D21, all answered A); mode DX POLISH (D7); DX Contract adopted as plan section; initial overall rating 3/10 (min of applicable passes) → 8/10 after fixes, 0 unresolved.
- T16–T21 added: README (quickstart, script table incl. db:security, first-login creds+TOTP+recovery, reset-MFA SQL, compose note, API table+curl, docs map), .env.example (DATABASE_URL/SEED_ADMIN_*/APP_DATABASE_URL; AUTH_SECRET noted vestigial), npm run setup golden path, CLAUDE.md Conventions block, err() code field + dev-mode 500 detail, lib/errors.ts constants extraction.
- Global DoD gains timed cold-start acceptance vs 2–5 min TTHW target (D19); Error & Rescue Registry gains "Fix / doc anchor" column (D14); NOT in scope gains 3 DX entries (fixed knobs D18, provisioning D5, generated API ref D15).
- Error contract: {error, code?} additive (D13), dev-500 detail behind NODE_ENV guard with prod byte-identical (D11), frozen strings single-sourced in lib/errors.ts (D17) — [13A]/registry/UI contract cite constants; knobs declared fixed-by-design (D18 table in DX Contract).
- Deferred to TODOS (entry written 2026-10-01): post-ship devex-review (D21). Upgrade/CI gaps owned by CEO C1 — no new DX action.
- Outside voice: in-host Reviewer 15 findings (DX1–DX15) dispositioned (DX1/2/3/6 → D5/D6/D9 pre-approved; DX4→D13, DX5→D14, DX7→env table, DX8/11→D15, DX9→D16, DX10→D17, DX12→D18, DX13→D19, DX14→D20, DX15→report update); official voice-snapshot round 2 added 15 findings (H1–H3/M1–M6/L1–L6), all dispositioned as plan-text amendments (see accepted:dx); outside providers dead (codex 401+no git, Claude CLI OAuth expired) → [subagent-only].
- Verification for this phase: scorecard + journey + confusion report + knob table live in the DX Contract section, T16–T21 exist in Implementation Tasks, D14 column present, D19 line in global DoD, TODOS.md carries the D21 entry, and the existing 195 tests stay green (this review changed plan text only).
- Native voice round 2 (official voice snapshot, `INPUT: dx 43c22c4c…`): 15 findings H1–H3 / M1–M6 / L1–L6, all dispositioned as plan-text amendments — H1 DB-bootstrap + `npm run dev` in T16 quickstart; H2 code taxonomy in T21 + README error-code table; H3 execution-order line gains T14–T21 placement + P4-close D19 gate; M1 >25MB procedure (D12 + T16); M2 D19 clean-checkout fallback (copy-tree when no VCS); M3 D19 timing excludes test suite; M4 `npm run dev` step; M5 registry +3 rows (login/MFA, file GET, export ceiling); M6 registry anchors → README; L1 import curl chain; L2 runtime default `internal_error`; L3 AGENTS.md pointer; L4 `db/migrate-all.sh` name note; L5 known-limit line; L6a n=1 noted, L6b compose header comment, L6c scorecard conditional on C1.
<!-- /autoplan-accepted:dx -->

**UNRESOLVED DECISIONS:**
- This review (plan-eng-review): 0 open decisions — round-2 native voice, 21 findings all dispositioned as plan-text amendments.
- This review (plan-design-review): 0 open decisions — 11/11 answered A.
- This review (plan-devex-review): 0 open decisions — 19/19 answered (D3–D21).
- Phase 4 gate (2026-10-02): plan **APPROVED as-is**; the prior sole unresolved item CEO C1 (git baseline A/B/C) was decided by the user → **option A, full C1** (git init + remote + baseline commit + branch protection). T8/CI unblocked; DX Pass 5 → 8; T12 records the gate outcome instead of re-surfacing options. 0 unresolved across all phases.

<!-- autoplan-accepted:eng -->
- Phase 3 (autoplan) ran plan-eng-review round 2 on the final amended plan: methodology read 4/4 ranges (1999 lines), native voice dispatched via official `create` snapshot (`INPUT: eng 962a2b01…`, sha matched), 21 findings A1–A4 / X1–X4 / T1–T5 / S1–S5 / H1–H3 — all dispositioned as plan-text amendments; outside providers dead (codex 401 + no git; Claude CLI OAuth expired) → [subagent-only]; 0 unresolved this review.
- Pre-P3 critical set accepted: X1 import row cap (50,000 rows/batch — Parse → 4xx + frozen message, D18 knob row); A2 preview persistence (parsed rows persisted at Parse — `import_batches.parsed jsonb` or `import_batch_rows`; pages/CSV/Resume/error-CSV read persisted rows; restart-session resume test); H2+T3 server-side typed confirm (execute recomputes create count inside the tx — `typedCount` mismatch → 4xx test).
- Lifecycle + tx rules accepted: A1 write-through to `storage/uploads/` at Upload (write file → `files` row → Parse; execute flips batch state; disk-before-tx order per H1 — tx fail keeps the original, post-commit file-missing test; orphan sweep → TODOS); A4 `SET LOCAL statement_timeout` in the execute tx + single-flight import execute (pg advisory lock) + ALS-detached helper test; A3 export row-cap guard (D18 knob row — abort → non-2xx → banner).
- TOCTOU + transport accepted: X2 execute re-validates `job_number`s inside the tx (downgrade to skip — never raw SQL failure) with insert-after-preview test; X3 chunked-body 413 streaming guard + test; X4 session-expiry → re-login → Resume integration test.
- Test hardening accepted: T1 M4 assert across all 9 views; T2 reconciliation spot-assert of sampled rows (job_number, customer, date); T5 discard→resume→confirm CAS state-machine matrix; T4 path-traversal test (DB-key-only lookup, `../../etc/passwd` → 404); S2 CSV formula-injection neutralization (leading `=`/`+`/`-`/`@` prefixed — inert round-trip fixture); S3 dev-500 gated on `NODE_ENV === "development"` (unset must not leak; dev/prod/unset tested).
- Security split accepted: S1 — CSRF strategy + upload authz/rate-limit subset of T13 clears at P3 close (first stateful admin write); cookie flags/fixation/full rate-limit stay pre-P4; S5 storage retention/quota (orphan upload sweep + quota posture) added to TODOS.md.
- H3 export writer wording: ExcelJS in-memory workbook → buffer-then-send (streaming only if the C4 spike demands it); P4 bullet amended.
- Verification for this phase: lint + tsc + 195 tests green after amendments (plan text only); T2/T4/T5/T9/T13/T20/T21 carry the new obligations; D18 knob table carries row-cap + export-cap rows; P3 DoD carries the T13 subset; TODOS.md carries the storage entry; report Eng row + OUTSIDE COVERAGE + VERDICT updated; 0 unresolved.
<!-- /autoplan-accepted:eng -->
## Review record

### Design Review record (run ap-20261001T181616Z-41797, Phase 2)

Mode: text-only (designer binary `DESIGN_READY` but OpenAI key 401 `sk-ceb3d…1579` → no mockups, "Approved Mockups" section omitted; backfill deferred to TODOS). Scope gate: UI scope = yes → all 7 passes run. Focus question 0D → A (all passes).

| Pass | Focus | Score before → after | Key findings (in-host F1–F20 cross-ref) |
|---|---|---|---|
| 1. Information architecture | Screen anatomy, nav, discoverability | 3 → 8 | F1 no import entry point (→ nav.tsx pattern), F12 export UI absent (→ T15) |
| 2. State & interaction | States, confirmations, async feedback | 2 → 8 | F2 state table + export states (→ Contract), F9/F11 typed-confirm |
| 3. Storytelling & journey | Onboarding arc, reassurance | 3 → 8 | F3 reassurance copy (4 mandated strings), F8 blocking contradiction resolved (Q7.x) |
| 4. Visual & brand | Typography, tokens, color | 5 → 8 | F4 Arial body font (→ T14), severity tokens decision (green forbidden) |
| 5. Content & copy | Labels, errors, empty states | 3 → 8 | F5/F6/F7 state-table copy, progress labels |
| 6. Responsive & a1y | Keyboard, viewport, contrast | 1 → 8 | F10 keyboard/emulated-viewport pass, F13 focus order |
| 7. Design system leverage | As-built patterns reused | (within above) | zinc + `prefers-color-scheme` + nav permission pattern adopted as contract base |

Decisions (11, all A): Q1.1 anatomy spec · Q1.2 export dropdown (T15) · Q2.1 issues-first preview ≤200 rows · Q2.2 full 6×5 state table · Q3.1 reassurance arc · Q4.1 font fix (T14) · Q5.1 severity tokens · Q6.1 responsive+a11y · Q7.1 row-level block · Q7.2 typed confirm ≥50 OR warn · Q7.3 server-status resume (no TTL reaper) · Q7.4 buffer-then-send · Q7.5 reconciliation in Result step · Q8.1+Q8.2 → TODOS.

Outside voice: in-host `task` Reviewer → F1–F20 (4 critical: F1 anatomy, F8 blocking contradiction, F12 export absent, F15 persistence-gap); Claude CLI dead (OAuth expired) → [subagent-only], no true outside coverage.

Adopted into plan: **UI Design Contract** section (anatomy ASCII, nav/gate/stage-mapping, export UI, preview scale, state table, reassurance arc, journey, tokens, responsive+a11y, blocking/typed-confirm/resume decisions); task amendments T4/T9; new T14 (font) + T15 (export dropdown); P3/P4 DoD design-compliance lines; NOT-in-scope reword (visual polish beyond contract out; full design system + mockups → TODOS); What-exists design-vocabulary bullet. Fix time ~3–4h (T14 5min + T15 2h + T4 contract within existing 1d).

### DX Review record (run ap-20261001T181616Z-41797, Phase 2.5)

Mode: DX POLISH (D7 — all stages/passes, no scope additions). Scope gate: `scope` → `dxRequired: true` (101 matches ≥ threshold 2). Prior DX learnings loaded: 3 (plan-edit-vs-baseline-marker, design-designer-401, autoplan-prepare-close-5arg). DX trend: NO_PRIOR_DX_REVIEWS. Outside providers dead (codex 401 + no git; Claude CLI OAuth expired) → native in-host voice only, [subagent-only]. Hall of fame + skill doc read in full (1855 lines).

| Pass | Focus | Score before → after | Key findings (native DX1–DX15 cross-ref) |
|---|---|---|---|
| 1. Getting Started | Zero friction, TTHW | 3 → 8 | DX1 no README, DX2 no .env.example, DX6 test bootstrap, DX9 db:security (→ T16/T17/T18, D19); ceiling: provisioning declined |
| 2. API/CLI design | Ergonomics, consistency | 6 → 9 | DX4 no error codes (→ D13/T20), DX10 string constants (→ D17/T21); err/permission/409 already strong |
| 3. Error handling | problem+cause+fix+docs | 4 → 9 | DX5 registry lacks fix column (→ D14), DX4/DX10 (above), dev-500 opacity (D11 → T20) |
| 4. Documentation | Copy-paste, IA | 2 → 8 | DX8 no API reference, DX11 no docs map (→ D15/T16), DX3 first-login MFA (→ D9/T16) |
| 5. Upgrade | Deps/VCS/changelog | 4 → 4\* | no new findings — all owned by CEO C1 (git baseline); cross-phase note only |
| 6. Dev environment | Env, scripts, startup | 5 → 8 | DX7 APP_DATABASE_URL undocumented (→ T17 env table), DX9 (→ T16), DX13 no cold-start check (→ D19), DX14 MFA dead-end (→ D20/T16) |
| 7. Community | Channels, contribution | N/A | internal tool — "No issues, moving on"; CLAUDE.md (T19) = pair's channel |
| 8. Measurement | DX signals, loops | 3 → 8 | DX13 TTHW never validated (→ D19), DX15 report claimed clearance pre-run (→ fixed by this record), D21 post-ship loop |

Native voice: in-host `task` Reviewer → 15 findings DX1–DX15, all dispositioned (see accepted:dx block). Round 2 (official `create` voice snapshot, `INPUT: dx 43c22c4c…`): +15 findings H1–H3 / M1–M6 / L1–L6, all dispositioned as plan-text amendments (see accepted:dx). Outside voice: none available (same provider failures as Phases 1–2); no outside coverage claimed.

Decisions (19, D3–D21, all answered — ledger below). Adopted into plan: **DX Contract** section (persona, empathy narrative, benchmark, magical moment, journey map, confusion report, knob table, scorecard, checklist); tasks T16–T21; global DoD +D19 acceptance line; registry +D14 fix column; NOT in scope +3; TODOS +D21 entry; report DX row + verdict updated. Fix time estimate at execution: ~1 day CC (T16 30min + T17 5min + T18 5min + T19 10min + T20 20min + T21 30min + registry/DoD already applied in text).

### DX Step 0 — decision ledger (run ap-20261001T181616Z-41797)

| ID | Question | Current | Proposed | Status | Exact authority and scope |
|----|----------|---------|----------|--------|---------------------------|
| D3 | Persona | none documented | solo maintainer + AI-agent pair (Claude Code/Codex executor; human domain+approvals) | approved (A) | DX skill Step 0A — persona card lives in DX Contract |
| D4 | Empathy narrative | — | accurate narrative (no README, CLAUDE.md routing, compose drift, MFA wall, ~10–15 min) | approved (A) | Step 0B — must match evidence, not aspiration |
| D5 | TTHW target tier | unmeasured | Competitive 2–5 min (Champion/devcontainer declined) | approved (A) | Step 0C — benchmark table + tier choice; provisioning out of scope |
| D6 | Magical moment | none | `npm run setup` → seeded planner at localhost:3000 | approved (A) | Step 0D — one golden path; drives T18 |
| D7 | Review mode | — | DX POLISH (all passes, no scope beyond plan) | approved (A) | Step 0E — mode selection under /autoplan |
| D8 | Compose trap doc | undocumented | README documents: DB = Homebrew PG 18.4; compose unused (TODOS drift item) | approved (A) | Step 0F INSTALL friction |
| D9 | First-login creds + TOTP | seed console only | README first-login block (creds, TOTP secret, recovery codes, env overrides) | approved (A) | Step 0F HELLO WORLD friction — D6 moment needs an enterable door |
| D10 | Endpoint conventions home | in code only | CLAUDE.md Conventions block (agent auto-loads; README split once-per-setup) | approved (A) | Step 0F REAL USAGE friction — day-2 writer = agent |
| D11 | Dev-mode 500 detail | always generic | NODE_ENV!=='production' → include e.message; prod byte-identical | approved (A) | Step 0F DEBUG friction; zero test assertions on 500 body (grep-verified) |
| D12 | Confusion report scope | — | all 5 roleplay items (each maps 1:1 to D5–D11) | approved (A) | Step 0G — confirmation, no new fixes |
| D13 | Machine-readable error codes | {error} strings only | add optional code field (additive; err/toResponse choke point) | approved (A) | Native DX4 (high) — agent branch key; 195 tests unaffected |
| D14 | Registry fix column | user-sees only | + "Fix / doc anchor" column, 12 rows | approved (A) | Native DX5 (high) — lookup → rescue map; plan-text only |
| D15 | README API + docs map | absent | endpoint table + curl per family + docs map | approved (A) | Native DX8+DX11 (medium) — day-2 discovery |
| D16 | db:security script | opaque name | document in README script table; keep name (no T8/CI churn) | approved (A) | Native DX9 (medium) — doc over rename |
| D17 | Error string source | doc+code+tests triple copy | extract lib/errors.ts constants; cite names in contract/registry/tests | approved (A) | Native DX10 (medium) — closes freeze-day TODO by construction |
| D18 | Knob escape hatches | undocumented | declare each knob (mostly fixed-by-design); no config system | approved (A) | Native DX12 (medium) — anti config-sprawl |
| D19 | TTHW validation | none | timed cold-start acceptance line in global DoD vs 2–5 min | approved (A) | Native DX13 (medium) — target becomes pass/fail |
| D20 | Lost dev authenticator | dead-end | README reset-MFA SQL → re-run db:seed re-arms (seed.mts:54 branch verified) | approved (A) | Native DX14 (medium) — rescue where wall was hit |
| D21 | Post-ship DX check | none | TODOS entry: one post-ship devex-review vs D5 target + D5–D20 fixes | approved (A) | Pass 8 measurement loop |

Approval readiness: PASS — all 19 rows dispositioned; 0 unresolved this review; exactly 1 cross-phase item retained (CEO C1).

### CEO Step 0 — decision ledger (run ap-20261001T181616Z-41797)

Methodology read: 5/5 ranges (1-600, 601-1200, 1201-1800, 1801-2400, 2401-2501); methodology file immutable (read-only), logged here instead.

| ID | Question | Current | Proposed | Status | Exact authority and scope |
|----|----------|---------|----------|--------|---------------------------|
| M | Review mode | — | SELECTIVE EXPANSION | approved | /autoplan Phase 1 override rule (explicit pipeline choice; no question asked) |
| D1 / C1 | git init + remote + baseline commit + branch protection? | "no commits unless asked" (standing user rule) | C1 as proposed; T8 CI prereq | unresolved → Phase 4 gate (USER CHALLENGE) | Never auto-decide a user-direction change; native CEO (2.1/3.1 critical) + primary agree it is load-bearing; user decides at gate |
| D2 / C2 | Real-data format gate before P3 execute | not in plan | run analyze-backup.mjs first; converter-vs-extend-parser decision if CSV/XLSX | approved | /autoplan scope rule: in blast radius, <1d CC |
| D3 / C3 | Sample dry-run import at P3 close | not in plan | DoD line: real/sample dataset, same route handlers, Δ=0 when data available | approved | /autoplan scope rule: in blast radius, <1d CC |
| D4 / C4 | ExcelJS spike | not in plan | T9 first step: 500-row workbook, peak RSS + wall time | approved | /autoplan scope rule: in blast radius, <1d CC |
| D5 / C5 | Operator demo at P3 close | — | defer to TODOS.md | approved (deferred) | /autoplan scope rule: outside blast radius (needs staff time) |
| D6 / C6 | Rule tagging + audit at first real import | — | defer to TODOS.md | approved (deferred) | /autoplan scope rule: outside critical path |
| D7 / C7 | Adoption/success metric | — | defer to TODOS.md | approved (deferred) | user-defined metric; not auto-decidable |
| D8 / C8 | Minimal dashboard into P4/P5 | P5 dashboards already scoped | pull minimal dashboard earlier | declined (duplicate) | /autoplan rule: duplicates → reject |
| D9 / C9 | Build-vs-buy kill criterion | — | defer to TODOS.md | approved (deferred) | /autoplan scope rule: strategy work outside blast radius |
| D10 | Codex outside voice for CEO | preflight said ready (inconclusive probe) | unavailable: exec 401 invalid API key (sk-ceb3d…1579) + outside block requires git repo (none) | recorded | Failure policy: proceed with native subagent only, tagged [subagent-only]; consensus cells N/A |
| D11 | 0H document approval | — | auto-decide A (approve CEO scope doc + working plan) | approved | /autoplan preamble: auto-decide replaces user's answer; recommendation A matches decisions |
| D12 | Legacy data acquisition owner | no owner in plan | TODOS.md entry (source, owner, deadline) | approved (deferred) | Native CEO 1.2: outside blast radius (ops task, not code) |
| S2 | 0H spec review iteration 1 (input `autoplan-ceo-gfzMGE`) | SCORE 7, 12 issues (Scope PASS) | fixes F1-F9: C2/C3 label swap in P3 DoD, T8 blocked on C1 + local-first verify, T11 expands to six TODOS entries, T12 gate task, priority-tag legend, DoD gate wording (real-data vs fixtures), verdict/CI conditional phrasing | resolved → re-dispatch iteration 2 | Mechanically evaluated; all fixes in blast radius |
| S3 | 0H spec review iteration 2 (input `autoplan-ceo-0SCqa7`) | SCORE 8, 12 issues (Scope + Feasibility PASS) | fixes R10-R24: 77-ID recount (ground truth), T15→T10 typo, CEO-C1 namespace prefix, autoplan-vs-P4 gate spelling, NO-UNRESOLVED reword, CEO report row RUNNING, retro-log owner T10@P4, readiness rebuild moved inside batch tx (crash window), CI-claim local fallback, T12 files+rejection ownership, line-refs glossary | resolved → re-dispatch iteration 3 (final per loop rule) | C6 readiness placement = taste fix of accepted 17A (surface at gate) |
| S4 | 0H spec review iteration 3 (input `autoplan-ceo-D8i9gm`) | SCORE 8, 6 issues (Scope + Feasibility PASS); loop stopped 3/3 per rule | residuals → round-4 body edits: M1–M3 test gap (T9 verify + P4 DoD cite `tests/rules-m.test.ts`), P2 DoD "full register" overclaim → P2-scope IDs, `[CEO C2/C3]` prefixes in P3 bullets + block, Lane D "after T1" → no T1 dependency, T4 Files → `app/(app)/admin/import/page.tsx`, T2 Files += `db/schema/audit.ts` | resolved in round 4 (no re-dispatch) | it3 pass = final per loop rule; quality_score 8 appended to spec-review.jsonl |
| V1 | Consensus (outside vs native vs primary) | codex voice unavailable: 401 `invalid_api_key` (sk-ceb3d…1579) + outside block requires git repo (none); native same-harness fallback ran (findings below), never counts as outside coverage | 6-dimension consensus N/A vs external; agreement recorded: native CEO #2, spec reviewer ×3, outside fallback, primary all flag CEO C1 as the load-bearing user challenge; disagreement: outside fallback rates Feasibility UNMET pre-fix (F1–F4) — primary judged all four fixable in-plan → accepted as round-4 edits | recorded, tagged [subagent-only]; no CROSS-MODEL line | Failure policy: never fabricate outside coverage; `gstack-review-log` binary absent (attempted 2026-10-01), logged here instead |
| D13 | native R1 — local-git baseline | binary gate only | three options A/B/C written into T12 | USER CHALLENGE — options surfaced, never auto-chosen | User decides at Phase 4 gate |
| D14 | native R2 + outside F10 — C2/C3 fire too late | conditional DoD unenforced | front-load C2 (target before T3/T4 build) + C3 P4 hard gate (owner+date) | accepted (correctness) | Acquisition itself stays D12 TODOS (external dep, cannot hard-gate P3 entry) |
| D15 | native R3 — thin adoption | metric undefined | success-metric bullet added to P4; C5 demo deferral stands, priority P1 in TODOS | accepted (partial) | Metric value = user-defined; definition deadline pre-cutover |
| D16 | native R4 — no cutover plan | plan has zero dates | cutover plan TODOS entry (date, parallel-run exit, shutdown owner) | accepted | Date triggers triage across P3–P5 |
| D17 | native R5 — C9 check dead-on-arrival at P5 | review post-sunk-cost | C9 review moved to P3 close (block + TODOS text) | accepted (taste) | Surface at Phase 4 gate |
| D18 | native R6 — tests ≠ security | auth surface unreviewed | new T13 pre-P4 security checklist task | accepted | 195 tests prove behavior, not security |
| D19 | native R7 — C3 gate wording | "when available" = skipable | P4 close requires named owner + date in TODOS | accepted | Hard gate, no silent skip |
| D20 | native R8 + outside F2 — E5 storage backend missing | `files.bucket/key` NOT NULL, no MinIO client in repo | local-disk `storage/uploads/` (bucket='local'); T4 persists; object-store migration → TODOS | accepted (taste — surface at gate) | Spec L28 MinIO deferred; deviation recorded in NOT in scope |
| D21 | native R9 — C4 spike too thin | 500 rows misses scaling cliff | 60-min, 10k rows, styled + M4 strip on production writer path | accepted | |
| D22 | native R10 — CI-first-red silent | no rule exists | first-CI-red-is-blocker folded into dev-DB TODOS Context | accepted | |
| D23 | native R11 — no ops story | B1/B2/L4 orphaned | prod-ops runbook TODOS entry (backup, restore drill, logs, uptime) | accepted | |
| D24 | native R12 — critical-gaps overclaim | "0" reads globally | reworded table-scoped; structural risks point to Review record + TODOS | accepted | |
| D25 | native R13 — no data sizing | pipeline value unverified | `analyze-backup.mjs` output must include record count + manual re-entry hours estimate | accepted | Feeds build-vs-buy metric |
| D26 | native R14 — T11 path false claim | file cited without path | verify cites gstack `review/TODOS-format.md` (exists at `~/.claude/skills/gstack/review/`) | accepted | Claim corrected |
| D27 | native R15 — plan lacks design pass | UI is MVP-plumbing | covered by pipeline Phase 2 (scheduled; report row NOT RUN today) | no plan edit, logged | |
| D28 | native R16 + S4 — Lane D dep | "after T1" wrong | Lane D: parallel to C, no T1 dependency | accepted | |
| D29 | outside F1 — tx mechanism unspecified | `query()` hardwires `pool.query`; [17A] in-tx rebuild would use a different session | T1 rewritten: AsyncLocalStorage ambient tx client + same-session assertion tests | accepted (correctness — Feasibility restored) | |
| D30 | outside F3 — [13A] contradicts `05 §2` | blank SKU/new-dup/orphan severities wrong | [13A] rows rewritten contract-faithful; warn placement in preview specified | accepted (contract fidelity) | |
| D31 | outside F4 — byte-level M4 assert vacuous | xlsx = zipped, raw scan never finds strings | parse-based assert (exceljs re-read + sharedStrings/cell scan), unit_price included, views named | accepted (test correctness) | |
| D32 | outside F5 — DoD claims untested rules | E2/E7/E4/E3 no named tests | test rows added to [13A]/[15A] (E7 row-hiding, E2 snapshot immutability, E4 no-write table asserts, E3 existing-skip) | accepted | |
| D33 | outside F6 — P2 DoD false + B1/B2/L4 orphaned | "full register green" untrue; ops rules unowned | P2 DoD → P2-scope IDs; mapping row notes ops-check exception → runbook TODOS | accepted | Overlaps S4 residual |
| D34 | outside F7 — T12 order vs pre-execution gate | gate listed last | execution order states T12 FIRST (legend + verdict) | accepted | |
| D35 | outside F8 — T8 missing CI bootstrap | first run red regardless of C1 | T8 spec gains db:migrate + db:security + db:seed + DATABASE_URL | accepted | |
| D36 | outside F9 — `version` semantics undefined | nothing bumps it; stale test proves nothing | defined: bumps on re-upload/re-preview (content change); test exercises real bump path | accepted | Keeps approved 3A pattern |
| D37 | outside F12 + minors | phase order, misc | T9 no-data-dependency note; cancel-before-execute test; FX-10 explicit timeout override; export signed-URL spec-drift note; T2 lands-with-T4 note | accepted (batched) | No P3/P4 swap — flexibility recorded instead |

0D note: no new approach decision was needed before mode selection; all Step 0 items were scope proposals resolved through the 0G menu under /autoplan auto-decision rules.

**Approval readiness: PASS** — rows M, D1–D12, S2–S4, V1, D13–D37 dispositioned; answers recoverable from ledger; exactly 1 unresolved item (CEO C1) retained by the USER CHALLENGE rule for the autoplan Phase 4 approval gate.

### Accepted obligations (phase ceo)

<!-- autoplan-accepted:ceo -->
- Review mode is SELECTIVE EXPANSION per the /autoplan Phase 1 override; every scope addition in this phase was auto-decided under the pipeline's stated principles, with standing user constraints (including "no commits unless asked") remaining in force until the autoplan Phase 4 gate decides CEO C1.
- P3 execute work is gated on a data-format check: run `analyze-backup.mjs` on the legacy export first — as soon as any legacy sample exists (owner via D12; target: before T3/T4 build); gate applies to real-data execute only (fixture execute unaffected); if the format is CSV/XLSX, record a converter-vs-extend-parser decision before coding; JSON shapes A–D remain the MVP import contract (CEO C2, accepted).
- P3 close requires one dry-run import of a real/sample dataset through the same route handlers with reconciliation Δ=0 when such data is available; fixtures-only Δ=0 proves spec conformance, not business correctness; if still unavailable at P3 close, P4 close requires a named owner + date recorded in TODOS.md (hard gate, no silent skip) (CEO C3, accepted).
- Task T9 starts with a 60-minute ExcelJS spike on a 10k-row styled workbook with the M4 column-strip running on the production writer path, recording peak RSS and wall time, before wiring the export route (CEO C4, accepted).
- Deferred to TODOS.md with matching NOT in scope entries: operator demo at P3 close (CEO C5), rule-ID/review-date tagging plus rule audit at first real import (CEO C6), adoption/success metric definition (CEO C7 — define before cutover with named owner), build-vs-buy revisit checkpoint (CEO C9 — triggers recorded now, reviewed at P3 close before P5 integrations).
- Legacy data acquisition (source, owner, deadline for the backup file) is a TODOS.md P0 entry; the real-data-late procedure stays the existing `analyze-backup.mjs` path (D12).
- CEO C1 (git init + remote + baseline commit + branch protection) is queued as a User Challenge for the autoplan Phase 4 approval gate (pre-execution), offered as options **A** full C1 / **B** local-only baseline commit / **C** no git; until approved the standing rule governs and task T8 (CI) stays blocked on repository existence; task T12 surfaces the CEO C1 decision at the gate (if rejected or option C, T12 appends the CI deferral to TODOS.md).
- P1.5 ordering fact recorded in the sequence diagram: P2 shipped before P1.5, so the five spec-atomic sites remain non-atomic in shipped code until T1 lands; T1 runs before any import execute work.
- Phase-1 evidence fixes accepted: ambient transaction client in `query()` (AsyncLocalStorage) so the [17A] readiness rebuild sees uncommitted batch rows (T1); local-disk upload storage under `storage/uploads/` for [E5] original-file keep (object-store migration checkpoint in TODOS); contract-faithful [13A]/[15A] tests per `phase0/05 §2` (blank SKU → warn, new dup job_number → error, orphan ref → warn; M4 assert re-parses the workbook instead of raw byte scan); T12 runs FIRST before T1–T11; T13 auth security checklist required before P4 (native R6); cutover plan + prod-ops runbook tracked as TODOS entries (native R4/R11).
- Verification for this phase's accepted items: P3 DoD carries the format gate and sample dry-run check, T9 carries the deepened spike, TODOS.md contains the eight entries (dev-DB drift plus seven CEO/native deferred) created by T11 (written 2026-10-01 in this phase), T13 exists as a pre-P4 task, T12 surfaces CEO C1 options at the autoplan Phase 4 gate, and the existing 195 tests stay green (this review changed no runtime behavior).
<!-- /autoplan-accepted:ceo -->

### Accepted obligations (phase design)

<!-- autoplan-accepted:design -->
- Design phase ran all 7 passes + 11 AskUserQuestion decisions (11/11 answered A); UI Design Contract adopted as plan section; initial overall rating 1/10 (min of six pass scores) → 8/10 after fixes, 0 unresolved.
- T4 amended to contract scope (anatomy, state table, typed confirm, issues-first preview, tokens, a11y + nav link + original-file download route); T9 amended to buffer-then-send; new T14 (body-font fix, `globals.css:25` Arial → Geist) and T15 (export dropdown UI, role-filtered); P3/P4 DoD carry design-compliance lines.
- Severity tokens: error=red-600, warn=amber-600, skip=zinc-500, create=zinc-700, info=blue-600; green forbidden (success-only semantics). Preview: issues-first, 100/page, ≤200-row cap with pagination + full CSV export. Confirm: row-level block on errors; typed confirm ≥50 rows OR warn (count-back); resume = server status (no TTL reaper).
- Deferred to TODOS (entries written 2026-10-01): full DESIGN.md design-system session (Q8.1); mockup backfill to `designs/import-wizard-20261001/` when valid designer key available (Q8.2 — 401 blocked). Text contract gates T4; mockups do not.
- Outside voice: in-host Reviewer 20 findings (F1–F20) incorporated; Claude CLI dead → [subagent-only]; designer 401 → text-only (mockup section omitted).
<!-- /autoplan-accepted:design -->

### Accepted obligations (phase dx)

<!-- autoplan-accepted:dx -->
- DX phase ran all 8 passes (7 applicable — Pass 7 community N/A for internal tool) + 19 AskUserQuestion decisions (D3–D21, all answered A); mode DX POLISH (D7); DX Contract adopted as plan section; initial overall rating 3/10 (min of applicable passes) → 8/10 after fixes, 0 unresolved.
- T16–T21 added: README (quickstart, script table incl. db:security, first-login creds+TOTP+recovery, reset-MFA SQL, compose note, API table+curl, docs map), .env.example (DATABASE_URL/SEED_ADMIN_*/APP_DATABASE_URL; AUTH_SECRET noted vestigial), npm run setup golden path, CLAUDE.md Conventions block, err() code field + dev-mode 500 detail, lib/errors.ts constants extraction.
- Global DoD gains timed cold-start acceptance vs 2–5 min TTHW target (D19); Error & Rescue Registry gains "Fix / doc anchor" column (D14); NOT in scope gains 3 DX entries (fixed knobs D18, provisioning D5, generated API ref D15).
- Error contract: {error, code?} additive (D13), dev-500 detail behind NODE_ENV guard with prod byte-identical (D11), frozen strings single-sourced in lib/errors.ts (D17) — [13A]/registry/UI contract cite constants; knobs declared fixed-by-design (D18 table in DX Contract).
- Deferred to TODOS (entry written 2026-10-01): post-ship devex-review (D21). Upgrade/CI gaps owned by CEO C1 — no new DX action.
- Outside voice: in-host Reviewer 15 findings (DX1–DX15) dispositioned (DX1/2/3/6 → D5/D6/D9 pre-approved; DX4→D13, DX5→D14, DX7→env table, DX8/11→D15, DX9→D16, DX10→D17, DX12→D18, DX13→D19, DX14→D20, DX15→report update); official voice-snapshot round 2 added 15 findings (H1–H3/M1–M6/L1–L6), all dispositioned as plan-text amendments (see accepted:dx); outside providers dead (codex 401+no git, Claude CLI OAuth expired) → [subagent-only].
- Verification for this phase: scorecard + journey + confusion report + knob table live in the DX Contract section, T16–T21 exist in Implementation Tasks, D14 column present, D19 line in global DoD, TODOS.md carries the D21 entry, and the existing 195 tests stay green (this review changed plan text only).
- Native voice round 2 (official voice snapshot, `INPUT: dx 43c22c4c…`): 15 findings H1–H3 / M1–M6 / L1–L6, all dispositioned as plan-text amendments — H1 DB-bootstrap + `npm run dev` in T16 quickstart; H2 code taxonomy in T21 + README error-code table; H3 execution-order line gains T14–T21 placement + P4-close D19 gate; M1 >25MB procedure (D12 + T16); M2 D19 clean-checkout fallback (copy-tree when no VCS); M3 D19 timing excludes test suite; M4 `npm run dev` step; M5 registry +3 rows (login/MFA, file GET, export ceiling); M6 registry anchors → README; L1 import curl chain; L2 runtime default `internal_error`; L3 AGENTS.md pointer; L4 `db/migrate-all.sh` name note; L5 known-limit line; L6a n=1 noted, L6b compose header comment, L6c scorecard conditional on C1.
<!-- /autoplan-accepted:dx -->

### Accepted obligations (phase eng)

<!-- autoplan-accepted:eng -->
- Phase 3 (autoplan) ran plan-eng-review round 2 on the final amended plan: methodology read 4/4 ranges (1999 lines), native voice dispatched via official `create` snapshot (`INPUT: eng 962a2b01…`, sha matched), 21 findings A1–A4 / X1–X4 / T1–T5 / S1–S5 / H1–H3 — all dispositioned as plan-text amendments; outside providers dead (codex 401 + no git; Claude CLI OAuth expired) → [subagent-only]; 0 unresolved this review.
- Pre-P3 critical set accepted: X1 import row cap (50,000 rows/batch — Parse → 4xx + frozen message, D18 knob row); A2 preview persistence (parsed rows persisted at Parse — `import_batches.parsed jsonb` or `import_batch_rows`; pages/CSV/Resume/error-CSV read persisted rows; restart-session resume test); H2+T3 server-side typed confirm (execute recomputes create count inside the tx — `typedCount` mismatch → 4xx test).
- Lifecycle + tx rules accepted: A1 write-through to `storage/uploads/` at Upload (write file → `files` row → Parse; execute flips batch state; disk-before-tx order per H1 — tx fail keeps the original, post-commit file-missing test; orphan sweep → TODOS); A4 `SET LOCAL statement_timeout` in the execute tx + single-flight import execute (pg advisory lock) + ALS-detached helper test; A3 export row-cap guard (D18 knob row — abort → non-2xx → banner).
- TOCTOU + transport accepted: X2 execute re-validates `job_number`s inside the tx (downgrade to skip — never raw SQL failure) with insert-after-preview test; X3 chunked-body 413 streaming guard + test; X4 session-expiry → re-login → Resume integration test.
- Test hardening accepted: T1 M4 assert across all 9 views; T2 reconciliation spot-assert of sampled rows (job_number, customer, date); T5 discard→resume→confirm CAS state-machine matrix; T4 path-traversal test (DB-key-only lookup, `../../etc/passwd` → 404); S2 CSV formula-injection neutralization (leading `=`/`+`/`-`/`@` prefixed — inert round-trip fixture); S3 dev-500 gated on `NODE_ENV === "development"` (unset must not leak; dev/prod/unset tested).
- Security split accepted: S1 — CSRF strategy + upload authz/rate-limit subset of T13 clears at P3 close (first stateful admin write); cookie flags/fixation/full rate-limit stay pre-P4; S5 storage retention/quota (orphan upload sweep + quota posture) added to TODOS.md.
- H3 export writer wording: ExcelJS in-memory workbook → buffer-then-send (streaming only if the C4 spike demands it); P4 bullet amended.
- Verification for this phase: lint + tsc + 195 tests green after amendments (plan text only); T2/T4/T5/T9/T13/T20/T21 carry the new obligations; D18 knob table carries row-cap + export-cap rows; P3 DoD carries the T13 subset; TODOS.md carries the storage entry; report Eng row + OUTSIDE COVERAGE + VERDICT updated; 0 unresolved.
<!-- /autoplan-accepted:eng -->

### Baseline edits (phase ceo, round 1 — applied, archived)

```history
<!-- autoplan-baseline-edits:ceo {"sourceSha256":"de19841677dd224058c0cd16e58cafc9d77d9f87b84906ef9fbeb4f064b536e5","replacements":[{"oldText":"**DoD:** [11A] **E3, E4, E5, E6** green; FX-1…11 import through real route handlers + reconciliation **automated Δ=0**; import error-path rows green; permission probe green.","newText":"**DoD:** [11A] **E3, E4, E5, E6** green; FX-1…11 import through real route handlers + reconciliation **automated Δ=0**; import error-path rows green; permission probe green.\n- **[C3 · CEO 1.1/4.1]** Data-format gate: when the legacy export arrives, run `analyze-backup.mjs` BEFORE execute work; if format is CSV/XLSX, settle converter-vs-extend-parser first (JSON shapes A–D remain the MVP import contract).\n- **[C2 · CEO 1.1/1.2/2.9]** FX-only Δ=0 proves spec conformance, not business correctness: P3 close also requires one dry-run import of a real/sample dataset through the same route handlers (reconciliation Δ=0) when data is available."},{"oldText":"- [ ] **T9 (P1, human: ~1d / CC: ~3h)** — export — Generic `/api/exports/[view]`: 9-view enum, ExcelJS, single-query-per-view, M4 write-time stripping","newText":"- [ ] **T9 (P1, human: ~1d / CC: ~3h)** — export — Generic `/api/exports/[view]`: 9-view enum, ExcelJS, single-query-per-view, M4 write-time stripping (first step **[C4]**: 30-min ExcelJS spike — 500-row workbook, record peak RSS + wall time)"},{"oldText":"- **Export file storage/persistence** — exports stream and discard; no export history table.","newText":"- **Export file storage/persistence** — exports stream and discard; no export history table.\n- **Operator demo at P3 close (C5)** — deferred to TODOS.md: needs staff time; owner schedules (CEO 3.3 adoption loop).\n- **Rule-ID/review-date tagging + rule audit at first real import (C6)** — deferred to TODOS.md: provenance hygiene, not a blocker.\n- **Adoption/success metric definition (C7)** — deferred to TODOS.md: metric is user-defined.\n- **Build-vs-buy kill-criterion / revisit checkpoint (C9)** — deferred to TODOS.md: strategy checkpoint before P5 integrations."},{"oldText":"Kickoff → P1 ✅ → P1.5 (withTransaction + dep cleanup) → P2 ✅ → P3 → P4 → (P5 when prereqs green)","newText":"Kickoff → P1 ✅ → P1.5 (withTransaction + dep cleanup) → P2 ✅ → P3 → P4 → (P5 when prereqs green)\n                                  └── [C1 USER CHALLENGE → Phase 4 gate] git init + remote + baseline commit (prereq for T8 CI); user rule \"no commits unless asked\" stands until approved ──┘\n                                  └── NOTE: P2 shipped BEFORE P1.5 — the 5 spec-atomic sites are non-atomic in shipped code until T1 lands; run T1 before any import execute ──┘"},{"oldText":"| CI | Local-green/CI-red (PG version/env mismatch) | — | postgres service block in workflow | Red badge instead of silent merge |","newText":"| CI | No repo/remote exists — workflow cannot run at all (CEO 2.1 / C1) | — | **C1 gate: git init + remote before T8** | Workflow absent until C1 approved |\n| CI | Local-green/CI-red (PG version/env mismatch) | — | postgres service block in workflow | Red badge instead of silent merge |"}]} -->
```

### Baseline edits (phase ceo, round 2 — applied, archived)

```history
<!-- autoplan-baseline-edits:ceo {"sourceSha256":"4e0c52df4093213819216027a8fb5db08bec574176e2d4032d88820263876bb1","replacements":[{"oldText":"- **[C3 · CEO 1.1/4.1]** Data-format gate: when the legacy export arrives, run `analyze-backup.mjs` BEFORE execute work; if format is CSV/XLSX, settle converter-vs-extend-parser first (JSON shapes A–D remain the MVP import contract).","newText":"- **[C2 · CEO 1.1/4.1] DoD gate — real-data execute only:** when the legacy export arrives, run `analyze-backup.mjs` BEFORE any real-data execute work; if format is CSV/XLSX, settle converter-vs-extend-parser first (JSON shapes A–D remain the MVP import contract). Fixture execute in P3 is unaffected."},{"oldText":"- **[C2 · CEO 1.1/1.2/2.9]** FX-only Δ=0 proves spec conformance, not business correctness: P3 close also requires one dry-run import of a real/sample dataset through the same route handlers (reconciliation Δ=0) when data is available.","newText":"- **[C3 · CEO 1.1/2.9] DoD gate (conditional):** FX-only Δ=0 proves spec conformance, not business correctness: P3 close also requires one dry-run import of a real/sample dataset through the same route handlers (reconciliation Δ=0) when data is available."},{"oldText":"- [ ] **T8 (P1, human: ~30min / CC: ~10min)** — ci — Add `.github/workflows/ci.yml` (lint + typecheck + test, postgres service)\n  - Surfaced by: Architecture — P1 promised CI (plan line 26), none exists\n  - Files: `.github/workflows/ci.yml`\n  - Verify: workflow run green (needs postgres service + migration step)","newText":"- [ ] **T8 (P1, human: ~30min / CC: ~10min)** — ci — Add `.github/workflows/ci.yml` (lint + typecheck + test, postgres service)\n  - Surfaced by: Architecture — P1 promised CI (plan line 26), none exists\n  - Blocked on C1 (git repo + remote; Phase 4 gate) — conditional until approved\n  - Files: `.github/workflows/ci.yml`\n  - Verify: `ci.yml` valid; lint/typecheck/test commands run green locally; first workflow run deferred until C1 exists"},{"oldText":"| T8 CI | `.github/` | — |","newText":"| T8 CI | `.github/` | C1 (repo+remote — Phase 4 gate) |"},{"oldText":"- **Lane A:** T8 → T7 (tiny, independent)","newText":"- **Lane A:** T7 alone (tiny); T8 parked until C1 approved (repo exists)"},{"oldText":"- [ ] **T11 (P3, human: ~10min / CC: ~5min)** — todo — Create `TODOS.md` with dev-DB drift item (compose unused vs Homebrew vs CI postgres:18)\n  - Surfaced by: TODO candidate 1 (approved A)\n  - Files: `TODOS.md`\n  - Verify: file exists, format matches `TODOS-format.md`","newText":"- [ ] **T11 (P3, human: ~20min / CC: ~10min)** — todo — Create/extend `TODOS.md` with six entries: dev-DB drift (compose unused vs Homebrew vs CI postgres:18), legacy data acquisition owner+deadline [D12], operator demo at P3 close [C5], rule tagging + first-real-import audit [C6], adoption/success metric [C7], build-vs-buy revisit checkpoint [C9]\n  - Surfaced by: TODO candidate 1 (approved A) + CEO D5–D7, D9, D12\n  - Files: `TODOS.md`\n  - Verify: file exists, format matches `TODOS-format.md`, all six entries present\n- [ ] **T12 (P1, human: ~5min / CC: ~2min)** — gate — Surface the C1 decision (git init + remote + baseline commit + branch protection) at the Phase 4 approval gate; approved → unblocks T8, rejected → T8 deferred to TODOS.md with CI out of scope\n  - Surfaced by: CEO Step 0 D1/C1 (User Challenge — never auto-decided)\n  - Files: to be determined (gate decision recorded in Review record)\n  - Verify: Phase 4 gate output names the C1 decision explicitly"},{"oldText":"Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.","newText":"Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.\n  Priority tags: **P1** blocks ship · **P2** same branch · **P3** follow-up/TODO — priorities, not phase numbers (execution phase: T1→P1.5; T2–T6, T8→P3; T9, T10→P4)."},{"oldText":"- **VERDICT:** ENG CLEARED — ready to implement (T1→T11 order in Implementation Tasks).","newText":"- **VERDICT:** ENG CLEARED — ready to implement (T1→T12 order in Implementation Tasks; T8 conditional on C1 [Phase 4 gate])."},{"oldText":"lint + typecheck + tests green before each phase closes · **CI (`.github/workflows/ci.yml`) runs all three on every push [2A]** · no commits unless asked ·","newText":"lint + typecheck + tests green before each phase closes · **CI (`.github/workflows/ci.yml`) runs all three on every push [2A] — conditional on C1 (repo+remote exist); until approved the same three run locally at each phase close** · no commits unless asked ·"}]} -->
```

### Baseline edits (phase ceo, round 3 — applied, archived)

```history
<!-- autoplan-baseline-edits:ceo {"sourceSha256":"05a2cc921bba4d89598b52273391900783c1047c71793338deb7df9091ded7da","replacements":[{"oldText":"> Review revisions applied: stack/layout corrected to as-built (1A), CI moved into P3 (2A), `import_batches.version` added (3A), upload cap (4A), import = Admin/Ops (5A), import diagram + failure lines (6A), `withTransaction` (7A), dead deps removed (8A), export view enum fixed (9A), test mapping fixed (10A), E-rule DoD split (11A), UAT checkpoint formalized (12A), import error-path tests (13A), automated reconciliation (14A), export test depth (15A), single-query export mandate (16A), readiness rebuild on import (17A), ExcelJS chosen.","newText":"> Review revisions applied: stack/layout corrected to as-built (1A), CI moved into P3 (2A), `import_batches.version` added (3A), upload cap (4A), import = Admin/Ops (5A), import diagram + failure lines (6A), `withTransaction` (7A), dead deps removed (8A), export view enum fixed (9A), test mapping fixed (10A), E-rule DoD split (11A), UAT checkpoint formalized (12A), import error-path tests (13A), automated reconciliation (14A), export test depth (15A), single-query export mandate (16A), readiness rebuild on import (17A), ExcelJS chosen.\n\n**Line refs:** `plan line N` = this document's 2026-09-30 original revision (pre-review); `spec §N` = design spec 2026-09-27. **C-labels:** bare `C1–C4` in DoD/test tables = rule-register customer rules; `CEO C1–C9` = Phase-1 scope proposals (Step 0 ledger)."},{"oldText":"**UAT checkpoint [12A]:** retro-log §14 coverage row in `08-open-items-tracker.md` (which §14 rows map to shipped tests; remaining rows → P4 `tests/uat.test.ts`).","newText":"**UAT checkpoint [12A]:** retro-log §14 coverage row in `08-open-items-tracker.md` (which §14 rows map to shipped tests — written by T10 at P4; remaining rows → P4 `tests/uat.test.ts`)."},{"oldText":"- **[17A]** After batch commit: `updateReadinessCache(jobId)` per imported job (one pass); reconciliation asserts `readiness_cache` non-null + FX-5 colours.","newText":"- **[17A]** During execute, inside the batch transaction: `updateReadinessCache(jobId)` per imported job (one pass — same tx as import, no post-commit crash window); reconciliation asserts `readiness_cache` non-null + FX-5 colours."},{"oldText":"| `phase0/01` rules — **all 76 IDs: A1–A5, B1–B6, C1–C4, D1–D10, E1–E7, G1–G8, J1–J9, L1–L5, M1–M4, P1–P9, S1–S10** | unit/integration test files per domain, one per rule ID |","newText":"| `phase0/01` rules — **all 77 IDs: A1–A5, B1–B6, C1–C4, D1–D10, E1–E7, G1–G8, J1–J9, L1–L5, M1–M4, P1–P9, S1–S10** (verified 2026-10-01; prototype F-findings in the register are not rule IDs) | unit/integration test files per domain, one per rule ID |"},{"oldText":"**CI (`.github/workflows/ci.yml`) runs all three on every push [2A] — conditional on C1 (repo+remote exist); until approved the same three run locally at each phase close**","newText":"**CI (`.github/workflows/ci.yml`) runs all three on every push [2A] — conditional on CEO C1 (repo+remote exist); until approved the same three run locally at each phase close**"},{"oldText":"└── [C1 USER CHALLENGE → Phase 4 gate] git init + remote + baseline commit (prereq for T8 CI); user rule \"no commits unless asked\" stands until approved ──┘","newText":"└── [CEO C1 USER CHALLENGE → autoplan Phase 4 approval gate (pre-execution)] git init + remote + baseline commit (prereq for T8 CI); user rule \"no commits unless asked\" stands until approved ──┘"},{"oldText":"└── UAT: P2 retro-log at P3 close, full §14 at P4 ──┘","newText":"└── UAT: P2 retro-log via T10 (both rows at P4), full §14 at P4 ──┘"},{"oldText":"| withTransaction refactor | Behaviour drift in 5 wrapped sites (e.g. lost audit row) | 195 existing tests + new rollback test | ROLLBACK on throw | — (caught in CI [2A]) |","newText":"| withTransaction refactor | Behaviour drift in 5 wrapped sites (e.g. lost audit row) | 195 existing tests + new rollback test | ROLLBACK on throw | — (caught locally; CI once CEO C1 approved [2A]) |"},{"oldText":"| **C1 gate: git init + remote before T8** | Workflow absent until C1 approved |","newText":"| **CEO C1 gate: git init + remote before T8** | Workflow absent until CEO C1 approved |"},{"oldText":"| T8 CI | `.github/` | C1 (repo+remote — Phase 4 gate) |","newText":"| T8 CI | `.github/` | CEO C1 (repo+remote — autoplan Phase 4 gate) |"},{"oldText":"- **Lane A:** T7 alone (tiny); T8 parked until C1 approved (repo exists)","newText":"- **Lane A:** T7 alone (tiny); T8 parked until CEO C1 approved (repo exists)"},{"oldText":"| T9/T15 export + uat | `app/api/exports`, `lib/services/export`, `tests/` | — (parallel to P3) |","newText":"| T9/T10 export + uat | `app/api/exports`, `lib/services/export`, `tests/` | — (parallel to P3) |"},{"oldText":"  - Blocked on C1 (git repo + remote; Phase 4 gate) — conditional until approved","newText":"  - Blocked on CEO C1 (git repo + remote; autoplan Phase 4 approval gate, pre-execution) — conditional until approved"},{"oldText":"- [ ] **T12 (P1, human: ~5min / CC: ~2min)** — gate — Surface the C1 decision (git init + remote + baseline commit + branch protection) at the Phase 4 approval gate; approved → unblocks T8, rejected → T8 deferred to TODOS.md with CI out of scope\n  - Surfaced by: CEO Step 0 D1/C1 (User Challenge — never auto-decided)\n  - Files: to be determined (gate decision recorded in Review record)\n  - Verify: Phase 4 gate output names the C1 decision explicitly","newText":"- [ ] **T12 (P1, human: ~5min / CC: ~2min)** — gate — Surface the CEO C1 decision (git init + remote + baseline commit + branch protection) at the autoplan Phase 4 approval gate (pre-execution); approved → unblocks T8; rejected → T12 appends a seventh entry to TODOS.md deferring CI/T8 (CI out of scope)\n  - Surfaced by: CEO Step 0 D1/C1 (User Challenge — never auto-decided)\n  - Files: `docs/superpowers/plans/2026-09-30-fanela-implementation-plan.md` (Review record) + `TODOS.md` if rejected\n  - Verify: autoplan Phase 4 gate output names the CEO C1 decision explicitly; if rejected, TODOS.md carries the CI deferral"},{"oldText":"| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | NOT RUN | — |","newText":"| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | RUNNING (Step 0 + 2 spec-loop iterations done; native voice re-dispatch next) | Step-0 scope: 3 accepted, 4 deferred, 1 declined, 1 user challenge (CEO C1) |"},{"oldText":"- **VERDICT:** ENG CLEARED — ready to implement (T1→T12 order in Implementation Tasks; T8 conditional on C1 [Phase 4 gate]).","newText":"- **VERDICT:** ENG CLEARED — ready to implement (T1→T12 order in Implementation Tasks; T8 conditional on CEO C1 [autoplan Phase 4 approval gate])."},{"oldText":"NO UNRESOLVED DECISIONS","newText":"No decisions required this phase; CEO C1 pending at the autoplan Phase 4 approval gate."}]} -->

```

### Baseline edits (phase ceo, round 4)

<!-- autoplan-baseline-edits:ceo {"sourceSha256":"77db8c0898d80fe23d94cc6614318f60b3f8e3afb3216d4b52907527a6b7d4d9","replacements":[{"oldText":"**DoD:** full rule register 01 green; invalid transitions → 422; concurrency tests; FX-5 passes. ✅","newText":"**DoD:** P2-scope register IDs green (A, B, C, D, G, J, L, P, S); E and M complete at P3/P4; invalid transitions → 422; concurrency tests; FX-5 passes. ✅"},{"oldText":"- **[C2 · CEO 1.1/4.1] DoD gate — real-data execute only:** when the legacy export arrives, run `analyze-backup.mjs` BEFORE any real-data execute work; if format is CSV/XLSX, settle converter-vs-extend-parser first (JSON shapes A–D remain the MVP import contract). Fixture execute in P3 is unaffected.","newText":"- **[CEO C2 · 1.1/4.1] DoD gate — real-data execute only:** as soon as any legacy sample exists (owner via D12; target: before T3/T4 build), run `analyze-backup.mjs`; before any real-data execute, if the format is CSV/XLSX, settle converter-vs-extend-parser first (JSON shapes A–D remain the MVP import contract). Fixture execute in P3 is unaffected."},{"oldText":"- **[C3 · CEO 1.1/2.9] DoD gate (conditional):** FX-only Δ=0 proves spec conformance, not business correctness: P3 close also requires one dry-run import of a real/sample dataset through the same route handlers (reconciliation Δ=0) when data is available.","newText":"- **[CEO C3 · 1.1/2.9] DoD gate (conditional):** FX-only Δ=0 proves spec conformance, not business correctness: P3 close also requires one dry-run import of a real/sample dataset through the same route handlers (reconciliation Δ=0) when data is available; if still unavailable at P3 close, P4 close requires a named owner + date recorded in `TODOS.md` (hard gate, no silent skip)."},{"oldText":"· **Lane D:** P4 export suite (shares only `tests/` naming — parallel to C after T1).","newText":"· **Lane D:** P4 export suite (shares only `tests/` naming — parallel to C, no T1 dependency)."},{"oldText":"- **Conflict flags:** T1 and P3 both touch `lib/services/` — run T1 first, not concurrent. Lanes C and D both add `tests/*.test.ts` — distinct files, low risk.","newText":"- **Conflict flags:** T1 and P3 both touch `lib/services/` — run T1 first, not concurrent. Lanes C and D both add `tests/*.test.ts` — distinct files, low risk. T9 (export) reads live P2 data only — no import-data dependency, may start at P3 entry for early value (outside F12)."},{"oldText":"- **[13A]** `tests/rules-e.test.ts` explicit rows: (1) shape A/B/C → preview renders; (2) shape D → 4xx + exact F9 message string; (3) FX-9 four classes each flagged (dup job_number → skip, bad date → error, orphan ref → error/warn, blank SKU → error); (4) mid-execute SQL failure → rollback + `failed` + `errors[]`.","newText":"- **[13A]** `tests/rules-e.test.ts` explicit rows, contract-faithful to `phase0/05 §2`: (1) shape A/B/C → preview renders; (2) shape D → 4xx + exact F9 message string; (3) FX-9 severities per `05 §2` — new dup job_number → error (block row), existing-in-DB job_number → skip (E3), bad date → error, orphan ref → warn, blank SKU → warn — preview places rows by severity (create/skip/error counted; warn/info listed with badge, non-blocking); (4) mid-execute SQL failure → rollback + `failed` + `errors[]`; (5) E4: import writes no swatch/shipment/photo/audit-history rows (table-count asserts); (6) cancel at preview → zero writes."},{"oldText":"- **[15A]** Tests: unknown view → 4xx (no default fallthrough); 9 views × 7 roles allow/deny (reuse `assertClasses` probe pattern); **byte-level M4 assert** — generated workbook for Office/Dispatch/Packing/dept contains no cost column.","newText":"- **[15A]** Tests: unknown view → 4xx (no default fallthrough); 9 views × 7 roles allow/deny (reuse `assertClasses` probe pattern); **M4 assert re-parses the workbook** (exceljs re-read + sharedStrings/cell scan — raw byte scan of a zipped xlsx is vacuously green): generated workbook for Office/Dispatch/Packing/dept contains no cost column (`Buying Cost`, `unit_price`) across jobs/filtered-jobs/department views; **E7**: audit export hides order-lines cost rows; **E2**: report snapshot rows immutable after job edit."},{"oldText":"**DoD:** [11A] **E1, E2, E7** + export-permission matrix tests; **M1–M4** green (M4 proven at file level); uat.test.ts green.","newText":"**DoD:** [11A] **E1, E2, E7** + export-permission matrix tests; **M1–M4** green (M1–M3 via `tests/rules-m.test.ts`, M4 proven at file level by re-parsing the workbook); uat.test.ts green."},{"oldText":"| `phase0/01` rules — **all 77 IDs: A1–A5, B1–B6, C1–C4, D1–D10, E1–E7, G1–G8, J1–J9, L1–L5, M1–M4, P1–P9, S1–S10** (verified 2026-10-01; prototype F-findings in the register are not rule IDs) | unit/integration test files per domain, one per rule ID |","newText":"| `phase0/01` rules — **all 77 IDs: A1–A5, B1–B6, C1–C4, D1–D10, E1–E7, G1–G8, J1–J9, L1–L5, M1–M4, P1–P9, S1–S10** (verified 2026-10-01; prototype F-findings in the register are not rule IDs) | unit/integration test files per domain, one per rule ID where testable; **B1/B2/L4 are ops checks — verified via the prod-ops runbook TODOS entry, not tests** |"},{"oldText":"| Export | Cost columns leak to Office/Dispatch/dept (M4 violation) | [15A] byte-level workbook assert | Write-time column selection | — (prevented) |","newText":"| Export | Cost columns leak to Office/Dispatch/dept (M4 violation) | [15A] parse-based workbook assert (exceljs re-read) | Write-time column selection | — (prevented) |"},{"oldText":"| Import upload | 30MB dump → OOM/truncation → parse-garbage masquerading as validation error | [4A] 413 test + truncation spike | Early size check | Clear 413 |","newText":"| Import upload | 30MB dump → OOM/truncation → parse-garbage masquerading as validation error | [4A] 413 test + truncation spike | Early size check | Clear 413 |\n| Import → storage | Original file not persisted (no backend) → `files` row points at nothing; E5 passes vacuously | T4 persistence test (file readable from `storage/uploads/` after execute) | Local-disk write inside execute; fail → batch failed | Batch row failed + message |"},{"oldText":"**Critical gaps:** 0 — every flagged gap has both a test and error handling assigned above.","newText":"**Critical gaps:** 0 in this table — every row has both a test and error handling; structural risks live in the Phase-1 Review record (CEO C1 gate pending; adoption/ops items in `TODOS.md`)."},{"oldText":"real-data late arrival runs `analyze-backup.mjs` + P3 screen unchanged.","newText":"real-data late arrival runs `analyze-backup.mjs` (output records file type, record count, estimated manual re-entry hours vs pipeline cost) + P3 screen unchanged."},{"oldText":"- **[12A]** `tests/uat.test.ts`: spec §14 acceptance suite (Excel round-trip row, MFA row, remaining un-taken checkpoint rows).","newText":"- **[12A]** `tests/uat.test.ts`: spec §14 acceptance suite (Excel round-trip row, MFA row, remaining un-taken checkpoint rows).\n- **[CEO C7]** Success metric defined with a named owner before cutover (definition tracked in `TODOS.md`, P1; value is user-defined)."},{"oldText":"- DPD API (prereq D1–D6), Xero (X1–X5) via outbox — **reinstall pg-boss here**; notifications/dashboards after schema stable.","newText":"- DPD API (prereq D1–D6), Xero (X1–X5) via outbox — **reinstall pg-boss here**; notifications/dashboards after schema stable. Cutover plan (target date, parallel-run exit criteria, legacy-shutdown owner) required before go-live — tracked in `TODOS.md`."},{"oldText":"- **Build-vs-buy kill-criterion / revisit checkpoint (C9)** — deferred to TODOS.md: strategy checkpoint before P5 integrations.","newText":"- **Build-vs-buy kill-criterion / revisit checkpoint (CEO C9)** — deferred to TODOS.md: objective kill triggers recorded now; **review at P3 close, before P5 integrations** (native R5 amendment)."},{"oldText":"- **[14A]** Reconciliation **automated**: `tests/reconciliation.test.ts` imports FX-1…11 through the same route handlers the screen calls → per-table count assertions → Δ=0 (FX-10 500 jobs, generous timeout).","newText":"- **[14A]** Reconciliation **automated**: `tests/reconciliation.test.ts` imports FX-1…11 through the same route handlers the screen calls → per-table count assertions → Δ=0 (FX-10 500 jobs; explicit per-test timeout override — vitest default `testTimeout: 15_000` is not generous enough)."},{"oldText":"- **Export file storage/persistence** — exports stream and discard; no export history table.","newText":"- **Export file storage/persistence** — exports stream and discard; no export history table (deviates from spec L422 pg-boss→MinIO signed-URL design — accepted Step-0 streaming decision; spec update pending).\n- **MinIO/S3 for uploaded import files** — MVP stores originals on local disk (`storage/uploads/`, E5); object-store migration checkpoint in `TODOS.md` when multi-instance hosting appears."},{"oldText":"- [ ] **T1 (P1, human: ~3h / CC: ~30min)** — db/lib — Add `withTransaction` and wrap 5 spec-atomic sites + failure-injection test\n  - Surfaced by: Code quality — spec line 406 atomicity vs `lib/db.ts` query()-only multi-writes (stock.ts:45/266/271 etc.)\n  - Files: `lib/db.ts`, `lib/services/{stock,stages,swatch,dispatch,artwork}.ts`\n  - Verify: `npm test` (195 green) + new rollback test","newText":"- [ ] **T1 (P1, human: ~3h / CC: ~30min)** — db/lib — Add `withTransaction` + **ambient transaction client in `query()`** (`query()` hardwires `pool.query`; use AsyncLocalStorage context so services/audit/readiness called inside `fn` run on the tx client, not a different session) and wrap 5 spec-atomic sites + failure-injection test\n  - Surfaced by: Code quality — spec line 406 atomicity vs `lib/db.ts` query()-only multi-writes (stock.ts:45/266/271 etc.); outside F1 (mechanism unstated → [17A] rebuild would read outside the tx)\n  - Files: `lib/db.ts`, `lib/services/{stock,stages,swatch,dispatch,artwork}.ts`, `db/schema/audit.ts` (audit writes inside tx)\n  - Verify: `npm test` (195 green) + rollback test + same-session assertion: batch execute's audit row + `updateReadinessCache` observe uncommitted tx state"},{"oldText":"- [ ] **T2 (P1, human: ~1h / CC: ~10min)** — db — Add `import_batches.version` + CAS guard on confirm/execute\n  - Surfaced by: Architecture — spec line 405 per-sub-entity version missing (`db/schema/audit.ts:38-49`)\n  - Files: `db/migrations/`, `lib/services/import.ts`\n  - Verify: double-confirm 409 test, stale-version 409 test","newText":"- [ ] **T2 (P1, human: ~1h / CC: ~10min)** — db — Add `import_batches.version` + CAS guard on confirm/execute (version bumps on re-upload/re-preview — a content change — so a stale preview cannot execute)\n  - Surfaced by: Architecture — spec line 405 per-sub-entity version missing (`db/schema/audit.ts:38-49`); outside F9 (semantics undefined)\n  - Files: `db/migrations/`, `db/schema/audit.ts`, `lib/services/import.ts` (created by T4 — land the guard with T4)\n  - Verify: double-confirm 409 test; re-preview → stale-confirm 409 test (exercises a real version bump)"},{"oldText":"- [ ] **T4 (P1, human: ~1d / CC: ~3h)** — import — Import pipeline (service+route+UI) per diagram: atomic execute, readiness rebuild, audit+batch row","newText":"- [ ] **T4 (P1, human: ~1d / CC: ~3h)** — import — Import pipeline (service+route+UI) per diagram: atomic execute, readiness rebuild, audit+batch row, **original-file persistence to `storage/uploads/` (local disk, non-web-served; `files.bucket='local'` + relative key) [E5]**"},{"oldText":"  - Files: `lib/services/import.ts`, `app/api/admin/import/route.ts`, import UI","newText":"  - Files: `lib/services/import.ts`, `app/api/admin/import/route.ts`, `app/(app)/admin/import/page.tsx`, `storage/uploads/`"},{"oldText":"  - Verify: `npm test` — E3/E5/E6 rows + readiness colours","newText":"  - Verify: `npm test` — E3/E5/E6 rows + readiness colours + uploaded file readable from `storage/uploads/` after execute"},{"oldText":"- [ ] **T8 (P1, human: ~30min / CC: ~10min)** — ci — Add `.github/workflows/ci.yml` (lint + typecheck + test, postgres service)","newText":"- [ ] **T8 (P1, human: ~30min / CC: ~10min)** — ci — Add `.github/workflows/ci.yml` (lint + typecheck + test, postgres 18 service + bootstrap: `db:migrate` + `db:security` + `db:seed` with `DATABASE_URL` — without these the first run is red regardless of CEO C1)"},{"oldText":"- [ ] **T9 (P1, human: ~1d / CC: ~3h)** — export — Generic `/api/exports/[view]`: 9-view enum, ExcelJS, single-query-per-view, M4 write-time stripping (first step **[C4]**: 30-min ExcelJS spike — 500-row workbook, record peak RSS + wall time)","newText":"- [ ] **T9 (P1, human: ~1d / CC: ~3h)** — export — Generic `/api/exports/[view]`: 9-view enum, ExcelJS, single-query-per-view, M4 write-time stripping (first step **[CEO C4]**: 60-min ExcelJS spike — 10k-row workbook with styling + the M4 column-strip running on the production writer path, record peak RSS + wall time)"},{"oldText":"  - Verify: `npm test` — export matrix + unknown-view 4xx","newText":"  - Verify: `npm test` — export matrix + unknown-view 4xx + `tests/rules-m.test.ts` (M1–M3 cost-gate rows; M4 via parse-based workbook assert)"},{"oldText":"- [ ] **T11 (P3, human: ~20min / CC: ~10min)** — todo — Create/extend `TODOS.md` with six entries: dev-DB drift (compose unused vs Homebrew vs CI postgres:18), legacy data acquisition owner+deadline [D12], operator demo at P3 close [C5], rule tagging + first-real-import audit [C6], adoption/success metric [C7], build-vs-buy revisit checkpoint [C9]\n  - Surfaced by: TODO candidate 1 (approved A) + CEO D5–D7, D9, D12\n  - Files: `TODOS.md`\n  - Verify: file exists, format matches `TODOS-format.md`, all six entries present","newText":"- [x] **T11 (P3, human: ~20min / CC: ~10min)** — todo — Create/extend `TODOS.md` with eight entries: dev-DB drift (compose unused vs Homebrew vs CI postgres:18), legacy data acquisition owner+deadline [D12, P0], operator demo at P3 close [C5], rule tagging + first-real-import audit [C6], adoption/success metric [C7], build-vs-buy revisit checkpoint [C9, review at P3 close], cutover plan [native R4], prod-ops runbook [native R11]\n  - Surfaced by: TODO candidate 1 (approved A) + CEO D5–D7, D9, D12 + native R4/R11\n  - Files: `TODOS.md`\n  - Verify: file exists, format matches gstack `review/TODOS-format.md` (`~/.claude/skills/gstack/review/`), all eight entries present — done 2026-10-01 in Phase 1"},{"oldText":"- [ ] **T12 (P1, human: ~5min / CC: ~2min)** — gate — Surface the CEO C1 decision (git init + remote + baseline commit + branch protection) at the autoplan Phase 4 approval gate (pre-execution); approved → unblocks T8; rejected → T12 appends a seventh entry to TODOS.md deferring CI/T8 (CI out of scope)\n  - Surfaced by: CEO Step 0 D1/C1 (User Challenge — never auto-decided)\n  - Files: `docs/superpowers/plans/2026-09-30-fanela-implementation-plan.md` (Review record) + `TODOS.md` if rejected\n  - Verify: autoplan Phase 4 gate output names the CEO C1 decision explicitly; if rejected, TODOS.md carries the CI deferral","newText":"- [ ] **T12 (P1, human: ~5min / CC: ~2min)** — gate — Surface the CEO C1 decision at the autoplan Phase 4 approval gate **before execution starts (runs FIRST of T1–T12)**, three options: **A** full C1 (git init + remote + baseline commit + branch protection), **B** local-only baseline commit (no remote — strictly smaller ask, still needs your permission), **C** no git (T8/CI deferred; T12 appends a TODOS entry); approved → unblocks T8\n  - Surfaced by: CEO Step 0 D1/C1 (User Challenge — never auto-decided) + native R1 (local-git middle option) + outside F7 (gate ran last)\n  - Files: `docs/superpowers/plans/2026-09-30-fanela-implementation-plan.md` (Review record) + `TODOS.md` if rejected/C\n  - Verify: autoplan Phase 4 gate output names the CEO C1 decision and the chosen option explicitly; if rejected/C, TODOS.md carries the CI deferral"},{"oldText":"  Priority tags: **P1** blocks ship · **P2** same branch · **P3** follow-up/TODO — priorities, not phase numbers (execution phase: T1→P1.5; T2–T6, T8→P3; T9, T10→P4).","newText":"  Priority tags: **P1** blocks ship · **P2** same branch · **P3** follow-up/TODO — priorities, not phase numbers (execution order: **T12 gate FIRST at the autoplan Phase 4 approval gate**, then T1→P1.5; T3→T4 [T2 lands with T4], T5, T6, T7→P3; T9 may start at P3 entry — no data dependency; T10, T13→P4)."},{"oldText":"## GSTACK REVIEW REPORT","newText":"- [ ] **T13 (P2, human: ~1h / CC: ~15min)** — security — Pre-P4 auth security checklist: CSRF strategy on stateful handlers, cookie flags (SameSite/Secure/HttpOnly), upload endpoint authz, session fixation/rotation, rate-limit posture; record per-item pass/fail in the Review record, failures → tickets\n  - Surfaced by: Native CEO R6 — 195 tests prove behavior, not security\n  - Files: `lib/auth.ts`, `lib/http.ts`, `app/api/admin/import/route.ts`, `tests/`\n  - Verify: checklist completed pre-P4 with per-item result; any FAIL fixed or ticketed\n\n## Dream state delta\n\nWhat changes for Fanela Central when this plan lands (vs today: 195 tests, no import/export):\n\n- **Ops:** legacy job data lands via an Admin/Ops-only import screen (upload → preview → typed confirm → atomic execute, reconciliation Δ=0) instead of manual re-entry — once a legacy file arrives (CEO C2 gate; acquisition tracked P0 in TODOS).\n- **Anyone with export permission:** one generic `/api/exports/[view]` route serves all nine business views as .xlsx with role-scoped columns (M4 cost-gating enforced at write time).\n- **Queue:** imported jobs appear with correct readiness colours (in-tx rebuild [17A]) and audit rows.\n- **Unchanged by this plan:** dashboards, notifications, DPD/Xero (P5); production UX design (pipeline Phase 2); live-data validation (external dependency — TODOS P0).\n\n## Error & Rescue Registry\n\nImplementation-ready; Phase 3 re-verifies every row:\n\n| Method / operation | What can go wrong | Failure class | Rescued? | Rescue action | User sees |\n|---|---|---|---|---|---|\n| `ImportService#upload` | >25MB body, proxy-truncated body | size/truncation | yes | early check → 413; truncation spike guards Next 16 proxy | `413 file too large` |\n| `ImportService#upload` | disk write fails (space/permissions) | `StorageWriteError` (E5) | yes | batch → `failed`, no `files` row committed | batch row failed + message |\n| `ImportService#parse` | malformed JSON, unknown shape | `ShapeError` (F9) | yes | 4xx + exact message string | validation error text |\n| `ImportService#validate` | row-level contract violations | severity classes per `05 §2` | yes | preview flags rows; error rows block confirm | preview table with severities |\n| `ImportService#confirm` | stale batch (re-previewed or already executed) | CAS miss on `version`+`status` | yes | 409 + `current` payload | 409 conflict, reload prompt |\n| `ImportService#execute` | mid-batch SQL error | `SqlError` inside `withTransaction` | yes | ROLLBACK → batch `failed` + `errors[]` | batch row failed + errors |\n| `execute` → `updateReadinessCache` | cache write on a different session → invisible/lost | tx-session mismatch (outside F1) | yes | ambient tx client (T1) — same session | correct colours |\n| `execute` → file persist | storage write fails mid-execute | `StorageWriteError` | yes | rollback; original never silently lost | batch failed |\n| `ExportService#writeView` | unknown/typo view | `ViewError` | yes | strict enum → 4xx | 4xx message |\n| `ExportService#query` | per-row fan-out / row explosion | query-count guard [16A] | yes | single-query mandate + row-count test | slow/failed download caught in test |\n| `withTransaction` | throw inside `fn` | any | yes | ROLLBACK + re-raise | — (state unchanged) |\n| auth probes | anon / wrong-role access | `requirePermission` | yes | as-built 401/403 | 401/403 |\n\n## Scope Expansion Decisions\n\n- **Accepted (in blast radius, auto-decided):** CEO C2/C3/C4 gates; T13 security checklist; E5 local-disk storage; ambient tx client; contract-faithful [13A]/[15A] tests; T12-first ordering; deepened C4 spike — full list in the accepted obligations block (Review record).\n- **Deferred to `TODOS.md` (8 entries written 2026-10-01):** C5 demo, C6 tagging, C7 metric, C9 build-vs-buy (review at P3 close), D12 data acquisition (P0), cutover plan, prod-ops runbook, dev-DB drift.\n- **Skipped:** C8 dashboard (duplicate of P5 scope); UI/UX polish (pipeline Phase 2 owns it).\n- **User challenge (never auto-decided):** CEO C1 git baseline — options A/B/C at the autoplan Phase 4 approval gate.\n- Narrative: `ceo-plans/2026-10-01-fanela-central-import-export.md`.\n\n## Diagrams\n\n```text\nSystem architecture (as-built + this plan)\nBrowser ──► Next.js App Router (app/)\n             ├─ route handlers  app/api/{jobs,customers,exports,admin/import}/*\n             │    ├─ lib/http.ts  (requirePermission / requireAdminOrOps, err/toResponse)\n             │    └─ lib/auth.ts  (session cookies, Argon2id, TOTP pending_mfa)\n             ├─ lib/services/<domain> ── query() / withTransaction (ambient tx client) ──► PostgreSQL 18\n             │    import + export orchestrate Drizzle; RLS via db/security/*.sql\n             ├─ fixtures/generate.mjs (FX-1…11, P3)\n             ├─ storage/uploads/ (E5 originals, local disk, non-web-served)\n             └─ ExcelJS writer (.xlsx out, one SQL statement per view)\n```\n\n- **Data flow + error flow:** P3 pipeline diagram (§ P3: upload → … → result; failure → rollback + batch `failed`) — accurate post-17A.\n- **State machine:** `import_batches.status` enum + CAS `version` guard (§ P3 [3A]) — accurate.\n- **Rollback flow:** `withTransaction` BEGIN/COMMIT/ROLLBACK + ambient tx client (§ P1.5 + T1) — accurate.\n- **Sequence:** § 5 fence (P2-before-P1.5 note, CEO C1 gate, UAT via T10) — accurate.\n\n### Stale diagram audit (2026-10-01)\n\n| Diagram | Touched in round 4? | Verdict |\n|---|---|---|\n| System architecture (above) | new | fresh |\n| P3 pipeline | no (already in-tx wording) | fresh |\n| Sequence fence | no | fresh |\n| Failure table + critical-gaps line | reworded | fresh |\n| TODOS items | 8 entries written | fresh |\n\n## Completion Summary — Phase 1 (CEO plan review)\n\n```text\n+===== AUTOPLAN PHASE 1 COMPLETION SUMMARY ======================+\n| System audit ........... 195 tests green, no VCS, no CI,        |\n|                          no live data, dev-DB drift (TODOS)      |\n| Mode ................... SELECTIVE EXPANSION (0D: none needed)   |\n| Sections reviewed ...... 11 of 11 + Step 0 + voices             |\n| Spec loop .............. 3 iterations, scores 7/8/8, stopped     |\n|                          per rule; 30 issues, 24 fixed, 6 →      |\n|                          round 4                                |\n| Voices ................. native CEO ×2 (last: approve with       |\n|                          amendments, 16 findings); outside       |\n|                          fallback ×1 (12 findings, revise-       |\n|                          before-implement verdict); codex        |\n|                          UNAVAILABLE (401 + no git)              |\n| Round-4 dispositions ... S4 (6 residuals) + D13–D37 (25) = 31;   |\n|                          block4 + approval PASS recorded         |\n| Scope proposals ........ 9: 3 accepted, 4 deferred, 1 declined,  |\n|                          1 user challenge (CEO C1)               |\n| TODOS updates .......... 8 items written (1 converted + 7 new)   |\n| Failure modes .......... 11 rows + E5 storage row; 0 critical    |\n|                          gaps (table-scoped claim)               |\n| Error/rescue registry .. 12 operations, all rescued + tested     |\n| Diagrams ............... 1 new + 4 verified; 0 stale             |\n| Approval readiness ..... PASS (ledger rows M, D1–D12, S2–S4,     |\n|                          V1, D13–D37)                            |\n| Lake score ............. N/A (auto-decided under /autoplan)      |\n| Unresolved decisions ... 1: CEO C1 options A/B/C @ Phase 4 gate  |\n| VERDICT ................ ENGINEERING + STRATEGY CLEAR pending    |\n|                          CEO C1 gate decision; ready to          |\n|                          implement after Phase 4                 |\n+==================================================================+\n```\n\n## GSTACK REVIEW REPORT"},{"oldText":"| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | RUNNING (Step 0 + 2 spec-loop iterations done; native voice re-dispatch next) | Step-0 scope: 3 accepted, 4 deferred, 1 declined, 1 user challenge (CEO C1) |","newText":"| CEO Review | `/plan-ceo-review` | Scope & strategy | 5 (Step 0 + 3 spec-loop + 2 native voices) | ISSUES OPEN (1: CEO C1 user challenge @ Phase 4 gate) | 9 proposals: 3 accepted, 4 deferred, 1 declined, 1 user challenge; loop 30 issues/24 fixed; native 16 findings dispositioned |"},{"oldText":"| Outside Review | — | Independent 2nd opinion | 0 | NOT RUN (outside voice skipped — no codex/aside available) | — |","newText":"| Outside Review | codex (attempted) | Independent 2nd opinion | 1 (attempt) | UNAVAILABLE — 401 `invalid_api_key` (sk-ceb3d…1579) + outside block requires git repo (none); same-harness native fallback ran, never counts as outside coverage | 12 fallback findings (D29–D37), not external |"},{"oldText":"- **OUTSIDE COVERAGE:** none — outside voice skipped this run (Aside unavailable, codex not invoked); no external completion claimed.","newText":"- **OUTSIDE COVERAGE:** none — codex attempted once (401 + no git repo; error log `autoplan-ceo-NAi4pF/codex-ceo-err.log`); native same-harness fallback executed and never counts as outside coverage; `gstack-review-log` binary absent (attempted 2026-10-01), logged in Review record instead. Tags: [subagent-only]."},{"oldText":"- **VERDICT:** ENG CLEARED — ready to implement (T1→T12 order in Implementation Tasks; T8 conditional on CEO C1 [autoplan Phase 4 approval gate]).","newText":"- **VERDICT:** ENG CLEARED — ready to implement (T12 first at the autoplan Phase 4 approval gate, then T1→T11; T8 conditional on CEO C1). CEO findings dispositioned; 1 user challenge (CEO C1) unresolved by design (USER CHALLENGE rule). Design/DX reviews run in later pipeline phases."},{"oldText":"No decisions required this phase; CEO C1 pending at the autoplan Phase 4 approval gate.","newText":"**UNRESOLVED DECISIONS:**\n- CEO C1 — git baseline options A/B/C (full C1 / local-only baseline commit / no git) — USER CHALLENGE, decided only by the user at the autoplan Phase 4 approval gate (T12; never auto-decided)"}]} -->

### Baseline edits (phase dx, round 1 — applied)

<!-- autoplan-baseline-edits:dx {"sourceSha256":"0fb570b852c5637f73ee620fce427a76ab8ce98b9175875a581fefff7eceecd2","replacements":[{"oldText":"  Priority tags: **P1** blocks ship · **P2** same branch · **P3** follow-up/TODO — priorities, not phase numbers (execution order: **T12 gate FIRST at the autoplan Phase 4 approval gate**, then T1→P1.5; T3→T4 [T2 lands with T4], T5, T6, T7→P3; T9 may start at P3 entry — no data dependency; T10, T13→P4).","newText":"  Priority tags: **P1** blocks ship · **P2** same branch · **P3** follow-up/TODO — priorities, not phase numbers (execution order: **T12 gate FIRST at the autoplan Phase 4 approval gate**, then T1→P1.5; T3→T4 [T2 lands with T4], T5, T6, T7→P3; T9 may start at P3 entry — no data dependency; T10, T13→P4; DX round 2: T21→T20 before T4 (freeze [13A] string literals first), T16/T17/T18 before the first D19 timed run at P4 close, T19 anytime, T14 pre-P4)."},{"oldText":"- [ ] **T16 (P1, human: ~2h / CC: ~30min)** — docs — Create `README.md`: quickstart (prereqs → install → `.env` → `npm run setup`, ≤5 commands), script table (every script, incl. `db:security` = applies RLS/grants via `db/migrate-all.sh` — success signal + failure first-check), first-login block (dev admin `admin@fanela.local` / `ChangeMe123!` + dev TOTP `JBSWY3DPEHPK3PXP` + recovery codes note — dev-only, override via `SEED_ADMIN_*`), reset-dev-MFA block (`UPDATE users SET totp_secret=NULL, recovery_codes=NULL WHERE email=…` → re-run `db:seed` re-arms via `db/seed.mts:54` first-run branch), compose note (unused — Homebrew PG 18.4 is source of truth; drift item in TODOS), API endpoint table + one curl per family (auth/jobs/export) + `{error, code}` envelope + docs map (one line per `docs/` file), TTHW target line (2–5 min cold start)","newText":"- [ ] **T16 (P1, human: ~2.5h / CC: ~40min)** — docs — Create `README.md`: quickstart (prereqs incl. PostgreSQL → install → `createdb fanela` + PG role/auth note → `.env` ← `.env.example` → `npm run setup` → `npm run dev` → http://localhost:3000, ≤7 commands), script table (every script, incl. `db:security` = applies RLS/grants via `db/migrate-all.sh` — note the name mismatch: script says migrate-all, step is security — success signal + failure first-check), first-login block (dev admin `admin@fanela.local` / `ChangeMe123!` + dev TOTP `JBSWY3DPEHPK3PXP` + recovery codes note — dev-only, override via `SEED_ADMIN_*`), reset-dev-MFA block (`UPDATE users SET totp_secret=NULL, recovery_codes=NULL WHERE email=…` → re-run `db:seed` re-arms via `db/seed.mts:54` first-run branch), compose note (unused — Homebrew PG 18.4 is source of truth; drift item in TODOS) + header comment in `docker-compose.yml` marking it unused, API endpoint table + one curl per family (auth/jobs/import chain upload→preview→confirm→execute/export) + `{error, code}` envelope + **error-code section** (every code value from `lib/errors.ts`, grouped by class 413/F9/409/500 — the README anchors for the Error & Rescue Registry) + >25MB legacy-dump procedure (record size in D12 `analyze-backup.mjs`; split/re-export source to ≤25MB — cap fixed by design) + known-limit line (no error→skip downgrade in preview — edit source rows and re-upload) + docs map (one line per `docs/` file), TTHW target line (2–5 min cold start)"},{"oldText":"- [ ] **T18 (P2, human: ~15min / CC: ~5min)** — scripts — Add `npm run setup`: `db:migrate` → `db:security` → `db:seed` → lint → typecheck → test (the D6 golden path; timing source for the D19 acceptance line)","newText":"- [ ] **T18 (P2, human: ~15min / CC: ~5min)** — scripts — Add `npm run setup`: `db:migrate` → `db:security` → `db:seed` → lint → typecheck → test (the D6 golden path; timing source for the D19 acceptance line); D19 timing rule: wall time counted through `db:seed` completion (login reachable), lint/typecheck/test phase recorded separately — suite runtime is not part of the 2–5 min TTHW target"},{"oldText":"- [ ] **T19 (P2, human: ~30min / CC: ~10min)** — docs/agent — Extend `CLAUDE.md` with a **Conventions** block: add-an-endpoint recipe (`requirePermission`/`requireAdminOrOps` → service fn in `lib/services/` → `err(status, message, code)` → probe test via `assertClasses` pattern), error-contract pointer, test-bootstrap note (live PG required)","newText":"- [ ] **T19 (P2, human: ~30min / CC: ~10min)** — docs/agent — Extend `CLAUDE.md` with a **Conventions** block: add-an-endpoint recipe (`requirePermission`/`requireAdminOrOps` → service fn in `lib/services/` → `err(status, message, code)` → probe test via `assertClasses` pattern), error-contract pointer, test-bootstrap note (live PG required); plus a one-line `AGENTS.md` pointer to that block (the Codex half of the pair reads AGENTS.md, not CLAUDE.md)"},{"oldText":"- [ ] **T20 (P1, human: ~1h / CC: ~20min)** — http — Error contract upgrade in `lib/http.ts`: `err(status, message, code?)` and `toResponse` emit `{error, code?}`; dev-mode 500 detail (`NODE_ENV !== \"production\"` → include `e.message`; production stays `Unexpected server error.` byte-identical); regression tests for code passthrough + dev/prod 500 body split","newText":"- [ ] **T20 (P1, human: ~1h / CC: ~20min)** — http — Error contract upgrade in `lib/http.ts`: `err(status, message, code?)` and `toResponse` emit `{error, code}` on every response (runtime default `internal_error` when no code passed; type stays optional for back-compat with D13); dev-mode 500 detail (`NODE_ENV !== \"production\"` → include `e.message`; production stays `Unexpected server error.` byte-identical); regression tests for code passthrough + default-code fill + dev/prod 500 body split"},{"oldText":"- [ ] **T21 (P1, human: ~1.5h / CC: ~30min)** — errors — Extract frozen error strings to `lib/errors.ts` constants (F9 shape, 413 size, 422 batch, generic 500, 401/403 texts); `[13A]` tests import the constants; Error & Rescue Registry + UI Design Contract cite constant names; closes the plan's own \"reword BEFORE [13A] freezes\" TODO by construction","newText":"- [ ] **T21 (P1, human: ~1.5h / CC: ~30min)** — errors — Extract frozen error strings to `lib/errors.ts` constants (F9 shape, 413 size, 422 batch, generic 500, 401/403 texts) **and define the full machine-readable code taxonomy there** (one exported code constant per failure, snake_case — e.g. `import_shape_invalid`, `file_too_large`, `stale_batch`, `internal_error`; required set = every code reachable from `err()`); `[13A]` tests import the constants; README error-code section (T16) lists every code; T20 tests assert every emitted code is in the exported set; Error & Rescue Registry + UI Design Contract cite constant names; closes the plan's own \"reword BEFORE [13A] freezes\" TODO by construction (runs before T4)"},{"oldText":"· **DX acceptance [D19]: one timed cold-start run at ship — clean checkout → `npm run setup` → logged-in planner; record wall time (env noted) against the 2–5 min TTHW target; misses → fix before close**.","newText":"· **DX acceptance [D19]: one timed cold-start run at P4 close — clean checkout (when VCS exists; else copy the tree to a fresh temp dir as the cold start) → `npm run setup` (wall time counted through seed/login; lint/typecheck/test recorded separately) → `npm run dev` → logged-in planner; record wall time (env noted, single n=1 run) against the 2–5 min TTHW target; misses → fix before close**."},{"oldText":"**DoD:** [11A] **E1, E2, E7** + export-permission matrix tests; **M1–M4** green (M1–M3 via `tests/rules-m.test.ts`, M4 proven at file level by re-parsing the workbook); uat.test.ts green; **T15 export dropdown shipped** + buffer-then-send (no truncated downloads) per UI Design Contract.","newText":"**DoD:** [11A] **E1, E2, E7** + export-permission matrix tests; **M1–M4** green (M1–M3 via `tests/rules-m.test.ts`, M4 proven at file level by re-parsing the workbook); uat.test.ts green; **T15 export dropdown shipped** + buffer-then-send (no truncated downloads) per UI Design Contract.\n- **DX close [D19]:** T16–T21 complete and the timed cold-start run recorded vs the 2–5 min target (global DoD line) — first D19 run gates P4 close."},{"oldText":"Implementation-ready; Phase 3 re-verifies every row. **Fix / doc anchor column added by DX D14 — every row answers \"what does the operator do next\":**","newText":"Implementation-ready; Phase 3 re-verifies every row. **Fix / doc anchor column added by DX D14 — every row answers \"what does the operator do next\":** operator-facing anchors (413/F9/409/500 classes) resolve to README sections written by T16."},{"oldText":"| auth probes | anon / wrong-role access | `requirePermission` | yes | as-built 401/403 | 401/403 | Sign in / check role grants; probe test T6 shows allow/deny classes |","newText":"| auth probes | anon / wrong-role access | `requirePermission` | yes | as-built 401/403 | 401/403 | Sign in / check role grants; probe test T6 shows allow/deny classes |\n| Login / MFA | bad TOTP, wrong password, rate-limit lockout, session expired mid-import | auth failure / 401 | yes | login form errors + rate limiter; session expiry → redirect to login; import batch keeps CAS state so a re-login + Resume resumes safely | login error text; 401 mid-import | README first-login block + reset-MFA SQL [D20/T16]; wait out rate limit; re-open batch row → Resume |\n| File GET (original / error CSV) | missing file on disk, wrong role, bad path key | 404 / 403 / path guard | yes | authenticated route only; `files` row → disk lookup; role check before read | 404 `File not found` / 403 | Check `storage/uploads/` (E5) — original never deleted; re-download from batch row |\n| Export write | workbook exceeds RSS ceiling (CEO C4 spike) / request timeout | OOM / timeout | partial | spike records the ceiling before build; buffer-then-send guarantees clean failure, never a truncated file | non-2xx → inline banner near dropdown (state table) | Narrow the view (filtered-jobs + filters); ceiling evidence in the C4 spike record; server console |"},{"oldText":"| Import upload cap | 25MB | none (fixed by design) |","newText":"| Import upload cap | 25MB | none (fixed by design); >25MB dump → record size in D12 `analyze-backup.mjs`, split/re-export the source (README procedure, T16) |"},{"oldText":"**Overall: 3 → 8** (min of applicable passes; Pass 5 excluded — external dependency, CEO C1).","newText":"**Overall: 3 → 8** (min of applicable passes; Pass 5 excluded — external dependency, CEO C1; conditional on C1: 8 if a git baseline is approved, 4 if option C / rejected)."},{"oldText":"| DX Review | `/plan-devex-review` | Developer experience gaps | 8 passes + 19 decisions + native voice | CLEAR (PLAN) | Initial 3/10 → fixed to 8/10 (P1 3→8, P2 6→9, P3 4→9, P4 2→8, P6 5→8, P8 3→8; P5 4\\* blocked on CEO C1); 15 native findings DX1–DX15 dispositioned; DX Contract adopted; T16–T21 added; 0 unresolved this review |","newText":"| DX Review | `/plan-devex-review` | Developer experience gaps | 8 passes + 19 decisions + native voice ×2 | CLEAR (PLAN) | Initial 3/10 → fixed to 8/10 (P1 3→8, P2 6→9, P3 4→9, P4 2→8, P6 5→8, P8 3→8; P5 4\\* blocked on CEO C1); native voice ×2: DX1–DX15 + round-2 H1–H3/M1–M6/L1–L6, all dispositioned; DX Contract adopted; T16–T21 added; 0 unresolved this review |"},{"oldText":"in-host DX voice ran (15 findings DX1–DX15, same rule)","newText":"in-host DX voice ran (2 rounds: DX1–DX15 + H1–H3/M1–M6/L1–L6, same rule)"},{"oldText":"| Native voice ........... in-host Reviewer 15 findings            |\n|                          (DX1–DX15) all dispositioned;          |","newText":"| Native voice ........... in-host Reviewer 15+15 findings        |\n|                          DX1–DX15 + r2 H/M/L all dispositioned; |"}]} -->

### Baseline edits (phase eng, round 1 — applied)

<!-- autoplan-baseline-edits:eng {"sourceSha256":"c22a099e173e2b50e8b0910b7d5b25dbd5d038e6d09a0a7664024560b50aaf63","replacements":[{"oldText":"**Date:** 2026-09-30 · **Revised:** 2026-10-01 (plan-eng-review, 17 findings, all approved) ·","newText":"**Date:** 2026-09-30 · **Revised:** 2026-10-01 (plan-eng-review ×2: round 1 — 17 findings; autoplan Phase 3 round 2 native voice — 21 findings; all approved) ·"},{"oldText":"original-file persistence to `storage/uploads/` (local disk, non-web-served; `files.bucket='local'` + relative key) [E5]","newText":"original-file persistence — write-through at Upload (write file → `files` row → Parse; execute only flips batch state; disk write ordered before tx commit — tx fail keeps the original per E5, post-commit file-missing asserted by test; file readable pre-execute; local disk, non-web-served; `files.bucket='local'` + relative key) [E5]"},{"oldText":"| Import → storage | Original file not persisted (no backend) → `files` row points at nothing; E5 passes vacuously | T4 persistence test (file readable from `storage/uploads/` after execute) | Local-disk write inside execute; fail → batch failed | Batch row failed + message |","newText":"| Import → storage | Original file not persisted (no backend) → `files` row points at nothing; E5 passes vacuously | T4 persistence test (file readable from `storage/uploads/` pre-execute and post-execute; rollback-order test) | Write-through at Upload (disk before tx); execute flips batch state only; fail → batch failed; orphan sweep + quota → TODOS | Batch row failed + message |"},{"oldText":"- Reconciliation report in admin UI (counts table).","newText":"- **[ENG A2] Parse persists validated rows:** parsed row set + severities stored at Parse (`import_batches.parsed jsonb` or `import_batch_rows`), bounded by the import row cap; Preview pagination/CSV, Resume-after-restart and the error CSV all read persisted rows — no 25MB re-parse per page; restart-session test: expired cookie → re-login → Resume shows identical preview [X4].\n- Reconciliation report in admin UI (counts table)."},{"oldText":"- **[4A]** Upload: check `Content-Length`/`file.size` early → **413 beyond 25 MB** (spec size decision line 510); spike test for Next 16 proxy truncation >1MB — set `next.config` body-size only if reproduced.","newText":"- **[4A]** Upload: check `Content-Length`/`file.size` early → **413 beyond 25 MB** (spec size decision line 510); spike test for Next 16 proxy truncation >1MB — set `next.config` body-size only if reproduced; header check alone skips chunked bodies — add a streaming size guard (chunked 26MB → 413 test) [X3]. Parse enforces the **50,000-row cap → 4xx + frozen message** (`lib/errors.ts` constant [T21]) [X1]."},{"oldText":"(6) cancel at preview → zero writes.","newText":"(6) cancel at preview → zero writes; (7) TOCTOU: colliding `job_number` inserted AFTER preview → execute re-validates inside the tx and downgrades to skip (batch succeeds, skip count bumped — never a raw SQL failure) [X2]; (8) state-machine matrix: discard→re-upload, discard→resume→confirm (stale version → 409), resume→stale-confirm [T5]."},{"oldText":"- Q7.2: typed confirm when **≥50 rows OR any warn present**; token = previewed create-count typed back (e.g. `480`); placement = confirm-step panel above input showing counts; smaller/clean sets = plain Confirm button.","newText":"- Q7.2: typed confirm when **≥50 rows OR any warn present**; token = previewed create-count typed back (e.g. `480`); placement = confirm-step panel above input showing counts; smaller/clean sets = plain Confirm button. **Server-side enforcement (not UI-only):** execute recomputes the create count inside the tx and requires `typedCount` === recomputed count → mismatch = 4xx (client-bypass backstop) [H2/T3]; test: wrong typed count → 4xx."},{"oldText":"  - Verify: `npm test` — E3/E5/E6 rows + readiness colours + uploaded file readable from `storage/uploads/` after execute + [13A] confirm-with-errors row + keyboard/emulated-viewport pass over wizard","newText":"  - Verify: `npm test` — E3/E5/E6 rows + readiness colours + uploaded file readable from `storage/uploads/` pre-execute and post-execute + [13A] confirm-with-errors row + over-cap (50,001 rows) → 4xx [X1] + wrong typed count → 4xx [H2] + path-traversal: `files` key `../../etc/passwd` → 404, DB-key-only lookup [S4] + CSV formula-injection fixture `=cmd|'/c calc'!A0` round-trips inert [S2] + keyboard/emulated-viewport pass over wizard"},{"oldText":"  - Files: `lib/services/import.ts`, `app/api/admin/import/route.ts`, `app/(app)/admin/import/page.tsx`, `app/(app)/nav.tsx`, `storage/uploads/`, authorized GET route for original file + error CSV","newText":"  - Files: `lib/services/import.ts`, `app/api/admin/import/route.ts`, `app/(app)/admin/import/page.tsx`, `app/(app)/nav.tsx`, `storage/uploads/`, `db/schema/audit.ts` + migration (parsed-row persistence [A2]), authorized GET route for original file + error CSV (CSV writer neutralizes leading `=`/`+`/`-`/`@` [S2])"},{"oldText":"- [ ] **T4 (P1, human: ~1d / CC: ~3h)** — import — Import pipeline (service+route+UI) per **UI Design Contract (Phase 2)**: atomic execute, readiness rebuild, audit+batch row,","newText":"- [ ] **T4 (P1, human: ~1d / CC: ~3h)** — import — Import pipeline (service+route+UI) per **UI Design Contract (Phase 2)**: atomic execute (single-flight per user via pg advisory lock; `SET LOCAL statement_timeout` inside the execute tx — pool `max: 10` + long txs would otherwise head-of-line block every route), readiness rebuild, audit+batch row,"},{"oldText":"  - Verify: 26MB file → 413","newText":"  - Verify: 26MB file → 413 (Content-Length path) + chunked 26MB body → 413 (streaming guard — header check alone skips chunked) [X3]"},{"oldText":"**buffer-then-send (Q7.4: full workbook in memory before headers — no truncated downloads; [CEO C4] spike peak RSS = ceiling evidence)**","newText":"**buffer-then-send (Q7.4: full workbook in memory before headers — no truncated downloads; [CEO C4] spike peak RSS = ceiling evidence) + row-cap guard: ≥100,000 rows → abort before buffer blowup → non-2xx → inline banner (D18 knob row; final number validated by the C4 spike) [A3]**"},{"oldText":"  - Verify: `npm test` (195 green) + rollback test + same-session assertion: batch execute's audit row + `updateReadinessCache` observe uncommitted tx state","newText":"  - Verify: `npm test` (195 green) + rollback test + same-session assertion: batch execute's audit row + `updateReadinessCache` observe uncommitted tx state + ALS-detached helper called outside `fn` documents fallback (no silent phantom reads) [A4]"},{"oldText":"  - Verify: double-confirm 409 test; re-preview → stale-confirm 409 test (exercises a real version bump)","newText":"  - Verify: double-confirm 409 test; re-preview → stale-confirm 409 test (exercises a real version bump); state-machine matrix discard→resume→confirm + resume→stale-confirm → 409 [T5]"},{"oldText":"- [ ] **T13 (P2, human: ~1h / CC: ~15min)** — security — Pre-P4 auth security checklist: CSRF strategy on stateful handlers, cookie flags (SameSite/Secure/HttpOnly), upload endpoint authz, session fixation/rotation, rate-limit posture; record per-item pass/fail in the Review record, failures → tickets","newText":"- [ ] **T13 (P2, human: ~1h / CC: ~15min)** — security — Auth security checklist in two gates: **P3-close subset (hard — first stateful admin write ships with P3): CSRF strategy on stateful handlers + upload endpoint authz + upload rate limit** (as-built mitigations verified: SameSite=Lax + HttpOnly, but no origin check/token yet); **pre-P4 remainder: cookie flags (Secure), session fixation/rotation, full rate-limit posture**; record per-item pass/fail in the Review record, failures → tickets"},{"oldText":"**DoD:** [11A] **E3, E4, E5, E6** green; FX-1…11 import through real route handlers + reconciliation **automated Δ=0**; import error-path rows green; permission probe green; **UI Design Contract compliance** (anatomy, state-table copy, typed confirm, issues-first preview, tokens, a11y — Phase 2) + [13A] confirm-with-errors row green.","newText":"**DoD:** [11A] **E3, E4, E5, E6** green; FX-1…11 import through real route handlers + reconciliation **automated Δ=0**; import error-path rows green; permission probe green; **UI Design Contract compliance** (anatomy, state-table copy, typed confirm, issues-first preview, tokens, a11y — Phase 2) + [13A] confirm-with-errors row green; **T13 P3-close subset green** (CSRF + upload authz/rate-limit) [S1]."},{"oldText":"dev-mode 500 detail (`NODE_ENV !== \"production\"` → include `e.message`; production stays `Unexpected server error.` byte-identical); regression tests for code passthrough + default-code fill + dev/prod 500 body split","newText":"dev-mode 500 detail (`NODE_ENV === \"development\"` only → include `e.message` — unset NODE_ENV must NOT leak SQL fragments/paths; production stays `Unexpected server error.` byte-identical); regression tests for code passthrough + default-code fill + dev/prod/unset 500 body split"},{"oldText":"generated workbook for Office/Dispatch/Packing/dept contains no cost column (`Buying Cost`, `unit_price`) across jobs/filtered-jobs/department views;","newText":"generated workbook contains no cost column (`Buying Cost`, `unit_price`) across **all 9 views** (jobs/filtered-jobs/department/stock-shortage/swatches/shipments/audit/customers/products — full coverage nearly free with the re-parse harness) [T1];"},{"oldText":"→ per-table count assertions → Δ=0 (FX-10 500 jobs; explicit per-test timeout override — vitest default `testTimeout: 15_000` is not generous enough).","newText":"→ per-table count assertions → Δ=0 **+ spot-assert N sampled rows against the fixture (job_number, customer, date — count parity can hide mangled values)** (FX-10 500 jobs; explicit per-test timeout override — vitest default `testTimeout: 15_000` is not generous enough)."},{"oldText":"- **[ExcelJS]** server-side streaming writer; **[16A]** one SQL statement per view with joins","newText":"- **[ExcelJS]** in-memory workbook builder → buffer-then-send response (streaming writer only if the C4 spike demands it — streaming into a buffer gains nothing) [H3]; **[16A]** one SQL statement per view with joins"},{"oldText":"| Preview cap | 200 rows (pagination + full CSV) | none |","newText":"| Preview cap | 200 rows (pagination + full CSV) | none |\n| Import row cap | 50,000 rows/batch | none (fixed by design); Parse rejects over-cap → 4xx + frozen message (T21 constant) [X1] |\n| Export row cap | 100,000 rows | none (fixed by design); abort before buffer blowup → non-2xx → inline banner; final number validated by the C4 spike [A3] |"},{"oldText":"| File GET (original / error CSV) | missing file on disk, wrong role, bad path key | 404 / 403 / path guard | yes | authenticated route only; `files` row → disk lookup; role check before read | 404 `File not found` / 403 |","newText":"| File GET (original / error CSV) | missing file on disk, wrong role, bad path key | 404 / 403 / path guard | yes | authenticated route only; DB-key-only lookup (client path never joined — traversal test `../../etc/passwd` → 404); role check before read | 404 `File not found` / 403 |"},{"oldText":"| `execute` → file persist | storage write fails mid-execute | `StorageWriteError` | yes | rollback; original never silently lost | batch failed | Check `storage/uploads/` permissions; original file never deleted |","newText":"| `execute` → file persist | original missing at execute (never written at Upload) / post-commit file vanished | `StorageWriteError` (E5) | yes | write-through at Upload (disk before tx, H1 order); tx fail keeps the file; execute asserts file exists | batch failed | Check `storage/uploads/` permissions; original file never deleted |"},{"oldText":"| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 17 issues, 0 critical gaps |","newText":"| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 2 (round 1: 17 issues; round 2: native voice on the final amended plan) | CLEAR (PLAN) | Round 1: 17 issues, 0 critical gaps; round 2 native voice: 21 findings (A1–A4, X1–X4, T1–T5, S1–S5, H1–H3) all dispositioned as plan-text amendments; 0 unresolved this review |"},{"oldText":"in-host DX voice ran (2 rounds: DX1–DX15 + H1–H3/M1–M6/L1–L6, same rule);","newText":"in-host DX voice ran (2 rounds: DX1–DX15 + H1–H3/M1–M6/L1–L6, same rule); in-host eng voice ran (round 2: 21 findings A1–A4 / X1–X4 / T1–T5 / S1–S5 / H1–H3, same rule);"},{"oldText":"- **VERDICT:** ENG CLEARED + DESIGN CLEARED (UI Design Contract, text-only — mockups deferred to TODOS, designer key 401) + DX CLEARED (DX Contract, 19 decisions, fixes T16–T21 + D19 acceptance) — ready to implement (T12 first at the autoplan Phase 4 approval gate, then T1→T21; T8 conditional on CEO C1). CEO findings dispositioned; design and DX have 0 unresolved.","newText":"- **VERDICT:** ENG CLEARED (round 1 + Phase-3 round 2 on the final amended plan — 21 findings dispositioned; pre-P3 set X1 row cap / A2 preview persistence / H2+T3 server-side typed confirm folded into T4/T5/D18) + DESIGN CLEARED (UI Design Contract, text-only — mockups deferred to TODOS, designer key 401) + DX CLEARED (DX Contract, 19 decisions, fixes T16–T21 + D19 acceptance) — ready to implement (T12 first at the autoplan Phase 4 approval gate, then T1→T21; T8 conditional on CEO C1). CEO findings dispositioned; design, DX and eng have 0 unresolved."},{"oldText":"**UNRESOLVED DECISIONS:**\n- This review (plan-design-review): 0 open decisions — 11/11 answered A.","newText":"**UNRESOLVED DECISIONS:**\n- This review (plan-eng-review): 0 open decisions — round-2 native voice, 21 findings all dispositioned as plan-text amendments.\n- This review (plan-design-review): 0 open decisions — 11/11 answered A."},{"oldText":"+==================================================================+\n```\n\n## GSTACK REVIEW REPORT","newText":"+==================================================================+\n```\n\n## Completion Summary — Phase 3 (Eng plan review — autoplan)\n\n```text\n+===== AUTOPLAN PHASE 3 COMPLETION SUMMARY =====================+\n| Methodology ............ plan-eng-review, 4/4 ranges read       |\n|                       (1999 lines, sha 030a62ba)               |\n| Scope .................. final amended plan (impl sha 962a2b01) |\n| Voice .................. native Reviewer via official create    |\n|                       snapshot; INPUT sha matched; outside    |\n|                       dead -> [subagent-only]                  |\n| Findings ............... 21: A1-A4, X1-X4, T1-T5, S1-S5, H1-H3 |\n| Pre-P3 critical ........ X1 row cap, A2 preview persistence,   |\n|                       H2+T3 server-side typed confirm         |\n| Dispositions ........... 21/21 plan-text amendments (blast-    |\n|                       radius rule); accepted:eng x2 + fence    |\n| Unresolved ............. 0 this review (CEO C1 remains)        |\n| Verification ........... lint 0, tsc 0, 195 tests green        |\n| VERDICT ................ ENG CLEARED (round 2 of final plan)   |\n+==================================================================+\n```\n\n## GSTACK REVIEW REPORT"}]} -->
