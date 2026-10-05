// Regression: ISSUE-004 — audit jobId filter matches job number + UUID prefix;
// non-UUID input crashed $1::uuid cast (API 500, empty body) before this fix.
// Found by /qa on 2026-10-05
// Report: .gstack/qa-reports/qa-report-localhost-3000-2026-10-05.md
import { describe, it, expect, beforeAll } from "vitest";
import { makeUser, makeRequest, randomUUID } from "./helpers";
import { newCustomer, newJob, swatchWaive } from "./fixtures";
import { GET as getAudit } from "@/app/api/audit/route";

let cookie: string;
let jobId: string;
let jobNumber: string;

async function filter(qs: string) {
  const res = await getAudit(makeRequest(`/api/audit${qs}`, { cookie }));
  const body = res.status === 200 ? ((await res.json()) as { events: unknown[] }) : { events: [] };
  return { status: res.status, count: body.events.length };
}

beforeAll(async () => {
  const u = await makeUser({ roles: ["admin"] });
  cookie = u.cookie;
  const suffix = randomUUID().slice(0, 8);
  const customerId = await newCustomer(cookie, `QA Co ${suffix}`);
  jobNumber = `QA-${suffix}`;
  const job = await newJob(cookie, customerId, { jobNumber });
  jobId = job.id;
  await swatchWaive(cookie, job.id); // seed at least one audit row for this job
});

describe("ISSUE-004 — audit jobId filter", () => {
  it("full UUID → 200 with rows", async () => {
    const r = await filter(`?jobId=${jobId}`);
    expect(r.status).toBe(200);
    expect(r.count).toBeGreaterThan(0);
  });

  it("8-char UUID prefix → 200 with rows (no uuid cast)", async () => {
    const r = await filter(`?jobId=${jobId.slice(0, 8)}`);
    expect(r.status).toBe(200);
    expect(r.count).toBeGreaterThan(0);
  });

  it("job number → 200 with rows", async () => {
    const r = await filter(`?jobId=${encodeURIComponent(jobNumber)}`);
    expect(r.status).toBe(200);
    expect(r.count).toBeGreaterThan(0);
  });

  it("nonexistent non-UUID input → 200 empty (previously 500)", async () => {
    const r = await filter("?jobId=NOPE-not-a-uuid");
    expect(r.status).toBe(200);
    expect(r.count).toBe(0);
  });
});
