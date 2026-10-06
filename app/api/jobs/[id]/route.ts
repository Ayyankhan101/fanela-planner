import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission, err, toResponse } from "@/lib/http";
import { getJob, patchJob } from "@/lib/services/jobs";
import { MSG_INVALID_REQUEST, CODE_VALIDATION_ERROR, MSG_JOB_NOT_FOUND, CODE_JOB_NOT_FOUND } from "@/lib/errors";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const auth = await requirePermission("jobs.view", { req });
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const job = await getJob(id, auth.user);
  if (!job) return err(404, MSG_JOB_NOT_FOUND, CODE_JOB_NOT_FOUND);
  return NextResponse.json({ job });
}

const patchSchema = z
  .object({
    po: z.string().max(128).nullable().optional(),
    printName: z.string().max(256).nullable().optional(),
    orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    orderType: z.enum(["bulk", "pod", "repeat", "sample"]).optional(),
    priority: z.number().int().min(1).max(999).nullable().optional(),
    staff: z.string().max(128).nullable().optional(),
    processDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    dispatchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    dispatchTime: z.string().max(16).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
    archived: z.boolean().optional(),
    version: z.number().int().min(1),
  })
  .strict();

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requirePermission("jobs.edit", { req });
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(422, MSG_INVALID_REQUEST, CODE_VALIDATION_ERROR);
  const { version, ...input } = parsed.data;
  try {
    await patchJob(id, input, version, auth.user);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
}
