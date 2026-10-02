import { NextResponse } from "next/server";
import { requirePermission, toResponse } from "@/lib/http";
import { removeJobLine } from "@/lib/services/stock";

type Params = { params: Promise<{ id: string; lineId: string }> };

// L5: removing a line writes stock-history first; history survives record removal.
export async function DELETE(req: Request, { params }: Params) {
  const auth = await requirePermission("jobs.edit", { req });
  if ("error" in auth) return auth.error;
  const { id, lineId } = await params;
  try {
    await removeJobLine(id, lineId, auth.user);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
}
