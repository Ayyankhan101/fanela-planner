// Integration tests against local Postgres: RLS immutability + append-only logs.
// App connection = fanela_app (the non-owner role the server will use).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import "dotenv/config";

const APP_URL =
  process.env.APP_DATABASE_URL ??
  "postgres://fanela_app:fanela_app_dev@localhost:5432/fanela";

// superuser pool (unix socket, peer auth) — FORCE RLS exempts superuser, so
// fixtures/cleanup can see and remove rows the app role cannot.
let owner: pg.Pool;
let app: pg.Pool;
let jobId: string;
let attemptId: string;
let stockEventId: string;

beforeAll(async () => {
  owner = new pg.Pool({
    host: process.env.PGHOST ?? "/tmp",
    port: Number(process.env.PGPORT ?? 5432),
    database: "fanela",
    user: process.env.PGUSER ?? "mac",
  });
  app = new pg.Pool({ connectionString: APP_URL });
  // probe connectivity — skip suite if app role missing
  await app.query("SELECT 1");

  // clear leftovers from aborted runs
  await owner.query(`DELETE FROM swatch_attempts WHERE job_id IN (SELECT id FROM jobs WHERE job_number LIKE 'RLS-TEST-%')`);
  await owner.query(`DELETE FROM stock_events WHERE job_id IN (SELECT id FROM jobs WHERE job_number LIKE 'RLS-TEST-%')`);
  await owner.query(`DELETE FROM job_lines WHERE job_id IN (SELECT id FROM jobs WHERE job_number LIKE 'RLS-TEST-%')`);
  await owner.query(`DELETE FROM jobs WHERE job_number LIKE 'RLS-TEST-%'`);
  await owner.query(`DELETE FROM customers WHERE name = 'RLS Test Co'`);

  const cust = await owner.query(`INSERT INTO customers (name) VALUES ('RLS Test Co') RETURNING id`);
  const c = cust.rows[0].id;
  const j = await owner.query(
    `INSERT INTO jobs (job_number, customer_id) VALUES ('RLS-TEST-' || $1, $2) RETURNING id`,
    [Date.now(), c],
  );
  jobId = j.rows[0].id;
  const a = await owner.query(
    `INSERT INTO swatch_attempts (job_id, attempt_no, status) VALUES ($1, 1, 'draft') RETURNING id`,
    [jobId],
  );
  attemptId = a.rows[0].id;
  const line = await owner.query(
    `INSERT INTO job_lines (job_id, sku_text, qty_ordered) VALUES ($1, 'RLS-SKU', 10) RETURNING id`,
    [jobId],
  );
  const s = await owner.query(
    `INSERT INTO stock_events (job_id, job_line_id, type, qty) VALUES ($1, $2, 'receipt', 5) RETURNING id`,
    [jobId, line.rows[0].id],
  );
  stockEventId = s.rows[0].id;
}, 20_000);

afterAll(async () => {
  // owner is superuser → bypasses RLS for cleanup
  await owner.query(`DELETE FROM swatch_attempt_events WHERE attempt_id IN (SELECT id FROM swatch_attempts WHERE job_id = $1)`, [jobId]);
  await owner.query(`DELETE FROM swatch_attempts WHERE job_id = $1`, [jobId]);
  await owner.query(`DELETE FROM stock_events WHERE job_id = $1`, [jobId]);
  await owner.query(`DELETE FROM job_line_sizes WHERE job_line_id IN (SELECT id FROM job_lines WHERE job_id = $1)`, [jobId]);
  await owner.query(`DELETE FROM job_lines WHERE job_id = $1`, [jobId]);
  await owner.query(`DELETE FROM operational_audit WHERE job_id = $1`, [jobId]);
  await owner.query(`DELETE FROM jobs WHERE id = $1`, [jobId]);
  await owner.query(`DELETE FROM customers WHERE name = 'RLS Test Co'`);
  await owner.end();
  await app.end();
});

describe("swatch immutability (RLS FORCE, spec §9)", () => {
  it("app role updates a non-approved attempt", async () => {
    const res = await app.query(`UPDATE swatch_attempts SET status = 'in_progress' WHERE id = $1`, [attemptId]);
    expect(res.rowCount).toBe(1);
  });

  it("app role cannot see an approved row for UPDATE (0 rows touched)", async () => {
    await owner.query(`UPDATE swatch_attempts SET status = 'approved' WHERE id = $1`, [attemptId]);
    const res = await app.query(`UPDATE swatch_attempts SET status = 'rejected' WHERE id = $1`, [attemptId]);
    expect(res.rowCount).toBe(0);
  });

  it("approved row still approved", async () => {
    const res = await owner.query(`SELECT status FROM swatch_attempts WHERE id = $1`, [attemptId]);
    expect(res.rows[0].status).toBe("approved");
  });

  it("app role cannot DELETE attempts (no grant)", async () => {
    await expect(app.query(`DELETE FROM swatch_attempts WHERE id = $1`, [attemptId])).rejects.toThrow(/permission denied/);
  });
});

describe("append-only stock log (grant + RLS)", () => {
  it("app role can INSERT", async () => {
    const res = await app.query(
      `INSERT INTO stock_events (job_id, type, qty, reason) VALUES ($1, 'correction', -1, 'test')`,
      [jobId],
    );
    expect(res.rowCount).toBe(1);
  });

  it("app role cannot UPDATE", async () => {
    await expect(
      app.query(`UPDATE stock_events SET qty = 99 WHERE id = $1`, [stockEventId]),
    ).rejects.toThrow(/permission denied/);
  });

  it("app role cannot DELETE", async () => {
    await expect(app.query(`DELETE FROM stock_events WHERE id = $1`, [stockEventId])).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("append-only audit log", () => {
  it("INSERT ok, UPDATE/DELETE denied", async () => {
    const ins = await app.query(
      `INSERT INTO operational_audit (entity_type, action) VALUES ('job', 'job-header') RETURNING id`,
    );
    expect(ins.rowCount).toBe(1);
    const id = ins.rows[0].id;
    await expect(app.query(`UPDATE operational_audit SET action = 'x' WHERE id = $1`, [id])).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.query(`DELETE FROM operational_audit WHERE id = $1`, [id])).rejects.toThrow(
      /permission denied/,
    );
  });
});
