import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, err, toResponse } from "@/lib/http";
import { setSwatchRequirement } from "@/lib/services/swatch";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    required: z.boolean(),
    confirm: z.literal(true),
    reason: z.string().max(2000).optional(),
  })
  .strict();

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requirePermission("swatch.decide", { req });
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(422, parsed.error.issues[0]?.message ?? "Invalid requirement update.");
  try {
    await setSwatchRequirement(id, parsed.data.required, parsed.data.reason, auth.user);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
}
