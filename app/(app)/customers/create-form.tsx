"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CustomerCreateForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    contactName: "",
    email: "",
    phone: "",
    defaultDispatchMethod: "",
    defaultDispatchAddress: "",
    accountRef: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Create failed.");
        return;
      }
      setOpen(false);
      setForm({ name: "", contactName: "", email: "", phone: "", defaultDispatchMethod: "", defaultDispatchAddress: "", accountRef: "" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900">
        New customer
      </button>
    );
  }

  const field = (label: string, key: keyof typeof form, type = "text") => (
    <label className="text-sm">
      {label}
      <input
        type={type}
        required={key === "name"}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700"
      />
    </label>
  );

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="grid gap-4 sm:grid-cols-3">
        {field("Name *", "name")}
        {field("Contact", "contactName")}
        {field("Email", "email", "email")}
        {field("Phone", "phone")}
        {field("Default dispatch method", "defaultDispatchMethod")}
        {field("Account reference", "accountRef")}
        <label className="text-sm sm:col-span-3">
          Default dispatch address
          <input value={form.defaultDispatchAddress}
            onChange={(e) => setForm({ ...form, defaultDispatchAddress: e.target.value })}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700" />
        </label>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={busy}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
          {busy ? "Creating…" : "Create customer"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-zinc-500 hover:text-zinc-700">Cancel</button>
      </div>
    </form>
  );
}
