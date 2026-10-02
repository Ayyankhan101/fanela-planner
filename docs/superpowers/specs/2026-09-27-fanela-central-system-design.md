# Fanela Central System — Design Spec

**Date:** 2026-09-27
**Status:** Awaiting user review
**Input:** `Fanela_Internal_Production_Planner_v11.html` (schema version 3) + `Fanela_Planner_v11_Operations_Guide.pdf`
**Source assessment:** "Fanela Planner v11 — From Prototype to Production System"

---

## 1. Goal

Re-platform the v11 browser-local prototype into a central, multi-user, server-enforced web application.

> Preserve the operational logic exactly as it evolved in v11. Replace the browser-local trust model.

v11 is the executable specification. Every operational rule is a requirement. Only technical plumbing changes.

## 2. Decision Log

| Decision | Choice |
|---|---|
| Session deliverable | This design spec only; implementation plan explicitly excluded for now |
| Architecture | Approach A — single Next.js full-stack app (modular monolith) |
| Stack | Next.js 15 (App Router, TypeScript), Route Handlers = API |
| ORM / DB | Drizzle ORM + PostgreSQL 16 |
| Auth | Built-in Auth.js credentials provider, Argon2id password hashes, TOTP MFA |
| Queue | pg-boss (Postgres-backed; no Redis) |
| File storage | MinIO (S3-compatible), private buckets |
| Hosting | Self-hosted VPS via Docker Compose: `caddy + app + worker + postgres + minio` |
| MVP scope | Full doc MVP (all must-haves from assessment §18); DPD API and Xero adapters after |
| Build vs buy | Off-the-shelf print MIS/ERP (PrintVis, Odoo) considered and rejected — see §20 |
| Migration data | Single machine, one recent full JSON backup assumed clean; inventory check retained as cheap first step |
| UI language | English |

**Overridden generic recommendations from the assessment:** NestJS/ASP.NET, Entra ID/Auth0/Keycloak, BullMQ/Redis, AWS/Azure — all replaced by the choices above. The assessment's position that "the architecture matters more than the language" is honoured: modular monolith, server-enforced rules, append-only logs.

## 3. Architecture

### 3.1 Deployment (VPS, Docker Compose)

```text
VPS
├─ caddy       reverse proxy, TLS (auto Let's Encrypt)
├─ app         Next.js 15 — UI + Route Handlers
├─ worker      same image, entrypoint runs pg-boss job loops
├─ postgres    16, named volume, nightly pg_dump to off-box
└─ minio       S3-compatible, private buckets, nightly mirror
```

### 3.2 Repo layout

```text
src/
  app/                     UI pages + Route Handlers (thin: parse → requirePermission → call module → serialize)
  modules/
    identity/              users, roles, permissions, sessions, TOTP, login rate-limit
    customers/             customer master + deliberate-update action
    jobs/                  job, snapshots, lines, size grid, search, sorting, versioning
    stock/                 receipt/adjustment events, outstanding computation
    production/            departments, job stages, screens, readiness computation
    artwork/               versions, approval state machine
    swatch/                requirement, attempts, production gate
    dispatch/              shipments, shipment events, void/cancel
    audit/                 operational audit + stock history append-only writes
    excel/                 server-side export jobs, staged import pipeline
    integrations/          outbox, DPD/Xero adapters (post-MVP only)
  db/                      Drizzle schema, migrations, seed (roles/permissions/departments)
  lib/                     auth guards, concurrency helpers, storage client, queue, logging
tests/                     domain-rule tests per module + UAT scenario suite
```

### 3.3 Module rules (enforced with dependency-cruiser in CI)

- Modules may import: `db`, `lib`, and another module's `index.ts` only.
- No deep imports across modules; no `app/` imports inside `modules/`.
- Route handlers contain no business logic.
- Every mutation goes through its module's service function — the only place state machines live.

### 3.4 Server-side enforcement

Every route handler executes in order:

1. `getSession()` — authenticated?
2. `requirePermission(perm)` — role allows?
3. Module service — department scope, field-level stripping, workflow state transition valid?
4. Optimistic concurrency check — `version` matches?
5. Transaction — write entity + audit event atomically.

The UI hides actions; the API enforces them. Only the API matters for security.

## 4. Operational Rules Preserved from v11 (non-negotiable)

### 4.1 Customer master & order snapshots

- Customer master stores: name, contact, email, phone, billing address, default dispatch address, dispatch method, account reference, commercial notes.
- Selecting a customer copies defaults onto the job as a frozen snapshot (contact, phone, email, dispatch address, dispatch method).
- Jobs are never live-linked to master. Changing master does not change existing jobs.
- "Deliberately update customer master" is a separate, confirmed, audited API call — never an automatic side effect.
- Tables: `customers`, `job_contact_snapshot`, `job_dispatch_snapshot` (1:1 with job).

### 4.2 Job structure & product grid

- Job fields: Customer PO, Print Name/Job Name, Order Date, Order Type (Bulk, POD, Repeat, Sample), Priority (1 = highest), assigned staff, process date, dispatch date/time.
- Product grid: XS–5XL allocation per product/colour line, structured table (not free text).
- SKU = Manufacturer/Master Product Code; separate Supplier SKU field.
- Outstanding quantity = ordered − received, computed from `stock_events`, negatives allowed (over-delivery).
- Search: job number, customer, PO, print name, master SKU, supplier SKU.
- Queue sort: dispatch deadline → priority → process date.

### 4.3 Commercial visibility (field-level, server-side)

| Field | Enter | View |
|---|---|---|
| Buying costs | Admin, Operations | Admin, Operations; Director in reports only |
| Selling price / tax | authorised commercial roles only (Admin, Operations, Office, Director with flag) | same |
| Costs/prices for Office, Dispatch, Packing, Department Operator | never | never |

API strips restricted fields from responses. Hidden columns in UI are not sufficient.

### 4.4 Artwork approval

- Metadata: proof reference, version, approval status, approved-by/date, Pantone/colour notes, uploads, links, references, positions.
- Approve / revise-approved artwork: Admin and Operations only. All other roles read-only.
- Revising approved artwork creates a new version, resets status to Draft, writes audit event with before/after.
- Operators see production references and approval state, cannot change it.
- State machine: `Draft → Awaiting Approval → Approved | Rejected`; `Approved → (revision) → Draft (new version, audited)`.

### 4.5 Embroidery swatching (critical workflow)

- Embroidery jobs require swatch by default; Admin/Ops may waive with audit entry.
- Older jobs gain swatch controls without invented historical approvals.
- Per attempt: sample quantity, embroidery-file reference, thread colours, stitch count, placement, machine, notes, sample photos.
- Events: start (operator + time), complete/request approval (user + time), approve, reject (reason required), request re-swatch (reason required).
- Rejected attempts remain visible with reason/photos/timestamps.
- Approved attempts are immutable; another sample = new attempt.
- **Production gate, enforced in backend domain layer:**

```text
IF swatch_required = true AND latest_attempt.status != Approved
THEN embroidery stage transition (start production / add progress / complete) = REJECTED (422)
```

- Attempt lifecycle: `Draft → InProgress → Awaiting → Approved (immutable) | Rejected (reason) → new attempt`.
- Requirement toggle: `Required ↔ Not Required`, always audited.

### 4.6 Department work & stage control

- Each job has one `job_stages` row per required department; stages progress independently.
- Department users see only their department's stages; job detail shows all statuses for coordination.
- Operator updates only own department's stage (or Admin/Ops override).
- Stage data: notes, waste quantity, reprint quantity, quantity, progress, remaining pieces; start/finish timestamps; completion user.
- Completing one stage removes it from that department's Active queue; other stages stay open.
- Total prints = pieces × selected print positions.
- Job complete = ALL required stages Completed AND dispatch stage Completed (dispatch always required).

### 4.7 Readiness traffic light (computed, never client-settable)

Separate *what is required* from *whether the gate passes* — otherwise jobs with no screens/swatch requirements read "part ready" when they are not:

```typescript
// 1. Which gates are active for this job?
const requiresStock = jobLines.length > 0;
const requiresScreens = screenRecord.required !== null; // null = pending specification
const requiresSwatch = swatchRequirement.required === true;

// 2. Active gates: pass / not applicable
const stockGatePass = !requiresStock || (stockReceived >= stockOrdered);
const screenGatePass = !requiresScreens || (screensMade >= screensRequired);
const swatchGatePass = !requiresSwatch || (latestSwatchStatus === 'Approved');

// 3. Count required vs passing
const totalRequiredGates = [requiresStock, requiresScreens, requiresSwatch].filter(Boolean).length;
const totalPassingGates = [stockGatePass, screenGatePass, swatchGatePass].filter(Boolean).length;

// 4. Traffic light
if (totalRequiredGates === 0) return 'White'; // edge case: empty job
if (totalPassingGates === totalRequiredGates) return 'Green';
if (totalPassingGates === 0) return 'White';
return 'Amber'; // partial
```

Lives in `production` module service. Recomputed server-side on every relevant state change. Never client-settable (any cache column, §6.1, is derived only).

**Developer note (empty-array trap):** the zero-gate check in step 4 must run *before* any gate evaluation. `[].every(...)` / `[].filter(...).every(...)` in JavaScript/TypeScript return `true` for empty arrays — relying on them turns a job with no products, screens or swatches instantly Green. Check `totalRequiredGates === 0 → White` explicitly.

### 4.8 Dispatch & shipments

- Roles: Dispatch + Admin/Ops edit and record; Office sets planned method/address at entry; Director + Packing read-only.
- Four methods with method-specific fields:
  - **Collection:** contact, phone, date, time, confirmation (required)
  - **DPD:** consignment, parcels, weights, service, instructions, labels
  - **Same Day:** courier, driver, collection time, ETA, reference
  - **Fanela Van:** driver, route, departure, ETA
- Changing method saves the choice and reloads method-specific fields.
- "Record booking/collection arrangement" creates a saved shipment record; "record final dispatch/collection" records departure, user, time.
- Other required stages must be finished before final dispatch.
- **Dispatch stage completion is an explicit action.** A shipment reaching a final state (Dispatched/Collected) does NOT complete the stage: with multiple/part shipments, early shipments must not auto-close the job. Dispatch takes an explicit "Finalise dispatch / close shipments" action, confirming no further part-dispatches are expected; the server rejects finalise while any shipment is non-final and non-void (unless the user explicitly marks it abandoned, audited).
- Part Dispatched = at least one shipment dispatched while job open; multiple shipments retained per job.
- Cancellation/void: event with reason against the shipment; booking record never erased; no carrier-side cancellation unless later integrated.
- Shipment lifecycle:

```text
Draft → BookingArranged → Booked → LabelsAttached → PrintRequested → LabelsPrinted
      → Dispatched | Collected | (any non-final) → Cancelled/Void
```

### 4.9 DPD (manual mode is the MVP)

No live booking in MVP. Server-stored version of the prototype workflow:

1. Book externally with DPD → 2. enter consignment/parcel details → 3. confirm booking → 4. attach returned label files (limit configurable, default 25 MB) → 5. booking saved first → 6. open saved labels for print/reprint → 7. log print request (never claim physical success) → 8. manual "confirm labels printed" → 9. on failure, saved booking/tracking/labels remain for retry.

Future API mode (post-MVP): server-side credentials, persist request → call DPD → persist response, consignment/tracking/parcel/label refs, reprint, cancellation where supported, retry from saved shipment. **Manual mode always retained as fallback.**

### 4.10 Excel & reporting

- Exports (server-generated, role-filtered): all jobs, filtered jobs, department report, stock/shortage, swatches, shipments, operational audit, customer, product catalogue.
- Historical quantities in reports are snapshots — never summed as stock movements.
- Imports: add-only, dedupe on natural keys (job number, SKU), existing records skipped; imported artwork starts as Draft.
- Never reconstruct from Excel: historical swatch approvals, shipment records, photos, audit events.
- Import pipeline: `Upload → Parse → Validate → Preview (creates/skips/errors) → Confirm → Execute → Audit → Result report`, with `import_batches` row + original file retained.

### 4.11 Audit & stock history (two separate append-only logs)

1. **`stock_events`** — receipts, adjustments, corrections with reason, user, timestamp, related job/line. No UPDATE/DELETE at application layer.
2. **`operational_audit`** — job/header, priority, order-line, artwork, stencil, swatch, stage, customer-master, dispatch, shipment, approval, permission-sensitive changes. Before/after JSONB snapshots. No UPDATE/DELETE.

- Access: department users see events relevant to their work; sensitive commercial changes restricted to Admin/Ops/Director-scope.
- Swatch attempts retained in audit.
- DB role for the app: INSERT + SELECT only on these tables; nightly sequence-integrity check.

### 4.12 Backup & recovery

- JSON backup remains available as export/migration artefact.
- Operational continuity: nightly `pg_dump` + MinIO mirror copied off-box; retention ≥ 30 days; restore procedure documented in ops runbook.
- Keep previous JSON backup and prototype file until migrated records verified.

## 5. What Changes (technical limitations only)

| v11 limitation | Target |
|---|---|
| localStorage | Central PostgreSQL |
| No cross-machine sync | Central web app, simultaneous users |
| Local accounts/salted hashes | Server auth, Argon2id + TOTP MFA |
| Client-side-only roles | Server RBAC + field-level permissions at every endpoint |
| Browser-storage wipe = data loss | Managed nightly backups, off-box copy |
| Attachments in browser, 2 MB | MinIO, default 25 MB configurable, MIME allowlist, access-checked presigned URLs |
| No concurrency handling | Optimistic locking via `version`, conflict → clear error |
| Local audit | Server append-only, before/after snapshots |
| Manual-only DPD | MVP keeps manual (server-stored); API adapter later |
| No Xero | Outbox-pattern adapter post-MVP |
| Browser print dialog | Stored label files, print-request log, confirmed-print events |
| Client-side Excel | Server exports / staged imports |
| No monitoring | Structured logs, healthchecks, uptime check; error tracker optional later |
| Migration via browser access | Controlled JSON-backup migration tooling |

## 6. Data Model

UUID PKs everywhere; human-readable keys preserved (job number, customer reference, SKU) with unique constraints; v11 IDs stored in `legacy_id` on migrated rows.

### 6.1 Tables

```text
IDENTITY
  users                    id, email uniq, name, password_hash, totp_secret?, active, created_at
  roles                    id, key (admin|ops|office|director|dispatch|packing|dept)
  permissions              key (seeded catalogue, shared with UI)
  role_permissions         role_id, permission_key
  user_roles               user_id, role_id
  user_departments         user_id, department_id
  sessions                 id, user_id, expires_at, ip, ua
  login_attempts           email, ip, ts  (rate limit / lockout)

CUSTOMERS & PRODUCTS
  customers                id, legacy_id, name, contact*, email, phone, billing_address,
                           default_dispatch_address, default_dispatch_method, account_ref,
                           notes, active
  products                 id, legacy_id, name, active
  product_skus             product_id, master_sku uniq, supplier_sku

JOBS
  jobs                     id, legacy_id, job_number uniq, customer_id, po, print_name,
                           order_date, order_type, priority, staff, process_date,
                           dispatch_date, dispatch_time, status,
                           readiness_cache?,  -- derived only; server recomputes on every
                                              -- relevant change (§4.7 is the source of truth)
                           version int default 1, created_by, created_at, updated_at
  job_contact_snapshot     job_id PK, name, email, phone, address  (frozen at entry)
  job_dispatch_snapshot    job_id PK, method, address, instructions  (frozen at entry)
  job_lines                id, legacy_id, job_id, product_id, colour, qty_ordered,
                           unit_price?, tax?, buying_cost?, version
  job_line_sizes           job_line_id, size (xs..5xl), qty   -- structured grid
  job_stages               id, legacy_id, job_id, department_id, status, process_date,
                           qty, progress, remaining, notes, waste, reprint_qty,
                           started_at, finished_at, completed_by, version
  departments              id, key (print|dtg|dtf|embroidery|sewing|screens|warehouse|packing|dispatch), name

STOCK & SCREENS
  stock_events             id, job_line_id, type (receipt|adjustment|correction), qty,
                           reason, user_id, ts              -- append-only
  screen_records           id, job_id, required int NULL,  -- NULL = "blank = not yet specified"
                                                   -- (NOT 0; UI must send null when left blank)
                           made int, positions jsonb, notes, version

PRINT
  print_positions          id, job_id, name, pieces   -- total prints = Σ pieces

ARTWORK
  artworks                 id, job_id, kind, current_version_id
  artwork_versions         id, artwork_id, version int, proof_ref, status, pantone_notes,
                           approved_by?, approved_at?, created_by, created_at
  artwork_assets           artwork_version_id, file_id
  artwork_events           artwork_version_id, action, actor, ts, reason?, before/after

SWATCH
  swatch_requirements      job_id PK, required bool, waived_by?, waived_reason?, waived_at?
  swatch_attempts          id, job_id, attempt_no, status, sample_qty, emb_file_ref,
                           thread_colours, stitch_count, placement, machine, notes,
                           started_by?, started_at?, completed_by?, completed_at?,
                           decided_by?, decided_at?, reason?
                           -- no immutable column: RLS policy (FORCE, non-owner app role)
                           -- blocks UPDATE of rows where status='Approved' (§9)
  swatch_attempt_events    attempt_id, action, actor, ts, reason?
  swatch_assets            attempt_id, file_id

DISPATCH
  shipments                id, job_id, method, status, booking fields (jsonb per method),
                           version, created_by, created_at
  shipment_events          shipment_id, action, actor, ts, reason?
  shipment_attachments     shipment_id, file_id, kind (label|proof), confirmed_printed bool?

FILES
  files                    id, entity_type, entity_id, name, size, mime, checksum,
                           bucket, key, uploaded_by, uploaded_at, immutable bool

AUDIT / OPS
  operational_audit        id, entity_type, entity_id, job_id?, action, actor_id, actor_role,
                           before jsonb?, after jsonb?, request_id, ts   -- append-only
  import_batches           id, kind, file_id, status, created, skipped, errors, result jsonb, actor, ts
  integration_outbox       id, kind (dpd|xero), payload, status, attempts, last_error, ts
```

### 6.2 Indexes / search

- `jobs(job_number)`, `jobs(customer_id)`, trigram search on customer name / print_name / PO; SKU lookups via `product_skus`.
- Queue queries: index on `(dispatch_date, priority, process_date)`.
- Audit: `(job_id, ts)`, `(entity_type, entity_id, ts)`.

### 6.3 Database security migrations

Drizzle manages tables, columns and indexes — it does **not** manage roles, `GRANT`/`REVOKE`, or RLS policies. Maintain a separate folder of raw SQL migrations (`db/security/*.sql`) executed **after** Drizzle migrations in CI/CD, containing: app login role creation (non-owner), table grants (append-only tables = `INSERT, SELECT` only, no `UPDATE, DELETE`), `FORCE ROW LEVEL SECURITY` + policies (e.g. swatch immutability, §9), and audit-table access rules. Order matters: schema migration → security migration → app deploy.

## 7. State Machines (server-enforced; invalid transition → 422 + audit gap log)

| Machine | States / transitions |
|---|---|
| Job readiness | derived: White / Amber / Green |
| Job lifecycle | Open → InProduction → PartDispatched → Completed (no hard delete; cancel = status + audit) |
| Artwork | Draft → Awaiting → Approved \| Rejected; revise(Approved) → new version Draft |
| Swatch requirement | Required ↔ Not Required (audited) |
| Swatch attempt | Draft → InProgress → Awaiting → Approved (immutable) \| Rejected(reason) ; rejected → new attempt |
| Job stage | Waiting → Ready → InProgress → Completed; Blocked (swatch gate); completion needs all-prior gating rules |
| Shipment | Draft → BookingArranged → Booked → LabelsAttached → PrintRequested → LabelsPrinted → Dispatched \| Collected; any non-final → Cancelled/Void(reason) |

## 8. Permissions

### 8.1 Roles

Admin, Operations Manager, Office, Director, Dispatch, Packing, Department Operator (scoped to own department).

### 8.2 Matrix (`Y` yes, `Y*` conditional, `R` read-only, `L` limited scope, `N` no)

| Capability | Admin | Ops | Office | Director | Dispatch | Packing | Dept Op |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Manage users/roles/backup restore | Y | N | N | N | N | N | N |
| Customer master view | Y | Y | Y | Y | Y | Y | N |
| Customer master edit | Y | Y | Y | N | N | N | N |
| Deliberate master update | Y | Y | N | N | N | N | N |
| Create/edit jobs | Y | Y | Y | R | L (planned dispatch only) | R | N |
| Enter buying costs | Y | Y | N | N | N | N | N |
| View buying costs | Y | Y | N | Y* reports | N | N | N |
| View selling price/tax | Y* | Y* | Y* | Y* | N | N | N |
| Approve / revise artwork | Y | Y | N | N | N | N | N |
| Swatch create/start/complete | Y | Y | N | N | N | N | Y* embroidery |
| Swatch approve/reject/waive | Y | Y | N | N | N | N | N |
| Update stage | Y | Y | N | N | N | N | Y* own dept |
| Dispatch edit / book / final / void | Y | Y | planned only | R | Y | R | N |
| Excel import/export | Y | Y | Y* | L | N | N | N |
| Audit view | Y | Y | L | L | L | L | relevant |
| Stock receipt entry | Y | Y | N | N | N | N | Y* warehouse |

`Y*` = requires a further grant (authorised-commercial flag, department assignment). Matrix is seeded data (`role_permissions`), rendered in UI from the same catalogue, enforced in `requirePermission`.

## 9. Data Integrity Rules

| Rule | Enforcement |
|---|---|
| No hard delete of jobs, shipments, swatch attempts, artwork approvals, stock events, audit | App layer has no delete path; DB grants deny DELETE |
| Stock history + operational audit append-only | INSERT/SELECT-only role; before/after JSONB for significant changes |
| Approved swatch immutable | service rejects any edit when status = Approved |
| Artwork revision resets approval | state machine + audit in same transaction |
| Embroidery blocked by unapproved required swatch | stage service re-checks gate on every transition |
| Completion requires all stages + dispatch | computed, cannot be set directly |
| Void ≠ delete | shipment keeps booking rows; void is a `shipment_events` row |
| Concurrency | Optimistic locking scoped to the **sub-entity being edited**: `job_stages`, `shipments`, `swatch_attempts`, `job_lines` each carry their own `version`; `UPDATE ... WHERE id = ? AND version = ?` → mismatch = 409 with current record. Parent `jobs.version` guards only header edits (priority, dates, notes). A warehouse receipt never conflicts with an office dispatch-date edit — different sub-entities, different version columns. Parent-level conflict in the UI: warn + show latest, do not silently block unrelated department progress |
| Transactions | stage completion, swatch decision, stock receipt, shipment booking/final dispatch, import confirm — atomic |
| Files | approved swatch assets immutable (write-once key); labels retained after void; access only via entity permission → short-lived presigned GET |
| **Unspecified requirements block readiness** | `screen_records.required = NULL` ("blank = not yet specified", v11 stencil-room semantics) evaluates Screen Gate to **False** (Not Ready). NULL is "Pending Specification", never "Zero Required". UI sends `null`, never `0`, for blank. DB column is nullable with no default (§6.1) |
| Approved swatch immutability at DB layer | Row-Level Security, not triggers and not a plain REVOKE (a blanket `REVOKE UPDATE` would also block legitimate status transitions): `ALTER TABLE swatch_attempts ENABLE + FORCE ROW LEVEL SECURITY` with policy `USING (status <> 'Approved') AND WITH CHECK (status <> 'Approved')`. App connects as a **non-owner** role (owner bypasses RLS unless FORCED; FORCE covers even the owner). Approved rows are then unwritable at the engine level; lifecycle updates on non-approved rows still work. Triggers deliberately avoided: they can be disabled during maintenance/migrations and obscure failures |

## 10. Auth & Session

- Auth.js credentials provider; Argon2id hashes (memory-hard params); email + password.
- TOTP MFA: mandatory for Admin, Ops, Dispatch; optional for others; recovery codes shown once.
- DB-backed session cookie: httpOnly, sameSite=lax, secure; **2 h idle timeout** (unattended factory terminal forces re-login well before shift end) and **12 h absolute cap** (re-login at end of a long shift regardless of activity); logout deletes row. A previous "12 h idle + 12 h absolute" pairing was redundant — idle must be strictly shorter than absolute to ever trigger. PIN re-lock screen remains an open UX option (§19).
- **Auth.js MFA is two-step, not single-call:** the Credentials provider's `authorize()` handles password only. Because Auth.js does not natively support multi-step MFA, implement a staging flow: Step 1 validates the password and issues a short-lived, scope-restricted `pending_mfa` token (minutes, not hours); Step 2 validates the TOTP against that token and exchanges it for the real session cookie. Users are never asked for a TOTP code before their password has been verified, and a `pending_mfa` token can never call application endpoints.
- Login: per-email + per-IP rate limit, progressive lockout; failed attempts logged.
- Permissions fetched per request into request context; never trusted from client payload.

## 11. Excel Module

- Export: ExcelJS in pg-boss job → file to MinIO → signed download URL; columns filtered by caller permissions (costs/prices stripped for unprivileged).
  - Cost-column decision happens **inside the worker at write time**: same report requested by Director includes cost columns; requested by Office strips them before the `.xlsx` bytes are produced. Never generate full then redact; never trust a column-selection flag from the client.
- Import: as §4.10; validation covers required fields, unknown customers/products/SKUs, duplicate job numbers; preview must be confirmed by a second explicit action.

## 12. Integrations (post-MVP, designed-for)

- Pattern: operational event → `integration_outbox` → worker → external API → status/attempt log → retry with backoff. Failures never block operational workflow.
- DPD: adapter described in §4.9; credentials server-side only.
- Xero: customer master → contact sync keyed on customer reference; invoice/sales-order from job lines; tax/price sync only for authorised roles; Xero is never the operational database.
- Neither is scheduled before the operational core is stable.

## 13. Migration (from single clean JSON backup)

| Step | Action | Pass criterion |
|---|---|---|
| 1 | Inventory: locate every browser/backup; export Excel recon reports | newest backup identified |
| 2 | Parse + count entities in backup; list orphans/dupes | counts recorded |
| 3 | Map schemaVersion 3 → new schema; preserve IDs into `legacy_id` | mapping doc complete |
| 4 | Data clean: dedupe customers/products, missing supplier SKUs → fix list (report, no invention) | issues reviewed |
| 5 | Dry-run into staging DB | reconcile: customers, products, jobs (open/closed), lines, stages, stock balances, swatch statuses, shipment statuses, audit counts, files |
| 6 | Cut-over: freeze local editing, final JSON backup | backup stored |
| 7 | Import to production, verify live jobs | spot-check 20 open jobs + UAT §14 |
| 8 | Users/roles created, staff trained | sign-off |
| 9 | Retire prototype to read-only reference; keep backups ≥ 90 days | — |

Migration rules: never invent historical approvals; never rebuild audit from Excel; mark migrated rows as legacy; preserve stable IDs.

## 14. UAT Checklist (acceptance suite, written as automated tests where possible)

- Create customer → job → copy defaults → edit snapshot → deliberately update master → old jobs unchanged
- Receive stock → screens confirmed → readiness flips White → Amber → Green
- Readiness edge cases: stock-only job (no screens/swatch) with no stock = **White**, not Amber; screens `required = null` → Screen Gate False → never Green until specified and met
- Approve artwork → revise → status resets to Draft + audit row → re-approve
- Swatch: create → start → complete → approve → embroidery stage unblocks
- Swatch: reject (reason) → embroidery stays blocked → new attempt → approve → unblocks
- Waive swatch requirement → audit row → embroidery unblocks
- Stage update: operator of wrong department → 403; own department → OK; other stages unaffected; complete all + dispatch → job Completed
- Shipments: record booking → final dispatch → second shipment (part dispatch) → void first with reason → booking preserved → job NOT complete until explicit "Finalise dispatch" succeeds; finalise rejected while any shipment open/unfinished
- Excel: export role-filtered (no cost columns for Office) → import add-only (dupes skipped, artwork Draft)
- Concurrent edit, same sub-entity: A and B open a stage at v10; B saves (v11); A saves → 409 + refreshed record. Different sub-entities of one job (stock receipt vs dispatch date): both succeed, no spurious conflict
- Permission probe: every mutating endpoint called with each role → expected 403s

## 15. Delivery Phases (structure only; no implementation plan in this doc)

| Phase | Content | Doc estimate |
|---|---|---|
| 0 — Discovery & domain freeze | Rule register from §4, ER model, state-machine diagrams, confirmed permission matrix, data-quality report from backup, migration mapping, DPD/Xero scope sign-off | 2–3 weeks |
| 1 — Secure foundation | Auth + RBAC, users, customer master, jobs, size grid, search/sort, audit skeleton, backups, file storage, deploy/monitor | 4–6 weeks |
| 2 — Operational core | Stages + queues, stock receipts, screens, print positions, readiness colours, sorting, restricted stage updates, stage data, role-filtered Excel export, concurrency | 6–8 weeks |
| 3 — Approvals & control (go-live MVP) | Artwork, swatch + gate, dispatch/shipments/void, central files, audit viewer, staged import, export tooling, migration executed | 4–6 weeks |
| 4 — Integrations & optimisation | DPD API adapter, print workflow, Xero adapter, dashboards, notifications, training | 4–8 weeks |

Phase 2 supports a limited pilot; Phase 3 is full go-live. Estimates assume the doc's team assumptions; actual schedule set when implementation planning happens.

## 16. Anti-patterns (must not happen)

1. Hosting the existing HTML file centrally.
2. Excel as source of truth.
3. Rebuilding operational logic without using v11.
4. Client-side-only permissions.
5. Deleting bookings, attempts, or audit records.
6. Microservices for a single-factory system.
7. DPD/Xero before the operational core is stable.
8. Inventing historical approvals during migration.
9. Storing readiness/approval gates as client-editable fields.

## 17. Risks

| Risk | Mitigation |
|---|---|
| Operational nuance lost in rebuild | v11 = executable spec; UAT suite in §14; domain tests per rule |
| Divergent browser copies exist despite assumption | Step 1 inventory is cheap — run it first |
| Excel becomes shadow system | Excel stays projection; all mutations via API |
| Permission drift | Seeded permission catalogue shared UI/API; permission-probe tests |
| VPS single point of failure | Nightly off-box pg_dump + MinIO mirror; documented restore |
| Small VPS memory (MinIO + PG + Node) | Compose resource caps; worker shares app image; monitor |
| Audit noise | Structured event types; before/after only for significant changes |
| DPD API complexity later | Manual mode is permanent fallback; outbox + persisted request/response |

## 18. Out of Scope for MVP

DPD API booking, Xero sync, notifications, advanced dashboards/analytics, bulk edit, barcode scanning, mobile-specific department screens, malware scanning (documented gap, hook point in `files` upload path), point-in-time recovery beyond nightly dumps, SSO.

## 19. Open Items — **ALL RESOLVED 2026-09-30 (client: "all defaults")**

1. Permission matrix sign-off — **DECIDED**: Director = costs in reports only; authorised-commercial = Admin/Ops/Office/Director cells only; Office planned dispatch = method + address only (phase0/04).
2. Department list finalised — **DECIDED: 9 departments** (`print`, `dtg`, `dtf`, `embroidery`, `sewing`, `screens`, `warehouse`, `packing`, `dispatch`); 7 roles with 13→7 mapping (phase0/04 Part B).
3. Readiness gate formula — **DECIDED**: blank `required` = not-yet-specified = gate NOT passed (Amber + hint); verified via fixture FX-5.
4. Attachment size / per-role file permissions — **DECIDED**: 25 MB default; file actions follow owning entity's permission (import = Admin/Ops, artwork upload = artwork editor role set).
5. Backup retention — **DECIDED**: nightly dumps 30 d off-box; audit/stock history indefinite; prototype artefacts 90 d post-go-live.
6. DPD/Xero timing — **DECIDED**: deferred to Phase 4 behind prerequisites D1–D6 / X1–X5 (phase0/07).
7. Session policy — **DECIDED**: 2 h idle / 12 h absolute; shared-terminal PIN re-lock not in MVP (revisit on request).
   Data strategy — **DECIDED**: no data at build time; self-service import screen (Phase 3) ingests full localStorage dump when data appears; jobs-only files rejected (phase0/05).

## 20. Alternatives Considered (for the record)

| Alternative | Why it was rejected / deferred |
|---|---|
| **Buy off-the-shelf print MIS/ERP** (PrintVis on Dynamics 365 BC ≈ $130–150/user/month; Odoo with print add-ons) | Scope mismatch: Fanela needs production planning + its own rules (swatch gate, snapshots, traffic lights, department queues) — box products would need paid customisation anyway. Per-user recurring cost, vendor/partner lock-in, implementation-partner dependency. Revisit only if the business decides it wants a full ERP (purchasing, payroll, accounting) — different scope than this project |
| **Microservices** | Team far below the ~30-engineer threshold where distribution pays for itself; 2026 industry consensus for small teams is modular monolith with CI-enforced boundaries (dependency-cruiser, already mandated). Extraction via strangler-fig remains possible later along existing module seams |
| **Laravel / Django instead of Next.js** | Defensible alternatives (batteries-included queues, cheaper hosting, built-in admin). Not chosen: TypeScript single-language stack, Auth.js/Drizzle/pg-boss fit, prototype already JS. Rule of thumb from research: framework should follow the team's existing fluency — revisit at implementation kickoff if the implementing developer is PHP/Python-native; architecture matters more than language |
| **Vercel/serverless + managed cloud DB** | Fine technically, but usage/seat-based bills grow; data stays with a third party; single VPS + Docker handles this load at fixed small cost and matches the self-hosting requirement |
