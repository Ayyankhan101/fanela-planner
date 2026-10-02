import { query } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/access";
import { CustomerCreateForm } from "./create-form";

export default async function CustomersPage() {
  const user = await getSessionUser();
  if (!user) return null;
  const customers = await query<Record<string, unknown>>(
    `SELECT id, name, contact_name, email, phone, default_dispatch_method, account_ref
       FROM customers WHERE active = true ORDER BY name`,
  );
  const canEdit = hasPermission(user, "customers.edit");

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Customers</h1>
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
    </div>
  );
}
