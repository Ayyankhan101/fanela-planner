import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { verifyTotp } from "@/lib/auth/totp";
import { recordLogin } from "@/lib/auth/rate-limit";
import {
  createSession, readCookie, getSessionUser, SESSION_COOKIE, sessionCookieOptions,
} from "@/lib/auth/session";
import { clientIp, err } from "@/lib/http";
import { MFA_COOKIE } from "@/lib/auth/mfa";
import { generateRecoveryCodes } from "@/lib/auth/recovery";

const body = z.object({
  secret: z.string().min(16).max(64),
  token: z.string().regex(/^\d{6}$/),
});

// Confirm enrolment: verifies first code, persists secret, returns recovery codes ONCE (B3).
// Auth paths: setup token (forced flow) OR active session with no secret yet (optional enrol).
export async function POST(req: Request) {
  const ip = clientIp(req);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, "Enter secret and 6-digit code.");

  const pendingId = readCookie(req, MFA_COOKIE);
  let userId: string | null = null;
  let viaSetup = false;
  let email = "";

  if (pendingId) {
    const rows = await query<{ user_id: string; email: string }>(
      `SELECT p.user_id, u.email
         FROM pending_mfa p JOIN users u ON u.id = p.user_id
        WHERE p.id = $1 AND p.expires_at > now() AND p.purpose = 'setup'
          AND u.active = true AND u.totp_secret IS NULL`,
      [pendingId],
    );
    if (rows[0]) {
      userId = rows[0].user_id;
      email = rows[0].email;
      viaSetup = true;
    }
  }
  if (!userId) {
    const user = await getSessionUser(req);
    if (user && !user.totpEnabled) {
      userId = user.id;
      email = user.email;
    }
  }
  if (!userId) return err(401, "Setup step expired. Sign in again.");

  if (!verifyTotp(parsed.data.secret, parsed.data.token)) {
    await recordLogin(email, ip, false);
    return err(401, "Invalid code. Scan the QR again and retry.");
  }

  const { codes, stored } = generateRecoveryCodes();
  await query(`UPDATE users SET totp_secret = $2, recovery_codes = $3 WHERE id = $1 AND totp_secret IS NULL`, [
    userId,
    parsed.data.secret,
    stored,
  ]);
  if (viaSetup && pendingId) {
    await query(`DELETE FROM pending_mfa WHERE id = $1`, [pendingId]);
    await recordLogin(email, ip, true);
  }

  const res = NextResponse.json({ recoveryCodes: codes });
  if (viaSetup) {
    const session = await createSession(userId, ip, req.headers.get("user-agent") ?? undefined);
    res.cookies.set(SESSION_COOKIE, session.id, sessionCookieOptions(session.expiresAt));
  }
  res.cookies.set(MFA_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
