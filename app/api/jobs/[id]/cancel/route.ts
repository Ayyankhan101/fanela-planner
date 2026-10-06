import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminOrOps, err, toResponse } from "@/lib/http";
import { cancelJob } from "@/lib/services/jobs";
import { MSG_INVALID_REQUEST, CODE_VALIDATION_ERROR } from "@/lib/errors";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({ reason: z.string().min(3).max(2000) }).strict();

export async function POST(req: Request, { params }: Params) {
  const auth = await requireAdminOrOps(req);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(422, MSG_INVALID_REQUEST, CODE_VALIDATION_ERROR);
  try {
    await cancelJob(id, parsed.data.reason, auth.user);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
}
