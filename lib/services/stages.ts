import { query, withTransaction } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/access";
import type { DepartmentKey } from "@/lib/permissions";
import { audit } from "./audit";
import { CODE_FORBIDDEN, CODE_JOB_NOT_FOUND, CODE_NOT_FOUND, CODE_STALE_JOB, CODE_VALIDATION_ERROR } from "@/lib/errors";

// Department work & stages (D1–D10). Invalid transition → 422; stale version → 409.

const TRANSITIONS: Record<string, string[]> = {
  waiting: ["ready", "in_progress", "blocked"],
  ready: ["waiting", "in_progress", "blocked"],
  in_progress: ["ready", "blocked", "completed"],
  blocked: ["waiting", "ready", "in_progress"],
  completed: ["in_progress"], // D8 reopen only
};

export type StagePatchInput = {
  status?: string;
  progress?: number;
  notes?: string | null;
  waste?: number;
  reprintQty?: number;
  processDate?: string | null;
};

type StageRow = {
  id: string;
  job_id: string;
  department_id: string;
  dept_key: string;
  status: string;
  qty: number;
  progress: number;
  version: number;
  finished_at: Date | null;
  completed_by: string | null;
};

async function loadStage(jobId: string, stageId: string): Promise<StageRow | null> {
  const rows = await query<StageRow>(
    `SELECT s.id, s.job_id, s.department_id, d.key AS dept_key, s.status, s.qty, s.progress, s.version, s.finished_at, s.completed_by
       FROM job_stages s JOIN departments d ON d.id = s.department_id
      WHERE s.id = $1 AND s.job_id = $2 FOR UPDATE OF s`,
    [stageId, jobId],
  );
  return rows[0] ?? null;
}

// S7: Embroidery production blocked until latest swatch attempt Approved
async function swatchPassed(jobId: string): Promise<boolean> {
  const req = await query<{ required: boolean }>(
    `SELECT required FROM swatch_requirements WHERE job_id = $1`,
    [jobId],
  );
  if (req[0]?.required !== true) return true;
  const latest = await query<{ status: string }>(
    `SELECT status FROM swatch_attempts WHERE job_id = $1 ORDER BY attempt_no DESC LIMIT 1`,
    [jobId],
  );
  return latest[0]?.status === "approved";
}

// J9 + job lifecycle: every stage Completed (incl. dispatch) → job completed; reopen → back
export async function refreshJobStatus(jobId: string): Promise<void> {
  const rows = await query<{ total: number; done: number; inprog: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'completed')::int AS done,
            count(*) FILTER (WHERE status = 'in_progress')::int AS inprog
       FROM job_stages WHERE job_id = $1`,
    [jobId],
  );
  const r = rows[0];
  const job = await query<{ status: string }>(`SELECT status FROM jobs WHERE id = $1`, [jobId]);
  const current = job[0]?.status;
  if (!current || current === "cancelled") return;
  if (r.total > 0 && r.done === r.total) {
    await query(`UPDATE jobs SET status = 'completed', updated_at = now() WHERE id = $1 AND status <> 'completed'`, [jobId]);
  } else if (current === "completed") {
    await query(`UPDATE jobs SET status = 'in_production', updated_at = now() WHERE id = $1`, [jobId]);
  } else if (current === "open" && r.inprog > 0) {
    await query(`UPDATE jobs SET status = 'in_production', updated_at = now() WHERE id = $1`, [jobId]);
  }
}

// [7A] atomic site — stage write + audit + job rollup (refreshJobStatus) run in one tx.
export function patchStage(
  jobId: string,
  stageId: string,
  input: StagePatchInput,
  version: number,
  user: SessionUser,
): Promise<number> {
  return withTransaction(() => patchStageTx(jobId, stageId, input, version, user));
}

async function patchStageTx(
  jobId: string,
  stageId: string,
  input: StagePatchInput,
  version: number,
  user: SessionUser,
): Promise<number> {
  const job = await query<{ status: string }>(`SELECT status FROM jobs WHERE id = $1 FOR UPDATE`, [jobId]);
  if (!job[0]) throw { status: 404, message: "Job not found.", code: CODE_JOB_NOT_FOUND };

  const s = await loadStage(jobId, stageId);
  if (!s) throw { status: 404, message: "Stage not found.", code: CODE_NOT_FOUND };

  // D3: operator own department only; Admin/Ops override
  if (!can(user, "stage.update", { department: s.dept_key as DepartmentKey })) {
    throw { status: 403, message: `Not permitted for department: ${s.dept_key}.`, code: CODE_FORBIDDEN };
  }
  if (Number(s.version) !== version) {
    const fresh = await query<Record<string, unknown>>(`SELECT * FROM job_stages WHERE id = $1`, [stageId]);
    throw { status: 409, message: "Stage changed since you loaded it. Reload and retry.", current: fresh[0], code: CODE_STALE_JOB };
  }

  const before = await query<Record<string, unknown>>(
    `SELECT * FROM job_stages WHERE id = $1`,
    [stageId],
  );

  const target = input.status ?? s.status;
  if (target !== s.status && !TRANSITIONS[s.status]?.includes(target)) {
    throw { status: 422, message: `Invalid stage transition: ${s.status} → ${target}.`, code: CODE_VALIDATION_ERROR };
  }
  if (job[0].status === "cancelled") {
    throw { status: 422, message: "Cancelled jobs cannot be worked on.", code: CODE_VALIDATION_ERROR };
  }
  if (job[0].status === "completed" && target !== s.status) {
    throw { status: 422, message: "Completed jobs cannot be reopened.", code: CODE_VALIDATION_ERROR };
  }

  // S7 gate: any Embroidery production move blocked until swatch approved
  if (s.dept_key === "embroidery") {
    const starts = target === "in_progress" && s.status !== "in_progress";
    const completes = target === "completed";
    const progresses = input.progress != null && input.progress > s.progress;
    if ((starts || completes || progresses) && !(await swatchPassed(jobId))) {
      throw {
        status: 422,
        message: "Embroidery production is blocked until the current swatch is approved.",
        code: CODE_VALIDATION_ERROR,
      };
    }
  }

  const reopening = s.status === "completed" && target === "in_progress"; // D8
  let progress = input.progress ?? s.progress;
  let status = target;
  let finishedAt: string | null = null;
  let completedBy: string | null = null;

  if (reopening) {
    progress = s.progress >= s.qty ? Math.max(0, s.qty - 1) : s.progress; // v11 reopenStage parity
    status = "in_progress";
  } else if (status === "completed" && s.status !== "completed") {
    progress = s.qty;
    finishedAt = new Date().toISOString();
    completedBy = user.id;
  } else if (status === "completed") {
    progress = s.qty; // already completed: keep finishedAt/completedBy (fields-only edit)
    finishedAt = s.finished_at ? new Date(s.finished_at).toISOString() : null;
    completedBy = s.completed_by;
  } else if (progress >= s.qty && s.qty > 0) {
    // D7 auto-complete: completed ≥ quantity
    status = "completed";
    finishedAt = new Date().toISOString();
    completedBy = user.id;
    progress = s.qty;
  } else if (status === "in_progress" && progress > 0 && s.status === "waiting") {
    status = "in_progress";
  }
  // D10/P5: dispatch stage completes only via finalise dispatch action
  // (checked against computed status so D7 progress auto-complete cannot bypass it)
  if (s.dept_key === "dispatch" && status === "completed" && s.status !== "completed") {
    throw {
      status: 422,
      message: "Dispatch stage closes only via explicit finalise dispatch action.",
      code: CODE_VALIDATION_ERROR,
    };
  }

  const p: unknown[] = [stageId, jobId, version];
  const set = (col: string, v: unknown) => {
    p.push(v);
    return `${col} = $${p.length}`;
  };
  const assignments = [
    set("status", status),
    set("progress", progress),
    set("remaining", Math.max(0, s.qty - progress)),
  ];
  if (input.notes !== undefined) assignments.push(set("notes", input.notes));
  if (input.waste !== undefined) assignments.push(set("waste", input.waste));
  if (input.reprintQty !== undefined) assignments.push(set("reprint_qty", input.reprintQty));
  if (input.processDate !== undefined) assignments.push(set("process_date", input.processDate));
  assignments.push(set("finished_at", finishedAt));
  assignments.push(set("completed_by", completedBy));

  const res = await query<{ version: number }>(
    `UPDATE job_stages SET ${assignments.join(", ")}, version = version + 1
      WHERE id = $1 AND job_id = $2 AND version = $3 RETURNING version`,
    p,
  );
  if (!res.length) {
    const fresh = await query<Record<string, unknown>>(`SELECT * FROM job_stages WHERE id = $1`, [stageId]);
    throw { status: 409, message: "Stage changed since you loaded it. Reload and retry.", current: fresh[0], code: CODE_STALE_JOB };
  }

  const after = await query<Record<string, unknown>>(`SELECT * FROM job_stages WHERE id = $1`, [stageId]);
  await audit({
    entityType: "stage",
    entityId: stageId,
    jobId,
    action: "stage",
    user,
    before: before[0],
    after: after[0],
  });
  await refreshJobStatus(jobId);
  return Number(res[0].version);
}
