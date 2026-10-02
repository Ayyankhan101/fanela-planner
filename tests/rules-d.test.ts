// Rules D1–D10 + J9 lifecycle: stage machine, dept scoping, dispatch guard, cancel (phase0/01 §D, §J).
import { describe, it, expect, beforeAll } from "vitest";
import { makeUser, makeRequest, query, randomUUID, type TestUser } from "./helpers";
import { newCustomer, newJob, getJob, refreshStages, swatchWaive, type JobHandle } from "./fixtures";
import { PATCH as patchStage } from "@/app/api/jobs/[id]/stages/[stageId]/route";
import { POST as finalise } from "@/app/api/jobs/[id]/dispatch/finalise/route";
import { POST as cancel } from "@/app/api/jobs/[id]/cancel/route";

let adminCookie: string;
let customerId: string;
let printDept: TestUser;
let printCookie: string;
const suffix = randomUUID().slice(0, 8);

type Stage = { id: string; version: number };

async function stage(job: JobHandle, dept: string): Promise<Stage> {
  const s = (await refreshStages(adminCookie, job.id))[dept];
  return { id: s.id, version: s.version };
}

async function patch(jobId: string, s: Stage, cookie: string, body: Record<string, unknown>) {
  const res = await patchStage(
    makeRequest(`/api/jobs/${jobId}/stages/${s.id}`, { method: "PATCH", cookie, body: { ...body, version: s.version } }),
    { params: Promise.resolve({ id: jobId, stageId: s.id }) },
  );
  return { status: res.status, json: async () => res.json() };
}

async function completeAllExceptDispatch(job: JobHandle, cookie: string): Promise<void> {
  await swatchWaive(cookie, job.id); // S7 gate off for fixture jobs
  const stages = await refreshStages(cookie, job.id);
  for (const [dept, s] of Object.entries(stages)) {
    if (dept === "dispatch") continue;
    if (s.status === "completed") continue;
    const res = await patch(job.id, { id: s.id, version: s.version }, cookie, {
      status: "in_progress",
      progress: s.qty,
    });
    expect([200, 422], `${dept} complete`).toContain(res.status);
  }
}

beforeAll(async () => {
  const admin = await makeUser({ roles: ["admin"] });
  adminCookie = admin.cookie;
  printDept = await makeUser({ roles: ["dept"], departments: ["print"] });
  printCookie = printDept.cookie;
  customerId = await newCustomer(adminCookie, `D Co ${suffix}`);
});

describe("D1 — job gets one stage per department, qty = line total", () => {
  it("9 stages, waiting, version 1, qty matches ordered", async () => {
    const job = await newJob(adminCookie, customerId, { lines: [{ skuText: "D1", qtyOrdered: 7 }, { skuText: "D1b", qtyOrdered: 3 }] });
    const stages = await refreshStages(adminCookie, job.id);
    expect(Object.keys(stages).sort()).toEqual(
      ["dispatch", "dtg", "dtf", "embroidery", "packing", "print", "screens", "sewing", "warehouse"].sort(),
    );
    for (const s of Object.values(stages)) {
      expect(s.status).toBe("waiting");
      expect(s.version).toBe(1);
      expect(s.qty).toBe(10);
    }
  });
});

describe("D2/D3 — department scoping with Admin override", () => {
  it("dept(print) patches own stage; other department → 403; admin overrides any", async () => {
    const job = await newJob(adminCookie, customerId);
    const mine = await stage(job, "print");
    expect((await patch(job.id, mine, printCookie, { status: "in_progress" })).status).toBe(200);
    const other = await stage(job, "dtg");
    const denied = await patch(job.id, other, printCookie, { status: "in_progress" });
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toMatch(/department: dtg/);
    expect((await patch(job.id, other, adminCookie, { status: "in_progress" })).status).toBe(200);
  });
});

describe("D4/D7 — fields persist, progress auto-completes", () => {
  it("notes/waste/reprint/processDate stored; progress >= qty completes", async () => {
    const job = await newJob(adminCookie, customerId);
    const s = await stage(job, "print");
    const r = await patch(job.id, s, adminCookie, {
      notes: "D4 note",
      waste: 2,
      reprintQty: 1,
      processDate: "2026-10-05",
      status: "in_progress",
      progress: 4,
    });
    expect(r.status).toBe(200);
    expect((await r.json()).version).toBe(2);
    let row = await query<Record<string, unknown>>(
      `SELECT notes, waste, reprint_qty, status, progress, remaining, to_char(process_date,'YYYY-MM-DD') AS pd
         FROM job_stages WHERE id = $1`,
      [s.id],
    );
    expect(row[0]).toMatchObject({ notes: "D4 note", waste: 2, reprint_qty: 1, status: "in_progress", progress: 4, remaining: 6, pd: "2026-10-05" });

    const next = await stage(job, "print");
    const done = await patch(job.id, next, adminCookie, { progress: 10 });
    expect(done.status).toBe(200);
    row = await query(`SELECT status, progress, remaining, finished_at IS NOT NULL AS finished FROM job_stages WHERE id = $1`, [s.id]);
    expect(row[0]).toMatchObject({ status: "completed", progress: 10, remaining: 0, finished: true });
  });
});

describe("transition validity", () => {
  it("waiting → completed → 422; blocked reachable then blocked → completed → 422", async () => {
    const job = await newJob(adminCookie, customerId);
    const s = await stage(job, "sewing");
    expect((await patch(job.id, s, adminCookie, { status: "completed" })).status).toBe(422);
    const s2 = await stage(job, "sewing");
    expect((await patch(job.id, s2, adminCookie, { status: "blocked" })).status).toBe(200);
    const s3 = await stage(job, "sewing");
    expect((await patch(job.id, s3, adminCookie, { status: "completed" })).status).toBe(422);
    const s4 = await stage(job, "sewing");
    expect((await patch(job.id, s4, adminCookie, { status: "in_progress" })).status).toBe(200); // blocked → in_progress valid
  });
});

describe("D8 — reopen completed stage (audited, progress = qty−1)", () => {
  it("reopens, clears finishedAt, resets progress, writes stage audit", async () => {
    const job = await newJob(adminCookie, customerId);
    const s = await stage(job, "dtg");
    expect((await patch(job.id, s, adminCookie, { status: "in_progress", progress: 10 })).status).toBe(200);
    const closed = await stage(job, "dtg");
    expect((await patch(job.id, closed, adminCookie, { status: "in_progress" })).status).toBe(200);
    const row = await query<Record<string, unknown>>(
      `SELECT status, progress, finished_at, completed_by FROM job_stages WHERE id = $1`,
      [s.id],
    );
    expect(row[0].status).toBe("in_progress");
    expect(Number(row[0].progress)).toBe(9); // v11 parity: qty − 1
    expect(row[0].finished_at).toBeNull();
    expect(row[0].completed_by).toBeNull();
    const auditRows = await query<{ n: string }>(
      `SELECT count(*)::int AS n FROM operational_audit WHERE job_id = $1 AND action = 'stage' AND entity_type = 'stage' AND entity_id = $2`,
      [job.id, s.id],
    );
    expect(Number(auditRows[0].n)).toBeGreaterThanOrEqual(2); // complete + reopen
  });
});

describe("D10 — dispatch stage closes only via finalise", () => {
  it("direct completion → 422, progress auto-complete bypass → 422", async () => {
    const job = await newJob(adminCookie, customerId);
    const s = await stage(job, "dispatch");
    expect((await patch(job.id, s, adminCookie, { status: "completed" })).status).toBe(422);
    const s2 = await stage(job, "dispatch");
    expect((await patch(job.id, s2, adminCookie, { status: "in_progress", progress: 10 })).status).toBe(422);
  });

  it("finalise too early → 422; after all others complete → dispatch stage completed", async () => {
    const job = await newJob(adminCookie, customerId);
    const early = await finalise(
      makeRequest(`/api/jobs/${job.id}/dispatch/finalise`, { method: "POST", cookie: adminCookie, body: {} }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(early.status).toBe(422);

    await completeAllExceptDispatch(job, adminCookie);
    const ok = await finalise(
      makeRequest(`/api/jobs/${job.id}/dispatch/finalise`, { method: "POST", cookie: adminCookie, body: {} }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(ok.status).toBe(200);
    const stages = await refreshStages(adminCookie, job.id);
    expect(stages.dispatch.status).toBe("completed");
  });
});

describe("J9 — job completes only when every stage incl. dispatch completed", () => {
  it("open → in_production → completed; stage edit on completed job → 422", async () => {
    const job = await newJob(adminCookie, customerId);
    expect((await getJob(adminCookie, job.id)).status).toBe("open");
    const first = (await refreshStages(adminCookie, job.id)).print;
    await patch(job.id, first, adminCookie, { status: "in_progress", progress: 1 });
    expect((await getJob(adminCookie, job.id)).status).toBe("in_production");

    await completeAllExceptDispatch(job, adminCookie);
    const fin = await finalise(
      makeRequest(`/api/jobs/${job.id}/dispatch/finalise`, { method: "POST", cookie: adminCookie, body: {} }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(fin.status).toBe(200);
    expect((await getJob(adminCookie, job.id)).status).toBe("completed");

    const again = (await refreshStages(adminCookie, job.id)).print;
    const blocked = await patch(job.id, again, adminCookie, { status: "in_progress" });
    expect(blocked.status).toBe(422);
    expect((await blocked.json()).error).toMatch(/Completed jobs cannot be reopened/);
  });

  it("J4 companion: stale stage version → 409 with current record", async () => {
    const job = await newJob(adminCookie, customerId);
    const s = await stage(job, "print");
    expect((await patch(job.id, s, adminCookie, { status: "in_progress" })).status).toBe(200);
    const stale = await patch(job.id, s, adminCookie, { status: "blocked" }); // still version 1
    expect(stale.status).toBe(409);
    const body = await stale.json();
    expect(body.error).toMatch(/Reload and retry/);
    expect(body.current.version).toBe(2);
  });
});

describe("cancel — admin/ops only, guards work", () => {
  it("office → 403; open job cancels with reason; stages frozen after", async () => {
    const office = await makeUser({ roles: ["office"] });
    const job = await newJob(adminCookie, customerId);
    const noPerm = await cancel(
      makeRequest(`/api/jobs/${job.id}/cancel`, { method: "POST", cookie: office.cookie, body: { reason: "x yz" } }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(noPerm.status).toBe(403);

    const ok = await cancel(
      makeRequest(`/api/jobs/${job.id}/cancel`, { method: "POST", cookie: adminCookie, body: { reason: "customer changed mind" } }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(ok.status).toBe(200);
    expect((await getJob(adminCookie, job.id)).status).toBe("cancelled");

    const s = (await refreshStages(adminCookie, job.id)).print;
    const blocked = await patch(job.id, s, adminCookie, { status: "in_progress" });
    expect(blocked.status).toBe(422);
    expect((await blocked.json()).error).toMatch(/Cancelled jobs cannot be worked on/);
  });

  it("completed job cannot be cancelled", async () => {
    const job = await newJob(adminCookie, customerId);
    await completeAllExceptDispatch(job, adminCookie);
    await finalise(
      makeRequest(`/api/jobs/${job.id}/dispatch/finalise`, { method: "POST", cookie: adminCookie, body: {} }),
      { params: Promise.resolve({ id: job.id }) },
    );
    const res = await cancel(
      makeRequest(`/api/jobs/${job.id}/cancel`, { method: "POST", cookie: adminCookie, body: { reason: "too late now" } }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(res.status).toBe(422);
  });
});

describe("stage PATCH route auth", () => {
  it("unauthenticated → 401", async () => {
    const job = await newJob(adminCookie, customerId);
    const s = await stage(job, "print");
    const res = await patchStage(
      makeRequest(`/api/jobs/${job.id}/stages/${s.id}`, { method: "PATCH", body: { status: "in_progress", version: 1 } }),
      { params: Promise.resolve({ id: job.id, stageId: s.id }) },
    );
    expect(res.status).toBe(401);
  });

  it("structural 405 — no DELETE/PUT on stage route", async () => {
    const route = await import("@/app/api/jobs/[id]/stages/[stageId]/route");
    expect("DELETE" in route).toBe(false);
    expect("PUT" in route).toBe(false);
  });
});
