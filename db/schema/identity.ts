import { pgTable, pgEnum, uuid, text, boolean, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export const roleKey = pgEnum("role_key", ["admin", "ops", "office", "director", "dispatch", "packing", "dept"]);

export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(), // print|dtg|dtf|embroidery|sewing|screens|warehouse|packing|dispatch
  name: text("name").notNull(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  totpSecret: text("totp_secret"),
  recoveryCodes: text("recovery_codes"), // JSON array of sha256 hashes, shown once (B3)
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: roleKey("key").notNull().unique(),
});

export const permissions = pgTable("permissions", {
  key: text("key").primaryKey(), // shared with UI catalogue
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key").notNull().references(() => permissions.key, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("role_permissions_pk").on(t.roleId, t.permissionKey)],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("user_roles_pk").on(t.userId, t.roleId)],
);

export const userDepartments = pgTable(
  "user_departments",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    departmentId: uuid("department_id").notNull().references(() => departments.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("user_departments_pk").on(t.userId, t.departmentId)],
);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ip: text("ip"),
  ua: text("ua"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email"),
    ip: text("ip"),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    success: boolean("success").notNull().default(false),
  },
  (t) => [index("login_attempts_email_ts").on(t.email, t.ts), index("login_attempts_ip_ts").on(t.ip, t.ts)],
);

// pending_mfa staging tokens (spec §10 two-step Auth.js flow) — never grant app access
export const pendingMfa = pgTable("pending_mfa", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  purpose: text("purpose").notNull().default("challenge"), // challenge | setup (B3 forced MFA)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
