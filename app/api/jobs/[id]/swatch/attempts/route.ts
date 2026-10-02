import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, err, toResponse } from "@/lib/http";
import { createAttempt } from "@/lib/services/swatch";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    sampleQty: z.number().int().min(1).optional(),
    embFileRef: z.string().max(256).optional(),
    threadColours: z.string().max(1000).optional(),
    stitchCount: z.number().int().min(0).optional(),
    placement: z.string().max(256).optional(),
    machine: z.string().max(128).optional(),
    notes: z.string().max(4000).optional(),
  })
  .strict();

export async function POST(req: Request, { params }: Params) {
  const auth = await requirePermission("swatch.create", { req });
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return err(422, parsed.error.issues[0]?.message ?? "Invalid attempt.");
  try {
    const created = await createAttempt(id, parsed.data, auth.user);
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return toResponse(e);
  }
}
