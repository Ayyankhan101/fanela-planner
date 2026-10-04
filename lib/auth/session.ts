import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";

export const SESSION_COOKIE = "fanela_session";
const IDLE_MS = 2 * 60 * 60 * 1000; // 2h idle (OI-7)
const ABSOLUTE_MS = 12 * 60 * 60 * 1000; // 12h absolute (OI-7)

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  roles: string[]; // role keys
  departments: string[]; // department keys
  totpEnabled: boolean;
};

// req-based cookie read (API routes — testable without request scope)
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

// returns session id + expiry; route sets the cookie on its own response
export async function createSession(
  userId: string,
  ip?: string,
  ua?: string,
): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + ABSOLUTE_MS);
  const rows = await query<{ id: string }>(
    `INSERT INTO sessions (id, user_id, expires_at, ip, ua) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [randomUUID(), userId, expiresAt, ip ?? null, ua ?? null],
  );
  return { id: rows[0].id, expiresAt };
}

// Secure flag: production default, but AUTH_COOKIE_SECURE=false opts out for
// plain-HTTP LAN deployments (browsers reject Secure cookies set over http://
// on non-localhost origins — login would bounce forever).
export function cookieSecure(): boolean {
  return process.env.NODE_ENV === "production" && process.env.AUTH_COOKIE_SECURE !== "false";
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: cookieSecure(),
    path: "/",
    expires: expiresAt,
  };
}

// sliding idle window, capped by absolute expiry
async function loadUser(sid: string): Promise<SessionUser | null> {
  const rows = await query<{
    user_id: string;
    expires_at: string;
    created_at: string;
    active: boolean;
    email: string;
    name: string;
    totp_secret: string | null;
  }>(
    `SELECT s.user_id, s.expires_at, s.created_at, u.active, u.email, u.name, u.totp_secret
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1`,
    [sid],
  );
  const row = rows[0];
  if (!row || !row.active) return null;

  const now = Date.now();
  if (new Date(row.expires_at).getTime() <= now) {
    await query(`DELETE FROM sessions WHERE id = $1`, [sid]); // idle timeout
    return null;
  }
  const created = new Date(row.created_at).getTime();
  if (now - created > ABSOLUTE_MS) {
    await query(`DELETE FROM sessions WHERE id = $1`, [sid]); // absolute cap
    return null;
  }

  // slide idle window (never beyond absolute cap)
  const newIdle = Math.min(now + IDLE_MS, created + ABSOLUTE_MS);
  await query(`UPDATE sessions SET expires_at = $2 WHERE id = $1`, [sid, new Date(newIdle)]);

  const roleRows = await query<{ key: string }>(
    `SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1`,
    [row.user_id],
  );
  const deptRows = await query<{ key: string }>(
    `SELECT d.key FROM user_departments ud JOIN departments d ON d.id = ud.department_id WHERE ud.user_id = $1`,
    [row.user_id],
  );

  return {
    id: row.user_id,
    email: row.email,
    name: row.name,
    roles: roleRows.map((r) => r.key),
    departments: deptRows.map((d) => d.key),
    totpEnabled: Boolean(row.totp_secret),
  };
}

// API routes pass req (header-based); pages fall back to ambient cookies()
export async function getSessionUser(req?: Request): Promise<SessionUser | null> {
  let sid: string | null;
  if (req) {
    sid = readCookie(req, SESSION_COOKIE);
  } else {
    const jar = await cookies();
    sid = jar.get(SESSION_COOKIE)?.value ?? null;
  }
  if (!sid) return null;
  return loadUser(sid);
}

// deletes session row; returns sid so route can clear its response cookie
export async function destroySession(req?: Request): Promise<string | null> {
  let sid: string | null;
  if (req) {
    sid = readCookie(req, SESSION_COOKIE);
  } else {
    const jar = await cookies();
    sid = jar.get(SESSION_COOKIE)?.value ?? null;
  }
  if (sid) await query(`DELETE FROM sessions WHERE id = $1`, [sid]);
  if (!req) {
    const jar = await cookies();
    jar.delete(SESSION_COOKIE);
  }
  return sid;
}
