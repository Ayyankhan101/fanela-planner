import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { verifyTotp } from "@/lib/auth/totp";
import { recordLogin } from "@/lib/auth/rate-limit";
import { createSession, readCookie, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { clientIp, err } from "@/lib/http";
import { MFA_COOKIE } from "@/lib/auth/mfa";
import { matchRecoveryCode } from "@/lib/auth/recovery";

const body = z
  .object({
    token: z.string().regex(/^\d{6}$/).optional(),
    recovery: z.string().min(8).max(32).optional(),
  })
  .refine((b) => Boolean(b.token) !== Boolean(b.recovery), {
    message: "Enter the 6-digit code or a recovery code.",
  });

export async function POST(req: Request) {
  const ip = clientIp(req);
  const pendingId = readCookie(req, MFA_COOKIE);
  if (!pendingId) return err(401, "MFA step expired. Sign in again.");

  const pending = await query<{
    user_id: string;
    email: string;
    totp_secret: string | null;
    recovery_codes: string | null;
  }>(
    `SELECT p.user_id, u.email, u.totp_secret, u.recovery_codes
       FROM pending_mfa p JOIN users u ON u.id = p.user_id
      WHERE p.id = $1 AND p.expires_at > now() AND u.active = true AND coalesce(p.purpose, 'challenge') = 'challenge'`,
    [pendingId],
  );
  const row = pending[0];
  if (!row || !row.totp_secret) return err(401, "MFA step expired. Sign in again.");

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, parsed.error.issues[0]?.message ?? "Enter the 6-digit code.");

  if (parsed.data.recovery) {
    const rest = matchRecoveryCode(row.recovery_codes, parsed.data.recovery);
    if (!rest) {
      await recordLogin(row.email, ip, false);
      return err(401, "Invalid recovery code.");
    }
    await query(`UPDATE users SET recovery_codes = $2 WHERE id = $1`, [row.user_id, rest]);
  } else {
    if (!verifyTotp(row.totp_secret, parsed.data.token!)) {
      await recordLogin(row.email, ip, false);
      return err(401, "Invalid code.");
    }
  }

  await query(`DELETE FROM pending_mfa WHERE id = $1`, [pendingId]);
  await recordLogin(row.email, ip, true);
  const session = await createSession(row.user_id, ip, req.headers.get("user-agent") ?? undefined);
  const res = NextResponse.json({ mfa: false });
  res.cookies.set(SESSION_COOKIE, session.id, sessionCookieOptions(session.expiresAt));
  res.cookies.set(MFA_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
