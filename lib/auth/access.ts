import type { SessionUser } from "@/lib/auth/session";
import { ROLE_PERMISSIONS, DEPARTMENT_SCOPED, type Permission, type RoleKey, type DepartmentKey } from "@/lib/permissions";

export type AuthError = { status: 401 | 403 | 409 | 422; message: string };

// Does user hold permission at all (any role union)?
export function hasPermission(user: SessionUser, perm: Permission): boolean {
  return user.roles.some((r) => ROLE_PERMISSIONS[r as RoleKey]?.includes(perm));
}

// Permission + department scope: dept role requires assignment (phase0/04 Y* rows).
export function can(
  user: SessionUser,
  perm: Permission,
  opts: { department?: DepartmentKey } = {},
): boolean {
  if (!hasPermission(user, perm)) return false;
  const scoped = DEPARTMENT_SCOPED[perm];
  if (!scoped) return true;
  const isDeptOnly = user.roles.length === 1 && user.roles[0] === "dept";
  if (!isDeptOnly) return true; // Admin/Ops hold scoped perms unscoped
  // dept role must hold an assignment within the permission's scope
  if (!user.departments.some((d) => (scoped as string[]).includes(d))) return false;
  // resource-level check when caller passes the department owning the entity
  if (opts.department) return user.departments.includes(opts.department);
  return true;
}

export function isAdminOrOps(user: SessionUser): boolean {
  return user.roles.includes("admin") || user.roles.includes("ops");
}

export function require401(user: SessionUser | null): AuthError | null {
  return user ? null : { status: 401, message: "Sign in required." };
}
