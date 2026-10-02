import { pgTable, pgEnum, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { jobs, jobLines } from "./jobs";
import { users } from "./identity";

export const stockEventType = pgEnum("stock_event_type", [
  "receipt",
  "adjustment",
  "correction",
  "line_removed",
  "archived",
  "update",
]);

// append-only: app role gets INSERT + SELECT only (db/security/*.sql)
export const stockEvents = pgTable(
  "stock_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    legacyId: text("legacy_id").unique(),
    jobId: uuid("job_id").references(() => jobs.id),
    jobLineId: uuid("job_line_id").references(() => jobLines.id, { onDelete: "set null" }), // L5: line removed, history kept in payload
    type: stockEventType("type").notNull(),
    qty: integer("qty"),
    reason: text("reason"),
    // v11 free-form event record preserved for display parity with prototype
    payload: text("payload"),
    correctsEventId: uuid("corrects_event_id"),
    userId: uuid("user_id").references(() => users.id),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stock_events_job_ts").on(t.jobId, t.ts), index("stock_events_line_ts").on(t.jobLineId, t.ts)],
);
