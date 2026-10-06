import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { verifyTotp } from "@/lib/auth/totp";
import { recordLogin } from "@/lib/auth/rate-limit";
import { createSession, readCookie, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { clientIp, err } from "@/lib/http";
import { MFA_COOKIE } from "@/lib/auth/mfa";
import { matchRecoveryCode } from "@/lib/auth/recovery";
import {
  MSG_INVALID_REQUEST,
  CODE_VALIDATION_ERROR,
  MSG_MFA_STEP_EXPIRED,
  CODE_MFA_STEP_EXPIRED,
  MSG_MFA_INVALID_CODE,
  CODE_MFA_INVALID_CODE,
  MSG_MFA_INVALID_RECOVERY_CODE,
  CODE_MFA_INVALID_RECOVERY_CODE,
} from "@/lib/errors";

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
  if (!pendingId) return err(401, MSG_MFA_STEP_EXPIRED, CODE_MFA_STEP_EXPIRED);

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
  if (!row || !row.totp_secret) return err(401, MSG_MFA_STEP_EXPIRED, CODE_MFA_STEP_EXPIRED);

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, MSG_INVALID_REQUEST, CODE_VALIDATION_ERROR);

  if (parsed.data.recovery) {
    const rest = matchRecoveryCode(row.recovery_codes, parsed.data.recovery);
    if (!rest) {
      await recordLogin(row.email, ip, false);
      return err(401, MSG_MFA_INVALID_RECOVERY_CODE, CODE_MFA_INVALID_RECOVERY_CODE);
    }
    await query(`UPDATE users SET recovery_codes = $2 WHERE id = $1`, [row.user_id, rest]);
  } else {
    if (!verifyTotp(row.totp_secret, parsed.data.token!)) {
      await recordLogin(row.email, ip, false);
      return err(401, MSG_MFA_INVALID_CODE, CODE_MFA_INVALID_CODE);
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
