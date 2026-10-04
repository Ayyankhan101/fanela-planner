// Outbox (phase0 §4.9 / plan P5 groundwork): enqueue rides ambient tx, CAS
// claim → send, table-owned backoff + attempt cap, senderless rows untouched,
// stuck reclaim, manual retry outcomes, admin route status classes.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { query, withTransaction } from "@/lib/db";
import { makeUser, makeRequest, randomUUID } from "./helpers";
import {
  enqueueOutbox,
  dispatchOutboxOnce,
  retryOutbox,
  reclaimStuckOutbox,
  registerOutboxSender,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_BACKOFF_BASE_MS,
  OUTBOX_STUCK_MS,
} from "@/lib/services/outbox";
import { POST as postRetry } from "@/app/api/admin/outbox/[id]/retry/route";

const KIND_OK = "test-outbox-ok";
const KIND_FAIL = "test-outbox-fail";
const KIND_LATE = "test-outbox-late";
const KIND_NONE = "test-outbox-none"; // never registered

type Row = {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  last_error: string | null;
  next_retry_at: Date | null;
  claimed_at: Date | null;
};

async function row(id: string): Promise<Row | undefined> {
  const rows = await query<Row>(
    `SELECT id, kind, status, attempts, last_error, next_retry_at, claimed_at
     FROM integration_outbox WHERE id = $1`,
    [id],
  );
  return rows[0];
}

let okPayloads: unknown[] = [];

beforeAll(async () => {
  await query(`DELETE FROM integration_outbox WHERE kind LIKE 'test-outbox-%'`);
  registerOutboxSender(KIND_OK, async (r) => {
    okPayloads.push(r.payload);
  });
  registerOutboxSender(KIND_FAIL, async () => {
    throw new Error("boom downstream");
  });
  registerOutboxSender(KIND_LATE, async () => {});
});

afterAll(async () => {
  await query(`DELETE FROM integration_outbox WHERE kind LIKE 'test-outbox-%'`);
});

describe("outbox enqueue", () => {
  it("lands pending row attempts=0; ambient-tx rollback removes it", async () => {
    const id = await enqueueOutbox(KIND_OK, { a: 1 });
    const r = await row(id);
    expect(r?.status).toBe("pending");
    expect(r?.attempts).toBe(0);

    let ghostId = "";
    await expect(
      withTransaction(async () => {
        ghostId = await enqueueOutbox(KIND_OK, { ghost: true });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await row(ghostId)).toBeUndefined();
  });
});

describe("outbox dispatch", () => {
  it("claim → sent: sender receives payload, attempts=1, claim released", async () => {
    okPayloads = [];
    const id = await enqueueOutbox(KIND_OK, { hello: "world" });
    const res = await dispatchOutboxOnce();
    expect(res.claimed).toBeGreaterThanOrEqual(1);
    expect(res.sent).toBeGreaterThanOrEqual(1);
    const r = await row(id);
    expect(r?.status).toBe("sent");
    expect(r?.attempts).toBe(1);
    expect(r?.claimed_at).toBeNull();
    expect(okPayloads).toContainEqual({ hello: "world" });
  });

  it("failure → pending with last_error and backoff ≈ now + 30s", async () => {
    const id = await enqueueOutbox(KIND_FAIL, {});
    const t0 = Date.now();
    const res = await dispatchOutboxOnce(new Date(t0));
    expect(res.retry).toBeGreaterThanOrEqual(1);
    const r = await row(id);
    expect(r?.status).toBe("pending");
    expect(r?.attempts).toBe(1);
    expect(r?.last_error).toContain("boom downstream");
    expect(r?.claimed_at).toBeNull();
    const due = r!.next_retry_at!.getTime();
    expect(due).toBeGreaterThanOrEqual(t0 + OUTBOX_BACKOFF_BASE_MS - 1000);
    expect(due).toBeLessThanOrEqual(t0 + OUTBOX_BACKOFF_BASE_MS + 5000);
  });

  it("not-due row (backoff gate) is not claimed", async () => {
    const id = await enqueueOutbox(KIND_LATE, {});
    await query(`UPDATE integration_outbox SET next_retry_at = $2 WHERE id = $1`, [
      id,
      new Date(Date.now() + 60_000).toISOString(),
    ]);
    await dispatchOutboxOnce();
    const r = await row(id);
    expect(r?.status).toBe("pending");
    expect(r?.attempts).toBe(0);
  });

  it("attempt cap: 5th failed attempt → failed", async () => {
    const id = await enqueueOutbox(KIND_FAIL, {});
    await query(`UPDATE integration_outbox SET attempts = $2 WHERE id = $1`, [id, OUTBOX_MAX_ATTEMPTS - 1]);
    await dispatchOutboxOnce();
    const r = await row(id);
    expect(r?.status).toBe("failed");
    expect(r?.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
    expect(r?.last_error).toContain("boom downstream");
  });

  it("senderless rows are never claimed (attempts stay 0)", async () => {
    const id = await enqueueOutbox(KIND_NONE, { x: 1 });
    await dispatchOutboxOnce();
    const r = await row(id);
    expect(r?.status).toBe("pending");
    expect(r?.attempts).toBe(0);
  });
});

describe("outbox reclaim + retry", () => {
  it("stuck 'sending' reclaimed to pending; fresh 'sending' untouched", async () => {
    const stuck = await enqueueOutbox(KIND_NONE, {});
    await query(`UPDATE integration_outbox SET status = 'sending', claimed_at = $2, attempts = 1 WHERE id = $1`, [
      stuck,
      new Date(Date.now() - OUTBOX_STUCK_MS - 60_000).toISOString(),
    ]);
    const fresh = await enqueueOutbox(KIND_NONE, {});
    await query(`UPDATE integration_outbox SET status = 'sending', claimed_at = $2, attempts = 1 WHERE id = $1`, [
      fresh,
      new Date().toISOString(),
    ]);
    const n = await reclaimStuckOutbox();
    expect(n).toBeGreaterThanOrEqual(1);
    const rStuck = await row(stuck);
    expect(rStuck?.status).toBe("pending");
    expect(rStuck?.next_retry_at).not.toBeNull();
    expect(rStuck?.claimed_at).toBeNull();
    expect((await row(fresh))?.status).toBe("sending");
  });

  it("retryOutbox outcomes: failed→retried, sent→already_sent, fresh sending→sending, unknown→not_found", async () => {
    const failedId = await enqueueOutbox(KIND_FAIL, {});
    await query(`UPDATE integration_outbox SET status = 'failed', attempts = $2, last_error = 'old error' WHERE id = $1`, [
      failedId,
      OUTBOX_MAX_ATTEMPTS,
    ]);
    expect(await retryOutbox(failedId)).toBe("retried");
    const r = await row(failedId);
    expect(r?.status).toBe("pending");
    expect(r?.last_error).toBeNull();
    expect(r!.next_retry_at!.getTime()).toBeLessThanOrEqual(Date.now() + 2000);

    const sentId = await enqueueOutbox(KIND_OK, { s: 1 });
    await dispatchOutboxOnce();
    expect((await row(sentId))?.status).toBe("sent");
    expect(await retryOutbox(sentId)).toBe("already_sent");

    const sendingId = await enqueueOutbox(KIND_NONE, {});
    await query(`UPDATE integration_outbox SET status = 'sending', claimed_at = $2, attempts = 1 WHERE id = $1`, [
      sendingId,
      new Date().toISOString(),
    ]);
    expect(await retryOutbox(sendingId)).toBe("sending");

    expect(await retryOutbox(randomUUID())).toBe("not_found");
  });
});

describe("POST /api/admin/outbox/[id]/retry", () => {
  let adminCookie = "";
  let officeCookie = "";

  beforeAll(async () => {
    adminCookie = (await makeUser({ roles: ["admin"] })).cookie;
    officeCookie = (await makeUser({ roles: ["office"] })).cookie;
  });

  const call = (id: string, cookie?: string) =>
    postRetry(makeRequest(`/api/admin/outbox/${id}/retry`, { method: "POST", cookie }), {
      params: Promise.resolve({ id }),
    });

  it("anon 401, office 403, admin 200 on failed row (→ pending)", async () => {
    const id = await enqueueOutbox(KIND_FAIL, {});
    await query(`UPDATE integration_outbox SET status = 'failed', attempts = $2 WHERE id = $1`, [
      id,
      OUTBOX_MAX_ATTEMPTS,
    ]);
    expect((await call(id)).status).toBe(401);
    expect((await call(id, officeCookie)).status).toBe(403);
    const ok = await call(id, adminCookie);
    expect(ok.status).toBe(200);
    expect((await row(id))?.status).toBe("pending");
  });

  it("status classes: 400 bad uuid, 404 unknown, 409 already sent", async () => {
    expect((await call("not-a-uuid", adminCookie)).status).toBe(400);
    expect((await call(randomUUID(), adminCookie)).status).toBe(404);
    const sentId = await enqueueOutbox(KIND_OK, { sent: true });
    await dispatchOutboxOnce();
    expect((await row(sentId))?.status).toBe("sent");
    expect((await call(sentId, adminCookie)).status).toBe(409);
  });
});
