import { pgTable, pgEnum, uuid, text, integer, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { jobs } from "./jobs";
import { users } from "./identity";
import { files } from "./dispatch";

export const artworkStatus = pgEnum("artwork_status", ["draft", "awaiting", "approved", "rejected"]);
export const swatchStatus = pgEnum("swatch_status", [
  "draft", // v11 "Waiting"
  "in_progress",
  "awaiting", // v11 "Awaiting Approval"
  "approved", // immutable — RLS blocks UPDATE (spec §9)
  "rejected",
  "re_swatch",
]);

export const artworks = pgTable("artworks", {
  id: uuid("id").primaryKey().defaultRandom(),
  legacyId: text("legacy_id").unique(),
  jobId: uuid("job_id")
    .notNull()
    .unique()
    .references(() => jobs.id, { onDelete: "cascade" }),
  kind: text("kind"),
  currentVersionId: uuid("current_version_id"),
});

export const artworkVersions = pgTable(
  "artwork_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artworkId: uuid("artwork_id")
      .notNull()
      .references(() => artworks.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    proofRef: text("proof_ref"),
    status: artworkStatus("status").notNull().default("draft"),
    pantoneNotes: text("pantone_notes"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("artwork_versions_unique").on(t.artworkId, t.version)],
);

export const artworkAssets = pgTable("artwork_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  artworkVersionId: uuid("artwork_version_id")
    .notNull()
    .references(() => artworkVersions.id, { onDelete: "cascade" }),
  fileId: uuid("file_id")
    .notNull()
    .references(() => files.id),
});

export const artworkEvents = pgTable(
  "artwork_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artworkVersionId: uuid("artwork_version_id").references(() => artworkVersions.id),
    action: text("action").notNull(),
    actor: uuid("actor").references(() => users.id),
    reason: text("reason"),
    before: text("before"),
    after: text("after"),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("artwork_events_version_ts").on(t.artworkVersionId, t.ts)],
);

export const swatchRequirements = pgTable("swatch_requirements", {
  jobId: uuid("job_id")
    .primaryKey()
    .references(() => jobs.id, { onDelete: "cascade" }),
  required: boolean("required").notNull().default(false),
  waivedBy: uuid("waived_by").references(() => users.id),
  waivedReason: text("waived_reason"),
  waivedAt: timestamp("waived_at", { withTimezone: true }),
});

export const swatchAttempts = pgTable(
  "swatch_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    legacyId: text("legacy_id").unique(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    attemptNo: integer("attempt_no").notNull(),
    status: swatchStatus("status").notNull().default("draft"),
    sampleQty: integer("sample_qty"),
    embFileRef: text("emb_file_ref"),
    threadColours: text("thread_colours"),
    stitchCount: integer("stitch_count"),
    placement: text("placement"),
    machine: text("machine"),
    notes: text("notes"),
    startedBy: uuid("started_by").references(() => users.id),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    reason: text("reason"),
    version: integer("version").notNull().default(1), // spec §9 per-sub-entity optimistic lock
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("swatch_attempts_job_no").on(t.jobId, t.attemptNo)],
);

export const swatchAttemptEvents = pgTable(
  "swatch_attempt_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => swatchAttempts.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    actor: uuid("actor").references(() => users.id),
    reason: text("reason"),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("swatch_attempt_events_attempt_ts").on(t.attemptId, t.ts)],
);

export const swatchAssets = pgTable("swatch_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  attemptId: uuid("attempt_id")
    .notNull()
    .references(() => swatchAttempts.id, { onDelete: "cascade" }),
  fileId: uuid("file_id")
    .notNull()
    .references(() => files.id),
});
