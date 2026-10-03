// [15A] export matrix + M4/E7/E2 parse-based asserts + unknown view + row cap (T9).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { GET as exportRoute } from "@/app/api/exports/[view]/route";
import { EXPORT_VIEWS } from "@/lib/services/export";
import { MSG_EXPORT_ROW_CAP, MSG_EXPORT_UNKNOWN_VIEW } from "@/lib/errors";
import { makeUser, login, query, type TestUser } from "./helpers";
import pg from "pg";
import { newCustomer, newJob } from "./fixtures";
import { randomUUID } from "node:crypto";

const ROLES = ["admin", "ops", "office", "director", "dispatch", "packing", "dept"] as const;
const ALLOW = new Set(["admin", "ops", "office"]); // import.export grant (phase0/04 matrix)

const cookies: Record<string, string> = {};
let adminUser: TestUser;
let jobId = "";
let lineId = "";
const marker = randomUUID().slice(0, 8);

async function get(view: string, cookie: string, qs = "") {
  return exportRoute(
    new Request(`http://localhost/api/exports/${view}${qs}`, { headers: { cookie } }),
    { params: Promise.resolve({ view }) },
  );
}

async function workbook(view: string, cookie: string, qs = ""): Promise<ExcelJS.Workbook> {
  const res = await get(view, cookie, qs);
  expect(res.status).toBe(200);
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  return wb;
}

function allCellText(wb: ExcelJS.Workbook): string {
  const out: string[] = [];
  for (const ws of wb.worksheets) {
    ws.eachRow((row) => {
      row.eachCell((cell) => out.push(String(cell.value ?? "")));
    });
  }
  return out.join("\n");
}

function dataRows(wb: ExcelJS.Workbook): string[][] {
  const ws = wb.worksheets[0];
  const rows: string[][] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    rows.push((row.values as ExcelJS.CellValue[]).slice(1).map((v) => String(v ?? "")));
  });
  return rows;
}

beforeAll(async () => {
  for (const role of ROLES) {
    const u: TestUser = await makeUser({
      roles: [role],
      departments: role === "dept" ? ["print"] : [],
    });
    cookies[role] = await login(u);
    if (role === "admin") adminUser = u;
  }
  const cust = await newCustomer(adminUser.cookie, `Export Co ${marker}`);
  const job = await newJob(adminUser.cookie, cust, {
    jobNumber: `EXP-${marker}`,
    lines: [{ skuText: `EXP-SKU-${marker}`, qtyOrdered: 10 }],
  });
  jobId = job.id;
  lineId = job.lines[0].id;
  // stock-shortage fixture: flag the line short + give it cost/price values
  await query(`UPDATE job_lines SET stock_issue = 'Short', unit_price = '12.50', buying_cost = '4.20' WHERE id = $1`, [lineId]);
  // E7 fixtures: one cost-bearing audit row + one ordinary row
  await query(
    `INSERT INTO operational_audit (id, entity_type, entity_id, job_id, action, before, after)
     VALUES ($1,'job_lines',$2,$3,'order-lines','{"unit_price":"12.50"}','{"unit_price":"12.50"}')`,
    [randomUUID(), lineId, jobId],
  );
  await query(
    `INSERT INTO operational_audit (id, entity_type, entity_id, job_id, action, before, after)
     VALUES ($1,'jobs',$2,$3,'job-header','{"priority":50}','{"priority":60}')`,
    [randomUUID(), jobId, jobId],
  );
});

afterAll(async () => {
  // FORCE RLS: app role has no DELETE on append-only tables → owner (superuser) cleans up
  const owner = new pg.Pool({
    host: process.env.PGHOST ?? "/tmp",
    port: Number(process.env.PGPORT ?? 5432),
    database: "fanela",
    user: process.env.PGUSER ?? process.env.USER ?? "mac",
  });
  await owner.query(`DELETE FROM stock_events WHERE job_id = $1`, [jobId]);
  await owner.query(`DELETE FROM operational_audit WHERE job_id = $1`, [jobId]);
  await owner.query(`DELETE FROM jobs WHERE id = $1`, [jobId]);
  await owner.query(`DELETE FROM customers WHERE name LIKE $1 OR name LIKE 'RCAP-%'`, [`Export Co ${marker}%`]);
  await owner.end();
});

describe("[E1/15A] 9 views × 7 roles allow/deny", () => {
  for (const view of EXPORT_VIEWS) {
    for (const role of ROLES) {
      const expectStatus = ALLOW.has(role) ? 200 : 403;
      it(`${view} × ${role} → ${expectStatus}`, async () => {
        const res = await get(view, cookies[role]);
        expect(res.status).toBe(expectStatus);
        if (expectStatus === 200) {
          expect(res.headers.get("content-type")).toContain("spreadsheetml");
        }
      });
    }
    it(`${view} × anon → 401`, async () => {
      const res = await get(view, "");
      expect(res.status).toBe(401);
    });
  }
});

describe("unknown view [15A]", () => {
  it("admin + unknown view → 404 export_view_unknown", async () => {
    const res = await get("nope", cookies.admin);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe(MSG_EXPORT_UNKNOWN_VIEW);
    expect(body.code).toBe("export_view_unknown");
  });
});

describe("M4 — write-time cost column strip [15A]", () => {
  it("admin stock-shortage workbook HAS both cost tokens (non-vacuous)", async () => {
    const text = allCellText(await workbook("stock-shortage", cookies.admin));
    expect(text).toContain("Buying Cost");
    expect(text).toContain("unit_price");
  });

  it("office stock-shortage workbook strips both cost tokens", async () => {
    const text = allCellText(await workbook("stock-shortage", cookies.office));
    expect(text).not.toContain("Buying Cost");
    expect(text).not.toContain("unit_price");
  });

  it("office: no cost tokens across ALL 9 views", async () => {
    for (const view of EXPORT_VIEWS) {
      const text = allCellText(await workbook(view, cookies.office));
      expect(text, `view ${view}`).not.toContain("Buying Cost");
      expect(text, `view ${view}`).not.toContain("unit_price");
    }
  });
});

describe("E7 — audit export hides order-lines rows for non-cost viewers", () => {
  it("office audit export excludes action=order-lines; admin keeps it", async () => {
    const officeActions = dataRows(await workbook("audit", cookies.office)).map((r) => r[1]);
    expect(officeActions).not.toContain("order-lines");
    expect(officeActions).toContain("job-header");
    const adminActions = dataRows(await workbook("audit", cookies.admin)).map((r) => r[1]);
    expect(adminActions).toContain("order-lines");
  });
});

describe("E2 — report quantities are snapshots, never live-summed", () => {
  it("stock-shortage rows unchanged after a new stock receipt lands", async () => {
    const before = dataRows(await workbook("stock-shortage", cookies.admin));
    expect(before.length).toBeGreaterThan(0);
    await query(
      `INSERT INTO stock_events (id, job_id, job_line_id, type, qty, reason)
       VALUES ($1,$2,$3,'receipt',99,'e2-snapshot')`,
      [randomUUID(), jobId, lineId],
    );
    const after = dataRows(await workbook("stock-shortage", cookies.admin));
    expect(after).toEqual(before);
    await query(`DELETE FROM stock_events WHERE job_id = $1 AND reason = 'e2-snapshot'`, [jobId]);
  });
});

describe("filtered-jobs q filter", () => {
  it("q matches only the target job", async () => {
    const wb = await workbook("filtered-jobs", cookies.admin, `?q=EXP-${marker}`);
    const rows = dataRows(wb);
    expect(rows.length).toBe(1);
    expect(rows[0][0]).toBe(`EXP-${marker}`);
  });
});

describe("row cap [A3/D18]", () => {
  it("100,000-row view → 413 export_row_cap before any buffer build", async () => {
    await query(
      `INSERT INTO customers (name) SELECT 'RCAP-' || g FROM generate_series(1, 100000) g`,
    );
    try {
      const res = await get("customers", cookies.admin);
      expect(res.status).toBe(413);
      const body = await res.json();
      expect(body.error).toBe(MSG_EXPORT_ROW_CAP);
      expect(body.code).toBe("export_row_cap");
    } finally {
      await query(`DELETE FROM customers WHERE name LIKE 'RCAP-%'`);
    }
  }, 120_000);
});
