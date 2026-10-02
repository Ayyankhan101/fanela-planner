import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { updateReadinessCache, STOCK_ISSUES } from "./readiness";

// Stock history append-only (L1): app role INSERT+SELECT only; events always win.

export type LineSnapshot = {
  scope: "line" | "job";
  lineId: string | null;
  sku: string;
  qtyOrdered: number;
  qtyReceived: number;
  qtyOutstanding: number;
  confirmed: boolean;
  stockOrdered: boolean;
  issue: string | null;
  status: string;
};

export function lineStatus(l: {
  qty_ordered: number;
  stock_confirmed: boolean;
  stock_issue: string | null;
  stock_ordered: boolean;
  received: number;
}): string {
  if (l.stock_issue) return l.stock_issue;
  if (l.received >= l.qty_ordered && l.qty_ordered > 0 && l.stock_confirmed) return "Complete";
  if (l.received > 0) return "Part Received";
  return l.stock_ordered ? "Ordered" : "Not Ordered";
}

export async function appendStockEvent(e: {
  jobId: string;
  jobLineId?: string | null;
  type: "receipt" | "adjustment" | "correction" | "line_removed" | "archived" | "update";
  qty?: number | null;
  reason?: string | null;
  payload?: unknown;
  correctsEventId?: string | null;
  userId?: string | null;
}): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO stock_events (id, job_id, job_line_id, type, qty, reason, payload, corrects_event_id, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      e.jobId,
      e.jobLineId ?? null,
      e.type,
      e.qty ?? null,
      e.reason ?? null,
      e.payload != null ? JSON.stringify(e.payload) : null,
      e.correctsEventId ?? null,
      e.userId ?? null,
    ],
  );
  return id;
}

async function lineSnapshot(lineId: string): Promise<LineSnapshot | null> {
  const rows = await query<{
    id: string;
    sku_text: string | null;
    qty_ordered: number;
    stock_confirmed: boolean;
    stock_ordered: boolean;
    stock_issue: string | null;
    received: number;
    version: number;
  }>(
    `SELECT l.id, l.sku_text, l.qty_ordered, l.stock_confirmed, l.stock_ordered, l.stock_issue, l.version,
            coalesce((SELECT sum(e.qty) FROM stock_events e WHERE e.job_line_id = l.id), 0)::int AS received
       FROM job_lines l WHERE l.id = $1`,
    [lineId],
  );
  const l = rows[0];
  if (!l) return null;
  return {
    scope: "line",
    lineId: l.id,
    sku: l.sku_text ?? "",
    qtyOrdered: l.qty_ordered,
    qtyReceived: l.received,
    qtyOutstanding: l.qty_ordered - l.received, // J4: negative = over-delivery, allowed + displayed
    confirmed: l.stock_confirmed,
    stockOrdered: l.stock_ordered,
    issue: l.stock_issue,
    status: lineStatus(l),
  };
}

export type StockLine = {
  id: string;
  sku: string;
  qtyOrdered: number;
  received: number;
  outstanding: number;
  confirmed: boolean;
  stockOrdered: boolean;
  issue: string | null;
  status: string;
  version: number;
};

export type StockOverview = {
  ordered: number;
  received: number;
  outstanding: number;
  allConfirmed: boolean;
  issues: string[];
  lines: StockLine[];
};

// G5 overview — received computed from stock events (J4 outstanding = ordered − received, negative allowed)
export async function stockOverview(jobId: string): Promise<StockOverview | null> {
  const rows = await query<{
    id: string;
    sku_text: string | null;
    qty_ordered: number;
    stock_confirmed: boolean;
    stock_ordered: boolean;
    stock_issue: string | null;
    received: number;
    version: number;
  }>(
    `SELECT l.id, l.sku_text, l.qty_ordered, l.stock_confirmed, l.stock_ordered, l.stock_issue, l.version,
            coalesce((SELECT sum(e.qty) FROM stock_events e WHERE e.job_line_id = l.id), 0)::int AS received
       FROM job_lines l WHERE l.job_id = $1 ORDER BY l.sku_text`,
    [jobId],
  );
  if (!rows.length) {
    const job = await query(`SELECT id FROM jobs WHERE id = $1`, [jobId]);
    if (!job[0]) return null;
    return { ordered: 0, received: 0, outstanding: 0, allConfirmed: false, issues: [], lines: [] };
  }
  const lines: StockLine[] = rows.map((l) => ({
    id: l.id,
    sku: l.sku_text ?? "",
    qtyOrdered: l.qty_ordered,
    received: l.received,
    outstanding: l.qty_ordered - l.received,
    confirmed: l.stock_confirmed,
    stockOrdered: l.stock_ordered,
    issue: l.stock_issue,
    status: lineStatus(l),
    version: Number(l.version),
  }));
  const ordered = lines.reduce((n, l) => n + l.qtyOrdered, 0);
  const received = lines.reduce((n, l) => n + l.received, 0);
  const issues = lines.filter((l) => l.issue).map((l) => l.issue!) as string[];
  const allConfirmed =
    lines.length > 0 &&
    lines.every((l) => l.qtyOrdered > 0 && l.received >= l.qtyOrdered && l.confirmed) &&
    issues.length === 0;
  return { ordered, received, outstanding: ordered - received, allConfirmed, issues, lines };
}

export type StockPatchInput = {
  stockOrdered?: boolean;
  stockConfirmed?: boolean;
  stockIssue?: string | null;
  receipt?: { qty: number; note?: string };
  correction?: { correctsEventId: string; qty: number; reason: string };
};

// Warehouse edit (stock.edit scoped): flags + receipts; corrections admin/ops only (v11 canCorrectStock).
export async function patchStockLine(
  jobId: string,
  lineId: string,
  input: StockPatchInput,
  version: number,
  user: SessionUser,
): Promise<number> {
  const lock = await query<{ version: number }>(
    `SELECT version FROM job_lines WHERE id = $1 AND job_id = $2 FOR UPDATE`,
    [lineId, jobId],
  );
  if (!lock[0]) throw { status: 404, message: "Stock line not found." };
  if (Number(lock[0].version) !== version) {
    const fresh = await query<Record<string, unknown>>(`SELECT * FROM job_lines WHERE id = $1`, [lineId]);
    throw { status: 409, message: "Stock line changed since you loaded it. Reload and retry.", current: fresh[0] };
  }
  if (input.stockIssue != null && !STOCK_ISSUES.includes(input.stockIssue as (typeof STOCK_ISSUES)[number])) {
    throw { status: 422, message: "Unknown stock issue state." };
  }
  if (input.correction && !user.roles.includes("admin") && !user.roles.includes("ops")) {
    throw { status: 403, message: "Corrections require Admin or Operations." };
  }

  const before = await lineSnapshot(lineId);
  if (!before) throw { status: 404, message: "Stock line not found." };

  const hasFlags =
    input.stockOrdered !== undefined || input.stockConfirmed !== undefined || input.stockIssue !== undefined;
  if (hasFlags) {
    const p: unknown[] = [lineId, jobId];
    const assignments: string[] = [];
    if (input.stockOrdered !== undefined) {
      p.push(input.stockOrdered);
      assignments.push(`stock_ordered = $${p.length}`);
    }
    if (input.stockConfirmed !== undefined) {
      p.push(input.stockConfirmed);
      assignments.push(`stock_confirmed = $${p.length}`);
    }
    if (input.stockIssue !== undefined) {
      p.push(input.stockIssue);
      assignments.push(`stock_issue = $${p.length}`);
    }
    p.push(version);
    const res = await query<{ n: string }>(
      `UPDATE job_lines SET ${assignments.join(", ")}, version = version + 1
        WHERE id = $1 AND job_id = $2 AND version = $${p.length} RETURNING 'x' AS n`,
      p,
    );
    if (!res.length) {
      const fresh = await query<Record<string, unknown>>(`SELECT * FROM job_lines WHERE id = $1`, [lineId]);
      throw { status: 409, message: "Stock line changed since you loaded it. Reload and retry.", current: fresh[0] };
    }
  }

  const after = await lineSnapshot(lineId);
  // receipts/corrections are state changes too — optimistic lock + version bump (spec §9)
  if (!hasFlags && (input.correction || input.receipt)) {
    const res = await query<{ n: string }>(
      `UPDATE job_lines SET version = version + 1
        WHERE id = $1 AND job_id = $2 AND version = $3 RETURNING 'x' AS n`,
      [lineId, jobId, version],
    );
    if (!res.length) {
      const fresh = await query<Record<string, unknown>>(`SELECT * FROM job_lines WHERE id = $1`, [lineId]);
      throw { status: 409, message: "Stock line changed since you loaded it. Reload and retry.", current: fresh[0] };
    }
  }
  if (input.correction) {
    await appendStockEvent({
      jobId,
      jobLineId: lineId,
      type: "correction",
      qty: input.correction.qty,
      reason: input.correction.reason,
      correctsEventId: input.correction.correctsEventId,
      payload: after,
      userId: user.id,
    });
  } else if (input.receipt) {
    await appendStockEvent({
      jobId,
      jobLineId: lineId,
      type: "receipt",
      qty: input.receipt.qty,
      reason: input.receipt.note ?? null,
      payload: after,
      userId: user.id,
    });
  } else {
    await appendStockEvent({ jobId, jobLineId: lineId, type: "update", payload: after, userId: user.id });
  }

  // derived stock_status cache on the line — recompute after the event lands so payload matches received sum
  const finalSnap = (await lineSnapshot(lineId)) ?? after;
  if (input.correction || input.receipt) {
    await query(`UPDATE stock_events SET payload = $1 WHERE id = (
      SELECT id FROM stock_events WHERE job_id = $2 AND job_line_id = $3 ORDER BY ts DESC, id DESC LIMIT 1
    )`, [JSON.stringify(finalSnap ?? null), jobId, lineId]);
  }
  if (finalSnap) {
    await query(`UPDATE job_lines SET stock_status = $1 WHERE id = $2`, [finalSnap.status, lineId]);
  }
  await updateReadinessCache(jobId);
  const v = await query<{ version: number }>(`SELECT version FROM job_lines WHERE id = $1`, [lineId]);
  return Number(v[0].version);
}

// L5: removing a job line appends history first; FK set-null keeps event, snapshot lives in payload
export async function removeJobLine(jobId: string, lineId: string, user: SessionUser): Promise<void> {
  const snap = await lineSnapshot(lineId);
  if (!snap) throw { status: 404, message: "Job line not found." };
  await appendStockEvent({
    jobId,
    jobLineId: lineId,
    type: "line_removed",
    reason: "Product line removed from the current order; earlier stock history retained.",
    payload: snap,
    userId: user.id,
  });
  await query(`DELETE FROM job_lines WHERE id = $1 AND job_id = $2`, [lineId, jobId]);
  const { audit } = await import("./audit");
  await audit({ entityType: "job_lines", entityId: lineId, jobId, action: "order-lines", user, before: snap, after: null });
  await updateReadinessCache(jobId);
}
