import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { query, withTransaction } from "@/lib/db";
import {
  MSG_SHAPE_F9,
  MSG_FILE_TOO_LARGE,
  MSG_ROW_CAP,
  MSG_TYPED_COUNT,
  MSG_BATCH_STATE,
  CODE_IMPORT_SHAPE_INVALID,
  CODE_IMPORT_FILE_TOO_LARGE,
  CODE_IMPORT_ROW_CAP,
  CODE_IMPORT_TYPED_COUNT,
  CODE_IMPORT_BATCH_STATE,
  CODE_STALE_BATCH,
  CODE_NOT_FOUND,
  type ErrorCode,
} from "@/lib/errors";
import { updateReadinessCache } from "./readiness";
import { DEPARTMENTS } from "@/lib/permissions";
import type { SessionUser } from "@/lib/auth/session";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // spec decision — fixed by design
export const ROW_CAP = 50_000;
const UPLOAD_DIR = path.join(process.cwd(), "storage", "uploads");
const STATE_KEYS = [
  "fanela_internal_production_planner_ops_v11",
  "fanela_internal_production_planner_stock_v9",
  "fanela_internal_production_planner_excel_v8",
  "fanela_internal_production_planner_v10",
  "fanela_internal_production_planner_v9",
  "fanela_internal_production_planner_v8",
  "fanela_internal_production_planner_v7",
  "fanela_internal_production_planner_v6",
  "fanela_internal_production_planner_v5",
  "fanela_internal_production_planner_v4",
  "fanela_production_planner_v3",
  "fanela_multi_department_planner_v2",
  "fanela_daily_planner_v1",
];
const FALLBACK_KEY = "fanela_internal_production_planner_ops_v11_before_import";
const STOCK_ISSUES = ["Short", "Backorder", "Picking Error", "Damaged / Incorrect Stock"];
const ORDER_TYPES = new Set(["bulk", "pod", "repeat", "sample"]);
const STAGE_STATUS: Record<string, string> = {
  Waiting: "waiting",
  Ready: "ready",
  "In Progress": "in_progress",
  Blocked: "blocked",
  Completed: "completed",
};
const STOCK_EVENT_TYPES = new Set(["receipt", "adjustment", "correction", "line_removed", "archived", "update"]);

export type Issue = { check: string; severity: "error" | "warn" | "info" | "skip"; message: string };
export type Disposition = "create" | "skip" | "error" | "warn";
export type ParsedRow = {
  idx: number;
  jobNumber: string;
  customer: string;
  severity: Disposition;
  issues: Issue[];
  data: NormalizedJob;
};
export type Counts = { create: number; skip: number; error: number; warn: number; info: number };
export type ParsedBatch = {
  rows: ParsedRow[];
  customers: Record<string, unknown>[];
  products: Record<string, unknown>[];
};

type NormalizedLine = {
  legacyId: string | null;
  sku: string;
  supplierSku: string | null;
  colour: string | null;
  qtyOrdered: number;
  unitPrice: string | null;
  tax: string | null;
  buyingCost: string | null;
  stockStatus: string;
  stockOrdered: boolean;
  stockConfirmed: boolean;
  stockIssue: string | null;
  sizes: { size: string; qty: number }[];
};
type NormalizedStage = {
  legacyId: string | null;
  deptName: string;
  status: string;
  processDate: string | null;
  qty: number;
  completed: number;
  notes: string | null;
  waste: number;
  reprint: number;
  finishedAt: string | null;
};
type NormalizedJob = {
  legacyId: string | null;
  jobNumber: string;
  customerLegacyId: string | null;
  customerName: string;
  contact: { name: string | null; email: string | null; phone: string | null; address: string | null };
  dispatch: { method: string | null; address: string | null; instructions: string | null };
  po: string | null;
  printName: string | null;
  orderDate: string | null;
  orderType: string | null;
  priority: number;
  staff: string | null;
  processDate: string | null;
  dispatchDate: string | null;
  dispatchTime: string | null;
  notes: string | null;
  lines: NormalizedLine[];
  stages: NormalizedStage[];
  positions: { name: string; pieces: number }[];
  screens: { required: number | null; made: number | null; confirmed: boolean; notRequired: boolean; notes: string | null };
  swatchRequired: boolean;
  hasTerminalSwatches: boolean;
  shipmentCount: number;
  artwork: { proofRef: string | null; pantoneNotes: string | null } | null;
  stockEvents: NormalizedStockEvent[];
};
type NormalizedStockEvent = {
  legacyId: string;
  lineLegacyId: string | null;
  type: string;
  qty: number | null;
  reason: string | null;
  ts: string;
  correctsLegacyId: string | null;
  payload: string;
};

export class ImportFailure extends Error {
  status: number;
  code: ErrorCode;
  current?: unknown;
  constructor(status: number, message: string, code: ErrorCode, current?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.current = current;
  }
}
function fail(status: number, message: string, code: ErrorCode, current?: unknown): never {
  throw new ImportFailure(status, message, code, current);
}

const isDate = (s: unknown): boolean =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const dateOrNull = (v: unknown): string | null => (isDate(v) ? (v as string) : null);

// ---- shape detection (phase0/05 §1) ---------------------------------------
export type DetectedShape = "A" | "B" | "C";
export type DetectedState = {
  shape: DetectedShape;
  state: {
    schemaVersion?: number;
    customers: Record<string, unknown>[];
    products: Record<string, unknown>[];
    jobs: Record<string, unknown>[];
    stockEvents: Record<string, unknown>[];
    operationsEvents: Record<string, unknown>[];
  };
};

export function detectShape(text: string): DetectedState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail(422, "File is not valid JSON.", CODE_IMPORT_SHAPE_INVALID);
  }
  if (Array.isArray(raw)) {
    return { shape: "C", state: { customers: [], products: [], jobs: raw, stockEvents: [], operationsEvents: [] } };
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.jobs) && (obj.schemaVersion !== undefined || obj.customers !== undefined || obj.products !== undefined)) {
      // shape B — v11 state object (05 §1: stock history + audit log must be present)
      if (typeof obj.schemaVersion === "number" && obj.schemaVersion > 3) {
        return fail(
          422,
          `File from a newer prototype (schemaVersion ${obj.schemaVersion}) — export from v11 or update the planner.`,
          CODE_IMPORT_SHAPE_INVALID,
        );
      }
      if (!Array.isArray(obj.stockEvents) || !Array.isArray(obj.operationsEvents)) {
        return fail(
          422,
          "Stock history or audit log missing — not rebuildable. Export a full localStorage dump (see data-quality instructions).",
          CODE_IMPORT_SHAPE_INVALID,
        );
      }
      return {
        shape: "B",
        state: {
          schemaVersion: typeof obj.schemaVersion === "number" ? obj.schemaVersion : undefined,
          customers: Array.isArray(obj.customers) ? obj.customers : [],
          products: Array.isArray(obj.products) ? obj.products : [],
          jobs: obj.jobs,
          stockEvents: obj.stockEvents,
          operationsEvents: obj.operationsEvents,
        },
      };
    }
    if (Array.isArray(obj.jobs)) {
      // shape D — backup-button export: jobs only, no catalogs/history → F9 (05 §1)
      return fail(422, MSG_SHAPE_F9, CODE_IMPORT_SHAPE_INVALID);
    }
    if (Object.values(obj).every((v) => typeof v === "string")) {
      // shape A — full localStorage dump
      let parsed: Record<string, unknown> | null = null;
      for (const k of [...STATE_KEYS, FALLBACK_KEY]) {
        if (typeof obj[k] === "string") {
          try {
            const p = JSON.parse(obj[k] as string);
            if (p && Array.isArray(p.jobs)) {
              parsed = p;
              break;
            }
          } catch {
            /* next key */
          }
        }
      }
      if (!parsed) {
        for (const v of Object.values(obj)) {
          try {
            const p = JSON.parse(v as string);
            if (p && Array.isArray(p.jobs)) {
              parsed = p;
              break;
            }
          } catch {
            /* next value */
          }
        }
      }
      if (!parsed) {
        return fail(422, "No planner state found in dump.", CODE_IMPORT_SHAPE_INVALID);
      }
      if (typeof parsed.schemaVersion === "number" && parsed.schemaVersion > 3) {
        return fail(
          422,
          `File from a newer prototype (schemaVersion ${parsed.schemaVersion}) — export from v11 or update the planner.`,
          CODE_IMPORT_SHAPE_INVALID,
        );
      }
      if (!Array.isArray(parsed.stockEvents) || !Array.isArray(parsed.operationsEvents)) {
        return fail(
          422,
          "Stock history or audit log missing — not rebuildable. Export a full localStorage dump (see data-quality instructions).",
          CODE_IMPORT_SHAPE_INVALID,
        );
      }
      return {
        shape: "A",
        state: {
          schemaVersion: typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : undefined,
          customers: Array.isArray(parsed.customers) ? parsed.customers : [],
          products: Array.isArray(parsed.products) ? parsed.products : [],
          jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
          stockEvents: parsed.stockEvents,
          operationsEvents: parsed.operationsEvents,
        },
      };
    }
  }
  return fail(422, "Unrecognised JSON shape. Expected a localStorage dump, state object, or jobs array.", CODE_IMPORT_SHAPE_INVALID);
}

// ---- validation (phase0/05 §2) --------------------------------------------
function normaliseJob(raw: Record<string, unknown>, idx: number, issues: Issue[]): ParsedRow {
  const jobNumber = typeof raw.jobNumber === "string" ? raw.jobNumber.trim() : "";
  const customerName = typeof raw.customer === "string" ? raw.customer.trim() : "";
  const badDate = (v: unknown): boolean => v != null && v !== "" && !isDate(v);
  if (badDate(raw.orderDate) || badDate(raw.processDate) || badDate(raw.dispatchDate)) {
    issues.push({ check: "invalid-date", severity: "error", message: "Invalid date field (expected YYYY-MM-DD)." });
  }

  const stagesRaw = Array.isArray(raw.stages) ? (raw.stages as Record<string, unknown>[]) : [];
  const seenDept = new Set<string>();
  const stages: NormalizedStage[] = [];
  for (const s of stagesRaw) {
    const dept = String(s.department ?? "").trim();
    if (dept && seenDept.has(dept.toLowerCase())) {
      issues.push({ check: "duplicate-department", severity: "warn", message: `Duplicate stage for ${dept} dropped.` });
      continue;
    }
    if (dept) seenDept.add(dept.toLowerCase());
    if (badDate(s.processDate)) {
      issues.push({ check: "invalid-date", severity: "error", message: "Invalid stage date (expected YYYY-MM-DD)." });
    }
    const qty = s.quantity ?? 0;
    const completed = s.completed ?? 0;
    if (!isInt(qty) || !isInt(completed) || !isInt(s.waste) || !isInt(s.reprint)) {
      issues.push({ check: "non-integer-quantity", severity: "error", message: "Non-integer stage quantity." });
    }
    stages.push({
      legacyId: str(s.id),
      deptName: dept,
      status: STAGE_STATUS[String(s.status ?? "")] ?? "waiting",
      processDate: dateOrNull(s.processDate),
      qty: isInt(qty) ? qty : 0,
      completed: isInt(completed) ? completed : 0,
      notes: str(s.notes),
      waste: isInt(s.waste) ? s.waste : 0,
      reprint: isInt(s.reprint) ? s.reprint : 0,
      finishedAt: str(s.finishedAt),
    });
  }
  for (const s of stages) {
    if (s.deptName && !DEPARTMENTS.some((d) => d.name.toLowerCase() === s.deptName.toLowerCase())) {
      issues.push({ check: "unknown-department", severity: "warn", message: `Unknown department "${s.deptName}" — stage dropped.` });
    }
  }

  const linesRaw = Array.isArray(raw.skuLines) ? (raw.skuLines as Record<string, unknown>[]) : [];
  const lines: NormalizedLine[] = [];
  for (const l of linesRaw) {
    const sku = typeof l.sku === "string" ? l.sku.trim() : "";
    if (!sku) {
      issues.push({ check: "blank-sku", severity: "warn", message: "Line without SKU dropped." });
      continue;
    }
    const qty = l.quantity;
    if (qty != null && !isInt(qty)) {
      issues.push({ check: "non-integer-quantity", severity: "error", message: "Non-integer line quantity." });
    }
    const qtyInt = isInt(qty) ? qty : 0;
    const sc = (l.stockControl ?? {}) as Record<string, unknown>;
    const status = typeof sc.status === "string" && sc.status ? sc.status : "Not Ordered";
    const sizes: { size: string; qty: number }[] = [];
    const qtyMap = l.quantities;
    if (qtyMap && typeof qtyMap === "object" && !Array.isArray(qtyMap)) {
      for (const [size, q] of Object.entries(qtyMap as Record<string, unknown>)) {
        if (isInt(q)) sizes.push({ size, qty: q });
        else issues.push({ check: "non-integer-quantity", severity: "error", message: `Non-integer size quantity (${size}).` });
      }
    } else if (typeof l.size === "string" && l.size && qtyInt > 0) {
      sizes.push({ size: l.size, qty: qtyInt });
    }
    lines.push({
      legacyId: str(l.id),
      sku,
      supplierSku: null,
      colour: str(l.colour),
      qtyOrdered: qtyInt,
      unitPrice: l.unitPrice != null ? String(l.unitPrice) : null,
      tax: str(l.taxCode),
      buyingCost: null,
      stockStatus: status,
      stockOrdered: sc.stockOrdered === true,
      stockConfirmed: l.stockConfirmed === true,
      stockIssue: STOCK_ISSUES.includes(status) ? status : null,
      sizes,
    });
  }
  const positions = (Array.isArray(raw.positions) ? raw.positions : []).map((p) =>
    typeof p === "string" ? { name: p, pieces: isInt(raw.quantity) ? (raw.quantity as number) : 0 } : null,
  ).filter((p): p is { name: string; pieces: number } => !!p && p.name.trim().length > 0);

  const attempts = ((raw.swatch as Record<string, unknown> | undefined)?.attempts ?? []) as Record<string, unknown>[];
  const terminal = attempts.some((a) => ["Approved", "Rejected", "Re-swatch Required"].includes(String(a.status ?? "")));
  const shipments = ((raw.dispatch as Record<string, unknown> | undefined)?.shipments ?? []) as unknown[];
  const approval = raw.artworkApproval as Record<string, unknown> | undefined | null;

  if (terminal) issues.push({ check: "terminal-swatch", severity: "info", message: "Terminal swatch attempts present — not imported (E4)." });
  if (shipments.length > 0) issues.push({ check: "shipments-present", severity: "info", message: `${shipments.length} shipment(s) present — not imported (E4).` });
  if (raw.screensRequired == null || raw.screensRequired === "") issues.push({ check: "blank-screens", severity: "info", message: "Screens required blank — migrates as NULL (G4)." });

  const screensRequired = isInt(raw.screensRequired) ? raw.screensRequired : null;
  const priorityNumber = isInt(raw.priorityNumber) ? (raw.priorityNumber as number) : null;
  const level = typeof raw.priority === "string" ? raw.priority.toLowerCase() : null;
  const priority = priorityNumber ?? (level === "urgent" ? 10 : level === "high" ? 30 : isInt(raw.priority) ? (raw.priority as number) : 50);

  const hasEmbroidery = stages.some((s) => s.deptName.toLowerCase() === "embroidery");
  const swatchObj = raw.swatch as Record<string, unknown> | undefined;

  const data: NormalizedJob = {
    legacyId: str(raw.id),
    jobNumber,
    customerLegacyId: str(raw.customerId),
    customerName,
    contact: {
      name: str(raw.contactName),
      email: str(raw.customerEmail),
      phone: str(raw.customerPhone),
      address: str(raw.customerAddress),
    },
    dispatch: {
      method: (raw.dispatch as Record<string, unknown> | undefined)?.method ? String((raw.dispatch as Record<string, unknown>).method) : null,
      address: str(raw.dispatchAddress),
      instructions: (raw.dispatch as Record<string, unknown> | undefined)?.deliveryInstructions
        ? String((raw.dispatch as Record<string, unknown>).deliveryInstructions)
        : null,
    },
    po: str(raw.customerPO),
    printName: str(raw.printName),
    orderDate: raw.orderDate === "" || raw.orderDate == null ? null : dateOrNull(raw.orderDate),
    orderType: typeof raw.orderType === "string" && ORDER_TYPES.has(raw.orderType.toLowerCase())
      ? raw.orderType.toLowerCase()
      : null,
    priority,
    staff: str(raw.assignedStaff),
    processDate: raw.processDate === "" || raw.processDate == null ? null : dateOrNull(raw.processDate),
    dispatchDate: raw.dispatchDate === "" || raw.dispatchDate == null ? null : dateOrNull(raw.dispatchDate),
    dispatchTime: str(raw.dispatchTime),
    notes: str(raw.notes),
    lines,
    stages: stages.filter((s) => !s.deptName || DEPARTMENTS.some((d) => d.name.toLowerCase() === s.deptName.toLowerCase())),
    positions,
    screens: {
      required: screensRequired,
      made: isInt(raw.screensReady) ? raw.screensReady : null,
      confirmed: raw.screensConfirmed === true,
      notRequired: raw.screensNotRequired === true,
      notes: str(raw.screensNotes),
    },
    swatchRequired: swatchObj?.required === true || (swatchObj === undefined && hasEmbroidery),
    hasTerminalSwatches: terminal,
    shipmentCount: shipments.length,
    artwork: approval || raw.artworkReference
      ? {
          proofRef: str(approval?.proofReference) ?? str(raw.artworkReference),
          pantoneNotes: str(approval?.pantoneNotes),
        }
      : null,
    stockEvents: [],
  };
  return { idx, jobNumber, customer: customerName, severity: "create", issues, data };
}

async function validateState(state: DetectedState["state"]): Promise<ParsedRow[]> {
  const jobs = state.jobs;
  const fileCustomers = state.customers;
  const jobNumbers = jobs
    .map((j) => (typeof j.jobNumber === "string" ? j.jobNumber.trim() : ""))
    .filter((n) => n !== "");
  const existing = new Set(
    (await query<{ job_number: string }>(`SELECT job_number FROM jobs WHERE job_number = ANY($1)`, [jobNumbers])).map(
      (r) => r.job_number,
    ),
  );

  const rows: ParsedRow[] = [];
  const seen = new Set<string>();
  const custByLegacy = new Map<string, Record<string, unknown>>();
  for (const c of fileCustomers) if (typeof c.id === "string") custByLegacy.set(c.id, c);
  const custByName = new Map<string, Record<string, unknown>>();
  for (const c of fileCustomers) {
    const name = String(c.name ?? "").trim().toLowerCase();
    if (name && !custByName.has(name)) custByName.set(name, c);
  }
  const dbCustRows = await query<{ id: string; legacy_id: string | null; name: string }>(
    `SELECT id, legacy_id, name FROM customers WHERE legacy_id = ANY($1) OR lower(name) = ANY($2)`,
    [[...custByLegacy.keys()], [...custByName.keys()]],
  );
  const dbByLegacy = new Map(dbCustRows.filter((r) => r.legacy_id).map((r) => [r.legacy_id as string, r]));
  const dbByName = new Map(dbCustRows.map((r) => [r.name.trim().toLowerCase(), r]));
  const dupNames = new Set<string>();
  {
    const seenNames = new Set<string>();
    for (const c of fileCustomers) {
      const name = String(c.name ?? "").trim().toLowerCase();
      if (!name) continue;
      if (seenNames.has(name)) dupNames.add(name);
      seenNames.add(name);
    }
  }

  const stockByJob = new Map<string, Record<string, unknown>[]>();
  for (const e of state.stockEvents) {
    const jid = typeof e.jobId === "string" ? e.jobId : "";
    if (!jid) continue;
    if (!stockByJob.has(jid)) stockByJob.set(jid, []);
    stockByJob.get(jid)!.push(e);
  }

  for (let idx = 0; idx < jobs.length; idx++) {
    const raw = jobs[idx];
    const issues: Issue[] = [];
    const row = normaliseJob(raw, idx, issues);
    const jobNumber = row.jobNumber;

    if (!jobNumber) {
      issues.push({ check: "blank-job-number", severity: "error", message: "Missing job number." });
    } else if (seen.has(jobNumber)) {
      issues.push({ check: "duplicate-job-number", severity: "error", message: "Duplicate job number in file." });
    } else {
      seen.add(jobNumber);
      if (existing.has(jobNumber)) {
        issues.push({ check: "existing-job", severity: "skip", message: "Job number already exists — skipped (E3)." });
      }
    }

    // customer resolution (05 §2 orphan ref → warn; rebuild from job header)
    const custRow = row.data.customerLegacyId
      ? custByLegacy.get(row.data.customerLegacyId) ?? undefined
      : undefined;
    const dbByL = row.data.customerLegacyId ? dbByLegacy.get(row.data.customerLegacyId) : undefined;
    const resolvedName = String(custRow?.name ?? row.data.customerName).trim();
    const nameKey = resolvedName.toLowerCase();
    if (!custRow && !dbByL) {
      const nameHit = (nameKey && (custByName.get(nameKey) || dbByName.get(nameKey))) || undefined;
      if (!nameHit && !dbByName.get(nameKey) && !custByName.get(nameKey)) {
        issues.push({
          check: "orphan-customer",
          severity: "warn",
          message: "Job references missing customer — rebuilt from job header (catalog rebuild).",
        });
      } else {
        issues.push({ check: "orphan-customer", severity: "warn", message: "Job references missing customer id — matched by name." });
      }
    }
    if (dupNames.has(nameKey)) {
      issues.push({ check: "duplicate-customer", severity: "warn", message: "Duplicate customer name in file (merge candidate)." });
    }

    // stock events for this job
    const legacyJobId = row.data.legacyId;
    const events = legacyJobId ? stockByJob.get(legacyJobId) ?? [] : [];
    row.data.stockEvents = events.map((e) => ({
      legacyId: String(e.id ?? ""),
      lineLegacyId: typeof e.lineId === "string" ? e.lineId : null,
      type: STOCK_EVENT_TYPES.has(String(e.kind ?? ""))
        ? String(e.kind)
        : String(e.kind) === "line-removed"
          ? "line_removed"
          : "adjustment",
      qty: isInt(e.quantityReceived) ? (e.quantityReceived as number) : null,
      reason: str(e.note),
      ts: typeof e.at === "string" ? e.at : new Date().toISOString(),
      correctsLegacyId: str(e.correctsEventId),
      payload: JSON.stringify(e),
    }));

    const hasError = issues.some((i) => i.severity === "error");
    const hasSkip = issues.some((i) => i.severity === "skip");
    const hasWarn = issues.some((i) => i.severity === "warn");
    row.severity = hasError ? "error" : hasSkip ? "skip" : hasWarn ? "warn" : "create";
    row.issues = issues;
    rows.push(row);
  }
  return rows;
}

export function countRows(rows: ParsedRow[]): Counts {
  const counts: Counts = { create: 0, skip: 0, error: 0, warn: 0, info: 0 };
  for (const r of rows) {
    if (r.severity === "create") counts.create++;
    else if (r.severity === "skip") counts.skip++;
    else if (r.severity === "error") counts.error++;
    else if (r.severity === "warn") counts.warn++;
    if (r.issues.some((i) => i.severity === "info")) counts.info++;
  }
  return counts;
}

// ---- storage (E5) -----------------------------------------------------------
async function persistOriginal(text: string, fileName: string, actorId: string): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const key = `${randomUUID()}.json`;
  // disk write ordered BEFORE the tx commit — tx failure keeps the original (E5)
  await writeFile(path.join(UPLOAD_DIR, key), text, "utf8");
  const fileId = randomUUID();
  await withTransaction(async () => {
    await query(
      `INSERT INTO files (id, entity_type, name, size, mime, bucket, key, uploaded_by)
       VALUES ($1, 'import', $2, $3, 'application/json', 'local', $4, $5)`,
      [fileId, fileName, Buffer.byteLength(text, "utf8"), key, actorId],
    );
    await query(`INSERT INTO import_batches (id, kind, file_id, actor) VALUES ($1, 'v11-json', $2, $3)`, [
      randomUUID(),
      fileId,
      actorId,
    ]);
  });
  const b = await query<{ id: string }>(`SELECT id FROM import_batches WHERE file_id = $1`, [fileId]);
  return b[0].id;
}

function uploadPath(key: string): string | null {
  const resolved = path.resolve(UPLOAD_DIR, key);
  if (!resolved.startsWith(UPLOAD_DIR + path.sep)) return null; // [S4] path-traversal guard
  return resolved;
}

// ---- service: upload / parse / validate / preview ---------------------------
export type UploadResult = { batch: BatchRecord; counts: Counts; rows: ParsedRow[] };

export type BatchRecord = {
  id: string;
  kind: string;
  status: string;
  version: number;
  created: number;
  skipped: number;
  errors: unknown[] | null;
  result: Record<string, unknown> | null;
  actor: string | null;
  ts: string;
  fileName: string | null;
  fileSize: number | null;
};

const BATCH_SELECT = `
  SELECT b.id, b.kind, b.status, b.version, b.created, b.skipped, b.errors, b.result, b.actor, b.ts,
         f.name AS "fileName", f.size AS "fileSize"
  FROM import_batches b LEFT JOIN files f ON f.id = b.file_id`;

async function loadBatch(id: string): Promise<BatchRecord | null> {
  const rows = await query<BatchRecord>(`${BATCH_SELECT} WHERE b.id = $1`, [id]);
  return rows[0] ?? null;
}

async function batchOr404(id: string): Promise<BatchRecord> {
  const b = await loadBatch(id);
  if (!b) fail(404, "Import batch not found.", CODE_NOT_FOUND);
  return b!;
}

export async function uploadImport(text: string, fileName: string, user: SessionUser): Promise<UploadResult> {
  if (Buffer.byteLength(text, "utf8") > MAX_UPLOAD_BYTES) {
    fail(413, MSG_FILE_TOO_LARGE, CODE_IMPORT_FILE_TOO_LARGE);
  }
  const batchId = await persistOriginal(text, fileName, user.id);
  try {
    const detected = detectShape(text);
    if (detected.state.jobs.length > ROW_CAP) {
      fail(413, MSG_ROW_CAP, CODE_IMPORT_ROW_CAP);
    }
    const rows = await validateState(detected.state);
    const counts = countRows(rows);
    const payload: ParsedBatch = { rows, customers: detected.state.customers, products: detected.state.products };
    await query(`UPDATE import_batches SET parsed = $2, status = 'previewed', version = version + 1 WHERE id = $1`, [
      batchId,
      JSON.stringify(payload),
    ]);
    const batch = await batchOr404(batchId);
    return { batch, counts, rows };
  } catch (e) {
    const message = e instanceof ImportFailure ? e.message : "File could not be parsed.";
    const code = e instanceof ImportFailure ? e.code : CODE_IMPORT_SHAPE_INVALID;
    await query(`UPDATE import_batches SET status = 'failed', errors = $2, version = version + 1 WHERE id = $1`, [
      batchId,
      JSON.stringify([{ message, code }]),
    ]);
    throw e;
  }
}

export async function listBatches(): Promise<(BatchRecord & { counts: Counts | null })[]> {
  const rows = await query<BatchRecord>(`${BATCH_SELECT} ORDER BY b.ts DESC LIMIT 100`);
  const out: (BatchRecord & { counts: Counts | null })[] = [];
  for (const b of rows) {
    const parsed = await parsedOf(b.id);
    out.push({ ...b, counts: parsed ? countRows(parsed.rows) : null });
  }
  return out;
}

async function parsedOf(id: string): Promise<ParsedBatch | null> {
  const rows = await query<{ parsed: unknown }>(`SELECT parsed FROM import_batches WHERE id = $1`, [id]);
  const parsed = rows[0]?.parsed;
  if (!parsed) return null;
  if (Array.isArray(parsed)) return { rows: parsed as ParsedRow[], customers: [], products: [] }; // legacy shape
  const p = parsed as ParsedBatch;
  return { rows: p.rows ?? [], customers: p.customers ?? [], products: p.products ?? [] };
}

export type PreviewPage = {
  counts: Counts;
  total: number;
  page: number;
  pageSize: number;
  rows: ParsedRow[];
};

export async function previewBatch(
  id: string,
  opts: { page?: number; filter?: string } = {},
): Promise<PreviewPage> {
  await batchOr404(id);
  const parsed = (await parsedOf(id)) ?? { rows: [], customers: [], products: [] };
  const rows = parsed.rows;
  const counts = countRows(rows);
  const filter = opts.filter ?? "issues";
  const filtered =
    filter === "all"
      ? rows
      : filter === "issues"
        ? rows.filter((r) => r.severity !== "create" || r.issues.some((i) => i.severity !== "info"))
        : rows.filter((r) => r.severity === filter);
  const pageSize = 100;
  const page = Math.max(1, opts.page ?? 1);
  const slice = filtered.slice((page - 1) * pageSize, page * pageSize);
  return { counts, total: filtered.length, page, pageSize, rows: slice };
}

// ---- confirm / discard / revalidate (CAS version guards [3A]) ---------------
type CurrentPayload = { status: string; version: number };

function stale(batch: BatchRecord): ImportFailure {
  const current: CurrentPayload = { status: batch.status, version: batch.version };
  return new ImportFailure(
    409,
    "This import changed in another tab — reload.",
    CODE_STALE_BATCH,
    current,
  );
}

export async function confirmBatch(
  id: string,
  version: number,
  counts: Partial<Counts>,
  user: SessionUser,
): Promise<BatchRecord> {
  void user;
  const batch = await batchOr404(id);
  if (batch.status !== "previewed") throw stale(batch); // [3A] non-previewed / double-confirm → 409
  const parsed = (await parsedOf(id)) ?? { rows: [], customers: [], products: [] };
  const actual = countRows(parsed.rows);
  const submitted: Counts = {
    create: Number(counts.create ?? -1),
    skip: Number(counts.skip ?? -1),
    error: Number(counts.error ?? -1),
    warn: Number(counts.warn ?? -1),
    info: Number(counts.info ?? actual.info),
  };
  if (
    submitted.create !== actual.create ||
    submitted.skip !== actual.skip ||
    submitted.error !== actual.error ||
    submitted.warn !== actual.warn
  ) {
    fail(422, MSG_TYPED_COUNT, CODE_IMPORT_TYPED_COUNT, actual);
  }
  const updated = await query<{ id: string }>(
    `UPDATE import_batches SET status = 'confirmed', version = version + 1
     WHERE id = $1 AND status = 'previewed' AND version = $2 RETURNING id`,
    [id, version],
  );
  if (!updated[0]) throw stale(batch);
  return batchOr404(id);
}

export async function discardBatch(id: string, version: number): Promise<BatchRecord> {
  const batch = await batchOr404(id);
  const updated = await query<{ id: string }>(
    `UPDATE import_batches SET status = 'aborted', version = version + 1
     WHERE id = $1 AND status IN ('created', 'previewed', 'confirmed') AND version = $2 RETURNING id`,
    [id, version],
  );
  if (!updated[0]) fail(422, MSG_BATCH_STATE, CODE_IMPORT_BATCH_STATE, { status: batch.status, version: batch.version });
  return batchOr404(id);
}

// re-preview: re-read the original file, re-validate against current DB — a content change (version bump)
export async function revalidateBatch(id: string, user: SessionUser): Promise<BatchRecord> {
  const batch = await batchOr404(id);
  if (batch.status !== "previewed") fail(422, MSG_BATCH_STATE, CODE_IMPORT_BATCH_STATE, { status: batch.status, version: batch.version });
  const text = await readOriginalText(id);
  const detected = detectShape(text);
  const rows = await validateState(detected.state);
  const updated = await query<{ id: string }>(
    `UPDATE import_batches SET parsed = $2, version = version + 1
     WHERE id = $1 AND status = 'previewed' AND version = $3 RETURNING id`,
    [id, JSON.stringify(rows), batch.version],
  );
  if (!updated[0]) throw stale(batch);
  void user;
  return batchOr404(id);
}

// ---- execute (single tx, CAS claim, advisory lock, readiness in-tx) ---------
export type ExecuteResult = { batch: BatchRecord; counts: Counts; imported: number; downgraded: string[] };

export async function executeBatch(
  id: string,
  version: number,
  user: SessionUser,
  typedCount?: number,
): Promise<ExecuteResult> {
  const batch = await batchOr404(id);
  if (batch.status !== "confirmed") throw stale(batch); // [3A] CAS guard → 409 + current
  try {
    return await withTransaction(async () => {
      await query(`SET LOCAL statement_timeout = '120000'`);
      // single-flight per user [4A]; CAS claim on status+version [3A]
      await query(`SELECT pg_advisory_xact_lock(hashtext($1), 730201)`, [user.id]);
      const claim = await query<{ parsed: unknown }>(
        `UPDATE import_batches SET version = version + 1
         WHERE id = $1 AND status = 'confirmed' AND version = $2 RETURNING parsed`,
        [id, version],
      );
      if (!claim[0]) throw stale(batch);
      const parsed = normaliseParsed(claim[0].parsed);
      const preCounts = countRows(parsed.rows);
      // [H2/T3] typed confirm: server recomputes create count inside the tx —
      // required when create ≥ 50 or any warn (Q7.2); wrong token → 422 (client-bypass backstop)
      const typedRequired = preCounts.create >= 50 || preCounts.warn > 0;
      if ((typedRequired || typedCount !== undefined) && typedCount !== preCounts.create) {
        fail(422, MSG_TYPED_COUNT, CODE_IMPORT_TYPED_COUNT, preCounts);
      }
      const outcome = await executeRows(parsed, user);
      const counts = countRows(parsed.rows);
      await query(
        `UPDATE import_batches SET status = 'executed', created = $2, skipped = $3, result = $4, errors = NULL WHERE id = $1`,
        [id, outcome.imported, counts.skip + outcome.downgraded.length, JSON.stringify({
          counts,
          imported: outcome.imported,
          downgraded: outcome.downgraded,
        })],
      );
      return { batch: await batchOr404(id), counts, imported: outcome.imported, downgraded: outcome.downgraded };
    });
  } catch (e) {
    if (e instanceof ImportFailure) throw e;
    // tx rolled back — surface failure on the batch row (never silent, never partial)
    const message = e instanceof Error ? e.message : String(e);
    await query(
      `UPDATE import_batches SET status = 'failed', errors = $2, version = version + 1
       WHERE id = $1 AND status = 'confirmed'`,
      [id, JSON.stringify([{ message }])],
    );
    throw e;
  }
}

function normaliseParsed(parsed: unknown): ParsedBatch {
  if (!parsed) return { rows: [], customers: [], products: [] };
  if (Array.isArray(parsed)) return { rows: parsed as ParsedRow[], customers: [], products: [] };
  const p = parsed as ParsedBatch;
  return { rows: p.rows ?? [], customers: p.customers ?? [], products: p.products ?? [] };
}

async function executeRows(parsed: ParsedBatch, user: SessionUser): Promise<{ imported: number; downgraded: string[] }> {
  const deptRows = await query<{ id: string; name: string }>(`SELECT id, name FROM departments`);
  const deptByName = new Map(deptRows.map((d) => [d.name.toLowerCase(), d.id]));
  const rows = parsed.rows;
  const active = rows.filter((r) => r.severity === "create" || r.severity === "warn");

  // catalog import first (E3 add-only: existing legacy_id / master_sku skipped)
  const fileCustomerByLegacy = new Map<string, { id: string; name: string }>();
  for (const c of parsed.customers) {
    const id = typeof c.id === "string" ? c.id : null;
    const name = String(c.name ?? "").trim();
    if (!name) continue;
    if (id) fileCustomerByLegacy.set(id, { id, name });
    const newId = randomUUID();
    await query(
      `INSERT INTO customers (id, legacy_id, name, contact_name, email, phone, billing_address, default_dispatch_address, default_dispatch_method, account_ref, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (legacy_id) DO NOTHING`,
      [
        newId, id, name, str(c.contactName), str(c.email), str(c.phone),
        str(c.address), str(c.dispatchAddress), str(c.defaultDispatchMethod),
        str(c.accountReference), str(c.notes),
      ],
    );
    const resolved = await query<{ id: string }>(`SELECT id FROM customers WHERE legacy_id = $1`, [id]);
    if (resolved[0]) fileCustomerByLegacy.set(id ?? "", { id: resolved[0].id, name });
  }

  const fileProducts = parsed.products.map((pr) => ({
    id: typeof pr.id === "string" ? pr.id : null,
    sku: String(pr.sku ?? "").trim(),
    supplierSKU: str(pr.supplierSKU),
    buyingCost: pr.buyingCost != null ? String(pr.buyingCost) : null,
    name: String(pr.description ?? pr.sku ?? "").trim(),
  }));
  const fileProductBySku = new Map<string, (typeof fileProducts)[number]>();
  for (const fp of fileProducts) {
    if (!fp.sku) continue;
    fileProductBySku.set(fp.sku, fp);
    const productId = randomUUID();
    await query(`INSERT INTO products (id, legacy_id, name) VALUES ($1,$2,$3) ON CONFLICT (legacy_id) DO NOTHING`, [
      productId, fp.id, fp.name || fp.sku,
    ]);
    const prod = await query<{ id: string }>(`SELECT id FROM products WHERE legacy_id IS NOT DISTINCT FROM $1`, [fp.id]);
    await query(
      `INSERT INTO product_skus (id, legacy_id, product_id, master_sku, supplier_sku, colour)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (master_sku) DO NOTHING`,
      [randomUUID(), fp.id, prod[0]?.id ?? productId, fp.sku, fp.supplierSKU, str(fp.sku)],
    );
  }

  // link + dedupe maps (E3)
  const custLegacyIds = [...new Set(active.map((r) => r.data.customerLegacyId).filter((v): v is string => !!v))];
  const custNames = [...new Set(active.map((r) => r.data.customerName.trim().toLowerCase()).filter(Boolean))];
  const existingCust = await query<{ id: string; legacy_id: string | null; name: string }>(
    `SELECT id, legacy_id, name FROM customers WHERE legacy_id = ANY($1) OR lower(name) = ANY($2)`,
    [custLegacyIds, custNames],
  );
  const custByLegacy = new Map(existingCust.filter((r) => r.legacy_id).map((r) => [r.legacy_id as string, r.id]));
  const custByName = new Map(existingCust.map((r) => [r.name.trim().toLowerCase(), r.id]));

  const skuMaster = [...new Set(active.flatMap((r) => r.data.lines.map((l) => l.sku)).filter(Boolean))];
  const existingSkus = await query<{ id: string; master_sku: string; supplier_sku: string | null; product_id: string }>(
    `SELECT id, master_sku, supplier_sku, product_id FROM product_skus WHERE master_sku = ANY($1)`,
    [skuMaster],
  );
  const skuByMaster = new Map(existingSkus.map((r) => [r.master_sku, r]));

  // pre-assign uuids for stock events so correctsEventId can resolve inside the batch
  const eventUuidByLegacy = new Map<string, string>();
  for (const r of active) for (const e of r.data.stockEvents) eventUuidByLegacy.set(e.legacyId, randomUUID());

  let imported = 0;
  const downgraded: string[] = [];

  for (const row of active) {
    const d = row.data;
    // TOCTOU [X2]: job_number appeared after preview → downgrade to skip inside the tx
    if (d.jobNumber) {
      const clash = await query<{ id: string }>(`SELECT id FROM jobs WHERE job_number = $1`, [d.jobNumber]);
      if (clash[0]) {
        downgraded.push(d.jobNumber);
        continue;
      }
    }

    // customer (catalog already imported above; fall back to rebuild-from-header for orphans)
    let customerId: string | undefined =
      (d.customerLegacyId ? (custByLegacy.get(d.customerLegacyId) ?? fileCustomerByLegacy.get(d.customerLegacyId)?.id) : undefined) ??
      custByName.get(d.customerName.trim().toLowerCase());
    if (!customerId) {
      const newName = (d.customerName || "Unknown customer").trim();
      const newId = randomUUID();
      await query(
        `INSERT INTO customers (id, legacy_id, name, contact_name, email, phone, billing_address, default_dispatch_address, default_dispatch_method)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (legacy_id) DO NOTHING`,
        [newId, d.customerLegacyId, newName, d.contact.name, d.contact.email, d.contact.phone, d.contact.address, d.dispatch.address, d.dispatch.method],
      );
      const resolved = await query<{ id: string }>(
        `SELECT id FROM customers WHERE legacy_id IS NOT DISTINCT FROM $1 AND lower(name) = lower($2)`,
        [d.customerLegacyId, newName],
      );
      customerId = resolved[0]?.id ?? newId;
      custByName.set(newName.toLowerCase(), customerId);
      if (d.customerLegacyId) custByLegacy.set(d.customerLegacyId, customerId);
    }

    // job status: all stages done → completed (06 §2; shipments not imported → no part_dispatched)
    const stageDone = (s: NormalizedStage) => s.status === "completed" || (s.qty > 0 && s.completed >= s.qty);
    const status = d.stages.length > 0 && d.stages.every(stageDone) ? "completed" : "open";
    const jobId = randomUUID();
    await query(
      `INSERT INTO jobs (id, legacy_id, job_number, customer_id, po, print_name, order_date, order_type, priority,
                         staff, process_date, dispatch_date, dispatch_time, notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        jobId, d.legacyId, d.jobNumber || `IMPORT-${jobId.slice(0, 8)}`, customerId, d.po, d.printName,
        d.orderDate, d.orderType, d.priority, d.staff, d.processDate, d.dispatchDate, d.dispatchTime,
        d.notes, status, user.id,
      ],
    );
    await query(`INSERT INTO job_contact_snapshot (job_id, name, email, phone, address) VALUES ($1,$2,$3,$4,$5)`, [
      jobId, d.contact.name, d.contact.email, d.contact.phone, d.contact.address,
    ]);
    await query(`INSERT INTO job_dispatch_snapshot (job_id, method, address, instructions) VALUES ($1,$2,$3,$4)`, [
      jobId, d.dispatch.method, d.dispatch.address, d.dispatch.instructions,
    ]);

    // lines + sizes
    const lineIdByLegacy = new Map<string, string>();
    for (const l of d.lines) {
      const sku = skuByMaster.get(l.sku);
      const fp = fileProductBySku.get(l.sku);
      const supplierSku = l.supplierSku ?? sku?.supplier_sku ?? fp?.supplierSKU ?? null;
      const buyingCost = l.buyingCost ?? fp?.buyingCost ?? null;
      const lineId = randomUUID();
      await query(
        `INSERT INTO job_lines (id, legacy_id, job_id, product_sku_id, sku_text, supplier_sku, colour, qty_ordered,
                                unit_price, tax, buying_cost, stock_status, stock_ordered, stock_confirmed, stock_issue)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          lineId, l.legacyId, jobId, sku?.id ?? null, l.sku, supplierSku, l.colour, l.qtyOrdered,
          l.unitPrice, l.tax, buyingCost, l.stockStatus, l.stockOrdered, l.stockConfirmed, l.stockIssue,
        ],
      );
      if (l.legacyId) lineIdByLegacy.set(l.legacyId, lineId);
      for (const s of l.sizes) {
        await query(`INSERT INTO job_line_sizes (job_line_id, size, qty) VALUES ($1,$2,$3)`, [lineId, s.size, s.qty]);
      }
    }

    // stages (unique jobId+dept — first wins, dupes already warned at validate)
    for (const s of d.stages) {
      const deptId = deptByName.get(s.deptName.toLowerCase());
      if (!deptId) continue;
      const finished = s.status === "completed" ? (s.finishedAt ? new Date(s.finishedAt) : new Date()) : null;
      await query(
        `INSERT INTO job_stages (id, legacy_id, job_id, department_id, status, process_date, qty, progress, remaining,
                                 notes, waste, reprint_qty, finished_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (job_id, department_id) DO NOTHING`,
        [
          randomUUID(), s.legacyId, jobId, deptId, s.status, s.processDate, s.qty, s.completed,
          Math.max(0, s.qty - s.completed), s.notes, s.waste, s.reprint, finished,
        ],
      );
    }

    for (const p of d.positions) {
      await query(`INSERT INTO print_positions (id, job_id, name, pieces) VALUES ($1,$2,$3,$4)`, [
        randomUUID(), jobId, p.name, p.pieces,
      ]);
    }

    await query(
      `INSERT INTO screen_records (job_id, required, made, confirmed, not_required, notes) VALUES ($1,$2,$3,$4,$5,$6)`,
      [jobId, d.screens.required, d.screens.made, d.screens.confirmed, d.screens.notRequired, d.screens.notes],
    );
    await query(`INSERT INTO swatch_requirements (job_id, required) VALUES ($1, $2)`, [jobId, d.swatchRequired]);

    // artwork starts Draft (E3) — approvals never reconstructed (E4)
    if (d.artwork) {
      const artworkId = randomUUID();
      const versionId = randomUUID();
      await query(`INSERT INTO artworks (id, legacy_id, job_id, kind, current_version_id) VALUES ($1,$2,$3,$4,$5)`, [
        artworkId, d.legacyId, jobId, "print", versionId,
      ]);
      await query(
        `INSERT INTO artwork_versions (id, artwork_id, version, proof_ref, status, pantone_notes, created_by)
         VALUES ($1,$2,1,$3,'draft',$4,$5)`,
        [versionId, artworkId, d.artwork.proofRef, d.artwork.pantoneNotes, user.id],
      );
    }

    // stock events (append-only, corrects mapping, E4: no audit-history rows)
    for (const e of d.stockEvents) {
      const uuid = eventUuidByLegacy.get(e.legacyId) ?? randomUUID();
      const corrects = e.correctsLegacyId ? eventUuidByLegacy.get(e.correctsLegacyId) ?? null : null;
      await query(
        `INSERT INTO stock_events (id, legacy_id, job_id, job_line_id, type, qty, reason, payload, corrects_event_id, ts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (legacy_id) DO NOTHING`,
        [uuid, e.legacyId || null, jobId, e.lineLegacyId ? lineIdByLegacy.get(e.lineLegacyId) ?? null : null,
         e.type, e.qty, e.reason, e.payload, corrects, e.ts],
      );
    }

    await updateReadinessCache(jobId); // [17A] same tx as import
    imported++;
  }
  return { imported, downgraded };
}

// ---- original file + error CSV ----------------------------------------------
export async function readOriginal(id: string): Promise<{ name: string; bytes: Buffer }> {
  const batch = await batchOr404(id);
  const file = await query<{ name: string; key: string }>(`SELECT name, key FROM files WHERE id = (
    SELECT file_id FROM import_batches WHERE id = $1)`, [id]);
  const f = file[0];
  if (!f) fail(404, "File not found.", CODE_NOT_FOUND);
  const p = uploadPath(f.key);
  if (!p) fail(404, "File not found.", CODE_NOT_FOUND);
  try {
    const bytes = await readFile(p);
    return { name: batch.fileName ?? f.name, bytes };
  } catch {
    return fail(404, "File not found.", CODE_NOT_FOUND);
  }
}

async function readOriginalText(id: string): Promise<string> {
  const { bytes } = await readOriginal(id);
  return bytes.toString("utf8");
}

const csvCell = (v: unknown): string => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // [S2] neutralise formula injection
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
};

export async function errorCsv(id: string): Promise<string> {
  const parsed = (await parsedOf(id)) ?? { rows: [], customers: [], products: [] };
  const rows = parsed.rows;
  const lines = ["row,job_number,customer,severity,issues"];
  for (const r of rows) {
    if (r.severity !== "error" && r.severity !== "warn") continue;
    const issues = r.issues.map((i) => `${i.severity}: ${i.message}`).join("; ");
    lines.push([r.idx + 1, r.jobNumber, r.customer, r.severity, issues].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
