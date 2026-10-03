import { randomUUID } from "node:crypto";
import { query, withTransaction } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { audit } from "./audit";
import { refreshJobStatus } from "./stages";

// Dispatch & shipments (P1–P9): explicit lifecycle, void-not-delete, explicit finalise (P5).

export const DISPATCH_METHODS = ["Collection", "DPD", "Same Day", "Fanela Van"] as const;

const SHIPMENT_FLOW: Record<string, string[]> = {
  draft: ["booking_arranged", "void"],
  booking_arranged: ["booked", "void"],
  booked: ["labels_attached", "void"],
  labels_attached: ["print_requested", "void"],
  print_requested: ["labels_printed", "void"],
  labels_printed: ["dispatched", "collected", "void"],
  dispatched: [],
  collected: [],
  void: [],
};
const FINAL_STATES = ["dispatched", "collected"];

async function shipmentEvent(shipmentId: string, action: string, user: SessionUser, reason: string | null): Promise<void> {
  await query(`INSERT INTO shipment_events (shipment_id, action, actor, reason) VALUES ($1,$2,$3,$4)`, [
    shipmentId,
    action,
    user.id,
    reason,
  ]);
}

export async function createShipment(
  jobId: string,
  input: { method: string; parcels?: number; consignment?: string; tracking?: string },
  user: SessionUser,
): Promise<{ id: string; version: number }> {
  if (!DISPATCH_METHODS.includes(input.method as never)) {
    throw { status: 422, message: `Unknown dispatch method: ${input.method}.` };
  }
  const job = await query(`SELECT id FROM jobs WHERE id = $1`, [jobId]);
  if (!job[0]) throw { status: 404, message: "Job not found." };
  const id = randomUUID();
  const ins = await query<{ id: string; version: number }>(
    `INSERT INTO shipments (id, job_id, method, status, parcels, consignment, tracking, created_by)
     VALUES ($1,$2,$3,'draft',$4,$5,$6,$7)
     RETURNING id, version`,
    [id, jobId, input.method, input.parcels ?? null, input.consignment ?? null, input.tracking ?? null, user.id],
  );
  await shipmentEvent(id, "create", user, null);
  await audit({ entityType: "shipment", entityId: id, jobId, action: "dispatch", user, after: { method: input.method, status: "draft" } });
  return { id: ins[0].id, version: Number(ins[0].version) };
}

export type ShipmentPatchInput = {
  version: number;
  status?: string;
  method?: string;
  parcels?: number;
  consignment?: string;
  tracking?: string;
  confirmCollection?: boolean; // P2: Collection requires confirmation before final
  reason?: string; // void reason (P7)
};

// [7A] atomic site — shipment transition + event + audit + job lifecycle update in one tx.
export function patchShipment(shipmentId: string, input: ShipmentPatchInput, user: SessionUser): Promise<number> {
  return withTransaction(() => patchShipmentTx(shipmentId, input, user));
}

async function patchShipmentTx(shipmentId: string, input: ShipmentPatchInput, user: SessionUser): Promise<number> {
  const lock = await query<{
    id: string;
    job_id: string;
    status: string;
    method: string;
    version: number;
    voided: boolean;
  }>(`SELECT id, job_id, status, method, version, voided FROM shipments WHERE id = $1 FOR UPDATE`, [shipmentId]);
  const cur = lock[0];
  if (!cur) throw { status: 404, message: "Shipment not found." };
  if (Number(cur.version) !== input.version) {
    const fresh = await query<Record<string, unknown>>(`SELECT * FROM shipments WHERE id = $1`, [shipmentId]);
    throw { status: 409, message: "Shipment changed since you loaded it. Reload and retry.", current: fresh[0] };
  }
  if (cur.voided || cur.status === "void") {
    throw { status: 422, message: "Void shipments are fixed. Create a new shipment." };
  }

  const p: unknown[] = [shipmentId, input.version];
  const set = (col: string, v: unknown) => {
    p.push(v);
    return `${col} = $${p.length}`;
  };
  const sets: string[] = [];
  if (input.method !== undefined) {
    if (!DISPATCH_METHODS.includes(input.method as never)) throw { status: 422, message: `Unknown dispatch method: ${input.method}.` };
    sets.push(set("method", input.method));
  }
  if (input.parcels !== undefined) sets.push(set("parcels", input.parcels));
  if (input.consignment !== undefined) sets.push(set("consignment", input.consignment));
  if (input.tracking !== undefined) sets.push(set("tracking", input.tracking));

  let transitioned: string | null = null;
  if (input.status != null && input.status !== cur.status) {
    const target = input.status;
    if (target === "void") {
      // P7: void = event with reason; row never deleted
      if (!input.reason?.trim()) throw { status: 422, message: "Voiding a shipment requires a reason." };
      sets.push(set("status", "void"));
      sets.push(set("voided", true));
      sets.push(set("void_reason", input.reason));
      transitioned = "void";
    } else {
      if (!SHIPMENT_FLOW[cur.status]?.includes(target)) {
        throw { status: 422, message: `Invalid shipment transition: ${cur.status} → ${target}.` };
      }
      if (FINAL_STATES.includes(target)) {
        const method = input.method ?? cur.method;
        if (method === "Collection" && !input.confirmCollection) {
          throw { status: 422, message: "Collection requires confirmation before final dispatch." };
        }
        sets.push(set("final_at", new Date().toISOString()));
        sets.push(set("finalized_by", user.id));
      }
      if (target === "booked") {
        sets.push(set("booked_by", user.id));
        sets.push(set("booked_at", new Date().toISOString()));
      }
      if (target === "labels_printed") {
        // P9: only manual confirm reaches printed — never claimed automatically
        sets.push(set("label_printed", true));
      }
      sets.push(set("status", target));
      transitioned = target;
    }
  }
  if (!sets.length) return Number(cur.version);
  sets.push("version = version + 1");

  const before = await query(`SELECT * FROM shipments WHERE id = $1`, [shipmentId]);
  const res = await query<{ version: number }>(
    `UPDATE shipments SET ${sets.join(", ")} WHERE id = $1 AND version = $2 RETURNING version`,
    p,
  );
  if (!res.length) {
    const fresh = await query<Record<string, unknown>>(`SELECT * FROM shipments WHERE id = $1`, [shipmentId]);
    throw { status: 409, message: "Shipment changed since you loaded it. Reload and retry.", current: fresh[0] };
  }
  const after = await query(`SELECT * FROM shipments WHERE id = $1`, [shipmentId]);

  if (transitioned) await shipmentEvent(shipmentId, transitioned, user, input.reason ?? null);
  await audit({ entityType: "shipment", entityId: shipmentId, jobId: cur.job_id, action: "dispatch", user, before: before[0], after: after[0] });

  // job lifecycle: first dispatched/collected → part_dispatched
  if (transitioned && FINAL_STATES.includes(transitioned)) {
    await query(
      `UPDATE jobs SET status = 'part_dispatched', updated_at = now()
        WHERE id = $1 AND status IN ('open', 'in_production')`,
      [cur.job_id],
    );
  }
  return Number(res[0].version);
}

// P5: dispatch stage closes only via explicit finalise; D10/P4: all other stages first
export async function finaliseDispatch(
  jobId: string,
  input: { abandon?: boolean; reason?: string },
  user: SessionUser,
): Promise<void> {
  const job = await query<{ status: string }>(`SELECT status FROM jobs WHERE id = $1 FOR UPDATE`, [jobId]);
  if (!job[0]) throw { status: 404, message: "Job not found." };

  const stage = await query<{ id: string; status: string; version: number }>(
    `SELECT s.id, s.status, s.version FROM job_stages s JOIN departments d ON d.id = s.department_id
      WHERE s.job_id = $1 AND d.key = 'dispatch'`,
    [jobId],
  );
  const dispatchStage = stage[0];
  if (!dispatchStage) throw { status: 422, message: "Job has no dispatch stage." };
  if (dispatchStage.status === "completed") {
    throw { status: 422, message: "Dispatch stage already finalised." };
  }

  const notDone = await query<{ keys: string }>(
    `SELECT string_agg(d.key, ',') AS keys FROM job_stages s JOIN departments d ON d.id = s.department_id
      WHERE s.job_id = $1 AND d.key <> 'dispatch' AND s.status <> 'completed'`,
    [jobId],
  );
  if (notDone[0]?.keys) {
    throw { status: 422, message: `Other departments unfinished: ${notDone[0].keys}.` };
  }

  const shipments = await query<{ id: string; status: string; voided: boolean }>(
    `SELECT id, status, voided FROM shipments WHERE job_id = $1`,
    [jobId],
  );
  const pending = shipments.filter((s) => !s.voided && s.status !== "void" && !FINAL_STATES.includes(s.status));
  if (pending.length) {
    if (!input.abandon) {
      throw {
        status: 422,
        message: "Every shipment must be final (Dispatched/Collected) or Void before finalising. Abandon with reason to void remaining bookings.",
      };
    }
    if (!input.reason?.trim()) throw { status: 422, message: "Abandon requires a reason." };
    for (const s of pending) {
      await query(`UPDATE shipments SET status = 'void', voided = true, void_reason = $1, version = version + 1 WHERE id = $2`, [
        `Abandoned at finalise: ${input.reason}`,
        s.id,
      ]);
      await shipmentEvent(s.id, "void", user, `Abandoned at finalise: ${input.reason}`);
    }
  }
  if (!shipments.filter((s) => !s.voided).length && shipments.length > 0) {
    // all void — allowed (nothing to ship), but must be deliberate: same abandon reason path
    if (!input.abandon) {
      throw { status: 422, message: "No final shipment recorded. Confirm abandon to close with zero live bookings." };
    }
  }

  const now = new Date().toISOString();
  const res = await query<{ n: string }>(
    `UPDATE job_stages SET status = 'completed', progress = qty, remaining = 0, finished_at = $1, completed_by = $2,
                            version = version + 1
      WHERE id = $3 AND status <> 'completed' RETURNING 'x' AS n`,
    [now, user.id, dispatchStage.id],
  );
  if (!res.length) throw { status: 409, message: "Dispatch stage changed since you loaded it. Reload and retry." };

  await audit({
    entityType: "stage",
    entityId: dispatchStage.id,
    jobId,
    action: "dispatch",
    user,
    before: { status: "open", finalised: false },
    after: { status: "completed", finalised: true, abandoned: Boolean(input.abandon), reason: input.reason ?? null },
  });
  await refreshJobStatus(jobId); // J9: all stages completed → job completed
}
