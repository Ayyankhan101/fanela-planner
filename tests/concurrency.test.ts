// Spec §14: optimistic concurrency — stale sub-entity version → 409 + current; cross-entity independent.
import { describe, it, expect, beforeAll } from "vitest";
import { makeUser, makeRequest, query, randomUUID } from "./helpers";
import { newCustomer, newJob, getJob, refreshStages } from "./fixtures";
import { PATCH as patchStock } from "@/app/api/jobs/[id]/stock/route";
import { PATCH as patchStage } from "@/app/api/jobs/[id]/stages/[stageId]/route";
import { POST as createShipment } from "@/app/api/jobs/[id]/shipments/route";
import { PATCH as patchShipment } from "@/app/api/shipments/[id]/route";
import { POST as createAttempt } from "@/app/api/jobs/[id]/swatch/attempts/route";
import { PATCH as patchAttempt } from "@/app/api/jobs/[id]/swatch/attempts/[attemptId]/route";
import { PATCH as patchJob } from "@/app/api/jobs/[id]/route";

let adminCookie: string;
let customerId: string;
const suffix = randomUUID().slice(0, 8);

beforeAll(async () => {
  const admin = await makeUser({ roles: ["admin"] });
  adminCookie = admin.cookie;
  customerId = await newCustomer(adminCookie, `CC Co ${suffix}`);
});

async function expectStale409(res: Response, expectVersion?: number) {
  expect(res.status).toBe(409);
  const body = (await res.json()) as { error: string; current?: Record<string, unknown> };
  expect(body.error).toMatch(/changed since you loaded it/);
  expect(body.current).toBeDefined();
  if (expectVersion !== undefined) expect(Number(body.current!.version)).toBe(expectVersion);
}

describe("same-sub-entity stale version → 409 + current", () => {
  it("stage: write A wins, replayed write B (same base version) → 409 + current.version", async () => {
    const job = await newJob(adminCookie, customerId);
    const st = (await refreshStages(adminCookie, job.id)).print;
    const send = (version: number) =>
      patchStage(
        makeRequest(`/api/jobs/${job.id}/stages/${st.id}`, {
          method: "PATCH", cookie: adminCookie,
          body: { status: "in_progress", version },
        }),
        { params: Promise.resolve({ id: job.id, stageId: st.id }) },
      );

    const a = await send(st.version);
    expect(a.status).toBe(200);
    const aBody = (await a.json()) as { version: number };
    expect(aBody.version).toBe(st.version + 1);

    const b = await send(st.version); // stale base version
    await expectStale409(b, st.version + 1);
  });

  it("stock line: receipt A wins, stale receipt B → 409 + current", async () => {
    const job = await newJob(adminCookie, customerId);
    const line = job.lines[0];
    const send = (version: number) =>
      patchStock(
        makeRequest(`/api/jobs/${job.id}/stock`, {
          method: "PATCH", cookie: adminCookie,
          body: { lineId: line.id, version, receipt: { qty: 1 } },
        }),
        { params: Promise.resolve({ id: job.id }) },
      );
    const a = await send(line.version);
    expect(a.status).toBe(200);
    await expectStale409(await send(line.version), line.version + 1);
  });

  it("shipment: transition A wins, stale transition B → 409 + current", async () => {
    const job = await newJob(adminCookie, customerId);
    const s = await createShipment(
      makeRequest(`/api/jobs/${job.id}/shipments`, { method: "POST", cookie: adminCookie, body: { method: "DPD", parcels: 1 } }),
      { params: Promise.resolve({ id: job.id }) },
    );
    const { id, version } = (await s.json()) as { id: string; version: number };
    const send = (v: number) =>
      patchShipment(
        makeRequest(`/api/shipments/${id}`, {
          method: "PATCH", cookie: adminCookie,
          body: { status: "booking_arranged", version: v },
        }),
        { params: Promise.resolve({ id }) },
      );
    const a = await send(version);
    expect(a.status).toBe(200);
    await expectStale409(await send(version), version + 1);
  });

  it("swatch attempt: decision A wins, stale decision B → 409 + current", async () => {
    const job = await newJob(adminCookie, customerId);
    const c = await createAttempt(
      makeRequest(`/api/jobs/${job.id}/swatch/attempts`, { method: "POST", cookie: adminCookie, body: { sampleQty: 1 } }),
      { params: Promise.resolve({ id: job.id }) },
    );
    const { id, version } = (await c.json()) as { id: string; version: number };
    const send = (v: number) =>
      patchAttempt(
        makeRequest(`/api/jobs/${job.id}/swatch/attempts/${id}`, {
          method: "PATCH", cookie: adminCookie,
          body: { status: "in_progress", version: v },
        }),
        { params: Promise.resolve({ id: job.id, attemptId: id }) },
      );
    const a = await send(version);
    expect(a.status).toBe(200);
    await expectStale409(await send(version), version + 1);
  });

  it("job header: patch A wins, stale patch B → 409 + current", async () => {
    const job = await newJob(adminCookie, customerId);
    const fresh = await getJob(adminCookie, job.id);
    const v = Number(fresh.version);
    const send = () =>
      patchJob(
        makeRequest(`/api/jobs/${job.id}`, { method: "PATCH", cookie: adminCookie, body: { po: `PO-${randomUUID().slice(0, 6)}`, version: v } }),
        { params: Promise.resolve({ id: job.id }) },
      );
    const a = await send();
    expect(a.status).toBe(200);
    await expectStale409(await send(), v + 1);
  });
});

describe("cross-entity writes are independent (both 200)", () => {
  it("stock receipt + job header patch each use their own version", async () => {
    const job = await newJob(adminCookie, customerId);
    const fresh = await getJob(adminCookie, job.id);
    const jobV = Number(fresh.version);
    const line = job.lines[0];

    const stockRes = await patchStock(
      makeRequest(`/api/jobs/${job.id}/stock`, {
        method: "PATCH", cookie: adminCookie,
        body: { lineId: line.id, version: line.version, receipt: { qty: 4 } },
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(stockRes.status).toBe(200);

    const jobRes = await patchJob(
      makeRequest(`/api/jobs/${job.id}`, { method: "PATCH", cookie: adminCookie, body: { notes: "rushed", version: jobV } }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(jobRes.status).toBe(200); // job version untouched by stock write

    const after = await getJob(adminCookie, job.id);
    expect(Number(after.version)).toBe(jobV + 1);
    const rows = await query<{ version: number }>(`SELECT version FROM job_lines WHERE id = $1`, [line.id]);
    expect(Number(rows[0].version)).toBe(line.version + 1);
  });
});
