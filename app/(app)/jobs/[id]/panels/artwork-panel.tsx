"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputCls, btnCls, errorCls, primaryCls, send, sectionCls, titleCls } from "../../../ui";

type Rec = Record<string, unknown>;

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  awaiting: "Awaiting approval",
  approved: "Approved",
  rejected: "Rejected",
};

export function ArtworkPanel({ jobId, artwork, canArtwork }: { jobId: string; artwork: Rec | null; canArtwork: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [reason, setReason] = useState("");
  const [proofRef, setProofRef] = useState("");
  const [pantone, setPantone] = useState("");

  if (!artwork) return null;
  const status = String(artwork.status);
  const version = Number(artwork.version ?? 0);
  const versions = (artwork.versions as Rec[]) ?? [];
  const events = (artwork.events as Rec[]) ?? [];

  async function action(act: string, needsReason: boolean) {
    if (needsReason && !reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setBusy(act);
    setError("");
    const body: Record<string, unknown> = { version };
    if (act) body.action = act;
    if (reason.trim()) body.reason = reason.trim();
    if (proofRef) body.proofRef = proofRef;
    if (pantone) body.pantoneNotes = pantone;
    const r = await send("PATCH", `/api/jobs/${jobId}/artwork`, body);
    setBusy("");
    if (!r.ok) setError(r.error);
    else {
      setReason("");
      router.refresh();
    }
  }

  const buttons: { act: string; label: string; needsReason: boolean; primary?: boolean }[] = [];
  if (status === "draft") buttons.push({ act: "submit", label: "Submit for approval", needsReason: false, primary: true });
  if (status === "awaiting") {
    buttons.push({ act: "approve", label: "Approve", needsReason: false, primary: true });
    buttons.push({ act: "reject", label: "Reject", needsReason: true });
    buttons.push({ act: "withdraw", label: "Withdraw", needsReason: false });
  }
  if (status === "approved" || status === "rejected") buttons.push({ act: "revise", label: "Revise (new version)", needsReason: true, primary: true });

  return (
    <section className={sectionCls}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className={`${titleCls} mb-0`}>Artwork approval</h2>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
          v{version} · {STATUS_LABEL[status] ?? status}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-zinc-500">
          Proof reference
          <input
            value={proofRef}
            onChange={(e) => setProofRef(e.target.value)}
            placeholder={String(artwork.proof_ref ?? "")}
            disabled={!canArtwork || status === "approved" || status === "rejected"}
            className={`${inputCls} mt-1 w-full`}
          />
        </label>
        <label className="text-xs text-zinc-500">
          Pantone notes
          <input
            value={pantone}
            onChange={(e) => setPantone(e.target.value)}
            placeholder={String(artwork.pantone_notes ?? "")}
            disabled={!canArtwork || status === "approved" || status === "rejected"}
            className={`${inputCls} mt-1 w-full`}
          />
        </label>
      </div>

      {canArtwork && (
        <div className="mt-3 space-y-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required for reject / revise)"
            className={`${inputCls} w-full sm:w-96`}
          />
          <div className="flex flex-wrap gap-2">
            {buttons.map((b) => (
              <button
                key={b.act}
                onClick={() => action(b.act, b.needsReason)}
                disabled={busy !== ""}
                className={b.primary ? primaryCls : btnCls}
              >
                {busy === b.act ? "Saving…" : b.label}
              </button>
            ))}
            {status === "draft" && (
              <button onClick={() => action("", false)} disabled={busy !== ""} className={btnCls}>
                Save details
              </button>
            )}
          </div>
        </div>
      )}

      {versions.length > 1 && (
        <div className="mt-4">
          <h3 className="mb-1 text-xs font-semibold uppercase text-zinc-500">Versions</h3>
          <ul className="space-y-0.5 text-xs">
            {versions.map((v) => (
              <li key={String(v.id)} className="flex justify-between text-zinc-600 dark:text-zinc-500">
                <span>v{String(v.version)}</span>
                <span>{STATUS_LABEL[String(v.status)] ?? String(v.status)}</span>
                <span className="text-zinc-500">{v.approved_at ? String(v.approved_at).slice(0, 10) : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {events.length > 0 && (
        <div className="mt-3">
          <h3 className="mb-1 text-xs font-semibold uppercase text-zinc-500">History</h3>
          <ul className="space-y-0.5 text-xs text-zinc-500">
            {events.slice(-6).map((e, i) => (
              <li key={i}>
                {String(e.ts).replace("T", " ").slice(0, 16)} · {String(e.action)}
                {e.reason ? ` — ${String(e.reason)}` : ""}
              </li>
            ))}
          </ul>
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
