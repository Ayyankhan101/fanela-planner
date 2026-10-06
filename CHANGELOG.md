# Changelog

## [0.2.5] - 2026-10-06

### Added
- **Error-contract F1/F2 (PR #14):** `lib/errors.ts` +15 `MSG_*`; ~20 routes zod-fail → 422 `{error:"Invalid request.", code:"validation_error"}` (no raw zod output); domain 404/409/422/401/403 tagged with taxonomy codes; services (jobs/artwork/readiness/stages/dispatch/stock/swatch) throw coded `{status, message, code}`; `audit-table.tsx` ENTITY_TYPES fixed (dropped dead `stock`/`import`); new `tests/error-contract-probe.test.ts` (+10 tests). Live curl verified: `validation_error`, `invalid_credentials`, `customer_not_found`, `job_not_found`, `forbidden_admin_ops`. Suite **440/440**
- **Prod deploy + monitoring (PR #15):** `ops/launchd/` — `com.fanela.app` + `com.fanela.outbox` (KeepAlive), nightly backup 01:30, L4 integrity 02:00, storage sweep 03:00, uptime probe 5 min; `scripts/uptime-probe.sh` success-logging (`fanela up: HTTP 200` → `logs/uptime.out.log`); runbook §1 job table + install loop, §4c outbox supervision, §6 probe logging + monitoring clock; drill log PROD LIVE 2026-10-06; `./scripts/deploy.sh` executed full path. **Monitoring clock: ≥5 working days clean-probe from 2026-10-06** (cutover gate-in prerequisite)
- C6 rule-ID coverage meta-test: `tests/rule-coverage.test.ts` (all 77 register IDs; EXCEPTIONS {D6 — no as-built total-prints surface}) + D5 delta test + D9/G5 tag cleanup (PR #13)
- P5 domain-event emission groundwork (PR #13): `lib/services/emit.ts` — `audit()` + `appendStockEvent()` write frozen-envelope outbox rows (`kind` = event name, zod-validated, ambient-tx; `tests/domain-emission.test.ts`); sender registry empty → rows wait `pending`/`attempts=0` by design; DPD/Xero senders + `dpd|xero` routing land with D1–D6/X1–X5
- Production UX pass (PR #13): tokens/typography/contrast/focus-rings/inline-confirms/aria-live/mobile nav+search wrap; evidence `designs/ux-pass-20261005/`
- C5 operator demo checklist (`docs/ops/c5-demo-checklist.md`) + facilitator dry-run: 14-step flow PASS on `DEMO-C5-001`, 4 findings → QA loop
- QA loop fixes (Phase C, report 94/100): ISSUE-001 customers pagination, ISSUE-002 picker combobox, ISSUE-003 swatch approve reason, ISSUE-004 audit job-number filter — each with regression test
- **Catch-up (prior undocumented work):** outbox worker groundwork (pg-boss v12 + 15 s `outbox-tick`, migration `0005`, `lib/services/outbox.ts` CAS claim/backoff/retry, admin retry endpoint, `tests/outbox.test.ts` 10); audit log UI (`/audit`, nav link); interactive job-detail panels; manual light/dark mode toggle; `scripts/deploy.sh` + `scripts/add-user.mts` (`npm run user:add`); `AUTH_COOKIE_SECURE` LAN opt-out

### Changed
- `CLAUDE.md` conventions: services throw taxonomy-coded `{status, message, code}`; route-edge parse failures → `err(422, MSG_INVALID_REQUEST, CODE_VALIDATION_ERROR)`
- `docs/phase0/08` status log: 2026-10-06 rows (C6/P5/UX merged PR #13; QA + error contract PR #14 + prod deploy PR #15)
- `docs/ops/c5-demo-checklist.md`: box-live preconditions annotated 2026-10-06; dry-run findings marked fixed; step 13 wording (job number or UUID)
- Runbook §7 CI test count 378 → 440; README npm-scripts table + ops docs-map rows

### Fixed
- ISSUE-001: `/customers` paginates (50/page + pager) — `abf5d1e`, CI-robust test `f9ba67e`
- ISSUE-002: job-create customer picker = filterable combobox — `ef8fd11`
- ISSUE-003: swatch approve no longer requires a reason (reject/re-swatch still 422) — `3a59679`, test `e33c8ef`
- ISSUE-004: audit filter accepts job number + UUID prefix — `5016baa`, test `c957d18`

## [0.2.4] - 2026-10-05

### Changed
- Human-gate records (client decisions, `TODOS.md`): **C3** owner assigned = project owner (client) — replaces unassigned placeholder, target 2026-10-17 unchanged (acquisition open until sample lands); **C5** operator demo **booked 2026-10-10** (status scheduled → booked; entry closes at acceptance); **cutover plan owner-confirmed** — date rule (gate-in + 14 working days + 2 buffer) + shutdown owner (project owner) approved as drafted, concrete date fills at gate-in
- `phase0/08` status log: appended dated 2026-10-05 row for the three gate records (C6 unchanged — depends first real import)

## [0.2.3] - 2026-10-05

### Added
- Secrets management decision + rotation doc (`docs/ops/secrets.md`, closes phase0 `07` readiness line 62 / spec §18): `.env` @ `chmod 600` chosen (matrix vs Keychain/direnv/cloud SM — revisit at VPS + MinIO §8), inventory of 8 current secrets + future D6/X3/MinIO rows, rotation sequences (`ALTER ROLE`, `user:add` re-hash, SQL TOTP clear-then-re-enroll — enroll route is first-time-only, `DELETE FROM sessions` force re-login, `AUTH_SECRET` vestigial delete), event-based trigger policy, hygiene rules (600 mandate, DB dumps carry hashes + TOTP)

### Changed
- Runbook §1: `chmod 600` mandate + secrets.md link; `.env.example` header: 600 in the copy one-liner

## [0.2.2] - 2026-10-05

### Added
- Domain-event freeze (plan P5, phase0 X2): frozen contract v1 — `docs/phase0/09-domain-events.md` (14 events: 8 `operational_audit` kinds + 6 `stock.*` types, envelope `{event, schemaVersion, occurredAt, source}`, table-schema freeze ≥ 1 release, change process), `lib/events/domain-events.ts` (name tuples, `SCHEMA_VERSION = 1`, zod source/event schemas), `tests/domain-events.test.ts` (inline-snapshot freeze guard, zod round-trip ×14, family cross-rejects, live-PG `stock_event_type` enum match, live-PG audit-action subset)
- phase0 checklist: `07` readiness line "Domain events frozen + versioned" ✓ + X2 ☑ (clock starts 2026-10-05); `phase0/README.md` index row for `09`

### Changed
- Plan P5 note: event freeze landed; DPD/Xero sender impls + domain-event emission remain gated on D1–D6 / X1–X5

## [0.2.1] - 2026-10-04

### Added
- Dashboard landing (`/dashboard`, root `/` redirects): readiness mix (white/amber/green/unknown), stage matrix by department, approval queue counts (swatch awaiting / artwork awaiting / stock issues), due + overdue dispatch list, recent audit activity (gated `audit.view`), active jobs only — `lib/services/dashboard.ts`
- In-app notifications: `notifications` table (`0006_curved_kabuki.sql`, grants in `002_grants.sql`), `emitNotification` role fan-out with actor exclusion, `GET /api/notifications` + `POST /api/notifications/read` (idempotent, owner-scoped), nav bell with unread badge + dropdown (admin/ops only, 60s poll + focus refresh)
- Emit triggers: swatch → `awaiting`, artwork `submit` → `awaiting`, import execute-fail — all inside `withTransaction` (rollback ⇒ no phantom rows)
- Tests: `tests/notifications.test.ts` + `tests/dashboard.test.ts` (10 tests; suite 407/407)

### Changed
- `scripts/deploy.sh` now runs `db:migrate` + `db:security` before restart (runbook deploy gap)
- `tests/security-p3.test.ts` T13 honors `AUTH_COOKIE_SECURE` LAN opt-out (production default asserted with flag unset)

## [0.2.0] - 2026-10-03

### Added
- Import pipeline (E3–E6): upload → preview → typed confirm → atomic execute with readiness rebuild in-tx, original-file persistence (`storage/uploads/`), CAS version guard, reconciliation suite importing FX-1…11 through real route handlers (tests/reconciliation.test.ts)
- Export: generic `/api/exports/[view]` (9 views), ExcelJS buffer-then-send, single-query-per-view, M4 write-time cost-column stripping, export dropdown UI, 100k row cap
- Security: CSRF origin check (`proxy.ts`), upload rate limit (`upload_attempts`), session fixation/rotation tests, cookie-flags tests (`tests/security-p3.test.ts`)
- `lib/errors.ts` frozen message/code taxonomy; `tests/http-errors.test.ts`
- Spec §14 UAT suite (`tests/uat.test.ts`, 11 tests); `tests/rules-e/m.test.ts`, `tests/transaction.test.ts`
- CI workflow (`.github/workflows/ci.yml`, postgres 18 + bootstrap); `npm run setup` chain incl. `typegen` (fresh-clone typecheck fix); `fixtures/generate.mjs` FX-1…11
- README getting-started + error contract; AGENTS.md; D19 cold-start record (11s through seed vs 2–5 min target)

### Changed
- Vitest `fileParallelism: false` (shared-PG fixture races across test files)
- T13 security checklist records (P3-close + pre-P4 remainder) in plan Review record
- TODOS gates recorded: C3 owner/date, C5 demo, C7 metrics, C9 kill triggers

### Fixed
- Next 16 `middleware.ts` → `proxy.ts` (root middleware broke `/api` responses)
- Upload rate-limit window (100/hour/user) aligned with rules-e caps tests
