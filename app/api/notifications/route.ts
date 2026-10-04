import { NextResponse } from "next/server";
import { requireUser, toResponse } from "@/lib/http";
import { listNotifications } from "@/lib/services/notifications";

// GET /api/notifications — own rows + unread badge count (ownership = recipient_id)
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    if ("error" in auth) return auth.error;
    const url = new URL(req.url);
    const data = await listNotifications(auth.user, {
      unreadOnly: url.searchParams.get("unread") === "true",
      limit: Number(url.searchParams.get("limit") ?? "20") || 20,
    });
    return NextResponse.json(data);
  } catch (e) {
    return toResponse(e);
  }
}
