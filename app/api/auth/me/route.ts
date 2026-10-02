import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { ROLE_PERMISSIONS, type RoleKey } from "@/lib/permissions";

export async function GET(req: Request) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  const permissions = [...new Set(user.roles.flatMap((r) => ROLE_PERMISSIONS[r as RoleKey] ?? []))];
  return NextResponse.json({ user: { ...user, permissions } });
}
