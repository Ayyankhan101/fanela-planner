"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Job = Record<string, unknown> & { id: string; version: number };

export function JobHeaderForm({ job }: { job: Job }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
    if (!confirm("Archive this job? It stays in the system but leaves active queues. No data is deleted.")) return;
    const res = await fetch(`/api/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: job.version, archived: true }),
    });
    if (res.ok) router.refresh();
    else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Archive failed.");
    }
  }

  if (!editing) {
    return (
      <div className="flex gap-3">
        <button onClick={() => setEditing(true)}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">
          Edit header
        </button>
        {!job.archived && (
          <button onClick={archive} className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">
            Archive
          </button>
        )}
        {error && <span className="text-sm text-red-600">{error}</span>}
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
        className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700"
      />
    </label>
  );

  return (
    <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
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
            className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700" />
        </label>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3">
        <button onClick={save} disabled={busy}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
          {busy ? "Saving…" : "Save"}
        </button>
        <button onClick={() => setEditing(false)} className="text-sm text-zinc-500 hover:text-zinc-700">Cancel</button>
      </div>
    </div>
  );
}
