import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, err, toResponse } from "@/lib/http";
import { patchStage } from "@/lib/services/stages";

type Params = { params: Promise<{ id: string; stageId: string }> };

const patchSchema = z
  .object({
    status: z.enum(["waiting", "ready", "in_progress", "blocked", "completed"]).optional(),
    progress: z.number().int().min(0).optional(),
    notes: z.string().max(4000).nullable().optional(),
    waste: z.number().int().min(0).optional(),
    reprintQty: z.number().int().min(0).optional(),
    processDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    version: z.number().int().min(1),
  })
  .strict();

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requirePermission("stage.update", { req });
  if ("error" in auth) return auth.error;
  const { id, stageId } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(422, parsed.error.issues[0]?.message ?? "Invalid stage update.");
  const { version, ...input } = parsed.data;
  try {
    const next = await patchStage(id, stageId, input, version, auth.user);
    return NextResponse.json({ ok: true, version: next });
  } catch (e) {
    return toResponse(e);
  }
}
