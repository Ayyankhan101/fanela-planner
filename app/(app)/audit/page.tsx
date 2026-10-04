import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/access";
import { AuditTable } from "./audit-table";

export default async function AuditPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!hasPermission(user, "audit.view")) redirect("/jobs");

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Audit</h1>
      <AuditTable />
    </div>
  );
}
