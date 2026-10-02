import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminOrOps, err, toResponse } from "@/lib/http";
import { cancelJob } from "@/lib/services/jobs";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({ reason: z.string().min(3).max(2000) }).strict();

export async function POST(req: Request, { params }: Params) {
  const auth = await requireAdminOrOps(req);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(422, parsed.error.issues[0]?.message ?? "Cancellation requires a reason.");
  try {
    await cancelJob(id, parsed.data.reason, auth.user);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
}
