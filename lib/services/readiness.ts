import { query } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { audit } from "./audit";
import { CODE_NOT_FOUND, CODE_STALE_JOB, CODE_VALIDATION_ERROR } from "@/lib/errors";

// Readiness traffic light — server-computed only (G1), never client-settable.
export type GateState = { active: boolean; pass: boolean };
export type ReadinessResult = {
  colour: "white" | "amber" | "green";
  gates: { stock: GateState; screens: GateState; swatch: GateState };
  activeGates: number;
  passedGates: number;
};

export const STOCK_ISSUES = ["Short", "Backorder", "Picking Error", "Damaged / Incorrect Stock"] as const;

export async function computeReadiness(jobId: string): Promise<ReadinessResult | null> {
  const job = await query<{ id: string }>(`SELECT id FROM jobs WHERE id = $1`, [jobId]);
  if (!job[0]) return null;

  const lines = await query<{ qty_ordered: number; stock_confirmed: boolean; stock_issue: string | null; received: string }>(
    `SELECT l.qty_ordered, l.stock_confirmed, l.stock_issue,
            coalesce((SELECT sum(e.qty) FROM stock_events e WHERE e.job_line_id = l.id), 0)::text AS received
       FROM job_lines l WHERE l.job_id = $1`,
    [jobId],
  );

  // G5: every line — ordered qty confirmed, received >= ordered, stockConfirmed, no open issues
  const stockActive = lines.length > 0;
  const stockPass =
    stockActive &&
    lines.every(
      (l) =>
        l.qty_ordered > 0 &&
        Number(l.received) >= l.qty_ordered &&
        l.stock_confirmed &&
        l.stock_issue == null,
    );
  const openIssues = lines.filter((l) => l.stock_issue != null).length;

  // G4/G8: blank required (NULL) = not specified = active + failing; explicit notRequired = inactive
  const screenRows = await query<{ required: number | null; made: number | null; confirmed: boolean; not_required: boolean }>(
    `SELECT required, made, confirmed, not_required FROM screen_records WHERE job_id = $1`,
    [jobId],
  );
  const screen = screenRows[0];
  const screensActive = !screen || !screen.not_required;
  const screensPass =
    !screensActive ||
    (screen != null &&
      screen.required != null &&
      screen.required > 0 &&
      (screen.made ?? 0) === screen.required &&
      screen.confirmed);

  // S10/G7: required default on; only latest attempt Approved passes
  const swatchRows = await query<{ required: boolean }>(
    `SELECT r.required FROM swatch_requirements r WHERE r.job_id = $1`,
    [jobId],
  );
  const swatchRequired = swatchRows[0]?.required === true;
  const latest = await query<{ status: string }>(
    `SELECT status FROM swatch_attempts WHERE job_id = $1 ORDER BY attempt_no DESC LIMIT 1`,
    [jobId],
  );
  const swatchActive = swatchRequired;
  const swatchPass = !swatchRequired || latest[0]?.status === "approved";

  const gates = {
    stock: { active: stockActive, pass: stockPass },
    screens: { active: screensActive, pass: screensPass },
    swatch: { active: swatchActive, pass: swatchPass },
  };
  const active = Object.values(gates).filter((g) => g.active);
  const activeGates = active.length;
  const passedGates = active.filter((g) => g.pass).length;

  // G2 zero active → White; G3 all → Green, some → Amber, none → White;
  // G6 open issues force ≥ Amber; G7 swatch fail forces Amber (v11 wrapper parity)
  let colour: "white" | "amber" | "green";
  if (activeGates === 0) colour = "white";
  else if (passedGates === activeGates) colour = "green";
  else if (passedGates > 0 || openIssues > 0 || (swatchActive && !swatchPass)) colour = "amber";
  else colour = "white";
  // G7 floor: swatch required and not approved → never Green
  if (swatchActive && !swatchPass && colour === "green") colour = "amber";

  return { colour, gates, activeGates, passedGates };
}

// G1: cache updated server-side after every relevant change (stock/screens/swatch/line).
export async function updateReadinessCache(jobId: string): Promise<ReadinessResult | null> {
  const r = await computeReadiness(jobId);
  if (!r) return null;
  await query(`UPDATE jobs SET readiness_cache = $1 WHERE id = $2`, [r.colour, jobId]);
  return r;
}

// Screens record (03 §9): gate, not a workflow. Validation per v11 L534; audit kind 'stencil' (L2).
export type ScreensPatchInput = {
  version: number;
  required?: number | null;
  made?: number | null;
  confirmed?: boolean;
  notRequired?: boolean;
  notes?: string;
};

export async function patchScreens(jobId: string, input: ScreensPatchInput, user: SessionUser): Promise<number> {
  const lock = await query<{ version: number }>(
    `SELECT version FROM screen_records WHERE job_id = $1 FOR UPDATE`,
    [jobId],
  );
  if (!lock[0]) throw { status: 404, message: "Screen record not found.", code: CODE_NOT_FOUND };
  if (Number(lock[0].version) !== input.version) {
    throw { status: 409, message: "Screen record changed since you loaded it. Reload and retry.", code: CODE_STALE_JOB };
  }

  const cur = await query<Record<string, unknown>>(`SELECT * FROM screen_records WHERE job_id = $1`, [jobId]);
  const required = input.required !== undefined ? input.required : (cur[0].required as number | null);
  const made = input.made !== undefined ? input.made : (cur[0].made as number | null);
  const notRequired = input.notRequired !== undefined ? input.notRequired : (cur[0].not_required as boolean);
  let confirmed = input.confirmed !== undefined ? input.confirmed : (cur[0].confirmed as boolean);

  const structureChanged =
    (input.required !== undefined && input.required !== cur[0].required) ||
    (input.made !== undefined && input.made !== cur[0].made) ||
    (input.notRequired !== undefined && input.notRequired !== cur[0].not_required);
  if (structureChanged && input.confirmed === undefined) confirmed = false; // v11: edits uncheck confirm

  if (!notRequired) {
    if (required != null && made != null && made > required) {
      throw { status: 422, message: "Screen counts must match before confirming all screens.", code: CODE_VALIDATION_ERROR };
    }
    if (confirmed && !(required != null && required > 0 && made === required)) {
      throw { status: 422, message: "Screen counts must match before confirming all screens.", code: CODE_VALIDATION_ERROR };
    }
  }

  const res = await query<{ version: number }>(
    `UPDATE screen_records SET required = $1, made = $2, confirmed = $3, not_required = $4, notes = $5,
                                version = version + 1
      WHERE job_id = $6 AND version = $7 RETURNING version`,
    [
      required,
      made,
      confirmed,
      notRequired,
      input.notes !== undefined ? input.notes : (cur[0].notes as string | null),
      jobId,
      input.version,
    ],
  );
  if (!res.length) throw { status: 409, message: "Screen record changed since you loaded it. Reload and retry.", code: CODE_STALE_JOB };

  const after = await query(`SELECT * FROM screen_records WHERE job_id = $1`, [jobId]);
  await audit({
    entityType: "screens",
    entityId: jobId,
    jobId,
    action: "stencil", // L2 kind list
    user,
    before: cur[0],
    after: after[0],
  });
  await updateReadinessCache(jobId);
  return Number(res[0].version);
}
