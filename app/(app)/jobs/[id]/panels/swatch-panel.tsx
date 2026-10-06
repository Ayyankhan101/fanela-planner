"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputCls, btnCls, errorCls, primaryCls, send, sectionCls, titleCls } from "../../../ui";

type Rec = Record<string, unknown>;

const ATTEMPT_FLOW: Record<string, string[]> = {
  draft: ["in_progress"],
  in_progress: ["awaiting"],
  awaiting: ["approved", "rejected", "re_swatch"],
};
const LABEL: Record<string, string> = {
  draft: "Draft",
  in_progress: "In progress",
  awaiting: "Awaiting review",
  approved: "Approved",
  rejected: "Rejected",
  re_swatch: "Re-swatch",
};
const DECISIONS = new Set(["approved", "rejected", "re_swatch"]);
const REASON_REQUIRED = new Set(["rejected", "re_swatch"]);

export function SwatchPanel({
  jobId,
  requirement,
  attempts,
  canCreate,
  canDecide,
}: {
  jobId: string;
  requirement: Rec | null;
  attempts: Rec[];
  canCreate: boolean;
  canDecide: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [reason, setReason] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const required = Boolean(requirement?.required);
  const latest = attempts[attempts.length - 1];
  const latestOpen = latest && !["approved", "rejected", "re_swatch"].includes(String(latest.status));

  async function setRequirement(val: boolean) {
    if (!val && !reason.trim()) {
      setError("Waiving the requirement needs a reason.");
      return;
    }
    setBusy(`req-${val}`);
    setError("");
    const r = await send("PATCH", `/api/jobs/${jobId}/swatch`, { required: val, confirm: true, reason: reason.trim() || undefined });
    setBusy("");
    if (!r.ok) setError(r.error);
    else {
      setReason("");
      router.refresh();
    }
  }

  async function move(a: Rec, status: string, needsReason: boolean) {
    if (needsReason && !reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setBusy(`${String(a.id)}:${status}`);
    setError("");
    const r = await send("PATCH", `/api/jobs/${jobId}/swatch/attempts/${String(a.id)}`, {
      status,
      reason: reason.trim() || undefined,
      version: Number(a.version ?? 0),
    });
    setBusy("");
    if (!r.ok) setError(r.error);
    else {
      setReason("");
      router.refresh();
    }
  }

  async function createAttempt() {
    setBusy("create");
    setError("");
    const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value;
    const body: Record<string, unknown> = {};
    if (val("sw-sample")) body.sampleQty = Number(val("sw-sample"));
    if (val("sw-machine")) body.machine = val("sw-machine");
    if (val("sw-placement")) body.placement = val("sw-placement");
    if (val("sw-notes")) body.notes = val("sw-notes");
    const r = await send("POST", `/api/jobs/${jobId}/swatch/attempts`, body);
    setBusy("");
    if (!r.ok) setError(r.error);
    else {
      setShowCreate(false);
      router.refresh();
    }
  }

  return (
    <section className={sectionCls}>
      <h2 className={titleCls}>Swatch (embroidery gate)</h2>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>
          Requirement: <strong>{required ? "required" : "not required"}</strong>
          {!required && requirement?.waived_reason ? (
            <span className="ml-1 text-xs text-zinc-500">— {String(requirement.waived_reason)}</span>
          ) : null}
        </span>
        {canDecide && (
          <span className="flex gap-2">
            <button onClick={() => setRequirement(true)} disabled={busy !== ""} className={btnCls}>
              {busy === "req-true" ? "Updating…" : "Require"}
            </button>
            <button onClick={() => setRequirement(false)} disabled={busy !== ""} className={btnCls}>
              {busy === "req-false" ? "Updating…" : "Waive"}
            </button>
          </span>
        )}
      </div>

      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (waive / reject / re-swatch)"
        className={`${inputCls} mt-2 w-full sm:w-96`}
      />

      <div className="mt-3 space-y-2">
        {attempts.length === 0 && <p className="text-sm text-zinc-500">No attempts yet.</p>}
        {attempts.map((a) => {
          const status = String(a.status);
          const next = ATTEMPT_FLOW[status] ?? [];
          return (
            <div key={String(a.id)} className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <span>
                  Attempt #{String(a.attempt_no)}
                  {a.machine ? ` · ${String(a.machine)}` : ""}
                  {a.placement ? ` · ${String(a.placement)}` : ""}
                </span>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                  {LABEL[status] ?? status}
                </span>
              </div>
              {a.notes ? <p className="mt-1 text-xs text-zinc-500">{String(a.notes)}</p> : null}
              {canCreate && next.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {next.map((t) => (
                    <button
                      key={t}
                      onClick={() => move(a, t, REASON_REQUIRED.has(t))}
                      disabled={busy !== ""}
                      className={`${btnCls} !px-2 !py-1 !text-xs ${t === "approved" ? "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400" : ""}`}
                    >
                      {busy === `${String(a.id)}:${t}` ? "Updating…" : LABEL[t]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {canCreate && (
        <div className="mt-3">
          {!showCreate ? (
            <button onClick={() => setShowCreate(true)} disabled={Boolean(latestOpen)} className={primaryCls}>
              New attempt
            </button>
          ) : (
            <div className="space-y-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="grid grid-cols-2 gap-2">
                <input id="sw-sample" type="number" min={1} placeholder="Sample qty" className={inputCls} />
                <input id="sw-machine" placeholder="Machine" className={inputCls} />
                <input id="sw-placement" placeholder="Placement" className={inputCls} />
                <input id="sw-notes" placeholder="Notes" className={inputCls} />
              </div>
              <div className="flex gap-2">
                <button onClick={createAttempt} disabled={busy !== ""} className={primaryCls}>
                  {busy === "create" ? "Creating…" : "Create"}
                </button>
                <button onClick={() => setShowCreate(false)} className={btnCls}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          <p className="mt-2 text-xs text-zinc-500">
            Attempts: start → awaiting → approve/reject/re-swatch. Terminal attempts are immutable.
          </p>
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
