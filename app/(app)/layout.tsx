import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { ROLE_PERMISSIONS, type RoleKey } from "@/lib/permissions";
import { listNotifications } from "@/lib/services/notifications";
import { Nav } from "./nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const permissions = [...new Set(user.roles.flatMap((r) => ROLE_PERMISSIONS[r as RoleKey] ?? []))];

  // bell gate: admin/ops are the only recipients of the current trigger set
  const showBell = user.roles.some((r) => r === "admin" || r === "ops");
  const { unreadCount } = showBell
    ? await listNotifications(user, { unreadOnly: true, limit: 1 })
    : { unreadCount: 0 };

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-black">
      <Nav
        user={{ name: user.name, roles: user.roles }}
        permissions={permissions}
        unreadCount={unreadCount}
        showBell={showBell}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
