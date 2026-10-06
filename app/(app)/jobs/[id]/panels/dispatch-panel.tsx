"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputCls, btnCls, dangerCls, errorCls, primaryCls, send, sectionCls, titleCls } from "../../../ui";

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
  // inline confirmations (DESIGN.md: no modals for destructive actions)
  const [voidPending, setVoidPending] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [handoverPending, setHandoverPending] = useState<string | null>(null);
  const [abandonForm, setAbandonForm] = useState(false);
  const [abandonReason, setAbandonReason] = useState("");

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
      if (!voidReason.trim()) {
        setError("A void reason is required.");
        return;
      }
      body = { ...body, reason: voidReason.trim() };
    }
    if (["dispatched", "collected"].includes(status) && String(s.method) === "Collection") {
      body = { ...body, confirmCollection: true };
    }
    setBusy(`${String(s.id)}:${status}`);
    setError("");
    const r = await send("PATCH", `/api/shipments/${String(s.id)}`, body);
    setBusy("");
    if (!r.ok) setError(r.error);
    else {
      setVoidPending(null);
      setVoidReason("");
      setHandoverPending(null);
      router.refresh();
    }
  }

  async function finalise(abandon: boolean) {
    let body: Record<string, unknown> = {};
    if (abandon) {
      if (!abandonReason.trim()) {
        setError("An abandon reason is required.");
        return;
      }
      body = { abandon: true, reason: abandonReason.trim() };
    }
    setBusy(abandon ? "finalise-abandon" : "finalise");
    setError("");
    const r = await send("POST", `/api/jobs/${jobId}/dispatch/finalise`, body);
    setBusy("");
    if (!r.ok) setError(r.error);
    else {
      setAbandonForm(false);
      setAbandonReason("");
      router.refresh();
    }
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase text-zinc-500">Shipments</h3>
          {canDispatch && (
            <span className="flex flex-wrap items-center gap-2">
              <select value={shipMethod} onChange={(e) => setShipMethod(e.target.value)} className={`${inputCls} !py-1 text-xs`}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <button onClick={addShipment} disabled={busy !== ""} className={`${btnCls} !px-2 !py-1 !text-xs`}>
                {busy === "add" ? "Adding…" : "+ Shipment"}
              </button>
            </span>
          )}
        </div>

        {shipments.length === 0 && <p className="text-sm text-zinc-500">No shipments yet.</p>}
        {shipments.map((s) => {
          const status = String(s.status);
          const next = SHIPMENT_FLOW[status] ?? [];
          const sid = String(s.id);
          return (
            <div key={sid} className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
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
                        ? "bg-zinc-100 text-zinc-500 line-through dark:bg-zinc-900 dark:text-zinc-500"
                        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
                  }`}
                >
                  {LABEL[status] ?? status}
                </span>
              </div>
              {status === "void" && s.void_reason ? (
                <p className="mt-1 text-xs text-zinc-500">Void: {String(s.void_reason)}</p>
              ) : null}
              {canDispatch && next.length > 0 && (
                <div className="mt-2 space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {next.map((t) => (
                      <button
                        key={t}
                        onClick={() => {
                          if (t === "void") {
                            setVoidPending(sid);
                            setVoidReason("");
                            setError("");
                          } else if (["dispatched", "collected"].includes(t) && String(s.method) === "Collection") {
                            setHandoverPending(sid);
                            setError("");
                          } else {
                            void advance(s, t);
                          }
                        }}
                        disabled={busy !== ""}
                        className={`${btnCls} !px-2 !py-1 !text-xs ${t === "void" ? "!border-red-300 !text-red-600 dark:!border-red-900 dark:!text-red-400" : ""}`}
                      >
                        {busy === `${sid}:${t}` ? "Updating…" : t === "void" ? "Void" : `→ ${LABEL[t]}`}
                      </button>
                    ))}
                  </div>
                  {voidPending === sid && (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-300 bg-red-50 px-2 py-2 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                      <label className="flex flex-col gap-1 text-xs">
                        Void reason (required)
                        <input
                          value={voidReason}
                          onChange={(e) => setVoidReason(e.target.value)}
                          placeholder="Why is this shipment void?"
                          className={`${inputCls} min-w-48`}
                        />
                      </label>
                      <button
                        onClick={() => {
                          const t = "void";
                          void advance(s, t);
                        }}
                        disabled={busy !== ""}
                        className={`${dangerCls} !px-2 !py-1 !text-xs`}
                      >
                        {busy === `${sid}:void` ? "Voiding…" : "Confirm void"}
                      </button>
                      <button
                        onClick={() => { setVoidPending(null); setVoidReason(""); setError(""); }}
                        className={`${btnCls} !px-2 !py-1 !text-xs !border-transparent !bg-transparent !text-zinc-700 dark:!text-zinc-300`}
                      >
                        Keep
                      </button>
                    </div>
                  )}
                  {handoverPending === sid && (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-2 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                      Confirm this Collection has been handed over?
                      <button
                        onClick={() => {
                          const t = status === "dispatched" ? "dispatched" : "collected";
                          void advance(s, t);
                        }}
                        disabled={busy !== ""}
                        className={`${btnCls} !px-2 !py-1 !text-xs`}
                      >
                        {busy === `${sid}:${status}` ? "Confirming…" : "Confirm handover"}
                      </button>
                      <button
                        onClick={() => setHandoverPending(null)}
                        className={`${btnCls} !px-2 !py-1 !text-xs !border-transparent !bg-transparent !text-zinc-700 dark:!text-zinc-300`}
                      >
                        Keep
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {canDispatch && (
        <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-900">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => finalise(false)} disabled={busy !== ""} className={primaryCls}>
              {busy === "finalise" ? "Finalising…" : "Finalise dispatch"}
            </button>
            <button onClick={() => { setAbandonForm(true); setError(""); }} disabled={busy !== ""} className={dangerCls}>
              Finalise + abandon pending
            </button>
          </div>
          {abandonForm && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-red-300 bg-red-50 px-2 py-2 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              <label className="flex flex-col gap-1 text-xs">
                Abandon reason (required)
                <input
                  value={abandonReason}
                  onChange={(e) => setAbandonReason(e.target.value)}
                  placeholder="Why are pending shipments abandoned?"
                  className={`${inputCls} min-w-48`}
                />
              </label>
              <button onClick={() => finalise(true)} disabled={busy !== ""} className={`${dangerCls} !px-2 !py-1 !text-xs`}>
                {busy === "finalise-abandon" ? "Finalising…" : "Confirm abandon"}
              </button>
              <button
                onClick={() => { setAbandonForm(false); setAbandonReason(""); setError(""); }}
                className={`${btnCls} !px-2 !py-1 !text-xs !border-transparent !bg-transparent !text-zinc-700 dark:!text-zinc-300`}
              >
                Keep pending
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <p role="status" aria-live="polite" className="mt-2">
          <span className={errorCls}>{error}</span>
        </p>
      )}
    </section>
  );
}
