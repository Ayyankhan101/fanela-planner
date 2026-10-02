// Rules P1–P9: dispatch plan, shipment machine, finalise, void (phase0/01 §H dispatch rows).
import { describe, it, expect, beforeAll } from "vitest";
import { makeUser, makeRequest, query, randomUUID, type TestUser } from "./helpers";
import { newCustomer, newJob, getJob, refreshStages, swatchWaive, type JobHandle } from "./fixtures";
import { POST as createShipment } from "@/app/api/jobs/[id]/shipments/route";
import { PATCH as patchShipment } from "@/app/api/shipments/[id]/route";
import { PATCH as patchDispatch } from "@/app/api/jobs/[id]/dispatch/route";
import { POST as finalise } from "@/app/api/jobs/[id]/dispatch/finalise/route";
import { PATCH as patchStage } from "@/app/api/jobs/[id]/stages/[stageId]/route";

let adminCookie: string;
let customerId: string;
const users: Record<string, { cookie: string; user: TestUser }> = {};
const suffix = randomUUID().slice(0, 8);

async function shipment(jobId: string, cookie: string, body: Record<string, unknown> = { method: "DPD", parcels: 1 }) {
  const res = await createShipment(
    makeRequest(`/api/jobs/${jobId}/shipments`, { method: "POST", cookie, body }),
    { params: Promise.resolve({ id: jobId }) },
  );
  return { status: res.status, json: async () => res.json() };
}

async function move(id: string, cookie: string, body: Record<string, unknown>) {
  const res = await patchShipment(
    makeRequest(`/api/shipments/${id}`, { method: "PATCH", cookie, body }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, json: async () => res.json() };
}

async function plan(jobId: string, cookie: string, body: Record<string, unknown>, version: number) {
  const res = await patchDispatch(
    makeRequest(`/api/jobs/${jobId}/dispatch`, { method: "PATCH", cookie, body: { ...body, version } }),
    { params: Promise.resolve({ id: jobId }) },
  );
  return { status: res.status, json: async () => res.json() };
}

async function fin(jobId: string, cookie: string, body: Record<string, unknown> = {}) {
  const res = await finalise(
    makeRequest(`/api/jobs/${jobId}/dispatch/finalise`, { method: "POST", cookie, body }),
    { params: Promise.resolve({ id: jobId }) },
  );
  return { status: res.status, json: async () => res.json() };
}

async function completeOthers(job: JobHandle, cookie = adminCookie): Promise<void> {
  await swatchWaive(cookie, job.id);
  const stages = await refreshStages(cookie, job.id);
  for (const [dept, s] of Object.entries(stages)) {
    if (dept === "dispatch" || s.status === "completed") continue;
    await patchStage(
      makeRequest(`/api/jobs/${job.id}/stages/${s.id}`, {
        method: "PATCH",
        cookie,
        body: { status: "in_progress", progress: s.qty, version: s.version },
      }),
      { params: Promise.resolve({ id: job.id, stageId: s.id }) },
    );
  }
}

beforeAll(async () => {
  for (const role of ["admin", "ops", "office", "director", "dispatch", "packing"] as const) {
    const u = await makeUser({ roles: [role] });
    users[role] = { cookie: u.cookie, user: u };
  }
  const deptDispatch = await makeUser({ roles: ["dept"], departments: ["dispatch"] });
  users.deptDispatch = { cookie: deptDispatch.cookie, user: deptDispatch };
  const deptPrint = await makeUser({ roles: ["dept"], departments: ["print"] });
  users.deptPrint = { cookie: deptPrint.cookie, user: deptPrint };
  adminCookie = users.admin.cookie;
  customerId = await newCustomer(adminCookie, `H Co ${suffix}`);
});

describe("P1 — permission matrix", () => {
  it("create shipment: admin/ops/dispatch ✓ · office/director/packing/dept ✗ · unauth 401", async () => {
    const job = await newJob(adminCookie, customerId);
    for (const role of ["admin", "ops", "dispatch"] as const) {
      expect((await shipment(job.id, users[role].cookie)).status, role).toBe(201);
    }
    for (const role of ["office", "director", "packing", "deptPrint"] as const) {
      expect((await shipment(job.id, users[role].cookie)).status, role).toBe(403);
    }
    const anon = await createShipment(
      makeRequest(`/api/jobs/${job.id}/shipments`, { method: "POST", body: { method: "DPD" } }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(anon.status).toBe(401);
  });

  it("plan dispatch: plan_dispatch (admin/ops/office) + dispatch.edit (dispatch) · director/packing ✗", async () => {
    const job = await newJob(adminCookie, customerId);
    const v1 = (await getJob(adminCookie, job.id)).version as number;
    expect((await plan(job.id, users.office.cookie, { method: "DPD" }, v1)).status).toBe(200);
    const v2 = (await getJob(adminCookie, job.id)).version as number;
    expect((await plan(job.id, users.dispatch.cookie, { instructions: "leave with reception" }, v2)).status).toBe(200);
    const v3 = (await getJob(adminCookie, job.id)).version as number;
    for (const role of ["director", "packing"] as const) {
      expect((await plan(job.id, users[role].cookie, { method: "DPD" }, v3)).status, role).toBe(403);
    }
    const stale = await plan(job.id, users.admin.cookie, { method: "DPD" }, v1);
    expect(stale.status).toBe(409);
  });

  it("finalise: dispatch.edit holders only", async () => {
    const job = await newJob(adminCookie, customerId);
    await completeOthers(job);
    expect((await fin(job.id, users.office.cookie)).status).toBe(403);
    expect((await fin(job.id, users.dispatch.cookie)).status).toBe(200);
  });
});

describe("P2 — method vocabulary + Collection confirmation", () => {
  it("unknown method → 422; Collection final transition requires confirmCollection", async () => {
    const job = await newJob(adminCookie, customerId);
    const bad = await shipment(job.id, adminCookie, { method: "Royal Mail" });
    expect(bad.status).toBe(422);

    const col = await shipment(job.id, adminCookie, { method: "Collection" });
    expect(col.status).toBe(201);
    const { id, version } = (await col.json()) as { id: string; version: number };
    expect((await move(id, adminCookie, { status: "booking_arranged", version })).status).toBe(200);
    expect((await move(id, adminCookie, { status: "booked", version: version + 1 })).status).toBe(200);
    expect((await move(id, adminCookie, { status: "labels_attached", version: version + 2 })).status).toBe(200);
    expect((await move(id, adminCookie, { status: "print_requested", version: version + 3 })).status).toBe(200);
    expect((await move(id, adminCookie, { status: "labels_printed", version: version + 4 })).status).toBe(200);

    const noConfirm = await move(id, adminCookie, { status: "collected", version: version + 5 });
    expect(noConfirm.status).toBe(422);
    expect((await noConfirm.json()).error).toMatch(/requires confirmation/);
    const confirmed = await move(id, adminCookie, { status: "collected", confirmCollection: true, version: version + 5 });
    expect(confirmed.status).toBe(200);
    const row = await query<{ status: string; final_at: string | null }>(`SELECT status, final_at FROM shipments WHERE id = $1`, [id]);
    expect(row[0]).toMatchObject({ status: "collected" });
    expect(row[0].final_at).toBeTruthy();
  });
});

describe("P3/P5/P6 — transitions, finalise, job lifecycle", () => {
  it("first final shipment → part_dispatched; finalise completes dispatch stage + job", async () => {
    const job = await newJob(adminCookie, customerId);
    await completeOthers(job);
    const s = await shipment(job.id, adminCookie);
    const { id, version } = (await s.json()) as { id: string; version: number };
    let v = version;
    for (const status of ["booking_arranged", "booked", "labels_attached", "print_requested", "labels_printed", "dispatched"] as const) {
      const r = await move(id, adminCookie, { status, version: v });
      expect(r.status, status).toBe(200);
      v = ((await r.json()) as { version: number }).version;
    }
    const fresh = await getJob(adminCookie, job.id);
    expect(fresh.status).toBe("part_dispatched");
    const stageAfterShip = (await refreshStages(adminCookie, job.id)).dispatch;
    expect(stageAfterShip.status).toBe("waiting"); // P5: shipping alone never closes the stage

    const f = await fin(job.id, adminCookie);
    expect(f.status).toBe(200);
    const after = await getJob(adminCookie, job.id);
    expect(after.status).toBe("completed");
    expect((await refreshStages(adminCookie, job.id)).dispatch.status).toBe("completed");
    const aud = await query<{ n: string }>(
      `SELECT count(*)::int AS n FROM operational_audit WHERE job_id = $1 AND action = 'dispatch'`,
      [job.id],
    );
    expect(Number(aud[0].n)).toBeGreaterThanOrEqual(2); // create + transitions
  });

  it("finalise blocked by non-final shipment; abandon + reason voids it instead", async () => {
    const job = await newJob(adminCookie, customerId);
    await completeOthers(job);
    const s = await shipment(job.id, adminCookie);
    const { id } = (await s.json()) as { id: string; version: number };

    const early = await fin(job.id, adminCookie);
    expect(early.status).toBe(422);
    expect((await early.json()).error).toMatch(/not final|abandon/i);

    const abandoned = await fin(job.id, adminCookie, { abandon: true, reason: "customer cancelled the order line" });
    expect(abandoned.status).toBe(200);
    const row = await query<{ status: string; voided: boolean }>(`SELECT status, voided FROM shipments WHERE id = $1`, [id]);
    expect(row[0]).toMatchObject({ status: "void", voided: true });
    expect((await getJob(adminCookie, job.id)).status).toBe("completed");
  });

  it("finalise with zero shipments allowed (nothing to ship)", async () => {
    const job = await newJob(adminCookie, customerId);
    await completeOthers(job);
    expect((await fin(job.id, adminCookie)).status).toBe(200);
    expect((await getJob(adminCookie, job.id)).status).toBe("completed");
  });
});

describe("P7/P8 — void + invalid transitions", () => {
  it("void needs reason, keeps row, freezes shipment; invalid jumps → 422", async () => {
    const job = await newJob(adminCookie, customerId);
    const s = await shipment(job.id, adminCookie);
    const { id, version } = (await s.json()) as { id: string; version: number };

    const jump = await move(id, adminCookie, { status: "booked", version }); // draft → booked
    expect(jump.status).toBe(422);
    expect((await jump.json()).error).toMatch(/Invalid shipment transition/);

    const noReason = await move(id, adminCookie, { status: "void", version });
    expect(noReason.status).toBe(422);

    const voided = await move(id, adminCookie, { status: "void", version, reason: "duplicate booking" });
    expect(voided.status).toBe(200);

    const count = await query<{ n: string }>(`SELECT count(*)::int AS n FROM shipments WHERE job_id = $1`, [job.id]);
    expect(Number(count[0].n)).toBe(1); // P7: row never deleted
    const events = await query<{ action: string }>(`SELECT action FROM shipment_events WHERE shipment_id = $1`, [id]);
    expect(events.map((e) => e.action)).toContain("void");

    const after = await move(id, adminCookie, { status: "booking_arranged", version: version + 1 });
    expect(after.status).toBe(422);
    expect((await after.json()).error).toMatch(/Void shipments are fixed/);
  });

  it("terminal dispatched shipment rejects further transitions", async () => {
    const job = await newJob(adminCookie, customerId);
    const s = await shipment(job.id, adminCookie);
    const { id, version } = (await s.json()) as { id: string; version: number };
    let v = version;
    for (const status of ["booking_arranged", "booked", "labels_attached", "print_requested", "labels_printed", "dispatched"] as const) {
      const r = await move(id, adminCookie, { status, version: v });
      expect(r.status, status).toBe(200);
      v = ((await r.json()) as { version: number }).version;
    }
    const back = await move(id, adminCookie, { status: "booked", version: v });
    expect(back.status).toBe(422);
  });
});

describe("P9 — labels_printed only manual", () => {
  it("print_requested → labels_printed sets label_printed flag; no auto-claim at booked", async () => {
    const job = await newJob(adminCookie, customerId);
    const s = await shipment(job.id, adminCookie);
    const { id, version } = (await s.json()) as { id: string; version: number };
    expect((await move(id, adminCookie, { status: "booking_arranged", version })).status).toBe(200);
    expect((await move(id, adminCookie, { status: "booked", version: version + 1 })).status).toBe(200);
    let row = await query<{ label_printed: boolean }>(`SELECT label_printed FROM shipments WHERE id = $1`, [id]);
    expect(row[0].label_printed).toBe(false);
    await move(id, adminCookie, { status: "labels_attached", version: version + 2 });
    await move(id, adminCookie, { status: "print_requested", version: version + 3 });
    row = await query(`SELECT label_printed FROM shipments WHERE id = $1`, [id]);
    expect(row[0].label_printed).toBe(false); // still only a request
    const printed = await move(id, adminCookie, { status: "labels_printed", version: version + 4 });
    expect(printed.status).toBe(200);
    row = await query(`SELECT label_printed FROM shipments WHERE id = $1`, [id]);
    expect(row[0].label_printed).toBe(true);
  });

  it("structural 405 — shipment route has no DELETE", async () => {
    const route = await import("@/app/api/shipments/[id]/route");
    expect("DELETE" in route).toBe(false);
  });
});
