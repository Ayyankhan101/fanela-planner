// Rules E + import pipeline: shapes, FX-9 severities, CAS state machine, E3/E4/E5/E6,
// X1–X3, S2/S4, H2 typed confirm ([13A] rows in the plan).
/* eslint-disable @typescript-eslint/no-explicit-any -- test glue: loosely-typed API response bodies */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import "dotenv/config";
import { makeUser, login, query, randomUUID, type TestUser } from "./helpers";
import { newCustomer } from "./fixtures";
import { POST as uploadRoute, GET as listRoute } from "@/app/api/admin/import/route";
import * as importIdRoute from "@/app/api/admin/import/[id]/route";
import {
  MSG_SHAPE_F9,
  MSG_FILE_TOO_LARGE,
  MSG_ROW_CAP,
  MSG_TYPED_COUNT,
  MSG_UNAUTHENTICATED,
  MSG_FORBIDDEN_ADMIN_OPS,
} from "@/lib/errors";

const ROLES = ["admin", "ops", "office", "director", "dispatch", "packing", "dept"] as const;
const FIXTURES_DIR = resolve(__dirname, "../fixtures");
const GEN = resolve(FIXTURES_DIR, "generate.mjs");

let admin: TestUser;
let adminCookie: string;
let opsCookie: string;
const denyCookies: Record<string, string> = {};

function fx(name: string): string {
  return readFileSync(resolve(FIXTURES_DIR, name), "utf8");
}

function fxState(name: string): Record<string, any> {
  const raw = JSON.parse(fx(name));
  return typeof raw === "object" && !Array.isArray(raw) && Object.values(raw).every((v) => typeof v === "string")
    ? JSON.parse(Object.values(raw)[0] as string)
    : raw;
}

function uploadReq(
  text: string,
  opts: { cookie?: string; fileName?: string; headers?: Record<string, string> } = {},
): Request {
  return new Request("http://localhost/api/admin/import", {
    method: "POST",
    headers: {
      "x-file-name": opts.fileName ?? "fixture.json",
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...(opts.headers ?? {}),
    },
    body: text,
  });
}

async function upload(text: string, opts: { cookie?: string; fileName?: string; headers?: Record<string, string> } = {}) {
  const res = await uploadRoute(uploadReq(text, { cookie: adminCookie, ...opts }));
  const body = await res.json().catch(() => null);
  return { status: res.status, body: body as any };
}

async function get(id: string, qs = "", cookie = adminCookie) {
  const res = await importIdRoute.GET(
    new Request(`http://localhost/api/admin/import/${id}${qs}`, { headers: { cookie } }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function post(id: string, payload: Record<string, unknown>, cookie = adminCookie) {
  const res = await importIdRoute.POST(
    new Request(`http://localhost/api/admin/import/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function confirm(id: string, counts: Record<string, number>, version: number) {
  return post(id, { action: "confirm", version, counts });
}

// minimal shape-B state (jobs + catalogs + history arrays)
function inlineState(over: {
  jobNumber: string;
  legacyId: string;
  customerName: string;
  custLegacy: string;
  extraJobs?: Record<string, unknown>[];
}): string {
  const job = {
    id: over.legacyId,
    jobNumber: over.jobNumber,
    customer: over.customerName,
    customerId: over.custLegacy,
    orderDate: "2026-09-01",
    processDate: "2026-09-03",
    dispatchDate: "2026-09-05",
    quantity: 5,
    priority: "Normal",
    stages: [],
    positions: [],
    skuLines: [{ id: `${over.legacyId}-l1`, jobId: over.legacyId, sku: `${over.jobNumber}-SKU`, quantity: 5, size: "M", unitPrice: 9.99 }],
    swatch: { required: false, attempts: [] },
    dispatch: { method: "Collection", shipments: [] },
  };
  return JSON.stringify({
    schemaVersion: 3,
    customers: [{ id: over.custLegacy, name: over.customerName }],
    products: [],
    jobs: [job, ...(over.extraJobs ?? [])],
    stockEvents: [],
    operationsEvents: [],
  });
}

beforeAll(async () => {
  if (!existsSync(resolve(FIXTURES_DIR, "fx-09-dirty-data.json"))) {
    execFileSync("node", [GEN], { cwd: resolve(FIXTURES_DIR, "..") });
  }
  // idempotency: prior runs of this suite imported fixture jobs — clear them first
  const jobNumbers = new Set<string>(["TOC-1", "INJ-1", "INJ-HOLD-1"]);
  for (const f of readdirSync(FIXTURES_DIR).filter((n) => n.endsWith(".json"))) {
    try {
      const state = fxState(f);
      for (const j of state.jobs ?? []) if (typeof j?.jobNumber === "string") jobNumbers.add(j.jobNumber);
    } catch {
      /* skip malformed */
    }
  }
  const nums = [...jobNumbers];
  // FORCE RLS: app role has no DELETE on append-only tables → owner (superuser) cleans up
  const owner = new pg.Pool({
    host: process.env.PGHOST ?? "/tmp",
    port: Number(process.env.PGPORT ?? 5432),
    database: "fanela",
    user: process.env.PGUSER ?? process.env.USER ?? "mac",
  });
  await owner.query(`DELETE FROM stock_events WHERE job_id IN (SELECT id FROM jobs WHERE job_number = ANY($1))`, [nums]);
  await owner.query(`DELETE FROM operational_audit WHERE job_id IN (SELECT id FROM jobs WHERE job_number = ANY($1))`, [nums]);
  await owner.query(`DELETE FROM jobs WHERE job_number = ANY($1)`, [nums]);
  await owner.end();

  admin = await makeUser({ roles: ["admin"] });
  adminCookie = await login(admin);
  opsCookie = await login(await makeUser({ roles: ["ops"] }));
  for (const role of ROLES) {
    if (role === "admin" || role === "ops") continue;
    const u = await makeUser({ roles: [role], departments: role === "dept" ? ["print"] : [] });
    denyCookies[role] = await login(u);
  }
});

// ---- [T6/E6] permission probe ------------------------------------------------
describe("E6 — only Admin/Ops may import", () => {
  const denyStatuses = [401, 403];

  it("anon → 401 exact copy", async () => {
    const res = await uploadRoute(uploadReq(inlineState({ jobNumber: "E6-A", legacyId: "e6-a", customerName: "E6 Co", custLegacy: "e6-a" })));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe(MSG_UNAUTHENTICATED);
    expect(body.code).toBe("unauthenticated");
  });

  it("office/director/dispatch/packing/dept → 403 exact copy; admin/ops → allowed", async () => {
    for (const role of ["office", "director", "dispatch", "packing", "dept"]) {
      const res = await uploadRoute(
        uploadReq(inlineState({ jobNumber: `E6-${role}`, legacyId: `e6-${role}`, customerName: "E6 Co", custLegacy: `e6-${role}` }), {
          cookie: denyCookies[role],
        }),
      );
      expect(denyStatuses).toContain(res.status);
      const body = await res.json();
      expect(body.error).toBe(MSG_FORBIDDEN_ADMIN_OPS);
      expect(body.code).toBe("forbidden_admin_ops");
    }
    const ok = await upload(
      inlineState({ jobNumber: "E6-OK", legacyId: "e6-ok", customerName: "E6 Ok Co", custLegacy: "e6-ok" }),
      { cookie: opsCookie },
    );
    expect(ok.status).toBe(201);
  });

  it("GET [id] gate: anon 401, wrong role 403, admin 404 (id missing)", async () => {
    const id = randomUUID();
    const anon = await importIdRoute.GET(new Request(`http://localhost/api/admin/import/${id}`), {
      params: Promise.resolve({ id }),
    });
    expect(anon.status).toBe(401);
    const deny = await get(id, "", denyCookies.office);
    expect(deny.status).toBe(403);
    const adminRes = await get(id);
    expect(adminRes.status).toBe(404);
  });
});

// ---- [13A.1/2] shape detection ----------------------------------------------
describe("shape detection (phase0/05 §1)", () => {
  it("shape A — localStorage dump → previewed + counts", async () => {
    const up = await upload(fx("fx-09-dirty-data.json"), { fileName: "fx-09.json" });
    expect(up.status).toBe(201);
    expect(up.body.batch.status).toBe("previewed");
    expect(up.body.counts.create + up.body.counts.error + up.body.counts.warn + up.body.counts.skip).toBe(3);
    // original file persisted [E5] — readable pre-execute
    const orig = await get(up.body.batch.id, "?view=original");
    expect(orig.status).toBe(200);
  });

  it("shape B — state object (jobs + schemaVersion + history arrays) → 201", async () => {
    const state = fxState("fx-09-dirty-data.json");
    const up = await upload(JSON.stringify(state));
    expect(up.status).toBe(201);
    expect(up.body.counts).toBeTruthy();
  });

  it("shape C — bare jobs array → 201", async () => {
    const state = fxState("fx-09-dirty-data.json");
    const up = await upload(JSON.stringify(state.jobs));
    expect(up.status).toBe(201);
  });

  it("shape D — jobs-only object → 422 + exact F9 string", async () => {
    const state = fxState("fx-09-dirty-data.json");
    const up = await upload(JSON.stringify({ jobs: state.jobs }));
    expect(up.status).toBe(422);
    expect(up.body.error).toBe(MSG_SHAPE_F9);
    expect(up.body.code).toBe("import_shape_invalid");
  });

  it("invalid JSON → 422", async () => {
    const up = await upload("{not json");
    expect(up.status).toBe(422);
    expect(up.body.code).toBe("import_shape_invalid");
  });

  it("schemaVersion > 3 → 422 newer-prototype message", async () => {
    const state = { ...fxState("fx-09-dirty-data.json"), schemaVersion: 4 };
    const up = await upload(JSON.stringify(state));
    expect(up.status).toBe(422);
    expect(String(up.body.error)).toContain("schemaVersion 4");
  });

  it("state missing history arrays → 422 not-rebuildable", async () => {
    const state = fxState("fx-09-dirty-data.json");
    delete state.stockEvents;
    const up = await upload(JSON.stringify(state));
    expect(up.status).toBe(422);
    expect(String(up.body.error)).toContain("Stock history or audit log missing");
  });
});

// ---- [13A.3] FX-9 severities --------------------------------------------------
describe("FX-9 severities (phase0/05 §2)", () => {
  let id: string;
  let counts: any;

  beforeAll(async () => {
    const up = await upload(fx("fx-09-dirty-data.json"), { fileName: "fx-09.json" });
    expect(up.status).toBe(201);
    id = up.body.batch.id;
    counts = up.body.counts;
  });

  it("row classes: new dup → error, orphan ref → warn, clean → create", () => {
    expect(counts).toMatchObject({ create: 1, error: 1, warn: 1, skip: 0 });
  });

  it("all rows visible with filter=all; default issues filter hides clean row", async () => {
    const all = await get(id, "?view=preview&filter=all");
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(3);
    const issues = await get(id, "?view=preview"); // default = issues
    expect(issues.body.total).toBe(2);
  });

  it("error row carries duplicate-job-number + invalid-date + blank-sku", async () => {
    const all = await get(id, "?view=preview&filter=all");
    const errRow = all.body.rows.find((r: any) => r.severity === "error");
    const checks = errRow.issues.map((i: any) => i.check);
    expect(checks).toContain("duplicate-job-number");
    expect(checks).toContain("invalid-date");
    expect(checks).toContain("blank-sku");
    expect(errRow.jobNumber).toBe("DN-1001");
  });

  it("orphan customer ref → warn row", async () => {
    const all = await get(id, "?view=preview&filter=all");
    const warnRow = all.body.rows.find((r: any) => r.severity === "warn");
    expect(warnRow.jobNumber).toBe("DN-1002");
    expect(warnRow.issues.map((i: any) => i.check)).toContain("orphan-customer");
  });

  it("error CSV includes error+warn rows [S2 surface]", async () => {
    const res = await importIdRoute.GET(
      new Request(`http://localhost/api/admin/import/${id}?view=errors`, { headers: { cookie: adminCookie } }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain("DN-1001");
    expect(csv).toContain("DN-1002");
    expect(csv).not.toContain("E6-OK"); // clean rows excluded
  });
});

// ---- pagination / X4 resume ---------------------------------------------------
describe("preview pagination + session resume [X4]", () => {
  let id: string;
  let firstCounts: any;

  beforeAll(async () => {
    const up = await upload(fx("fx-10-500-jobs.json"), { fileName: "fx-10.json" });
    expect(up.status).toBe(201);
    id = up.body.batch.id;
    firstCounts = up.body.counts;
  });

  it("server-side pagination: 100 rows/page, total 500", async () => {
    const p1 = await get(id, "?view=preview&filter=all&page=1");
    expect(p1.body.pageSize).toBe(100);
    expect(p1.body.rows.length).toBe(100);
    expect(p1.body.total).toBe(500);
    const p2 = await get(id, "?view=preview&filter=all&page=2");
    expect(p2.body.rows[0].idx).not.toBe(p1.body.rows[0].idx);
  });

  it("expired session → re-login → Resume shows identical preview", async () => {
    const cookie2 = await login(admin); // fresh session
    const again = await get(id, "?view=preview&filter=all", cookie2);
    expect(again.status).toBe(200);
    expect(again.body.total).toBe(firstCounts ? 500 : 500);
    expect(again.body.counts).toEqual(firstCounts);
  });
});

// ---- [3A] state machine + CAS -------------------------------------------------
describe("state machine + CAS version guards", () => {
  const state = () =>
    inlineState({ jobNumber: `CAS-${randomUUID().slice(0, 8)}`, legacyId: `cas-${randomUUID().slice(0, 8)}`, customerName: "CAS Co", custLegacy: `cas-${randomUUID().slice(0, 8)}` });

  it("double-confirm → 409 stale_batch with current payload", async () => {
    const up = await upload(state());
    const { batch, counts } = up.body;
    const first = await confirm(batch.id, counts, batch.version);
    expect(first.status).toBe(200);
    const second = await confirm(batch.id, counts, batch.version); // stale version + status
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("This import changed in another tab — reload.");
    expect(second.body.code).toBe("stale_batch");
    expect(second.body.current).toMatchObject({ status: "confirmed" });
  });

  it("revalidate bumps version → stale confirm → 409", async () => {
    const up = await upload(state());
    const { batch, counts } = up.body;
    const rev = await post(batch.id, { action: "revalidate", version: batch.version });
    expect(rev.status).toBe(200);
    expect(rev.body.batch.version).toBeGreaterThan(batch.version);
    const staleConfirm = await confirm(batch.id, counts, batch.version); // old version
    expect(staleConfirm.status).toBe(409);
  });

  it("discard → resume → confirm → 409 (aborted is terminal)", async () => {
    const up = await upload(state());
    const { batch, counts } = up.body;
    const disc = await post(batch.id, { action: "discard", version: batch.version });
    expect(disc.status).toBe(200);
    expect(disc.body.batch.status).toBe("aborted");
    const again = await confirm(batch.id, counts, batch.version);
    expect(again.status).toBe(409);
    expect(again.body.current).toMatchObject({ status: "aborted" });
  });

  it("wrong typed count at confirm → 422 MSG_TYPED_COUNT", async () => {
    const up = await upload(state());
    const { batch, counts } = up.body;
    const bad = await confirm(batch.id, { ...counts, create: counts.create + 1 }, batch.version);
    expect(bad.status).toBe(422);
    expect(bad.body.error).toBe(MSG_TYPED_COUNT);
    expect(bad.body.code).toBe("import_typed_count_mismatch");
  });

  it("discard from preview → zero writes [13A.6]", async () => {
    const marker = randomUUID().slice(0, 8);
    const st = inlineState({ jobNumber: `DISC-${marker}`, legacyId: `disc-${marker}`, customerName: `Discard Co ${marker}`, custLegacy: `disc-${marker}` });
    const up = await upload(st);
    expect(up.status).toBe(201);
    const disc = await post(up.body.batch.id, { action: "discard", version: up.body.batch.version });
    expect(disc.status).toBe(200);
    const jobs = await query(`SELECT id FROM jobs WHERE job_number = $1`, [`DISC-${marker}`]);
    expect(jobs.length).toBe(0);
    const cust = await query(`SELECT id FROM customers WHERE lower(name) = lower($1)`, [`Discard Co ${marker}`]);
    expect(cust.length).toBe(0);
  });
});

// ---- execute: happy path, confirm-with-errors, E3 re-import -------------------
describe("execute — fx-09 (confirm with errors [13A], E3 re-import, readiness)", () => {
  let id: string;
  let counts: any;
  let version: number;

  async function freshUpload() {
    const up = await upload(fx("fx-09-dirty-data.json"), { fileName: "fx-09.json" });
    expect(up.status).toBe(201);
    id = up.body.batch.id;
    counts = up.body.counts;
    version = up.body.batch.version;
  }

  it("confirm allowed with error rows present, then execute imports clean rows only", async () => {
    await freshUpload();
    expect(counts.error).toBeGreaterThan(0); // precondition
    const c = await confirm(id, counts, version);
    expect(c.status).toBe(200);
    version = c.body.batch.version;
    const ex = await post(id, { action: "execute", version, typedCount: counts.create });
    expect(ex.status).toBe(200);
    expect(ex.body.batch.status).toBe("executed");

    // clean rows written
    const imported = await query<{ job_number: string; legacy_id: string | null; readiness_cache: string | null }>(
      `SELECT job_number, legacy_id, readiness_cache FROM jobs WHERE job_number IN ('DN-1001','DN-1002')`,
    );
    expect(imported.map((r) => r.job_number).sort()).toEqual(["DN-1001", "DN-1002"]);
    // [17A] in-tx readiness rebuild — cache populated
    for (const r of imported) expect(r.readiness_cache).toBeTruthy();
    // zero error-row writes: dup-row legacy id must not exist
    const errored = await query(`SELECT id FROM jobs WHERE legacy_id = 'job-0207'`);
    expect(errored.length).toBe(0);
    // original file still readable post-execute [E5]
    const orig = await get(id, "?view=original");
    expect(orig.status).toBe(200);
  });

  it("E3 re-import of same file → 0 created, existing skipped", async () => {
    await freshUpload();
    expect(counts.create).toBe(0);
    expect(counts.skip).toBe(2);
    expect(counts.error).toBe(1);
    const c = await confirm(id, counts, version);
    expect(c.status).toBe(200);
    const ex = await post(id, { action: "execute", version: c.body.batch.version });
    expect(ex.status).toBe(200);
    expect(ex.body.imported).toBe(0);
  });

  it("wrong typedCount → 422, batch stays confirmed (retryable)", async () => {
    await freshUpload();
    const c = await confirm(id, counts, version);
    expect(c.status).toBe(200);
    const v = c.body.batch.version;
    const ex = await post(id, { action: "execute", version: v, typedCount: counts.create + 7 });
    expect(ex.status).toBe(422);
    expect(ex.body.error).toBe(MSG_TYPED_COUNT);
    const after = await get(id, "?view=preview&filter=all");
    const rows = await query<{ status: string }>(`SELECT status FROM import_batches WHERE id = $1`, [id]);
    expect(rows[0].status).toBe("confirmed");
    expect(after.status).toBe(200); // still viewable
  });
});

// ---- mid-execute failure [13A.4] + TOCTOU [X2] --------------------------------
describe("execute failure modes", () => {
  it("mid-execute SQL failure → rollback + batch failed + errors[]", async () => {
    const marker = randomUUID().slice(0, 8);
    const custId = await newCustomer(adminCookie, `Inj Hold ${marker}`);
    await query(`INSERT INTO jobs (id, legacy_id, job_number, customer_id) VALUES ($1,$2,$3,$4)`, [
      randomUUID(),
      `inj-legacy-${marker}`,
      `INJ-HOLD-${marker}`,
      custId,
    ]);
    const st = inlineState({ jobNumber: "INJ-1", legacyId: `inj-legacy-${marker}`, customerName: `Inj Co ${marker}`, custLegacy: `inj-cust-${marker}` });
    const up = await upload(st);
    expect(up.status).toBe(201);
    const c = await confirm(up.body.batch.id, up.body.counts, up.body.batch.version);
    expect(c.status).toBe(200);
    const ex = await post(up.body.batch.id, { action: "execute", version: c.body.batch.version });
    expect(ex.status).toBe(500); // raw SQL error surfaces as 500
    const rows = await query<{ status: string; errors: unknown }>(`SELECT status, errors FROM import_batches WHERE id = $1`, [up.body.batch.id]);
    expect(rows[0].status).toBe("failed");
    expect(Array.isArray(rows[0].errors)).toBe(true);
    expect((rows[0].errors as any[]).length).toBeGreaterThan(0);
    // rollback: nothing from this batch persisted
    expect((await query(`SELECT id FROM jobs WHERE job_number = 'INJ-1'`)).length).toBe(0);
    expect((await query(`SELECT id FROM customers WHERE lower(name) = lower($1)`, [`Inj Co ${marker}`])).length).toBe(0);
    // cleanup injector
    await query(`DELETE FROM jobs WHERE job_number = $1`, [`INJ-HOLD-${marker}`]);
  });

  it("TOCTOU: job_number collides after preview → downgraded to skip, batch succeeds [X2]", async () => {
    const marker = randomUUID().slice(0, 8);
    const custId = await newCustomer(adminCookie, `Toc Hold ${marker}`);
    const st = inlineState({ jobNumber: "TOC-1", legacyId: `toc-${marker}`, customerName: `Toc Co ${marker}`, custLegacy: `toc-cust-${marker}` });
    const up = await upload(st);
    expect(up.status).toBe(201);
    expect(up.body.counts.create).toBe(1);
    // collision lands AFTER preview
    await query(`INSERT INTO jobs (id, legacy_id, job_number, customer_id) VALUES ($1,$2,$3,$4)`, [
      randomUUID(),
      `toc-hold-${marker}`,
      "TOC-1",
      custId,
    ]);
    const c = await confirm(up.body.batch.id, up.body.counts, up.body.batch.version);
    expect(c.status).toBe(200);
    const ex = await post(up.body.batch.id, { action: "execute", version: c.body.batch.version, typedCount: 1 });
    expect(ex.status).toBe(200);
    expect(ex.body.batch.status).toBe("executed");
    expect(ex.body.downgraded).toContain("TOC-1");
    expect(ex.body.imported).toBe(0);
    // exactly one TOC-1 (the manually inserted one)
    expect((await query(`SELECT id FROM jobs WHERE job_number = 'TOC-1'`)).length).toBe(1);
    await query(`DELETE FROM jobs WHERE job_number = 'TOC-1'`);
  });
});

// ---- [13A.5] E4: no reconstructed history -------------------------------------
describe("E4 — swatch/shipment/photo/audit history never imported", () => {
  it("fx-02 has attempts + shipments in file; execute writes none of them", async () => {
    const up = await upload(fx("fx-02-happy-path.json"), { fileName: "fx-02.json" });
    expect(up.status).toBe(201);
    const state = fxState("fx-02-happy-path.json");
    const jn = state.jobs[0].jobNumber as string;
    expect((state.jobs[0].swatch?.attempts ?? []).length).toBeGreaterThan(0);
    expect((state.jobs[0].dispatch?.shipments ?? []).length).toBeGreaterThan(0);

    const c = await confirm(up.body.batch.id, up.body.counts, up.body.batch.version);
    expect(c.status).toBe(200);
    const ex = await post(up.body.batch.id, { action: "execute", version: c.body.batch.version, typedCount: up.body.counts.create });
    expect(ex.status).toBe(200);

    const job = await query<{ id: string }>(`SELECT id FROM jobs WHERE job_number = $1`, [jn]);
    expect(job.length).toBe(1);
    const jobId = job[0].id;

    // forbidden tables: zero rows for this job
    expect((await query(`SELECT id FROM swatch_attempts WHERE job_id = $1`, [jobId])).length).toBe(0);
    expect((await query(`SELECT id FROM shipments WHERE job_id = $1`, [jobId])).length).toBe(0);
    expect(
      (await query(`SELECT a.id FROM swatch_assets a JOIN swatch_attempts s ON s.id = a.attempt_id WHERE s.job_id = $1`, [jobId])).length,
    ).toBe(0);
    expect((await query(`SELECT id FROM operational_audit WHERE job_id = $1`, [jobId])).length).toBe(0);
    // allowed: requirement row imported
    expect((await query(`SELECT job_id FROM swatch_requirements WHERE job_id = $1`, [jobId])).length).toBe(1);
  });
});

// ---- [S4] path traversal + [S2] CSV formula injection -------------------------
describe("file GET guards [S4] + [S2]", () => {
  it("files.key traversal outside storage/uploads → 404", async () => {
    const fileId = randomUUID();
    const batchId = randomUUID();
    await query(
      `INSERT INTO files (id, entity_type, name, size, mime, bucket, key, uploaded_by) VALUES ($1,'import','evil.json',10,'application/json','local',$2,$3)`,
      [fileId, "../../etc/passwd", admin.id],
    );
    await query(`INSERT INTO import_batches (id, kind, file_id, actor) VALUES ($1,'v11-json',$2,$3)`, [batchId, fileId, admin.id]);
    const res = await get(batchId, "?view=original");
    expect(res.status).toBe(404);
    await query(`DELETE FROM import_batches WHERE id = $1`, [batchId]);
    await query(`DELETE FROM files WHERE id = $1`, [fileId]);
  });

  it("error CSV neutralises formula cells [S2]", async () => {
    const batchId = randomUUID();
    const parsed = {
      rows: [
        {
          idx: 0,
          jobNumber: "=cmd|'/c calc'!A0",
          customer: "+SUM(A1:A9)",
          severity: "error",
          issues: [{ check: "x", severity: "error", message: "bad row" }],
          data: {},
        },
      ],
      customers: [],
      products: [],
    };
    await query(`INSERT INTO import_batches (id, kind, parsed, actor) VALUES ($1,'v11-json',$2,$3)`, [
      batchId,
      JSON.stringify(parsed),
      admin.id,
    ]);
    const res = await importIdRoute.GET(
      new Request(`http://localhost/api/admin/import/${batchId}?view=errors`, { headers: { cookie: adminCookie } }),
      { params: Promise.resolve({ id: batchId }) },
    );
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain("'=cmd|'/c calc'!A0");
    expect(csv).toContain("'+SUM(A1:A9)");
    await query(`DELETE FROM import_batches WHERE id = $1`, [batchId]);
  });

  it("unknown view → 400", async () => {
    const res = await get(randomUUID(), "?view=nope");
    expect(res.status).toBe(400);
  });
});

// ---- [X1] row cap + [X3] size guard --------------------------------------------
describe("caps [X1] + [4A/X3]", () => {
  it("50,001 rows → 413 MSG_ROW_CAP", async () => {
    const jobs = Array.from({ length: 50_001 }, (_, i) => ({ jobNumber: `OVER-${i}` }));
    const body = JSON.stringify({ schemaVersion: 3, customers: [], products: [], jobs, stockEvents: [], operationsEvents: [] });
    const res = await uploadRoute(uploadReq(body, { cookie: adminCookie }));
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error).toBe(MSG_ROW_CAP);
    expect(json.code).toBe("import_row_cap");
  });

  it("26MB body with content-length → 413 MSG_FILE_TOO_LARGE", async () => {
    const text = "x".repeat(26 * 1024 * 1024);
    const res = await uploadRoute(uploadReq(text, { cookie: adminCookie, headers: { "content-length": String(text.length) } }));
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error).toBe(MSG_FILE_TOO_LARGE);
    expect(json.code).toBe("import_file_too_large");
  });

  it("chunked 26MB body (no content-length) → 413 streaming guard", async () => {
    const text = "x".repeat(26 * 1024 * 1024);
    const res = await uploadRoute(uploadReq(text, { cookie: adminCookie })); // content-length header omitted
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error).toBe(MSG_FILE_TOO_LARGE);
  });
});

// ---- batch history list ---------------------------------------------------------
describe("batch list", () => {
  it("GET /api/admin/import → batches newest-first with counts", async () => {
    const res = await listRoute(
      new Request("http://localhost/api/admin/import", { headers: { cookie: adminCookie } }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.batches)).toBe(true);
    expect(body.batches.length).toBeGreaterThan(0);
    expect(body.batches[0]).toHaveProperty("counts");
  });
});

// ---- [4A/X3] T5: truncation spike — real Next 16 dev-proxy body integrity ----
describe("truncation spike [4A] — Next proxy >1MB upload intact", () => {
  let dev: ChildProcess | undefined;
  let base = "";
  const port = 4000 + (process.pid % 2000);
  let cookie = "";
  let spikeBatchId = "";

  beforeAll(async () => {
    // Next 16 refuses a second `next dev` per project dir — reuse a live server if one answers
    const existing = await fetch("http://localhost:3000/api/admin/import", { method: "HEAD" })
      .then((r) => r.status === 401 || r.status === 403 || r.status === 405)
      .catch(() => false);
    if (existing) {
      base = "http://localhost:3000";
    } else {
      let stderr = "";
      dev = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(port)], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });
      dev.stderr?.on("data", (c: Buffer) => (stderr += c.toString()));
      dev.stdout?.on("data", () => undefined);
      base = `http://localhost:${port}`;
      const deadline = Date.now() + 120_000;
      let ready = false;
      while (Date.now() < deadline && !ready) {
        if (dev.exitCode !== null) break;
        try {
          await fetch(`${base}/api/auth/login`, { method: "HEAD" });
          ready = true;
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      if (!ready) {
        dev.kill("SIGTERM");
        throw new Error(`next dev did not become ready in 120s: ${stderr.slice(-500)}`);
      }
    }
    cookie = (await makeUser({ roles: ["admin"] })).cookie;
  }, 180_000);

  afterAll(() => {
    dev?.kill("SIGTERM");
  });

  it("2MB body (sentinel at end) reaches handler untruncated → 201 + both rows", async () => {
    const padding = "x".repeat(2 * 1024 * 1024);
    const state = {
      schemaVersion: 3,
      customers: [],
      products: [],
      jobs: [
        { jobNumber: "SPIKE-MID", legacyId: "spike-mid", notes: padding },
        { jobNumber: "SPIKE-END-SENTINEL", legacyId: "spike-end" },
      ],
      stockEvents: [],
      operationsEvents: [],
    };
    const res = await fetch(`${base}/api/admin/import`, {
      method: "POST",
      headers: { "x-file-name": "spike.json", cookie, "content-type": "application/json" },
      body: JSON.stringify(state),
    });
    expect(res.status).toBe(201);
    const up = await res.json();
    spikeBatchId = up.batch.id;
    // rows land as warn (orphan-customer: no customers[] in this inline state) — total is what matters
    expect(up.counts.create + up.counts.warn + up.counts.error + up.counts.skip).toBe(2);
    // sentinel at byte tail must survive the proxy → full body parsed
    const pv = await fetch(`${base}/api/admin/import/${spikeBatchId}?view=preview&filter=all`, { headers: { cookie } });
    expect(pv.status).toBe(200);
    const body = await pv.json();
    expect(body.total).toBe(2);
    expect(body.rows.map((r: { jobNumber: string }) => r.jobNumber)).toContain("SPIKE-END-SENTINEL");
  }, 60_000);

  afterAll(async () => {
    if (spikeBatchId) {
      await query(`DELETE FROM import_batches WHERE id = $1`, [spikeBatchId]);
    }
    dev?.kill("SIGTERM");
  }, 30_000);
});
