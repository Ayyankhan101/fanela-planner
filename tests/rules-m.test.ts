// M1–M3 cost/price gates (phase0/01 §M) — server-side payload stripping + no cost write path.
import { describe, it, expect, beforeAll } from "vitest";
import { GET as jobGet, PATCH as jobPatch } from "@/app/api/jobs/[id]/route";
import { makeUser, login, query, makeRequest, type TestUser } from "./helpers";
import { newCustomer, newJob } from "./fixtures";
import { randomUUID } from "node:crypto";

const ROLES = ["admin", "ops", "office", "director", "dispatch", "packing", "dept"] as const;
const SEE_COSTS = new Set(["admin", "ops", "director"]); // M2: costs.view
const SEE_PRICES = new Set(["admin", "ops", "office", "director"]); // M3: prices.view

const cookies: Record<string, string> = {};
let jobId = "";
let lineId = "";
let jobVersion = 1;
const marker = randomUUID().slice(0, 8);

async function fetchJob(role: string) {
  const res = await jobGet(
    new Request(`http://localhost/api/jobs/${jobId}`, { headers: { cookie: cookies[role] } }),
    { params: Promise.resolve({ id: jobId }) },
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  return (body.job.lines as Record<string, unknown>[])[0];
}

beforeAll(async () => {
  for (const role of ROLES) {
    const u: TestUser = await makeUser({ roles: [role], departments: role === "dept" ? ["print"] : [] });
    cookies[role] = await login(u);
  }
  const admin = cookies.admin;
  const cust = await newCustomer(admin, `M-Co ${marker}`);
  const job = await newJob(admin, cust, { jobNumber: `M-${marker}`, lines: [{ skuText: `M-SKU-${marker}`, qtyOrdered: 5 }] });
  jobId = job.id;
  lineId = job.lines[0].id;
  await query(`UPDATE job_lines SET unit_price = '12.50', buying_cost = '4.20', tax = 'S-20' WHERE id = $1`, [lineId]);
  const v = await query<{ version: number }>(`SELECT version FROM jobs WHERE id = $1`, [jobId]);
  jobVersion = v[0].version;
});

describe("M1 — buying costs entered only by Admin / Operations", () => {
  for (const role of ["admin", "office"] as const) {
    it(`${role} PATCH buying_cost → rejected (strict schema: no cost write path)`, async () => {
      const res = await jobPatch(
        makeRequest(`/api/jobs/${jobId}`, { method: "PATCH", cookie: cookies[role], body: { buying_cost: "9.99", version: jobVersion } }),
        { params: Promise.resolve({ id: jobId }) },
      );
      expect(res.status).toBe(422);
      const rows = await query<{ buying_cost: string }>(`SELECT buying_cost FROM job_lines WHERE id = $1`, [lineId]);
      expect(rows[0].buying_cost).toBe("4.20");
    });
  }
});

describe("M2 — buying_cost only for costs.view (Admin/Ops/Director)", () => {
  for (const role of ROLES) {
    it(`${role} → buying_cost ${SEE_COSTS.has(role) ? "present" : "stripped"}`, async () => {
      const line = await fetchJob(role);
      expect(Object.hasOwn(line, "buying_cost")).toBe(SEE_COSTS.has(role));
    });
  }
});

describe("M3 — unit_price/tax only for prices.view (Admin/Ops/Office/Director)", () => {
  for (const role of ROLES) {
    it(`${role} → unit_price ${SEE_PRICES.has(role) ? "present" : "stripped"}`, async () => {
      const line = await fetchJob(role);
      expect(Object.hasOwn(line, "unit_price")).toBe(SEE_PRICES.has(role));
      expect(Object.hasOwn(line, "tax")).toBe(SEE_PRICES.has(role));
    });
  }
});
