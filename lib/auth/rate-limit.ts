import { query } from "@/lib/db";

// Progressive lockout: 5 fails/15min per email → lock 15 min; 20 fails/15min per IP → blocked while the 15-min window holds ≥20.
export async function loginBlocked(email: string, ip: string): Promise<string | null> {
  const emailFails = await query<{ n: string }>(
    `SELECT count(*)::int AS n FROM login_attempts
      WHERE email = $1 AND success = false AND ts > now() - interval '15 minutes'`,
    [email.toLowerCase()],
  );
  if (Number(emailFails[0].n) >= 5) {
    const last = await query<{ ts: string }>(
      `SELECT max(ts)::text AS ts FROM login_attempts
        WHERE email = $1 AND success = false AND ts > now() - interval '15 minutes'`,
      [email.toLowerCase()],
    );
    const lockUntil = new Date(last[0].ts).getTime() + 15 * 60 * 1000;
    if (Date.now() < lockUntil) return "account_locked";
  }
  const ipFails = await query<{ n: string }>(
    `SELECT count(*)::int AS n FROM login_attempts
      WHERE ip = $1 AND success = false AND ts > now() - interval '15 minutes'`,
    [ip],
  );
  if (Number(ipFails[0].n) >= 20) return "ip_locked";
  return null;
}

export async function recordLogin(email: string, ip: string, success: boolean): Promise<void> {
  await query(`INSERT INTO login_attempts (email, ip, success) VALUES ($1, $2, $3)`, [
    email.toLowerCase(),
    ip,
    success,
  ]);
}

// Import upload throttle (T13): UPLOAD_RATE_LIMIT uploads / 60 min per user.
const UPLOAD_LIMIT = Number(process.env.UPLOAD_RATE_LIMIT ?? 100);
const UPLOAD_WINDOW_MIN = 60;

export async function uploadBlocked(userId: string): Promise<string | null> {
  const res = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM upload_attempts
      WHERE user_id = $1 AND ts > now() - ($2 || ' minutes')::interval`,
    [userId, String(UPLOAD_WINDOW_MIN)],
  );
  return Number(res[0].n) >= UPLOAD_LIMIT ? "rate_limited" : null;
}

export async function recordUpload(userId: string): Promise<void> {
  await query(`INSERT INTO upload_attempts (user_id) VALUES ($1)`, [userId]);
}
