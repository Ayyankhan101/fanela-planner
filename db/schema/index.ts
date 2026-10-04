import { relations } from "drizzle-orm";
import * as identity from "./identity";
import * as catalog from "./catalog";
import * as jobsSchema from "./jobs";
import * as stock from "./stock";
import * as work from "./work";
import * as dispatch from "./dispatch";
import * as audit from "./audit";

export * from "./identity";
export * from "./catalog";
export * from "./jobs";
export * from "./stock";
export * from "./work";
export * from "./dispatch";
export * from "./audit";
export * from "./notifications";

export const usersRelations = relations(identity.users, ({ many }) => ({
  roles: many(identity.userRoles),
  departments: many(identity.userDepartments),
}));

export const userRolesRelations = relations(identity.userRoles, ({ one }) => ({
  user: one(identity.users, { fields: [identity.userRoles.userId], references: [identity.users.id] }),
  role: one(identity.roles, { fields: [identity.userRoles.roleId], references: [identity.roles.id] }),
}));

export const userDepartmentsRelations = relations(identity.userDepartments, ({ one }) => ({
  user: one(identity.users, { fields: [identity.userDepartments.userId], references: [identity.users.id] }),
  department: one(identity.departments, {
    fields: [identity.userDepartments.departmentId],
    references: [identity.departments.id],
  }),
}));

export const jobsRelations = relations(jobsSchema.jobs, ({ one, many }) => ({
  customer: one(catalog.customers, { fields: [jobsSchema.jobs.customerId], references: [catalog.customers.id] }),
  contactSnapshot: one(jobsSchema.jobContactSnapshot, {
    fields: [jobsSchema.jobs.id],
    references: [jobsSchema.jobContactSnapshot.jobId],
  }),
  dispatchSnapshot: one(jobsSchema.jobDispatchSnapshot, {
    fields: [jobsSchema.jobs.id],
    references: [jobsSchema.jobDispatchSnapshot.jobId],
  }),
  lines: many(jobsSchema.jobLines),
  stages: many(jobsSchema.jobStages),
  positions: many(jobsSchema.printPositions),
  screen: one(jobsSchema.screenRecords, { fields: [jobsSchema.jobs.id], references: [jobsSchema.screenRecords.jobId] }),
  swatchRequirement: one(work.swatchRequirements, {
    fields: [jobsSchema.jobs.id],
    references: [work.swatchRequirements.jobId],
  }),
  swatchAttempts: many(work.swatchAttempts),
  artwork: one(work.artworks, { fields: [jobsSchema.jobs.id], references: [work.artworks.jobId] }),
  shipments: many(dispatch.shipments),
  stockEvents: many(stock.stockEvents),
  audit: many(audit.operationalAudit),
}));

export const jobLinesRelations = relations(jobsSchema.jobLines, ({ one, many }) => ({
  job: one(jobsSchema.jobs, { fields: [jobsSchema.jobLines.jobId], references: [jobsSchema.jobs.id] }),
  sizes: many(jobsSchema.jobLineSizes),
  productSku: one(catalog.productSkus, {
    fields: [jobsSchema.jobLines.productSkuId],
    references: [catalog.productSkus.id],
  }),
}));

export const jobLineSizesRelations = relations(jobsSchema.jobLineSizes, ({ one }) => ({
  line: one(jobsSchema.jobLines, { fields: [jobsSchema.jobLineSizes.jobLineId], references: [jobsSchema.jobLines.id] }),
}));

export const jobStagesRelations = relations(jobsSchema.jobStages, ({ one }) => ({
  job: one(jobsSchema.jobs, { fields: [jobsSchema.jobStages.jobId], references: [jobsSchema.jobs.id] }),
  department: one(identity.departments, {
    fields: [jobsSchema.jobStages.departmentId],
    references: [identity.departments.id],
  }),
}));

export const artworkRelations = relations(work.artworks, ({ one, many }) => ({
  job: one(jobsSchema.jobs, { fields: [work.artworks.jobId], references: [jobsSchema.jobs.id] }),
  versions: many(work.artworkVersions),
}));

export const artworkVersionRelations = relations(work.artworkVersions, ({ one, many }) => ({
  artwork: one(work.artworks, { fields: [work.artworkVersions.artworkId], references: [work.artworks.id] }),
  events: many(work.artworkEvents),
}));

export const swatchAttemptsRelations = relations(work.swatchAttempts, ({ one, many }) => ({
  job: one(jobsSchema.jobs, { fields: [work.swatchAttempts.jobId], references: [jobsSchema.jobs.id] }),
  events: many(work.swatchAttemptEvents),
}));

export const shipmentsRelations = relations(dispatch.shipments, ({ one, many }) => ({
  job: one(jobsSchema.jobs, { fields: [dispatch.shipments.jobId], references: [jobsSchema.jobs.id] }),
  events: many(dispatch.shipmentEvents),
}));

export const stockEventsRelations = relations(stock.stockEvents, ({ one }) => ({
  job: one(jobsSchema.jobs, { fields: [stock.stockEvents.jobId], references: [jobsSchema.jobs.id] }),
  line: one(jobsSchema.jobLines, { fields: [stock.stockEvents.jobLineId], references: [jobsSchema.jobLines.id] }),
}));

export const auditRelations = relations(audit.operationalAudit, ({ one }) => ({
  job: one(jobsSchema.jobs, { fields: [audit.operationalAudit.jobId], references: [jobsSchema.jobs.id] }),
}));
