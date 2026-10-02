import { pgTable, pgEnum, uuid, text, boolean, integer, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { jobs } from "./jobs";
import { users } from "./identity";

export const shipmentStatus = pgEnum("shipment_status", [
  "draft",
  "booking_arranged",
  "booked",
  "labels_attached",
  "print_requested",
  "labels_printed",
  "dispatched",
  "collected",
  "void",
]);

export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    name: text("name").notNull(),
    size: integer("size").notNull(),
    mime: text("mime"),
    checksum: text("checksum"),
    bucket: text("bucket").notNull(),
    key: text("key").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    immutable: boolean("immutable").notNull().default(false),
  },
  (t) => [index("files_entity_idx").on(t.entityType, t.entityId)],
);

export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    legacyId: text("legacy_id").unique(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    method: text("method").notNull(), // DPD|Collection|Other|manual
    status: shipmentStatus("status").notNull().default("draft"),
    parcels: integer("parcels"),
    consignment: text("consignment"),
    tracking: text("tracking"),
    bookedBy: uuid("booked_by").references(() => users.id),
    bookedAt: timestamp("booked_at", { withTimezone: true }),
    labelPrinted: boolean("label_printed").notNull().default(false),
    printRequests: integer("print_requests").notNull().default(0),
    reprints: integer("reprints").notNull().default(0),
    voided: boolean("voided").notNull().default(false),
    voidReason: text("void_reason"),
    finalAt: timestamp("final_at", { withTimezone: true }),
    finalizedBy: uuid("finalized_by").references(() => users.id),
    bookingFields: jsonb("booking_fields"), // method-specific extras
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("shipments_job_idx").on(t.jobId)],
);

export const shipmentEvents = pgTable(
  "shipment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    actor: uuid("actor").references(() => users.id),
    reason: text("reason"),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("shipment_events_shipment_ts").on(t.shipmentId, t.ts)],
);

export const shipmentAttachments = pgTable(
  "shipment_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    legacyId: text("legacy_id").unique(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id),
    kind: text("kind"), // label|proof
    confirmedPrinted: boolean("confirmed_printed"),
  },
  (t) => [uniqueIndex("shipment_attachments_unique").on(t.shipmentId, t.fileId)],
);
