# C5 — Operator demo checklist (job-create → dispatch)

**Session:** 2026-10-10 (booked) · operator = **project owner (client), solo** ·
half-day max · flow = job-create → dispatch through the P3 planner
(TODOS C5, recorded 2026-10-03). Sources: spec §14 UAT, phase0 rule register,
`tests/uat.test.ts` (same steps green as automation).

Rule: **keep thin** — one operator, one flow, one session. Operator drives;
facilitator only answers "where is it" questions, never touches the keyboard.

## Preconditions (day before)

- [ ] Box live, deploy current (`./scripts/deploy.sh`), `logs/app.*.log` clean
- [ ] Nightly backup ran (runbook §2) — restore point exists
- [ ] Login ready: `admin@fanela.local` + TOTP (+ recovery codes handy)
- [ ] Fresh demo job number reserved: **`DEMO-C5-001`**, customer `C5 Demo Co`
- [ ] Screens/projector shareable; timer started at session open
- [ ] This checklist printed or open on second screen

## Session flow

| # | Operator action | Expected result | ✓ |
|---|---|---|---|
| 1 | Open `/login`, enter email + password | MFA prompt (`{"mfa":true}`) | ☐ |
| 2 | Enter TOTP code | Lands on dashboard; bell + theme toggle visible | ☐ |
| 3 | `/customers` → create `C5 Demo Co` | Customer saved, shows in list | ☐ |
| 4 | `/jobs` → new job `DEMO-C5-001`: pick customer, product, qty, sizes | Job created → lands on job detail | ☐ |
| 5 | Add order line; edit copy defaults where relevant | Line saved; snapshot taken (old jobs unaffected) | ☐ |
| 6 | `/jobs/[id]` stock tab → receive stock for the line | Stock row + `stock_events` receipt event; readiness **White → Amber** (or Green if all gates met) | ☐ |
| 7 | Screens tab → specify + confirm screens | Screen Gate true → readiness progresses toward **Green** | ☐ |
| 8 | Artwork tab → upload / approve artwork | Status flows (Draft → Approved) + audit row; revise resets to Draft | ☐ |
| 9 | Swatch tab → create attempt → complete → approve (or waive requirement) | Embroidery stage unblocks; audit row for approve/waive | ☐ |
| 10 | Stages tab → per department: set **In progress**, then **Completed** (waiting can't jump straight to completed) | Each stage lands; Dispatch stage stays open until finalise (by design) | ☐ |
| 11 | Dispatch tab → record booking → dispatch shipment | Shipment booked + dispatched; audit rows | ☐ |
| 12 | Finalise dispatch | Job → **Completed**; finalise rejected while a shipment is open (expected) | ☐ |
| 13 | `/audit` → filter by the job's UUID (copy from job URL) | Full trail: job, lines, stock, artwork, swatch, stages, dispatch | ☐ |
| 14 | (time permitting) export the job list | Role-filtered columns (no costs for Office) | ☐ |

## Acceptance (C5 passes when)

1. Operator completes steps 1–13 **without facilitator touching the UI**.
2. Every step's expected result observed as written (or finding logged below).
3. Session ≤ half-day; wall-clock time per step noted roughly (feeds C7 baseline).

## Findings log (friction / bugs / confusion)

| Time | Step | What happened | Severity |
|---|---|---|---|
| | | | |

Severity: `blocker` (can't finish flow) · `high` (worked around, painful) ·
`medium` (confusing/slow) · `low` (cosmetic).

### Facilitator dry-run (2026-10-05, automated rehearsal) — flow PASS, findings for QA loop

All 14 steps completed end-to-end on `DEMO-C5-001` (→ job `completed`, 35 audit
rows, export 200 xlsx). Findings:

| Step | What happened | Severity |
|---|---|---|
| 3 | Customers list renders the entire table (10k+ cells with dev data), no pagination or search — slow page, unusable at scale | high |
| 4 | Job-form customer picker = native `<select>` with every customer as an option, no typeahead | medium |
| 9 | Swatch **Approve demands a reason** (client + server), but the field placeholder, error text ("reject / re-swatch"), and rule S4 all say reason is for reject/re-swatch only — approve blocked until a reason is typed | high |
| 13 | Audit page filters by **job UUID only**; operators know job numbers, not UUIDs | medium |

Rule-correct behaviours confirmed (not bugs, but checklist must explain them):
stage `waiting → in_progress → completed` (direct complete = 422); Dispatch
department stage closes only via **Finalise dispatch**; shipment chain is
Draft → Booking arranged → Booked → Labels attached → Print requested →
Labels printed → Dispatched → Finalise.

## Post-run

- [ ] Findings copied into the QA loop branch notes (or TODOS if external)
- [ ] `DEMO-C5-001` archived (no hard delete — B6)
- [ ] TODOS C5 line updated: accepted (or re-run date) + acceptance note
