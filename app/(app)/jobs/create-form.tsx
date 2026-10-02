"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Customer = { id: string; name: string };

type Line = { skuText: string; colour: string; qtyOrdered: string };

export function JobCreateForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [jobNumber, setJobNumber] = useState("");
  const [printName, setPrintName] = useState("");
  const [po, setPo] = useState("");
  const [dispatchDate, setDispatchDate] = useState("");
  const [priority, setPriority] = useState("50");
  const [lines, setLines] = useState<Line[]>([{ skuText: "", colour: "", qtyOrdered: "" }]);

  useEffect(() => {
    if (!open || customers.length) return;
    fetch("/api/customers")
      .then((r) => (r.ok ? r.json() : { customers: [] }))
      .then((d) => setCustomers(d.customers ?? []));
  }, [open, customers.length]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobNumber,
          customerId,
          po: po || undefined,
          printName: printName || undefined,
          dispatchDate: dispatchDate || undefined,
          priority: Number(priority) || 50,
          orderDate: new Date().toISOString().slice(0, 10),
          lines: lines
            .filter((l) => l.skuText.trim())
            .map((l) => ({ skuText: l.skuText, colour: l.colour || undefined, qtyOrdered: Number(l.qtyOrdered) || 0 })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Create failed.");
        return;
      }
      setOpen(false);
      router.push(`/jobs/${data.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
      >
        New job
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-sm">
          Job number *
          <input required value={jobNumber} onChange={(e) => setJobNumber(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700" />
        </label>
        <label className="text-sm">
          Customer *
          <select required value={customerId} onChange={(e) => setCustomerId(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700">
            <option value="">Select…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Customer PO
          <input value={po} onChange={(e) => setPo(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700" />
        </label>
        <label className="text-sm">
          Print / job name
          <input value={printName} onChange={(e) => setPrintName(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700" />
        </label>
        <label className="text-sm">
          Dispatch date
          <input type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700" />
        </label>
        <label className="text-sm">
          Priority (1 = highest)
          <input type="number" min={1} max={999} value={priority} onChange={(e) => setPriority(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700" />
        </label>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Product lines *</span>
          <button type="button" onClick={() => setLines([...lines, { skuText: "", colour: "", qtyOrdered: "" }])}
            className="text-sm text-blue-600 hover:underline dark:text-blue-400">
            + Add line
          </button>
        </div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_6rem_auto] gap-2">
              <input placeholder="Master SKU *" value={l.skuText}
                onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, skuText: e.target.value } : x)))}
                className="rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700" />
              <input placeholder="Colour" value={l.colour}
                onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, colour: e.target.value } : x)))}
                className="rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700" />
              <input placeholder="Qty *" type="number" min={0} value={l.qtyOrdered}
                onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qtyOrdered: e.target.value } : x)))}
                className="rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700" />
              <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))}
                className="text-sm text-red-500 hover:underline">Remove</button>
            </div>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={busy}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
          {busy ? "Creating…" : "Create job"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-zinc-500 hover:text-zinc-700">
          Cancel
        </button>
      </div>
    </form>
  );
}
