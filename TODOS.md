# TODOS

Open items discovered during development. Checked = done.

## Fanela Central

### Legacy data acquisition (source, owner, deadline)

**What:** Obtain the legacy backup export file; name an owner and deadline; run `docs/phase0/analyze-backup.mjs` against it (output must include record count + estimated manual re-entry hours vs pipeline cost).

**Why:** Import ships dead if data never comes (native CEO 1.2/R13). Format gate CEO C2 cannot fire until a sample exists; firing it late forces converter work under schedule pressure at P3 close (native R2).

**Context:** No live data exists today (OI-8). The moment any sample arrives, CEO C2 runs `analyze-backup.mjs` BEFORE T3/T4 build if possible (CSV/XLSX → settle converter-vs-extend-parser first; JSON shapes A–D remain MVP contract). Dataset value is unverified — could be 200 rows where manual re-entry beats the pipeline.

**Effort:** S (human, ops) / n/a (CC)
**Priority:** P0
**Depends on:** None

**C3 gate record (2026-10-03, P4 close):** Owner = **unassigned** (placeholder per client instruction — replace with a real name when known); target date = **2026-10-17**. No real dataset exists yet; CEO C2 `analyze-backup.mjs` fires the moment a sample arrives.

### Operator demo at P3 close

**Recorded 2026-10-03 (C5):** operator = **project owner (client) — solo run**; flow = job-create → dispatch through the P3 screen; half-day max; date booked by owner (P3 closed 2026-10-03). Status: scheduled.

**What:** One named operator runs job-create → dispatch through the P3 screen (half-day max); schedule at P3 close.

**Why:** Adoption loop (native CEO 3.3/R3) — 77 rules green with zero operators is the top 6-month regret scenario. Spec-conformance is not proof of value.

**Context:** Deferred from Phase-1 0G (outside blast radius: needs staff time), priority raised to P1 after native CEO voice flagged adoption as the project's largest risk. Keep thin: one operator, one flow, one session.

**Effort:** S (human) / n/a (CC)
**Priority:** P1
**Depends on:** P3 close (T4 complete)

### Rule-ID tagging + first-real-import audit

**What:** Tag phase0-derived tests with their rule IDs; audit coverage at the first real import.

**Why:** Provenance hygiene (native CEO 3.2) — lets reviewers trace every shipped rule to a test when the first real data lands.

**Context:** Test-mapping table maps 77 register IDs to files, but files don't carry reverse tags. Do at first real import so drift is caught against real rows.

**Effort:** S (human) / S (CC)
**Priority:** P2
**Depends on:** First real import (CEO C3 dry-run)

### Cutover plan (date, parallel-run, owner)

**What:** Define target cutover date, parallel-run exit criteria (N days + reconciliation Δ=0), and legacy-shutdown owner.

**Why:** Native CEO R4 — plan has no dates anywhere; without a cutover entry the org drifts in dual-system fatigue until someone buys SaaS mid-build (6-month regret #5).

**Context:** Triggers date-driven triage across P3/P4/P5. Exit criteria should reference the C3 dry-run + success metric. Owner is a user/stakeholder decision.

**Effort:** S (human) / n/a (CC)
**Priority:** P1
**Depends on:** Success metric definition, operator demo

**Draft (2026-10-03, CC) — awaiting owner confirm (date + shutdown owner are human-only):**
- **Gate-in:** C3 dry-run passes (full legacy export imports clean, spot-reconcile Δ=0) + C5 operator demo accepted + prod runbook (`docs/ops/runbook.md`) live + monitoring proven on prod for ≥5 working days.
- **Parallel-run:** 14 working days dual entry (legacy + Fanela), daily reconciliation = job count Δ=0 and no Fanela-only write failures; any Δ>0 resets the counter.
- **Metrics at cutover:** take C7 baselines — (1) median minutes/job (legacy vs Fanela), (2) % live jobs tracked in Fanela (target 100% at shutdown).
- **Proposed cutover date rule:** gate-in date + 14 working days + 2 (reconciliation buffer) — fill concrete date once gate-in date is known.
- **Shutdown owner:** client (stop legacy entry, read-only archive export kept ≥90 days per B2).
- **Rollback:** legacy stays read-only-able until 5 working days post-shutdown; any failed daily reconciliation for 2 consecutive days reopens dual entry.

## Completed

### Prod-ops runbook before go-live — CLOSED 2026-10-04

**Closure record:** `docs/ops/runbook.md` shipped (PR #2): B1 nightly pg_dump + quarterly restore drill with drill log, B2 90-day artefact rule, L4 nightly grant/correction-integrity SQL, storage-sweep cron, log capture, uptime probe, first-CI-red rule, MinIO/S3 checkpoint, reconciliation queries. Operational follow-ups (fill box owner, first drill after first nightly dump) tracked inside the runbook itself.

### Design system (DESIGN.md) before production UX pass — CLOSED 2026-10-04

**Closure record:** `DESIGN.md` at repo root (PR #2), derived from shipped code rather than a designer session: Tailwind v4 + Geist, zinc-first palette with status semantics (red/amber/blue, no green), `rounded-md`/`rounded-lg` scale, max-w-6xl shell, interaction rules (typed confirm gate, banner errors, counts-on-result), a11y conventions, references to real screenshots in `designs/`. Free path chosen — designer key still 401; text source of truth gates future UX anyway.

### Backfill import-wizard mockups (designer key 401) — CLOSED 2026-10-04

**Closure record:** Free path: five verified real-UI captures in `designs/import-wizard-20261001/` (upload-empty, preview-all-rows, confirm-gate, import-complete, upload-error), each checked against its pre-shot a11y snapshot (PR #2, `623d76e`). Designer binary skipped — key still `401 invalid_api_key`; real pixels supersede generated mockups. Wizard bugs found while capturing fixed in `ecfffc8` + `bf6d514`.

### Storage retention/quota + orphan upload sweep — CLOSED 2026-10-04

**Closure record:** Quota cap `STORAGE_QUOTA_BYTES` (default 5 GB) → HTTP 413 `import_storage_quota` before any write; retention `UPLOAD_RETENTION_DAYS` (default 90, B2 floor) + 24 h orphan grace via `npm run storage:sweep` (`scripts/storage-sweep.mts`, runbook §4b). `files` row and batch history survive disk deletion; `readOriginal` already 404s missing files. Tests `tests/storage-policy.test.ts` (6). First live run freed 213 MB of unreferenced test uploads. PR #2 (`a682c38`).


### Dev-DB drift: pick one Postgres source of truth — CLOSED 2026-10-03

**What:** Reconcile `docker-compose.yml` (present, unused by tests), Homebrew PG 18.4 (actual dev+tests), CI `postgres:18` (planned). Pick one, align CI, delete the loser.

**Closure record:** Source of truth = **Homebrew PG 18.4 (local dev+tests) + `postgres:18` (CI)** — same major, one story. The entry's blocker criterion is met: CI run `37102217274` (ship/PR #1, 2026-10-03) green through migrations → `db/security` RLS/grants → seed → lint → typecheck → 378 tests, proving `db/security/*.sql` applies cleanly on the CI image (previously Homebrew-only). Loser `docker-compose.yml` (PG16-alpine, never used by tests) **deleted**; README compose note removed. `postgres:16-alpine` image no longer visible anywhere.

### Adoption/success metric definition (C7) — CLOSED 2026-10-03

**Defined 2026-10-03 (C7, client decision):** TWO metrics kept (client chose both over the plan's single-metric default): **(1) median minutes/job entry** (baseline legacy vs Fanela), **(2) % of live production jobs tracked in Fanela**. Owner: **project owner (client)** for both. Measured at cutover.

**Why (original):** Native CEO 5.1/R3 — without a metric, "done" is undefined and the build-vs-buy check (C9) has nothing to measure against.

**Closure record:** Definition recorded here + plan (C7 ✅ bullet). Remaining work is *measurement at cutover* — tracked under the Cutover plan entry (open).

### Build-vs-buy kill criterion (C9) — CLOSED 2026-10-03

**Triggers recorded 2026-10-03 (C9, client decision):** revisit build-vs-buy if a **commercial print MIS covers ≥80% of the 77 register rules at ≤ £200/month**; review checkpoint = **P4 close (2026-10-03, this run)** — no MIS offer evaluated yet → checkpoint logged, no kill.

**Why (original):** Native CEO 4.4/R5 — deferred pre-P5 = reviewed after two phases of sunk cost + test moat ⇒ honest kill chance ≈ 0.

**Closure record:** Triggers written before P3 close (requirement) ✓; P4-close checkpoint reviewed same day — no MIS evaluated → no kill ✓. Next review = pre-P5 (carried in plan).

**Pre-P5 review (2026-10-04): NO KILL — P5 unblocked.** Full screen in `docs/research/c9-build-vs-buy-2026-10-04.md`: 10 candidates priced (PrintDesk £39.99/mo, Pro-cess £30/mo, Odoo £18/user/mo, PrintSmith Vision $599/yr pass price; PrintVis/Ordant/Infigo/Twist/Panacea fail; Tharstern unverifiable), coverage mapped for price-passers — best generous = Odoo ~45% vs 80% needed; structural ceiling ~77% (swatch S + readiness G absent everywhere). Revisit triggers recorded in report.

### Post-ship devex-review (DX verification) — CLOSED 2026-10-03

**Exit criteria:** TTHW number recorded (env noted) vs 2–5 min target + checklist of D5–D20 fixes verified present.

**Closure record:** **TTHW = 11 s** through migrate+seed on a fresh tree copy (env: macOS arm64, warm npm cache, Homebrew PG 18.4, pre-migrated `fanela` DB; D19 record in plan, n=1 PASS 2026-10-03) — dev server ready +3 s, MFA login → `/jobs` 200 +5 s ⇒ full TTHW ≈ 16 s vs 2–5 min target. D5–D20 checklist verified present same day: README ✓, `.env.example` ✓, `npm run setup` ✓, CLAUDE.md Conventions block ✓, README error-code section + `lib/errors.ts` constants (75 `MSG_`/`CODE_` refs) ✓, dev-500 detail (`lib/http.ts:67`, `NODE_ENV=development`) ✓. Closed on the D19 timed run rather than a separate `/devex-review` session — same exit criteria, one run; a full browser-driven devex pass remains optional polish (designer key + codex key both 401, see mockups entry).
