# Functional QA Report: localhost:3000 (Fanela Production Planner)

| Field | Value |
|---|---|
| Date / branch / revision | 2026-10-05 / qa/loop-2026-10-05 / 0445de5 (clean tree) |
| Caller / authority / depth | qa (full fix loop authorized); local target, mutating actions permitted |
| Surfaces / scope | Web UI (Next.js :3000); test plan = docs/ops/c5-demo-checklist.md Phase B findings (branch diff vs main is ops/docs only — pre-existing app defects in scope per checklist) |
| Runtime / native tools | Next.js 16.3.7, agent-browser 0.33.2, node+otpauth (TOTP), npm test (live PostgreSQL) |
| Fixture ownership / destinations | dev DB from .env DATABASE_URL; demo job DEMO-C5-001 pattern; login admin@fanela.local (dev seed) |
| Duration / stop reason | completed (all 4 findings fixed, verified, tests green) |
| Health score | 94/100 (was 82 baseline): console 100 (0.15), functional 90 (0.20), UX 94 (0.15) |

## Contract outcomes

| Contract and source | Exact probe / evidence | Expected → observed | Outcome |
|---|---|---|---|
| Customers list paginate (Phase B finding 1) | GET /customers → `table tbody tr`=50, "Page 1 of 41 · 2019 customers", Next → ?page=2 → 50 rows, no console errors; screenshots/issue-001-after.png; tests/qa-customers-page.test.ts 3/3 | paged list (≤100/page + pager) → 50/page + Prev/Next pager after fix (was 2015 rows, no pager) | pass (fix 15cff53) |
| Job form customer picker searchable | `/jobs` → New job → type "A Co 0cfb" → 1 dropdown match → pick fills input; typed-unpicked submit → inline "Select a customer from the list." + stays on /jobs; pick + fill → create → detail page; screenshots/issue-002-after.png | filterable combobox → verified (was native select, 2016 options) | pass (fix dc0985d) |
| Swatch approve without reason | browser: attempt → In progress → Awaiting review → Approved (empty reason) → status "Approved", no console errors, screenshots/issue-003-after.png; tests/qa-swatch-approve.test.ts 2/2 (approve 200, reject 422 /reason/i) | approve succeeds w/o reason → verified (was `A reason is required.`) | pass (fix ff90b9d, test 09e063a) |
| Console health (dashboard, jobs, audit, customers) | `agent-browser errors` after full smoke walk (login → dashboard → jobs → audit filter → customers pager) | no errors → none | pass |
| Audit filter accepts job number + UUID prefix | `fetch /api/audit?jobId={J1-21c8d16b, df044fe2, <full-uuid>, NOPE-123}` → 200/1, 200/35, 200/35, 200/0; UI job number → 1 row; screenshots/issue-004-after.png; tests/qa-audit-filter.test.ts 4/4 | 200 + matching rows for all identifier kinds → matches after fix (was 500 empty-body on non-UUID) | pass (fix 366d23b, test 9231cc2) |

## Findings

### ISSUE-001: Customers list renders all rows with no pagination

- Classification / severity: PRODUCT DEFECT / MEDIUM — task impaired, workaround exists (scroll), but 2000+ DOM rows also hurt render performance.
- Intended contract and source: operator-facing list pages page through large datasets (spec §14 list expectations; every other operator list is bounded).
- Reproduction: localhost:3000 (dev login via seeded admin + TOTP). Open `/customers`. Count `table tbody tr` and pagination controls.
- Observed: 2015 rows, 0 pagination controls; no console errors.
- Evidence: screenshots/issue-001-before.png; counts printed above (rows=2015, pager=0).
- Diagnosis / next action: source page fetches full customer set; needs server-side limit/offset + pager UI. **Fixed** `15cff53`: `lib/services/customers.ts` `listCustomersPage` (LIMIT/OFFSET + count, clamped bounds) + `?page=` pager (50/page, Prev/Next).
- Fix Status: verified (browser: 50 rows, Page 1 of 41, Next → ?page=2) · Commit: 15cff53 (+ test) · Files: lib/services/customers.ts, app/(app)/customers/page.tsx, tests/qa-customers-page.test.ts

### ISSUE-002: Job form customer picker is a native `<select>` over 2016 options

- Classification / severity: PRODUCT DEFECT / MEDIUM — core create-job task impaired (workaround: scroll alphabetically through 2000+ options).
- Intended contract and source: customer picker searchable/combo (spec list-page UX; matches dashboard search affordances).
- Reproduction: `/jobs` → New job → inspect "Customer *" control; `get count "select option"`.
- Observed: native `<select>`, 2016 options ("Select…" + 2015 customers), no typeahead; no console errors.
- Evidence: screenshots/issue-002-before.png.
- Diagnosis / next action: replace with combobox (search input + filtered list), reuse jobs-list search pattern. **Fixed** `dc0985d`: search input + capped (50) filtered dropdown, selection fills input, submit guard rejects typed-but-unpicked text.
- Fix Status: verified (browser: filter → pick → guard message → successful create) · Commit: dc0985d · Files: app/(app)/jobs/create-form.tsx (UI-only — no service layer, browser verification)

### ISSUE-003: Swatch "Approved" wrongly requires a reason

- Classification / severity: PRODUCT DEFECT / MEDIUM — approval flow contract violated; workaround: type dummy reason text (pollutes audit detail).
- Intended contract and source: reason required for **waive / reject / re-swatch** only — the reason box's own label says so ("Reason (waive / reject / re-swatch)"); approve is a clean pass. Rule register swatch gate (start → awaiting → approve/reject/re-swatch).
- Reproduction: `/jobs/a706b613…` (HP-001) → Swatch section → New attempt (sample qty 2, machine SW-1) → Create → click status button twice (In progress → Awaiting review → actions) → click **Approved** with reason box empty.
- Observed: inline error **`A reason is required.`**, attempt stays "Awaiting review"; no console errors.
- Evidence: screenshots/issue-003-step1.png (before click), issue-003-result.png (error state), issue-003-after.png (post-fix approved state).
- Diagnosis / next action: client (or API) gates ALL swatch transitions on reason presence; approve branch must skip the requirement. **Fixed** `ff90b9d`: service gate `rejected|re_swatch` only + client `REASON_REQUIRED` set mirrors it.
- Fix Status: verified (browser approve w/o reason → "Approved"; tests 2/2: approve 200, reject still 422) · Commit: ff90b9d (+ 09e063a test) · Files: lib/services/swatch.ts, app/(app)/jobs/[id]/panels/swatch-panel.tsx, tests/qa-swatch-approve.test.ts

### ISSUE-004: Audit filter accepts only exact full job UUID — job numbers and displayed UUID prefix return 0 rows

- Classification / severity: PRODUCT DEFECT / HIGH — filter unusable in practice (core audit task blocked; operator must obtain UUID out-of-band).
- Intended contract and source: audit filter matches the identifier operators actually hold — job number (`J1-…`, `DN-…`) — or at minimum the truncated UUID the table itself displays.
- Reproduction: `/audit`, Filter box ("Filter by job UUID"), Apply.
- Observed:
  - `J1-21c8d16b` → `table tbody tr` = 0, "No events match."
  - `df044fe2` (exactly what the JOB column shows) → 0 rows
  - full UUID `df044fe2-6a1e-43b4-b424-50e7d57bb5e4` → 35 rows
  - no console errors
- Evidence: screenshots/issue-004-before.png (full-UUID state); counts above; screenshots/issue-004-after.png (job-number filter, post-fix).
- Diagnosis / next action: backend filter did exact match on `$1::uuid` — cast crash for any other input. **Fixed** `366d23b`: prefix LIKE + `jobs.job_number` join, string params only; placeholder updated; misleading zero-state suppressed on error. Regression test `9231cc2`.
- Fix Status: verified · Commit: 366d23b (+ 9231cc2 test) · Files: lib/services/audit.ts, app/(app)/audit/audit-table.tsx

## Discoveries and permanent tests

- Permanent regression tests created in this loop (all follow `tests/qa-*.test.ts` naming, live-DB + `tests/helpers.ts` bootstrap):
  - `tests/qa-audit-filter.test.ts` — 4 cases: job number, UUID prefix, full UUID, non-match (`9231cc2`).
  - `tests/qa-swatch-approve.test.ts` — 2 cases: approve w/o reason → 200, reject w/o reason → 422 `/reason/i` (`09e063a`).
  - `tests/qa-customers-page.test.ts` — 3 cases: bounded + name-ordered page, disjoint pages, out-of-range/invalid clamp (`15cff53`).
- Swatch PATCH response shape discovered: `{ ok: true, version }` (no `status` field); optimistic version chains via `version = version + 1`.
- New attempt after approved → 422 `"Swatch already approved. Re-open the requirement instead."` (correct, unchanged).
- agent-browser quirks: no `css` locator (use `find placeholder|label|text`), `fill` appends on React controlled inputs (use `keyboard type` after `find … click`), `write`/`value` subcommand absent → `get value <selector>`.
- Local supervisor auto-respawns `next-server` within seconds of kill — restart is usually automatic post-build; confirm boot time > build time, probe `/login`=200.

## Coverage limits and cleanup

- Degraded mode: gstack bins absent ($B unbuilt, Aside absent) → learnings/telemetry skipped per skill degraded rules; skill steps read from tool-output doc.
- Not committed (secrets/session): `.gstack/qa-reports/auth-state.json` (session cookie) — `.gstack/` added to `.gitignore`; only report + screenshots force-added.
- ISSUE-002 UI-only → browser-verified, no API contract test (client component, no service layer).
- Test data left in dev DB: customers `QA Sw Co`, `A Co <hash>` seeds, jobs `QA-GUARD-*`-style UI probes (`QA-UI-002`, id `82cdd0e6…`) — dev seed DB, disposable.
- Pushed smoke limited to 4 finding areas + dashboard/jobs; no full 100-page sweep this loop.
