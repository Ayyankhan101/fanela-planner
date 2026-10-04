// Integration outbox (phase0 §4.9, plan P5 groundwork): transactional enqueue,
// CAS claim, table-owned exponential backoff, manual retry, stuck reclaim.
// pg-boss is only a tick scheduler — this table owns all retry state, so a
// delayed pg-boss job and the tick scan can never race (backoff lives here).
// Sender registry starts EMPTY: D1–D6/X1–X5 haven't shipped. Senderless rows
// are never claimed (attempts stay 0) — they wait for their adapter.
import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";

export const OUTBOX_MAX_ATTEMPTS = 5;
export const OUTBOX_BACKOFF_BASE_MS = 30_000; // 30s ×2 → 30/60/120/240s; attempt 5 → failed
export const OUTBOX_STUCK_MS = 5 * 60_000;
const OUTBOX_ERROR_MAX = 2000;
const OUTBOX_CLAIM_BATCH = 25;

type OutboxStatus = "pending" | "sending" | "sent" | "failed";

export type OutboxRow = {
  id: string;
  kind: string;
  payload: unknown;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  next_retry_at: string | null;
  claimed_at: string | null;
  ts: string;
};

export type OutboxSender = (row: OutboxRow) => Promise<void>;
const senders = new Map<string, OutboxSender>();

export function registerOutboxSender(kind: string, sender: OutboxSender): void {
  senders.set(kind, sender);
}

export function outboxSenderKinds(): string[] {
  return [...senders.keys()];
}

// Rides the ambient transaction (lib/db query) — same event's rollback removes
// the row with the business write (no orphan/out-of-order rows).
// Due time uses the app clock (same clock dispatch/claim compares against —
// DB now() can sit a few ms ahead of JS Date.now() and gate the first claim).
export async function enqueueOutbox(kind: string, payload: unknown): Promise<string> {
  const rows = await query<{ id: string }>(
    `INSERT INTO integration_outbox (id, kind, payload, next_retry_at)
     VALUES ($1, $2, $3::jsonb, $4) RETURNING id`,
    [randomUUID(), kind, JSON.stringify(payload ?? null), new Date().toISOString()],
  );
  return rows[0].id;
}

export type DispatchResult = { claimed: number; sent: number; failed: number; retry: number };

// One scan/claim/dispatch pass. Multi-worker safe: single-statement claim with
// FOR UPDATE SKIP LOCKED; status='sending' + claimed_at is the CAS token.
export async function dispatchOutboxOnce(now = new Date()): Promise<DispatchResult> {
  const out: DispatchResult = { claimed: 0, sent: 0, failed: 0, retry: 0 };
  const kinds = outboxSenderKinds();
  if (kinds.length === 0) return out;

  const claimed = await query<{ id: string }>(
    `UPDATE integration_outbox AS o
     SET status = 'sending', claimed_at = $2, attempts = o.attempts + 1
     FROM (
       SELECT id FROM integration_outbox
       WHERE status = 'pending'
         AND kind = ANY($1::text[])
         AND (next_retry_at IS NULL OR next_retry_at <= $2)
       ORDER BY ts
       LIMIT $3
       FOR UPDATE SKIP LOCKED
     ) AS due
     WHERE o.id = due.id
     RETURNING o.id`,
    [kinds, now.toISOString(), OUTBOX_CLAIM_BATCH],
  );
  out.claimed = claimed.length;

  for (const { id } of claimed) {
    const rows = await query<OutboxRow>(
      `SELECT id, kind, payload, status, attempts, last_error, next_retry_at, claimed_at, ts
       FROM integration_outbox WHERE id = $1 AND status = 'sending'`,
      [id],
    );
    const row = rows[0];
    if (!row) continue; // reclaimed/stolen concurrently — leave it alone
    const sender = senders.get(row.kind);
    if (!sender) {
      // registry changed under us — release, don't wedge in 'sending'
      await query(
        `UPDATE integration_outbox SET status = 'pending', claimed_at = NULL, next_retry_at = $2 WHERE id = $1`,
        [id, now.toISOString()],
      );
      continue;
    }
    try {
      await sender(row);
      await query(
        `UPDATE integration_outbox SET status = 'sent', claimed_at = NULL WHERE id = $1 AND status = 'sending'`,
        [id],
      );
      out.sent++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const trimmed = message.length > OUTBOX_ERROR_MAX ? message.slice(0, OUTBOX_ERROR_MAX) : message;
      if (row.attempts >= OUTBOX_MAX_ATTEMPTS) {
        await query(
          `UPDATE integration_outbox SET status = 'failed', last_error = $2, claimed_at = NULL
           WHERE id = $1 AND status = 'sending'`,
          [id, trimmed],
        );
        out.failed++;
      } else {
        const nextAt = new Date(now.getTime() + OUTBOX_BACKOFF_BASE_MS * 2 ** (row.attempts - 1));
        await query(
          `UPDATE integration_outbox SET status = 'pending', last_error = $2, next_retry_at = $3, claimed_at = NULL
           WHERE id = $1 AND status = 'sending'`,
          [id, trimmed, nextAt.toISOString()],
        );
        out.retry++;
      }
    }
  }
  return out;
}

// Crash recovery: claims that died mid-send go back to pending with a fresh
// due time (attempts already counted at claim — not double-counted here).
export async function reclaimStuckOutbox(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - OUTBOX_STUCK_MS).toISOString();
  const rows = await query<{ id: string }>(
    `UPDATE integration_outbox
     SET status = 'pending', claimed_at = NULL, next_retry_at = $1
     WHERE status = 'sending' AND claimed_at IS NOT NULL AND claimed_at < $2
     RETURNING id`,
    [now.toISOString(), cutoff],
  );
  return rows.length;
}

export type RetryOutcome = "retried" | "already_sent" | "sending" | "not_found";

// Manual admin retry: failed rows, backlogged pending rows (reset due time),
// and stuck 'sending' claims. Fresh 'sending' rows are refused (may be live).
export async function retryOutbox(id: string, now = new Date()): Promise<RetryOutcome> {
  const rows = await query<{ id: string }>(
    `UPDATE integration_outbox
     SET status = 'pending', next_retry_at = $2, last_error = NULL, claimed_at = NULL
     WHERE id = $1
       AND (status = 'failed'
            OR status = 'pending'
            OR (status = 'sending' AND claimed_at < $3))
     RETURNING id`,
    [id, now.toISOString(), new Date(now.getTime() - OUTBOX_STUCK_MS).toISOString()],
  );
  if (rows.length > 0) return "retried";
  const found = await query<{ status: string }>(`SELECT status FROM integration_outbox WHERE id = $1`, [id]);
  if (found.length === 0) return "not_found";
  return found[0].status === "sent" ? "already_sent" : "sending";
}
