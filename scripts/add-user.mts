// Add a team member (no user-admin API exists yet — this is the provisioning path).
// Usage:
//   npm run user:add -- <email> <role> [name] [temp-password]
// Roles: admin ops office director dispatch packing dept
// Password is generated + printed when omitted.
//
// No TOTP secret is pre-set: mandatory-MFA roles (admin/ops/dispatch) enrol
// on first login via the MFA setup flow; the rest get a session directly.
import "dotenv/config";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { users, userRoles, roles } from "../db/schema/index";
import { ROLE_PERMISSIONS, type RoleKey } from "../lib/permissions";
import { hashPassword } from "../lib/auth/password";

const [email, role, name, passwordArg] = process.argv.slice(2);

if (!email || !role) {
  console.error("usage: npm run user:add -- <email> <role> [name] [temp-password]");
  console.error(`roles: ${Object.keys(ROLE_PERMISSIONS).join(" ")}`);
  process.exit(1);
}
if (!(role in ROLE_PERMISSIONS)) {
  console.error(`unknown role "${role}" — roles: ${Object.keys(ROLE_PERMISSIONS).join(" ")}`);
  process.exit(1);
}
if (!email.includes("@")) {
  console.error(`"${email}" is not an email`);
  process.exit(1);
}

const roleKey = role as RoleKey;
const password = passwordArg ?? randomBytes(9).toString("base64url");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function main() {
  const hash = await hashPassword(password);
  const [user] = await db
    .insert(users)
    .values({ email, name: name ?? email.split("@")[0], passwordHash: hash, active: true })
    .onConflictDoUpdate({ target: users.email, set: { passwordHash: hash, active: true } })
    .returning({ id: users.id });

  const [roleRow] = await db.select().from(roles).where(eq(roles.key, roleKey));
  if (!roleRow) {
    console.error(`role "${role}" missing in DB — run: npm run db:seed`);
    process.exit(1);
  }
  await db
    .insert(userRoles)
    .values({ userId: user.id, roleId: roleRow.id })
    .onConflictDoNothing();

  console.log(`created ${email} (role: ${role})`);
  console.log(`password: ${password}`);
  if (["admin", "ops", "dispatch"].includes(role)) {
    console.log("MFA mandatory for this role — they enrol a TOTP app on first login.");
  }
}

main()
  .then(() => pool.end())
  .catch(async (e) => {
    console.error(e);
    await pool.end();
    process.exit(1);
  });
