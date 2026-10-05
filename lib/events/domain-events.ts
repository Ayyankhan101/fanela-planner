// Domain-event contract — FROZEN v1 (docs/phase0/09-domain-events.md, phase0 X2).
// 14 events: 8 operational_audit kinds + 6 stock.* types. Change process lives
// in the contract doc: additive changes keep SCHEMA_VERSION, breaking changes
// bump it (or introduce a versioned event name). tests/domain-events.test.ts
// fails on any silent drift — edit doc + registry + snapshot in one commit.
import { z } from "zod";

export const SCHEMA_VERSION = 1;

// operational_audit.action values (L2 kind list) — the 8 audit event names.
export const AUDIT_EVENT_NAMES = [
  "job-header",
  "order-lines",
  "stage",
  "artwork",
  "swatch",
  "dispatch",
  "stencil",
  "customer-master",
] as const;

// stock_event_type enum values (migration 0000) — event names are `stock.<type>`.
export const STOCK_EVENT_TYPES = [
  "receipt",
  "adjustment",
  "correction",
  "line_removed",
  "archived",
  "update",
] as const;

export const STOCK_EVENT_NAMES = [
  "stock.receipt",
  "stock.adjustment",
  "stock.correction",
  "stock.line_removed",
  "stock.archived",
  "stock.update",
] as const;

export const DOMAIN_EVENT_NAMES = [...AUDIT_EVENT_NAMES, ...STOCK_EVENT_NAMES] as const;

export type AuditEventName = (typeof AUDIT_EVENT_NAMES)[number];
export type StockEventType = (typeof STOCK_EVENT_TYPES)[number];
export type StockEventName = (typeof STOCK_EVENT_NAMES)[number];
export type DomainEventName = (typeof DOMAIN_EVENT_NAMES)[number];

// UTC ISO-8601 (Z or numeric offset) — timestamptz rows serialized to JSON.
const occurredAtSchema = z.iso.datetime({ offset: true });

// operational_audit row projection; before/after are jsonb (JSON value).
export const auditSourceSchema = z.object({
  id: z.uuid(),
  legacyId: z.string().nullable(),
  entityType: z.string().min(1),
  entityId: z.uuid().nullable(),
  jobId: z.uuid().nullable(),
  actorId: z.uuid().nullable(),
  actorRole: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
  requestId: z.string().nullable(),
});

// stock_events row projection; payload is a text column holding JSON.
export const stockSourceSchema = z.object({
  id: z.uuid(),
  legacyId: z.string().nullable(),
  jobId: z.uuid().nullable(),
  jobLineId: z.uuid().nullable(),
  type: z.enum(STOCK_EVENT_TYPES),
  qty: z.number().int().nullable(),
  reason: z.string().nullable(),
  payload: z.string().nullable(),
  correctsEventId: z.uuid().nullable(),
  userId: z.uuid().nullable(),
});

export const auditEventSchema = z.object({
  event: z.enum(AUDIT_EVENT_NAMES),
  schemaVersion: z.literal(SCHEMA_VERSION),
  occurredAt: occurredAtSchema,
  source: auditSourceSchema,
});

export const stockEventSchema = z.object({
  event: z.enum(STOCK_EVENT_NAMES),
  schemaVersion: z.literal(SCHEMA_VERSION),
  occurredAt: occurredAtSchema,
  source: stockSourceSchema,
});

export const domainEventSchema = z.union([auditEventSchema, stockEventSchema]);

export type AuditEvent = z.infer<typeof auditEventSchema>;
export type StockEvent = z.infer<typeof stockEventSchema>;
export type DomainEvent = z.infer<typeof domainEventSchema>;
