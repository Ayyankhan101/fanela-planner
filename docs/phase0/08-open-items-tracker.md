# Phase 0 — Open Items & Findings Tracker

Spec §19 items OI-1…OI-8 + code-analysis findings F4…F11.
**RESOLVED 2026-09-30: client accepted all defaults ("all defaults").** Status column records the locked decision.

---

## A. Open items (spec §19)

| ID | Question | **Locked decision** | Status |
|---|---|---|---|
| **OI-1** | Who may see buying costs / holds `authorised commercial`? | Director = reports only; no holders beyond Admin/Ops/Office/Director cells in 04 | ☑ decided |
| **OI-2** | Final roles + departments? | **9 departments** (Option 1) + **7 roles**; mapping 04 Part B | ☑ decided |
| **OI-3** | Blank screens `required` semantics? | Blank = not-yet-specified = gate NOT passed (G4); Amber + hint in UI | ☑ decided |
| **OI-4** | Order types beyond spec? | Spec list exhaustive {Bulk, POD, Repeat, Sample}; extras → notes | ☑ decided |
| **OI-5** | Retention? | Audit/stock **indefinite append-only**; backups 30d; prototype artefacts 90d | ☑ decided |
| **OI-6** | Import dedupe / re-import? | Dedupe `job_number` + `SKU`; re-import allowed, existing skipped (E3) | ☑ decided |
| **OI-7** | Session timeouts? | 2h idle / 12h absolute (spec values) | ☑ decided |
| **OI-8** | Data location / migration source? | **No data exists yet.** Data arrives later → self-service import screen (Phase 3); contract in 05 §1; full dump preferred, jobs-only rejected | ☑ decided |

## B. Findings from prototype code analysis

| ID | Finding | **Locked resolution** | Status |
|---|---|---|---|
| **F4** | v11 "Archive" hard-deletes job (L230) | New system: `jobs.archived` flag only, no delete path; historical loss accepted | ☑ ack |
| **F5** | Code 9 departments vs spec 6 keys | Keep 9; seed enum from 04 Part B; spec §6 corrected at kickoff (implementation plan Step A2) | ☑ ack |
| **F6** | Code 13 roles vs spec 7 | Mapping table 04 Part B; legacy roles recreate as Department Operator + dept | ☑ ack |
| **F9** | Backup button = jobs only (L248) | Import screen rejects shape D with F9 message (05 §1); dump instructions retained | ☑ ack |
| **F7** | `ensureDispatch` auto-adds Dispatch stage | Keep as spec J9 — no action | ☑ noted |
| **F8** | Readiness formula differs in edge cases | Verify via **fixtures FX-5** (no real data) during Phase 2 tests | ☑ closed |
| **F10** | v11 vs spec swatch status names | Mapping fixed in 03 §5 | ☑ closed |
| **F11** | No shipment state enum in v11 | Inference table 06 §4; preview lists inferred states for human confirm at import | ☑ ack |
| **T1** | J4 (stock outstanding) + J9 (completion gating) P1 tests blocked — need stock service / stage machines | P2 shipped stock service + stage machine; skips replaced with real tests | ☑ closed (2026-10-01 P2) |

## C. Phase-0 exit checklist

- [x] Client decisions recorded — all defaults accepted (2026-09-30)
- [x] F4/F5/F6/F9/F11 acknowledged
- [x] Data strategy replaced: no data now → 05 rewritten as data contract + fixture inventory
- [x] Permission matrix 04 signed (defaults)
- [x] Implementation plan written — `docs/superpowers/plans/2026-09-30-fanela-implementation-plan.md`
- [x] 01–08 final review → Phase 1 starts

## D. Status log

| Date | Event |
|---|---|
| 2026-09-29 | 01–04, 06–08 drafted from spec + prototype analysis; 05 blocked on data (F9) |
| 2026-09-30 | **All defaults accepted.** 04 signed, 05 → data contract + fixtures, OI/F statuses locked |
| 2026-10-01 | P1 test-gap session: 01 flipped C4/B3–B6/J5/J7 to ✓; J4/J9 → P2 (T1). Test suite 113 pass / 2 skip |
| 2026-10-02 | **P2 UAT (T10) shipped**: spec §14 → `tests/uat.test.ts` (11 tests). Mapping: readiness White→Amber→Green + edge cases (G7 floor: fresh job w/ required swatch = Amber, waiver-first reaches White baseline); artwork approve→revise (reason required)→re-approve; swatch reject→new-attempt→approve + waive+audit (S7 gate = embroidery dept only); stage wrong-dept 403/own OK/full completion; shipments part-dispatch/finalise/open-blocked; Excel office-strip + import add-only; concurrency same-sub-entity 409 / different-sub-entities both 200; permission-probe spot (full matrix = `tests/probe-endpoints`/`probe-p2`). Cleanup: owner-pool deletes incl. `artwork_events` (NO ACTION FK). **358 pass / 0 skip**, lint + tsc clean |
| 2026-10-01 | **P2 Gates + History done**: readiness/stock/stages/artwork/swatch/dispatch/audit services + 14 routes; optimistic-lock `current` on all 409s; RLS approve-transition fix; tests/rules-a,s,h,l + concurrency + probe-p2; J4/J9 un-skipped; 01 flipped G/A/S/D/H/L/P + J4/J9 → ✓. **195 pass / 0 skip**, lint + tsc clean. Fixes found by tests: receipt/correction version bump, audit `order-lines` filter on action not entity_type, part_dispatched from open, stock_status snapshot after event |
| 2026-10-03 | **P3 close**: T13 both gates recorded (P3-close 2026-10-02 + pre-P4 remainder: Secure flag, fixation/rotation, rate-limit posture — all PASS, no tickets); **[14A] reconciliation automated** — `tests/reconciliation.test.ts` imports FX-1…11 through real route handlers → per-table scoped Δ=0 + spot-assert job_number/customer/date + readiness non-null & FX-5 colours [17A] (12 tests; parallel-file-safe scoped asserts); P3 DoD green. **378 pass / 0 skip**, lint + tsc clean |
| 2026-10-03 | **[D19] timed cold-start n=1 PASS**: fresh tree copy → install 7s (warm cache) → setup-through-seed **11s** (target 2–5 min) → tail lint 4s/typegen 2s/tsc 3s/test 16s (378) → dev ready 3s → MFA login → planner 200 (5s). Found+fixed: fresh-clone typecheck missing `.next/types` → `next typegen` added to setup + README |
| 2026-10-03 | **P4 close**: DoD green — E1/E2/E7 + 9×7 matrix + M4 reparse (exports.test), M1–M3 (rules-m), uat 11/11, T15 dropdown shipped, [15A]; **C3 hard gate met** (owner=unassigned placeholder + 2026-10-17 in TODOS); **C5** owner-solo demo scheduled; **C7** two metrics defined (minutes/job + %live jobs, owner=client); **C9** triggers recorded (MIS ≥80% rules @ ≤£200/mo), review logged no-kill; **D19** cold-start PASS (11s vs 2–5 min) + typegen fix; flake fix `fileParallelism: false` (FX-09 cross-file race). Suite **378 pass ×3 stable**, lint + tsc clean. Human gates C5/C7/C9 answered by client 2026-10-03 |
| 2026-10-05 | **Human-gate records (client decisions):** **C3** owner assigned = project owner (client), target 2026-10-17 unchanged; **C5** demo **booked 2026-10-10** (operator = project owner, solo run); **cutover draft owner-confirmed** (date rule = gate-in + 14 wd + 2, shutdown owner = project owner — concrete date fills at gate-in). C6 stays open (depends first real import) |
| 2026-10-06 | **C6 rule-ID coverage + P5 emission + UX pass + spec deviation notes** (branch `phase2/ux-c6-p5`, **PR #13 merged**): **(a)** rule-ID coverage meta-test `tests/rule-coverage.test.ts` (77 IDs, EXCEPTIONS {D6}) + D5 delta test + D9/G5 tag cleanup; **(b)** P5 domain-event emission groundwork — `lib/services/emit.ts`, audit/stock emitters, `tests/domain-emission.test.ts` (rows pending, no senders by design); **(c)** production UX pass — tokens/typography/contrast/focus-rings/inline-confirms/aria-live/mobile nav+search wrap; evidence `designs/ux-pass-20261005/`; **(d)** spec deviations recorded: export = stream+discard (no pg-boss/MinIO/signed-URL/history, plan NOT-in-scope), import files = local disk `storage/uploads/` bucket='local' (MinIO/S3 deferred, D20), outbox kind = event name until D1–D6/X1–X5 senders. Gates: lint 0 errors (2 pre-existing warnings), typecheck clean, 430/430 |
| 2026-10-06 | **QA loop + error contract + prod deploy (evening):** Phase C QA fixes — ISSUE-001 customers pagination (`abf5d1e`), ISSUE-002 picker combobox (`ef8fd11`), ISSUE-003 swatch approve reason (`3a59679`), ISSUE-004 audit job-number filter (`5016baa`) + regression tests + report (94/100, `.gstack/qa-reports/qa-report-localhost-3000-2026-10-05.md`); **PR #14 error contract F1/F2** (`4c11c76`) — zod-fail → 422 `{error:"Invalid request.", code:"validation_error"}`, services throw taxonomy-coded `{status,message,code}`, probe suite `tests/error-contract-probe.test.ts`, live curl verified (`validation_error`, `invalid_credentials`, `customer_not_found`, `job_not_found`, `forbidden_admin_ops`), **suite 440/440**; **PR #15 prod deploy** (`d60f3db`) — launchd app+outbox KeepAlive, uptime success logging, runbook §1/§4c/§6 updated, `deploy.sh` full path executed, probe `fanela up: HTTP 200`, L4 `bad_privs=0 orphans=0`. **Monitoring clock starts 2026-10-06** (≥5 wd clean-probe days for cutover gate-in). C5 dry-run findings all fixed pre-demo |
