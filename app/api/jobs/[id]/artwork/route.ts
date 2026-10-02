import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, err, toResponse } from "@/lib/http";
import { getArtwork, patchArtwork } from "@/lib/services/artwork";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const auth = await requirePermission("jobs.view", { req });
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const artwork = await getArtwork(id, auth.user);
  if (!artwork) return err(404, "Job not found.");
  return NextResponse.json({ artwork });
}

const patchSchema = z
  .object({
    action: z.enum(["submit", "withdraw", "approve", "reject", "revise"]).optional(),
    reason: z.string().max(2000).optional(),
    proofRef: z.string().max(256).optional(),
    pantoneNotes: z.string().max(4000).optional(),
    version: z.number().int().min(1),
  })
  .strict();

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requirePermission("artwork.approve", { req });
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(422, parsed.error.issues[0]?.message ?? "Invalid artwork update.");
  try {
    const next = await patchArtwork(id, parsed.data, auth.user);
    return NextResponse.json({ ok: true, version: next });
  } catch (e) {
    return toResponse(e);
  }
}
