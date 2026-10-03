# CEO C4 spike — ExcelJS writer ceiling evidence

Date: 2026-10-02 · Task T9 first step (plan line 651) · Script: `scripts/c4-spike.mts`
Path under test: **production writer** `buildWorkbookBuffer()` in `lib/services/export.ts`
(styled header + zebra rows + frozen pane + autofilter, M4 cost columns present).

## Result (n=1, local macOS, Node v26.8.2, exceljs 4.4.x)

| Metric | Value |
|---|---|
| Rows × columns | 10,000 × 10 (incl. both M4 cost columns) |
| Wall time | **433 ms** |
| RSS before → after | 100.5 MB → 265.6 MB (**Δ 165.2 MB**) |
| Output buffer | 473,164 bytes (~462 KB) |

## Verdict

- Linear projection to the D18 row cap (100,000 rows): ~4.3 s wall, ~1.6 GB RSS —
  **acceptable as a failure ceiling only**, which is why the row-cap guard aborts at
  ≥100,000 rows *before* any buffer is built (`fetchExportRows` → 413 `export_row_cap`).
- Typical export sizes (500-job jobs view ≈ 500 rows) land in the **single-digit ms /
  low-MB** range — two orders of magnitude under the ceiling.
- Buffer-then-send (Q7.4) holds: full workbook exists in memory before response headers,
  so a failure mid-build is a clean non-2xx, never a truncated download.
- No streaming writer needed (ExcelJS decision line 82: streaming only if this spike
  demanded it — it did not).

Ceiling evidence for the Error & Rescue Registry row "Export write → workbook exceeds
RSS ceiling / request timeout". Re-run: `npx tsx scripts/c4-spike.mts`.
