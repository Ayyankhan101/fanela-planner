import { NextResponse } from "next/server";
import { requireAdminOrOps, err, toResponse } from "@/lib/http";
import { retryOutbox } from "@/lib/services/outbox";
import {
  MSG_INVALID_REQUEST,
  MSG_OUTBOX_NOT_FOUND,
  MSG_OUTBOX_RETRY_SENT,
  MSG_OUTBOX_RETRY_SENDING,
  CODE_INVALID_REQUEST,
  CODE_OUTBOX_NOT_FOUND,
  CODE_OUTBOX_RETRY_SENT,
  CODE_OUTBOX_RETRY_SENDING,
} from "@/lib/errors";

type Params = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/admin/outbox/[id]/retry — requeue a failed/stuck row immediately
export async function POST(req: Request, { params }: Params) {
  const auth = await requireAdminOrOps(req);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!UUID_RE.test(id)) return err(400, MSG_INVALID_REQUEST, CODE_INVALID_REQUEST);
  try {
    const outcome = await retryOutbox(id);
    switch (outcome) {
      case "retried":
        return NextResponse.json({ id, status: "pending" });
      case "not_found":
        return err(404, MSG_OUTBOX_NOT_FOUND, CODE_OUTBOX_NOT_FOUND);
      case "already_sent":
        return err(409, MSG_OUTBOX_RETRY_SENT, CODE_OUTBOX_RETRY_SENT);
      case "sending":
        return err(409, MSG_OUTBOX_RETRY_SENDING, CODE_OUTBOX_RETRY_SENDING);
    }
  } catch (e) {
    return toResponse(e);
  }
}
