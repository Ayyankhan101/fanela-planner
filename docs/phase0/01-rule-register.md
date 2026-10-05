# Phase 0 — Rule Register

Formal, testable statement of every operational rule. Source: design spec §4, verified against `Fanela_Internal_Production_Planner_v11.html` (line references = the file). Status: **✓ verified** = confirmed in prototype code; **⚠ needs Phase 0 confirmation** = spec rule not directly checkable in prototype or interpretation must be confirmed with client.

Each rule becomes an automated test in Phases 1–3 (UAT checklist, spec §14).

---

## A. Customer master & order snapshots (spec §4.1)

| ID | Rule | Status |
|---|---|---|
| C1 | Customer master holds: name, contact, email, phone, billing address, default dispatch address, default dispatch method, account reference, notes. | ✓ `initCustomer` (L674) |
| C2 | Selecting a customer for a job copies its defaults onto the job as a frozen snapshot (contact/email/phone/address/method). | ✓ `linkCatalogs` job fields (L163–165) |
| C3 | Jobs are never live-linked to master. Editing master never changes existing jobs. | ✓ jobs carry own `customerAddress`, `dispatchAddress`, `contactName`… (L253) |
| C4 | "Deliberately update customer master" is a separate, confirmed, audited action — never a side effect of order editing. | ✓ new system: `PATCH /api/customers/:id` + `confirm:true` + `customers.update_master` + audit `customer-master` (P1 test) |

## B. Job structure & product grid (§4.2)

| ID | Rule | Status |
|---|---|---|
| J1 | Job header fields: Customer PO, Print/Job Name, Order Date, Order Type ∈ {Bulk, POD, Repeat, Sample}, Priority (1 = highest), assigned staff, process date, dispatch date + time. | ✓ form submit (L227), `initOperations` (L665–666) |
| J2 | Product/colour lines allocate sizes XS–5XL in a structured grid (not free text). | ✓ `skuLines` + size handling (L252) |
| J3 | SKU = master/manufacturer code; Supplier SKU is a separate field. | ✓ `skuLines.supplierSKU` (L252, L670) |
| J4 | Outstanding quantity = ordered − received, computed from stock events; **negative allowed** (over-delivery is real and displayed). | ✓ stock service `stockOverview` (J4 outstanding) — **P2 test green** (rules-j, rules-l) |
| J5 | Search covers: job number, customer, PO, print name, master SKU, supplier SKU. | ✓ new system per spec (prototype differed L236) — P1 test green |
| J6 | Queue sort: dispatch deadline → priority number → process date. | ✓ sort chain (L236) |
| J7 | Job number unique across system. | ✓ unique constraint + pre-check → 409, race caught (P1 test) |
| J8 | Priority level ↔ default number: Urgent → 10, High → 30, Normal → 50; explicit priorityNumber wins. | ✓ `normaliseJob` (L195) |
| J9 | Job completes only when **every required stage is Completed AND dispatch stage is Completed**. | ✓ stage machine + `finaliseDispatch` — **P2 test green** (rules-j J9, rules-d J9, rules-h P5) |

## C. Commercial visibility (§4.3)

| ID | Rule | Status |
|---|---|---|
| M1 | Buying costs entered only by Admin / Operations. | ✓ `canApprove()` gate on cost import (L795); spec |
| M2 | Buying costs viewed by Admin / Operations; Director in reports only. | ✓ `canViewCosts()` = Admin, Ops, Director (L723) |
| M3 | Selling price / tax visible only to authorised-commercial roles (Admin, Ops, Office, Director + flag). | ⚠ Flag holders = open item 1 |
| M4 | Office, Dispatch, Packing, Department Operator never see costs or prices — fields stripped server-side, including inside Excel files (worker decides columns at write time, never generate-then-redact). | ✓ `exportTables` strips `Buying Cost` + filters `order-lines` audit without cost view (L791); spec §11 |

## D. Artwork approval (§4.4)

| ID | Rule | Status |
|---|---|---|
| A1 | Per-job artwork metadata: proof reference, version, status, approved-by/at, Pantone notes, uploads, links, positions. | ✓ `patchArtwork` metadata fields — **P2 test green** (rules-a A1) |
| A2 | Approve / revise-approved artwork: Admin + Operations only; all others read-only. | ✓ `artwork.approve` perm — **P2 test green** (rules-a A2, probe-p2) |
| A3 | Revising an Approved artwork resets status to **Draft**, clears approver, writes audit event with before/after. | ✓ revise → new version row, approver cleared, old immutable — **P2 test green** (rules-a) |
| A4 | State machine: `Draft → Awaiting Approval → Approved | ✓ draft→awaiting→approve/reject(reason)/withdraw/revise; invalid 422 — **P2 test green** (rules-a) |
| A5 | Operators see production reference + approval state but cannot change them. | ✓ read via `jobs.view`, write gated `artwork.approve` — **P2 test green** (rules-a A2) |

## E. Embroidery swatching (§4.5) — critical

| ID | Rule | Status |
|---|---|---|
| S1 | Swatch required = true whenever job has an Embroidery stage; adding Embroidery to an existing job sets required=true. | ✓ requirement required=true on job create (Embroidery) — **P2 test green** (rules-s S1) |
| S2 | Only Admin/Ops may remove the requirement; always confirmed + audited. | ✓ `swatch.decide` + confirm + reason + audit — **P2 test green** (rules-s S2) |
| S3 | Per attempt: sample qty, embroidery file ref, thread colours, stitch count, placement, machine, notes, photos. | ✓ attempt fields persisted (sampleQty, attempt_no) — **P2 test green** (rules-s S3) |
| S4 | Attempt lifecycle: `Waiting → In Progress → Awaiting Approval → Approved | ✓ draft→in_progress→awaiting→approved/rejected(reason); invalid 422 — **P2 test green** (rules-s S4) |
| S5 | Rejected / re-swatch attempts remain visible with reason, photos, timestamps — history never pruned. | ✓ terminal attempts retained with reason + events — **P2 test green** (rules-s S4/S5) |
| S6 | Approved attempts immutable — any change attempt rejected (`A completed swatch attempt cannot be changed`). | ✓ terminal immutable via API (422 "cannot be changed") — **P2 test green** (rules-s) |
| S7 | **Production gate:** if swatch required AND latest attempt ≠ Approved → any Embroidery stage start/progress/complete rejected with state error. | ✓ Embroidery stage start/progress blocked until approved — **P2 test green** (rules-s S7) |
| S8 | Server merges by attempt ID; baseline attempts always win — neither save nor restore can rewrite recorded attempts. | ✓ in-flight blocks new attempt; approved blocks third — **P2 test green** (rules-s S8) |
| S9 | Only the **latest** attempt determines pass/fail. | ✓ latest attempt alone sets gate pass/fail — **P2 test green** (rules-s S9) |
| S10 | Historical jobs gain swatch controls without invented approvals (required default on, attempts empty). | ✓ new job: required=true, attempts=[], gate active — **P2 test green** (rules-s S1) |

## F. Department work & stages (§4.6)

| ID | Rule | Status |
|---|---|---|
| D1 | One stage row per required department per job; stages progress independently. | ✓ one row per required dept; independent progress — **P2 test green** (rules-d D1) |
| D2 | Department users see only their own department's stages; job detail page shows all statuses. | ✓ dept scoping in stage routes — **P2 test green** (rules-d D2, probe-p2) |
| D3 | Operator may update only own department's stage; Admin / Operations override. | ✓ own-dept or Admin/Ops; else 403 dept message — **P2 test green** (rules-d D3) |
| D4 | Stage data: notes, waste qty, reprint qty, quantity, completed/remaining, start/finish timestamps, completing user. | ✓ stage fields incl. timestamps + completing user — **P2 test green** (rules-d D4) |
| D5 | Completing a stage removes it from that department's Active queue only; other queues unaffected. | ✓ own-dept dashboard delta only — **P2 test green** (rules-d D5) |
| D6 | Total prints = pieces × count of selected print positions. | ✓ formula in v11 (printTotal) — ⚠ no as-built surface or test; C6 audit 2026-10-06 |
| D7 | Stage statuses: Waiting, Ready, In Progress, Blocked, Completed; stage auto-completes when completed ≥ quantity. | ✓ 5 statuses + auto-complete progress≥qty — **P2 test green** (rules-d D7) |
| D8 | Completed stage can be **reopened** (sets back to In Progress, clears finishedAt) — must be audited in new system. | ✓ reopen: in_progress, finishedAt cleared, progress=qty−1, audited — **P2 test green** (rules-d D8) |
| D9 | Dispatch stage auto-created if missing (`Dispatch required for overall completion`). | ✓ dispatch stage auto-created on job create — **P2 test green** (rules-d D1) |
| D10 | Dispatch stage cannot complete until all other stages complete. | ✓ dispatch completes only via finalise; others-first guard — **P2 test green** (rules-d D10, rules-h P5) |

## G. Readiness traffic light (§4.7)

| ID | Rule | Status |
|---|---|---|
| G1 | Colour is computed by the server on every relevant change; never client-settable. | ✓ server-computed; strict schema rejects client write — **P2 test green** (rules-g G1) |
| G2 | **Zero active gates → White** (check runs before any `.every()` evaluation). | ✓ zero active gates → white — **P2 test green** (rules-g FX-5) |
| G3 | All required gates pass → Green; none pass → White; partial → Amber. | ✓ all pass→green / partial→amber / none→white — **P2 test green** (rules-g FX-5) |
| G4 | Blank `screens required` = not yet specified = gate **not passed** (null ≠ 0; "0 screens" must be an explicit not-required confirmation). | ✓ blank screens required = gate active, not passed — **P2 test green** (rules-g G4) |
| G5 | Stock gate passes only when every line: ordered qty confirmed, physically received ≥ ordered, `stockConfirmed` true, and **no open stock issues** (Short / Backorder / Picking Error / Damaged). | ✓ stock gate all-of + issues — **P2 test green** (rules-g G5) |
| G6 | Any open stock issue forces at least Amber. | ✓ issue floor forces ≥amber — **P2 test green** (rules-g FX-5) |
| G7 | Swatch gate: required + latest attempt not Approved → colour never Green (prototype forces Amber). | ✓ swatch fail floors amber — **P2 test green** (rules-g FX-5) |
| G8 | Screens gate passes when `screensNotRequired` confirmed OR (`required > 0` AND `made == required` AND `confirmed`). | ✓ screens notRequired OR required==made==confirmed — **P2 test green** (rules-g G8) |

## H. Dispatch & shipments (§4.8)

| ID | Rule | Status |
|---|---|---|
| P1 | Edit/record rights: Dispatch + Admin/Ops. Office sets planned method/address at job entry. Director + Packing read-only. | ✓ `dispatch.edit` / `jobs.plan_dispatch` perms — **P2 test green** (rules-h P1, probe-p2) |
| P2 | Four methods with method-specific fields; Collection requires confirmation before final. | ✓ method enum + Collection confirmCollection — **P2 test green** (rules-h P2) |
| P3 | "Record booking" creates a shipment record; "record final dispatch" records departure, user, time. | ✓ shipment record per booking + final dispatch events — **P2 test green** (rules-h P3) |
| P4 | Other required stages must be finished before final dispatch. | ✓ other stages first — finalise 422 guard — **P2 test green** (rules-h P5) |
| P5 | **Dispatch stage closes only via explicit "Finalise dispatch / close shipments" action**; rejected while any shipment is non-final/non-void (abandon allowed with reason + audit). | ✓ dispatch stage closes only via finalise; abandon+reason path — **P2 test green** (rules-h P5, rules-d D10) |
| P6 | Part dispatch: multiple shipments per job retained; one dispatched shipment ≠ job/stage closed. | ✓ multiple shipments; first final → job part_dispatched — **P2 test green** (rules-h P6) |
| P7 | Void = event with reason against the shipment; booking rows never deleted; no carrier-side cancel until API exists. | ✓ void keeps row + reason + event; frozen after — **P2 test green** (rules-h P7) |
| P8 | Shipment lifecycle: `Draft → Booking Arranged → Booked → Labels Attached → Print Requested → Labels Printed → Dispatched | ✓ full lifecycle + invalid jump 422 — **P2 test green** (rules-h P8) |
| P9 | DPD manual workflow: book externally → enter consignment → save booking **first** → attach labels (25 MB default) → log print requests (never claim physical success) → manual "labels printed" confirm → failures keep data for retry. | ✓ print_requested manual → labels_printed sets flag; no auto-claim — **P2 test green** (rules-h P9) |

## I. Excel & reporting (§4.10)

| ID | Rule | Status |
|---|---|---|
| E1 | Exports generated on server, filtered by caller permissions (jobs, filtered jobs, department, stock/shortage, swatches, shipments, audit, customers, products). | ✓ `exportTables` (L791, L786, L791 swatch/shipment tables) |
| E2 | Historical quantities in reports are snapshots — never summed as stock movements. | ⚠ Spec rule; enforce in report queries |
| E3 | Imports are add-only: dedupe on natural keys (job number, SKU), existing rows skipped, imported artwork starts Draft. | ✓ L795 (`New jobs import as artwork Draft…`) |
| E4 | Never reconstruct from Excel: swatch approvals, shipment records, photos, audit history. | ✓ warning text (L795) |
| E5 | Import pipeline: Upload → Parse → Validate → Preview (creates/skips/errors) → Confirm → Execute → Audit → Result; `import_batches` row + original file retained. | ⚠ Spec addition over prototype |
| E6 | Only Ops/Admin may import buying costs; only Ops/Admin may waive swatch on import. | ✓ L795 |
| E7 | Excel exports strip cost columns for users without cost view; `order-lines` audit rows hidden from non-cost viewers. | ✓ L791 |

## J. Audit & stock history (§4.11)

| ID | Rule | Status |
|---|---|---|
| L1 | Stock history append-only: receipts/adjustments/corrections with reason, user, timestamp, job/line link; corrections reference `correctsEventId`; existing events always win over any incoming save/restore. | ✓ append-only stock_events + correction `correctsEventId` + reason (admin/ops) — **P2 test green** (rules-l L1) |
| L2 | Operational audit append-only with before/after snapshots; kinds: `job-header, order-lines, stage, artwork, swatch, dispatch, stencil, customer-master`. | ✓ all 8 kinds written + verified via `GET /api/audit` — **P2 test green** (rules-l L2) |
| L3 | Audit access scoped: department users see own-department events; `order-lines` and cost-bearing rows only for cost viewers. | ✓ dept own-dept rows only; order-lines cost-viewers only — **P2 test green** (rules-l L3) |
| L4 | App DB role has INSERT + SELECT only on both logs; nightly sequence-integrity check. | ✓ INSERT+SELECT grants + RLS append-only verified — **P2 test green** (db-security) · nightly sequence-integrity check = ops runbook (Phase 3) |
| L5 | Removing a job line or archiving a job writes a stock-history event (`line-removed` / `archived`) — history survives record removal. | ✓ line_removed event, FK set null, history survives — **P2 test green** (rules-l L1) |

## K. Backup, auth, sessions (§4.12, §10)

| ID | Rule | Status |
|---|---|---|
| B1 | Nightly `pg_dump` + MinIO mirror copied off-box; retention ≥ 30 days (confirm); documented restore procedure. | ⚠ New system |
| B2 | JSON backup retained as export/migration artefact; prototype file + backups kept ≥ 90 days after go-live. | ⚠ Spec §13 |
| B3 | Passwords Argon2id; TOTP MFA mandatory Admin/Ops/Dispatch, optional others; recovery codes shown once. | ✓ new system: forced setup flow + 8 sha256 recovery codes shown once (P1 test) |
| B4 | Session: 2 h idle timeout, 12 h absolute cap, httpOnly/sameSite/secure cookie, logout deletes row. | ✓ OI-7 decided 2h/12h — implemented + P1 test |
| B5 | Login rate-limited per email + per IP with progressive lockout; failures logged. | ✓ new system: 5/15min email lock, 20/15min IP, `login_attempts` log (P1 test) |
| B6 | No hard delete of jobs/shipments/swatch attempts/audit/stock records; void/cancel/correct instead. | ✓ archive flag only, no DELETE handlers, append-only grants/RLS (P1 test; F4 → archive migration mapping) |

---

## Prototype discrepancies found during register verification

| Finding | Detail | Resolution needed |
|---|---|---|
| **F4** | v11 "Archive" button calls `deleteJob` → **hard-deletes the job row** (`jobs.filter`, L230). Stock history retains an `archived` event but job/orders/stages are gone. Spec mandates no hard deletes. | New system implements true archive flag (`jobs.archived`) — confirm with client that v11 archive was understood as permanent removal and is acceptable to migrate as archive. |
| **F7** | Prototype auto-adds Dispatch stage to every job (`ensureDispatch`). | New system keeps dispatch stage always required — consistent with spec J9. No action. |
| **F8** | Readiness in v11 = stock + screens (+ swatch override to Amber). Spec formula counts swatch as a third gate. Equivalent for Green; White/Amber boundary may differ for edge cases (e.g. stock issue only). | Verify during item 3 walkthrough with the exact prototype in hand. |
