import { NextResponse } from "next/server";
import { requireUser, err, toResponse } from "@/lib/http";
import { markNotificationsRead } from "@/lib/services/notifications";
import { MSG_INVALID_REQUEST, CODE_INVALID_REQUEST } from "@/lib/errors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/notifications/read — body { id? }: mark one, or all own unread.
// Idempotent + owner-scoped: unknown/foreign ids update 0 rows → 200.
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    if ("error" in auth) return auth.error;
    const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
    const id = body?.id;
    if (id !== undefined && (typeof id !== "string" || !UUID_RE.test(id))) {
      return err(400, MSG_INVALID_REQUEST, CODE_INVALID_REQUEST);
    }
    const updated = await markNotificationsRead(auth.user, id as string | undefined);
    return NextResponse.json({ updated });
  } catch (e) {
    return toResponse(e);
  }
}
