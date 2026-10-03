# TODOS

Open items discovered during development. Checked = done.

## Fanela Central

### Dev-DB drift: pick one Postgres source of truth

**What:** Reconcile `docker-compose.yml` (present, unused by tests), Homebrew PG 18.4 (actual dev+tests), CI `postgres:18` (planned). Pick one, align CI, delete the loser.

**Why:** Three divergent DB stories guarantee local-green/CI-red and divergent RLS posture (`db/security/*.sql` only verified on Homebrew).

**Context:** Surfaced plan-eng-review 2026-10-01; first CI red after CEO C1 lands is a blocker, not noise (native R10). Verify RLS security SQL applies cleanly on the chosen CI image.

**Effort:** M (human) / S (CC)
**Priority:** P2
**Depends on:** CI (T8) → CEO C1 (git repo)

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

### Adoption/success metric definition

**Defined 2026-10-03 (C7, client decision):** TWO metrics kept (client chose both over the plan's single-metric default): **(1) median minutes/job entry** (baseline legacy vs Fanela), **(2) % of live production jobs tracked in Fanela**. Owner: **project owner (client)** for both. Measured at cutover.

**What:** Define ONE success metric with the user (e.g. median minutes/job entry, or % of live jobs in the system); owner named; record it here and in the plan before cutover.

**Why:** Native CEO 5.1/R3 — without a metric, "done" is undefined and the build-vs-buy check (C9) has nothing to measure against.

**Context:** Metric value is user-defined (not auto-decidable). Definition is cheap (~1h conversation); measurement happens at cutover. P3-close definition deadline keeps it honest.

**Effort:** S (human) / n/a (CC)
**Priority:** P1
**Depends on:** None

### Build-vs-buy kill criterion (record now, review at P3 close)

**Triggers recorded 2026-10-03 (C9, client decision):** revisit build-vs-buy if a **commercial print MIS covers ≥80% of the 77 register rules at ≤ £200/month**; review checkpoint = **P4 close (2026-10-03, this run)** — no MIS offer evaluated yet → checkpoint logged, no kill.

**What:** Record objective kill/revisit triggers NOW (e.g. commercial print MIS covers ≥N% of the 77 rules at a stated $/mo); review them at P3 close, before P5 integrations.

**Why:** Native CEO 4.4/R5 — deferred pre-P5 = reviewed after two phases of sunk cost + test moat ⇒ honest kill chance ≈ 0.

**Context:** Triggers must be objective and written before P3 closes. Review checkpoint moved from "pre-P5" to "P3 close" per native CEO amendment (accepted D17).

**Effort:** S (human strategy) / S (CC doc)
**Priority:** P1
**Depends on:** Success metric definition (above)

### Cutover plan (date, parallel-run, owner)

**What:** Define target cutover date, parallel-run exit criteria (N days + reconciliation Δ=0), and legacy-shutdown owner.

**Why:** Native CEO R4 — plan has no dates anywhere; without a cutover entry the org drifts in dual-system fatigue until someone buys SaaS mid-build (6-month regret #5).

**Context:** Triggers date-driven triage across P3/P4/P5. Exit criteria should reference the C3 dry-run + success metric. Owner is a user/stakeholder decision.

**Effort:** S (human) / n/a (CC)
**Priority:** P1
**Depends on:** Success metric definition, operator demo

### Prod-ops runbook before go-live

**What:** Minimal runbook: daily DB backup + restore drill, log capture, uptime monitoring — plus verify B1/B2 (backup/restore) and L4 (nightly check) ops rules from the register.

**Why:** Native CEO R11 + outside finding 6 — B1/B2/L4 are register rules orphaned from every phase (no test can prove them); system replaces the legacy planner with zero ops story.

**Context:** `05 §5` procedure even says "see git history" — no git exists yet (CEO C1 gate). Runbook entry also covers the first-CI-red-is-blocker rule (native R10) and MinIO/S3 migration checkpoint when multi-instance hosting appears (E5 storage is local-disk for MVP).

**Effort:** S (human) / S (CC)
**Priority:** P2
**Depends on:** CEO C1 (git), P4 close

### Design system (DESIGN.md) before production UX pass

**What:** Run a `/design-consultation` session to produce a project DESIGN.md (typography scale, spacing, color roles, component patterns) consolidating the Phase-2 UI Design Contract plus as-built patterns.

**Why:** Plan-design-review Q8.1 — no DESIGN.md exists; the UI Design Contract is plan-scoped and import/export-specific. Without a design source of truth, later features (dashboards, notifications) reintroduce drift.

**Context:** As-built vocabulary already captured in the contract (Tailwind + zinc, `prefers-color-scheme`, nav permission pattern, `space-y-6` shells, bordered table cards). Session should reconcile contract decisions (severity tokens, Geist/DM Sans typography) into project-wide tokens.

**Effort:** S (human) / S (CC)
**Priority:** P3
**Depends on:** None

### Backfill import-wizard mockups (designer key 401)

**What:** When a valid OpenAI key is configured for `gstack design`, generate mockups into `designs/import-wizard-20261001/` for the 6 wizard states per UI Design Contract; verify against the text contract.

**Why:** Phase-2 design review ran text-only — designer binary blocked (`401 invalid_api_key: sk-ceb3d…1579`). Visual spec not yet produced; text contract gates T4 but pixels are unspecified.

**Context:** Directory scaffolded empty. Designer binary at `~/.claude/skills/gstack/design/dist/design` reports `DESIGN_READY`. Same invalid key seen in `~/.codex/auth.json` — fix the key, then run mockup generation.

**Effort:** S (human, key) / S (CC)
**Priority:** P3
**Depends on:** Valid OpenAI API key

### Post-ship devex-review (DX verification)

**What:** After implementation ships, run one `/devex-review` pass against the shipped repo: timed TTHW (clean checkout → `npm run setup` → logged-in planner) vs the 2–5 min target, plus verify DX fixes D5–D20 are present (README, `.env.example`, setup script, CLAUDE.md conventions, error codes, dev-500 detail, error constants).

**Why:** Plan-devex-review (Phase 2.5) scored DX 3 → 8 on plan text; nothing verifies the shipped result matches. Pass 8 (Measurement) wants DX measured, not vibes. Complements the D19 DoD-time check with independent post-implementation verification.

**Context:** TTHW number must be recorded (env noted) and compared against D5's Competitive 2–5 min target. Fixes land during execution (T16–T21); this entry closes the loop after T1–T13 are done. Exit criteria: TTHW number recorded + checklist of D5–D20 fixes verified present → close entry here.

**Effort:** S (human, timed run) / S (CC)
**Priority:** P3
**Depends on:** Implementation complete (post-Phase 4 execution)

### Storage retention/quota + orphan upload sweep

**What:** Storage policy for `storage/uploads/` originals: retention window (auto-delete confirmed imports after N days), quota cap (disk usage ceiling → import blocked with frozen message), and periodic orphan sweep (files with no live `files` row / `files` rows pointing at missing files — alert + cleanup).

**Why:** E5 keeps originals forever with no cap; write-through at Upload can orphan files when the tx fails (file written, row never committed); quota-less storage turns every import into unbounded disk growth.

**Context:** Surfaced plan-eng-review round 2 (autoplan Phase 3, findings A1/H1/S5) 2026-10-01. MVP ships local-disk `files.bucket='local'`; MinIO/S3 migration checkpoint already tracked under Dev-DB/runbook.

**Effort:** M (human) / S (CC)
**Priority:** P3
**Depends on:** T4 (import execute), E5

## Completed
