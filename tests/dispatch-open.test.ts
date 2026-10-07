// P6 + spec §198: first shipment dispatched while job status = 'open' → part_dispatched
// (no stage worked — locks the dispatch.ts WHERE status IN ('open','in_production') 'open' branch)
import { describe, it, expect, beforeAll } from "vitest";
import { makeUser, makeRequest, randomUUID } from "./helpers";
import { newCustomer, newJob, getJob } from "./fixtures";
import { POST as createShipment } from "@/app/api/jobs/[id]/shipments/route";
import { PATCH as patchShipment } from "@/app/api/shipments/[id]/route";

let adminCookie: string;
let customerId: string;
const suffix = randomUUID().slice(0, 8);

async function shipment(jobId: string, cookie: string, body: Record<string, unknown> = { method: "DPD", parcels: 1 }) {
  const res = await createShipment(
    makeRequest(`/api/jobs/${jobId}/shipments`, { method: "POST", cookie, body }),
    { params: Promise.resolve({ id: jobId }) },
  );
  return { status: res.status, json: async () => res.json() };
}

async function move(id: string, cookie: string, body: Record<string, unknown>) {
  const res = await patchShipment(
    makeRequest(`/api/shipments/${id}`, { method: "PATCH", cookie, body }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, json: async () => res.json() };
}

beforeAll(async () => {
  const u = await makeUser({ roles: ["admin"] });
  adminCookie = u.cookie;
  customerId = await newCustomer(adminCookie, `Open Dispatch Co ${suffix}`);
});

describe("P6 — dispatch from open (spec §198)", () => {
  it("first dispatched shipment flips open → part_dispatched without entering in_production", async () => {
    const job = await newJob(adminCookie, customerId);
    const before = await getJob(adminCookie, job.id);
    expect(before.status).toBe("open");

    const s = await shipment(job.id, adminCookie);
    expect(s.status).toBe(201);
    const { id, version } = (await s.json()) as { id: string; version: number };
    expect((await getJob(adminCookie, job.id)).status).toBe("open"); // shipment draft alone changes nothing

    let v = version;
    for (const status of ["booking_arranged", "booked", "labels_attached", "print_requested", "labels_printed", "dispatched"] as const) {
      const r = await move(id, adminCookie, { status, version: v });
      expect(r.status, status).toBe(200);
      v = ((await r.json()) as { version: number }).version;
    }

    const fresh = await getJob(adminCookie, job.id);
    expect(fresh.status).toBe("part_dispatched");
  });
});
