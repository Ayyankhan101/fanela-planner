"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputCls, btnCls, send, sectionCls, titleCls } from "../../../ui";

type Rec = Record<string, unknown>;

// mirror of lib/services/stages.ts TRANSITIONS — server stays authoritative
const TRANSITIONS: Record<string, string[]> = {
  waiting: ["ready", "in_progress", "blocked"],
  ready: ["waiting", "in_progress", "blocked"],
  in_progress: ["ready", "blocked", "completed"],
  blocked: ["waiting", "ready", "in_progress"],
  completed: ["in_progress"],
};
const LABEL: Record<string, string> = {
  waiting: "Waiting",
  ready: "Ready",
  in_progress: "In progress",
  blocked: "Blocked",
  completed: "Completed",
};

export function StagesPanel({ jobId, stages, canStage }: { jobId: string; stages: Rec[]; canStage: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function move(s: Rec, status: string) {
    const key = `${String(s.id)}:${status}`;
    setBusy(key);
    setError("");
    const r = await send("PATCH", `/api/jobs/${jobId}/stages/${String(s.id)}`, {
      status,
      version: Number(s.version ?? 0),
    });
    setBusy("");
    if (!r.ok) setError(r.error);
    else router.refresh();
  }

  async function saveExtras(s: Rec) {
    const key = `${String(s.id)}:save`;
    setBusy(key);
    setError("");
    const progress = Number((document.getElementById(`progress-${String(s.id)}`) as HTMLInputElement)?.value ?? s.progress);
    const notes = String((document.getElementById(`notes-${String(s.id)}`) as HTMLInputElement)?.value ?? s.notes ?? "");
    const waste = Number((document.getElementById(`waste-${String(s.id)}`) as HTMLInputElement)?.value ?? 0);
    const reprint = Number((document.getElementById(`reprint-${String(s.id)}`) as HTMLInputElement)?.value ?? 0);
    const r = await send("PATCH", `/api/jobs/${jobId}/stages/${String(s.id)}`, {
      progress,
      notes: notes || null,
      waste,
      reprintQty: reprint,
      version: Number(s.version ?? 0),
    });
    setBusy("");
    if (!r.ok) setError(r.error);
    else router.refresh();
  }

  return (
    <section className={sectionCls}>
      <h2 className={titleCls}>Department stages</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {stages.map((s) => {
          const status = String(s.status);
          const next = TRANSITIONS[status] ?? [];
          return (
            <div key={String(s.id)} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{String(s.department_name)}</span>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                  {LABEL[status] ?? status}
                </span>
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                {String(s.progress)} / {String(s.qty)} {s.notes ? `· ${String(s.notes)}` : ""}
              </div>
              {canStage && (
                <div className="mt-2 space-y-2">
                  <div className="flex flex-wrap gap-1">
                    {next.map((t) => (
                      <button
                        key={t}
                        onClick={() => move(s, t)}
                        disabled={busy !== ""}
                        className={`${btnCls} !px-2 !py-1 !text-xs`}
                      >
                        {busy === `${String(s.id)}:${t}` ? "…" : LABEL[t]}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      id={`progress-${String(s.id)}`}
                      type="number"
                      min={0}
                      max={Number(s.qty ?? 0)}
                      defaultValue={Number(s.progress ?? 0)}
                      placeholder="Progress"
                      className={`${inputCls} w-full`}
                    />
                    <input
                      id={`waste-${String(s.id)}`}
                      type="number"
                      min={0}
                      defaultValue={Number(s.waste ?? 0)}
                      placeholder="Waste"
                      className={`${inputCls} w-full`}
                    />
                    <input
                      id={`reprint-${String(s.id)}`}
                      type="number"
                      min={0}
                      defaultValue={Number(s.reprint_qty ?? 0)}
                      placeholder="Reprint"
                      className={`${inputCls} w-full`}
                    />
                    <input
                      id={`notes-${String(s.id)}`}
                      defaultValue={String(s.notes ?? "")}
                      placeholder="Notes"
                      className={`${inputCls} w-full`}
                    />
                  </div>
                  <button onClick={() => saveExtras(s)} disabled={busy !== ""} className={`${btnCls} w-full`}>
                    {busy === `${String(s.id)}:save` ? "Saving…" : "Save"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {canStage && (
        <p className="mt-3 text-xs text-zinc-400">
          Department operators can update their own stage; Admin/Operations can update any.
        </p>
      )}
    </section>
  );
}
