"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export function Nav({
  user,
  permissions,
}: {
  user: { name: string; roles: string[] };
  permissions: string[];
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const links = [
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
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 sm:px-6">
        <Link href="/jobs" className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Fanela
        </Link>
        <nav className="flex gap-4">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`text-sm ${pathname.startsWith(l.href) ? "font-medium text-zinc-900 dark:text-zinc-50" : "text-zinc-500 hover:text-zinc-800"}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm text-zinc-500">
          <span>
            {user.name} <span className="text-zinc-400">({user.roles.join(", ")})</span>
          </span>
          <button onClick={signOut} className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
