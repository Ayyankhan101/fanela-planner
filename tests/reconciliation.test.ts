// [14A] Automated reconciliation: FX-1…11 through the real route handlers → per-table
// counts Δ=0 (staging preview vs real DB) + spot-assert sampled rows against the fixture.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { makeUser, makeRequest, query } from "./helpers";
import { POST as uploadRoute } from "@/app/api/admin/import/route";
import * as importIdRoute from "@/app/api/admin/import/[id]/route";
import { GET as getJobRoute } from "@/app/api/jobs/[id]/route";
import type { Counts } from "@/lib/services/import";

type FixtureName =
  | "fx-01-core-catalog" | "fx-02-happy-path" | "fx-03-swatch-lifecycle" | "fx-04-swatch-gate"
  | "fx-05-readiness-matrix" | "fx-06-shipment-states" | "fx-07-stock-history" | "fx-08-audit-trail"
  | "fx-09-dirty-data" | "fx-10-500-jobs" | "fx-11-role-probe";

type FixtureJob = {
  jobNumber?: string;
  id?: string;
  customer?: string;
  orderDate?: string;
  artworkReference?: string;
  artworkApproval?: unknown;
  stages?: { department?: string }[];
  positions?: string[];
  skuLines?: unknown[];
};

type FixtureState = {
  customers: { id?: string; name?: string }[];
  products: { id?: string; sku?: string }[];
  jobs: FixtureJob[];
  stockEvents: { id?: string; jobId?: string }[];
  operationsEvents: unknown[];
};

const FIXTURES: FixtureName[] = [
  "fx-01-core-catalog", "fx-02-happy-path", "fx-03-swatch-lifecycle", "fx-04-swatch-gate",
  "fx-05-readiness-matrix", "fx-06-shipment-states", "fx-07-stock-history", "fx-08-audit-trail",
  "fx-09-dirty-data", "fx-10-500-jobs", "fx-11-role-probe",
];

let admin = "";
let owner: pg.Pool;
let deptNames = new Set<string>();

// cleanup bookkeeping (owner pool: FORCE RLS / no DELETE for app role)
const newJobIds: string[] = [];
const newCustomerLegacy: string[] = [];
const newProductLegacy: string[] = [];
const batchIds: string[] = [];

function loadState(name: FixtureName): FixtureState {
  const raw = JSON.parse(readFileSync(join(process.cwd(), "fixtures", `${name}.json`), "utf8")) as Record<string, string>;
  const inner = JSON.parse(Object.values(raw)[0]) as FixtureState;
  return inner;
}

async function upload(name: FixtureName): Promise<{ batch: { id: string; version: number }; counts: Counts }> {
  const text = readFileSync(join(process.cwd(), "fixtures", `${name}.json`), "utf8");
  const res = await uploadRoute(
    new Request("http://localhost/api/admin/import", {
      method: "POST",
      headers: { cookie: admin, "content-type": "application/json", "x-file-name": `${name}.json` },
      body: text,
    }),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { batch: { id: string; version: number }; counts: Counts };
}

async function act(id: string, body: Record<string, unknown>): Promise<Response> {
  return importIdRoute.POST(
    new Request(`http://localhost/api/admin/import/${id}`, {
      method: "POST",
      headers: { cookie: admin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeAll(async () => {
  const u = await makeUser({ roles: ["admin"] });
  admin = u.cookie;
  owner = new pg.Pool({
    host: process.env.PGHOST ?? "/tmp",
    port: Number(process.env.PGPORT ?? 5432),
    database: "fanela",
    user: process.env.PGUSER ?? process.env.USER ?? "mac",
  });
  const depts = await query<{ name: string }>(`SELECT name FROM departments`, []);
  deptNames = new Set(depts.map((d) => d.name.toLowerCase()));
});

afterAll(async () => {
  if (newJobIds.length) {
    await owner.query(`DELETE FROM stock_events WHERE job_id = ANY($1)`, [newJobIds]);
    await owner.query(`DELETE FROM operational_audit WHERE job_id = ANY($1)`, [newJobIds]);
    await owner.query(`DELETE FROM jobs WHERE id = ANY($1)`, [newJobIds]);
  }
  if (newCustomerLegacy.length) await owner.query(`DELETE FROM customers WHERE legacy_id = ANY($1)`, [newCustomerLegacy]);
  if (newProductLegacy.length) {
    await owner.query(`DELETE FROM product_skus WHERE legacy_id = ANY($1)`, [newProductLegacy]);
    await owner.query(`DELETE FROM products WHERE legacy_id = ANY($1)`, [newProductLegacy]);
  }
  if (batchIds.length) {
    const fileIds = await owner
      .query(`SELECT file_id FROM import_batches WHERE id = ANY($1) AND file_id IS NOT NULL`, [batchIds])
      .then((r) => r.rows.map((row: { file_id: string }) => row.file_id));
    await owner.query(`DELETE FROM import_batches WHERE id = ANY($1)`, [batchIds]);
    if (fileIds.length) await owner.query(`DELETE FROM files WHERE id = ANY($1)`, [fileIds]);
  }
  await owner.end();
});

for (const name of FIXTURES) {
  const isBig = name === "fx-10-500-jobs";
  describe(`[14A] reconciliation — ${name}`, () => {
    it(
      "import → per-table Δ=0 vs staging counts + fixture spot-asserts",
      async () => {
        const state = loadState(name);
        const jobNumbers = state.jobs.map((j) => j.jobNumber ?? "").filter(Boolean);
        const fixtureCustomerLegacy = state.customers.map((c) => c.id).filter((v): v is string => !!v);
        const fixtureProductLegacy = state.products.map((p) => p.id).filter((v): v is string => !!v);
        const fixtureSkus = [...new Set(state.products.map((p) => p.sku).filter((v): v is string => !!v))];

        // before: staging baseline (scoped to fixture keys — global counts race parallel files)
        const beforeJobRows = await query<{ id: string; job_number: string }>(
          `SELECT id, job_number FROM jobs WHERE job_number = ANY($1)`, [jobNumbers],
        );
        const beforeJobIds = new Set(beforeJobRows.map((r) => r.id));
        const beforeCustLegacy = new Set(
          (await query<{ legacy_id: string }>(`SELECT legacy_id FROM customers WHERE legacy_id = ANY($1)`, [fixtureCustomerLegacy])).map((r) => r.legacy_id),
        );
        const beforeProdLegacy = new Set(
          (await query<{ legacy_id: string }>(`SELECT legacy_id FROM products WHERE legacy_id = ANY($1)`, [fixtureProductLegacy])).map((r) => r.legacy_id),
        );

        // upload → preview → confirm → execute (same calls the screen makes)
        const { batch, counts } = await upload(name);
        batchIds.push(batch.id);
        const confirmRes = await act(batch.id, { action: "confirm", version: batch.version, counts });
        expect(confirmRes.status).toBe(200);
        const confirmBody = (await confirmRes.json()) as { batch: { version: number } };
        const typedRequired = counts.create >= 50 || counts.warn > 0;
        const execBody: Record<string, unknown> = {
          action: "execute",
          version: confirmBody.batch.version,
          ...(typedRequired ? { typedCount: counts.create } : {}),
        };
        const execRes = await act(batch.id, execBody);
        expect(execRes.status, `execute ${name}: ${await execRes.clone().text()}`).toBe(200);
        const exec = (await execRes.json()) as { counts: Counts; imported: number; downgraded: string[] };

        // A: staging counts vs real outcome → Δ=0
        expect(exec.counts.create + exec.counts.warn - exec.imported - exec.downgraded.length).toBe(0);

        // after: assertions scoped to fixture keys / this batch's job ids (parallel-file safe)
        const afterJobRows = await query<{ id: string; job_number: string }>(
          `SELECT id, job_number FROM jobs WHERE job_number = ANY($1)`, [jobNumbers],
        );
        const created = afterJobRows.filter((r) => !beforeJobIds.has(r.id));
        expect(created.length).toBe(exec.imported);
        newJobIds.push(...created.map((r) => r.id));
        const createdIds = created.map((r) => r.id);

        const scoped = async (sql: string): Promise<number> => Number((await query<{ n: string }>(sql, [createdIds]))[0].n);
        const present = async (table: string, col: string, vals: string[]): Promise<number> =>
          Number((await query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table} WHERE ${col} = ANY($1)`, [vals]))[0].n);

        // customers / products / skus: add-only presence — every fixture key lands exactly once
        expect(await present("customers", "legacy_id", fixtureCustomerLegacy)).toBe(new Set(fixtureCustomerLegacy).size);
        expect(await present("products", "legacy_id", fixtureProductLegacy)).toBe(new Set(fixtureProductLegacy).size);
        expect(await present("product_skus", "master_sku", fixtureSkus)).toBe(new Set(fixtureSkus).size);
        fixtureCustomerLegacy.filter((l) => !beforeCustLegacy.has(l)).forEach((l) => newCustomerLegacy.push(l));
        fixtureProductLegacy.filter((l) => !beforeProdLegacy.has(l)).forEach((l) => newProductLegacy.push(l));

        // per-job child tables (first-match fixture row by job_number)
        const createdNumbers = created.map((r) => r.job_number);
        const fxJobsByNumber = new Map<string, FixtureJob>();
        for (const j of state.jobs) if (j.jobNumber && !fxJobsByNumber.has(j.jobNumber)) fxJobsByNumber.set(j.jobNumber, j);
        const newFxJobs = createdNumbers.map((n) => fxJobsByNumber.get(n)).filter((j): j is FixtureJob => !!j);

        const expectLines = newFxJobs.reduce((s, j) => s + (j.skuLines?.length ?? 0), 0);
        const expectStages = newFxJobs.reduce(
          (s, j) => s + new Set((j.stages ?? []).map((st) => (st.department ?? "").toLowerCase()).filter((d) => deptNames.has(d))).size,
          0,
        );
        const expectPositions = newFxJobs.reduce((s, j) => s + (j.positions?.length ?? 0), 0);
        const expectArt = newFxJobs.filter((j) => j.artworkReference || j.artworkApproval).length;
        expect(await scoped(`SELECT count(*)::text AS n FROM job_lines WHERE job_id = ANY($1)`)).toBe(expectLines);
        expect(await scoped(`SELECT count(*)::text AS n FROM job_stages WHERE job_id = ANY($1)`)).toBe(expectStages);
        expect(await scoped(`SELECT count(*)::text AS n FROM print_positions WHERE job_id = ANY($1)`)).toBe(expectPositions);
        expect(await scoped(`SELECT count(*)::text AS n FROM screen_records WHERE job_id = ANY($1)`)).toBe(exec.imported);
        expect(await scoped(`SELECT count(*)::text AS n FROM swatch_requirements WHERE job_id = ANY($1)`)).toBe(exec.imported);
        expect(await scoped(`SELECT count(*)::text AS n FROM artworks WHERE job_id = ANY($1)`)).toBe(expectArt);
        expect(await scoped(`SELECT count(*)::text AS n FROM artwork_versions av JOIN artworks a ON a.id = av.artwork_id WHERE a.job_id = ANY($1)`)).toBe(expectArt);
        expect(await scoped(`SELECT count(*)::text AS n FROM job_contact_snapshot WHERE job_id = ANY($1)`)).toBe(exec.imported);
        expect(await scoped(`SELECT count(*)::text AS n FROM job_dispatch_snapshot WHERE job_id = ANY($1)`)).toBe(exec.imported);

        // stock events on these jobs (legacy-id dedupe) + no audit-history rows for them (E4)
        const newFxLegacy = [...new Set(newFxJobs.map((j) => j.id).filter((v): v is string => !!v))];
        const eventLegacy = state.stockEvents
          .filter((e) => e.jobId && newFxLegacy.includes(e.jobId))
          .map((e) => e.id)
          .filter((v): v is string => !!v);
        const stockN = eventLegacy.length
          ? Number(
              (await query<{ n: string }>(
                `SELECT count(*)::text AS n FROM stock_events WHERE job_id = ANY($1) AND legacy_id = ANY($2)`,
                [createdIds, eventLegacy],
              ))[0].n,
            )
          : 0;
        expect(stockN).toBe(eventLegacy.length);
        expect(await scoped(`SELECT count(*)::text AS n FROM operational_audit WHERE job_id = ANY($1)`)).toBe(0);

        // spot-assert up to 10 sampled rows against the fixture (job_number, customer, date)
        const sample = created.slice(0, 10);
        for (const row of sample) {
          const fx = fxJobsByNumber.get(row.job_number);
          expect(fx, `fixture row for ${row.job_number}`).toBeTruthy();
          const db = await query<{ job_number: string; order_date: string | null; customer: string | null }>(
            `SELECT j.job_number, j.order_date::text AS order_date, c.name AS customer
               FROM jobs j LEFT JOIN customers c ON c.id = j.customer_id WHERE j.id = $1`,
            [row.id],
          );
          expect(db[0].job_number).toBe(fx!.jobNumber);
          if (fx!.orderDate) expect(db[0].order_date).toBe(fx!.orderDate);
          if (fx!.customer) expect(db[0].customer?.toLowerCase()).toBe(fx!.customer.toLowerCase());
          const lines = await query<{ n: string }>(`SELECT count(*)::text AS n FROM job_lines WHERE job_id = $1`, [row.id]);
          expect(Number(lines[0].n)).toBe(fx!.skuLines?.length ?? 0);
        }

        // [17A] readiness cache non-null for every imported job; colour sane
        const cached = await query<{ colour: string | null }>(
          `SELECT readiness_cache::text AS colour FROM jobs WHERE id = ANY($1)`, [created.map((r) => r.id)],
        );
        expect(cached.length).toBe(exec.imported);
        expect(cached.every((r) => r.colour !== null && ["white", "amber", "green"].includes(r.colour))).toBe(true);
      },
      isBig ? 240_000 : 60_000,
    );
  });
}

describe("[14A] FX-5 readiness cache matches live recompute", () => {
  it("readiness_cache.colour === computeReadiness for every FX-5 job", async () => {
    const state = loadState("fx-05-readiness-matrix");
    const rows = await query<{ id: string; colour: string }>(
      `SELECT j.id, j.readiness_cache::text AS colour FROM jobs j
        WHERE j.job_number = ANY($1) AND j.readiness_cache IS NOT NULL`,
      [state.jobs.map((j) => j.jobNumber ?? "")],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const res = await getJobRoute(
        new Request(`http://localhost/api/jobs/${r.id}`, { headers: { cookie: admin } }),
        { params: Promise.resolve({ id: r.id }) },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { job: { readiness: { colour: string } } };
      expect(body.job.readiness.colour).toBe(r.colour);
    }
  }, 60_000);
});
