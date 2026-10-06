"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { dangerCls, btnCls, errorCls, fieldCls, send } from "../../../ui";

export function CancelJobButton({ jobId, status }: { jobId: string; status: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  if (status === "cancelled" || status === "completed") return null;

  async function cancel() {
    if (!reason.trim() || reason.trim().length < 3) {
      setError("A cancellation reason of at least 3 characters is required.");
      return;
    }
    setBusy(true);
    setError("");
    const r = await send("POST", `/api/jobs/${jobId}/cancel`, { reason: reason.trim() });
    setBusy(false);
    if (!r.ok) setError(r.error);
    else {
      setConfirming(false);
      setReason("");
      router.refresh();
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      {!confirming ? (
        <button onClick={() => { setConfirming(true); setError(""); }} className={dangerCls}>
          Cancel job
        </button>
      ) : (
        <span className="flex flex-wrap items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <label className="flex flex-col gap-1">
            Cancellation reason (required)
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this job being cancelled?"
              className={`${fieldCls} min-w-48`}
            />
          </label>
          <button onClick={() => void cancel()} disabled={busy} className={dangerCls}>
            {busy ? "Cancelling…" : "Confirm cancel"}
          </button>
          <button onClick={() => { setConfirming(false); setReason(""); setError(""); }} className={`${btnCls} !border-transparent !bg-transparent !text-zinc-700 dark:!text-zinc-300`}>
            Keep job
          </button>
        </span>
      )}
      {error && (
        <span role="status" aria-live="polite">
          <span className={errorCls}>{error}</span>
        </span>
      )}
    </span>
  );
}
