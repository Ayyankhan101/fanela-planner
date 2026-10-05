import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";

// Append-only operational audit (spec §4.11 / L2). App DB role = INSERT+SELECT only.
export async function audit(input: {
  entityType: string;
  entityId?: string | null;
  jobId?: string | null;
  action: string;
  user?: SessionUser | null;
  before?: unknown;
  after?: unknown;
  requestId?: string;
}): Promise<void> {
  await query(
    `INSERT INTO operational_audit (id, entity_type, entity_id, job_id, action, actor_id, actor_role, before, after, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      randomUUID(),
      input.entityType,
      input.entityId ?? null,
      input.jobId ?? null,
      input.action,
      input.user?.id ?? null,
      input.user?.roles.join(",") ?? null,
      input.before != null ? JSON.stringify(input.before) : null,
      input.after != null ? JSON.stringify(input.after) : null,
      input.requestId ?? null,
    ],
  );
}

// L2–L5: append-only read with scoping — dept users see own-department events only;
// order-lines (cost-bearing) rows only for cost viewers (L3/E7).
export async function listAudit(
  opts: { jobId?: string; entityType?: string; limit?: number },
  user: SessionUser,
): Promise<Record<string, unknown>[]> {
  const isCostViewer = user.roles.some((r) => ["admin", "ops", "director"].includes(r));
  const isDeptOnly = user.roles.length === 1 && user.roles[0] === "dept";
  const rows = await query<Record<string, unknown>>(
    `SELECT e.id, e.entity_type, e.entity_id, e.job_id, e.action, e.actor_id, e.actor_role,
            e.before, e.after,
            to_char(e.ts, 'YYYY-MM-DD"T"HH24:MI:SSZ') AS ts,
            CASE e.entity_type
              WHEN 'stage' THEN (SELECT d.key FROM job_stages s JOIN departments d ON d.id = s.department_id WHERE s.id = e.entity_id)
              WHEN 'screens' THEN 'screens'
              WHEN 'swatch' THEN 'embroidery'
              WHEN 'shipment' THEN 'dispatch'
              ELSE NULL
            END AS dept_key
       FROM operational_audit e
      WHERE ($1::text IS NULL
            OR lower(e.job_id::text) LIKE lower($1) || '%'
            OR EXISTS (SELECT 1 FROM jobs j WHERE j.id = e.job_id AND j.job_number = $1))
        AND ($2::text IS NULL OR e.entity_type = $2)
        AND ($3::bool OR e.action <> 'order-lines')
      ORDER BY e.ts DESC
      LIMIT $4`,
    [opts.jobId ?? null, opts.entityType ?? null, isCostViewer, Math.min(opts.limit ?? 200, 500)],
  );
  if (!isDeptOnly) return rows;
  const mine = new Set(user.departments);
  return rows.filter((r) => r.dept_key != null && mine.has(r.dept_key as string));
}
