import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { loginBlocked, recordLogin } from "@/lib/auth/rate-limit";
import { cookieSecure, createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { clientIp, err } from "@/lib/http";
import { MFA_COOKIE, MFA_TTL_MS, MFA_MANDATORY_ROLES } from "@/lib/auth/mfa";
import { MSG_INVALID_REQUEST, CODE_INVALID_REQUEST } from "@/lib/errors";

const body = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: Request) {
  const ip = clientIp(req);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, MSG_INVALID_REQUEST, CODE_INVALID_REQUEST);
  const email = parsed.data.email.toLowerCase();

  const blocked = await loginBlocked(email, ip);
  if (blocked) return err(429, "Too many attempts. Try again later.");

  const users = await query<{
    id: string;
    password_hash: string;
    active: boolean;
    totp_secret: string | null;
    roles: string[];
  }>(
    `SELECT u.id, u.password_hash, u.active, u.totp_secret,
            coalesce(array_agg(r.key) FILTER (WHERE r.key IS NOT NULL), '{}') AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.email = $1
      GROUP BY u.id`,
    [email],
  );
  const user = users[0];
  const ok = user ? await verifyPassword(user.password_hash, parsed.data.password) : false;

  if (!ok || !user || !user.active) {
    await recordLogin(email, ip, false);
    return err(401, "Invalid email or password.");
  }

  if (user.totp_secret) {
    // step 1 complete → short-lived scope-restricted pending token (never a session)
    const id = randomUUID();
    await query(`INSERT INTO pending_mfa (id, user_id, expires_at, purpose) VALUES ($1,$2,$3,'challenge')`, [
      id,
      user.id,
      new Date(Date.now() + MFA_TTL_MS),
    ]);
    const res = NextResponse.json({ mfa: true });
    res.cookies.set(MFA_COOKIE, id, {
      httpOnly: true,
      sameSite: "strict",
      secure: cookieSecure(),
      path: "/",
      maxAge: MFA_TTL_MS / 1000,
    });
    return res;
  }

  // B3: mandatory roles without a TOTP secret must enrol before a session exists
  const mandatory = MFA_MANDATORY_ROLES.some((r) => user.roles.includes(r));
  if (mandatory) {
    const id = randomUUID();
    await query(`INSERT INTO pending_mfa (id, user_id, expires_at, purpose) VALUES ($1,$2,$3,'setup')`, [
      id,
      user.id,
      new Date(Date.now() + MFA_TTL_MS),
    ]);
    const res = NextResponse.json({ mfa_setup: true });
    res.cookies.set(MFA_COOKIE, id, {
      httpOnly: true,
      sameSite: "strict",
      secure: cookieSecure(),
      path: "/",
      maxAge: MFA_TTL_MS / 1000,
    });
    return res;
  }

  await recordLogin(email, ip, true);
  const session = await createSession(user.id, ip, req.headers.get("user-agent") ?? undefined);
  const res = NextResponse.json({ mfa: false });
  res.cookies.set(SESSION_COOKIE, session.id, sessionCookieOptions(session.expiresAt));
  return res;
}
