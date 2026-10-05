// Regression: ISSUE-003 — swatch approve must NOT require a reason;
// reject/re-swatch must still 422 without one.
// Found by /qa on 2026-10-05
// Report: .gstack/qa-reports/qa-report-localhost-3000-2026-10-05.md
import { describe, it, expect, beforeAll } from "vitest";
import { makeUser, makeRequest } from "./helpers";
import { newCustomer, newJob } from "./fixtures";
import { POST as createAttempt } from "@/app/api/jobs/[id]/swatch/attempts/route";
import { PATCH as patchAttempt } from "@/app/api/jobs/[id]/swatch/attempts/[attemptId]/route";

let cookie: string;
let customerId: string;

type Attempt = { id: string; version: number };

async function newAttempt(jobId: string): Promise<Attempt> {
  const res = await createAttempt(
    makeRequest(`/api/jobs/${jobId}/swatch/attempts`, { method: "POST", cookie, body: { sampleQty: 1 } }),
    { params: Promise.resolve({ id: jobId }) },
  );
  expect(res.status).toBe(201);
  return (await res.json()) as Attempt;
}

async function advance(jobId: string, a: Attempt, status: string, version: number) {
  const res = await patchAttempt(
    makeRequest(`/api/jobs/${jobId}/swatch/attempts/${a.id}`, {
      method: "PATCH",
      cookie,
      body: { status, version },
    }),
    { params: Promise.resolve({ id: jobId, attemptId: a.id }) },
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { version: number }).version;
}

beforeAll(async () => {
  const u = await makeUser({ roles: ["admin"] });
  cookie = u.cookie;
  customerId = await newCustomer(cookie, `QA Sw Co`);
});

describe("ISSUE-003 — swatch decision reasons", () => {
  it("approve without reason → 200 (was 422)", async () => {
    const job = await newJob(cookie, customerId);
    const a = await newAttempt(job.id);
    const v1 = await advance(job.id, a, "in_progress", a.version);
    const v2 = await advance(job.id, a, "awaiting", v1);
    expect(v1).toBeGreaterThan(a.version);
    expect(v2).toBeGreaterThan(v1);
    const ok = await patchAttempt(
      makeRequest(`/api/jobs/${job.id}/swatch/attempts/${a.id}`, {
        method: "PATCH",
        cookie,
        body: { status: "approved", version: v2 }, // no reason
      }),
      { params: Promise.resolve({ id: job.id, attemptId: a.id }) },
    );
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { ok: boolean; version: number };
    expect(body.ok).toBe(true);
    expect(body.version).toBeGreaterThan(v2);
  });

  it("reject without reason → 422 (unchanged)", async () => {
    const job = await newJob(cookie, customerId);
    const a = await newAttempt(job.id);
    await advance(job.id, a, "in_progress", a.version);
    const v2 = await advance(job.id, a, "awaiting", a.version + 1);
    const bad = await patchAttempt(
      makeRequest(`/api/jobs/${job.id}/swatch/attempts/${a.id}`, {
        method: "PATCH",
        cookie,
        body: { status: "rejected", version: v2 }, // no reason
      }),
      { params: Promise.resolve({ id: job.id, attemptId: a.id }) },
    );
    expect(bad.status).toBe(422);
    const body = (await bad.json()) as { error: string };
    expect(body.error).toMatch(/reason/i);
  });
});
