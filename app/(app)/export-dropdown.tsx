"use client";

import { useState } from "react";

type ExportView = { key: string; label: string };

// 9 human-labelled views — same [15A] gate as the API (import.export), page-level
// render guard lives in the server pages.
const EXPORT_VIEWS: ExportView[] = [
  { key: "jobs", label: "All jobs" },
  { key: "filtered-jobs", label: "Filtered jobs (current search)" },
  { key: "department", label: "Department status" },
  { key: "stock-shortage", label: "Stock shortages" },
  { key: "swatches", label: "Swatch attempts" },
  { key: "shipments", label: "Shipments" },
  { key: "audit", label: "Audit log" },
  { key: "customers", label: "Customers" },
  { key: "products", label: "Products / SKUs" },
];

export function ExportDropdown({ q }: { q?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(view: string) {
    setBusy(view);
    setError(null);
    setOpen(false);
    try {
      const qs = view === "filtered-jobs" && q ? `?q=${encodeURIComponent(q)}` : "";
      const res = await fetch(`/api/exports/${view}${qs}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Export failed (${res.status}).`);
        return;
      }
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `${view}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Export failed. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative inline-block text-left">
      {error && (
        <div
          role="alert"
          className="absolute right-0 top-full z-10 mt-2 w-80 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy !== null}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        {busy ? "Preparing…" : "Export"}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-64 rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-950">
          {EXPORT_VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => void download(v.key)}
              className="block w-full px-4 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              {v.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
