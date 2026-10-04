import { query } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";

// In-app notifications (P5 slice): emitted inside the caller's transaction
// (ambient tx from T1) — no worker, delivery = the committed row.

export const NOTIFICATION_KINDS = ["swatch_awaiting", "artwork_awaiting", "import_failed"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

// Recipients: active users holding any of `roles`, excluding the actor.
// Role lookup happens at emit time; no-op when nobody matches.
export async function emitNotification(input: {
  kind: NotificationKind;
  title: string;
  body: string;
  jobId?: string | null;
  roles: readonly string[];
  actorId?: string | null;
}): Promise<void> {
  // Vitest suites drive hundreds of artwork/swatch transitions and the test DB
  // carries thousands of junk `@fanela.test` holders — unsuppressed fan-out bloats
  // the table and pollutes the seeded LAN admin's bell. Emission suites opt in
  // explicitly (tests/notifications.test.ts sets the hook in beforeAll).
  if (process.env.VITEST === "true" && process.env.NOTIFICATIONS_TEST_HOOK !== "1") return;
  await query(
    `INSERT INTO notifications (id, recipient_id, kind, title, body, job_id)
     SELECT DISTINCT gen_random_uuid(), u.id, $1, $2, $3, $4::uuid
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
      WHERE u.active
        AND r.key::text = ANY($5::text[])
        AND ($6::uuid IS NULL OR u.id <> $6::uuid)`,
    [input.kind, input.title, input.body, input.jobId ?? null, input.roles, input.actorId ?? null],
  );
}

export type NotificationRecord = {
  id: string;
  kind: string;
  title: string;
  body: string;
  job_id: string | null;
  job_number: string | null;
  read_at: string | null;
  created_at: string;
};

// Own rows only — the recipient_id predicate is the ownership check.
export async function listNotifications(
  user: SessionUser,
  opts: { unreadOnly?: boolean; limit?: number } = {},
): Promise<{ items: NotificationRecord[]; unreadCount: number }> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const [items, counts] = await Promise.all([
    query<NotificationRecord>(
      `SELECT n.id, n.kind, n.title, n.body, n.job_id, j.job_number,
              n.read_at, to_char(n.created_at, 'YYYY-MM-DD"T"HH24:MI:SSZ') AS created_at
         FROM notifications n
         LEFT JOIN jobs j ON j.id = n.job_id
        WHERE n.recipient_id = $1
          AND ($2::bool IS NOT TRUE OR n.read_at IS NULL)
        ORDER BY n.created_at DESC
        LIMIT $3`,
      [user.id, opts.unreadOnly ?? false, limit],
    ),
    query<{ n: string }>(
      `SELECT count(*) AS n FROM notifications WHERE recipient_id = $1 AND read_at IS NULL`,
      [user.id],
    ),
  ]);
  return { items, unreadCount: Number(counts[0]?.n ?? 0) };
}

// Idempotent: unknown/foreign ids affect 0 rows → 200 (no existence leak).
export async function markNotificationsRead(user: SessionUser, id?: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE notifications SET read_at = now()
      WHERE recipient_id = $1 AND read_at IS NULL AND ($2::uuid IS NULL OR id = $2)
      RETURNING id`,
    [user.id, id ?? null],
  );
  return rows.length;
}
