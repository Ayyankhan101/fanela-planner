"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputCls, btnCls, primaryCls, dangerCls, send, sectionCls, titleCls } from "../../../ui";

type Rec = Record<string, unknown>;

const METHODS = ["Collection", "DPD", "Same Day", "Fanela Van"] as const;

// mirror of lib/services/dispatch.ts SHIPMENT_FLOW — server stays authoritative
const SHIPMENT_FLOW: Record<string, string[]> = {
  draft: ["booking_arranged", "void"],
  booking_arranged: ["booked", "void"],
  booked: ["labels_attached", "void"],
  labels_attached: ["print_requested", "void"],
  print_requested: ["labels_printed", "void"],
  labels_printed: ["dispatched", "collected", "void"],
  dispatched: [],
  collected: [],
  void: [],
};
const LABEL: Record<string, string> = {
  draft: "Draft",
  booking_arranged: "Booking arranged",
  booked: "Booked",
  labels_attached: "Labels attached",
  print_requested: "Print requested",
  labels_printed: "Labels printed",
  dispatched: "Dispatched",
  collected: "Collected",
  void: "Void",
};

export function DispatchPanel({
  jobId,
  jobVersion,
  plan,
  shipments,
  canPlan,
  canDispatch,
}: {
  jobId: string;
  jobVersion: number;
  plan: { method: string | null; address: string | null };
  shipments: Rec[];
  canPlan: boolean;
  canDispatch: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [method, setMethod] = useState(plan.method ?? "");
  const [address, setAddress] = useState(plan.address ?? "");
  const [shipMethod, setShipMethod] = useState<string>(METHODS[1]);

  async function savePlan() {
    setBusy("plan");
    setError("");
    const r = await send("PATCH", `/api/jobs/${jobId}/dispatch`, {
      method: method || null,
      address: address || null,
      version: jobVersion,
    });
    setBusy("");
    if (!r.ok) setError(r.error);
    else router.refresh();
  }

  async function addShipment() {
    setBusy("add");
    setError("");
    const r = await send("POST", `/api/jobs/${jobId}/shipments`, { method: shipMethod, parcels: 1 });
    setBusy("");
    if (!r.ok) setError(r.error);
    else router.refresh();
  }

  async function advance(s: Rec, status: string) {
    let body: Record<string, unknown> = { version: Number(s.version ?? 0), status };
    if (status === "void") {
      const reason = prompt("Void reason (required):");
      if (!reason?.trim()) return;
      body = { ...body, reason: reason.trim() };
    }
    if (["dispatched", "collected"].includes(status) && String(s.method) === "Collection") {
      if (!confirm("Confirm this Collection has been handed over?")) return;
      body = { ...body, confirmCollection: true };
    }
    setBusy(`${String(s.id)}:${status}`);
    setError("");
    const r = await send("PATCH", `/api/shipments/${String(s.id)}`, body);
    setBusy("");
    if (!r.ok) setError(r.error);
    else router.refresh();
  }

  async function finalise(abandon: boolean) {
    let body: Record<string, unknown> = {};
    if (abandon) {
      const reason = prompt("Some shipments are not final. Abandon reason (required):");
      if (!reason?.trim()) return;
      body = { abandon: true, reason: reason.trim() };
    }
    setBusy(abandon ? "finalise-abandon" : "finalise");
    setError("");
    const r = await send("POST", `/api/jobs/${jobId}/dispatch/finalise`, body);
    setBusy("");
    if (!r.ok) setError(r.error);
    else router.refresh();
  }

  return (
    <section className={sectionCls}>
      <h2 className={titleCls}>Dispatch</h2>

      {canPlan && (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-zinc-500">
            Planned method
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={`${inputCls} mt-1 w-full`}>
              <option value="">—</option>
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-zinc-500 sm:col-span-2">
            Address
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={2}
              className={`${inputCls} mt-1 w-full`}
            />
          </label>
        </div>
      )}
      {canPlan && (
        <button onClick={savePlan} disabled={busy !== ""} className={`${btnCls} mt-2`}>
          {busy === "plan" ? "Saving…" : "Save dispatch plan"}
        </button>
      )}

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase text-zinc-500">Shipments</h3>
          {canDispatch && (
            <span className="flex items-center gap-2">
              <select value={shipMethod} onChange={(e) => setShipMethod(e.target.value)} className={`${inputCls} !py-1 text-xs`}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <button onClick={addShipment} disabled={busy !== ""} className={`${btnCls} !px-2 !py-1 !text-xs`}>
                {busy === "add" ? "…" : "+ Shipment"}
              </button>
            </span>
          )}
        </div>

        {shipments.length === 0 && <p className="text-sm text-zinc-500">No shipments yet.</p>}
        {shipments.map((s) => {
          const status = String(s.status);
          const next = SHIPMENT_FLOW[status] ?? [];
          return (
            <div key={String(s.id)} className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong>{String(s.method)}</strong>
                  {s.parcels != null ? ` · ${String(s.parcels)} parcel(s)` : ""}
                  {s.consignment ? ` · ${String(s.consignment)}` : ""}
                  {s.tracking ? ` · tracking ${String(s.tracking)}` : ""}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    ["dispatched", "collected"].includes(status)
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                      : status === "void"
                        ? "bg-zinc-100 text-zinc-400 line-through dark:bg-zinc-900"
                        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
                  }`}
                >
                  {LABEL[status] ?? status}
                </span>
              </div>
              {status === "void" && s.void_reason ? (
                <p className="mt-1 text-xs text-zinc-400">Void: {String(s.void_reason)}</p>
              ) : null}
              {canDispatch && next.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {next.map((t) => (
                    <button
                      key={t}
                      onClick={() => advance(s, t)}
                      disabled={busy !== ""}
                      className={`${btnCls} !px-2 !py-1 !text-xs ${t === "void" ? "!border-red-300 !text-red-600 dark:!border-red-900 dark:!text-red-400" : ""}`}
                    >
                      {busy === `${String(s.id)}:${t}` ? "…" : t === "void" ? "Void" : `→ ${LABEL[t]}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {canDispatch && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-900">
          <button onClick={() => finalise(false)} disabled={busy !== ""} className={primaryCls}>
            {busy === "finalise" ? "Finalising…" : "Finalise dispatch"}
          </button>
          <button onClick={() => finalise(true)} disabled={busy !== ""} className={dangerCls}>
            {busy === "finalise-abandon" ? "…" : "Finalise + abandon pending"}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
