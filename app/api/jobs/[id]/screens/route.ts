import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, err, toResponse } from "@/lib/http";
import { patchScreens } from "@/lib/services/readiness";
import { MSG_INVALID_REQUEST, CODE_VALIDATION_ERROR } from "@/lib/errors";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    required: z.number().int().min(0).nullable().optional(),
    made: z.number().int().min(0).nullable().optional(),
    confirmed: z.boolean().optional(),
    notRequired: z.boolean().optional(),
    notes: z.string().max(4000).optional(),
    version: z.number().int().min(1),
  })
  .strict();

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requirePermission("stage.update", { req, department: "screens" });
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(422, MSG_INVALID_REQUEST, CODE_VALIDATION_ERROR);
  const { version, ...input } = parsed.data;
  try {
    const next = await patchScreens(id, { ...input, version }, auth.user);
    return NextResponse.json({ ok: true, version: next });
  } catch (e) {
    return toResponse(e);
  }
}
