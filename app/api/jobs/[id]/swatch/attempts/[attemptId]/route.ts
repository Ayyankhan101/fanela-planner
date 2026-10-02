import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, err, toResponse } from "@/lib/http";
import { patchAttempt } from "@/lib/services/swatch";

type Params = { params: Promise<{ id: string; attemptId: string }> };

const bodySchema = z
  .object({
    status: z.enum(["in_progress", "awaiting", "approved", "rejected", "re_swatch"]).optional(),
    reason: z.string().max(2000).optional(),
    version: z.number().int().min(1),
    fields: z
      .object({
        sampleQty: z.number().int().min(1).optional(),
        embFileRef: z.string().max(256).optional(),
        threadColours: z.string().max(1000).optional(),
        stitchCount: z.number().int().min(0).optional(),
        placement: z.string().max(256).optional(),
        machine: z.string().max(128).optional(),
        notes: z.string().max(4000).optional(),
      })
      .optional(),
  })
  .strict();

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requirePermission("swatch.create", { req });
  if ("error" in auth) return auth.error;
  const { id, attemptId } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(422, parsed.error.issues[0]?.message ?? "Invalid attempt update.");
  try {
    const next = await patchAttempt(id, attemptId, parsed.data, auth.user);
    return NextResponse.json({ ok: true, version: next });
  } catch (e) {
    return toResponse(e);
  }
}
