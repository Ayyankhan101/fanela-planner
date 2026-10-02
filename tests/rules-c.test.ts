// Rules C1–C4: customer master & order snapshots (phase0/01)
import { describe, it, expect, beforeAll } from "vitest";
import { makeUser, makeRequest, login, query, randomUUID, type TestUser } from "./helpers";
import { POST as createCustomer } from "@/app/api/customers/route";
import { PATCH as patchCustomer } from "@/app/api/customers/[id]/route";
import { POST as createJob, GET as getJobs } from "@/app/api/jobs/route";
import { GET as getJob, PATCH as patchJob } from "@/app/api/jobs/[id]/route";
let admin: TestUser;
let office: TestUser;
let adminCookie: string;
let officeCookie: string;

const suffix = randomUUID().slice(0, 8);

async function createCustomerRow(name: string): Promise<string> {
  const res = await createCustomer(
    makeRequest("/api/customers", {
      method: "POST",
      cookie: adminCookie,
      body: { name, contactName: "Original Contact", email: "orig@x.test", phone: "111", defaultDispatchMethod: "DPD" },
    }),
  );
  expect(res.status).toBe(201);
  const { id } = await res.json();
  return id as string;
}

beforeAll(async () => {
  admin = await makeUser({ roles: ["admin"] });
  office = await makeUser({ roles: ["office"] });
  adminCookie = await login(admin);
  officeCookie = await login(office);
});

describe("C1 — customer master holds full field set", () => {
  it("stores all 9 C1 fields", async () => {
    const res = await createCustomer(
      makeRequest("/api/customers", {
        method: "POST",
        cookie: adminCookie,
        body: {
          name: `C1 Co ${suffix}`,
          contactName: "Pat",
          email: "pat@x.test",
          phone: "07000",
          billingAddress: "1 Bill St",
          defaultDispatchAddress: "2 Ship St",
          defaultDispatchMethod: "DPD",
          accountRef: "AC-9",
          notes: "C1 note",
        },
      }),
    );
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const rows = await query<Record<string, unknown>>(`SELECT * FROM customers WHERE id = $1`, [id]);
    const c = rows[0];
    expect(c.name).toBe(`C1 Co ${suffix}`);
    expect(c.contact_name).toBe("Pat");
    expect(c.email).toBe("pat@x.test");
    expect(c.phone).toBe("07000");
    expect(c.billing_address).toBe("1 Bill St");
    expect(c.default_dispatch_address).toBe("2 Ship St");
    expect(c.default_dispatch_method).toBe("DPD");
    expect(c.account_ref).toBe("AC-9");
    expect(c.notes).toBe("C1 note");
  });
});

describe("C2/C3 — frozen snapshot, never live-linked", () => {
  it("editing master does not change job snapshot fields", async () => {
    const custId = await createCustomerRow(`C2 Co ${suffix}`);
    const create = await createJob(
      makeRequest("/api/jobs", {
        method: "POST",
        cookie: adminCookie,
        body: { jobNumber: `C2-${suffix}`, customerId: custId, lines: [{ skuText: "SKU-1", qtyOrdered: 1 }] },
      }),
    );
    expect(create.status).toBe(201);
    const { id: jobId } = await create.json();

    // deliberate master update
    const patch = await patchCustomer(
      makeRequest(`/api/customers/${custId}`, {
        method: "PATCH",
        cookie: adminCookie,
        body: { confirm: true, contactName: "Changed", email: "new@x.test", phone: "999", defaultDispatchMethod: "Parcelforce" },
      }),
      { params: Promise.resolve({ id: custId }) },
    );
    expect(patch.status).toBe(200);

    // C2: job keeps snapshot of what was copied at entry
    const jobRes = await getJob(makeRequest(`/api/jobs/${jobId}`, { cookie: adminCookie }), {
      params: Promise.resolve({ id: jobId }),
    });
    expect(jobRes.status).toBe(200);
    const { job } = await jobRes.json();
    expect(job.contact_name).toBe("Original Contact");
    expect(job.contact_email).toBe("orig@x.test");
    expect(job.contact_phone).toBe("111");
    expect(job.dispatch_method).toBe("DPD");

    // C3: master row itself did change — job just never follows it
    const master = await query<{ contact_name: string }>(
      `SELECT contact_name FROM customers WHERE id = $1`,
      [custId],
    );
    expect(master[0].contact_name).toBe("Changed");
  });
});

describe("C4 — deliberate audited master update", () => {
  let custId: string;

  beforeAll(async () => {
    custId = await createCustomerRow(`C4 Co ${suffix}`);
  });

  it("denies office (customers.update_master missing)", async () => {
    const res = await patchCustomer(
      makeRequest(`/api/customers/${custId}`, {
        method: "PATCH",
        cookie: officeCookie,
        body: { confirm: true, contactName: "Nope" },
      }),
      { params: Promise.resolve({ id: custId }) },
    );
    expect(res.status).toBe(403);
  });

  it("rejects unconfirmed update", async () => {
    const res = await patchCustomer(
      makeRequest(`/api/customers/${custId}`, {
        method: "PATCH",
        cookie: adminCookie,
        body: { contactName: "NoConfirm" },
      }),
      { params: Promise.resolve({ id: custId }) },
    );
    expect(res.status).toBe(422);
  });

  it("admin update succeeds and writes customer-master audit with before/after", async () => {
    const res = await patchCustomer(
      makeRequest(`/api/customers/${custId}`, {
        method: "PATCH",
        cookie: adminCookie,
        body: { confirm: true, contactName: "Audited", notes: "changed" },
      }),
      { params: Promise.resolve({ id: custId }) },
    );
    expect(res.status).toBe(200);
    const rows = await query<{ before: unknown; after: unknown; actor_id: string }>(
      `SELECT before, after, actor_id FROM operational_audit
        WHERE entity_type = 'customer' AND entity_id = $1 AND action = 'customer-master'
        ORDER BY ts DESC LIMIT 1`,
      [custId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_id).toBe(admin.id);
    expect(String(JSON.stringify(rows[0].after))).toContain("Audited");
    expect(String(JSON.stringify(rows[0].before))).toContain("Original Contact");
  });

  it("job editing never touches customer master (no side effect)", async () => {
    const before = await query<Record<string, unknown>>(`SELECT * FROM customers WHERE id = $1`, [custId]);
    const jobs = await getJobs(makeRequest("/api/jobs", { cookie: adminCookie }));
    const { jobs: list } = await jobs.json();
    const someJob = list[0];
    const version = await query<{ version: number }>(`SELECT version FROM jobs WHERE id = $1`, [someJob.id]);
    const res = await patchJob(
      makeRequest(`/api/jobs/${someJob.id}`, {
        method: "PATCH",
        cookie: adminCookie,
        body: { version: Number(version[0].version), notes: "header edit" },
      }),
      { params: Promise.resolve({ id: someJob.id }) },
    );
    expect(res.status).toBe(200);
    const after = await query<Record<string, unknown>>(`SELECT * FROM customers WHERE id = $1`, [custId]);
    expect(after[0]).toEqual(before[0]);
  });
});
