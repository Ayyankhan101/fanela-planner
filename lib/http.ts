import { NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";
import type { Permission, DepartmentKey } from "@/lib/permissions";
import { can, isAdminOrOps, type AuthError } from "@/lib/auth/access";
import {
  MSG_UNAUTHENTICATED,
  MSG_FORBIDDEN,
  MSG_FORBIDDEN_ADMIN_OPS,
  MSG_INTERNAL_ERROR,
  CODE_UNAUTHENTICATED,
  CODE_FORBIDDEN,
  CODE_FORBIDDEN_ADMIN_OPS,
  CODE_INTERNAL_ERROR,
  type ErrorCode,
} from "@/lib/errors";

export function err(status: number, message: string, code?: ErrorCode) {
  return NextResponse.json({ error: message, code: code ?? CODE_INTERNAL_ERROR }, { status });
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

export type AuthOpts = { department?: DepartmentKey; req?: Request };

export async function requireUser(req?: Request): Promise<{ user: SessionUser } | { error: NextResponse }> {
  const user = await getSessionUser(req);
  if (!user) return { error: err(401, MSG_UNAUTHENTICATED, CODE_UNAUTHENTICATED) };
  return { user };
}

export async function requirePermission(
  perm: Permission,
  opts: AuthOpts = {},
): Promise<{ user: SessionUser } | { error: NextResponse }> {
  const auth = await requireUser(opts.req);
  if ("error" in auth) return auth;
  if (!can(auth.user, perm, { department: opts.department })) {
    return { error: err(403, MSG_FORBIDDEN, CODE_FORBIDDEN) };
  }
  return auth;
}

export async function requireAdminOrOps(
  req?: Request,
): Promise<{ user: SessionUser } | { error: NextResponse }> {
  const auth = await requireUser(req);
  if ("error" in auth) return auth;
  if (!isAdminOrOps(auth.user)) return { error: err(403, MSG_FORBIDDEN_ADMIN_OPS, CODE_FORBIDDEN_ADMIN_OPS) };
  return auth;
}

export function toResponse(e: unknown): NextResponse {
  const a = e as AuthError;
  if (a && typeof a.status === "number") {
    const current = (a as { current?: unknown }).current;
    if (a.status === 409 && current !== undefined) {
      return NextResponse.json(
        { error: a.message, current, code: a.code ?? CODE_INTERNAL_ERROR },
        { status: 409 },
      );
    }
    return err(a.status, a.message, a.code);
  }
  console.error(e);
  if (process.env.NODE_ENV === "development" && e instanceof Error && e.message) {
    return NextResponse.json({ error: e.message, code: CODE_INTERNAL_ERROR }, { status: 500 });
  }
  return err(500, MSG_INTERNAL_ERROR, CODE_INTERNAL_ERROR);
}
