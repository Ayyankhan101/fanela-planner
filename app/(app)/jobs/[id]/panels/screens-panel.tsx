"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { inputCls, btnCls, errorCls, send, sectionCls, titleCls } from "../../../ui";

type Rec = Record<string, unknown>;

export function ScreensPanel({ jobId, screen, canStage }: { jobId: string; screen: Rec | null; canStage: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError("");
    const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value;
    const required = val("screen-required");
    const made = val("screen-made");
    const r = await send("PATCH", `/api/jobs/${jobId}/screens`, {
      required: required === "" || required == null ? null : Number(required),
      made: made === "" || made == null ? null : Number(made),
      confirmed: (document.getElementById("screen-confirmed") as HTMLInputElement)?.checked ?? false,
      notRequired: (document.getElementById("screen-notrequired") as HTMLInputElement)?.checked ?? false,
      notes: val("screen-notes") || "",
      version: Number(screen?.version ?? 0),
    });
    setBusy(false);
    if (!r.ok) setError(r.error);
    else router.refresh();
  }

  return (
    <section className={sectionCls}>
      <h2 className={titleCls}>Screens</h2>
      {screen ? (
        canStage ? (
          <div className="space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-zinc-500">
                Required
                <input id="screen-required" type="number" min={0} defaultValue={screen.required == null ? "" : Number(screen.required)} className={`${inputCls} mt-1 w-full`} />
              </label>
              <label className="text-xs text-zinc-500">
                Made
                <input id="screen-made" type="number" min={0} defaultValue={screen.made == null ? "" : Number(screen.made)} className={`${inputCls} mt-1 w-full`} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input id="screen-confirmed" type="checkbox" defaultChecked={Boolean(screen.confirmed)} />
              Confirmed
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input id="screen-notrequired" type="checkbox" defaultChecked={Boolean(screen.not_required)} />
              Not required
            </label>
            <label className="block text-xs text-zinc-500">
              Notes
              <input id="screen-notes" defaultValue={String(screen.notes ?? "")} className={`${inputCls} mt-1 w-full`} />
            </label>
            <button onClick={save} disabled={busy} className={btnCls}>
              {busy ? "Saving…" : "Save screens"}
            </button>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-zinc-500">Required</dt>
            <dd>{screen.required == null ? "blank (not specified)" : String(screen.required)}</dd>
            <dt className="text-zinc-500">Made</dt>
            <dd>{screen.made == null ? "—" : String(screen.made)}</dd>
            <dt className="text-zinc-500">Not required</dt>
            <dd>{screen.not_required ? "yes" : "no"}</dd>
          </dl>
        )
      ) : (
        <p className="text-sm text-zinc-500">No screen record.</p>
      )}
      {error && (
        <p role="status" aria-live="polite" className="mt-2">
          <span className={errorCls}>{error}</span>
        </p>
      )}
    </section>
  );
}
