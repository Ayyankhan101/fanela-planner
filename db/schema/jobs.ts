import {
  pgTable, pgEnum, uuid, text, integer, boolean, date, timestamp, jsonb,
  uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { departments, users } from "./identity";
import { customers, productSkus } from "./catalog";

export const jobStatus = pgEnum("job_status", ["open", "in_production", "part_dispatched", "completed", "cancelled"]);
export const orderType = pgEnum("order_type", ["bulk", "pod", "repeat", "sample"]);
export const readiness = pgEnum("readiness", ["white", "amber", "green"]);
export const stageStatus = pgEnum("stage_status", ["waiting", "ready", "in_progress", "blocked", "completed"]);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    legacyId: text("legacy_id").unique(),
    jobNumber: text("job_number").notNull().unique(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    po: text("po"),
    printName: text("print_name"),
    orderDate: date("order_date"),
    orderType: orderType("order_type"),
    priority: integer("priority").notNull().default(50),
    staff: text("staff"),
    processDate: date("process_date"),
    dispatchDate: date("dispatch_date"),
    dispatchTime: text("dispatch_time"),
    status: jobStatus("status").notNull().default("open"),
    readinessCache: readiness("readiness_cache"), // derived only — server recomputes (spec §4.7)
    archived: boolean("archived").notNull().default(false), // no hard delete (finding F4)
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("jobs_customer_idx").on(t.customerId),
    index("jobs_queue_idx").on(t.dispatchDate, t.priority, t.processDate),
    index("jobs_status_idx").on(t.status),
  ],
);

export const jobContactSnapshot = pgTable("job_contact_snapshot", {
  jobId: uuid("job_id")
    .primaryKey()
    .references(() => jobs.id, { onDelete: "cascade" }),
  name: text("name"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
});

export const jobDispatchSnapshot = pgTable("job_dispatch_snapshot", {
  jobId: uuid("job_id")
    .primaryKey()
    .references(() => jobs.id, { onDelete: "cascade" }),
  method: text("method"),
  address: text("address"),
  instructions: text("instructions"),
});

export const jobLines = pgTable(
  "job_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    legacyId: text("legacy_id").unique(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    productSkuId: uuid("product_sku_id").references(() => productSkus.id),
    skuText: text("sku_text"), // denormalised display copy (master sku)
    supplierSku: text("supplier_sku"), // J3: separate field, never merged with master SKU
    colour: text("colour"),
    qtyOrdered: integer("qty_ordered").notNull().default(0),
    unitPrice: text("unit_price"), // money as numeric-string (GBP only, no calc)
    tax: text("tax"),
    buyingCost: text("buying_cost"),
    stockStatus: text("stock_status"), // derived cache: Not Ordered… (03 §8)
    stockOrdered: boolean("stock_ordered").notNull().default(false), // G5 ordered confirmed
    stockConfirmed: boolean("stock_confirmed").notNull().default(false), // G5 physical count confirmed
    stockIssue: text("stock_issue"), // Short|Backorder|Picking Error|Damaged / Incorrect Stock (03 §8)
    version: integer("version").notNull().default(1),
  },
  (t) => [index("job_lines_job_idx").on(t.jobId), index("job_lines_sku_text_idx").on(t.skuText)],
);

export const jobLineSizes = pgTable(
  "job_line_sizes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobLineId: uuid("job_line_id")
      .notNull()
      .references(() => jobLines.id, { onDelete: "cascade" }),
    size: text("size").notNull(), // XS|S|M|L|XL|2XL|3XL|4XL|5XL (uppercase = v11 vocab, phase0/06)
    qty: integer("qty").notNull().default(0),
  },
  (t) => [uniqueIndex("job_line_sizes_pk").on(t.jobLineId, t.size)],
);

export const jobStages = pgTable(
  "job_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    legacyId: text("legacy_id").unique(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id),
    status: stageStatus("status").notNull().default("waiting"),
    processDate: date("process_date"),
    qty: integer("qty").notNull().default(0),
    progress: integer("progress").notNull().default(0),
    remaining: integer("remaining").notNull().default(0),
    notes: text("notes"),
    waste: integer("waste").notNull().default(0),
    reprintQty: integer("reprint_qty").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    completedBy: uuid("completed_by"),
    version: integer("version").notNull().default(1),
  },
  (t) => [uniqueIndex("job_stages_job_dept").on(t.jobId, t.departmentId), index("job_stages_job_idx").on(t.jobId)],
);

export const printPositions = pgTable(
  "print_positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    legacyId: text("legacy_id").unique(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    pieces: integer("pieces").notNull().default(0),
  },
  (t) => [index("print_positions_job_idx").on(t.jobId)],
);

// required int NULL = blank = not-yet-specified (rule G4) — never coerce NULL→0
export const screenRecords = pgTable("screen_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id")
    .notNull()
    .unique()
    .references(() => jobs.id, { onDelete: "cascade" }),
  required: integer("required"), // NULL allowed
  made: integer("made"),
  confirmed: boolean("confirmed").notNull().default(false),
  notRequired: boolean("not_required").notNull().default(false),
  positions: jsonb("positions"),
  notes: text("notes"),
  version: integer("version").notNull().default(1),
});
