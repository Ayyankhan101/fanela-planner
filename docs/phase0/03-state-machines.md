# Phase 0 — State Machines

Server-enforced. Invalid transition → HTTP 422 + entry in audit "gap log". Source: spec §7, extended with prototype-verified status names (v11 line refs).

Convention below: `←X` means transition rejected. Terminal states cannot be edited — only superseded by a new record where noted.

---

## 1. Job lifecycle

```text
Open ──(first stage InProgress)──▶ InProduction ──(first shipment dispatched)──▶ PartDispatched
                                                  └─(all stages complete + finalise dispatch)──▶ Completed
Any non-Completed ──(cancel, reason)──▶ Cancelled (status only; record kept)
Completed → reopen = forbidden (422); correction via new audited event only
No hard delete — v11 "Archive" maps to status/flag (see register F4)
```

## 2. Job readiness (derived, not stored as authority)

```text
White (0 gates pass / 0 gates active) ⇄ Amber (some pass) ⇄ Green (all active gates pass)
Recomputed server-side on: stock change, screen change, swatch decision, line change.
Never settable by client (cache column is derived only).
Edge: totalRequiredGates === 0 → White (checked first — register G2).
```

## 3. Artwork

```text
Draft ──(submit)──▶ Awaiting Approval ──(Admin/Ops approve)──▶ Approved
                         │                    └─(reject, reason)──▶ Rejected ──▶ new version Draft
                         └─(withdraw/cancel)──▶ Draft
Approved ──(revise: signature change)──▶ Draft (NEW version++, approver cleared, audited)
Rejected ──(edit)──▶ new version (never rewrite rejected record)
Any transition by role ∉ {Admin, Ops} → 403
```
Prototype: `artworkApproval` (L667), reset-on-revise (L693), signature (L687).
⚠ "Awaiting Approval" as distinct stored state: v11 only persists Draft/Approved/Rejected — confirm Phase 0 whether intermediate state exists in practice (ops guide) or submit == direct approve by Ops.

## 4. Swatch requirement (job-level toggle)

```text
Required ⇄ Not Required    — change allowed only by Admin/Ops, always confirmed + audited
Adding an Embroidery stage to a job → Required (auto, audited)
```
v11: L668, L690, L695.

## 5. Swatch attempt (critical gate)

```text
Waiting ──(operator start)──▶ In Progress ──(operator complete)──▶ Awaiting Approval
   │                                                                            │
   │                                                            Admin/Ops approve ──▶ Approved  [IMMUTABLE]
   │                                                            Admin/Ops reject(reason) ──▶ Rejected ──┐
   └──────────── (create new attempt only when latest ∈ {Waiting…Awaiting})          Re-swatch Required(reason) ──┤
                                                                                                       └──▶ new attempt (attempt_no++)
Any attempt at status ∈ {Approved, Rejected, Re-swatch Required}: UPDATE of row → rejected
  - app layer: "A completed swatch attempt cannot be changed." (L699)
  - DB layer: RLS FORCE policy status <> 'Approved' (spec §9)
Baseline merge: attempts recorded in DB always win over client payload (L696).
GATE: required && latestAttempt.status != Approved && department = Embroidery
      → stage start / progress / complete = 422 (L702)
```
v11 status names: `Waiting, In Progress, Awaiting Approval, Approved, Rejected, Re-swatch Required` (L680, L743).
Spec names: `Draft, InProgress, Awaiting, Approved, Rejected`.
**Mapping (confirmed for migration):** v11 `Waiting` → spec `Draft`; `In Progress` → `InProgress`; `Awaiting Approval` → `Awaiting`. Names identical in effect.

## 6. Job stage

```text
Waiting ──▶ Ready ──▶ In Progress ──▶ Completed
   │           │            │
   └───────────┴────── Blocked (swatch gate / stock / screens / manual)
Completed ──(reopen)──▶ In Progress   [audited; clears finishedAt; v11 L233]
Auto: completed ≥ quantity → Completed (L194) — same transition, server-computed
Gate checks before any Embroidery transition: swatch passed (S7)
Gate checks before Dispatch completion: all other stages complete (D10)
Operator may transition own department's stage only (D3); Admin/Ops override
```

## 7. Shipment (incl. DPD manual mode)

```text
Draft ──▶ Booking Arranged ──▶ Booked ──▶ Labels Attached ──▶ Print Requested
                                                              ──▶ Labels Printed ──▶ Dispatched | Collected
Any non-final state ──(void, reason)──▶ Cancelled/Void   [rows kept; never deleted]
Dispatched/Collected are FINAL for that shipment — do NOT close Dispatch stage
Dispatch stage closes only via explicit "Finalise dispatch":
    allowed only when every shipment ∈ {final, Void}  (else 422; abandon-with-reason path available, audited)
Print request log NEVER records "printed" — only manual confirm does (P9)
```
Prototype fields per shipment: `id, method, parcels, consignment, tracking, bookedBy, bookedAt, labelPrinted, printRequests, reprints, voided, voidReason, finalAt` (L791).
⚠ v11 has no explicit status enum on shipments — Phase 0 must map legacy shipments into the spec state machine (most legacy rows likely land at `Booked`/`Dispatched` — decided per row during dry run).

## 8. Stock line / job stock status (drives gate + reports)

```text
Not Ordered ──▶ Ordered ──▶ Part Received ──▶ Complete
                   │              │
                   ▼              ▼
issue states (override, manual): Short | Backorder | Picking Error | Damaged / Incorrect Stock
issue state ──(resolved + receipt confirmed)──▶ derived status again
'Complete' requires: received ≥ ordered AND confirmed AND no open issues (validateStockControls L593)
History: every change appends stock_events row (kind: update | correction | line-removed | archived)
```
v11: `stockStatuses()` L561, derivation L568.

## 9. Screens record (gate, not a workflow)

```text
required: NULL (blank — pending specification) | int ≥ 0
notRequired: bool (explicit confirmation)
made/confirmed: ints + flag
Gate passes ⟺ notRequired OR (required > 0 AND made == required AND confirmed)
Validation (v11 L534): made > required → blocked; confirmed without required>0&&made==required → blocked
```

## 10. Import batch

```text
Created ──▶ Parsed ──▶ Validated ──▶ Previewed ──▶ Confirmed ──▶ Executed ──▶ Reported
                              └──(errors)──▶ Failed (rows listed; nothing written)
Cancel any pre-Execute → Aborted (no writes)
```

## 11. Integration outbox (post-MVP)

```text
Pending ──▶ Sending ──▶ Sent
              └─(fail, retries w/ backoff)──▶ Failed ──(manual retry)──▶ Sending
```
Never blocks the operational transaction (row written in same tx as domain change).
