import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, err, toResponse } from "@/lib/http";
import { createShipment, DISPATCH_METHODS } from "@/lib/services/dispatch";
import { MSG_INVALID_REQUEST, CODE_VALIDATION_ERROR } from "@/lib/errors";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    method: z.enum(DISPATCH_METHODS),
    parcels: z.number().int().min(0).optional(),
    consignment: z.string().max(128).optional(),
    tracking: z.string().max(128).optional(),
  })
  .strict();

export async function POST(req: Request, { params }: Params) {
  const auth = await requirePermission("dispatch.edit", { req });
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(422, MSG_INVALID_REQUEST, CODE_VALIDATION_ERROR);
  try {
    const created = await createShipment(id, parsed.data, auth.user);
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return toResponse(e);
  }
}
