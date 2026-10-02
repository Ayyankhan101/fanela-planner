import { NextResponse } from "next/server";
import { destroySession, SESSION_COOKIE } from "@/lib/auth/session";

export async function POST(req: Request) {
  const sid = await destroySession(req);
  const res = NextResponse.json({ ok: true });
  if (sid) res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
