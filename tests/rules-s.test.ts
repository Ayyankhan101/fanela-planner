// Rules S1–S10: swatch machine, requirement toggle, Embroidery gate (phase0/01 §E swatch rows).
import { describe, it, expect, beforeAll } from "vitest";
import { makeUser, makeRequest, query, randomUUID, type TestUser } from "./helpers";
import { newCustomer, newJob, getJob, refreshStages, swatchApprove, swatchWaive } from "./fixtures";
import { POST as createAttempt } from "@/app/api/jobs/[id]/swatch/attempts/route";
import { PATCH as patchAttempt } from "@/app/api/jobs/[id]/swatch/attempts/[attemptId]/route";
import { PATCH as patchRequirement } from "@/app/api/jobs/[id]/swatch/route";
import { PATCH as patchStage } from "@/app/api/jobs/[id]/stages/[stageId]/route";

let adminCookie: string;
let customerId: string;
let embroideryDept: TestUser;
let embroideryCookie: string;
let printCookie: string;
const suffix = randomUUID().slice(0, 8);

async function create(jobId: string, cookie = adminCookie) {
  const res = await createAttempt(
    makeRequest(`/api/jobs/${jobId}/swatch/attempts`, { method: "POST", cookie, body: { sampleQty: 2 } }),
    { params: Promise.resolve({ id: jobId }) },
  );
  return { status: res.status, json: async () => res.json() };
}

async function move(jobId: string, attemptId: string, body: Record<string, unknown>, cookie = adminCookie) {
  const res = await patchAttempt(
    makeRequest(`/api/jobs/${jobId}/swatch/attempts/${attemptId}`, { method: "PATCH", cookie, body }),
    { params: Promise.resolve({ id: jobId, attemptId }) },
  );
  return { status: res.status, json: async () => res.json() };
}

async function requirement(jobId: string, body: Record<string, unknown>, cookie = adminCookie) {
  const res = await patchRequirement(
    makeRequest(`/api/jobs/${jobId}/swatch`, { method: "PATCH", cookie, body }),
    { params: Promise.resolve({ id: jobId }) },
  );
  return { status: res.status, json: async () => res.json() };
}

beforeAll(async () => {
  const admin = await makeUser({ roles: ["admin"] });
  adminCookie = admin.cookie;
  embroideryDept = await makeUser({ roles: ["dept"], departments: ["embroidery"] });
  embroideryCookie = embroideryDept.cookie;
  const print = await makeUser({ roles: ["dept"], departments: ["print"] });
  printCookie = print.cookie;
  customerId = await newCustomer(adminCookie, `S Co ${suffix}`);
});

describe("S1 — required whenever job has Embroidery stage", () => {
  it("new job: requirement row required=true, attempts empty", async () => {
    const job = await newJob(adminCookie, customerId);
    const fresh = await getJob(adminCookie, job.id);
    expect(fresh.swatchRequirement.required).toBe(true);
    expect(fresh.attempts).toEqual([]);
    expect(fresh.readiness.gates.swatch).toEqual({ active: true, pass: false });
  });
});

describe("S2 — requirement toggle: admin/ops + reason when removing", () => {
  it("missing confirm → 422; removal without reason → 422; removal with reason → 200 + audit", async () => {
    const job = await newJob(adminCookie, customerId);
    expect((await requirement(job.id, { required: false, reason: "nope" })).status).toBe(422); // confirm missing
    expect((await requirement(job.id, { required: false, confirm: true })).status).toBe(422); // reason missing
    expect((await requirement(job.id, { required: false, confirm: true, reason: "no embroidery on this job" })).status).toBe(200);
    expect((await getJob(adminCookie, job.id)).swatchRequirement.required).toBe(false);
    const aud = await query<{ n: string }>(
      `SELECT count(*)::int AS n FROM operational_audit WHERE job_id = $1 AND action = 'swatch'`,
      [job.id],
    );
    expect(Number(aud[0].n)).toBeGreaterThanOrEqual(1);
  });

  it("office cannot toggle (403); gate flips off/on with readiness", async () => {
    const job = await newJob(adminCookie, customerId);
    const office = await makeUser({ roles: ["office"] });
    expect((await requirement(job.id, { required: false, confirm: true, reason: "x yz" }, office.cookie)).status).toBe(403);
    await swatchWaive(adminCookie, job.id);
    expect((await getJob(adminCookie, job.id)).readiness.gates.swatch.active).toBe(false);
    expect((await requirement(job.id, { required: true, confirm: true })).status).toBe(200);
    expect((await getJob(adminCookie, job.id)).readiness.gates.swatch.active).toBe(true);
  });
});

describe("S3 — attempt fields persist", () => {
  it("sampleQty + embroidery fields stored on create", async () => {
    const job = await newJob(adminCookie, customerId);
    const c = await create(job.id);
    expect(c.status).toBe(201);
    const { id } = await c.json();
    const row = await query<Record<string, unknown>>(
      `SELECT sample_qty, attempt_no, status FROM swatch_attempts WHERE id = $1`,
      [id as string],
    );
    expect(row[0]).toMatchObject({ sample_qty: 2, attempt_no: 1, status: "draft" });
  });
});

describe("S4/S5 — transition machine", () => {
  it("draft → in_progress → awaiting; invalid jumps → 422; rejected keeps reason", async () => {
    const job = await newJob(adminCookie, customerId);
    const c = await create(job.id);
    const { id, version } = (await c.json()) as { id: string; version: number };

    const jump = await move(job.id, id, { status: "awaiting", version }); // draft → awaiting invalid
    expect(jump.status).toBe(422);

    expect((await move(job.id, id, { status: "in_progress", version })).status).toBe(200);
    expect((await move(job.id, id, { status: "awaiting", version: version + 1 })).status).toBe(200);
    const row = await query<{ status: string; version: number }>(`SELECT status, version FROM swatch_attempts WHERE id = $1`, [id]);
    expect(row[0].status).toBe("awaiting");
    const vNow = Number(row[0].version);

    const noReason = await move(job.id, id, { status: "rejected", version: vNow });
    expect(noReason.status).toBe(422);
    const rej = await move(job.id, id, { status: "rejected", version: vNow, reason: "shade off" });
    expect(rej.status).toBe(200);

    const after = await query<Record<string, unknown>>(`SELECT status, version FROM swatch_attempts WHERE id = $1`, [id]);
    expect(after[0].status).toBe("rejected"); // S5 terminal row retained with reason
    const ev = await query<{ reason: string }>(`SELECT reason FROM swatch_attempt_events WHERE attempt_id = $1 AND action = 'rejected'`, [id]);
    expect(ev[0].reason).toBe("shade off");
  });

  it("terminal attempt immutable via API (422)", async () => {
    const job = await newJob(adminCookie, customerId);
    const id = await swatchApprove(adminCookie, job.id);
    const row = await query<{ version: number }>(`SELECT version FROM swatch_attempts WHERE id = $1`, [id]);
    const res = await move(job.id, id, { status: "rejected", version: Number(row[0].version), reason: "changed my mind" });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/cannot be changed/);
  });
});

describe("S6/S8/S9 — new attempt only from terminal; latest decides the gate", () => {
  it("in-flight blocks new attempt; rejected allows attempt 2; approved blocks reopen-by-create", async () => {
    const job = await newJob(adminCookie, customerId);
    const c = await create(job.id);
    const { id } = await c.json() as { id: string };
    const inflight = await create(job.id);
    expect(inflight.status).toBe(422);
    expect(((await inflight.json()) as { error: string }).error).toMatch(/Finish the current attempt/);

    const row = await query<{ version: number }>(`SELECT version FROM swatch_attempts WHERE id = $1`, [id]);
    await move(job.id, id, { status: "in_progress", version: Number(row[0].version) });
    await move(job.id, id, { status: "awaiting", version: Number(row[0].version) + 1 });
    await move(job.id, id, { status: "rejected", version: Number(row[0].version) + 2, reason: "retry" });

    // S9: latest rejected → gate fails
    expect((await getJob(adminCookie, job.id)).readiness.gates.swatch.pass).toBe(false);

    const second = await create(job.id);
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { id: string; version: number };
    expect(secondBody.version).toBe(1);
    const rows = await query<{ attempt_no: number }>(
      `SELECT attempt_no FROM swatch_attempts WHERE job_id = $1 ORDER BY attempt_no`,
      [job.id],
    );
    expect(rows.map((r) => r.attempt_no)).toEqual([1, 2]);

    // finish attempt 2 as approved → gate passes
    const a2 = secondBody.id;
    await move(job.id, a2, { status: "in_progress", version: 1 });
    await move(job.id, a2, { status: "awaiting", version: 2 });
    await move(job.id, a2, { status: "approved", version: 3, reason: "ok" });
    expect((await getJob(adminCookie, job.id)).readiness.gates.swatch.pass).toBe(true);

    // S8: approved latest blocks a third attempt
    const third = await create(job.id);
    expect(third.status).toBe(422);
    expect(((await third.json()) as { error: string }).error).toMatch(/already approved/);
  });
});

describe("S7 — Embroidery gate", () => {
  async function embStage(jobId: string) {
    const s = (await refreshStages(adminCookie, jobId)).embroidery;
    return { id: s.id, version: s.version };
  }
  async function patchEmb(jobId: string, cookie: string, body: Record<string, unknown>, s: { id: string; version: number }) {
    const res = await patchStage(
      makeRequest(`/api/jobs/${jobId}/stages/${s.id}`, { method: "PATCH", cookie, body: { ...body, version: s.version } }),
      { params: Promise.resolve({ id: jobId, stageId: s.id }) },
    );
    return { status: res.status, json: async () => res.json() };
  }

  it("start/progress blocked until approved; works after approval", async () => {
    const job = await newJob(adminCookie, customerId);
    const s = await embStage(job.id);
    const blocked = await patchEmb(job.id, adminCookie, { status: "in_progress" }, s);
    expect(blocked.status).toBe(422);
    expect((await blocked.json()).error).toMatch(/blocked until the current swatch is approved/);

    const progressBlocked = await patchEmb(job.id, adminCookie, { progress: 1 }, s);
    expect(progressBlocked.status).toBe(422);

    await swatchApprove(adminCookie, job.id);
    const s2 = await embStage(job.id);
    expect((await patchEmb(job.id, adminCookie, { status: "in_progress", progress: 5 }, s2)).status).toBe(200);
  });

  it("gate off when requirement removed", async () => {
    const job = await newJob(adminCookie, customerId);
    await swatchWaive(adminCookie, job.id);
    const s = await embStage(job.id);
    expect((await patchEmb(job.id, adminCookie, { status: "in_progress" }, s)).status).toBe(200);
  });
});

describe("S9b — department scoping", () => {
  it("embroidery dept creates/starts attempts; decisions denied; print dept denied everywhere", async () => {
    const job = await newJob(adminCookie, customerId);

    const printTry = await create(job.id, printCookie);
    expect(printTry.status).toBe(403);

    const c = await create(job.id, embroideryCookie);
    expect(c.status).toBe(201);
    const { id } = await c.json() as { id: string };

    // embroidery dept can run the workflow up to awaiting
    expect((await move(job.id, id, { status: "in_progress", version: 1 }, embroideryCookie)).status).toBe(200);
    expect((await move(job.id, id, { status: "awaiting", version: 2 }, embroideryCookie)).status).toBe(200);

    // decisions are Admin/Ops only
    const decision = await move(job.id, id, { status: "approved", version: 3, reason: "ok" }, embroideryCookie);
    expect(decision.status).toBe(403);
    expect((await decision.json()).error).toMatch(/Admin or Operations/);
  });

  it("structural 405 — no DELETE on attempt routes", async () => {
    const post = await import("@/app/api/jobs/[id]/swatch/attempts/route");
    const patch = await import("@/app/api/jobs/[id]/swatch/attempts/[attemptId]/route");
    expect("DELETE" in post).toBe(false);
    expect("DELETE" in patch).toBe(false);
  });
});
