"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

type Counts = { create: number; skip: number; error: number; warn: number; info: number };
type Issue = { check: string; severity: string; message: string };
type Row = {
  idx: number;
  jobNumber: string;
  customer: string;
  severity: string;
  issues: Issue[];
};
type Batch = {
  id: string;
  status: string;
  version: number;
  created: number;
  skipped: number;
  ts: string;
  actor: string | null;
  fileName: string | null;
  counts: Counts | null;
  errors: unknown[] | null;
  result: { counts?: Counts; imported?: number } | null;
};
type Preview = { counts: Counts; total: number; page: number; pageSize: number; rows: Row[] };
type Step = "upload" | "preview" | "confirm" | "result";

const EMPTY: Counts = { create: 0, skip: 0, error: 0, warn: 0, info: 0 };

const SEVERITY_CLASS: Record<string, string> = {
  error: "text-red-600 dark:text-red-400",
  warn: "text-amber-600 dark:text-amber-400",
  skip: "text-zinc-500 dark:text-zinc-400",
  create: "text-zinc-700 dark:text-zinc-300",
  info: "text-blue-600 dark:text-blue-400",
};

function Badge({ severity }: { severity: string }) {
  const cls = SEVERITY_CLASS[severity] ?? "text-zinc-500";
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${cls}`}>
      <span aria-hidden className="text-[10px]">●</span>
      {severity}
    </span>
  );
}

const STEPS: { key: Step; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "preview", label: "Preview" },
  { key: "confirm", label: "Confirm" },
  { key: "result", label: "Result" },
];

type ApiBody = {
  batches?: Batch[];
  batch?: Batch;
  error?: string;
  counts?: Counts;
  rows?: Row[];
  total?: number;
  page?: number;
  pageSize?: number;
  imported?: number;
  downgraded?: string[];
} | null;

async function api(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: ApiBody }> {
  const res = await fetch(path, init);
  let body: ApiBody = null;
  try {
    body = (await res.json()) as ApiBody;
  } catch {
    /* non-json */
  }
  return { ok: res.ok, status: res.status, body };
}

export function ImportWizard() {
  const [step, setStep] = useState<Step>("upload");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [filter, setFilter] = useState("issues");
  const [banner, setBanner] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null); // aria-live parse/execute progress
  const [typed, setTyped] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refreshBatches = useCallback(async () => {
    const { body } = await api("/api/admin/import");
    if (Array.isArray(body?.batches)) setBatches(body.batches);
    return body?.batches as Batch[] | undefined;
  }, []);

  // Q7.3: page loads latest non-terminal batch on mount — reload restores step from status
  useEffect(() => {
    (async () => {
      const list = await refreshBatches();
      if (!list || list.length === 0) return;
      const active = list.find((b) => ["previewed", "confirmed"].includes(b.status)) ?? null;
      if (active) {
        setBatch(active);
        if (active.status === "previewed") await loadPreview(active.id, "issues", 1);
        else setStep("confirm");
      } else {
        const last = list[0];
        if (last?.status === "executed") {
          setBatch(last);
          setStep("result");
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadPreview(id: string, f: string, p: number) {
    setStatus("Validating rows…");
    const { ok, body } = await api(`/api/admin/import/${id}?view=preview&filter=${encodeURIComponent(f)}&page=${p}`);
    setStatus(null);
    if (!ok || !body?.counts) {
      setBanner(body?.error ?? "Preview failed.");
      return;
    }
    setPreview(body as Preview);
    setFilter(f);
    setStep("preview");
  }

  async function onFile(file: File) {
    setBanner(null);
    setStale(false);
    setTyped("");
    setBusy(true);
    setStatus("Uploading and validating…");
    const res = await fetch("/api/admin/import", {
      method: "POST",
      headers: { "x-file-name": file.name, "content-type": "application/json" },
      body: file,
    });
    setStatus(null);
    setBusy(false);
    let body: ApiBody = null;
    try {
      body = (await res.json()) as ApiBody;
    } catch {
      /* ignore */
    }
    if (!res.ok || !body?.batch) {
      setBanner(body?.error ?? "Upload failed.");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setFileName(file.name);
    setBatch(body.batch);
    await refreshBatches();
    await loadPreview(body.batch.id, "issues", 1);
  }

  async function action(
    a: "confirm" | "execute" | "discard" | "revalidate",
    extra: Record<string, unknown> = {},
    target?: Batch,
  ) {
    const b = target ?? batch;
    if (!b) return;
    setBanner(null);
    setStale(false);
    setBusy(true);
    if (a === "execute") setStatus("Importing…");
    const { ok, status: st, body } = await api(`/api/admin/import/${b.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: a, version: b.version, ...extra }),
    });
    setStatus(null);
    setBusy(false);
    if (st === 409) {
      setStale(true);
      return;
    }
    if (!ok) {
      setBanner(body?.error ?? "Action failed.");
      return;
    }
    if (a === "discard") {
      setBatch(null);
      setPreview(null);
      setStep("upload");
      setTyped("");
      await refreshBatches();
      return;
    }
    if (a === "confirm") {
      if (body?.batch) setBatch(body.batch);
      setStep("confirm");
      return;
    }
    if (a === "execute") {
      if (body?.batch) setBatch(body.batch);
      setPreview(null);
      setStep("result");
      await refreshBatches();
    }
  }

  async function resume(b: Batch) {
    setBatch(b);
    setBanner(null);
    setStale(false);
    if (b.status === "previewed") await loadPreview(b.id, "issues", 1);
    else setStep(b.status === "executed" ? "result" : "confirm");
  }

  const counts = preview?.counts ?? batch?.counts ?? EMPTY;
  const typedRequired = counts.create >= 50 || counts.warn > 0;
  const typedOk = !typedRequired || typed.trim() === String(counts.create);
  const totalPages = preview ? Math.max(1, Math.ceil(preview.total / preview.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Import legacy data</h1>
        <span className="rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          Admin / Ops
        </span>
      </div>

      {/* Stepper */}
      <ol className="flex flex-wrap gap-2 sm:gap-4" aria-label="Import steps">
        {STEPS.map((s, i) => {
          const idx = STEPS.findIndex((x) => x.key === step);
          const state = i < idx ? "done" : i === idx ? "current" : "todo";
          return (
            <li
              key={s.key}
              aria-current={state === "current" ? "step" : undefined}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                state === "current"
                  ? "border-zinc-900 font-medium text-zinc-900 dark:border-zinc-100 dark:text-zinc-50"
                  : state === "done"
                    ? "border-zinc-300 text-zinc-500 dark:border-zinc-700"
                    : "border-zinc-200 text-zinc-400 dark:border-zinc-800"
              }`}
            >
              {i + 1}. {s.label}
            </li>
          );
        })}
      </ol>

      <p aria-live="polite" className="min-h-5 text-sm text-zinc-500">
        {status ?? ""}
      </p>

      {stale && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          This import changed in another tab — reload.{" "}
          <button className="font-medium underline" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )}
      {banner && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {banner}
        </div>
      )}

      {/* ── Step 1: Upload ─────────────────────────────── */}
      {step === "upload" && (
        <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border-2 border-dashed border-zinc-300 px-6 py-10 text-center hover:border-zinc-500 dark:border-zinc-700">
            <input
              ref={inputRef}
              type="file"
              accept=".json,application/json"
              disabled={busy}
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Drop your legacy JSON export (shapes A–D). JSON only, up to 25 MB.
            </span>
            <span className="text-xs text-zinc-500">Click to choose a file</span>
          </label>
          {fileName && <p className="mt-3 text-sm text-zinc-500">{fileName}</p>}
        </section>
      )}

      {/* ── Step 2: Preview ────────────────────────────── */}
      {step === "preview" && preview && (
        <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter rows">
            {(["create", "skip", "error", "warn"] as const).map((k) => (
              <button
                key={k}
                onClick={() => loadPreview(batch!.id, k, 1)}
                className={`rounded-md border px-3 py-1 text-sm ${
                  filter === k
                    ? "border-zinc-900 font-medium dark:border-zinc-100"
                    : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
                }`}
              >
                <span className={SEVERITY_CLASS[k]}>{counts[k]}</span> {k}
              </button>
            ))}
            <button
              onClick={() => loadPreview(batch!.id, filter === "issues" ? "all" : "issues", 1)}
              className="rounded-md border border-zinc-300 px-3 py-1 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
            >
              {filter === "issues" ? "Show all rows" : "Issues only"}
            </button>
          </div>

          {/* mobile card rows */}
          <ul className="space-y-2 md:hidden">
            {preview.rows.map((r) => (
              <li key={r.idx} className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <Badge severity={r.severity} />
                  <span className="font-mono text-xs text-zinc-500">{r.jobNumber || "—"}</span>
                </div>
                <p className="mt-1 text-zinc-700 dark:text-zinc-300">{r.customer}</p>
                <ul className="mt-1 list-inside list-disc text-xs text-zinc-500">
                  {r.issues.map((i, n) => (
                    <li key={n}>{i.message}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <tr>
                  <th className="px-3 py-2">Severity</th>
                  <th className="px-3 py-2">Job number</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Issues</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">
                      No rows match this filter.
                    </td>
                  </tr>
                )}
                {preview.rows.map((r) => (
                  <tr key={r.idx} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                    <td className="px-3 py-2">
                      <Badge severity={r.severity} />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.jobNumber || "—"}</td>
                    <td className="px-3 py-2">{r.customer}</td>
                    <td className="px-3 py-2 text-xs text-zinc-500">
                      {r.issues.length === 0 ? "—" : r.issues.map((i) => i.message).join("; ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-sm text-zinc-500">
            <span>
              Page {preview.page} of {totalPages} · {preview.total} row(s)
            </span>
            <span className="flex gap-2">
              <button
                disabled={preview.page <= 1}
                onClick={() => loadPreview(batch!.id, filter, preview.page - 1)}
                className="rounded-md border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700"
              >
                Prev
              </button>
              <button
                disabled={preview.page >= totalPages}
                onClick={() => loadPreview(batch!.id, filter, preview.page + 1)}
                className="rounded-md border border-zinc-300 px-2 py-1 disabled:opacity-40 dark:border-zinc-700"
              >
                Next
              </button>
            </span>
          </div>

          <p className="text-sm text-zinc-500">
            Nothing is written until you confirm. Swatch approvals, shipments, photos and audit history are never
            imported (E4).
          </p>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setStep("upload")}
              disabled={busy}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Back
            </button>
            <button
              onClick={() => action("confirm", { counts })}
              disabled={busy}
              className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Continue to confirm
            </button>
            <button
              onClick={() => action("discard")}
              disabled={busy}
              className="px-2 py-1.5 text-sm text-red-600 underline hover:text-red-800 dark:text-red-400"
            >
              Discard import
            </button>
          </div>
          {counts.error > 0 && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {counts.error} error row(s) will not be imported — only clean rows execute (Q7.1).
            </p>
          )}
        </section>
      )}

      {/* ── Step 3: Confirm ────────────────────────────── */}
      {step === "confirm" && (
        <ConfirmPanel
          counts={counts}
          typed={typed}
          setTyped={setTyped}
          typedRequired={typedRequired}
          typedOk={typedOk}
          busy={busy}
          onConfirmTyped={() =>
            action("execute", typed.trim() === "" ? {} : { typedCount: Number(typed) })
          }
          onBack={() => setStep(preview ? "preview" : "upload")}
          onDiscard={() => action("discard")}
          showCounts={!!preview}
        />
      )}

      {/* ── Step 4: Result ─────────────────────────────── */}
      {step === "result" && batch && (
        <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="font-medium text-zinc-900 dark:text-zinc-50">Import complete</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["Imported", batch.result?.imported ?? batch.created],
                ["Skipped", batch.skipped],
                ["Errors", batch.result?.counts?.error ?? 0],
                ["Warnings", batch.result?.counts?.warn ?? 0],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <p className="text-xs uppercase text-zinc-500">{label}</p>
                <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{Number(value ?? 0)}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link href="/jobs" className="rounded-md bg-zinc-900 px-4 py-1.5 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900">
              View imported jobs →
            </Link>
            <a
              href={`/api/admin/import/${batch.id}?view=errors`}
              className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Download errors CSV
            </a>
            <button
              onClick={() => setStep("upload")}
              className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Import another file
            </button>
          </div>
        </section>
      )}

      {/* Batch history */}
      <section className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-medium text-zinc-900 dark:border-zinc-800 dark:text-zinc-50">
          Batch history
        </h2>
        {batches.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-zinc-500">
            No imports yet. Upload a legacy JSON export to start.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-2">File</th>
                <th className="px-4 py-2">Uploaded</th>
                <th className="px-4 py-2">By</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">create/skip/error/warn</th>
                <th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                  <td className="px-4 py-2 font-mono text-xs">{b.fileName ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-zinc-500">{new Date(b.ts).toLocaleString()}</td>
                  <td className="px-4 py-2 text-xs text-zinc-500">{b.actor ? "admin" : "—"}</td>
                  <td className="px-4 py-2">
                    <span className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs dark:border-zinc-700">
                      {b.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-zinc-500">
                    {b.counts
                      ? `${b.counts.create}/${b.counts.skip}/${b.counts.error}/${b.counts.warn}`
                      : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {b.status === "confirmed" && (
                      <button className="text-blue-600 underline dark:text-blue-400" onClick={() => resume(b)}>
                        Resume
                      </button>
                    )}
                    {b.status === "failed" && (
                      <a className="text-blue-600 underline dark:text-blue-400" href={`/api/admin/import/${b.id}?view=errors`}>
                        View errors
                      </a>
                    )}
                    {b.status === "executed" && (
                      <button className="text-blue-600 underline dark:text-blue-400" onClick={() => resume(b)}>
                        View result
                      </button>
                    )}
                    {["previewed", "confirmed", "created"].includes(b.status) && (
                      <button
                        className="ml-2 text-red-600 underline dark:text-red-400"
                        onClick={() => action("discard", {}, b)}
                      >
                        Discard
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function ConfirmPanel({
  counts,
  typed,
  setTyped,
  typedRequired,
  typedOk,
  busy,
  onConfirmTyped,
  onBack,
  onDiscard,
  showCounts,
}: {
  counts: Counts;
  typed: string;
  setTyped: (v: string) => void;
  typedRequired: boolean;
  typedOk: boolean;
  busy: boolean;
  onConfirmTyped: () => void;
  onBack: () => void;
  onDiscard: () => void;
  showCounts: boolean;
}) {
  return (
    <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="font-medium text-zinc-900 dark:text-zinc-50">Confirm import</h2>
      {showCounts && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ["create", counts.create],
              ["skip", counts.skip],
              ["error", counts.error],
              ["warn", counts.warn],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="text-xs uppercase text-zinc-500">{k}</p>
              <p className={`text-lg font-semibold ${SEVERITY_CLASS[k]}`}>{v}</p>
            </div>
          ))}
        </div>
      )}
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Import {counts.create} row(s), skip {counts.skip}, {counts.error} errored. Swatch approvals, shipments, photos
        and audit history are never imported (E4).
      </p>
      {typedRequired && (
        <div className="space-y-2">
          <label htmlFor="typed-count" className="block text-sm text-zinc-700 dark:text-zinc-300">
            Type the create count (<span className="font-mono">{counts.create}</span>) to confirm:
          </label>
          <input
            id="typed-count"
            inputMode="numeric"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="w-40 rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={onConfirmTyped}
          disabled={busy || !typedOk}
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {busy ? "Importing…" : "Confirm and import"}
        </button>
        <button
          onClick={onBack}
          disabled={busy}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Back
        </button>
        <button
          onClick={onDiscard}
          disabled={busy}
          className="px-2 py-1.5 text-sm text-red-600 underline hover:text-red-800 dark:text-red-400"
        >
          Discard import
        </button>
      </div>
      {!typedOk && typed.trim() !== "" && (
        <p className="text-sm text-amber-600 dark:text-amber-400">Count does not match the preview.</p>
      )}
    </section>
  );
}
