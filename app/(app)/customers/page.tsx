import Link from "next/link";
import { getSessionUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/access";
import { listCustomersPage } from "@/lib/services/customers";
import { CustomerCreateForm } from "./create-form";
import { ExportDropdown } from "../export-dropdown";

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const raw = (await searchParams).page;
  const pageParam = Array.isArray(raw) ? raw[0] : raw;
  const user = await getSessionUser();
  if (!user) return null;
  const { customers, total, page, pages } = await listCustomersPage(Number(pageParam) || 1);
  const canEdit = hasPermission(user, "customers.edit");
  const canExport = hasPermission(user, "import.export");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Customers</h1>
        {canExport && <ExportDropdown />}
      </div>
      {canEdit && <CustomerCreateForm />}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Contact</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Phone</th>
              <th className="px-4 py-2">Default method</th>
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">No customers yet.</td>
              </tr>
            )}
            {customers.map((c) => (
              <tr key={String(c.id)} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                <td className="px-4 py-2 font-medium">{String(c.name)}</td>
                <td className="px-4 py-2">{String(c.contact_name ?? "—")}</td>
                <td className="px-4 py-2">{String(c.email ?? "—")}</td>
                <td className="px-4 py-2">{String(c.phone ?? "—")}</td>
                <td className="px-4 py-2 text-xs text-zinc-500">{String(c.default_dispatch_method ?? "—")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400" aria-label="Customers pagination">
          <span>
            {page > 1 ? (
              <Link href={`/customers?page=${page - 1}`} className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">
                ← Previous
              </Link>
            ) : (
              <span className="px-2 py-1 opacity-40">← Previous</span>
            )}
          </span>
          <span>
            Page {page} of {pages} · {total} customers
          </span>
          <span>
            {page < pages ? (
              <Link href={`/customers?page=${page + 1}`} className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">
                Next →
              </Link>
            ) : (
              <span className="px-2 py-1 opacity-40">Next →</span>
            )}
          </span>
        </nav>
      )}
    </div>
  );
}
