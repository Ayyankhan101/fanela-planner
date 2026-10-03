import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, err, toResponse } from "@/lib/http";
import { MSG_FORBIDDEN, CODE_FORBIDDEN } from "@/lib/errors";
import { query } from "@/lib/db";
import { hasPermission } from "@/lib/auth/access";
import { audit } from "@/lib/services/audit";

type Params = { params: Promise<{ id: string }> };

// P1: Office sets planned method/address (jobs.plan_dispatch); Dispatch/Admin/Ops edit (dispatch.edit)
const bodySchema = z
  .object({
    method: z.string().max(64).nullable().optional(),
    address: z.string().max(1000).nullable().optional(),
    instructions: z.string().max(4000).nullable().optional(),
    version: z.number().int().min(1),
  })
  .strict();

export async function PATCH(req: Request, { params }: Params) {
  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  if (!hasPermission(auth.user, "jobs.plan_dispatch") && !hasPermission(auth.user, "dispatch.edit")) {
    return err(403, MSG_FORBIDDEN, CODE_FORBIDDEN);
  }
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(422, parsed.error.issues[0]?.message ?? "Invalid dispatch plan update.");
  const { version, ...input } = parsed.data;

  try {
    const before = await query(`SELECT * FROM job_dispatch_snapshot WHERE job_id = $1 FOR UPDATE`, [id]);
    if (!before[0]) return err(404, "Dispatch plan not found.");
    const job = await query<{ version: number }>(`SELECT version FROM jobs WHERE id = $1`, [id]);
    if (!job[0]) return err(404, "Job not found.");
    if (Number(job[0].version) !== version) {
      return err(409, "Job changed since you loaded it. Reload and retry.");
    }
    const p: unknown[] = [id];
    const sets: string[] = [];
    if (input.method !== undefined) {
      p.push(input.method);
      sets.push(`method = $${p.length}`);
    }
    if (input.address !== undefined) {
      p.push(input.address);
      sets.push(`address = $${p.length}`);
    }
    if (input.instructions !== undefined) {
      p.push(input.instructions);
      sets.push(`instructions = $${p.length}`);
    }
    if (sets.length) {
      await query(`UPDATE job_dispatch_snapshot SET ${sets.join(", ")} WHERE job_id = $1`, p);
      await query(`UPDATE jobs SET version = version + 1, updated_at = now() WHERE id = $1`, [id]);
      const after = await query(`SELECT * FROM job_dispatch_snapshot WHERE job_id = $1`, [id]);
      await audit({ entityType: "job", entityId: id, jobId: id, action: "dispatch", user: auth.user, before: before[0], after: after[0] });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
}
