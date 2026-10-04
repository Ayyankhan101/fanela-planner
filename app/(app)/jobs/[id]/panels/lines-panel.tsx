"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btnCls, send, sectionCls, titleCls } from "../../../ui";

type Rec = Record<string, unknown>;

export function LinesPanel({ jobId, lines, canEdit }: { jobId: string; lines: Rec[]; canEdit: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function remove(l: Rec) {
    if (!confirm(`Remove line ${String(l.sku_text)}? Stock history for it is kept.`)) return;
    setBusy(String(l.id));
    setError("");
    const r = await send("DELETE", `/api/jobs/${jobId}/lines/${String(l.id)}`);
    setBusy("");
    if (!r.ok) setError(r.error);
    else router.refresh();
  }

  return (
    <section className={sectionCls}>
      <h2 className={titleCls}>Lines</h2>
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-zinc-500">
          <tr>
            <th className="py-1 pr-4">SKU</th>
            <th className="py-1 pr-4">Colour</th>
            <th className="py-1 pr-4">Ordered</th>
            <th className="py-1 pr-4">Stock</th>
            {canEdit && <th className="py-1 pr-4" />}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={String(l.id)} className="border-t border-zinc-100 dark:border-zinc-900">
              <td className="py-1.5 pr-4 font-mono text-xs">{String(l.sku_text)}</td>
              <td className="py-1.5 pr-4">{String(l.colour ?? "—")}</td>
              <td className="py-1.5 pr-4">{String(l.qty_ordered)}</td>
              <td className="py-1.5 pr-4 text-xs text-zinc-500">{String(l.stock_status ?? "—")}</td>
              {canEdit && (
                <td className="py-1.5 pr-4 text-right">
                  <button onClick={() => remove(l)} disabled={busy !== ""} className={`${btnCls} !px-2 !py-0.5 !text-xs`}>
                    {busy === String(l.id) ? "…" : "Remove"}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
