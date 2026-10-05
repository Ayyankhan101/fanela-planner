import { query } from "@/lib/db";

export const CUSTOMERS_PAGE_SIZE = 50;

// Paged read for the customers list (qa ISSUE-001): bounded page + total,
// name-ordered, active-only — same rows the full query used to return.
export async function listCustomersPage(
  page: number,
  size: number = CUSTOMERS_PAGE_SIZE,
): Promise<{ customers: Record<string, unknown>[]; total: number; page: number; pages: number }> {
  const safeSize = Math.min(Math.max(Math.trunc(size) || 1, 1), 100);
  const rows = await query<{ n: number }>(`SELECT count(*)::int AS n FROM customers WHERE active = true`);
  const total = Number(rows[0].n);
  const pages = Math.max(1, Math.ceil(total / safeSize));
  const safePage = Math.min(Math.max(Math.trunc(page) || 1, 1), pages);
  const customers = await query<Record<string, unknown>>(
    `SELECT id, name, contact_name, email, phone, default_dispatch_method, account_ref
       FROM customers WHERE active = true ORDER BY name
      LIMIT $1 OFFSET $2`,
    [safeSize, (safePage - 1) * safeSize],
  );
  return { customers, total, page: safePage, pages };
}
