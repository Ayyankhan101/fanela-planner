import { notFound } from "next/navigation";
import { getJob } from "@/lib/services/jobs";
import { getSessionUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/access";
import { JobHeaderForm } from "./header-form";

export default async function JobDetailPage({ params }: PageProps<"/jobs/[id]">) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return null;
  const job = await getJob(id);
  if (!job) notFound();
  const canEdit = hasPermission(user, "jobs.edit");

  const stages = job.stages as Record<string, unknown>[];
  const lines = job.lines as Record<string, unknown>[];
  const attempts = job.attempts as Record<string, unknown>[];
  const screen = job.screen as Record<string, unknown> | null;
  const swatchReq = job.swatchRequirement as { required?: boolean } | null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {String(job.job_number)}
          </h1>
          <p className="text-sm text-zinc-500">
            {String(job.customer_name)} {job.po ? `· PO ${String(job.po)}` : ""}{" "}
            {job.print_name ? `· ${String(job.print_name)}` : ""}
          </p>
        </div>
        <div className="text-right text-sm">
          <div className="text-zinc-500">Status</div>
          <div className="font-medium">{String(job.status)}</div>
          {job.archived ? <div className="text-xs text-zinc-400">archived</div> : null}
        </div>
      </div>

      {canEdit && <JobHeaderForm job={{ ...(job as Record<string, unknown>), id: String(job.id), version: Number(job.version) }} />}

      <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Lines</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-zinc-500">
            <tr>
              <th className="py-1 pr-4">SKU</th>
              <th className="py-1 pr-4">Colour</th>
              <th className="py-1 pr-4">Ordered</th>
              <th className="py-1 pr-4">Stock</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={String(l.id)} className="border-t border-zinc-100 dark:border-zinc-900">
                <td className="py-1.5 pr-4 font-mono text-xs">{String(l.sku_text)}</td>
                <td className="py-1.5 pr-4">{String(l.colour ?? "—")}</td>
                <td className="py-1.5 pr-4">{String(l.qty_ordered)}</td>
                <td className="py-1.5 pr-4 text-xs text-zinc-500">{String(l.stock_status ?? "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Department stages</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {stages.map((s) => (
            <div key={String(s.id)} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{String(s.department_name)}</span>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                  {String(s.status)}
                </span>
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                {String(s.progress)} / {String(s.qty)} {s.notes ? `· ${String(s.notes)}` : ""}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Screens</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-zinc-500">Required</dt>
            <dd>{screen ? (screen.required == null ? "blank (not specified)" : String(screen.required)) : "—"}</dd>
            <dt className="text-zinc-500">Made</dt>
            <dd>{screen?.made == null ? "—" : String(screen.made)}</dd>
            <dt className="text-zinc-500">Not required</dt>
            <dd>{screen?.not_required ? "yes" : "no"}</dd>
          </dl>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Swatch (embroidery gate)</h2>
          <p className="mb-2 text-sm">
            Requirement:{" "}
            <strong>{swatchReq?.required ? "required" : "not required"}</strong>
          </p>
          {attempts.length === 0 ? (
            <p className="text-sm text-zinc-500">No attempts yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {attempts.map((a) => (
                <li key={String(a.id)} className="flex justify-between">
                  <span>#{String(a.attempt_no)}</span>
                  <span className="font-medium">{String(a.status)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Dispatch</h2>
        <p className="text-sm text-zinc-500">
          Method: {String(job.dispatch_method ?? "—")} · Address: {String(job.dispatch_address ?? "—")}
        </p>
        <p className="mt-2 text-xs text-zinc-400">
          Shipment workflow (book / labels / finalise) arrives in Phase 2.
        </p>
      </section>
    </div>
  );
}
