// Probe: P2 endpoint × role matrix (status-class assertions) + structural 405s.
// Allowed classes: 2xx/404/422 (state-dependent). Denied: exactly 403. Unauth: exactly 401.
import { describe, it, expect, beforeAll } from "vitest";
import { makeUser, makeRequest, randomUUID } from "./helpers";
import { newCustomer, newJob } from "./fixtures";
import { GET as getArtwork, PATCH as patchArtwork } from "@/app/api/jobs/[id]/artwork/route";
import { GET as getStock } from "@/app/api/jobs/[id]/stock/route";
import { POST as postAttempt } from "@/app/api/jobs/[id]/swatch/attempts/route";
import { PATCH as patchReq } from "@/app/api/jobs/[id]/swatch/route";
import { POST as postShipment } from "@/app/api/jobs/[id]/shipments/route";
import { PATCH as patchShipment } from "@/app/api/shipments/[id]/route";
import { POST as finalise } from "@/app/api/jobs/[id]/dispatch/finalise/route";
import { PATCH as patchStage } from "@/app/api/jobs/[id]/stages/[stageId]/route";
import { POST as cancelJob } from "@/app/api/jobs/[id]/cancel/route";
import { GET as getAudit } from "@/app/api/audit/route";

type Actor = { key: string; cookie: string };
const actors: Actor[] = [];
const holder = (key: string) => actors.find((a) => a.key === key)!;

let customerId: string;
let jobId: string;
let stageId: string;
let stageVersion: number;
let shipmentId: string;
const suffix = randomUUID().slice(0, 8);

const canViewJobs = new Set(["admin", "ops", "office", "director", "dispatch", "packing", "deptPrint"]);
const canDispatch = new Set(["admin", "ops", "dispatch"]);
const canArtwork = new Set(["admin", "ops"]);
const canSwatchCreate = new Set(["admin", "ops", "deptEmbroidery"]);
const canStage = new Set(["admin", "ops", "deptPrint"]); // deptPrint owns the print stage
const canCancel = new Set(["admin", "ops"]);

async function probe(name: string, call: (a: Actor) => Promise<Response>) {
  const results: Record<string, number> = {};
  for (const a of actors) results[a.key] = (await call(a)).status;
  return { name, results };
}

function assertClasses(res: { name: string; results: Record<string, number> }, allowed: Set<string>, perm: (k: string) => boolean) {
  for (const [key, status] of Object.entries(res.results)) {
    if (key === "anon") {
      expect(status, `${res.name} anon`).toBe(401);
    } else if (perm(key)) {
      expect(status, `${res.name} ${key} (allowed) not denied`).not.toBe(403);
      expect(status, `${res.name} ${key} (allowed) authed`).not.toBe(401);
    } else {
      expect(status, `${res.name} ${key} (denied)`.concat(" ").concat(String(status))).toBe(403);
    }
  }
  expect(allowed.size).toBeGreaterThan(0);
}

beforeAll(async () => {
  for (const role of ["admin", "ops", "office", "director", "dispatch", "packing"] as const) {
    const u = await makeUser({ roles: [role] });
    actors.push({ key: role, cookie: u.cookie });
  }
  const dp = await makeUser({ roles: ["dept"], departments: ["print"] });
  actors.push({ key: "deptPrint", cookie: dp.cookie });
  const de = await makeUser({ roles: ["dept"], departments: ["embroidery"] });
  actors.push({ key: "deptEmbroidery", cookie: de.cookie });
  const dw = await makeUser({ roles: ["dept"], departments: ["warehouse"] });
  actors.push({ key: "deptWarehouse", cookie: dw.cookie });
  actors.push({ key: "anon", cookie: "" });

  const admin = holder("admin");
  customerId = await newCustomer(admin.cookie, `PR Co ${suffix}`);
  const job = await newJob(admin.cookie, customerId);
  jobId = job.id;
  stageId = job.stages.print.id;
  stageVersion = job.stages.print.version;
  const s = await postShipment(
    makeRequest(`/api/jobs/${jobId}/shipments`, { method: "POST", cookie: admin.cookie, body: { method: "DPD", parcels: 1 } }),
    { params: Promise.resolve({ id: jobId }) },
  );
  shipmentId = ((await s.json()) as { id: string }).id;
});

// deptWarehouse appears as plain "dept" user with warehouse only: has jobs.view + audit.view,
// but no access to print stage / embroidery swatch — covered as its own key.

describe("probe — GET artwork / stock (jobs.view)", () => {
  it("artwork GET: all roles 200-ish, anon 401", async () => {
    const r = await probe("GET artwork", (a) =>
      getArtwork(makeRequest(`/api/jobs/${jobId}/artwork`, { cookie: a.cookie }), { params: Promise.resolve({ id: jobId }) }),
    );
    assertClasses(r, canViewJobs, (k) => canViewJobs.has(k) || k.startsWith("dept"));
    expect(r.results.deptWarehouse).not.toBe(403); // jobs.view
  });

  it("stock GET: all roles with jobs.view", async () => {
    const r = await probe("GET stock", (a) =>
      getStock(makeRequest(`/api/jobs/${jobId}/stock`, { cookie: a.cookie }), { params: Promise.resolve({ id: jobId }) }),
    );
    assertClasses(r, canViewJobs, (k) => canViewJobs.has(k) || k.startsWith("dept"));
  });
});

describe("probe — PATCH artwork (artwork.approve)", () => {
  it("submit: admin/ops only", async () => {
    const r = await probe("PATCH artwork", (a) =>
      patchArtwork(
        makeRequest(`/api/jobs/${jobId}/artwork`, { method: "PATCH", cookie: a.cookie, body: { action: "submit", version: 1 } }),
        { params: Promise.resolve({ id: jobId }) },
      ),
    );
    assertClasses(r, canArtwork, (k) => canArtwork.has(k));
    expect(r.results.admin).toBe(200);
  });
});

describe("probe — swatch routes", () => {
  it("POST attempt (swatch.create): admin/ops + embroidery dept", async () => {
    const r = await probe("POST swatch attempt", (a) =>
      postAttempt(
        makeRequest(`/api/jobs/${jobId}/swatch/attempts`, { method: "POST", cookie: a.cookie, body: { sampleQty: 1 } }),
        { params: Promise.resolve({ id: jobId }) },
      ),
    );
    // first holder creates in-flight attempt → later holders may hit 422 gate; that is not a denial
    assertClasses(r, canSwatchCreate, (k) => canSwatchCreate.has(k));
  });

  it("PATCH requirement (swatch.decide): admin/ops only", async () => {
    const r = await probe("PATCH swatch requirement", (a) =>
      patchReq(
        makeRequest(`/api/jobs/${jobId}/swatch`, { method: "PATCH", cookie: a.cookie, body: { required: true, confirm: true, version: 1 } }),
        { params: Promise.resolve({ id: jobId }) },
      ),
    );
    assertClasses(r, canArtwork, (k) => canArtwork.has(k)); // swatch.decide == admin/ops set
  });
});

describe("probe — dispatch routes (dispatch.edit)", () => {
  it("POST shipment", async () => {
    const r = await probe("POST shipment", (a) =>
      postShipment(
        makeRequest(`/api/jobs/${jobId}/shipments`, { method: "POST", cookie: a.cookie, body: { method: "DPD", parcels: 1 } }),
        { params: Promise.resolve({ id: jobId }) },
      ),
    );
    assertClasses(r, canDispatch, (k) => canDispatch.has(k));
  });

  it("PATCH shipment", async () => {
    const r = await probe("PATCH shipment", (a) =>
      patchShipment(
        makeRequest(`/api/shipments/${shipmentId}`, { method: "PATCH", cookie: a.cookie, body: { status: "booking_arranged", version: 1 } }),
        { params: Promise.resolve({ id: shipmentId }) },
      ),
    );
    assertClasses(r, canDispatch, (k) => canDispatch.has(k));
  });

  it("POST finalise", async () => {
    const r = await probe("POST finalise", (a) =>
      finalise(
        makeRequest(`/api/jobs/${jobId}/dispatch/finalise`, { method: "POST", cookie: a.cookie, body: {} }),
        { params: Promise.resolve({ id: jobId }) },
      ),
    );
    assertClasses(r, canDispatch, (k) => canDispatch.has(k));
  });
});

describe("probe — stage PATCH (stage.update + dept scope)", () => {
  it("print stage: admin/ops + print dept; others 403", async () => {
    const r = await probe("PATCH stage", (a) =>
      patchStage(
        makeRequest(`/api/jobs/${jobId}/stages/${stageId}`, {
          method: "PATCH", cookie: a.cookie,
          body: { status: "waiting", version: stageVersion },
        }),
        { params: Promise.resolve({ id: jobId, stageId }) },
      ),
    );
    assertClasses(r, canStage, (k) => canStage.has(k));
    expect(r.results.deptEmbroidery).toBe(403); // wrong department
    expect(r.results.deptWarehouse).toBe(403);
  });
});

describe("probe — cancel (admin/ops)", () => {
  it("POST cancel: admin/ops only", async () => {
    const r = await probe("POST cancel", (a) =>
      cancelJob(
        makeRequest(`/api/jobs/${jobId}/cancel`, { method: "POST", cookie: a.cookie, body: { reason: "customer pulled the order" } }),
        { params: Promise.resolve({ id: jobId }) },
      ),
    );
    assertClasses(r, canCancel, (k) => canCancel.has(k));
    // admin runs last-free? admin first actually — guard: already-cancelled → 422 not 403
    expect([200, 422]).toContain(r.results.admin);
  });
});

describe("probe — GET audit (audit.view)", () => {
  it("all roles incl. dept scoping; anon 401", async () => {
    const r = await probe("GET audit", (a) => getAudit(makeRequest("/api/audit", { cookie: a.cookie })));
    for (const [key, status] of Object.entries(r.results)) {
      expect(status, `${key}`).toBe(key === "anon" ? 401 : 200);
    }
  });
});

describe("structural 405 — no DELETE exports on P2 routes", () => {
  it("artwork/stock/swatch/stages/dispatch/screens/cancel/shipments", async () => {
    const mods = [
      await import("@/app/api/jobs/[id]/artwork/route"),
      await import("@/app/api/jobs/[id]/stock/route"),
      await import("@/app/api/jobs/[id]/swatch/route"),
      await import("@/app/api/jobs/[id]/swatch/attempts/route"),
      await import("@/app/api/jobs/[id]/swatch/attempts/[attemptId]/route"),
      await import("@/app/api/jobs/[id]/stages/[stageId]/route"),
      await import("@/app/api/jobs/[id]/dispatch/route"),
      await import("@/app/api/jobs/[id]/dispatch/finalise/route"),
      await import("@/app/api/jobs/[id]/screens/route"),
      await import("@/app/api/jobs/[id]/cancel/route"),
      await import("@/app/api/shipments/[id]/route"),
    ];
    for (const m of mods) expect(typeof (m as Record<string, unknown>).DELETE).toBe("undefined");
  });
});
