// CEO C4 spike: ExcelJS 10k-row styled workbook through the production writer path
// (lib/services/export.ts buildWorkbookBuffer), with the M4 cost-column selection applied.
import "dotenv/config";
import { performance } from "node:perf_hooks";
import { buildWorkbookBuffer, type ExportColumn } from "../lib/services/export";

const ROWS = 10_000;
const cols: ExportColumn[] = [
  { key: "job_number", header: "job number" },
  { key: "sku", header: "sku" },
  { key: "colour", header: "colour" },
  { key: "qty_ordered", header: "qty ordered" },
  { key: "stock_status", header: "stock status" },
  { key: "stock_issue", header: "stock issue" },
  { key: "stock_ordered", header: "stock ordered" },
  { key: "stock_confirmed", header: "stock confirmed" },
  { key: "unit_price", header: "unit_price" }, // costs-only column (M4 selection)
  { key: "buying_cost", header: "Buying Cost" }, // costs-only column (M4 selection)
];

const rows = Array.from({ length: ROWS }, (_, i) => ({
  job_number: `SPK-${String(i).padStart(6, "0")}`,
  sku: `SKU-${i % 997}`,
  colour: ["White", "Black", "Navy", "Red"][i % 4],
  qty_ordered: 10 + (i % 90),
  stock_status: ["Complete", "Partial", "Not Ordered"][i % 3],
  stock_issue: i % 7 === 0 ? "Short" : null,
  stock_ordered: i % 2 === 0,
  stock_confirmed: i % 3 === 0,
  unit_price: (9.99 + (i % 50)).toFixed(2),
  buying_cost: (4.5 + (i % 20)).toFixed(2),
}));

const mb = (n: number) => Math.round((n / 1024 / 1024) * 10) / 10;
const rssBefore = process.memoryUsage().rss;
const t0 = performance.now();
const buffer = await buildWorkbookBuffer(cols, rows);
const wallMs = Math.round(performance.now() - t0);
const rssAfter = process.memoryUsage().rss;

console.log(
  JSON.stringify(
    {
      rows: ROWS,
      columns: cols.length,
      wallMs,
      rssBeforeMB: mb(rssBefore),
      rssAfterMB: mb(rssAfter),
      rssDeltaMB: mb(rssAfter - rssBefore),
      bufferBytes: buffer.length,
    },
    null,
    2,
  ),
);
