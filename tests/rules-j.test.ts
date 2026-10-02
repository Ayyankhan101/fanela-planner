// Rules J1–J9: job structure, grid, search, sort, uniqueness, priority (phase0/01)
import { describe, it, expect, beforeAll } from "vitest";
import { makeUser, makeRequest, login, query, randomUUID, type TestUser } from "./helpers";
import { POST as createCustomer } from "@/app/api/customers/route";
import { POST as createJob, GET as listJobsRoute } from "@/app/api/jobs/route";
import { normalisePriority } from "@/lib/services/jobs";

let cookie: string;
let customerId: string;
const suffix = randomUUID().slice(0, 8);

async function newJob(body: Record<string, unknown>): Promise<{ status: number; json: () => Promise<Record<string, unknown>> }> {
  const res = await createJob(makeRequest("/api/jobs", { method: "POST", cookie, body }));
  return { status: res.status, json: () => res.json() };
}

async function baseJob(jobNumber: string, extra: Record<string, unknown> = {}) {
  return newJob({
    jobNumber,
    customerId,
    lines: [{ skuText: "BASE-SKU", qtyOrdered: 10 }],
    ...extra,
  });
}

beforeAll(async () => {
  const admin: TestUser = await makeUser({ roles: ["admin"] });
  cookie = await login(admin);
  const c = await createCustomer(
    makeRequest("/api/customers", { method: "POST", cookie, body: { name: `J Co ${suffix}` } }),
  );
  customerId = (await c.json()).id as string;
});

describe("J1 — job header fields", () => {
  it("stores every header field", async () => {
    const res = await newJob({
      jobNumber: `J1-${suffix}`,
      customerId,
      po: "PO-1",
      printName: "Print Name",
      orderDate: "2026-09-01",
      orderType: "bulk",
      priority: 25,
      staff: "Sam",
      processDate: "2026-09-15",
      dispatchDate: "2026-09-20",
      dispatchTime: "14:00",
      lines: [{ skuText: "J1-SKU", qtyOrdered: 5 }],
    });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const rows = await query<Record<string, unknown>>(
      `SELECT *, to_char(order_date,'YYYY-MM-DD') AS order_date_txt,
                to_char(process_date,'YYYY-MM-DD') AS process_date_txt,
                to_char(dispatch_date,'YYYY-MM-DD') AS dispatch_date_txt
         FROM jobs WHERE id = $1`,
      [id],
    );
    const j = rows[0];
    expect(j.po).toBe("PO-1");
    expect(j.print_name).toBe("Print Name");
    expect(j.order_date_txt).toBe("2026-09-01");
    expect(j.order_type).toBe("bulk");
    expect(Number(j.priority)).toBe(25);
    expect(j.staff).toBe("Sam");
    expect(j.process_date_txt).toBe("2026-09-15");
    expect(j.dispatch_date_txt).toBe("2026-09-20");
    expect(j.dispatch_time).toBe("14:00");
  });

  it("rejects unknown orderType with 422", async () => {
    const res = await newJob({
      jobNumber: `J1x-${suffix}`,
      customerId,
      orderType: "gift",
      lines: [{ skuText: "X", qtyOrdered: 1 }],
    });
    expect(res.status).toBe(422);
  });
});

describe("J2 — structured size grid", () => {
  it("persists sizes under fixed vocab", async () => {
    const res = await newJob({
      jobNumber: `J2-${suffix}`,
      customerId,
      lines: [{ skuText: "J2-SKU", qtyOrdered: 30, sizes: { XS: 2, M: 10, "5XL": 4 } }],
    });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const sizes = await query<{ size: string; qty: number }>(
      `SELECT s.size, s.qty FROM job_line_sizes s JOIN job_lines l ON l.id = s.job_line_id WHERE l.job_id = $1 ORDER BY s.size`,
      [id],
    );
    expect(sizes.map((s) => s.size)).toEqual(["5XL", "M", "XS"]);
    expect(sizes.find((s) => s.size === "M")!.qty).toBe(10);
  });

  it("rejects free-text size with 422", async () => {
    const res = await newJob({
      jobNumber: `J2x-${suffix}`,
      customerId,
      lines: [{ skuText: "J2-SKU", qtyOrdered: 1, sizes: { banana: 1 } }],
    });
    expect(res.status).toBe(422);
  });
});

describe("J3 — master SKU vs supplier SKU separate", () => {
  it("stores both columns independently", async () => {
    const res = await newJob({
      jobNumber: `J3-${suffix}`,
      customerId,
      lines: [{ skuText: "MASTER-123", supplierSku: "SUP-999", qtyOrdered: 2 }],
    });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const rows = await query<{ sku_text: string; supplier_sku: string }>(
      `SELECT sku_text, supplier_sku FROM job_lines WHERE job_id = $1`,
      [id],
    );
    expect(rows[0].sku_text).toBe("MASTER-123");
    expect(rows[0].supplier_sku).toBe("SUP-999");
  });
});

describe("J5 — search covers job number, customer, PO, print name, master + supplier SKU", () => {
  const cases: { q: string; job: string }[] = [];
  let built = false;
  async function build() {
    if (built) return;
    built = true;
    const job = `J5-${suffix}`;
    await newJob({
      jobNumber: job,
      customerId,
      po: `POSEARCH-${suffix}`,
      printName: `PRINTSEARCH-${suffix}`,
      lines: [{ skuText: `MASTERSEARCH-${suffix}`, supplierSku: `SUPSEARCH-${suffix}`, qtyOrdered: 1 }],
    });
    const custRes = await createCustomer(
      makeRequest("/api/customers", { method: "POST", cookie, body: { name: `CUSTSEARCH ${suffix}` } }),
    );
    const custId = (await custRes.json()).id;
    await newJob({ jobNumber: `J5B-${suffix}`, customerId: custId, lines: [{ skuText: "OTHER", qtyOrdered: 1 }] });

    cases.push(
      { q: job, job },
      { q: `CUSTSEARCH ${suffix}`, job: `J5B-${suffix}` },
      { q: `POSEARCH-${suffix}`, job },
      { q: `PRINTSEARCH-${suffix}`, job },
      { q: `MASTERSEARCH-${suffix}`, job },
      { q: `SUPSEARCH-${suffix}`, job },
    );
  }

  it("hits on job number, customer, PO, print name, master SKU, supplier SKU", async () => {
    await build();
    expect(cases).toHaveLength(6);
    for (const c of cases) {
      const res = await listJobsRoute(makeRequest(`/api/jobs?q=${encodeURIComponent(c.q)}`, { cookie }));
      expect(res.status).toBe(200);
      const { jobs } = await res.json();
      const numbers = (jobs as { job_number: string }[]).map((j) => j.job_number);
      expect(numbers, `search "${c.q}"`).toContain(c.job);
    }
  });
});

describe("J6 — queue sort: dispatch deadline → priority → process date", () => {
  it("orders per sort chain, nulls last", async () => {
    const p = `J6-${suffix}`;
    // dispatch d1 p50, dispatch d1 p10, dispatch d2 p50, no dispatch
    await baseJob(`${p}-a`, { dispatchDate: "2026-10-02", priority: 50, processDate: "2026-10-01" });
    await baseJob(`${p}-b`, { dispatchDate: "2026-10-02", priority: 10, processDate: "2026-10-01" });
    await baseJob(`${p}-c`, { dispatchDate: "2026-10-05", priority: 50, processDate: "2026-10-04" });
    await baseJob(`${p}-d`, { priority: 5 });

    const res = await listJobsRoute(makeRequest(`/api/jobs?q=${p}`, { cookie }));
    const { jobs } = await res.json();
    const order = (jobs as { job_number: string }[]).map((j) => j.job_number).filter((n) => n.startsWith(p));
    expect(order).toEqual([`${p}-b`, `${p}-a`, `${p}-c`, `${p}-d`]);
  });
});

describe("J7 — job number unique across system", () => {
  it("sequential duplicate → 409", async () => {
    const n = `J7-${suffix}`;
    expect((await baseJob(n)).status).toBe(201);
    expect((await baseJob(n)).status).toBe(409);
  });

  it("concurrent duplicate → exactly one wins, other 409 (unique constraint catch)", async () => {
    const n = `J7r-${suffix}`;
    const [a, b] = await Promise.all([baseJob(n), baseJob(n)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
  });
});

describe("J8 — priority level ↔ number", () => {
  it("normalisePriority map + explicit wins", () => {
    expect(normalisePriority(undefined, "urgent")).toBe(10);
    expect(normalisePriority(undefined, "high")).toBe(30);
    expect(normalisePriority(undefined, "normal")).toBe(50);
    expect(normalisePriority(42, "urgent")).toBe(42);
    expect(normalisePriority()).toBe(50);
  });

  it("priorityLevel applied on create; explicit priority wins", async () => {
    const a = await newJob({
      jobNumber: `J8u-${suffix}`,
      customerId,
      priorityLevel: "urgent",
      lines: [{ skuText: "X", qtyOrdered: 1 }],
    });
    expect(a.status).toBe(201);
    const { id: aId } = await a.json();
    const [row] = await query<{ priority: number }>(`SELECT priority FROM jobs WHERE id = $1`, [aId]);
    expect(Number(row.priority)).toBe(10);

    const b = await newJob({
      jobNumber: `J8e-${suffix}`,
      customerId,
      priority: 42,
      priorityLevel: "urgent",
      lines: [{ skuText: "X", qtyOrdered: 1 }],
    });
    expect(b.status).toBe(201);
    const { id: bId } = await b.json();
    const [row2] = await query<{ priority: number }>(`SELECT priority FROM jobs WHERE id = $1`, [bId]);
    expect(Number(row2.priority)).toBe(42);
  });
});

describe("J4 — outstanding = ordered − received (P2: stock service)", () => {
  it("computed from stock events; negative allowed; not clamped", async () => {
    const { newJob } = await import("./fixtures");
    const job = await newJob(cookie, customerId);
    const line = job.lines[0];
    const { PATCH: patchStock } = await import("@/app/api/jobs/[id]/stock/route");
    const r1 = await patchStock(
      makeRequest(`/api/jobs/${job.id}/stock`, {
        method: "PATCH", cookie,
        body: { lineId: line.id, version: line.version, receipt: { qty: 10 } },
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(r1.status).toBe(200);
    const r2 = await patchStock(
      makeRequest(`/api/jobs/${job.id}/stock`, {
        method: "PATCH", cookie,
        body: { lineId: line.id, version: ((await r1.json()) as { version: number }).version, receipt: { qty: 5 } },
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(r2.status).toBe(200);
    const { GET: getStock } = await import("@/app/api/jobs/[id]/stock/route");
    const res = await getStock(makeRequest(`/api/jobs/${job.id}/stock`, { cookie }), {
      params: Promise.resolve({ id: job.id }),
    });
    const body = (await res.json()) as { stock: { ordered: number; received: number; outstanding: number } };
    expect(body.stock.ordered).toBe(10);
    expect(body.stock.received).toBe(15);
    expect(body.stock.outstanding).toBe(-5); // over-delivery displayed, not clamped
  });
});

describe("J9 — job completes only when all stages + dispatch completed (P2)", () => {
  it("all other stages done but dispatch waiting → not completed; finalise → completed", async () => {
    const { newJob, refreshStages, swatchWaive } = await import("./fixtures");
    const job = await newJob(cookie, customerId);
    await swatchWaive(cookie, job.id);
    const { PATCH: patchStage } = await import("@/app/api/jobs/[id]/stages/[stageId]/route");
    for (const [dept, st] of Object.entries(await refreshStages(cookie, job.id))) {
      if (dept === "dispatch") continue;
      const res = await patchStage(
        makeRequest(`/api/jobs/${job.id}/stages/${st.id}`, {
          method: "PATCH", cookie,
          body: { status: "in_progress", progress: st.qty, version: st.version },
        }),
        { params: Promise.resolve({ id: job.id, stageId: st.id }) },
      );
      expect(res.status, dept).toBe(200);
    }
    const { getJob } = await import("./fixtures");
    const mid = await getJob(cookie, job.id);
    expect(mid.status).not.toBe("completed"); // dispatch stage still waiting

    const { POST: finalise } = await import("@/app/api/jobs/[id]/dispatch/finalise/route");
    const f = await finalise(
      makeRequest(`/api/jobs/${job.id}/dispatch/finalise`, { method: "POST", cookie, body: {} }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(f.status).toBe(200);
    const done = await getJob(cookie, job.id);
    expect(done.status).toBe("completed");
    const stages = await refreshStages(cookie, job.id);
    expect(Object.values(stages).every((st) => st.status === "completed")).toBe(true);
  });
});
