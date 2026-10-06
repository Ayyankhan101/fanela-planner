// P5 emission groundwork: audit() + appendStockEvent() write frozen-envelope rows
// into integration_outbox (kind = event name) riding the ambient transaction.
// No senders registered → rows stay pending/attempts=0; dpd|xero routing later.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { query, withTransaction } from "@/lib/db";
import { makeUser, randomUUID } from "./helpers";
import { newCustomer, newJob } from "./fixtures";
import { audit } from "@/lib/services/audit";
import { appendStockEvent } from "@/lib/services/stock";
import {
  AUDIT_EVENT_NAMES,
  STOCK_EVENT_NAMES,
  domainEventSchema,
  type AuditEvent,
  type StockEvent,
} from "@/lib/events/domain-events";

let cookie: string;
let customerId: string;
const suffix = randomUUID().slice(0, 8);
const cleanupJobIds: string[] = [];

type OutboxRow = {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  payload: unknown;
};

async function outboxForJob(jobId: string): Promise<OutboxRow[]> {
  return query<OutboxRow>(
    `SELECT id, kind, status, attempts, payload FROM integration_outbox WHERE payload::text ILIKE '%' || $1 || '%'`,
    [jobId],
  );
}

beforeAll(async () => {
  const admin = await makeUser({ roles: ["admin"] });
  cookie = admin.cookie;
  customerId = await newCustomer(cookie, `EM Co ${suffix}`);
});

afterAll(async () => {
  const kinds = [...AUDIT_EVENT_NAMES, ...STOCK_EVENT_NAMES];
  const patterns = cleanupJobIds.map((id) => `%${id}%`);
  if (patterns.length === 0) return;
  await query(
    `DELETE FROM integration_outbox WHERE kind = ANY($1::text[]) AND payload::text ILIKE ANY($2::text[])`,
    [kinds, patterns],
  );
});

describe("domain-event emission (audit + stock → integration_outbox)", () => {
  it("audit() frozen action: envelope row pending, kind = event name, source matches audit row", async () => {
    const job = await newJob(cookie, customerId);
    cleanupJobIds.push(job.id);
    await audit({
      entityType: "stage",
      entityId: job.id,
      jobId: job.id,
      action: "stage",
      user: null,
      before: { status: "waiting" },
      after: { status: "in_progress" },
      requestId: "req-em-1",
    });

    const rows = await outboxForJob(job.id);
    const row = rows.find((r) => r.kind === "stage");
    expect(row).toBeDefined();
    expect(row!.status).toBe("pending");
    expect(row!.attempts).toBe(0);
    expect(domainEventSchema.safeParse(row!.payload).success).toBe(true);

    const p = row!.payload as AuditEvent & { event: "stage" };
    expect(p.event).toBe("stage");
    expect(p.schemaVersion).toBe(1);
    expect(p.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(p.source.jobId).toBe(job.id);
    expect(p.source.entityType).toBe("stage");
    expect(p.source.before).toEqual({ status: "waiting" });
    expect(p.source.after).toEqual({ status: "in_progress" });
    expect(p.source.requestId).toBe("req-em-1");
    expect(p.source.legacyId).toBeNull();

    const auditRows = await query<{ id: string; action: string }>(
      `SELECT id, action FROM operational_audit WHERE job_id = $1 AND action = 'stage'`,
      [job.id],
    );
    expect(auditRows.some((r) => r.id === p.source.id)).toBe(true);
  });

  it("audit() non-frozen action: audit row lands, no outbox row (probe rolled back)", async () => {
    const job = await newJob(cookie, customerId);
    cleanupJobIds.push(job.id);
    // FORCE RLS on operational_audit: no DELETE policy for the app role — probe
    // must never commit (freeze-guard asserts live actions ⊆ frozen list).
    await expect(
      withTransaction(async () => {
        await audit({
          entityType: "job",
          entityId: job.id,
          jobId: job.id,
          action: "not-a-frozen-action",
          after: { x: 1 },
        });
        const auditRows = await query<{ id: string }>(
          `SELECT id FROM operational_audit WHERE job_id = $1 AND action = 'not-a-frozen-action'`,
          [job.id],
        );
        expect(auditRows.length).toBe(1);
        const leaked = await query<{ id: string }>(
          `SELECT id FROM integration_outbox
            WHERE payload::text ILIKE '%' || $1 || '%'
              AND payload::jsonb->>'event' = 'not-a-frozen-action'`,
          [job.id],
        );
        expect(leaked).toEqual([]);
        throw new Error("rollback-probe");
      }),
    ).rejects.toThrow("rollback-probe");
  });

  it("appendStockEvent: stock.<type> envelope matches the stock_events row", async () => {
    const job = await newJob(cookie, customerId);
    cleanupJobIds.push(job.id);
    const eventId = await appendStockEvent({
      jobId: job.id,
      type: "receipt",
      qty: 3,
      reason: "emission test receipt",
      userId: null,
    });

    const rows = await outboxForJob(job.id);
    const row = rows.find((r) => r.kind === "stock.receipt");
    expect(row).toBeDefined();
    expect(row!.status).toBe("pending");
    expect(row!.attempts).toBe(0);
    expect(domainEventSchema.safeParse(row!.payload).success).toBe(true);

    const p = row!.payload as StockEvent & { event: "stock.receipt" };
    expect(p.event).toBe("stock.receipt");
    expect(p.schemaVersion).toBe(1);
    expect(p.source.id).toBe(eventId);
    expect(p.source.jobId).toBe(job.id);
    expect(p.source.type).toBe("receipt");
    expect(p.source.qty).toBe(3);
    expect(p.source.reason).toBe("emission test receipt");
    expect(p.source.legacyId).toBeNull();
  });

  it("ambient-tx rollback removes emitted rows with the business write", async () => {
    let jobId = "";
    await expect(
      withTransaction(async () => {
        const job = await newJob(cookie, customerId);
        jobId = job.id;
        cleanupJobIds.push(job.id);
        await audit({ entityType: "job", jobId: job.id, action: "job-header", after: { status: "open" } });
        await appendStockEvent({ jobId: job.id, type: "update", payload: { qty: 1 } });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    expect(jobId).not.toBe("");
    expect(await outboxForJob(jobId)).toEqual([]);
    expect(await query(`SELECT id FROM operational_audit WHERE job_id = $1`, [jobId])).toEqual([]);
    expect(await query(`SELECT id FROM stock_events WHERE job_id = $1`, [jobId])).toEqual([]);
  });
});
