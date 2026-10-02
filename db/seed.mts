// Seed: 9 departments, 7 roles, permission catalogue, role→permission map, admin user.
// Idempotent (upserts). Run: npm run db:seed
import "dotenv/config";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import {
  departments, permissions, roles, rolePermissions, users, userRoles,
} from "../db/schema/index";
import { ROLE_PERMISSIONS, PERMISSIONS, DEPARTMENTS, type RoleKey } from "../lib/permissions";
import { hashPassword } from "../lib/auth/password";
import { generateRecoveryCodes } from "../lib/auth/recovery";

// Dev TOTP secret (B3: admin is a mandatory-MFA role — must enrol before first login)
const DEV_TOTP_SECRET = "JBSWY3DPEHPK3PXP";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function main() {
  // departments
  for (const d of DEPARTMENTS) {
    await db
      .insert(departments)
      .values({ key: d.key, name: d.name })
      .onConflictDoUpdate({ target: departments.key, set: { name: d.name } });
  }

  // permissions catalogue
  for (const key of PERMISSIONS) {
    await db.insert(permissions).values({ key }).onConflictDoNothing();
  }

  // roles + role_permissions
  for (const [key, perms] of Object.entries(ROLE_PERMISSIONS) as [RoleKey, string[]][]) {
    const [role] = await db
      .insert(roles)
      .values({ key })
      .onConflictDoUpdate({ target: roles.key, set: { key } })
      .returning({ id: roles.id });
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
    if (perms.length) {
      await db.insert(rolePermissions).values(perms.map((p) => ({ roleId: role.id, permissionKey: p })));
    }
  }

  // admin user (password from env or dev default)
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@fanela.local";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
  const hash = await hashPassword(adminPassword);
  const [admin] = await db
    .insert(users)
    .values({ email: adminEmail, name: "Admin", passwordHash: hash, totpSecret: DEV_TOTP_SECRET })
    .onConflictDoUpdate({ target: users.email, set: { passwordHash: hash } })
    .returning({ id: users.id, totpSecret: users.totpSecret, recoveryCodes: users.recoveryCodes });
  let recoveryPrint: string[] | null = null;
  if (!admin.totpSecret || !admin.recoveryCodes) {
    const { codes, stored } = generateRecoveryCodes();
    await db
      .update(users)
      .set({ totpSecret: DEV_TOTP_SECRET, recoveryCodes: stored })
      .where(eq(users.id, admin.id));
    recoveryPrint = codes;
  }
  const [adminRole] = await db.select().from(roles).where(eq(roles.key, "admin"));
  await db
    .insert(userRoles)
    .values({ userId: admin.id, roleId: adminRole.id })
    .onConflictDoNothing();

  const counts = await db
    .select({
      departments: sql<number>`(SELECT count(*) FROM departments)`,
      roles: sql<number>`(SELECT count(*) FROM roles)`,
      permissions: sql<number>`(SELECT count(*) FROM permissions)`,
      rolePermissions: sql<number>`(SELECT count(*) FROM role_permissions)`,
      users: sql<number>`(SELECT count(*) FROM users)`,
    })
    .from(roles);
  console.log("seeded:", counts[0], `\nadmin: ${adminEmail} / ${adminPassword}`);
  console.log(`admin TOTP secret (dev): ${DEV_TOTP_SECRET}`);
  if (recoveryPrint) console.log(`admin recovery codes (shown once): ${recoveryPrint.join(" ")}`);
}

main()
  .finally(() => pool.end());
