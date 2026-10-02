# Phase 0 — Permission Matrix & Role Mapping (SIGN-OFF SHEET)

**DECIDED 2026-09-30: all defaults accepted by client ("all defaults").** Cells below filled with the agreed defaults; amend only via new signed change request.

---

## Part A — Target role model (7 roles)

Roles: **Admin, Operations Manager, Office, Director, Dispatch, Packing, Department Operator** (scoped to assigned departments).

Key: **Y** yes · **Y\*** only with extra grant · **R** read-only · **L** limited scope · **N** no

| Capability | Adm | Ops | Off | Dir | Dis | Pck | Dept |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Manage users / roles / backups | Y | N | N | N | N | N | N |
| View customer master | Y | Y | Y | Y | Y | Y | N |
| Edit customer master | Y | Y | Y | N | N | N | N |
| Deliberately update master (audited) | Y | Y | N | N | N | N | N |
| Create / edit jobs | Y | Y | Y | R | L | R | N |
| Enter buying costs | Y | Y | N | N | N | N | N |
| View buying costs | Y | Y | N | Y* | N | N | N |
| View selling price / tax | Y* | Y* | Y* | Y* | N | N | N |
| Approve / revise artwork | Y | Y | N | N | N | N | N |
| Swatch create / start / complete | Y | Y | N | N | N | N | Y* |
| Swatch approve / reject / waive | Y | Y | N | N | N | N | N |
| Update a stage | Y | Y | N | N | N | N | Y* |
| Dispatch edit / book / final / void | Y | Y | plan | R | Y | R | N |
| Excel import / export | Y | Y | Y* | L | N | N | N |
| View audit | Y | Y | L | L | L | L | rel |
| Stock receipt entry | Y | Y | N | N | N | N | Y* |

**Y\*** grants: `authorised commercial` flag (prices) — **holders: none beyond the cells above (Admin, Operations, Office, Director per table)**; Department Operator scope = department assignment (Part B).

Confirmation of ambiguous cells (open item 1) — **DECIDED (defaults)**:

| # | Question | Decision |
|---|---|---|
| 1a | Who sees buying costs in **reports** — Director only among non-Admin/Ops? | ☑ Yes (Director Y* row = reports only) |
| 1b | Who holds `authorised commercial` (selling price/tax)? | ☑ Admin, Operations, Office, Director only |
| 1c | Office "planned dispatch" — which fields can Office set before Dispatch takes over? | ☑ method + address only |
| 1d | Department Operator swatch rights — which departments can create swatch attempts? | ☑ Embroidery only (v11 behaviour) |
| 1e | Department Operator stage rights — own department only, Admin/Ops override? | ☑ Yes |

---

## Part B — Legacy role mapping (open item 2)

Prototype creates **13 login roles**: `Admin, Director, Operations Manager, Office` + every department name as a role (v11 `staffRoles`, L497).

**Candidate department list from v11 (9) — DECIDED: keep all 9 (Option 1):**

| # | v11 department | v11 role can… | Target department key | Decision |
|---|---|---|---|:-:|
| 1 | Warehouse | edit stock receipts | `warehouse` | ☑ |
| 2 | Stencil Room | edit screens record | `screens` | ☑ |
| 3 | Screen Print | update own stage | `print` | ☑ |
| 4 | DTG | update own stage | `dtg` | ☑ |
| 5 | Transfers / DTF | update own stage | `dtf` | ☑ |
| 6 | Embroidery | update stage + swatch attempts | `embroidery` | ☑ |
| 7 | Sewing | update own stage | `sewing` | ☑ |
| 8 | Packing | read dispatch/stages | `packing` | ☑ |
| 9 | Dispatch | dispatch workflow | `dispatch` | ☑ |

⚠ Spec §6 lists only 6 department keys — **superseded by this table**: new system seeds **9** department keys (`print|dtg|dtf|embroidery|sewing|screens|warehouse|packing|dispatch`). Spec §6 updated at implementation kickoff (see implementation plan Step A2).

- ☑ **Option 1 — all 9 first-class departments** (DECIDED 2026-09-30; matches v11 exactly)

**Role mapping:**

| v11 role | Target role | Department assignment |
|---|---|---|
| Admin | Admin | — |
| Director | Director | — |
| Operations Manager | Operations Manager | — |
| Office | Office | — |
| Warehouse | Department Operator | warehouse |
| Stencil Room | Department Operator | screens |
| Screen Print / DTG / Transfers / DTF / Sewing | Department Operator | print / dtg / dtf / sewing (per decision above) |
| Embroidery | Department Operator | embroidery |
| Packing | Packing | — |
| Dispatch | Dispatch | — |

---

## Part C — Enforcement notes (no decision needed)

- One permission catalogue in DB drives **both** UI buttons and API checks — cannot drift.
- Every mutating endpoint has automated permission-probe tests (each role × each endpoint → exact allow/deny).
- Cost/price fields stripped in serialiser, including inside generated Excel files (worker decides columns at write time).
- Prototype equivalents verified: `privileged()` L500, `canApprove()` L675, `canViewCosts()` L723, `permittedDepartment()` L501, `canDispatch()` L677.

---

### Sign-off

Decisions recorded 2026-09-30: **client accepted all defaults** ("all defaults" instruction). Role mapping (Part B) = table as written.

| Role | Name | Date | Signature |
|---|---|---|---|
| Client (owner/ops lead) | _accepted via instruction_ | 2026-09-30 | ☐ on file |
| Project lead | _accepted via instruction_ | 2026-09-30 | ☐ on file |
