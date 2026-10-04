import Link from "next/link";
import { getDashboard } from "@/lib/services/dashboard";
import { listAudit } from "@/lib/services/audit";
import { getSessionUser } from "@/lib/auth/session";
import { hasPermission } from "@/lib/auth/access";
import { DEPARTMENTS } from "@/lib/permissions";

const cardCls = "rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950";
const headingCls = "mb-3 text-xs font-semibold uppercase text-zinc-500";

const STATUS_COLS = [
  { key: "waiting", label: "Wait" },
  { key: "ready", label: "Ready" },
  { key: "in_progress", label: "In prog" },
  { key: "blocked", label: "Blocked" },
  { key: "completed", label: "Done" },
] as const;

function Kpi({ label, value, href, tone }: { label: string; value: number; href?: string; tone?: string }) {
  const body = (
    <>
      <div className={`text-2xl font-semibold ${tone ?? "text-zinc-900 dark:text-zinc-50"}`}>{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{label}</div>
    </>
  );
  return href ? (
    <Link href={href} className={`${cardCls} block hover:bg-zinc-50 dark:hover:bg-zinc-900`}>
      {body}
    </Link>
  ) : (
    <div className={cardCls}>{body}</div>
  );
}

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) return null;
  const data = await getDashboard();
  const showAudit = hasPermission(user, "audit.view");
  const activity = showAudit ? await listAudit({ limit: 10 }, user) : [];

  const activeTotal =
    data.readiness.white + data.readiness.amber + data.readiness.green + data.readiness.unknown;
  const awaiting = data.queues.swatchAwaiting + data.queues.artworkAwaiting;
  const blockedTotal = data.stages.reduce((n, s) => n + (s.counts.blocked ?? 0), 0);
  const dueOverdue = data.due.length;

  // merge zeros so all 9 departments always render
  const stageRows = DEPARTMENTS.map((d) => {
    const found = data.stages.find((s) => s.key === d.key);
    return { key: d.key, name: d.name, counts: found?.counts ?? {} };
  });

  const readinessRows = [
    { key: "green", label: "Ready (green)", dot: "bg-emerald-500", n: data.readiness.green, href: "/jobs" },
    { key: "amber", label: "Amber", dot: "bg-amber-500", n: data.readiness.amber, href: "/jobs" },
    { key: "white", label: "Not ready (white)", dot: "bg-zinc-300 dark:bg-zinc-700", n: data.readiness.white, href: "/jobs" },
    { key: "unknown", label: "No readiness yet", dot: "bg-zinc-200 dark:bg-zinc-800", n: data.readiness.unknown, href: "/jobs" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Active jobs" value={activeTotal} href="/jobs" />
        <Kpi label="Awaiting approval" value={awaiting} href="/jobs" tone={awaiting > 0 ? "text-amber-600 dark:text-amber-400" : undefined} />
        <Kpi label="Blocked stages" value={blockedTotal} href="/jobs" tone={blockedTotal > 0 ? "text-red-600 dark:text-red-400" : undefined} />
        <Kpi label="Dispatch due / overdue" value={dueOverdue} tone={dueOverdue > 0 ? "text-red-600 dark:text-red-400" : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className={cardCls}>
          <div className={headingCls}>Readiness mix</div>
          <ul className="space-y-2">
            {readinessRows.map((r) => (
              <li key={r.key}>
                <Link href={r.href} className="flex items-center gap-2 text-sm hover:underline">
                  <span className={`h-2.5 w-2.5 rounded-full ${r.dot}`} />
                  <span className="text-zinc-700 dark:text-zinc-300">{r.label}</span>
                  <span className="ml-auto font-medium text-zinc-900 dark:text-zinc-50">{r.n}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className={cardCls}>
          <div className={headingCls}>Approval queues</div>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between">
              <span className="text-zinc-700 dark:text-zinc-300">Swatches awaiting approval</span>
              <span className={`font-medium ${data.queues.swatchAwaiting > 0 ? "text-amber-600 dark:text-amber-400" : "text-zinc-900 dark:text-zinc-50"}`}>
                {data.queues.swatchAwaiting}
              </span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-zinc-700 dark:text-zinc-300">Artwork awaiting approval</span>
              <span className={`font-medium ${data.queues.artworkAwaiting > 0 ? "text-amber-600 dark:text-amber-400" : "text-zinc-900 dark:text-zinc-50"}`}>
                {data.queues.artworkAwaiting}
              </span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-zinc-700 dark:text-zinc-300">Lines with stock issues</span>
              <span className={`font-medium ${data.queues.stockIssues > 0 ? "text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-zinc-50"}`}>
                {data.queues.stockIssues}
              </span>
            </li>
          </ul>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className={cardCls}>
          <div className={headingCls}>Dispatch due / overdue</div>
          {data.due.length === 0 ? (
            <p className="text-sm text-zinc-500">Nothing due.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {data.due.map((d) => (
                <li key={d.id} className="flex items-center gap-2 py-2 text-sm">
                  <Link href={`/jobs/${d.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                    {d.job_number}
                  </Link>
                  <span className="truncate text-zinc-500">{d.customer}</span>
                  <span className="ml-auto shrink-0 text-zinc-500">{d.dispatch_date}</span>
                  {d.overdue && (
                    <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-950 dark:text-red-400">
                      OVERDUE
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {showAudit && (
          <div className={cardCls}>
            <div className={headingCls}>Recent activity</div>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {activity.length === 0 && <li className="py-2 text-sm text-zinc-500">No activity yet.</li>}
              {activity.map((a) => {
                const rec = a as Record<string, unknown>;
                const jobId = rec.job_id as string | null;
                return (
                  <li key={String(rec.id)} className="flex items-center gap-2 py-2 text-sm">
                    <span className="text-zinc-400">{String(rec.ts).replace("T", " ").slice(0, 16)}</span>
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">{String(rec.action)}</span>
                    <span className="text-zinc-500">{String(rec.entity_type)}</span>
                    {jobId && (
                      <Link href={`/jobs/${jobId}`} className="ml-auto shrink-0 text-xs text-blue-600 hover:underline dark:text-blue-400">
                        job
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 text-right">
              <Link href="/audit" className="text-xs text-blue-600 hover:underline dark:text-blue-400">
                Open audit →
              </Link>
            </div>
          </div>
        )}
      </div>

      <div className={cardCls}>
        <div className={headingCls}>Stages by department (active jobs)</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <th className="py-2 pr-4 font-medium">Department</th>
                {STATUS_COLS.map((c) => (
                  <th key={c.key} className="py-2 pr-4 text-right font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stageRows.map((s) => (
                <tr key={s.key} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                  <td className="py-2 pr-4 text-zinc-800 dark:text-zinc-200">{s.name}</td>
                  {STATUS_COLS.map((c) => {
                    const n = s.counts[c.key] ?? 0;
                    const tone =
                      c.key === "blocked" && n > 0
                        ? "text-red-600 dark:text-red-400"
                        : c.key === "completed" && n > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : n > 0
                            ? "text-zinc-900 dark:text-zinc-50"
                            : "text-zinc-300 dark:text-zinc-700";
                    return (
                      <td key={c.key} className={`py-2 pr-4 text-right ${tone}`}>
                        {n}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
