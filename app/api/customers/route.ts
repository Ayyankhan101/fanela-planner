import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { requirePermission, err } from "@/lib/http";
import { audit } from "@/lib/services/audit";
import { MSG_INVALID_REQUEST, CODE_VALIDATION_ERROR } from "@/lib/errors";

export async function GET(req: Request) {
  const auth = await requirePermission("customers.view", { req });
  if ("error" in auth) return auth.error;
  const customers = await query(
    `SELECT id, name, contact_name, email, phone, default_dispatch_method, default_dispatch_address, account_ref, active
       FROM customers WHERE active = true ORDER BY name`,
  );
  return NextResponse.json({ customers });
}

const createSchema = z.object({
  name: z.string().min(1).max(256),
  contactName: z.string().max(256).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(64).optional(),
  billingAddress: z.string().max(1000).optional(),
  defaultDispatchAddress: z.string().max(1000).optional(),
  defaultDispatchMethod: z.string().max(64).optional(),
  accountRef: z.string().max(64).optional(),
  notes: z.string().max(4000).optional(),
});

export async function POST(req: Request) {
  const auth = await requirePermission("customers.edit", { req });
  if ("error" in auth) return auth.error;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(422, MSG_INVALID_REQUEST, CODE_VALIDATION_ERROR);
  const rows = await query<{ id: string }>(
    `INSERT INTO customers (name, contact_name, email, phone, billing_address, default_dispatch_address,
                            default_dispatch_method, account_ref, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [
      parsed.data.name.trim(), parsed.data.contactName ?? null, parsed.data.email || null,
      parsed.data.phone ?? null, parsed.data.billingAddress ?? null,
      parsed.data.defaultDispatchAddress ?? null, parsed.data.defaultDispatchMethod ?? null,
      parsed.data.accountRef ?? null, parsed.data.notes ?? null,
    ],
  );
  await audit({ entityType: "customer", entityId: rows[0].id, action: "customer-master", user: auth.user, after: parsed.data });
  return NextResponse.json({ id: rows[0].id }, { status: 201 });
}
