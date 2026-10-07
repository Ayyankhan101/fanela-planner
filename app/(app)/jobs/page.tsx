import Link from "next/link";
import { listJobs } from "@/lib/services/jobs";
import { getSessionUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/access";
import { JobCreateForm } from "./create-form";
import { ExportDropdown } from "../export-dropdown";

export default async function JobsPage({ searchParams }: PageProps<"/jobs">) {
  const raw = (await searchParams).q;
  const q = Array.isArray(raw) ? raw[0] : raw;
  const user = await getSessionUser();
  if (!user) return null;
  const jobs = await listJobs({ q: q || undefined });
  const canEdit = hasPermission(user, "jobs.edit");
  const canExport = hasPermission(user, "import.export");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Jobs</h1>
        <form className="flex w-full flex-wrap gap-2 sm:w-auto">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search job, customer, PO, SKU…"
            className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 sm:w-64 dark:border-zinc-700 dark:focus-visible:outline-zinc-100"
          />
          <button className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:hover:bg-zinc-900 dark:focus-visible:outline-zinc-100">
            Search
          </button>
          {canExport && <ExportDropdown q={q} />}
        </form>
      </div>

      {canEdit && <JobCreateForm />}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-2 font-semibold">Job</th>
              <th className="px-4 py-2 font-semibold">Customer</th>
              <th className="px-4 py-2 font-semibold">Print</th>
              <th className="px-4 py-2 font-semibold">Dispatch</th>
              <th className="px-4 py-2 font-semibold">Priority</th>
              <th className="px-4 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                  {q
                    ? `No jobs match “${q}”.`
                    : `No jobs yet. ${canEdit ? "Create the first one above." : ""}`}
                </td>
              </tr>
            )}
            {jobs.map((j) => (
              <tr key={String(j.id)} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900/50">
                <td className="px-4 py-2 font-mono text-xs">
                  <Link href={`/jobs/${j.id}`} className="text-blue-600 hover:underline dark:text-blue-400">
                    {String(j.job_number)}
                  </Link>
                </td>
                <td className="px-4 py-2">{String(j.customer_name)}</td>
                <td className="px-4 py-2">{String(j.print_name ?? "—")}</td>
                <td className="px-4 py-2 font-mono text-xs">{String(j.dispatch_date ?? "—")}</td>
                <td className="px-4 py-2 font-mono text-xs">{String(j.priority)}</td>
                <td className="px-4 py-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-500">{String(j.status)}</span>
                  {j.archived ? <span className="ml-2 text-xs text-zinc-500">archived</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
