import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { generateTotpSecret, totpUri } from "@/lib/auth/totp";
import { readCookie } from "@/lib/auth/session";
import { err } from "@/lib/http";
import { MFA_COOKIE } from "@/lib/auth/mfa";

// Step 1 of forced MFA setup: returns a fresh secret + otpauth URI (not persisted yet)
export async function POST(req: Request) {
  const pendingId = readCookie(req, MFA_COOKIE);
  if (!pendingId) return err(401, "Setup step expired. Sign in again.");

  const rows = await query<{ user_id: string; email: string }>(
    `SELECT p.user_id, u.email
       FROM pending_mfa p JOIN users u ON u.id = p.user_id
      WHERE p.id = $1 AND p.expires_at > now() AND p.purpose = 'setup'
        AND u.active = true AND u.totp_secret IS NULL`,
    [pendingId],
  );
  if (!rows[0]) return err(401, "Setup step expired. Sign in again.");

  const secret = generateTotpSecret();
  return NextResponse.json({ secret, uri: totpUri(secret, rows[0].email) });
}
