// Domain-event freeze (docs/phase0/09-domain-events.md, phase0 X2): registry
// drift fails here. Any edit must be a conscious contract change — doc +
// registry + snapshot + version bump in one commit (contract §6).
import { describe, it, expect } from "vitest";
import { query } from "@/lib/db";
import {
  SCHEMA_VERSION,
  AUDIT_EVENT_NAMES,
  STOCK_EVENT_TYPES,
  STOCK_EVENT_NAMES,
  DOMAIN_EVENT_NAMES,
  auditEventSchema,
  stockEventSchema,
  domainEventSchema,
  type DomainEventName,
} from "@/lib/events/domain-events";

const JOB_ID = "0190f0c1-0000-7000-8000-000000000002";

function sampleEvent(name: DomainEventName) {
  const base = { schemaVersion: SCHEMA_VERSION, occurredAt: "2026-10-05T12:00:00.000Z" };
  if ((AUDIT_EVENT_NAMES as readonly string[]).includes(name)) {
    return {
      ...base,
      event: name,
      source: {
        id: "0190f0c1-0000-7000-8000-000000000001",
        legacyId: null,
        entityType: "jobs",
        entityId: JOB_ID,
        jobId: JOB_ID,
        actorId: null,
        actorRole: null,
        before: null,
        after: { status: "planning" },
        requestId: null,
      },
    };
  }
  return {
    ...base,
    event: name,
    source: {
      id: "0190f0c1-0000-7000-8000-000000000003",
      legacyId: null,
      jobId: JOB_ID,
      jobLineId: null,
      type: name.slice("stock.".length),
      qty: 12,
      reason: null,
      payload: '{"received":12}',
      correctsEventId: null,
      userId: null,
    },
  };
}

describe("domain events — frozen contract v1 (09 / X2)", () => {
  it("event list + schema version are frozen", () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect([...DOMAIN_EVENT_NAMES]).toMatchInlineSnapshot(`
      [
        "job-header",
        "order-lines",
        "stage",
        "artwork",
        "swatch",
        "dispatch",
        "stencil",
        "customer-master",
        "stock.receipt",
        "stock.adjustment",
        "stock.correction",
        "stock.line_removed",
        "stock.archived",
        "stock.update",
      ]
    `);
  });

  it("every event parses round-trip under the union schema", () => {
    expect(DOMAIN_EVENT_NAMES).toHaveLength(14);
    for (const name of DOMAIN_EVENT_NAMES) {
      const parsed = domainEventSchema.parse(sampleEvent(name));
      expect(parsed.event).toBe(name);
      expect(parsed.schemaVersion).toBe(1);
    }
  });

  it("family schemas reject cross-family payloads", () => {
    expect(auditEventSchema.safeParse(sampleEvent("stock.receipt")).success).toBe(false);
    expect(stockEventSchema.safeParse(sampleEvent("job-header")).success).toBe(false);
    expect(stockEventSchema.safeParse(sampleEvent("stock.line_removed")).success).toBe(true);
  });

  it("live PG stock_event_type enum matches registry (order + values)", async () => {
    const rows = await query<{ v: string }>(
      `SELECT unnest(enum_range(NULL::stock_event_type))::text AS v`,
    );
    expect(rows.map((r) => r.v)).toEqual([...STOCK_EVENT_TYPES]);
  });

  it("live PG operational_audit actions are a subset of frozen audit kinds", async () => {
    const rows = await query<{ action: string }>(`SELECT DISTINCT action FROM operational_audit`);
    const known = new Set<string>(AUDIT_EVENT_NAMES);
    expect(rows.map((r) => r.action).filter((a) => !known.has(a))).toEqual([]);
  });

  it("stock event names are exactly stock.<type> for every enum type", () => {
    expect([...STOCK_EVENT_NAMES]).toEqual(STOCK_EVENT_TYPES.map((t) => `stock.${t}`));
  });
});
