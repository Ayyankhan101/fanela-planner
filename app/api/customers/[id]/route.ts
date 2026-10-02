import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { requirePermission, err, toResponse } from "@/lib/http";
import { audit } from "@/lib/services/audit";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    confirm: z.literal(true),
    name: z.string().min(1).max(256).optional(),
    contactName: z.string().max(256).nullable().optional(),
    email: z.string().email().nullable().or(z.literal("")).optional(),
    phone: z.string().max(64).nullable().optional(),
    billingAddress: z.string().max(1000).nullable().optional(),
    defaultDispatchAddress: z.string().max(1000).nullable().optional(),
    defaultDispatchMethod: z.string().max(64).nullable().optional(),
    accountRef: z.string().max(64).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
  })
  .strict();

const FIELDS = {
  name: "name",
  contactName: "contact_name",
  email: "email",
  phone: "phone",
  billingAddress: "billing_address",
  defaultDispatchAddress: "default_dispatch_address",
  defaultDispatchMethod: "default_dispatch_method",
  accountRef: "account_ref",
  notes: "notes",
} as const;

// C4: deliberate, confirmed, audited master update — never a side effect of job editing.
export async function PATCH(req: Request, { params }: Params) {
  const auth = await requirePermission("customers.update_master", { req });
  if ("error" in auth) return auth.error;
  const { id } = await params;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(422, parsed.error.issues[0]?.message ?? "Invalid update.");
  const { confirm, ...input } = parsed.data;
  if (!confirm) return err(422, "Confirmation required.");
  if (!Object.keys(input).length) return err(422, "Nothing to update.");

  try {
    const before = await query<Record<string, unknown>>(`SELECT * FROM customers WHERE id = $1`, [id]);
    if (!before[0]) return err(404, "Customer not found.");

    const sets: string[] = [];
    const vals: unknown[] = [id];
    for (const [key, col] of Object.entries(FIELDS)) {
      if (key in input) {
        let v = (input as Record<string, unknown>)[key];
        if (key === "email" && v === "") v = null;
        vals.push(v);
        sets.push(`${col} = $${vals.length}`);
      }
    }
    await query(`UPDATE customers SET ${sets.join(", ")} WHERE id = $1`, vals);

    await audit({
      entityType: "customer",
      entityId: id,
      action: "customer-master",
      user: auth.user,
      before: before[0],
      after: input,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
}
