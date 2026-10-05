# Phase 0 — Discovery & Domain Freeze

Paperwork only. **Status: all decisions locked 2026-09-30 ("all defaults").** No real data exists yet — system will ship with import screen; data arrives later.

| Doc | Contents | Status |
|---|---|---|
| [01-rule-register.md](01-rule-register.md) | ~70 testable rules (A–K), each verified against v11 line refs; findings F4, F7, F8 | ✅ done |
| [02-er-model.md](02-er-model.md) | Target ER diagram (mermaid + ASCII), cardinalities, invariants | ✅ done |
| [03-state-machines.md](03-state-machines.md) | 11 machines, server-enforced, invalid → 422 + gap log; v11 status-name mappings | ✅ done |
| [04-permission-matrix.md](04-permission-matrix.md) | Sign-off sheet — **signed with defaults**: 7 roles, 13→7 mapping, 9 departments | ✅ signed |
| [05-data-quality-report.md](05-data-quality-report.md) | **Data contract** (accepted shapes, validation rules) + **fixture inventory FX-1…11** + late-arrival procedure; `analyze-backup.mjs` | ✅ done (no data yet) |
| [06-migration-mapping.md](06-migration-mapping.md) | v11→target field map, status maps, shipment inference, sequence | ✅ done |
| [07-integrations-scope.md](07-integrations-scope.md) | DPD + Xero: MVP manual now, Phase-4 prerequisites D1–D6 / X1–X5 | ✅ done |
| [08-open-items-tracker.md](08-open-items-tracker.md) | OI-1…8 + F4–F11 — **all resolved/acknowledged** | ✅ done |
| [09-domain-events.md](09-domain-events.md) | Frozen domain-event contract v1 (14 events, envelope, table freeze X2, change process) | ✅ frozen 2026-10-05 |

## Locked decisions (summary)

1. Departments: **9** (keep v11 list) · Roles: **7** with 13→7 mapping (04)
2. Costs/prices: Admin, Ops, Office, Director only; Director costs = reports only
3. Blank screens = gate not passed → Amber + hint (OI-3)
4. Retention: audit/stock indefinite; backups 30d; artefacts 90d
5. Sessions: 2h idle / 12h absolute
6. No hard delete (archive flag); import dedupe job_number+SKU, re-import allowed
7. Data strategy: **self-service import screen** (Phase 3); jobs-only files rejected (F9)

## Run the data analysis (when data arrives)

```sh
node docs/phase0/analyze-backup.mjs <full-localstorage-dump.json>
```

## Next

implementation plan (`docs/superpowers/plans/`) → Phase 1 build.
