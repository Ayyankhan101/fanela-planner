import { pgTable, pgEnum, uuid, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { jobs } from "./jobs";
import { users } from "./identity";
import { files } from "./dispatch";

// append-only: app role gets INSERT + SELECT only (db/security/*.sql)
export const operationalAudit = pgTable(
  "operational_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    legacyId: text("legacy_id").unique(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    jobId: uuid("job_id").references(() => jobs.id),
    // v11 kinds: job-header|order-lines|stage|artwork|swatch|dispatch|stencil|customer-master
    action: text("action").notNull(),
    actorId: uuid("actor_id").references(() => users.id),
    actorRole: text("actor_role"),
    before: jsonb("before"),
    after: jsonb("after"),
    requestId: text("request_id"),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_job_ts").on(t.jobId, t.ts), index("audit_entity_ts").on(t.entityType, t.entityId, t.ts)],
);

export const importBatchStatus = pgEnum("import_batch_status", [
  "created",
  "parsed",
  "validated",
  "previewed",
  "confirmed",
  "executed",
  "failed",
  "aborted",
]);

export const importBatches = pgTable("import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(), // v11-json | excel
  fileId: uuid("file_id").references(() => files.id),
  status: importBatchStatus("status").notNull().default("created"),
  // [3A] CAS guard: confirm/execute update WHERE status=… AND version=$n → 0 rows = 409
  version: integer("version").notNull().default(1),
  // [A2] parsed rows + severities persisted at Parse — Preview/Resume/CSV read this, no re-parse
  parsed: jsonb("parsed"),
  created: integer("created").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  errors: jsonb("errors"),
  result: jsonb("result"),
  actor: uuid("actor").references(() => users.id),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
});

export const outboxStatus = pgEnum("outbox_status", ["pending", "sending", "sent", "failed"]);

export const integrationOutbox = pgTable(
  "integration_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(), // dpd|xero
    payload: jsonb("payload").notNull(),
    status: outboxStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    // backoff gate: claim only pending rows with next_retry_at <= now
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    // set on pending→sending claim; stuck claims (crash) reclaimed after 5 min
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("outbox_status_ts").on(t.status, t.ts)],
);
