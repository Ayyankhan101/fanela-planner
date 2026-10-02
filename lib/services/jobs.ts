import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { audit } from "./audit";
import { appendStockEvent, stockOverview } from "./stock";
import { computeReadiness, updateReadinessCache } from "./readiness";

export type CreateJobInput = {
  jobNumber: string;
  customerId: string;
  po?: string;
  printName?: string;
  orderDate?: string;
  orderType?: "bulk" | "pod" | "repeat" | "sample";
  priority?: number;
  priorityLevel?: "urgent" | "high" | "normal"; // J8
  staff?: string;
  processDate?: string;
  dispatchDate?: string;
  dispatchTime?: string;
  notes?: string;
  lines: { skuText: string; supplierSku?: string; colour?: string; qtyOrdered: number; sizes?: Record<string, number> }[];
  positions?: { name: string; pieces: number }[];
};

const DEPT_KEYS = ["print", "dtg", "dtf", "embroidery", "sewing", "screens", "warehouse", "packing", "dispatch"];

// J8: explicit priority number wins; else named level map; else Normal default
export function normalisePriority(priority?: number, level?: "urgent" | "high" | "normal"): number {
  if (priority != null) return priority;
  if (level === "urgent") return 10;
  if (level === "high") return 30;
  return 50;
}

export async function createJob(input: CreateJobInput, user: SessionUser): Promise<string> {
  const dup = await query<{ n: string }>(`SELECT count(*)::int AS n FROM jobs WHERE job_number = $1`, [input.jobNumber]);
  if (Number(dup[0].n) > 0) throw { status: 409, message: "Job number already exists." };

  const cust = await query<{ id: string; name: string; contact_name: string | null; email: string | null; phone: string | null; default_dispatch_address: string | null; default_dispatch_method: string | null }>(
    `SELECT id, name, contact_name, email, phone, default_dispatch_address, default_dispatch_method
       FROM customers WHERE id = $1 AND active = true`,
    [input.customerId],
  );
  if (!cust[0]) throw { status: 422, message: "Customer not found." };
  if (!input.lines.length) throw { status: 422, message: "At least one product line required." };

  const jobId = randomUUID();
  try {
    await query(
      `INSERT INTO jobs (id, job_number, customer_id, po, print_name, order_date, order_type, priority,
                         staff, process_date, dispatch_date, dispatch_time, notes, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'open')`,
      [
        jobId, input.jobNumber.trim(), input.customerId, input.po ?? null, input.printName ?? null,
        input.orderDate ?? null, input.orderType ?? null, normalisePriority(input.priority, input.priorityLevel),
        input.staff ?? null, input.processDate ?? null, input.dispatchDate ?? null,
        input.dispatchTime ?? null, input.notes ?? null, user.id,
      ],
    );
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw { status: 409, message: "Job number already exists." };
    throw e;
  }

  // frozen snapshots at entry (rules C2/C3) — copy of master at this moment, never live-linked
  const c = cust[0];
  await query(
    `INSERT INTO job_contact_snapshot (job_id, name, email, phone, address) VALUES ($1,$2,$3,$4,$5)`,
    [jobId, c.contact_name ?? c.name, c.email, c.phone, null],
  );
  await query(
    `INSERT INTO job_dispatch_snapshot (job_id, method, address, instructions) VALUES ($1,$2,$3,$4)`,
    [jobId, c.default_dispatch_method, c.default_dispatch_address, null],
  );

  // lines + size grid (J2)
  let lineCount = 0;
  for (const l of input.lines) {
    if (!l.skuText.trim()) continue;
    const lineId = randomUUID();
    await query(
      `INSERT INTO job_lines (id, job_id, sku_text, supplier_sku, colour, qty_ordered, stock_status)
       VALUES ($1,$2,$3,$4,$5,$6,'Not Ordered')`,
      [lineId, jobId, l.skuText.trim(), l.supplierSku?.trim() || null, l.colour ?? null, l.qtyOrdered],
    );
    for (const [size, qty] of Object.entries(l.sizes ?? {})) {
      if (Number.isFinite(qty)) {
        await query(`INSERT INTO job_line_sizes (job_line_id, size, qty) VALUES ($1,$2,$3)`, [lineId, size, Number(qty)]);
      }
    }
    lineCount++;
  }
  if (!lineCount) throw { status: 422, message: "At least one line needs an SKU." };

  for (const p of input.positions ?? []) {
    if (p.name.trim()) {
      await query(`INSERT INTO print_positions (id, job_id, name, pieces) VALUES ($1,$2,$3,$4)`, [
        randomUUID(), jobId, p.name.trim(), p.pieces,
      ]);
    }
  }

  // one stage per required department (J9/F7: dispatch stage always present)
  const deptRows = await query<{ id: string; key: string }>(`SELECT id, key FROM departments`);
  const byKey = new Map(deptRows.map((d) => [d.key, d.id]));
  for (const key of DEPT_KEYS) {
    const deptId = byKey.get(key);
    if (!deptId) continue;
    await query(
      `INSERT INTO job_stages (id, job_id, department_id, status, qty, remaining) VALUES ($1,$2,$3,'waiting',$4,$4)`,
      [randomUUID(), jobId, deptId, input.lines.reduce((s, l) => s + l.qtyOrdered, 0)],
    );
  }

  await query(`INSERT INTO screen_records (job_id) VALUES ($1)`, [jobId]); // all NULL = blank (G4)
  // S1: job has Embroidery stage → swatch required
  await query(`INSERT INTO swatch_requirements (job_id, required) VALUES ($1, true)`, [jobId]);

  await audit({ entityType: "job", entityId: jobId, jobId, action: "job-header", user, after: { jobNumber: input.jobNumber } });
  await audit({
    entityType: "job_lines",
    entityId: jobId,
    jobId,
    action: "order-lines",
    user,
    after: input.lines.map((l) => ({ sku: l.skuText, supplierSku: l.supplierSku ?? null, qtyOrdered: l.qtyOrdered })),
  });
  return jobId;
}

export async function listJobs(opts: { q?: string; includeArchived?: boolean } = {}): Promise<Record<string, unknown>[]> {
  const like = opts.q ? `%${opts.q}%` : null;
  return query(
    `SELECT j.id, j.job_number, j.po, j.print_name,
            to_char(j.order_date, 'YYYY-MM-DD') AS order_date, j.order_type, j.priority,
            to_char(j.process_date, 'YYYY-MM-DD') AS process_date,
            to_char(j.dispatch_date, 'YYYY-MM-DD') AS dispatch_date,
            j.dispatch_time, j.status, j.readiness_cache, j.archived,
            c.name AS customer_name,
            (SELECT count(*)::int FROM job_lines l WHERE l.job_id = j.id) AS line_count
       FROM jobs j JOIN customers c ON c.id = j.customer_id
      WHERE ($1::bool OR j.archived = false)
        AND ($2::text IS NULL
             OR j.job_number ILIKE $2 OR c.name ILIKE $2 OR coalesce(j.po,'') ILIKE $2
             OR coalesce(j.print_name,'') ILIKE $2
             OR EXISTS (SELECT 1 FROM job_lines l WHERE l.job_id = j.id
                         AND (l.sku_text ILIKE $2 OR coalesce(l.supplier_sku,'') ILIKE $2)))
      ORDER BY j.dispatch_date ASC NULLS LAST, j.priority ASC, j.process_date ASC NULLS LAST, j.job_number DESC
      LIMIT 500`,
    [opts.includeArchived ?? false, like],
  );
}

export async function getJob(id: string): Promise<Record<string, unknown> | null> {
  const job = await query(
    `SELECT j.*,
            to_char(j.order_date, 'YYYY-MM-DD') AS order_date,
            to_char(j.process_date, 'YYYY-MM-DD') AS process_date,
            to_char(j.dispatch_date, 'YYYY-MM-DD') AS dispatch_date,
            c.name AS customer_name, cs.name AS contact_name, cs.email AS contact_email, cs.phone AS contact_phone,
            ds.method AS dispatch_method, ds.address AS dispatch_address
       FROM jobs j
       JOIN customers c ON c.id = j.customer_id
       LEFT JOIN job_contact_snapshot cs ON cs.job_id = j.id
       LEFT JOIN job_dispatch_snapshot ds ON ds.job_id = j.id
      WHERE j.id = $1`,
    [id],
  );
  if (!job[0]) return null;
  const [lines, stages, positions, screen, swatchReq, attempts, shipments, readiness, stock] = await Promise.all([
    query(`SELECT * FROM job_lines WHERE job_id = $1 ORDER BY sku_text`, [id]),
    query(
      `SELECT s.*, d.key AS department_key, d.name AS department_name FROM job_stages s
         JOIN departments d ON d.id = s.department_id WHERE s.job_id = $1 ORDER BY d.name`,
      [id],
    ),
    query(`SELECT * FROM print_positions WHERE job_id = $1`, [id]),
    query(`SELECT * FROM screen_records WHERE job_id = $1`, [id]),
    query(`SELECT * FROM swatch_requirements WHERE job_id = $1`, [id]),
    query(`SELECT * FROM swatch_attempts WHERE job_id = $1 ORDER BY attempt_no`, [id]),
    query(`SELECT * FROM shipments WHERE job_id = $1 ORDER BY created_at`, [id]),
    computeReadiness(id), // G1: server-computed on read
    stockOverview(id), // J4: outstanding from stock events
  ]);
  return {
    ...job[0], lines, stages, positions, screen: screen[0] ?? null,
    swatchRequirement: swatchReq[0] ?? null, attempts, shipments,
    readiness, stock,
  };
}

export type PatchJobInput = Partial<{
  po: string | null;
  printName: string | null;
  orderDate: string | null;
  orderType: string | null;
  priority: number | null;
  staff: string | null;
  processDate: string | null;
  dispatchDate: string | null;
  dispatchTime: string | null;
  notes: string | null;
  archived: boolean;
}>;

export async function patchJob(id: string, input: PatchJobInput, version: number, user: SessionUser): Promise<void> {
  const before = await query<Record<string, unknown>>(`SELECT * FROM jobs WHERE id = $1 FOR UPDATE`, [id]);
  if (!before[0]) throw { status: 404, message: "Job not found." };
  if (Number(before[0].version) !== version) {
    throw { status: 409, message: "Job changed since you loaded it. Reload and retry.", current: before[0] };
  }
  const allowed: (keyof PatchJobInput)[] = [
    "po", "printName", "orderDate", "orderType", "priority", "staff",
    "processDate", "dispatchDate", "dispatchTime", "notes",
  ];
  if (input.archived === true && !user.roles.includes("admin") && !user.roles.includes("ops")) {
    throw { status: 403, message: "Archive requires Admin or Operations." };
  }
  const COLS: Record<string, string> = {
    po: "po",
    printName: "print_name",
    orderDate: "order_date",
    orderType: "order_type",
    priority: "priority",
    staff: "staff",
    processDate: "process_date",
    dispatchDate: "dispatch_date",
    dispatchTime: "dispatch_time",
    notes: "notes",
  };
  const sets: string[] = [];
  const vals: unknown[] = [id];
  for (const k of allowed) {
    if (k in input) {
      vals.push((input as Record<string, unknown>)[k]);
      sets.push(`${COLS[k] ?? k} = $${vals.length}`);
    }
  }
  if ("archived" in input) {
    vals.push(Boolean(input.archived));
    sets.push(`archived = $${vals.length}`); // archive flag only — never DELETE (F4/B6)
  }
  if (!sets.length) return;
  vals.push(version);
  const res = await query<{ n: string }>(
    `UPDATE jobs SET ${sets.join(", ")}, version = version + 1, updated_at = now()
      WHERE id = $1 AND version = $${vals.length} RETURNING 'x' AS n`,
    vals,
  );
  if (!res.length) {
    const fresh = await query<Record<string, unknown>>(`SELECT * FROM jobs WHERE id = $1`, [id]);
    throw { status: 409, message: "Job changed since you loaded it. Reload and retry.", current: fresh[0] };
  }

  // L5: archiving writes stock-history event — history survives record removal
  if (input.archived === true && before[0] && before[0].archived !== true) {
    await appendStockEvent({
      jobId: id,
      type: "archived",
      reason: "Job archived; stock history retained.",
      userId: user.id,
    });
  }
  if ("archived" in input || sets.length) {
    await updateReadinessCache(id).catch(() => null); // lines unchanged → cheap refresh
  }
  await audit({ entityType: "job", entityId: id, jobId: id, action: "job-header", user, before, after: input });
}

// Lifecycle: cancel keeps the record (status only, 03 §1)
export async function cancelJob(id: string, reason: string, user: SessionUser): Promise<void> {
  const before = await query<Record<string, unknown>>(`SELECT status FROM jobs WHERE id = $1 FOR UPDATE`, [id]);
  if (!before[0]) throw { status: 404, message: "Job not found." };
  if (before[0].status === "cancelled") throw { status: 422, message: "Job already cancelled." };
  if (before[0].status === "completed") throw { status: 422, message: "Completed jobs cannot be cancelled." };
  if (!reason?.trim()) throw { status: 422, message: "Cancellation requires a reason." };
  await query(`UPDATE jobs SET status = 'cancelled', updated_at = now() WHERE id = $1`, [id]);
  await audit({
    entityType: "job", entityId: id, jobId: id, action: "job-header", user,
    before: { status: before[0].status }, after: { status: "cancelled", reason },
  });
}
