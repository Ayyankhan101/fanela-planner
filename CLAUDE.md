# Project instructions

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec

## Conventions (this codebase)

**Add-an-endpoint recipe:**
1. Guard at the route edge — `requirePermission("cap.key", { req })` (or `requireAdminOrOps(req)`) from `@/lib/http`; on denial it already returns the `{error, code}` response.
2. Business logic → service function in `lib/services/` (DB access only via `query()` / `withTransaction()` from `@/lib/db`).
3. Errors → `err(status, MSG_*, CODE_*)` with the frozen strings from `lib/errors.ts` (never new ad-hoc copy for error paths); throw plain `{ status, message }` objects from services — routes wrap with `toResponse(e)`.
4. Probe test: route × role matrix using the `assertClasses` pattern from `tests/probe-p2.test.ts` (allow-set vs permission predicate) plus direct `expect(res.status)` checks.

**Error contract:** every failure body is `{ "error": "<human message>", "code": "<machine code>" }` with the HTTP status carrying the class; all codes live in `lib/errors.ts` and are catalogued by class in README.md "Error codes" (that table is the anchor for the Error & Rescue Registry).

**Tests need a live PostgreSQL** — `npm test` runs integration tests against the local DB from `DATABASE_URL` (app role `fanela_app` + owner superuser for append-only cleanup; see the owner-pool pattern in `tests/rules-e.test.ts`). No DB → suite fails, not skips.
