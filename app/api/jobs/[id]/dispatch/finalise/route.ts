import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, err, toResponse } from "@/lib/http";
import { finaliseDispatch } from "@/lib/services/dispatch";
import { MSG_INVALID_REQUEST, CODE_VALIDATION_ERROR } from "@/lib/errors";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    abandon: z.boolean().optional(),
    reason: z.string().max(2000).optional(),
  })
  .strict();

export async function POST(req: Request, { params }: Params) {
  const auth = await requirePermission("dispatch.edit", { req });
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return err(422, MSG_INVALID_REQUEST, CODE_VALIDATION_ERROR);
  try {
    await finaliseDispatch(id, parsed.data, auth.user);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
}
