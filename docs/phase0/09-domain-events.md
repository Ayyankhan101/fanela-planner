# Phase 0 — Domain Events (frozen contract v1)

Status: **frozen 2026-10-05 · `SCHEMA_VERSION = 1`** — closes phase-4 readiness line
"Domain events list frozen + versioned" (`07-integrations-scope.md` §4) and prerequisite
**X2** (stable domain events, frozen schema ≥ 1 release). Registry: `lib/events/domain-events.ts`;
drift guard: `tests/domain-events.test.ts`.

---

## 1. Purpose

Freeze the integration event contract **before** any sender is built, so DPD/Xero adapters
(plan P5) consume a stable shape instead of inventing one. Emission (writing events into
`integration_outbox`) arrives with the senders (D1–D6 / X1–X5); this document fixes *what*
an event is, not *when* it fires.

Out of scope here: emission hooks, sender routing (`kind = dpd | xero`), secrets manager
(§4 line 62), load test (§4 line 63).

## 2. Stability policy (X2)

- **Table schemas frozen ≥ 1 release:** `operational_audit` and `stock_events` columns may
  be **added** (nullable/defaulted) but never dropped, renamed, or retyped before
  2026-10-06+ one full release after freeze. Breaking table changes require a contract
  version bump first.
- **Registry shapes frozen:** `DOMAIN_EVENT_NAMES`, `SCHEMA_VERSION`, and both source
  schemas are asserted in `tests/domain-events.test.ts` (inline snapshot + zod round-trip
  + live-PG enum match). Any edit that changes a shape fails the suite until the contract
  doc and version are consciously updated **in the same commit**.
- **Change classes:**
  - *Additive* (new optional source field, new event appended): keep `SCHEMA_VERSION`,
    update doc + registry + snapshot, CHANGELOG entry. Consumers must ignore unknown fields.
  - *Breaking* (rename/remove/retype): bump `SCHEMA_VERSION`; old and new shapes coexist
    until every sender migrates; never mutate a v1 shape in place.
- **Idempotency:** `source.id` (row UUID) is the sender-side dedupe key — same row never
  sent twice under one version.

## 3. Envelope

Every event is one JSON object:

```json
{
  "event": "job-header",
  "schemaVersion": 1,
  "occurredAt": "2026-10-05T12:00:00.000Z",
  "source": { "...": "source-table row projection (below)" }
}
```

- `occurredAt` — source row `ts` (timestamptz, UTC ISO-8601, Z or offset).
- `source` — projection of the originating row; **not** live-linked (snapshot at emit).

## 4. Catalog — 14 events

### 4a. Audit family (8) — source `operational_audit`

Event name = `action` value (L2 kind list). Source fields:
`id, legacy_id, entity_type, entity_id, job_id, actor_id, actor_role, before, after, request_id`
(`before`/`after` jsonb → JSON value; `actor_role` = comma-joined roles).

| Event | Typical entity | Consumers |
|---|---|---|
| `job-header` | jobs | **Xero** (invoice line header), dashboards |
| `order-lines` | job_lines (costs in before/after) | **Xero** (bill lines — M1 costs) |
| `stage` | jobs | DPD readiness signals |
| `dispatch` | shipments/labels (consignment, tracking) | **DPD** (booking, label status) |
| `artwork` | artwork_versions | in-app only (v1) |
| `swatch` | swatch_requirements | in-app only (v1) |
| `stencil` | jobs | in-app only (v1) |
| `customer-master` | customers | **Xero** (contact mapping) |

### 4b. Stock family (6) — source `stock_events`

Event name = `stock.<type>`; `type` enum (migration 0000): `receipt, adjustment, correction,
line_removed, archived, update`. Source fields:
`id, legacy_id, job_id, job_line_id, type, qty, reason, payload (text/JSON), corrects_event_id, user_id`.
Consumers: Xero stock-adjustment postings (future), in-app dashboards.

## 5. Consumers (when senders ship)

- **DPD** ← `dispatch` (+ shipment row fields in `before`/`after`) — outbox-driven booking,
  webhook/poll tracking (`07` §1); never auto-advance to `Dispatched`.
- **Xero** ← `job-header`, `order-lines`, `customer-master` — outbox row per event, never
  blocks operational transactions (`03` §11).
- Routing into `integration_outbox.kind` (`dpd | xero`) and wrapping is decided with the
  senders; this contract is payload-only.

## 6. Change process

1. Edit `docs/phase0/09-domain-events.md` (this file) — catalog/envelope/policy.
2. Edit `lib/events/domain-events.ts` — registry + schemas (+ version if breaking).
3. Update `tests/domain-events.test.ts` snapshot — the suite must pass.
4. CHANGELOG entry under the current version; bump `VERSION`/`package.json` per release.
