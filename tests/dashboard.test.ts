// Dashboard aggregates (P5): count invariants vs SQL, queue deltas on seed,
// due/overdue membership (active past-due in; future/completed out).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeUser, query, randomUUID } from "./helpers";
import { newCustomer, newJob } from "./fixtures";
import { getDashboard } from "@/lib/services/dashboard";
import { getArtwork } from "@/lib/services/artwork";

let cookie: string;
let customerId: string;
const myJobIds: string[] = [];

beforeAll(async () => {
  const admin = await makeUser({ roles: ["admin"], totp: false });
  cookie = admin.cookie;
  customerId = await newCustomer(cookie);
});

afterAll(async () => {
  // operational_audit/stock_events are append-only (forced RLS, no DELETE
  // policy) → jobs can never be deleted once audited. Neutralize instead:
  // completed + no dispatch_date drops the seeded 1999 rows out of every
  // dashboard panel (queues/due/readiness all filter ACTIVE), leaving inert
  // fixture rows like every other suite does.
  await query(`DELETE FROM notifications WHERE job_id = ANY($1::uuid[])`, [myJobIds]);
  await query(
    `UPDATE jobs SET status = 'completed', dispatch_date = NULL WHERE id = ANY($1::uuid[])`,
    [myJobIds],
  );
});

function sumCounts(stages: { counts: Record<string, number> }[]): number {
  return stages.reduce((n, s) => n + Object.values(s.counts).reduce((a, b) => a + b, 0), 0);
}

describe("dashboard service", () => {
  it("readiness buckets sum to the active-job count", async () => {
    const d = await getDashboard();
    const [total] = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM jobs WHERE NOT archived AND status NOT IN ('completed', 'cancelled')`,
    );
    expect(d.readiness.white + d.readiness.amber + d.readiness.green + d.readiness.unknown).toBe(total.n);
  });

  it("stage matrix sums to active-job stage rows", async () => {
    const d = await getDashboard();
    const [total] = await query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM job_stages s JOIN jobs j ON j.id = s.job_id
        WHERE NOT j.archived AND j.status NOT IN ('completed', 'cancelled')`,
    );
    expect(sumCounts(d.stages)).toBe(total.n);
  });

  it("queues move by exactly +1 per seed (swatch / artwork / stock issue)", async () => {
    const before = await getDashboard();
    const job = await newJob(cookie, customerId);
    myJobIds.push(job.id);

    await query(`INSERT INTO swatch_attempts (id, job_id, attempt_no, status, version) VALUES ($1,$2,1,'awaiting',1)`, [
      randomUUID(),
      job.id,
    ]);
    await getArtwork(job.id, null); // ensureArtwork creates draft v1
    await query(`UPDATE artwork_versions SET status = 'awaiting' WHERE id = (SELECT current_version_id FROM artworks WHERE job_id = $1)`, [job.id]);
    await query(`UPDATE job_lines SET stock_issue = 'Short' WHERE job_id = $1`, [job.id]);

    const after = await getDashboard();
    expect(after.queues.swatchAwaiting).toBe(before.queues.swatchAwaiting + 1);
    expect(after.queues.artworkAwaiting).toBe(before.queues.artworkAwaiting + 1);
    expect(after.queues.stockIssues).toBe(before.queues.stockIssues + 1);
  });

  it("due list: active past-due in; future-dated and completed out", async () => {
    const m = randomUUID().slice(0, 8);
    const dueNo = `DUE-A-${m}`;
    const futureNo = `DUE-B-${m}`;
    const doneNo = `DUE-C-${m}`;
    const dueJob = await newJob(cookie, customerId, { jobNumber: dueNo });
    const futureJob = await newJob(cookie, customerId, { jobNumber: futureNo });
    const doneJob = await newJob(cookie, customerId, { jobNumber: doneNo });
    myJobIds.push(dueJob.id, futureJob.id, doneJob.id);
    await query(`UPDATE jobs SET dispatch_date = '1999-01-01' WHERE id = $1`, [dueJob.id]);
    await query(`UPDATE jobs SET dispatch_date = '2999-01-01' WHERE id = $1`, [futureJob.id]);
    await query(`UPDATE jobs SET dispatch_date = '1999-01-02', status = 'completed' WHERE id = $1`, [doneJob.id]);

    const d = await getDashboard();
    const today = new Date().toLocaleDateString("en-CA");
    expect(d.due.every((x) => x.dispatch_date <= today)).toBe(true);
    expect(d.due.map((x) => x.job_number)).toContain(dueNo);
    expect(d.due.map((x) => x.job_number)).not.toContain(futureNo);
    expect(d.due.map((x) => x.job_number)).not.toContain(doneNo);
    expect(d.due.find((x) => x.job_number === dueNo)?.overdue).toBe(true);
  });
});
