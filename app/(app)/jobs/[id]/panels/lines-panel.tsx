"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btnCls, dangerCls, errorCls, send, sectionCls, titleCls } from "../../../ui";

type Rec = Record<string, unknown>;

export function LinesPanel({ jobId, lines, canEdit }: { jobId: string; lines: Rec[]; canEdit: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [confirmingId, setConfirmingId] = useState("");

  async function remove(l: Rec) {
    setBusy(String(l.id));
    setError("");
    const r = await send("DELETE", `/api/jobs/${jobId}/lines/${String(l.id)}`);
    setBusy("");
    setConfirmingId("");
    if (!r.ok) setError(r.error);
    else router.refresh();
  }

  return (
    <section className={sectionCls}>
      <h2 className={titleCls}>Lines</h2>
      <table className="w-full text-left text-xs">
        <thead className="text-xs uppercase text-zinc-500">
          <tr>
            <th className="py-1.5 pr-4 font-semibold">SKU</th>
            <th className="py-1.5 pr-4 font-semibold">Colour</th>
            <th className="py-1.5 pr-4 font-semibold">Ordered</th>
            <th className="py-1.5 pr-4 font-semibold">Stock</th>
            {canEdit && <th className="py-1.5 pr-4" />}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={String(l.id)} className="border-t border-zinc-100 dark:border-zinc-900">
              <td className="py-1.5 pr-4 font-mono text-xs">{String(l.sku_text)}</td>
              <td className="py-1.5 pr-4">{String(l.colour ?? "—")}</td>
              <td className="py-1.5 pr-4 font-mono text-xs">{String(l.qty_ordered)}</td>
              <td className="py-1.5 pr-4 text-xs text-zinc-500">{String(l.stock_status ?? "—")}</td>
              {canEdit && (
                <td className="py-1.5 pr-4 text-right">
                  {confirmingId === String(l.id) ? (
                    <span className="flex flex-wrap items-center justify-end gap-2">
                      <span className="text-xs text-zinc-600 dark:text-zinc-500">
                        Remove {String(l.sku_text)}? Stock history is kept.
                      </span>
                      <button
                        onClick={() => void remove(l)}
                        disabled={busy !== ""}
                        className={`${dangerCls} !px-2 !py-0.5 !text-xs`}
                      >
                        {busy === String(l.id) ? "Removing…" : "Confirm remove"}
                      </button>
                      <button onClick={() => setConfirmingId("")} className={`${btnCls} !px-2 !py-0.5 !text-xs`}>
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => { setConfirmingId(String(l.id)); setError(""); }}
                      disabled={busy !== ""}
                      className={`${btnCls} !px-2 !py-0.5 !text-xs !text-red-600 dark:!text-red-400`}
                    >
                      Remove
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {error && (
        <p role="status" aria-live="polite" className="mt-2">
          <span className={errorCls}>{error}</span>
        </p>
      )}
    </section>
  );
}
