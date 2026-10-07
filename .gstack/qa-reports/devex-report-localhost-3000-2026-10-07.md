# Devex pass — 2026-10-07

Browser walk of the production box (`localhost:3000`, build at main `2247397` / PR #15 stack) plus fix-verification on side port `:3001` (local build incl. sweep changes). Scope: eng-free sweep items A–D; this is D.

Evidence: `run-20261007T071945/screenshots/` (14 shots).

## Verdict

App is in good shape. All four previously-tracked residual QA items verified fixed in the live UI. Two new defects found (one high, one low), both fixed in this sweep and re-verified visually. One cosmetic nit and one environment observation recorded, no action.

## Previously-tracked residuals — verified live

| Item | Check | Result |
|------|-------|--------|
| ISSUE-001 customers pager | Customers page shows `Next →` control | PASS (`06-customers.png`) |
| ISSUE-002 job customer picker | New-job form uses accessible combobox, not raw select | PASS (`05-new-job-form.png`) |
| ISSUE-004 audit job-number filter | `HP-001` → 6 result cells; `DN-1001` → empty state (import writes no audit rows, E4 by design); server check `GET /api/audit?jobId=HP-001` returns rows | PASS (`08-audit-job-filter.png`) |
| ISSUE-003 / error-contract uncoded 4xx | Import invalid file → `POST /api/admin/import` 422 ×4, banner `role=alert` shows server message "File is not valid JSON.", wizard stays usable on step 1 | PASS (`02-import-invalid-file.png`) |

Also verified: audit entity dropdown contains only live ENTITY_TYPES (no dead `stock`/`import` options), notifications empty state renders "No notifications." with `Mark all read` disabled, jobs list empty state renders, dark-mode toggle works both directions, dashboard metrics/queues render.

## Findings

### F1 — Mobile header overlaps itself at 390px (HIGH, FIXED)

At `viewport 390×844` the nav links stack vertically and collide with the logo / theme-toggle / bell / sign-out row ("Customers" renders behind the theme button). Cause: in `app/(app)/nav.tsx` the `<nav>` is `flex-1 min-w-0`, so under narrow widths it collapses toward zero width while its own flex children wrap one-per-line and overflow across the actions block.

Fix: nav becomes `order-3 w-full` below `sm`, retaining `sm:flex-1` behaviour above `sm`. Two-row header on mobile: (logo + actions) / (links).

Verified on `:3001` at 390px: no overlap (`12-mobile-dashboard.png` replaced with post-fix shot). Also shot at 390px: `13-mobile-jobs.png`, `14-mobile-job-detail.png`.

### F2 — Empty-search reuses empty-list copy (LOW, FIXED)

`/jobs?q=ZZZ-nope-9999` displayed "No jobs yet. Create the first one above." although 7234 jobs exist — the zero-results and zero-list states shared one branch.

Fix: `app/(app)/jobs/page.tsx` — with `q` set, copy is now `No jobs match "…".`; empty-list copy unchanged.

Verified on `:3001` (`11-jobs-empty-search.png`).

### F3 — Notifications dropdown shows disabled "Mark all read" beside empty state (NIT, NOT FIXED)

With zero notifications the popover shows a disabled `Mark all read` button above "No events match."-style empty text. Harmless; hiding the button when count is 0 is a product-call, left for a future pass.

### F4 — Wizard resumes at step 3 for an existing previewed batch (OBSERVATION, NOT A DEFECT)

Opening Import with a batch in `previewed`/`confirmed` status lands on "3. Confirm import" (Q7.3 mount effect), not the upload drop zone. This is the designed resume behaviour. The batches seen on the box (`nfy.json`, `fixture.json` — both failed) are leftovers from the 07:17 test run against the box DB, i.e. environment pollution, not app behaviour.

## Environment notes

- Rate limit: 4 junk-file attempts consumed 4/100 of the admin/import window (resets).
- The running `next start` on `:3000` does **not** pick up an in-place `npm run build`; fix verification used a second `next start -p 3001` against the same `.next` (box untouched, `:3001` killed after).
- Screenshots 01/02/11/12 reflect post-fix code where noted; 03–10, 13–14 are box build (`2247397`).

## Not covered

- No Lighthouse/D19 re-benchmark (already done in UX pass; reuse those numbers).
- Keyboard-only traversal and screen-reader pass not repeated (focus rings covered in PR #13).
- No writes against box DB beyond audit/job reads and the 4 rejected uploads (no rows created).
