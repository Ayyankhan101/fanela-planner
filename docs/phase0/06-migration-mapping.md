# Phase 0 — Migration Mapping (v11 → new system)

Source: `Fanela_Internal_Production_Planner_v11.html` schema v3 → spec §6 tables. One-off migration script, run in staging, never in prod writes (spec §13). Every mapping row must produce the reconciliation rows in 05 §4.

---

## 1. Source resolution order

```text
localStorage dump (preferred)
  → state = parse(keys in readState order: KEY + 12 OLD_KEYS, L180)
  → if absent, fall back to …_before_import (L475 full snapshot)
  → customers/products: from state; if jobs-only file → rebuild via linkCatalogs rules (L163)
  → stockEvents / operationsEvents: state only; jobs-only file ⇒ BLOCKED (F9)
  → accounts: …_accounts (role mapping only; passwords discarded, users recreated)
```

## 2. Entity mapping

| v11 source | Target table | Key mapping | Rules |
|---|---|---|---|
| `customers[]` | `customers` | `legacy_id = id` | copy fields 1:1; blank name → fail row (05 §3) |
| `products[]` | `products` + `product_skus` | `legacy_id = id` | one row per colour SKU |
| `jobs[].id` | `jobs` | `legacy_id`, `job_number` UNIQUE | `status` computed: all stages done + dispatch final → `Completed`, else `Open` (dispatched shipment → `PartDispatched`) |
| `jobs[].customerId` + header fields | `jobs` FK + `job_contact_snapshot`, `job_dispatch_snapshot` | 1:1 PK=job_id | snapshot frozen from job header values at migration; customer missing → rebuild catalog first |
| `jobs[].skuLines[]` | `job_lines` | `legacy_id = skuLines[].id` | `buying_cost`, `unit_price` copied **only** for privileged preview; never in exports |
| `jobs[].skuLines[].quantities` size map | `job_line_sizes` | (line_id, size) | size vocab: XS/S/M/L/XL/2XL/3XL/4XL/5XL |
| `jobs[].stages[]` | `job_stages` | `legacy_id = stages[].id` | department name → dept key via **Part B decision (04)**; status map below §3 |
| `jobs[].positions[]` | `print_positions` | order preserved | names only; qty = job quantity × count of positions (`printTotal`, L200) |
| `jobs[].screensRequired / made / confirmed / notRequired` | `screen_records` | 1:1 job_id | `required: int NULL` — blank stays NULL (G4); `notRequired` → explicit bool |
| `jobs[].artworkApproval` | `artworks` + `artwork_versions` | 1:1 job, version 1 | status map below §3; assets absent in v11 (files entered manually) → `artwork_assets` empty, `proof_reference` text kept |
| `jobs[].swatch.required` | `swatch_requirements` | 1:1 PK=job_id | |
| `jobs[].swatch.attempts[]` | `swatch_attempts` | `attempt_no = index+1`, `legacy_id` | **bit-identical terminal rows** (Approved/Rejected/Re-swatch); status map §3 |
| `jobs[].dispatch` header | `jobs.dispatch_method`, dispatch address → `job_dispatch_snapshot` | | planned method = Office-plan value |
| `jobs[].dispatch.shipments[]` | `shipments` | `legacy_id = shipments[].id` | state inferred §4; `voided`→`Void` keeps `void_reason`; `final_at = finalAt` |
| `plannerState.stockEvents[]` | `stock_events` | `legacy_id = events[].id` | append-only; `correctsEventId` preserved; kinds `line-removed`/`archived` (L587/L590) preserved as-is |
| `plannerState.operationsEvents[]` | `operational_audit` | `legacy_id = id` | kind map: `job-header, order-lines, stage, artwork, swatch, dispatch, stencil, customer-master` (L711) → same enum |
| `jobs[].priority / priorityNumber / assignedTo / notes / dates` | `jobs` columns | | priority map: Urgent→10, High→30, Normal→50; explicit number wins (J8) |
| `jobs[].readiness` / gates | *(not migrated)* | | recomputed by server formula after load; cache never trusted (spec §9) |
| `jobs[].deleted/archive` | `jobs.archived` | | v11 has no archive flag — hard-deleted jobs are **already gone** (F4); nothing to map |
| `…_accounts[]` | *(not migrated)* | | recreate users; map role name per 04 Part B; active flag default true; force password reset + MFA enrol |

## 3. Status maps

| Entity | v11 value | Target value |
|---|---|---|
| Stage status | `Waiting` | `Waiting` |
| | `Ready` | `Ready` |
| | `In Progress` | `InProgress` |
| | `Blocked` | `Blocked` |
| | `Completed` | `Completed` |
| Artwork status | `Draft` | `Draft` |
| | `Approved` | `Approved` (approvedBy/At preserved) |
| | `Rejected` | `Rejected` (reason preserved if present) |
| | *(no Awaiting row in v11 data)* | leave unset; new states only in new system |
| Swatch attempt | `Waiting` | `Draft` (mapping confirmed in 03 §5) |
| | `In Progress` | `InProgress` |
| | `Awaiting Approval` | `Awaiting` |
| | `Approved` / `Rejected` / `Re-swatch Required` | same, immutable |
| Stock status (derived) | `Not Ordered, Ordered, Part Received, Complete, Short, Backorder, Picking Error, Damaged / Incorrect Stock` | recomputed server-side from stock_events + confirm flags; legacy string kept on `job_lines.legacy_stock_status` for the report only |

## 4. Shipment state inference (legacy rows have no enum)

| Legacy evidence | Target state |
|---|---|
| `finalAt` set | `Dispatched` (or `Collected` if method=Collection — decide per row, default `Dispatched`) |
| `voided = true` | `Void` (+ `void_reason`) |
| `labelPrinted` set / `printRequests.length > 0` | `Labels Printed` |
| `tracking` present | `Booked` |
| `consignment` or `bookedBy` present | `Booking Arranged` |
| otherwise | `Draft` |

⚠ Dry-run report must list every shipment + inferred state; **human confirm** before prod import (spec §13 exit criterion).

## 5. Files / assets

v11 stores artwork references + swatch photos as text/paths inside job objects (no blob store). Migration:

| Data | Action |
|---|---|
| `artworkApproval.proofReference`, position notes | text → `artworks` columns |
| swatch photos (URLs/paths in attempts) | text → `swatch_assets.external_ref`; **if files live outside the JSON, collect separately** — open item 8 |
| Excel imports (source `.xlsx` files) | archived as evidence, not imported as rows |
| Prototype HTML + Backup JSON | keep ≥ 90 days post-go-live (B2) |

## 6. Migration sequence (staging → prod)

```text
1. Load dump → validate (analyze-backup.mjs) → fix issues → re-run (05)
2. Write staging: customers → products/skus → users/roles (04 mapping) → jobs(+snapshots)
   → lines+sizes → stages → screens → artworks → swatches → shipments → stock_events → audit
3. Recompute readiness server-side; print gate summary (Green/Amber/White counts)
4. Reconciliation table 05 §4: every Δ explained in writing
5. Dry-run sign-off (client confirms shipment states + counts)
6. Prod import in maintenance window; frozen v11 readonly (read-only login message)
7. Post-import probe: gate colours, swatch blocks, permission probe tests, one real dispatch path
```

## 7. Non-migratable (explicit list for client)

| Item | Reason | Compensating control |
|---|---|---|
| Password hashes | local salted hash, not Argon2id | users recreated; forced reset + MFA (B3) |
| Hard-deleted v11 jobs | v11 Archive = delete (F4) | none — data gone; confirm acceptance (04/08) |
| Backup-button-only exports | no stock/audit history (F9) | full localStorage dump required (05 §0) |
| Session state, `before_import` backups beyond latest | one snapshot only | archive key with the dump |
