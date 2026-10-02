import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, err, toResponse } from "@/lib/http";
import { patchShipment, DISPATCH_METHODS } from "@/lib/services/dispatch";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    version: z.number().int().min(1),
    status: z.enum(["booking_arranged", "booked", "labels_attached", "print_requested", "labels_printed", "dispatched", "collected", "void"]).optional(),
    method: z.enum(DISPATCH_METHODS).optional(),
    parcels: z.number().int().min(0).optional(),
    consignment: z.string().max(128).optional(),
    tracking: z.string().max(128).optional(),
    confirmCollection: z.boolean().optional(),
    reason: z.string().max(2000).optional(),
  })
  .strict();

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requirePermission("dispatch.edit", { req });
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(422, parsed.error.issues[0]?.message ?? "Invalid shipment update.");
  try {
    const next = await patchShipment(id, parsed.data, auth.user);
    return NextResponse.json({ ok: true, version: next });
  } catch (e) {
    return toResponse(e);
  }
}
