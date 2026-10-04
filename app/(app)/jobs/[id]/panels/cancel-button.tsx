"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { dangerCls, send } from "../../../ui";

export function CancelJobButton({ jobId, status }: { jobId: string; status: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (status === "cancelled" || status === "completed") return null;

  async function cancel() {
    const reason = prompt("Cancellation reason (required):");
    if (!reason?.trim() || reason.trim().length < 3) return;
    setBusy(true);
    setError("");
    const r = await send("POST", `/api/jobs/${jobId}/cancel`, { reason: reason.trim() });
    setBusy(false);
    if (!r.ok) setError(r.error);
    else router.refresh();
  }

  return (
    <span className="flex items-center gap-2">
      <button onClick={cancel} disabled={busy} className={dangerCls}>
        {busy ? "Cancelling…" : "Cancel job"}
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </span>
  );
}
