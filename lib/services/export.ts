// Generic Excel export (E1/E2/E7/M4, plan [9A]/[15A]/[16A]):
// one SQL statement per view, write-time column selection (never generate-then-redact),
// buffer-then-send (Q7.4), row-cap abort before buffer blowup (D18 knob: 100,000).
import ExcelJS from "exceljs";
import type { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { err } from "@/lib/http";
import { can } from "@/lib/auth/access";
import type { SessionUser } from "@/lib/auth/session";
import { MSG_EXPORT_ROW_CAP, CODE_EXPORT_ROW_CAP } from "@/lib/errors";

export const EXPORT_VIEWS = [
  "jobs",
  "filtered-jobs",
  "department",
  "stock-shortage",
  "swatches",
  "shipments",
  "audit",
  "customers",
  "products",
] as const;

export type ExportView = (typeof EXPORT_VIEWS)[number];

export function isExportView(v: string): v is ExportView {
  return (EXPORT_VIEWS as readonly string[]).includes(v);
}

export const EXPORT_ROW_CAP = 100_000; // D18 knob — validated by the CEO C4 spike record

export type ExportColumn = { key: string; header: string; costsOnly?: boolean };
type Column = ExportColumn;

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function dateCols(...keys: string[]): Column[] {
  return keys.map((k) => ({ key: k, header: k.replace(/_/g, " ") }));
}

// M4/E7: cost columns selected only for cost viewers, at write time.
function columnsFor(view: ExportView, costsView: boolean): { cols: Column[]; sql: string; params: unknown[] } {
  const cap = `LIMIT ${EXPORT_ROW_CAP}`;
  const all = (...cols: Column[]) => cols;
  switch (view) {
    case "jobs":
      return {
        sql: `SELECT j.job_number, c.name AS customer, j.status, j.priority,
                     j.order_type, j.po, j.print_name, j.staff, j.dispatch_time, j.archived,
                     to_char(j.order_date,'YYYY-MM-DD') AS order_date,
                     to_char(j.process_date,'YYYY-MM-DD') AS process_date,
                     to_char(j.dispatch_date,'YYYY-MM-DD') AS dispatch_date,
                     (SELECT count(*)::int FROM job_lines l WHERE l.job_id = j.id) AS line_count,
                     j.notes
                FROM jobs j JOIN customers c ON c.id = j.customer_id
               WHERE NOT j.archived
               ORDER BY j.dispatch_date ASC NULLS LAST, j.priority ASC, j.job_number
               ${cap}`,
        params: [],
        cols: all(
          ...dateCols(
            "job_number", "customer", "status", "priority", "order_type", "order_date",
            "process_date", "dispatch_date", "dispatch_time", "po", "print_name", "staff",
            "line_count", "archived", "notes",
          ),
        ),
      };
    case "filtered-jobs":
      return {
        sql: `SELECT j.job_number, c.name AS customer, j.status, j.priority,
                     to_char(j.order_date,'YYYY-MM-DD') AS order_date,
                     to_char(j.process_date,'YYYY-MM-DD') AS process_date,
                     to_char(j.dispatch_date,'YYYY-MM-DD') AS dispatch_date,
                     j.dispatch_time, j.notes
                FROM jobs j JOIN customers c ON c.id = j.customer_id
               WHERE NOT j.archived
                 AND ($1::text IS NULL
                      OR j.job_number ILIKE $1 OR c.name ILIKE $1 OR coalesce(j.po,'') ILIKE $1
                      OR coalesce(j.print_name,'') ILIKE $1
                      OR EXISTS (SELECT 1 FROM job_lines l WHERE l.job_id = j.id
                                 AND (l.sku_text ILIKE $1 OR coalesce(l.supplier_sku,'') ILIKE $1)))
               ORDER BY j.dispatch_date ASC NULLS LAST, j.priority ASC, j.job_number
               ${cap}`,
        params: ["%FILTER%"],
        cols: all(...dateCols("job_number", "customer", "status", "priority", "order_date", "process_date", "dispatch_date", "dispatch_time", "notes")),
      };
    case "department":
      return {
        sql: `SELECT j.job_number, d.name AS department, s.status, s.qty, s.progress, s.remaining,
                     s.waste, s.reprint_qty,
                     to_char(s.process_date,'YYYY-MM-DD') AS process_date
                FROM job_stages s
                JOIN jobs j ON j.id = s.job_id
                JOIN departments d ON d.id = s.department_id
               ORDER BY d.name, j.job_number
               ${cap}`,
        params: [],
        cols: all(...dateCols("job_number", "department", "status", "qty", "progress", "remaining", "waste", "reprint_qty", "process_date")),
      };
    case "stock-shortage": {
      const cols = all(
        ...dateCols(
          "job_number", "sku", "colour", "qty_ordered", "stock_status", "stock_issue",
          "stock_ordered", "stock_confirmed",
        ),
      );
      if (costsView) {
        cols.push({ key: "unit_price", header: "unit_price" }, { key: "buying_cost", header: "Buying Cost" });
      }
      return {
        sql: `SELECT j.job_number, l.sku_text AS sku, l.colour, l.qty_ordered,
                     l.stock_status, l.stock_issue, l.stock_ordered, l.stock_confirmed,
                     l.unit_price, l.buying_cost
                FROM job_lines l JOIN jobs j ON j.id = l.job_id
               WHERE l.stock_issue IS NOT NULL
                  OR l.stock_status IN ('Short','Backorder','Picking Error','Damaged / Incorrect Stock')
               ORDER BY j.job_number, l.sku_text
               ${cap}`,
        params: [],
        cols,
      };
    }
    case "swatches":
      return {
        sql: `SELECT j.job_number, a.attempt_no, a.status, a.sample_qty, a.placement, a.machine,
                     a.thread_colours, a.stitch_count,
                     to_char(a.started_at,'YYYY-MM-DD HH24:MI') AS started_at,
                     to_char(a.completed_at,'YYYY-MM-DD HH24:MI') AS completed_at,
                     to_char(a.decided_at,'YYYY-MM-DD HH24:MI') AS decided_at,
                     a.reason
                FROM swatch_attempts a JOIN jobs j ON j.id = a.job_id
               ORDER BY j.job_number, a.attempt_no
               ${cap}`,
        params: [],
        cols: all(...dateCols("job_number", "attempt_no", "status", "sample_qty", "placement", "machine", "thread_colours", "stitch_count", "started_at", "completed_at", "decided_at", "reason")),
      };
    case "shipments":
      return {
        sql: `SELECT j.job_number, s.method, s.status, s.parcels, s.consignment, s.tracking,
                     s.label_printed, s.print_requests, s.reprints, s.voided, s.void_reason,
                     to_char(s.booked_at,'YYYY-MM-DD HH24:MI') AS booked_at,
                     to_char(s.final_at,'YYYY-MM-DD HH24:MI') AS final_at
                FROM shipments s JOIN jobs j ON j.id = s.job_id
               ORDER BY j.job_number, s.created_at
               ${cap}`,
        params: [],
        cols: all(...dateCols("job_number", "method", "status", "parcels", "consignment", "tracking", "label_printed", "print_requests", "reprints", "voided", "void_reason", "booked_at", "final_at")),
      };
    case "audit":
      // E7: order-lines (cost-bearing) rows only for cost viewers
      return {
        sql: `SELECT to_char(a.ts,'YYYY-MM-DD HH24:MI:SS') AS ts, a.action, a.entity_type,
                     j.job_number, a.actor_role
                FROM operational_audit a
                LEFT JOIN jobs j ON j.id = a.job_id
               WHERE ($1::bool OR a.action <> 'order-lines')
               ORDER BY a.ts DESC
               ${cap}`,
        params: [costsView],
        cols: all(...dateCols("ts", "action", "entity_type", "job_number", "actor_role")),
      };
    case "customers":
      return {
        sql: `SELECT name, contact_name, email, phone, billing_address,
                     default_dispatch_address, default_dispatch_method,
                     account_ref, notes, active
                FROM customers
               ORDER BY name
               ${cap}`,
        params: [],
        cols: all(...dateCols("name", "contact_name", "email", "phone", "billing_address", "default_dispatch_address", "default_dispatch_method", "account_ref", "notes", "active")),
      };
    case "products":
      return {
        sql: `SELECT s.master_sku, s.supplier_sku, p.name AS product, s.colour, s.active
                FROM product_skus s JOIN products p ON p.id = s.product_id
               ORDER BY s.master_sku
               ${cap}`,
        params: [],
        cols: all(...dateCols("master_sku", "supplier_sku", "product", "colour", "active")),
      };
  }
}

type Rows = Record<string, unknown>[];

export async function fetchExportRows(
  view: ExportView,
  user: SessionUser,
  opts: { q?: string | null } = {},
): Promise<{ cols: Column[]; rows: Rows } | { error: NextResponse }> {
  const costsView = can(user, "costs.view");
  const spec = columnsFor(view, costsView);
  const params = spec.params.map((p) => (p === "%FILTER%" ? (opts.q ? `%${opts.q}%` : null) : p));
  const rows = await query<Rows[number]>(spec.sql, params);
  if (rows.length >= EXPORT_ROW_CAP) {
    return { error: err(413, MSG_EXPORT_ROW_CAP, CODE_EXPORT_ROW_CAP) };
  }
  return { cols: spec.cols, rows };
}

// Production writer path — shared by the route and the CEO C4 spike.
export async function buildWorkbookBuffer(cols: Column[], rows: Rows): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Export");
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: Math.min(40, Math.max(12, c.header.length + 4)) }));
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF35507A" } };
  header.alignment = { vertical: "middle" };
  rows.forEach((r, i) => {
    const row = ws.addRow(r);
    if (i % 2 === 1) {
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F6FA" } };
    }
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function exportWorkbook(
  view: ExportView,
  user: SessionUser,
  opts: { q?: string | null } = {},
): Promise<{ buffer: Buffer; filename: string; contentType: string } | { error: NextResponse }> {
  const data = await fetchExportRows(view, user, opts);
  if ("error" in data) return data;
  const buffer = await buildWorkbookBuffer(data.cols, data.rows);
  const date = new Date().toISOString().slice(0, 10);
  return { buffer, filename: `${view}-${date}.xlsx`, contentType: XLSX_MIME };
}
