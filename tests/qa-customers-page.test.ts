// Regression: ISSUE-001 — customers list pages (bounded page, total, clamping)
// Found by /qa on 2026-10-05
// Report: .gstack/qa-reports/qa-report-localhost-3000-2026-10-05.md
//
// CI-robust: seeds its own sentinel rows (CI seed has < 50 customers) and
// reads both pages inside one REPEATABLE READ snapshot (parallel test workers
// insert customers between fetches, which breaks offset disjointness).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { query, withTransaction } from "@/lib/db";
import { listCustomersPage, CUSTOMERS_PAGE_SIZE } from "@/lib/services/customers";

const SENTINELS = 60;
const PREFIX = "QA-PAGE-";

describe("ISSUE-001 — listCustomersPage", () => {
  beforeAll(async () => {
    await query(`DELETE FROM customers WHERE name LIKE $1`, [`${PREFIX}%`]);
    await query(
      `INSERT INTO customers (name, active)
       SELECT $1 || lpad(g::text, 3, '0'), true FROM generate_series(0, $2) g`,
      [PREFIX, SENTINELS - 1],
    );
  });

  afterAll(async () => {
    await query(`DELETE FROM customers WHERE name LIKE $1`, [`${PREFIX}%`]);
  });

  it("page 1 is bounded to the page size", async () => {
    const p1 = await listCustomersPage(1);
    expect(p1.total).toBeGreaterThanOrEqual(SENTINELS);
    expect(p1.customers.length).toBe(CUSTOMERS_PAGE_SIZE);
    const p2 = await listCustomersPage(2);
    expect(p2.customers.length).toBeLessThanOrEqual(CUSTOMERS_PAGE_SIZE);
  });

  it("pages are disjoint across page boundaries", async () => {
    const [p1, p2] = await withTransaction(async () => {
      await query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const a = await listCustomersPage(1);
      const b = await listCustomersPage(2);
      return [a, b] as const;
    });
    expect(p2.customers.length).toBeGreaterThan(0);
    const ids1 = new Set(p1.customers.map((c) => String(c.id)));
    const overlap = p2.customers.filter((c) => ids1.has(String(c.id)));
    expect(overlap).toHaveLength(0);
  });

  it("out-of-range and invalid pages clamp instead of erroring", async () => {
    const high = await listCustomersPage(99999);
    expect(high.page).toBe(high.pages);
    expect(high.customers.length).toBeGreaterThan(0);
    const zero = await listCustomersPage(0);
    expect(zero.page).toBe(1);
    const junk = await listCustomersPage(Number("junk") || 1);
    expect(junk.page).toBe(1);
  });
});
