import { randomUUID } from "node:crypto";
import { query, withTransaction } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { can, isAdminOrOps } from "@/lib/auth/access";
import { audit } from "./audit";
import { updateReadinessCache } from "./readiness";
import { MSG_FORBIDDEN, CODE_FORBIDDEN } from "@/lib/errors";

// Swatch machine (S1–S10). Terminal attempts immutable (S6); latest decides gate (S9).

const FLOW: Record<string, string[]> = {
  draft: ["in_progress"],
  in_progress: ["awaiting"],
  awaiting: ["approved", "rejected", "re_swatch"],
  approved: [],
  rejected: [],
  re_swatch: [],
};
const TERMINAL = ["approved", "rejected", "re_swatch"];
const DECISIONS = ["approved", "rejected", "re_swatch"];

type AttemptRow = {
  id: string;
  job_id: string;
  attempt_no: number;
  status: string;
  version: number;
};

async function loadAttempt(jobId: string, attemptId: string): Promise<AttemptRow | null> {
  // Plain SELECT: RLS hides approved rows from FOR UPDATE locks, which would turn
  // the S6 immutability 422 into a 404. Write-path RLS (USING status <> 'approved')
  // plus the optimistic version check still guard the row.
  const rows = await query<AttemptRow>(
    `SELECT id, job_id, attempt_no, status, version FROM swatch_attempts WHERE id = $1 AND job_id = $2`,
    [attemptId, jobId],
  );
  return rows[0] ?? null;
}

// S2: requirement toggle — Admin/Ops only, always audited
export async function setSwatchRequirement(
  jobId: string,
  required: boolean,
  reason: string | undefined,
  user: SessionUser,
): Promise<void> {
  if (!isAdminOrOps(user)) throw { status: 403, message: "Swatch requirement changes require Admin or Operations." };
  if (!required && !reason?.trim()) throw { status: 422, message: "Removing the requirement needs a reason." };
  const before = await query(`SELECT * FROM swatch_requirements WHERE job_id = $1`, [jobId]);
  if (!before[0]) throw { status: 404, message: "Swatch requirement not found." };
  await query(
    `UPDATE swatch_requirements SET required = $1, waived_by = $2, waived_reason = $3, waived_at = $4 WHERE job_id = $5`,
    [required, required ? null : user.id, required ? null : reason ?? null, required ? null : new Date().toISOString(), jobId],
  );
  const after = await query(`SELECT * FROM swatch_requirements WHERE job_id = $1`, [jobId]);
  await audit({ entityType: "swatch", entityId: jobId, jobId, action: "swatch", user, before: before[0], after: after[0] });
  await updateReadinessCache(jobId);
}

export type AttemptInput = {
  sampleQty?: number;
  embFileRef?: string;
  threadColours?: string;
  stitchCount?: number;
  placement?: string;
  machine?: string;
  notes?: string;
};

// S4: new attempt only after terminal state (or none) — attempt_no++
export async function createAttempt(
  jobId: string,
  input: AttemptInput,
  user: SessionUser,
): Promise<{ id: string; version: number }> {
  if (!can(user, "swatch.create")) throw { status: 403, message: MSG_FORBIDDEN, code: CODE_FORBIDDEN };
  const latest = await query<{ attempt_no: number; status: string }>(
    `SELECT attempt_no, status FROM swatch_attempts WHERE job_id = $1 ORDER BY attempt_no DESC LIMIT 1`,
    [jobId],
  );
  if (latest[0] && !TERMINAL.includes(latest[0].status)) {
    throw { status: 422, message: "Finish the current attempt before starting a new one." };
  }
  if (latest[0]?.status === "approved") {
    throw { status: 422, message: "Swatch already approved. Re-open the requirement instead." };
  }
  const attemptNo = latest[0] ? latest[0].attempt_no + 1 : 1;
  const id = randomUUID();
  const ins = await query<{ id: string; version: number }>(
    `INSERT INTO swatch_attempts (id, job_id, attempt_no, status, sample_qty, emb_file_ref, thread_colours,
                                  stitch_count, placement, machine, notes, version)
     VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9,$10,1)
     RETURNING id, version`,
    [
      id,
      jobId,
      attemptNo,
      input.sampleQty ?? null,
      input.embFileRef ?? null,
      input.threadColours ?? null,
      input.stitchCount ?? null,
      input.placement ?? null,
      input.machine ?? null,
      input.notes ?? null,
    ],
  );
  await swatchEvent(id, "create", user, null);
  await audit({ entityType: "swatch", entityId: id, jobId, action: "swatch", user, after: { attemptNo, status: "draft" } });
  return { id: ins[0].id, version: Number(ins[0].version) };
}

async function swatchEvent(attemptId: string, action: string, user: SessionUser, reason: string | null): Promise<void> {
  await query(`INSERT INTO swatch_attempt_events (attempt_id, action, actor, reason) VALUES ($1,$2,$3,$4)`, [
    attemptId,
    action,
    user.id,
    reason,
  ]);
}

export type AttemptPatchInput = {
  status?: string;
  reason?: string;
  version: number;
  fields?: AttemptInput;
};

// [7A] atomic site — decision write + attempt event + audit + readiness run in one tx.
export function patchAttempt(
  jobId: string,
  attemptId: string,
  input: AttemptPatchInput,
  user: SessionUser,
): Promise<number> {
  return withTransaction(() => patchAttemptTx(jobId, attemptId, input, user));
}

async function patchAttemptTx(
  jobId: string,
  attemptId: string,
  input: AttemptPatchInput,
  user: SessionUser,
): Promise<number> {
  const a = await loadAttempt(jobId, attemptId);
  if (!a) throw { status: 404, message: "Swatch attempt not found." };

  // S6: completed attempts can never be changed
  if (TERMINAL.includes(a.status)) {
    throw { status: 422, message: "A completed swatch attempt cannot be changed. Create a new attempt." };
  }

  const isDecision = input.status != null && DECISIONS.includes(input.status);
  if (isDecision) {
    if (!can(user, "swatch.decide")) throw { status: 403, message: "Swatch decisions require Admin or Operations." };
  } else if (!can(user, "swatch.create", { department: "embroidery" })) {
    throw { status: 403, message: "Swatch attempts are maintained by Embroidery (Admin/Ops override)." };
  }

  if (Number(a.version) !== input.version) {
    const fresh = await query<Record<string, unknown>>(`SELECT * FROM swatch_attempts WHERE id = $1`, [attemptId]);
    throw { status: 409, message: "Swatch attempt changed since you loaded it. Reload and retry.", current: fresh[0] };
  }

  const target = input.status ?? a.status;
  if (target !== a.status && !FLOW[a.status]?.includes(target)) {
    throw { status: 422, message: `Invalid swatch transition: ${a.status} → ${target}.` };
  }
  if (DECISIONS.includes(target) && !input.reason?.trim()) {
    throw { status: 422, message: "A reason is required for reject / re-swatch decisions." };
  }

  const p: unknown[] = [attemptId, jobId, input.version];
  const set = (col: string, v: unknown) => {
    p.push(v);
    return `${col} = $${p.length}`;
  };
  const sets: string[] = [];
  const f = input.fields;
  if (f?.sampleQty !== undefined) sets.push(set("sample_qty", f.sampleQty));
  if (f?.embFileRef !== undefined) sets.push(set("emb_file_ref", f.embFileRef));
  if (f?.threadColours !== undefined) sets.push(set("thread_colours", f.threadColours));
  if (f?.stitchCount !== undefined) sets.push(set("stitch_count", f.stitchCount));
  if (f?.placement !== undefined) sets.push(set("placement", f.placement));
  if (f?.machine !== undefined) sets.push(set("machine", f.machine));
  if (f?.notes !== undefined) sets.push(set("notes", f.notes));

  if (target !== a.status) {
    sets.push(set("status", target));
    if (target === "in_progress") {
      sets.push(set("started_by", user.id));
      sets.push(set("started_at", new Date().toISOString()));
    }
    if (target === "awaiting") {
      sets.push(set("completed_by", user.id));
      sets.push(set("completed_at", new Date().toISOString()));
    }
    if (DECISIONS.includes(target)) {
      sets.push(set("decided_by", user.id));
      sets.push(set("decided_at", new Date().toISOString()));
      sets.push(set("reason", input.reason ?? null));
    }
  }
  if (!sets.length) return Number(a.version); // nothing to change — version already matched
  sets.push("version = version + 1");

  const before = await query(`SELECT * FROM swatch_attempts WHERE id = $1`, [attemptId]);
  const res = await query<{ version: number }>(
    `UPDATE swatch_attempts SET ${sets.join(", ")} WHERE id = $1 AND job_id = $2 AND version = $3 RETURNING version`,
    p,
  );
  if (!res.length) {
    const fresh = await query<Record<string, unknown>>(`SELECT * FROM swatch_attempts WHERE id = $1`, [attemptId]);
    throw { status: 409, message: "Swatch attempt changed since you loaded it. Reload and retry.", current: fresh[0] };
  }
  const after = await query(`SELECT * FROM swatch_attempts WHERE id = $1`, [attemptId]);

  if (target !== a.status) await swatchEvent(attemptId, target, user, input.reason ?? null);
  await audit({ entityType: "swatch", entityId: attemptId, jobId, action: "swatch", user, before: before[0], after: after[0] });
  await updateReadinessCache(jobId); // G7: decision changes colour
  return Number(res[0].version);
}
