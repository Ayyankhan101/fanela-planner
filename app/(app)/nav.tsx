"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell } from "./bell";
import { ThemeToggle } from "@/app/theme-toggle";

export function Nav({
  user,
  permissions,
  unreadCount,
  showBell,
}: {
  user: { name: string; roles: string[] };
  permissions: string[];
  unreadCount: number;
  showBell: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const links = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/jobs", label: "Jobs" },
    ...(permissions.includes("customers.view") ? [{ href: "/customers", label: "Customers" }] : []),
    ...(permissions.includes("audit.view") ? [{ href: "/audit", label: "Audit" }] : []),
    // E6: same class as the /admin/import route gate (admin/ops)
    ...(user.roles.includes("admin") || user.roles.includes("ops")
      ? [{ href: "/admin/import", label: "Import" }]
      : []),
  ];

  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/dashboard" className="py-1 text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Fanela
        </Link>
        <nav className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`py-1.5 text-sm ${pathname.startsWith(l.href) ? "font-medium text-zinc-900 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-100"}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-sm text-zinc-500">
          <ThemeToggle />
          <Bell initialCount={unreadCount} enabled={showBell} />
          <span>
            {user.name} <span className="text-zinc-500">({user.roles.join(", ")})</span>
          </span>
          <button
            onClick={signOut}
            className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:border-zinc-700 dark:hover:bg-zinc-900 dark:focus-visible:outline-zinc-100"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
