import { query } from "@/lib/db";

// Dashboard aggregates (P5, read-only): every panel is a single aggregate query —
// no costs exposed (M4 non-issue), active jobs only (never completed/cancelled/archived).

const ACTIVE = `NOT j.archived AND j.status NOT IN ('completed', 'cancelled')`;

export type DashboardData = {
  readiness: { white: number; amber: number; green: number; unknown: number };
  stages: { key: string; name: string; counts: Record<string, number> }[];
  queues: { swatchAwaiting: number; artworkAwaiting: number; stockIssues: number };
  due: { id: string; job_number: string; customer: string; dispatch_date: string; overdue: boolean }[];
};

export async function getDashboard(): Promise<DashboardData> {
  const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, server-local

  const [readinessRows, stageRows, queueRows, dueRows] = await Promise.all([
    query<{ bucket: string; n: string }>(
      `SELECT coalesce(readiness_cache::text, 'unknown') AS bucket, count(*)::text AS n
         FROM jobs
        WHERE NOT archived AND status NOT IN ('completed', 'cancelled')
        GROUP BY 1`,
    ),
    query<{ key: string; name: string; status: string; n: string }>(
      `SELECT d.key, d.name, s.status, count(*)::text AS n
         FROM job_stages s
         JOIN departments d ON d.id = s.department_id
         JOIN jobs j ON j.id = s.job_id
        WHERE ${ACTIVE}
        GROUP BY d.key, d.name, s.status
        ORDER BY d.name`,
    ),
    query<{ swatch_awaiting: string; artwork_awaiting: string; stock_issues: string }>(
      `SELECT
         (SELECT count(*)::text FROM swatch_attempts a JOIN jobs j ON j.id = a.job_id
           WHERE a.status = 'awaiting' AND ${ACTIVE}) AS swatch_awaiting,
         (SELECT count(*)::text FROM artworks aw
            JOIN artwork_versions v ON v.id = aw.current_version_id
            JOIN jobs j ON j.id = aw.job_id
           WHERE v.status = 'awaiting' AND ${ACTIVE}) AS artwork_awaiting,
         (SELECT count(*)::text FROM job_lines l JOIN jobs j ON j.id = l.job_id
           WHERE l.stock_issue IS NOT NULL AND ${ACTIVE}) AS stock_issues`,
    ),
    query<{ id: string; job_number: string; customer: string; dispatch_date: string }>(
      `SELECT j.id, j.job_number, c.name AS customer, j.dispatch_date::text AS dispatch_date
         FROM jobs j JOIN customers c ON c.id = j.customer_id
        WHERE ${ACTIVE}
          AND j.status IN ('open', 'in_production', 'part_dispatched')
          AND j.dispatch_date IS NOT NULL AND j.dispatch_date <= $1
        ORDER BY j.dispatch_date ASC, j.priority ASC
        LIMIT 8`,
      [today],
    ),
  ]);

  const readiness = { white: 0, amber: 0, green: 0, unknown: 0 };
  for (const r of readinessRows) {
    const bucket = r.bucket as keyof typeof readiness;
    if (bucket in readiness) readiness[bucket] = Number(r.n);
  }

  const stages: DashboardData["stages"] = [];
  for (const r of stageRows) {
    let entry = stages.find((s) => s.key === r.key);
    if (!entry) {
      entry = { key: r.key, name: r.name, counts: {} };
      stages.push(entry);
    }
    entry.counts[r.status] = Number(r.n);
  }

  const q = queueRows[0];
  return {
    readiness,
    stages,
    queues: {
      swatchAwaiting: Number(q?.swatch_awaiting ?? 0),
      artworkAwaiting: Number(q?.artwork_awaiting ?? 0),
      stockIssues: Number(q?.stock_issues ?? 0),
    },
    due: dueRows.map((d) => ({
      id: d.id,
      job_number: d.job_number,
      customer: d.customer,
      dispatch_date: d.dispatch_date,
      overdue: d.dispatch_date < today,
    })),
  };
}
