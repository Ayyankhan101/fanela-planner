// T13 P3-close security subset: CSRF origin check, upload authz, upload rate limit.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import pg from "pg";
import proxy, { sameOriginBlocked } from "@/proxy";
import { makeUser, makeRequest, query, cookieValue, TEST_PASSWORD } from "./helpers";
import { POST as uploadRoute } from "@/app/api/admin/import/route";
import {
  CODE_RATE_LIMITED,
  CODE_CSRF_ORIGIN_MISMATCH,
  CODE_FORBIDDEN_ADMIN_OPS,
  MSG_RATE_LIMITED,
} from "@/lib/errors";

const UPLOAD_LIMIT = Number(process.env.UPLOAD_RATE_LIMIT ?? 100);
const testUserIds: string[] = [];
let owner: pg.Pool;

function nreq(method: string, headers: Record<string, string>): NextRequest {
  return new NextRequest(new Request("http://localhost/api/jobs", { method, headers }));
}

beforeAll(() => {
  owner = new pg.Pool({
    host: process.env.PGHOST ?? "/tmp",
    port: Number(process.env.PGPORT ?? 5432),
    database: "fanela",
    user: process.env.PGUSER ?? process.env.USER ?? "mac",
  });
});

afterAll(async () => {
  if (testUserIds.length) {
    await owner.query(`DELETE FROM upload_attempts WHERE user_id = ANY($1)`, [testUserIds]);
    await owner.query(`DELETE FROM import_batches WHERE actor = ANY($1)`, [testUserIds]);
  }
  await owner.end();
});

function inlineState(jobNumber: string): string {
  return JSON.stringify({
    schemaVersion: 3,
    customers: [{ legacyId: "c1", name: "CSRF Co" }],
    products: [],
    jobs: [{ legacyId: "j1", jobNumber, customerLegacy: "c1", skuLines: [] }],
    stockEvents: [],
    operationsEvents: [],
  });
}

describe("T13 — CSRF: origin check on stateful handlers (middleware)", () => {
  it("cross-origin POST → blocked; same-origin POST → allowed; GET never blocked", () => {
    expect(sameOriginBlocked(nreq("POST", { origin: "https://evil.example", host: "localhost" }))).toBe(true);
    expect(sameOriginBlocked(nreq("POST", { origin: "http://localhost", host: "localhost" }))).toBe(false);
    expect(sameOriginBlocked(nreq("PATCH", { referer: "http://localhost/customers", host: "localhost" }))).toBe(false);
    expect(sameOriginBlocked(nreq("POST", { referer: "https://evil.example/x", host: "localhost" }))).toBe(true);
    expect(sameOriginBlocked(nreq("GET", { origin: "https://evil.example", host: "localhost" }))).toBe(false);
  });

  it("absent Origin/Referer (non-browser client) → allowed; malformed/opaque origin → blocked", () => {
    expect(sameOriginBlocked(nreq("POST", { host: "localhost" }))).toBe(false);
    expect(sameOriginBlocked(nreq("POST", { origin: "null", host: "localhost" }))).toBe(true);
    expect(sameOriginBlocked(nreq("POST", { origin: "not-a-url", host: "localhost" }))).toBe(true);
  });

  it("middleware responds 403 {error, code: csrf_origin_mismatch} and passes same-origin", async () => {
    const blocked = proxy(nreq("POST", { origin: "https://evil.example", host: "localhost" }));
    expect(blocked.status).toBe(403);
    const body = (await blocked.json()) as { error: string; code: string };
    expect(body.code).toBe(CODE_CSRF_ORIGIN_MISMATCH);
    expect(typeof body.error).toBe("string");
    expect(proxy(nreq("POST", { origin: "http://localhost", host: "localhost" })).status).toBe(200);
  });
});

describe("T13 — upload endpoint authz (requireAdminOrOps)", () => {
  it("anon → 401; office → 403 forbidden_admin_ops (admin/ops allow covered in rules-e)", async () => {
    const anon = await uploadRoute(makeRequest("/api/admin/import", { method: "POST", body: {} }));
    expect(anon.status).toBe(401);

    const office = await makeUser({ roles: ["office"] });
    testUserIds.push(office.id);
    const denied = await uploadRoute(
      makeRequest("/api/admin/import", { method: "POST", cookie: office.cookie, body: inlineState("T13-OFFICE") }),
    );
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { code: string }).code).toBe(CODE_FORBIDDEN_ADMIN_OPS);
    const rows = await query<{ n: string }>(`SELECT count(*)::text AS n FROM import_batches WHERE actor = $1`, [office.id]);
    expect(Number(rows[0].n)).toBe(0); // denied before any write
  });
});

describe("T13 — upload rate limit", () => {
  it(`blocks the ${UPLOAD_LIMIT + 1}st upload in-window with 429 rate_limited`, async () => {
    const admin = await makeUser({ roles: ["admin"] });
    testUserIds.push(admin.id);
    for (let i = 0; i < UPLOAD_LIMIT; i++) {
      await query(`INSERT INTO upload_attempts (user_id) VALUES ($1)`, [admin.id]);
    }
    const res = await uploadRoute(
      makeRequest("/api/admin/import", { method: "POST", cookie: admin.cookie, body: inlineState("T13-LIMIT") }),
    );
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe(CODE_RATE_LIMITED);
    expect(body.error).toBe(MSG_RATE_LIMITED);
    const batches = await query<{ n: string }>(`SELECT count(*)::text AS n FROM import_batches WHERE actor = $1`, [admin.id]);
    expect(Number(batches[0].n)).toBe(0); // blocked before any write
  });
});

// T13 pre-P4 remainder: cookie flags (Secure), session fixation/rotation.
describe("T13 pre-P4 — cookie flags + session fixation/rotation", () => {
  it("sessionCookieOptions: httpOnly + SameSite=Lax + path; Secure flips on in production", async () => {
    const { sessionCookieOptions } = await import("@/lib/auth/session");
    const expiresAt = new Date(Date.now() + 60_000);
    const base = sessionCookieOptions(expiresAt);
    expect(base.httpOnly).toBe(true);
    expect(base.sameSite).toBe("lax");
    expect(base.path).toBe("/");
    expect(base.secure).toBe(false); // vitest NODE_ENV=test
    // lib/db loads dotenv/config → .env may carry AUTH_COOKIE_SECURE=false
    // (plain-HTTP LAN deploy); production-default assertion needs it unset.
    const prev = process.env.NODE_ENV;
    const prevSecureFlag = process.env.AUTH_COOKIE_SECURE;
    Reflect.set(process.env, "NODE_ENV", "production");
    delete process.env.AUTH_COOKIE_SECURE;
    try {
      expect(sessionCookieOptions(expiresAt).secure).toBe(true);
      process.env.AUTH_COOKIE_SECURE = "false";
      expect(sessionCookieOptions(expiresAt).secure).toBe(false); // LAN opt-out honored
    } finally {
      Reflect.set(process.env, "NODE_ENV", prev);
      if (prevSecureFlag === undefined) delete process.env.AUTH_COOKIE_SECURE;
      else process.env.AUTH_COOKIE_SECURE = prevSecureFlag;
    }
  });

  it("logout deletes session row; next login issues a rotated sid", async () => {
    const { POST: loginRoute } = await import("@/app/api/auth/login/route");
    const { POST: logoutRoute } = await import("@/app/api/auth/logout/route");
    const { SESSION_COOKIE } = await import("@/lib/auth/session");
    const u = await makeUser({ roles: ["office"], totp: false });
    testUserIds.push(u.id);
    const body = { email: u.email, password: TEST_PASSWORD };
    const res1 = await loginRoute(makeRequest("/api/auth/login", { method: "POST", body }));
    expect(res1.status).toBe(200);
    const sid1 = cookieValue(res1, SESSION_COOKIE);
    expect(sid1).toBeTruthy();

    const out = await logoutRoute(makeRequest("/api/auth/logout", { method: "POST", cookie: `${SESSION_COOKIE}=${sid1}` }));
    expect(out.status).toBe(200);
    expect(await query(`SELECT id FROM sessions WHERE id = $1`, [sid1])).toHaveLength(0);

    const res2 = await loginRoute(makeRequest("/api/auth/login", { method: "POST", body }));
    expect(res2.status).toBe(200);
    const sid2 = cookieValue(res2, SESSION_COOKIE);
    expect(sid2).toBeTruthy();
    expect(sid2).not.toBe(sid1);
  });

  it("planted pre-login session cookie is replaced at login (fixation)", async () => {
    const { POST: loginRoute } = await import("@/app/api/auth/login/route");
    const { SESSION_COOKIE } = await import("@/lib/auth/session");
    const attacker = await makeUser({ roles: ["office"], totp: false }); // makeUser issues a live sid
    const victim = await makeUser({ roles: ["office"], totp: false });
    testUserIds.push(attacker.id, victim.id);
    const planted = attacker.cookie.split("=")[1];

    const res = await loginRoute(
      makeRequest("/api/auth/login", {
        method: "POST",
        cookie: attacker.cookie,
        body: { email: victim.email, password: TEST_PASSWORD },
      }),
    );
    expect(res.status).toBe(200);
    const issued = cookieValue(res, SESSION_COOKIE);
    expect(issued).toBeTruthy();
    expect(issued).not.toBe(planted);
    const row = await query<{ user_id: string }>(`SELECT user_id FROM sessions WHERE id = $1`, [issued!]);
    expect(row[0].user_id).toBe(victim.id);
  });
});
