import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { currentTotp } from "@/lib/auth/totp";
import { createSession, readCookie, SESSION_COOKIE } from "@/lib/auth/session";
import { MFA_COOKIE } from "@/lib/auth/mfa";

export const DEV_TOTP = "JBSWY3DPEHPK3PXP"; // matches db/seed.mts
export const TEST_PASSWORD = "Test-Pass-1!";

export type TestUser = {
  id: string;
  email: string;
  password: string;
  roles: string[];
  cookie: string; // fanela_session value
};

function uniqueIp(): string {
  return `10.9.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
}

export function makeRequest(
  path: string,
  opts: { method?: string; body?: unknown; cookie?: string; ip?: string } = {},
): Request {
  const headers = new Headers({
    "content-type": "application/json",
    "x-forwarded-for": opts.ip ?? uniqueIp(), // B5: unique IP per call — shared "local" trips IP lock
  });
  if (opts.cookie) headers.set("cookie", opts.cookie);
  return new Request(`http://localhost${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

// creates user + roles + departments; totp on by default (login → challenge path)
export async function makeUser(opts: {
  roles: readonly string[];
  departments?: string[];
  totp?: boolean;
}): Promise<TestUser> {
  const id = randomUUID();
  const email = `t-${id.slice(0, 8)}@fanela.test`;
  const passwordHash = await hashPassword(TEST_PASSWORD);
  await query(
    `INSERT INTO users (id, email, name, password_hash, totp_secret) VALUES ($1,$2,$3,$4,$5)`,
    [id, email, "Test User", passwordHash, opts.totp === false ? null : DEV_TOTP],
  );
  const roleList = opts.roles.map(String);
  for (const key of roleList) {
    await query(
      `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE key = $2`,
      [id, key],
    );
  }
  for (const dept of opts.departments ?? []) {
    await query(
      `INSERT INTO user_departments (user_id, department_id) SELECT $1, id FROM departments WHERE key = $2`,
      [id, dept],
    );
  }
  const session = await createSession(id, uniqueIp(), "vitest");
  return { id, email, password: passwordHash ? TEST_PASSWORD : "", roles: roleList, cookie: `${SESSION_COOKIE}=${session.id}` };
}

// full login flow → session cookie (handles challenge MFA when totp is set)
export async function login(user: { email: string; password: string }): Promise<string> {
  const res = await (
    await import("@/app/api/auth/login/route")
  ).POST(
    makeRequest("/api/auth/login", { method: "POST", body: { email: user.email, password: user.password } }),
  );
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const mfa = res.cookies.get(MFA_COOKIE)?.value;
  if (!mfa) throw new Error("expected mfa challenge cookie");
  const code = currentTotp(DEV_TOTP);
  const res2 = await (
    await import("@/app/api/auth/mfa/route")
  ).POST(
    makeRequest("/api/auth/mfa", {
      method: "POST",
      body: { token: code },
      cookie: `${MFA_COOKIE}=${mfa}`,
    }),
  );
  if (res2.status !== 200) throw new Error(`mfa failed: ${res2.status} ${await res2.text()}`);
  const sid = res2.cookies.get(SESSION_COOKIE)?.value;
  if (!sid) throw new Error("expected session cookie");
  return `${SESSION_COOKIE}=${sid}`;
}

export function cookieValue(res: Response, name: string): string | null {
  // Response.headers.getSetCookie to read raw set-cookie list
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const c of raw) {
    const [pair] = c.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0 && pair.slice(0, idx).trim() === name) {
      return decodeURIComponent(pair.slice(idx + 1).trim());
    }
  }
  return null;
}

export { readCookie, query, randomUUID };
