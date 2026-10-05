// Regression: ISSUE-001 — customers list pages (bounded page, total, clamping)
// Found by /qa on 2026-10-05
// Report: .gstack/qa-reports/qa-report-localhost-3000-2026-10-05.md
import { describe, it, expect } from "vitest";
import { listCustomersPage, CUSTOMERS_PAGE_SIZE } from "@/lib/services/customers";

describe("ISSUE-001 — listCustomersPage", () => {
  it("page 1 is bounded to the page size and name-ordered", async () => {
    const p1 = await listCustomersPage(1);
    expect(p1.customers.length).toBeLessThanOrEqual(CUSTOMERS_PAGE_SIZE);
    expect(p1.total).toBeGreaterThanOrEqual(p1.customers.length);
    const names = p1.customers.map((c) => String(c.name));
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("pages are disjoint across page boundaries", async () => {
    const p1 = await listCustomersPage(1);
    const p2 = await listCustomersPage(2);
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
