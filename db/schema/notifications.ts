import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./identity";
import { jobs } from "./jobs";

// In-app notifications (P5, zero-prereq slice): rows written inside the emitting
// transaction; recipients resolved at emit time (active users holding a role).
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // swatch_awaiting | artwork_awaiting | import_failed
    title: text("title").notNull(),
    body: text("body").notNull(),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_recipient_read_idx").on(t.recipientId, t.readAt),
    index("notifications_recipient_created_idx").on(t.recipientId, t.createdAt),
  ],
);
