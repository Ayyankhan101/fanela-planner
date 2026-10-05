# Ops — Secrets management (decision + rotation)

Status: **decided 2026-10-05** — closes phase-4 readiness line 62 in
`07-integrations-scope.md` ("Secrets manager choice + rotation documented (spec §18)").

---

## 1. Decision — `.env` file at `chmod 600`

| Option | Verdict | Why |
|---|---|---|
| **`.env` @ 600** | **Chosen** | Single-node self-host (spec: no cloud dependency, headless supervisor boot reads the file directly); zero new deps; already gitignored (`.env`, `.env.*`, `!.env.example`) |
| macOS Keychain | Rejected | launchd boot needs an unlocked keychain / user session — brittle headless start, machine-bound |
| direnv / age-encrypted file | Rejected | New dep + key-distribution problem larger than today's secret set |
| Cloud secret manager (AWS SM etc.) | **Deferred** | Revisit at the VPS + MinIO migration (runbook §8) or when D6/X3 integration credentials arrive and the host leaves this machine |

**Store:** repo `.env` (excluded from git and from repo archives/backups).
**Contract template:** `.env.example` (committed; never holds live values).

## 2. Inventory

| # | Secret | Lives in | Rotation |
|---|---|---|---|
| 1 | Owner DB role `fanela` password | `.env` → `DATABASE_URL` (app, migrate, seed, security all use it) | SQL `ALTER ROLE fanela PASSWORD '…'` → update `.env` → restart service → probe login |
| 2 | App role `fanela_app` password (test/dev default `fanela_app_dev`) | `APP_PASSWORD` env for `db/migrate-all.sh`; tests via `APP_DATABASE_URL` | `ALTER ROLE fanela_app PASSWORD '…'` → update `.env` (if `APP_DATABASE_URL` set) → `npm run db:security` |
| 3 | Seed admin password | `SEED_ADMIN_PASSWORD` (dev default `ChangeMe123!`) — applies **at seed time only** | Change the live user via #4; changing the env var later does nothing |
| 4 | User password hashes (Argon2id) | `users.password_hash` | `npm run user:add -- <email> <role> <name> <new-password>` — upsert re-hashes + reactivates (`active: true` side-effect: re-enables a disabled account; TOTP untouched) |
| 5 | TOTP secrets + recovery codes | `users.totp_secret`, `users.recovery_codes` (sha256, one-time) | `UPDATE users SET totp_secret = NULL, recovery_codes = NULL WHERE email = '…';` — enroll route is first-time-only (`WHERE totp_secret IS NULL`), so clear first; user then re-enrolls on next login (new secret + fresh codes) |
| 6 | Session tokens | `sessions` rows (UUID = cookie value) | `DELETE FROM sessions;` — every user re-authenticates (run after any credential rotation) |
| 7 | `AUTH_SECRET` | `.env` | **Vestigial — delete the line.** Zero readers in the codebase (sessions are DB-backed) |
| 8 | `AUTH_COOKIE_SECURE` | `.env` | Flag, not a secret — no rotation |

**Future rows (arrive with prereqs — same store until §8 migration):**
DPD API key / OAuth (D6) · Xero OAuth refresh tokens (X3) · MinIO/S3 access keys (runbook §8) —
each: re-issue in the provider console first, then update `.env`, restart, verify.

## 3. Rotation procedure

Common envelope for every row above:

1. Mint the new value (provider console / `user:add` / `ALTER ROLE` / SQL clear).
2. Update the store — `.env`, then `chmod 600 .env`.
3. Restart the service (`launchctl kickstart -k` per runbook §1).
4. Credential-affecting changes → `DELETE FROM sessions;` (force re-login).
5. Verify: probe `/login` 200 + login works; for role changes re-run `npm run db:security` (idempotent).

**Triggers (event-based, not calendar — no compliance driver):** suspected leak · device loss ·
personnel change · provider mandate · post-incident (then rotate #1–#6 fully, not just the
breached item).

## 4. Hygiene rules

- `chmod 600 .env` — mandatory (was `644` on 2026-10-05, fixed with this doc).
- Never commit `.env`; never paste live values into docs, issues, or PRs.
- **DB dumps contain password hashes + TOTP secrets** — treat `pg_dump` files with the same
  care as `.env` (runbook §2 off-box retention).

## 5. Known gaps (documented, not blocking)

- No self-service password-change route and no admin TOTP-reset route — SQL / `user:add`
  workarounds above; UI candidates if the team grows past script-based provisioning.
- The app connects as the **owner** role (`lib/db.ts` reads only `DATABASE_URL`) — deliberate
  MVP posture; privilege separation (point the app at `fanela_app`) is future hardening.
