// T1 [7A]: withTransaction — ROLLBACK on throw, ambient tx client in query(),
// audit + readiness observe uncommitted state (same-session assertion).
import { describe, it, expect, beforeAll } from "vitest";
import { makeUser, query, randomUUID } from "./helpers";
import { newCustomer, newJob } from "./fixtures";
import type { TestUser } from "./helpers";
import { pool, withTransaction } from "@/lib/db";
import { patchStockLine } from "@/lib/services/stock";
import { computeReadiness, updateReadinessCache } from "@/lib/services/readiness";
import { audit } from "@/lib/services/audit";
import type { SessionUser } from "@/lib/auth/session";

let admin: TestUser;
let adminSession: SessionUser;
let customerId: string;
const suffix = randomUUID().slice(0, 8);

beforeAll(async () => {
  admin = await makeUser({ roles: ["admin"] });
  adminSession = {
    id: admin.id,
    email: admin.email,
    name: "Test User",
    roles: admin.roles,
    departments: [],
    totpEnabled: false,
  };
  customerId = await newCustomer(admin.cookie, `TX Co ${suffix}`);
});

async function lineVersion(lineId: string): Promise<number> {
  const rows = await query<{ version: number }>(`SELECT version FROM job_lines WHERE id = $1`, [lineId]);
  return Number(rows[0].version);
}

async function receiptCount(lineId: string): Promise<number> {
  const rows = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM stock_events WHERE job_line_id = $1 AND type = 'receipt'`,
    [lineId],
  );
  return Number(rows[0].n);
}

describe("withTransaction rollback (T1/7A)", () => {
  it("mid-tx throw → ROLLBACK, state unchanged", async () => {
    const job = await newJob(admin.cookie, customerId);
    const line = job.lines[0];
    const v0 = await lineVersion(line.id);
    const e0 = await receiptCount(line.id);

    await expect(
      withTransaction(async () => {
        await query(`UPDATE job_lines SET version = version + 1 WHERE id = $1`, [line.id]);
        await query(
          `INSERT INTO stock_events (id, job_id, job_line_id, type, qty) VALUES ($1,$2,$3,'receipt',7)`,
          [randomUUID(), job.id, line.id],
        );
        throw new Error("injected mid-tx failure");
      }),
    ).rejects.toThrow("injected mid-tx failure");

    expect(await lineVersion(line.id)).toBe(v0);
    expect(await receiptCount(line.id)).toBe(e0);
  });

  it("failure injection through real site: receipt inside patchStockLine rolls back on later throw", async () => {
    const job = await newJob(admin.cookie, customerId);
    const line = job.lines[0];
    const v0 = await lineVersion(line.id);
    const e0 = await receiptCount(line.id);

    // outer tx reuses ambient client — patchStockLine's receipt lands on the same session;
    // post-receipt throw must take the whole receipt down (all-or-nothing atomic site)
    await expect(
      withTransaction(async () => {
        const v = await patchStockLine(job.id, line.id, { receipt: { qty: 5, note: "T1 injection" } }, line.version, adminSession);
        expect(v).toBe(line.version + 1);
        throw new Error("post-receipt failure");
      }),
    ).rejects.toThrow("post-receipt failure");

    expect(await lineVersion(line.id)).toBe(v0);
    expect(await receiptCount(line.id)).toBe(e0);
  });

  it("control: patchStockLine receipt outside tx commits event + version bump", async () => {
    const job = await newJob(admin.cookie, customerId);
    const line = job.lines[0];
    const e0 = await receiptCount(line.id);

    const v = await patchStockLine(job.id, line.id, { receipt: { qty: 5, note: "T1 control" } }, line.version, adminSession);
    expect(v).toBe(line.version + 1);

    const rows = await pool.query<{ qty: number }>(
      `SELECT qty FROM stock_events WHERE job_line_id = $1 AND type = 'receipt' ORDER BY ts DESC LIMIT 1`,
      [line.id],
    );
    expect(rows.rows[0]?.qty).toBe(5);
    expect(await receiptCount(line.id)).toBe(e0 + 1);
  });
});

describe("ambient tx client (query() on tx session)", () => {
  it("uncommitted rows visible to query(), invisible to pool; committed after", async () => {
    const id = randomUUID();
    const marker = `tx-bind-${id.slice(0, 6)}`;

    await withTransaction(async () => {
      await query(`INSERT INTO operational_audit (id, entity_type, action, request_id) VALUES ($1,'stage','stage',$2)`, [
        id,
        marker,
      ]);
      const inside = await query<{ request_id: string }>(`SELECT request_id FROM operational_audit WHERE id = $1`, [id]);
      expect(inside[0]?.request_id).toBe(marker);

      const outside = await pool.query(`SELECT request_id FROM operational_audit WHERE id = $1`, [id]);
      expect(outside.rows.length).toBe(0); // different session — uncommitted invisible
    });

    const committed = await pool.query<{ request_id: string }>(`SELECT request_id FROM operational_audit WHERE id = $1`, [id]);
    expect(committed.rows.length).toBe(1);
    expect(committed.rows[0]?.request_id).toBe(marker);
  });

  it("readiness + audit inside tx observe uncommitted state on the same session", async () => {
    const job = await newJob(admin.cookie, customerId);
    const line = job.lines[0];
    const rows = await query<{ readiness_cache: string | null }>(`SELECT readiness_cache FROM jobs WHERE id = $1`, [job.id]);
    const beforeCache = rows[0].readiness_cache;

    const audMarker = `tx-aud-${randomUUID().slice(0, 6)}`;

    let inTxColour: string | null = null;
    await withTransaction(async () => {
      await query(`UPDATE job_lines SET stock_issue = 'Short' WHERE id = $1`, [line.id]); // uncommitted
      await query(`UPDATE jobs SET readiness_cache = 'green' WHERE id = $1`, [job.id]); // uncommitted sentinel

      await updateReadinessCache(job.id); // must overwrite sentinel on THIS session
      const cache = await query<{ readiness_cache: string }>(`SELECT readiness_cache FROM jobs WHERE id = $1`, [job.id]);
      inTxColour = cache[0].readiness_cache;
      // fresh job can never compute green (stock gate active + failing) → sentinel gone
      expect(inTxColour).not.toBe("green");

      const expected = await computeReadiness(job.id);
      expect(inTxColour).toBe(expected!.colour);

      await audit({
        entityType: "stage",
        jobId: job.id,
        action: "stage",
        user: adminSession,
        requestId: audMarker,
      });
      const audIn = await query<{ id: string }>(`SELECT id FROM operational_audit WHERE request_id = $1`, [audMarker]);
      expect(audIn.length).toBe(1);

      // everything above still invisible outside the tx
      const poolCache = await pool.query<{ readiness_cache: string | null }>(`SELECT readiness_cache FROM jobs WHERE id = $1`, [job.id]);
      expect(poolCache.rows[0]?.readiness_cache).toBe(beforeCache);
      const poolAud = await pool.query(`SELECT id FROM operational_audit WHERE request_id = $1`, [audMarker]);
      expect(poolAud.rows.length).toBe(0);
    });

    const after = await query<{ readiness_cache: string | null }>(`SELECT readiness_cache FROM jobs WHERE id = $1`, [job.id]);
    expect(after[0].readiness_cache).toBe(inTxColour); // committed value = what the tx session computed
    expect(after[0].readiness_cache).not.toBe("green"); // sentinel overwritten and gone for good
    const poolAud = await pool.query(`SELECT id FROM operational_audit WHERE request_id = $1`, [audMarker]);
    expect(poolAud.rows.length).toBe(1);
  });

  it("[A4] helper called outside fn falls back to pool — no phantom reads on released client", async () => {
    const job = await newJob(admin.cookie, customerId);
    const rows = await withTransaction(async () => {
      await query(`UPDATE jobs SET notes = 'tx-note' WHERE id = $1`, [job.id]);
      return query<{ id: string }>(`SELECT id FROM jobs WHERE id = $1`, [job.id]);
    });
    expect(rows.length).toBe(1);

    // tx ended, client released — every later query must run on the pool, never the dead session
    const after = await query<{ notes: string | null }>(`SELECT notes FROM jobs WHERE id = $1`, [job.id]);
    expect(after[0].notes).toBe("tx-note");
    const again = await query<{ id: string }>(`SELECT id FROM jobs WHERE id = $1`, [job.id]);
    expect(again.length).toBe(1);
  });
});
