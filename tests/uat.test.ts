// Spec §14 UAT acceptance journeys (T10) — stateful end-to-end flows through the real
// route handlers. Coverage mapping to shipped tests is retro-logged in
// docs/phase0/08-open-items-tracker.md (§14 retro-log).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { makeUser, login, makeRequest, query, type TestUser } from "./helpers";
import { newJob, getJob as getJobJson, refreshStages, swatchWaive, fillScreens, passStock, type StageHandle } from "./fixtures";
import { PATCH as jobPatch } from "@/app/api/jobs/[id]/route";
import { PATCH as patchCustomer } from "@/app/api/customers/[id]/route";
import { POST as createCustomer } from "@/app/api/customers/route";
import { PATCH as patchDispatch } from "@/app/api/jobs/[id]/dispatch/route";
import { GET as getArtwork, PATCH as patchArtwork } from "@/app/api/jobs/[id]/artwork/route";
import { PATCH as patchStageRoute } from "@/app/api/jobs/[id]/stages/[stageId]/route";
import { PATCH as patchStockRoute } from "@/app/api/jobs/[id]/stock/route";
import { POST as postShipment } from "@/app/api/jobs/[id]/shipments/route";
import { PATCH as patchShipment } from "@/app/api/shipments/[id]/route";
import { POST as finaliseRoute } from "@/app/api/jobs/[id]/dispatch/finalise/route";
import { POST as uploadRoute } from "@/app/api/admin/import/route";
import { POST as createAttempt } from "@/app/api/jobs/[id]/swatch/attempts/route";
import * as importIdRoute from "@/app/api/admin/import/[id]/route";
import { GET as exportRoute } from "@/app/api/exports/[view]/route";

const marker = randomUUID().slice(0, 8);
const batchIds: string[] = [];
let admin = "";
let operator: TestUser;
let operatorCookie = "";
let office = "";

async function stagePatch(cookie: string, jobId: string, stageId: string, body: Record<string, unknown>) {
  return patchStageRoute(
    makeRequest(`/api/jobs/${jobId}/stages/${stageId}`, { method: "PATCH", cookie, body }),
    { params: Promise.resolve({ id: jobId, stageId }) },
  );
}

async function artworkOf(cookie: string, jobId: string) {
  const res = await getArtwork(new Request(`http://localhost/api/jobs/${jobId}/artwork`, { headers: { cookie } }), {
    params: Promise.resolve({ id: jobId }),
  });
  expect(res.status).toBe(200);
  return (await res.json()).artwork as Record<string, never>;
}

async function patchArt(cookie: string, jobId: string, body: Record<string, unknown>) {
  return patchArtwork(
    makeRequest(`/api/jobs/${jobId}/artwork`, { method: "PATCH", cookie, body }),
    { params: Promise.resolve({ id: jobId }) },
  );
}

beforeAll(async () => {
  const a: TestUser = await makeUser({ roles: ["admin"] });
  admin = await login(a);
  operator = await makeUser({ roles: ["dept"], departments: ["print"] });
  operatorCookie = await login(operator);
  const o: TestUser = await makeUser({ roles: ["office"] });
  office = await login(o);
});

afterAll(async () => {
  // FORCE RLS: append-only tables need the owner (superuser) for cleanup
  const owner = new pg.Pool({
    host: process.env.PGHOST ?? "/tmp",
    port: Number(process.env.PGPORT ?? 5432),
    database: "fanela",
    user: process.env.PGUSER ?? process.env.USER ?? "mac",
  });
  await owner.query(`DELETE FROM stock_events WHERE job_id IN (SELECT id FROM jobs WHERE job_number LIKE 'UAT-%')`);
  await owner.query(`DELETE FROM operational_audit WHERE job_id IN (SELECT id FROM jobs WHERE job_number LIKE 'UAT-%')`);
  await owner.query(
    `DELETE FROM artwork_events WHERE artwork_version_id IN (
       SELECT av.id FROM artwork_versions av JOIN artworks a ON a.id = av.artwork_id
       JOIN jobs j ON j.id = a.job_id WHERE j.job_number LIKE 'UAT-%')`,
  );
  await owner.query(
    `DELETE FROM shipment_events WHERE shipment_id IN (SELECT id FROM shipments WHERE job_id IN (SELECT id FROM jobs WHERE job_number LIKE 'UAT-%'))`,
  );
  await owner.query(`DELETE FROM jobs WHERE job_number LIKE 'UAT-%'`);
  await owner.query(`DELETE FROM customers WHERE name LIKE 'UAT %'`);
  if (batchIds.length) await owner.query(`DELETE FROM import_batches WHERE id = ANY($1)`, [batchIds]);
  await owner.end();
});

describe("§14.1 customer → job → snapshot isolation", () => {
  it("copy defaults, edit snapshot, update master → old job unchanged, new job copies", async () => {
    const custRes = await createCustomer(
      makeRequest("/api/customers", {
        method: "POST",
        cookie: admin,
        body: {
          name: `UAT Snap ${marker}`,
          defaultDispatchAddress: "1 Original Road",
          defaultDispatchMethod: "DPD",
        },
      }),
    );
    expect(custRes.status).toBe(201);
    const cust = ((await custRes.json()) as { id: string }).id;

    const jobA = await newJob(admin, cust, { jobNumber: `UAT-SNAP-A-${marker}` });
    let j = await getJobJson(admin, jobA.id);
    expect(j.dispatch_address).toBe("1 Original Road"); // copy defaults at creation
    expect(j.dispatch_method).toBe("DPD");

    // edit the snapshot (dispatch plan) — not the master
    const snap = await patchDispatch(
      makeRequest(`/api/jobs/${jobA.id}/dispatch`, {
        method: "PATCH",
        cookie: admin,
        body: { method: "Fanela Van", address: "2 Edited Way", version: Number(j.version) },
      }),
      { params: Promise.resolve({ id: jobA.id }) },
    );
    expect(snap.status).toBe(200);

    // deliberately update the master
    const master = await patchCustomer(
      makeRequest(`/api/customers/${cust}`, {
        method: "PATCH",
        cookie: admin,
        body: { confirm: true, defaultDispatchAddress: "9 Master New", defaultDispatchMethod: "Collection" },
      }),
      { params: Promise.resolve({ id: cust }) },
    );
    expect(master.status).toBe(200);

    // old job keeps its snapshot
    j = await getJobJson(admin, jobA.id);
    expect(j.dispatch_address).toBe("2 Edited Way");
    expect(j.dispatch_method).toBe("Fanela Van");

    // new job from same master copies the NEW defaults
    const jobB = await newJob(admin, cust, { jobNumber: `UAT-SNAP-B-${marker}` });
    const jB = await getJobJson(admin, jobB.id);
    expect(jB.dispatch_address).toBe("9 Master New");
    expect(jB.dispatch_method).toBe("Collection");
  });
});

describe("§14.2/3 readiness: White → Amber → Green + edge cases", () => {
  it("fresh job with no stock = White (not Amber); stock → screens → waive flips to Green", async () => {
    const cust = ((await (
      await createCustomer(
        makeRequest("/api/customers", { method: "POST", cookie: admin, body: { name: `UAT Ready ${marker}` } }),
      )
    ).json()) as { id: string }).id;
    const job = await newJob(admin, cust, { jobNumber: `UAT-READY-${marker}` });

    // waiver first: swatch default-on floors a fresh job at Amber (G7 floor) — waive to
    // reach the §14 White baseline (stock+screens active, none passing → White)
    await swatchWaive(admin, job.id);
    let j = await getJobJson(admin, job.id);
    expect(j.readiness.colour).toBe("white"); // G3: active gates, none passing → White

    await passStock(admin, job.id);
    j = await getJobJson(admin, job.id);
    expect(j.readiness.colour).toBe("amber"); // stock passes, screens still unspec'd → Amber

    await fillScreens(admin, job.id);
    j = await getJobJson(admin, job.id);
    expect(j.readiness.colour).toBe("green"); // all active gates pass
    expect(j.readiness.gates.swatch.active).toBe(false);
  });

  it("screens required=null → Screen Gate False → never Green until specified and met", async () => {
    const cust = ((await (
      await createCustomer(
        makeRequest("/api/customers", { method: "POST", cookie: admin, body: { name: `UAT Scr ${marker}` } }),
      )
    ).json()) as { id: string }).id;
    const job = await newJob(admin, cust, { jobNumber: `UAT-SCR-${marker}` });

    // stock-only edge: waive swatch first, no stock yet → White, not Amber
    await swatchWaive(admin, job.id);
    let j = await getJobJson(admin, job.id);
    expect(j.readiness.colour).toBe("white");
    expect(j.readiness.activeGates).toBe(2); // stock + screens (blank required = active+failing)

    await passStock(admin, job.id);
    j = await getJobJson(admin, job.id);
    expect(j.readiness.colour).toBe("amber"); // stock passes but screens still unspec'd → never Green

    await fillScreens(admin, job.id); // specify + meet
    j = await getJobJson(admin, job.id);
    expect(j.readiness.colour).toBe("green");
  });
});

describe("§14.4 artwork: approve → revise → Draft + audit → re-approve", () => {
  it("submit → approve → revise (new Draft version) → re-approve", async () => {
    const cust = ((await (
      await createCustomer(
        makeRequest("/api/customers", { method: "POST", cookie: admin, body: { name: `UAT Art ${marker}` } }),
      )
    ).json()) as { id: string }).id;
    const job = await newJob(admin, cust, { jobNumber: `UAT-ART-${marker}` });

    let aw = await artworkOf(admin, job.id);
    expect(aw.status).toBe("draft");
    expect(Number(aw.version)).toBe(1);

    expect((await patchArt(admin, job.id, { action: "submit", version: Number(aw.version) })).status).toBe(200);
    aw = await artworkOf(admin, job.id);
    expect((await patchArt(admin, job.id, { action: "approve", version: Number(aw.version) })).status).toBe(200);
    aw = await artworkOf(admin, job.id);
    expect(aw.status).toBe("approved");

    // revise → NEW version at Draft, rejected/approved record never rewritten (A3)
    expect(
      (await patchArt(admin, job.id, { action: "revise", version: Number(aw.version), reason: "needs changes" })).status,
    ).toBe(200);
    aw = await artworkOf(admin, job.id);
    expect(aw.status).toBe("draft");
    expect(Number(aw.version)).toBe(2);

    const audits = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM operational_audit WHERE job_id = $1 AND entity_type = 'artwork'`,
      [job.id],
    );
    expect(Number(audits[0].n)).toBeGreaterThanOrEqual(3); // submit + approve + revise

    // re-approve the new version
    expect((await patchArt(admin, job.id, { action: "submit", version: Number(aw.version) })).status).toBe(200);
    aw = await artworkOf(admin, job.id);
    expect((await patchArt(admin, job.id, { action: "approve", version: Number(aw.version) })).status).toBe(200);
    aw = await artworkOf(admin, job.id);
    expect(aw.status).toBe("approved");
    expect(Number(aw.version)).toBe(2);
  });
});

describe("§14.5/6/7 swatch lifecycle + gate", () => {
  async function attemptFlow(cookie: string, jobId: string, decisions: ("approved" | "rejected")[]) {
    const attemptRoute = await import("@/app/api/jobs/[id]/swatch/attempts/[attemptId]/route");
    const c = await createAttempt(
      makeRequest(`/api/jobs/${jobId}/swatch/attempts`, { method: "POST", cookie, body: { sampleQty: 1 } }),
      { params: Promise.resolve({ id: jobId }) },
    );
    expect(c.status).toBe(201);
    const created = (await c.json()) as { id: string; version: number };
    const { id } = created;
    let { version } = created;
    const chain: string[] = ["in_progress", "awaiting", ...decisions];
    for (const status of chain) {
      const body: Record<string, unknown> = { status, version };
      if (status === "approved" || status === "rejected") body.reason = `uat ${status}`;
      const res = await attemptRoute.PATCH(
        makeRequest(`/api/jobs/${jobId}/swatch/attempts/${id}`, { method: "PATCH", cookie, body }),
        { params: Promise.resolve({ id: jobId, attemptId: id }) },
      );
      expect(res.status).toBe(200);
      version = ((await res.json()) as { version: number }).version;
    }
    return id;
  }

  it("reject (reason) keeps embroidery blocked; new attempt → approve unblocks", async () => {
    const cust = ((await (
      await createCustomer(
        makeRequest("/api/customers", { method: "POST", cookie: admin, body: { name: `UAT Sw ${marker}` } }),
      )
    ).json()) as { id: string }).id;
    const job = await newJob(admin, cust, { jobNumber: `UAT-SW-${marker}` });

    // R5 precondition: swatch required → stage start blocked
    let emb = (await refreshStages(admin, job.id)).embroidery as StageHandle;
    expect((await stagePatch(admin, job.id, emb.id, { status: "in_progress", version: emb.version })).status).toBe(422);

    // R6: attempt 1 → rejected (reason) → still blocked (S7 gate = embroidery dept only)
    await attemptFlow(admin, job.id, ["rejected"]);
    emb = (await refreshStages(admin, job.id)).embroidery as StageHandle;
    expect((await stagePatch(admin, job.id, emb.id, { status: "in_progress", version: emb.version })).status).toBe(422);

    // new attempt → approve (R5 lifecycle create → start → complete → approve) → unblocks
    await attemptFlow(admin, job.id, ["approved"]);
    emb = (await refreshStages(admin, job.id)).embroidery as StageHandle;
    const ok = await stagePatch(admin, job.id, emb.id, { status: "in_progress", version: emb.version });
    expect(ok.status).toBe(200);
  });

  it("waive requirement → audit row → embroidery unblocks", async () => {
    const cust = ((await (
      await createCustomer(
        makeRequest("/api/customers", { method: "POST", cookie: admin, body: { name: `UAT Waive ${marker}` } }),
      )
    ).json()) as { id: string }).id;
    const job = await newJob(admin, cust, { jobNumber: `UAT-WAIVE-${marker}` });
    const emb = (await refreshStages(admin, job.id)).embroidery as StageHandle;

    const blocked = await stagePatch(admin, job.id, emb.id, { status: "in_progress", version: emb.version });
    expect(blocked.status).toBe(422);

    await swatchWaive(admin, job.id);

    const fresh = (await refreshStages(admin, job.id)).embroidery as StageHandle;
    const ok = await stagePatch(admin, job.id, fresh.id, { status: "in_progress", version: fresh.version });
    expect(ok.status).toBe(200);

    const audits = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM operational_audit WHERE job_id = $1 AND entity_type = 'swatch' AND action = 'swatch'`,
      [job.id],
    );
    expect(Number(audits[0].n)).toBeGreaterThanOrEqual(1);
  });
});

describe("§14.8 stage permissions + completion → job Completed", () => {
  it("wrong department 403, own department OK, others unaffected; all stages + finalise → Completed", async () => {
    const cust = ((await (
      await createCustomer(
        makeRequest("/api/customers", { method: "POST", cookie: admin, body: { name: `UAT Stage ${marker}` } }),
      )
    ).json()) as { id: string }).id;
    const job = await newJob(admin, cust, { jobNumber: `UAT-STAGE-${marker}` });
    await swatchWaive(admin, job.id); // let stages start

    const stages = await refreshStages(operatorCookie, job.id);
    const screens = stages.screens as StageHandle;
    const print = stages.print as StageHandle;
    const dtg = stages.dtg as StageHandle;

    // operator (print dept) → wrong department = 403
    const wrong = await stagePatch(operatorCookie, job.id, screens.id, {
      status: "in_progress",
      version: screens.version,
    });
    expect(wrong.status).toBe(403);

    // own department → OK
    const own = await stagePatch(operatorCookie, job.id, print.id, { status: "in_progress", version: print.version });
    expect(own.status).toBe(200);

    // other stages unaffected
    const after = await refreshStages(operatorCookie, job.id);
    expect(after.dtg.status).toBe(dtg.status);

    // admin completes every non-dispatch stage, then finalise → job Completed
    for (const [, s] of Object.entries(await refreshStages(admin, job.id))) {
      if (s.department_key === "dispatch") continue;
      let res = await stagePatch(admin, job.id, s.id, { status: "in_progress", version: s.version });
      expect(res.status).toBe(200);
      let v = ((await res.json()) as { version: number }).version;
      res = await stagePatch(admin, job.id, s.id, { status: "completed", version: v });
      expect(res.status).toBe(200);
      v = ((await res.json()) as { version: number }).version;
      void v;
    }
    const fin = await finaliseRoute(
      makeRequest(`/api/jobs/${job.id}/dispatch/finalise`, { method: "POST", cookie: admin, body: {} }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(fin.status).toBe(200);

    const done = await getJobJson(admin, job.id);
    expect(done.status).toBe("completed");
    const dStage = (await refreshStages(admin, job.id)).dispatch as StageHandle;
    expect(dStage.status).toBe("completed");
  });
});

describe("§14.9 shipments: booking → void → part dispatch → finalise lifecycle", () => {
  it("booking preserved on void; finalise rejected while shipment open; explicit finalise completes", async () => {
    const cust = ((await (
      await createCustomer(
        makeRequest("/api/customers", { method: "POST", cookie: admin, body: { name: `UAT Ship ${marker}` } }),
      )
    ).json()) as { id: string }).id;
    const job = await newJob(admin, cust, { jobNumber: `UAT-SHIP-${marker}` });
    await swatchWaive(admin, job.id);

    // record booking for s1
    const s1Res = await postShipment(
      makeRequest(`/api/jobs/${job.id}/shipments`, {
        method: "POST",
        cookie: admin,
        body: { method: "DPD", parcels: 1 },
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(s1Res.status).toBe(201);
    let s1 = (await s1Res.json()) as { id: string; version: number };

    for (const target of ["booking_arranged", "booked"] as const) {
      const res = await patchShipment(
        makeRequest(`/api/shipments/${s1.id}`, {
          method: "PATCH",
          cookie: admin,
          body: { status: target, version: s1.version },
        }),
        { params: Promise.resolve({ id: s1.id }) },
      );
      expect(res.status).toBe(200);
      s1 = { id: s1.id, version: ((await res.json()) as { version: number }).version };
    }

    // second shipment (part-dispatch pair)
    const s2Res = await postShipment(
      makeRequest(`/api/jobs/${job.id}/shipments`, {
        method: "POST",
        cookie: admin,
        body: { method: "Fanela Van" },
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(s2Res.status).toBe(201);
    const s2 = (await s2Res.json()) as { id: string; version: number };

    // void first with reason → booking preserved (row + reason kept, never deleted)
    const voidRes = await patchShipment(
      makeRequest(`/api/shipments/${s1.id}`, {
        method: "PATCH",
        cookie: admin,
        body: { status: "void", reason: "replaced by van load", version: s1.version },
      }),
      { params: Promise.resolve({ id: s1.id }) },
    );
    expect(voidRes.status).toBe(200);
    let j = await getJobJson(admin, job.id);
    const kept = (j.shipments as unknown as Record<string, never>[]).find((s) => s.id === s1.id);
    expect(kept).toBeTruthy();
    expect(kept!.status).toBe("void");
    expect(String(kept!.void_reason)).toContain("replaced by van load");
    expect(j.status).not.toBe("completed");

    // complete all non-dispatch stages so finalise can only fail on the open shipment
    for (const [, s] of Object.entries(await refreshStages(admin, job.id))) {
      if (s.department_key === "dispatch") continue;
      const r1 = await stagePatch(admin, job.id, s.id, { status: "in_progress", version: s.version });
      expect(r1.status).toBe(200);
      const r2 = await stagePatch(admin, job.id, s.id, {
        status: "completed",
        version: ((await r1.json()) as { version: number }).version,
      });
      expect(r2.status).toBe(200);
    }

    // finalise rejected while a shipment is open/unfinished
    const reject = await finaliseRoute(
      makeRequest(`/api/jobs/${job.id}/dispatch/finalise`, { method: "POST", cookie: admin, body: {} }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(reject.status).toBe(422);
    j = await getJobJson(admin, job.id);
    expect(j.status).not.toBe("completed");

    // final dispatch of s2 → part_dispatched
    let cur = s2;
    for (const target of ["booking_arranged", "booked", "labels_attached", "print_requested", "labels_printed", "dispatched"] as const) {
      const res = await patchShipment(
        makeRequest(`/api/shipments/${cur.id}`, {
          method: "PATCH",
          cookie: admin,
          body: { status: target, version: cur.version },
        }),
        { params: Promise.resolve({ id: cur.id }) },
      );
      expect(res.status).toBe(200);
      cur = { id: cur.id, version: ((await res.json()) as { version: number }).version };
    }
    j = await getJobJson(admin, job.id);
    expect(j.status).toBe("part_dispatched");

    // explicit finalise succeeds → job Completed
    const fin = await finaliseRoute(
      makeRequest(`/api/jobs/${job.id}/dispatch/finalise`, { method: "POST", cookie: admin, body: {} }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(fin.status).toBe(200);
    j = await getJobJson(admin, job.id);
    expect(j.status).toBe("completed");
  });
});

describe("§14.10 Excel: role-filtered export + import add-only", () => {
  it("office export strips cost columns; re-import skips duplicates, artwork stays Draft", async () => {
    // office export — no cost tokens anywhere
    const exp = await exportRoute(
      new Request("http://localhost/api/exports/stock-shortage", { headers: { cookie: office } }),
      { params: Promise.resolve({ view: "stock-shortage" }) },
    );
    expect(exp.status).toBe(200);
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await exp.arrayBuffer()) as never);
    const text: string[] = [];
    wb.worksheets[0]?.eachRow((row) =>
      row.eachCell((cell) => text.push(String(cell.value ?? ""))),
    );
    expect(text.join("\n")).not.toContain("Buying Cost");
    expect(text.join("\n")).not.toContain("unit_price");

    // import add-only: unique shape-B state, upload → confirm → execute twice
    const state = JSON.stringify({
      schemaVersion: 3,
      customers: [{ id: `uat-cust-${marker}`, name: `UAT Imp ${marker}` }],
      products: [],
      jobs: [
        {
          id: `uat-imp-${marker}`,
          jobNumber: `UAT-IMP-${marker}`,
          customer: `UAT Imp ${marker}`,
          customerId: `uat-cust-${marker}`,
          orderDate: "2026-09-01",
          processDate: "2026-09-03",
          dispatchDate: "2026-09-05",
          quantity: 5,
          priority: "Normal",
          stages: [],
          positions: [],
          skuLines: [
            {
              id: `uat-imp-${marker}-l1`,
              jobId: `uat-imp-${marker}`,
              sku: `UAT-SKU-${marker}`,
              quantity: 5,
              size: "M",
              unitPrice: 9.99,
            },
          ],
          swatch: { required: false, attempts: [] },
          dispatch: { method: "Collection", shipments: [] },
        },
      ],
      stockEvents: [],
      operationsEvents: [],
    });

    async function runImport(textIn: string) {
      const up = await uploadRoute(
        new Request("http://localhost/api/admin/import", {
          method: "POST",
          headers: { "content-type": "application/json", "x-file-name": `uat-${marker}.json`, cookie: admin },
          body: textIn,
        }),
      );
      expect(up.status).toBe(201);
      const { batch, counts } = (await up.json()) as {
        batch: { id: string; version: number };
        counts: Record<string, number>;
      };
      batchIds.push(batch.id);
      const conf = await importIdRoute.POST(
        new Request(`http://localhost/api/admin/import/${batch.id}`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: admin },
          body: JSON.stringify({ action: "confirm", version: batch.version, counts }),
        }),
        { params: Promise.resolve({ id: batch.id }) },
      );
      expect(conf.status).toBe(200);
      const cBody = (await conf.json()) as { batch: { version: number } };
      const ex = await importIdRoute.POST(
        new Request(`http://localhost/api/admin/import/${batch.id}`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: admin },
          body: JSON.stringify({ action: "execute", version: cBody.batch.version, typedCount: counts.create }),
        }),
        { params: Promise.resolve({ id: batch.id }) },
      );
      expect(ex.status).toBe(200);
      return counts;
    }

    const first = await runImport(state);
    expect(first.create).toBeGreaterThanOrEqual(1);

    // imported job artwork starts at Draft
    const imported = await query<{ id: string }>(`SELECT id FROM jobs WHERE job_number = $1`, [`UAT-IMP-${marker}`]);
    expect(imported[0]).toBeTruthy();
    const aw = await artworkOf(admin, imported[0].id);
    expect(aw.status).toBe("draft");

    // second upload of the same state → add-only: nothing created, duplicates skipped
    const second = await runImport(state);
    expect(second.create).toBe(0);
    expect(second.skip).toBeGreaterThanOrEqual(1);
  }, 60_000);
});

describe("§14.11 concurrency: stale save 409; different sub-entities both succeed", () => {
  it("same stage: second writer with stale version → 409; stock + dispatch on same job → both 200", async () => {
    const cust = ((await (
      await createCustomer(
        makeRequest("/api/customers", { method: "POST", cookie: admin, body: { name: `UAT Conc ${marker}` } }),
      )
    ).json()) as { id: string }).id;
    const job = await newJob(admin, cust, { jobNumber: `UAT-CONC-${marker}` });

    const stages = await refreshStages(admin, job.id);
    const print = stages.print as StageHandle;

    // A saves at v; B saves with the same v → 409
    const a = await stagePatch(admin, job.id, print.id, { status: "ready", version: print.version });
    expect(a.status).toBe(200);
    const b = await stagePatch(admin, job.id, print.id, { status: "in_progress", version: print.version });
    expect(b.status).toBe(409);

    // different sub-entities of one job (stock receipt vs dispatch date) → both succeed
    const j = await getJobJson(admin, job.id);
    const line = (j.lines as unknown as Record<string, never>[])[0];
    const receipt = await patchStockRoute(
      makeRequest(`/api/jobs/${job.id}/stock`, {
        method: "PATCH",
        cookie: admin,
        body: { lineId: line.id, version: Number(line.version), receipt: { qty: 2 } },
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(receipt.status).toBe(200);

    const disp = await patchDispatch(
      makeRequest(`/api/jobs/${job.id}/dispatch`, {
        method: "PATCH",
        cookie: admin,
        body: { address: "14 Concurrent Lane", version: Number(j.version) },
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(disp.status).toBe(200);
  });
});

describe("§14.12 permission probe spot-check (full matrix: probe-p2/probe-endpoints)", () => {
  it("packing role cannot mutate a job (403)", async () => {
    const packing = await makeUser({ roles: ["packing"] });
    const cookie = await login(packing);
    const cust = ((await (
      await createCustomer(
        makeRequest("/api/customers", { method: "POST", cookie: admin, body: { name: `UAT Probe ${marker}` } }),
      )
    ).json()) as { id: string }).id;
    const job = await newJob(admin, cust, { jobNumber: `UAT-PROBE-${marker}` });
    const j = await getJobJson(admin, job.id);
    const res = await jobPatch(
      makeRequest(`/api/jobs/${job.id}`, { method: "PATCH", cookie, body: { notes: "nope", version: Number(j.version) } }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(res.status).toBe(403);
  });
});
