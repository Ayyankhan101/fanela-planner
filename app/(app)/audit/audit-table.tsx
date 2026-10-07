"use client";

import { useCallback, useEffect, useState } from "react";
import { btnCls, errorCls, inputCls, primaryCls, sectionCls, titleCls } from "../ui";
import { diffAudit, fieldLabel, fmtValue, humanizeAction } from "./diff";

type Rec = Record<string, unknown>;

const ENTITY_TYPES = ["job", "jobs", "customer", "artwork", "swatch", "stage", "shipment", "screens", "job_lines"] as const;

export function AuditTable() {
  const [events, setEvents] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState("");
  const [entityType, setEntityType] = useState("");

  // no setState before the first await — effect body stays side-effect free
  const fetchEvents = useCallback(async () => {
    const params = new URLSearchParams();
    if (jobId.trim()) params.set("jobId", jobId.trim());
    if (entityType) params.set("entityType", entityType);
    params.set("limit", "200");
    try {
      const res = await fetch(`/api/audit?${params.toString()}`);
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError(String(data.error ?? `Load failed (${res.status}).`));
        setEvents([]);
      } else {
        setEvents((data.events as Rec[]) ?? []);
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }, [jobId, entityType]);

  // initial load: loading starts true
  useEffect(() => {
    (async () => {
      await fetchEvents();
    })();
  }, [fetchEvents]);

  return (
    <section className={sectionCls}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className={`${titleCls} mb-0`}>Audit log</h2>
        <span className="text-xs text-zinc-500">{events.length} event(s)</span>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
          placeholder="Filter by job number or UUID"
          className={`${inputCls} w-full sm:w-72`}
        />
        <select value={entityType} onChange={(e) => setEntityType(e.target.value)} className={inputCls}>
          <option value="">All entities</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button onClick={() => { setLoading(true); void fetchEvents(); }} className={primaryCls}>
          Apply
        </button>
      </div>

      {error && (
        <p role="status" aria-live="polite" className="mb-2">
          <span className={errorCls}>{error}</span>
        </p>
      )}
      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : events.length === 0 ? (
        !error && <p className="text-sm text-zinc-500">No events match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-xs uppercase text-zinc-500">
              <tr>
                <th className="py-1.5 pr-4 font-semibold">Time</th>
                <th className="py-1.5 pr-4 font-semibold">Action</th>
                <th className="py-1.5 pr-4 font-semibold">Entity</th>
                <th className="py-1.5 pr-4 font-semibold">Job</th>
                <th className="py-1.5 pr-4 font-semibold">Role</th>
                <th className="py-1.5 pr-4 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={String(e.id)} className="border-t border-zinc-100 dark:border-zinc-900">
                  <td className="py-1.5 pr-4 whitespace-nowrap font-mono text-xs">
                    {String(e.ts).replace("T", " ").slice(0, 16)}
                  </td>
                  <td className="py-1.5 pr-4">{humanizeAction(String(e.action))}</td>
                  <td className="py-1.5 pr-4 text-xs">
                    {String(e.entity_type)}
                    {e.job_id ? "" : ""}
                  </td>
                  <td className="py-1.5 pr-4 font-mono text-xs" title={e.job_id ? String(e.job_id) : undefined}>
                    {e.job_number ? String(e.job_number) : e.job_id ? String(e.job_id).slice(0, 8) : "—"}
                  </td>
                  <td className="py-1.5 pr-4 text-xs">
                    {String(e.actor_role ?? (e.actor_id ? "—" : "system"))}
                  </td>
                  <td className="py-1.5 pr-4">
                    <DetailsCell before={e.before} after={e.after} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-zinc-500">
        Append-only: entries are written by the server and never edited or deleted.{" "}
        <button onClick={() => { setLoading(true); void fetchEvents(); }} className={`${btnCls} !px-2 !py-0.5 !text-xs`}>
          Refresh
        </button>
      </p>
    </section>
  );
}

function DetailsCell({ before, after }: { before: unknown; after: unknown }) {
  const changes = diffAudit(before, after);
  const hasPayload = before != null || after != null;
  if (!hasPayload) return <span className="text-zinc-400">—</span>;

  const summary = changes.length === 0 ? "raw" : `${changes.length} change${changes.length === 1 ? "" : "s"}`;

  return (
    <details>
      <summary className="cursor-pointer text-xs text-blue-600 dark:text-blue-400">{summary}</summary>
      {changes.length > 0 && (
        <ul className="mt-1 max-w-xl space-y-0.5">
          {changes.map((c) => (
            <li key={c.field} className="flex flex-wrap items-baseline gap-x-2 text-xs">
              <span className="w-36 shrink-0 font-medium text-zinc-700 dark:text-zinc-300">{fieldLabel(c.field)}</span>
              <span className="text-zinc-500 line-through decoration-zinc-300">{fmtValue(c.from)}</span>
              <span className="text-zinc-400">→</span>
              <span className="text-zinc-900 dark:text-zinc-100">{fmtValue(c.to)}</span>
            </li>
          ))}
        </ul>
      )}
      <details className="mt-1">
        <summary className="cursor-pointer text-[10px] text-zinc-400 hover:text-zinc-600">raw JSON</summary>
        <pre className="mt-1 max-w-xl overflow-x-auto rounded bg-zinc-50 p-2 text-[10px] text-zinc-600 dark:bg-zinc-900 dark:text-zinc-500">
          {JSON.stringify({ before, after }, null, 2)}
        </pre>
      </details>
    </details>
  );
}
