"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btnCls, dangerCls, errorCls, fieldCls, primaryCls } from "../../ui";

type Job = Record<string, unknown> & { id: string; version: number };

export function JobHeaderForm({ job }: { job: Job }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [form, setForm] = useState({
    po: String(job.po ?? ""),
    printName: String(job.print_name ?? ""),
    dispatchDate: String(job.dispatch_date ?? ""),
    processDate: String(job.process_date ?? ""),
    priority: String(job.priority ?? 50),
    staff: String(job.staff ?? ""),
    notes: String(job.notes ?? ""),
  });

  async function save() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: job.version,
          po: form.po || null,
          printName: form.printName || null,
          dispatchDate: form.dispatchDate || null,
          processDate: form.processDate || null,
          priority: Number(form.priority) || 50,
          staff: form.staff || null,
          notes: form.notes || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Save failed.");
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: job.version, archived: true }),
    });
    setBusy(false);
    setArchiveConfirm(false);
    if (res.ok) router.refresh();
    else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Archive failed.");
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setEditing(true)} className={btnCls}>
          Edit header
        </button>
        {!job.archived && !archiveConfirm && (
          <button onClick={() => setArchiveConfirm(true)} className={`${btnCls} !text-zinc-500`}>
            Archive
          </button>
        )}
        {archiveConfirm && (
          <span className="flex flex-wrap items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            Archive this job? It stays in the system but leaves active queues. No data is deleted.
            <button onClick={() => void archive()} disabled={busy} className={dangerCls}>
              {busy ? "Archiving…" : "Confirm archive"}
            </button>
            <button onClick={() => setArchiveConfirm(false)} className={`${btnCls} !border-transparent !bg-transparent !text-zinc-700 dark:!text-zinc-300`}>
              Keep job
            </button>
          </span>
        )}
        {error && (
          <p role="status" aria-live="polite" className="m-0">
            <span className={errorCls}>{error}</span>
          </p>
        )}
      </div>
    );
  }

  const field = (label: string, key: keyof typeof form, type = "text") => (
    <label className="text-sm">
      {label}
      <input
        type={type}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className={fieldCls}
      />
    </label>
  );

  return (
    <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="grid gap-4 sm:grid-cols-4">
        {field("Customer PO", "po")}
        {field("Print name", "printName")}
        {field("Priority", "priority", "number")}
        {field("Assigned staff", "staff")}
        {field("Process date", "processDate", "date")}
        {field("Dispatch date", "dispatchDate", "date")}
        <label className="text-sm sm:col-span-2">
          Notes
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className={fieldCls} />
        </label>
      </div>
      {error && (
        <p role="status" aria-live="polite" className="m-0">
          <span className={errorCls}>{error}</span>
        </p>
      )}
      <div className="flex gap-3">
        <button onClick={save} disabled={busy} className={primaryCls}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button onClick={() => setEditing(false)} className="text-sm text-zinc-500 hover:text-zinc-700">Cancel</button>
      </div>
    </div>
  );
}
