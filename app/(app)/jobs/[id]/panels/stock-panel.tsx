"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputCls, btnCls, errorCls, send, sectionCls, titleCls } from "../../../ui";

type Rec = Record<string, unknown>;

const ISSUES = ["Short", "Backorder", "Picking Error", "Damaged / Incorrect Stock"] as const;

export function StockPanel({ jobId, stock, canStock }: { jobId: string; stock: Rec | null; canStock: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  if (!stock) return null;
  const lines = (stock.lines as Rec[]) ?? [];

  async function patch(line: Rec, input: Record<string, unknown>) {
    setBusy(String(line.id));
    setError("");
    const r = await send("PATCH", `/api/jobs/${jobId}/stock`, {
      lineId: String(line.id),
      version: Number(line.version ?? 0),
      ...input,
    });
    setBusy("");
    if (!r.ok) setError(r.error);
    else router.refresh();
  }

  async function receive(line: Rec) {
    const input = document.getElementById(`rcv-${String(line.id)}`) as HTMLInputElement | null;
    const qty = Number(input?.value ?? 0);
    if (!input || qty <= 0) {
      setError("Enter a receipt quantity above zero.");
      return;
    }
    await patch(line, { receipt: { qty } });
  }

  return (
    <section className={sectionCls}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className={`${titleCls} mb-0`}>Stock</h2>
        <span className="text-xs text-zinc-500">
          ordered {String(stock.ordered)} · received {String(stock.received)} · outstanding {String(stock.outstanding)}
          {stock.allConfirmed ? " · all confirmed" : ""}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-zinc-500">
            <tr>
              <th className="py-1 pr-4">SKU</th>
              <th className="py-1 pr-4">Ordered</th>
              <th className="py-1 pr-4">Received</th>
              <th className="py-1 pr-4">Issue</th>
              <th className="py-1 pr-4">Flags</th>
              {canStock && <th className="py-1 pr-4">Receive</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={String(l.id)} className="border-t border-zinc-100 dark:border-zinc-900">
                <td className="py-1.5 pr-4 font-mono text-xs">{String(l.sku)}</td>
                <td className="py-1.5 pr-4">{String(l.qtyOrdered)}</td>
                <td className="py-1.5 pr-4">{String(l.received ?? 0)}</td>
                <td className="py-1.5 pr-4">
                  {canStock ? (
                    <select
                      value={l.issue == null ? "" : String(l.issue)}
                      onChange={(e) => patch(l, { stockIssue: e.target.value === "" ? null : e.target.value })}
                      disabled={busy === String(l.id)}
                      className={`${inputCls} !py-1 text-xs`}
                    >
                      <option value="">No issue</option>
                      {ISSUES.map((i) => (
                        <option key={i} value={i}>
                          {i}
                        </option>
                      ))}
                    </select>
                  ) : l.issue ? (
                    String(l.issue)
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-1.5 pr-4 text-xs">
                  {canStock ? (
                    <span className="flex gap-3">
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={Boolean(l.stockOrdered)}
                          disabled={busy === String(l.id)}
                          onChange={(e) => patch(l, { stockOrdered: e.target.checked })}
                        />
                        ordered
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={Boolean(l.confirmed)}
                          disabled={busy === String(l.id)}
                          onChange={(e) => patch(l, { stockConfirmed: e.target.checked })}
                        />
                        confirmed
                      </label>
                    </span>
                  ) : (
                    <span className="text-zinc-500">
                      {l.stockOrdered ? "ordered " : ""}
                      {l.confirmed ? "confirmed" : ""}
                    </span>
                  )}
                </td>
                {canStock && (
                  <td className="py-1.5 pr-4">
                    <span className="flex gap-1.5">
                      <input id={`rcv-${String(l.id)}`} type="number" min={0} placeholder="qty" className={`${inputCls} !py-1 w-16 text-xs`} />
                      <button onClick={() => receive(l)} disabled={busy === String(l.id)} className={`${btnCls} !px-2 !py-1 !text-xs`}>
                        {busy === String(l.id) ? "Receiving…" : "In"}
                      </button>
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canStock && <p className="mt-2 text-xs text-zinc-500">Receipts append to the stock ledger — corrections are recorded, never overwritten.</p>}
      {error && (
        <p role="status" aria-live="polite" className="mt-2">
          <span className={errorCls}>{error}</span>
        </p>
      )}
    </section>
  );
}
