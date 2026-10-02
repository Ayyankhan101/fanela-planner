// Rules L1–L5: stock ledger + audit scoping (phase0/01 §F stock rows, §G audit rows) + J4 outstanding.
import { describe, it, expect, beforeAll } from "vitest";
import { makeUser, makeRequest, query, randomUUID, type TestUser } from "./helpers";
import { newCustomer, newJob, getJob, refreshStages, swatchWaive } from "./fixtures";
import * as stockRoute from "@/app/api/jobs/[id]/stock/route";
import { PATCH as patchLine } from "@/app/api/jobs/[id]/stock/route";
import { DELETE as removeLine } from "@/app/api/jobs/[id]/lines/[lineId]/route";
import { POST as createShipment } from "@/app/api/jobs/[id]/shipments/route";
import { GET as getAudit } from "@/app/api/audit/route";
import { PATCH as patchStage } from "@/app/api/jobs/[id]/stages/[stageId]/route";
import { PATCH as patchArtwork } from "@/app/api/jobs/[id]/artwork/route";
import { PATCH as patchScreens } from "@/app/api/jobs/[id]/screens/route";

let adminCookie: string;
let customerId: string;
const users: Record<string, { cookie: string; user: TestUser }> = {};
const suffix = randomUUID().slice(0, 8);

type StockLine = {
  id: string;
  qtyOrdered: number;
  received: number;
  outstanding: number;
  confirmed: boolean;
  status: string;
  version: number;
};

async function patch(jobId: string, cookie: string, body: Record<string, unknown>) {
  const res = await patchLine(
    makeRequest(`/api/jobs/${jobId}/stock`, { method: "PATCH", cookie, body }),
    { params: Promise.resolve({ id: jobId }) },
  );
  return { status: res.status, json: async () => res.json() };
}

async function stockOf(jobId: string, cookie = adminCookie): Promise<{ lines: StockLine[] }> {
  const res = await stockRoute.GET(makeRequest(`/api/jobs/${jobId}/stock`, { cookie }), {
    params: Promise.resolve({ id: jobId }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { stock: { lines: StockLine[] } };
  return { lines: body.stock.lines };
}

async function auditOf(cookie: string, qs = "") {
  const res = await getAudit(makeRequest(`/api/audit${qs}`, { cookie }));
  return { status: res.status, json: async () => res.json() };
}

beforeAll(async () => {
  for (const role of ["admin", "ops", "office", "director"] as const) {
    const u = await makeUser({ roles: [role] });
    users[role] = { cookie: u.cookie, user: u };
  }
  const wh = await makeUser({ roles: ["dept"], departments: ["warehouse"] });
  users.warehouse = { cookie: wh.cookie, user: wh };
  const print = await makeUser({ roles: ["dept"], departments: ["print"] });
  users.print = { cookie: print.cookie, user: print };
  adminCookie = users.admin.cookie;
  customerId = await newCustomer(adminCookie, `L Co ${suffix}`);
});

describe("L1 — append-only ledger", () => {
  it("receipts append events; both retained; correction requires reason + admin/ops", async () => {
    const job = await newJob(adminCookie, customerId);
    const line = job.lines[0];
    const v0 = line.version;

    const first = await patch(job.id, adminCookie, { lineId: line.id, version: v0, receipt: { qty: 5, note: "GRN-A" } });
    expect(first.status).toBe(200);
    const v1 = ((await first.json()) as { version: number }).version;
    expect(v1).toBe(v0 + 1);
    const second = await patch(job.id, adminCookie, { lineId: line.id, version: v1, receipt: { qty: 3 } });
    expect(second.status).toBe(200);

    const events = await query<{ type: string; qty: number }>(
      `SELECT type, qty FROM stock_events WHERE job_id = $1 AND type = 'receipt' ORDER BY ts, id`,
      [job.id],
    );
    expect(events.map((e) => Number(e.qty))).toEqual([5, 3]); // append-only: both rows kept

    // correction: missing reason → 422 (schema); non-admin → 403; admin + reason → new event
    const ev = await query<{ id: string }>(`SELECT id FROM stock_events WHERE job_id = $1 LIMIT 1`, [job.id]);
    const noReason = await patch(job.id, adminCookie, {
      lineId: line.id, version: v1 + 1,
      correction: { correctsEventId: ev[0].id, qty: 4 },
    });
    expect(noReason.status).toBe(422);
    const warehouse = await patch(job.id, users.warehouse.cookie, {
      lineId: line.id, version: v1 + 1,
      correction: { correctsEventId: ev[0].id, qty: 4, reason: "mis-keyed GRN" },
    });
    expect(warehouse.status).toBe(403);
    expect(((await warehouse.json()) as { error: string }).error).toMatch(/Admin or Operations/);
    const fixed = await patch(job.id, adminCookie, {
      lineId: line.id, version: v1 + 1,
      correction: { correctsEventId: ev[0].id, qty: 4, reason: "mis-keyed GRN line 1" },
    });
    expect(fixed.status).toBe(200);
    const corrections = await query<{ reason: string; corrects_event_id: string }>(
      `SELECT reason, corrects_event_id FROM stock_events WHERE job_id = $1 AND type = 'correction'`,
      [job.id],
    );
    expect(corrections).toHaveLength(1);
    expect(corrections[0].corrects_event_id).toBe(ev[0].id);
  });

  it("stale stock line version → 409 with current record", async () => {
    const job = await newJob(adminCookie, customerId);
    const line = job.lines[0];
    const r = await patch(job.id, adminCookie, { lineId: line.id, version: line.version, receipt: { qty: 1 } });
    expect(r.status).toBe(200);
    const stale = await patch(job.id, adminCookie, { lineId: line.id, version: line.version, receipt: { qty: 1 } });
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as { current: { version: number } };
    expect(body.current.version).toBe(line.version + 1);
  });

  it("no DELETE on stock route; line removal keeps ledger rows (FK set null)", async () => {
    expect("DELETE" in stockRoute).toBe(false);
    expect("POST" in stockRoute).toBe(false);

    const job = await newJob(adminCookie, customerId);
    const line = job.lines[0];
    await patch(job.id, adminCookie, { lineId: line.id, version: line.version, receipt: { qty: 2 } });

    const rm = await removeLine(
      makeRequest(`/api/jobs/${job.id}/lines/${line.id}`, { method: "DELETE", cookie: adminCookie }),
      { params: Promise.resolve({ id: job.id, lineId: line.id }) },
    );
    expect(rm.status).toBe(200);

    const events = await query<{ job_line_id: string | null; type: string }>(
      `SELECT job_line_id, type FROM stock_events WHERE job_id = $1 ORDER BY ts, id`,
      [job.id],
    );
    expect(events.some((e) => e.type === "line_removed")).toBe(true);
    expect(events.some((e) => e.type === "receipt" && e.job_line_id === null)).toBe(true); // history survives removal
    const lines = (await stockOf(job.id)).lines;
    expect(lines.find((l) => l.id === line.id)).toBeUndefined();
  });
});

describe("L2 — audit kinds: all 8 written across entity flows", () => {
  it("customer-master, job-header, order-lines, stage, artwork, swatch, stencil, dispatch", async () => {
    const cid = await newCustomer(adminCookie, `K Co ${suffix}`); // customer-master
    const job = await newJob(adminCookie, cid); // job-header + order-lines

    const st = (await refreshStages(adminCookie, job.id)).print; // stage
    const stageRes = await patchStage(
      makeRequest(`/api/jobs/${job.id}/stages/${st.id}`, {
        method: "PATCH", cookie: adminCookie,
        body: { status: "in_progress", version: st.version },
      }),
      { params: Promise.resolve({ id: job.id, stageId: st.id }) },
    );
    expect(stageRes.status).toBe(200);

    const aw = (await patchArtwork( // artwork
      makeRequest(`/api/jobs/${job.id}/artwork`, { method: "PATCH", cookie: adminCookie, body: { action: "submit", version: 1 } }),
      { params: Promise.resolve({ id: job.id }) },
    ));
    expect(aw.status).toBe(200);

    await swatchWaive(adminCookie, job.id); // swatch

    const screen = (await getJob(adminCookie, job.id)).screen as { version: number };
    const sc = await patchScreens( // stencil
      makeRequest(`/api/jobs/${job.id}/screens`, {
        method: "PATCH", cookie: adminCookie,
        body: { required: 2, made: 2, confirmed: true, version: Number(screen.version) },
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(sc.status).toBe(200);

    const ship = await createShipment( // dispatch
      makeRequest(`/api/jobs/${job.id}/shipments`, { method: "POST", cookie: adminCookie, body: { method: "DPD", parcels: 1 } }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(ship.status).toBe(201);

    const res = await auditOf(adminCookie, "?limit=500");
    expect(res.status).toBe(200);
    const { events } = (await res.json()) as { events: { action: string }[] };
    const kinds = new Set(events.map((e) => e.action));
    for (const k of ["artwork", "customer-master", "dispatch", "job-header", "order-lines", "stage", "stencil", "swatch"]) {
      expect([...kinds], `missing audit kind: ${k}`).toContain(k);
    }
  });
});

describe("L3 — audit scoping", () => {
  it("dept print sees only own-department rows; office excludes order-lines; director sees order-lines", async () => {
    const cid = await newCustomer(adminCookie, `S Co ${suffix}`);
    const job = await newJob(adminCookie, cid);
    // generate a print-dept stage row + an embroidery swatch row (dept print must not see the latter)
    const st = (await refreshStages(adminCookie, job.id)).print;
    await patchStage(
      makeRequest(`/api/jobs/${job.id}/stages/${st.id}`, {
        method: "PATCH", cookie: adminCookie,
        body: { status: "in_progress", version: st.version },
      }),
      { params: Promise.resolve({ id: job.id, stageId: st.id }) },
    );
    await swatchWaive(adminCookie, job.id);

    const scoped = await auditOf(users.print.cookie, `?jobId=${job.id}`);
    expect(scoped.status).toBe(200);
    const { events: deptRows } = (await scoped.json()) as { events: { dept_key: string | null; action: string }[] };
    expect(deptRows.length).toBeGreaterThan(0);
    expect(deptRows.every((r) => r.dept_key === "print")).toBe(true); // own dept only
    expect(deptRows.some((r) => r.action === "order-lines")).toBe(false); // non-cost viewer

    const office = await auditOf(users.office.cookie, `?jobId=${job.id}`);
    const { events: officeRows } = (await office.json()) as { events: { action: string }[] };
    expect(officeRows.some((r) => r.action === "stage")).toBe(true);
    expect(officeRows.some((r) => r.action === "order-lines")).toBe(false);

    const director = await auditOf(users.director.cookie, `?jobId=${job.id}`);
    expect(director.status).toBe(200);
    const { events: dirRows } = (await director.json()) as { events: { action: string }[] };
    expect(dirRows.some((r) => r.action === "order-lines")).toBe(true);
  });

  it("unauthenticated audit → 401", async () => {
    const res = await getAudit(makeRequest("/api/audit"));
    expect(res.status).toBe(401);
  });
});

describe("L4 — stock route auth", () => {
  it("unauthenticated stock GET → 401", async () => {
    const job = await newJob(adminCookie, customerId);
    const res = await stockRoute.GET(makeRequest(`/api/jobs/${job.id}/stock`), {
      params: Promise.resolve({ id: job.id }),
    });
    expect(res.status).toBe(401);
  });
});

describe("J4 — outstanding = ordered − received (negative allowed)", () => {
  it("receipt 15 on qty 10 → outstanding −5", async () => {
    const job = await newJob(adminCookie, customerId);
    const line = job.lines[0];
    const before = (await stockOf(job.id)).lines.find((l) => l.id === line.id)!;
    expect(before.outstanding).toBe(10); // ordered, nothing received
    expect(before.status).toBe("Not Ordered");

    const r = await patch(job.id, adminCookie, { lineId: line.id, version: before.version, receipt: { qty: 15 } });
    expect(r.status).toBe(200);
    const after = (await stockOf(job.id)).lines.find((l) => l.id === line.id)!;
    expect(after.received).toBe(15);
    expect(after.outstanding).toBe(-5); // over-delivery displayed, not clamped
    expect(after.status).toBe("Part Received");
  });

  it("received ≥ ordered + confirmed → Complete", async () => {
    const job = await newJob(adminCookie, customerId);
    const line = job.lines[0];
    const v = (await stockOf(job.id)).lines.find((l) => l.id === line.id)!.version;
    const r1 = await patch(job.id, adminCookie, { lineId: line.id, version: v, receipt: { qty: 10 } });
    expect(r1.status).toBe(200);
    const v2 = ((await r1.json()) as { version: number }).version;
    const r2 = await patch(job.id, adminCookie, { lineId: line.id, version: v2, stockConfirmed: true });
    expect(r2.status).toBe(200);
    const row = (await stockOf(job.id)).lines.find((l) => l.id === line.id)!;
    expect(row.status).toBe("Complete");
    expect(row.confirmed).toBe(true);
  });
});
