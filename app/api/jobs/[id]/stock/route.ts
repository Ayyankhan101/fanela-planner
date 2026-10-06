import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, err, toResponse } from "@/lib/http";
import { stockOverview, patchStockLine } from "@/lib/services/stock";
import {
  MSG_INVALID_REQUEST,
  CODE_VALIDATION_ERROR,
  MSG_JOB_NOT_FOUND,
  CODE_JOB_NOT_FOUND,
  MSG_INVALID_RECEIPT_QTY,
  CODE_INVALID_RECEIPT_QTY,
} from "@/lib/errors";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const auth = await requirePermission("jobs.view", { req });
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const overview = await stockOverview(id);
  if (!overview) return err(404, MSG_JOB_NOT_FOUND, CODE_JOB_NOT_FOUND);
  return NextResponse.json({ stock: overview });
}

const STOCK_ISSUES = ["Short", "Backorder", "Picking Error", "Damaged / Incorrect Stock"] as const;

const patchSchema = z
  .object({
    lineId: z.string().uuid(),
    version: z.number().int().min(1),
    stockOrdered: z.boolean().optional(),
    stockConfirmed: z.boolean().optional(),
    stockIssue: z.enum(STOCK_ISSUES).nullable().optional(),
    receipt: z.object({ qty: z.number().int(), note: z.string().max(2000).optional() }).optional(),
    correction: z
      .object({
        correctsEventId: z.string().uuid(),
        qty: z.number().int(),
        reason: z.string().min(3).max(2000),
      })
      .optional(),
  })
  .strict();

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requirePermission("stock.edit", { req });
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(422, MSG_INVALID_REQUEST, CODE_VALIDATION_ERROR);
  const { lineId, version, ...input } = parsed.data;
  if (input.receipt && input.receipt.qty < 0) return err(422, MSG_INVALID_RECEIPT_QTY, CODE_INVALID_RECEIPT_QTY);
  try {
    const next = await patchStockLine(id, lineId, input, version, auth.user);
    const stock = await stockOverview(id);
    return NextResponse.json({ ok: true, version: next, stock });
  } catch (e) {
    return toResponse(e);
  }
}
