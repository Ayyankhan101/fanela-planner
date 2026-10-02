# Phase 0 — Integrations Scope (DPD / Xero)

Status: **both deferred to Phase 4**, justified by research (modular-monolith 2026 consensus; keep stable schema first, wire events later). MVP ships **manual DPD workflow + Excel/CSV export** (spec §4.9). This file fixes the scope, decision points, and prerequisites so Phase 4 = configuration, not redesign.

---

## 1. DPD (labels + tracking) — manual first, API later

### MVP (in scope now)
- Manual booking entry: consignment, tracking, parcels, bookedBy/At (fields already in spec §4.8).
- Label upload up to 25 MB; print-request log that **never** records "printed" (physical action confirmed manually, P9).
- Shipment state machine incl. `Print Requested → Labels Printed → Dispatched` (03 §7).
- Void = event with reason; **no** carrier-side cancel (P7).

### Phase 4 API (prerequisites before any code)

| # | Prerequisite | Owner | Blocking? |
|---|---|---|---|
| D1 | DPD contract signed (customer number + rate card) | client | ☐ |
| D2 | DPD IT validation complete (technical onboarding) | client + DPD | ☐ |
| D3 | Which env first: **stage/test** vs live (DPD offers test env; confirm label validity rules) | DPD | ☐ |
| D4 | Rate limit confirmed: **30 calls/min** — design throttling + queue | eng | ☐ |
| D5 | Which DPD service (per-country APIs differ: UK / EU / RO etc.) | client | ☐ |
| D6 | Auth credentials (API key / OAuth per service) storage in secrets manager | eng | ☐ |

### Phase 4 scope when prerequisites green
- Outbox-driven booking (03 §11): `Booked → LabelsAttached` events, retries, idempotency on consignment.
- Tracking webhook/polling → append-only tracking events; **never** auto-advance to `Dispatched` without physical-world check.
- Out-of-box items remain: manual booking + label attach + void-with-reason.

## 2. Xero (costing/accounting) — manual export first

### MVP (in scope now)
- Buying costs entered by Admin/Ops (M1), cost view per M2/M3.
- Excel export of costs for whoever holds `authorised commercial` (04 Part A) — server-side column stripping (M4).
- Import of buying costs via Excel pipeline (E3/E6).

### Phase 4 API (prerequisites before any code)

| # | Prerequisite | Owner | Blocking? |
|---|---|---|---|
| X1 | Business mapping decisions: what a Fanela job/invoice line becomes in Xero (tracking categories, account codes, tax treatment) | client accountant | ☐ |
| X2 | Stable domain events: `job-header`, `order-lines` audit + stock_events must be frozen schema ≥ 1 release | eng | ☐ |
| X3 | Xero org + OAuth app + token storage | eng | ☐ |
| X4 | Direction decided: **export to Xero** (jobs→invoices/bills) vs pull (purchase orders in) vs both | client | ☐ |
| X5 | Money rounding/currency: GBP fixed in v11 (`currency:'GBP'`) — confirm no multi-currency need | client | ☐ |

### Phase 4 scope when prerequisites green
- Outbox row per domain event → Xero API with backoff; reconciliation report job-level.
- Never block operational txns on Xero (03 §11).

## 3. Everything else (explicit non-goals until requested)

Notifications/email, dashboards beyond spec §11, PrintVis/Odoo (buy alternative rejected — record in spec §20), multi-tenant, mobile apps, warehouse barcode/WMS, automated carrier cancellation, DPD account creation.

## 4. Phase-4 readiness checklist (carry into implementation plan)

- [ ] D1–D6 collected
- [ ] X1–X5 collected
- [ ] `integration_outbox` table + `kind` enum shipped in MVP schema (rows unused until Phase 4)
- [ ] Domain events list frozen + versioned (`job-header`, `order-lines`, `stage`, `dispatch`, `stock.*`)
- [ ] Secrets manager choice + rotation documented (spec §18)
- [ ] Load test: 30 calls/min throttle + queue drain verified against DPD stage env
