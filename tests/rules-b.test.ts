// Rules B3–B6: passwords/MFA, sessions, rate limit, no hard delete (phase0/01)
import { describe, it, expect } from "vitest";
import { makeUser, makeRequest, login, query, randomUUID, cookieValue, TEST_PASSWORD } from "./helpers";
import { currentTotp, generateTotpSecret } from "@/lib/auth/totp";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { MFA_COOKIE } from "@/lib/auth/mfa";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as mfaRoute } from "@/app/api/auth/mfa/route";
import { POST as setupRoute } from "@/app/api/auth/mfa/setup/route";
import { POST as enrollRoute } from "@/app/api/auth/mfa/enroll/route";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { POST as createJob } from "@/app/api/jobs/route";
import { POST as createCustomer } from "@/app/api/customers/route";
import { PATCH as patchJob } from "@/app/api/jobs/[id]/route";
import * as jobRoute from "@/app/api/jobs/[id]/route";
import * as customerRoute from "@/app/api/customers/[id]/route";

const ip = () => `10.11.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

describe("B3 — passwords, mandatory MFA, recovery codes", () => {
  it("accepts correct password, rejects wrong (argon2id)", async () => {
    const u = await makeUser({ roles: ["office"] }); // optional role, totp on → challenge path
    const bad = await loginRoute(
      makeRequest("/api/auth/login", { method: "POST", ip: ip(), body: { email: u.email, password: "wrong" } }),
    );
    expect(bad.status).toBe(401);

    const cookie = await login(u);
    const me = await meRoute(makeRequest("/api/auth/me", { cookie, ip: ip() }));
    expect(me.status).toBe(200);
  });

  it("mandatory role without TOTP → forced setup, enrol, recovery codes shown once", async () => {
    const u = await makeUser({ roles: ["dispatch"], totp: false });
    const res = await loginRoute(
      makeRequest("/api/auth/login", { method: "POST", ip: ip(), body: { email: u.email, password: TEST_PASSWORD } }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mfa_setup: true });
    expect(cookieValue(res, SESSION_COOKIE)).toBeNull();
    const pending = cookieValue(res, MFA_COOKIE);
    expect(pending).toBeTruthy();

    // no session yet
    expect((await meRoute(makeRequest("/api/auth/me", { ip: ip() }))).status).toBe(401);

    // setup → secret + uri (not persisted yet)
    const setup = await setupRoute(
      makeRequest("/api/auth/mfa/setup", { method: "POST", ip: ip(), cookie: `${MFA_COOKIE}=${pending}` }),
    );
    expect(setup.status).toBe(200);
    const { secret, uri } = await setup.json();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(uri).toContain("otpauth://totp/");

    // wrong code rejected
    const wrong = await enrollRoute(
      makeRequest("/api/auth/mfa/enroll", {
        method: "POST",
        ip: ip(),
        cookie: `${MFA_COOKIE}=${pending}`,
        body: { secret, token: "000000" },
      }),
    );
    expect(wrong.status).toBe(401);

    // correct code → session + 8 recovery codes once
    const ok = await enrollRoute(
      makeRequest("/api/auth/mfa/enroll", {
        method: "POST",
        ip: ip(),
        cookie: `${MFA_COOKIE}=${pending}`,
        body: { secret, token: currentTotp(secret) },
      }),
    );
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.recoveryCodes).toHaveLength(8);
    expect(body.recoveryCodes[0]).toMatch(/^[A-F0-9]{5}-[A-F0-9]{5}$/);
    const session = cookieValue(ok, SESSION_COOKIE);
    expect(session).toBeTruthy();
    expect((await meRoute(makeRequest("/api/auth/me", { cookie: `${SESSION_COOKIE}=${session}`, ip: ip() }))).status).toBe(200);

    // persisted: secret stored, recovery codes stored as sha256 (never plaintext)
    const rows = await query<{ totp_secret: string; recovery_codes: string }>(
      `SELECT totp_secret, recovery_codes FROM users WHERE id = $1`,
      [u.id],
    );
    expect(rows[0].totp_secret).toBe(secret);
    const hashes = JSON.parse(rows[0].recovery_codes) as string[];
    expect(hashes).toHaveLength(8);
    for (const h of hashes) expect(h).toMatch(/^[0-9a-f]{64}$/);
    for (const code of body.recoveryCodes) expect(rows[0].recovery_codes).not.toContain(code);

    // secret not usable before enrol — second setup token gone (deleted on enrol)
    const replay = await setupRoute(
      makeRequest("/api/auth/mfa/setup", { method: "POST", ip: ip(), cookie: `${MFA_COOKIE}=${pending}` }),
    );
    expect(replay.status).toBe(401);
  });

  it("recovery code single-use; authenticator still works after", async () => {
    // optional role: direct login (no totp yet), enrol via session path
    const u = await makeUser({ roles: ["office"], totp: false });
    const loginRes = await loginRoute(
      makeRequest("/api/auth/login", { method: "POST", ip: ip(), body: { email: u.email, password: TEST_PASSWORD } }),
    );
    expect(await loginRes.json()).toEqual({ mfa: false });
    const sessionCookie = `${SESSION_COOKIE}=${cookieValue(loginRes, SESSION_COOKIE)}`;

    const secret = generateTotpSecret();
    const enroll = await enrollRoute(
      makeRequest("/api/auth/mfa/enroll", {
        method: "POST",
        ip: ip(),
        cookie: sessionCookie,
        body: { secret, token: currentTotp(secret) },
      }),
    );
    expect(enroll.status).toBe(200);
    const { recoveryCodes } = await enroll.json();
    const code = recoveryCodes[0] as string;

    // now login → challenge
    const ch = await loginRoute(
      makeRequest("/api/auth/login", { method: "POST", ip: ip(), body: { email: u.email, password: TEST_PASSWORD } }),
    );
    expect(await ch.json()).toEqual({ mfa: true });
    const pending = cookieValue(ch, MFA_COOKIE);
    const chCookie = `${MFA_COOKIE}=${pending}`;

    // recovery code works
    const first = await mfaRoute(
      makeRequest("/api/auth/mfa", { method: "POST", ip: ip(), cookie: chCookie, body: { recovery: code } }),
    );
    expect(first.status).toBe(200);

    // same code again → new challenge, rejected
    const ch2 = await loginRoute(
      makeRequest("/api/auth/login", { method: "POST", ip: ip(), body: { email: u.email, password: TEST_PASSWORD } }),
    );
    const pending2 = cookieValue(ch2, MFA_COOKIE);
    const replay = await mfaRoute(
      makeRequest("/api/auth/mfa", {
        method: "POST",
        ip: ip(),
        cookie: `${MFA_COOKIE}=${pending2}`,
        body: { recovery: code },
      }),
    );
    expect(replay.status).toBe(401);

    // authenticator code still valid after recovery use
    const ch3 = await loginRoute(
      makeRequest("/api/auth/login", { method: "POST", ip: ip(), body: { email: u.email, password: TEST_PASSWORD } }),
    );
    const pending3 = cookieValue(ch3, MFA_COOKIE);
    const totpOk = await mfaRoute(
      makeRequest("/api/auth/mfa", {
        method: "POST",
        ip: ip(),
        cookie: `${MFA_COOKIE}=${pending3}`,
        body: { token: currentTotp(secret) },
      }),
    );
    expect(totpOk.status).toBe(200);
  });
});

describe("B4 — session idle 2h / absolute 12h", () => {
  it("valid session works and slides expiry", async () => {
    const u = await makeUser({ roles: ["office"] });
    const cookie = await login(u);
    const sid = cookie.split("=")[1];

    await query(`UPDATE sessions SET expires_at = now() + interval '30 minutes' WHERE id = $1`, [sid]);
    const me = await meRoute(makeRequest("/api/auth/me", { cookie, ip: ip() }));
    expect(me.status).toBe(200);
    const after = await query<{ expires_at: string }>(`SELECT expires_at FROM sessions WHERE id = $1`, [sid]);
    const slid = new Date(after[0].expires_at).getTime() - Date.now();
    expect(slid).toBeGreaterThan(1.9 * 60 * 60 * 1000); // slid to ~2h
  });

  it("idle timeout: expires_at in the past → session destroyed", async () => {
    const u = await makeUser({ roles: ["office"] });
    const cookie = await login(u);
    const sid = cookie.split("=")[1];
    await query(`UPDATE sessions SET expires_at = now() - interval '1 hour' WHERE id = $1`, [sid]);
    const me = await meRoute(makeRequest("/api/auth/me", { cookie, ip: ip() }));
    expect(me.status).toBe(401);
    expect(await query(`SELECT id FROM sessions WHERE id = $1`, [sid])).toHaveLength(0);
  });

  it("absolute cap: created 13h ago → destroyed even with future expires_at", async () => {
    const u = await makeUser({ roles: ["office"] });
    const cookie = await login(u);
    const sid = cookie.split("=")[1];
    await query(
      `UPDATE sessions SET created_at = now() - interval '13 hours', expires_at = now() + interval '1 hour' WHERE id = $1`,
      [sid],
    );
    const me = await meRoute(makeRequest("/api/auth/me", { cookie, ip: ip() }));
    expect(me.status).toBe(401);
    expect(await query(`SELECT id FROM sessions WHERE id = $1`, [sid])).toHaveLength(0);
  });
});

describe("B5 — login rate limiting", () => {
  it("5 failures within 15 min → attempts logged, 6th → 429", async () => {
    const email = `rl-${randomUUID().slice(0, 8)}@fanela.test`;
    for (let i = 0; i < 5; i++) {
      const res = await loginRoute(
        makeRequest("/api/auth/login", { method: "POST", ip: ip(), body: { email, password: "nope" } }),
      );
      expect(res.status).toBe(401);
    }
    const rows = await query<{ n: string }>(
      `SELECT count(*)::int AS n FROM login_attempts WHERE email = $1 AND success = false`,
      [email],
    );
    expect(Number(rows[0].n)).toBe(5);

    const blocked = await loginRoute(
      makeRequest("/api/auth/login", { method: "POST", ip: ip(), body: { email, password: "nope" } }),
    );
    expect(blocked.status).toBe(429);
  });

  it("correct password still blocked after lockout", async () => {
    const u = await makeUser({ roles: ["office"], totp: false });
    for (let i = 0; i < 5; i++) {
      await loginRoute(
        makeRequest("/api/auth/login", { method: "POST", ip: ip(), body: { email: u.email, password: "nope" } }),
      );
    }
    const res = await loginRoute(
      makeRequest("/api/auth/login", { method: "POST", ip: ip(), body: { email: u.email, password: TEST_PASSWORD } }),
    );
    expect(res.status).toBe(429);
  });
});

describe("B6 — no hard delete, archive flag only", () => {
  it("DELETE method absent on jobs and customers [id] route modules", () => {
    expect((jobRoute as Record<string, unknown>).DELETE).toBeUndefined();
    expect((customerRoute as Record<string, unknown>).DELETE).toBeUndefined();
  });

  it("archive via PATCH keeps row + audits; office denied", async () => {
    const admin = await makeUser({ roles: ["admin"] });
    const office = await makeUser({ roles: ["office"] });
    const adminCookie = await login(admin);
    const officeCookie = await login(office);

    const c = await createCustomer(
      makeRequest("/api/customers", {
        method: "POST",
        cookie: adminCookie,
        body: { name: `B6 Co ${randomUUID().slice(0, 6)}` },
      }),
    );
    expect(c.status).toBe(201);
    const cust = await c.json();

    const created = await createJob(
      makeRequest("/api/jobs", {
        method: "POST",
        cookie: adminCookie,
        body: { jobNumber: `B6-${randomUUID().slice(0, 8)}`, customerId: cust.id, lines: [{ skuText: "B6", qtyOrdered: 1 }] },
      }),
    );
    expect(created.status).toBe(201);
    const { id } = await created.json();

    const v1 = await query<{ version: number }>(`SELECT version FROM jobs WHERE id = $1`, [id]);
    const denied = await patchJob(
      makeRequest(`/api/jobs/${id}`, {
        method: "PATCH",
        cookie: officeCookie,
        body: { version: Number(v1[0].version), archived: true },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(denied.status).toBe(403);

    const ok = await patchJob(
      makeRequest(`/api/jobs/${id}`, {
        method: "PATCH",
        cookie: adminCookie,
        body: { version: Number(v1[0].version), archived: true },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(ok.status).toBe(200);
    const rows = await query<Record<string, unknown>>(`SELECT archived FROM jobs WHERE id = $1`, [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].archived).toBe(true);
    const audits = await query<{ n: string }>(
      `SELECT count(*)::int AS n FROM operational_audit WHERE job_id = $1 AND action = 'job-header'`,
      [id],
    );
    expect(Number(audits[0].n)).toBeGreaterThanOrEqual(2); // create + archive
  });
});
