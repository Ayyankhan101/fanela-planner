import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, err, toResponse } from "@/lib/http";
import { createJob, listJobs } from "@/lib/services/jobs";
import { MSG_INVALID_REQUEST, CODE_VALIDATION_ERROR } from "@/lib/errors";

export async function GET(req: Request) {
  const auth = await requirePermission("jobs.view", { req });
  if ("error" in auth) return auth.error;
  const url = new URL(req.url);
  const jobs = await listJobs({
    q: url.searchParams.get("q") ?? undefined,
    includeArchived: url.searchParams.get("archived") === "1" && (auth.user.roles.includes("admin") || auth.user.roles.includes("ops")),
  });
  return NextResponse.json({ jobs });
}

// J2: structured size grid — fixed vocab, never free text (v11 uppercase, phase0/06).
// zod4 z.record(z.enum) is exhaustive — use strict object: unknown size keys rejected.
const sizeSchema = z
  .object({
    XS: z.number().int().min(0).optional(),
    S: z.number().int().min(0).optional(),
    M: z.number().int().min(0).optional(),
    L: z.number().int().min(0).optional(),
    XL: z.number().int().min(0).optional(),
    "2XL": z.number().int().min(0).optional(),
    "3XL": z.number().int().min(0).optional(),
    "4XL": z.number().int().min(0).optional(),
    "5XL": z.number().int().min(0).optional(),
  })
  .strict();

const lineSchema = z.object({
  skuText: z.string().min(1),
  supplierSku: z.string().max(128).optional(), // J3: separate field
  colour: z.string().optional(),
  qtyOrdered: z.number().int().min(0),
  sizes: sizeSchema.optional(),
});

const createSchema = z.object({
  jobNumber: z.string().min(1).max(64),
  customerId: z.string().uuid(),
  po: z.string().max(128).optional(),
  printName: z.string().max(256).optional(),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  orderType: z.enum(["bulk", "pod", "repeat", "sample"]).optional(),
  priority: z.number().int().min(1).max(999).optional(),
  priorityLevel: z.enum(["urgent", "high", "normal"]).optional(), // J8: named level → default number
  staff: z.string().max(128).optional(),
  processDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dispatchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dispatchTime: z.string().max(16).optional(),
  notes: z.string().max(4000).optional(),
  lines: z.array(lineSchema).min(1),
  positions: z.array(z.object({ name: z.string().min(1), pieces: z.number().int().min(0) })).optional(),
});

export async function POST(req: Request) {
  const auth = await requirePermission("jobs.edit", { req });
  if ("error" in auth) return auth.error;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(422, MSG_INVALID_REQUEST, CODE_VALIDATION_ERROR);
  try {
    const id = await createJob(parsed.data, auth.user);
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    return toResponse(e);
  }
}
