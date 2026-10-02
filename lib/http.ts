import { NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";
import type { Permission, DepartmentKey } from "@/lib/permissions";
import { can, isAdminOrOps, type AuthError } from "@/lib/auth/access";

export function err(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

export type AuthOpts = { department?: DepartmentKey; req?: Request };

export async function requireUser(req?: Request): Promise<{ user: SessionUser } | { error: NextResponse }> {
  const user = await getSessionUser(req);
  if (!user) return { error: err(401, "Sign in required.") };
  return { user };
}

export async function requirePermission(
  perm: Permission,
  opts: AuthOpts = {},
): Promise<{ user: SessionUser } | { error: NextResponse }> {
  const auth = await requireUser(opts.req);
  if ("error" in auth) return auth;
  if (!can(auth.user, perm, { department: opts.department })) {
    return { error: err(403, "Not permitted.") };
  }
  return auth;
}

export async function requireAdminOrOps(
  req?: Request,
): Promise<{ user: SessionUser } | { error: NextResponse }> {
  const auth = await requireUser(req);
  if ("error" in auth) return auth;
  if (!isAdminOrOps(auth.user)) return { error: err(403, "Admin or Operations only.") };
  return auth;
}

export function toResponse(e: unknown): NextResponse {
  const a = e as AuthError;
  if (a && typeof a.status === "number") {
    const current = (a as { current?: unknown }).current;
    if (a.status === 409 && current !== undefined) {
      return NextResponse.json({ error: a.message, current }, { status: 409 });
    }
    return err(a.status, a.message);
  }
  console.error(e);
  return err(500, "Unexpected server error.");
}
