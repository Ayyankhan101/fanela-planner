// In-app notifications (P5): emit targeting (role fan-out + actor exclusion),
// in-tx emission (stale-version 409 → no rows), route ownership classes,
// mark-read idempotency + no cross-user leak.
/* eslint-disable @typescript-eslint/no-explicit-any -- test glue: loosely-typed API response bodies */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeUser, makeRequest, query, randomUUID, type TestUser } from "./helpers";
import { newCustomer, newJob } from "./fixtures";
import { POST as createAttempt } from "@/app/api/jobs/[id]/swatch/attempts/route";
import { PATCH as patchAttempt } from "@/app/api/jobs/[id]/swatch/attempts/[attemptId]/route";
import { GET as getArtworkRoute, PATCH as patchArtworkRoute } from "@/app/api/jobs/[id]/artwork/route";
import { POST as uploadRoute } from "@/app/api/admin/import/route";
import * as importIdRoute from "@/app/api/admin/import/[id]/route";
import { GET as notificationsGet } from "@/app/api/notifications/route";
import { POST as notificationsRead } from "@/app/api/notifications/read/route";
import { emitNotification } from "@/lib/services/notifications";

let admin: TestUser;
let ops1: TestUser;
let ops2: TestUser;
let office: TestUser;
let customerId: string;
const myJobIds: string[] = [];
const myBatchIds: string[] = [];

async function swatchToAwaiting(cookie: string, jobId: string): Promise<{ status: number; body: any }> {
  const create = await createAttempt(
    makeRequest(`/api/jobs/${jobId}/swatch/attempts`, { method: "POST", cookie, body: { sampleQty: 1 } }),
    { params: Promise.resolve({ id: jobId }) },
  );
    if (create.status !== 201) return { status: create.status, body: await create.json().catch(() => null) };
    const created = (await create.json()) as { id: string; version: number };
    const { id } = created;
    let { version } = created;
  for (const status of ["in_progress", "awaiting"] as const) {
    const res = await patchAttempt(
      makeRequest(`/api/jobs/${jobId}/swatch/attempts/${id}`, {
        method: "PATCH",
        cookie,
        body: { status, version },
      }),
      { params: Promise.resolve({ id: jobId, attemptId: id }) },
    );
    if (res.status !== 200) return { status: res.status, body: await res.json().catch(() => null) };
    version = ((await res.json()) as { version: number }).version;
  }
  return { status: 200, body: { id } };
}

async function recipients(kind: string, jobId: string): Promise<string[]> {
  const rows = await query<{ recipient_id: string }>(
    `SELECT recipient_id FROM notifications WHERE kind = $1 AND job_id = $2`,
    [kind, jobId],
  );
  return rows.map((r) => r.recipient_id);
}

beforeAll(async () => {
  process.env.NOTIFICATIONS_TEST_HOOK = "1"; // opt in — emitNotification is gated under vitest
  admin = await makeUser({ roles: ["admin"], totp: false });
  ops1 = await makeUser({ roles: ["ops"], totp: false });
  ops2 = await makeUser({ roles: ["ops"], totp: false });
  office = await makeUser({ roles: ["office"], totp: false });
  customerId = await newCustomer(admin.cookie);
});

afterAll(async () => {
  // scoped cleanup: emits fan out to every active holder of the role (incl. the
  // seeded admin@fanela.local) — remove by the contexts these tests created.
  await query(`DELETE FROM notifications
                WHERE job_id = ANY($1::uuid[]) OR title IN ('NfySeed', 'NfySeed2', 'NfySeed3')`, [myJobIds]);
  for (const b of myBatchIds) {
    await query(`DELETE FROM notifications WHERE kind = 'import_failed' AND body LIKE $1`, [`%${b}%`]);
  }
  // append-only audit (forced RLS) blocks job deletion — neutralize instead;
  // fresh markers each run mean the legacy_id collision injector still works.
  await query(`UPDATE jobs SET status = 'completed' WHERE legacy_id LIKE 'nfy-inj-%'`);
  // the emitted events left swatch/artwork rows on these jobs — mark completed
  // so the live approval queues don't drift +1 per suite run (jobs stay, like
  // every other suite's fixtures; queues filter ACTIVE).
  await query(`UPDATE jobs SET status = 'completed' WHERE id = ANY($1::uuid[])`, [myJobIds]);
  delete process.env.NOTIFICATIONS_TEST_HOOK;
});

describe("emit targeting", () => {
  it("swatch awaiting → admin + other ops notified; actor and office excluded", async () => {
    const job = await newJob(ops1.cookie, customerId);
    myJobIds.push(job.id);
    const res = await swatchToAwaiting(ops1.cookie, job.id);
    expect(res.status).toBe(200);
    const got = await recipients("swatch_awaiting", job.id);
    expect(got).toContain(admin.id);
    expect(got).toContain(ops2.id);
    expect(got).not.toContain(ops1.id); // actor excluded
    expect(got).not.toContain(office.id); // no swatch.decide holder
  });

  it("artwork submit → ops notified; actor admin and office excluded", async () => {
    const job = await newJob(admin.cookie, customerId);
    myJobIds.push(job.id);
    const g = await getArtworkRoute(makeRequest(`/api/jobs/${job.id}/artwork`, { cookie: admin.cookie }), {
      params: Promise.resolve({ id: job.id }),
    });
    expect(g.status).toBe(200);
    const artwork = (await g.json()).artwork as { status: string; version: number };
    expect(artwork.status).toBe("draft");
    const p = await patchArtworkRoute(
      makeRequest(`/api/jobs/${job.id}/artwork`, {
        method: "PATCH",
        cookie: admin.cookie,
        body: { action: "submit", version: artwork.version },
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(p.status).toBe(200);
    const got = await recipients("artwork_awaiting", job.id);
    expect(got).toContain(ops1.id);
    expect(got).toContain(ops2.id);
    expect(got).not.toContain(admin.id); // actor excluded
    expect(got).not.toContain(office.id);
  });

  it("stale-version 409 → transition rolled back, zero notification rows", async () => {
    const job = await newJob(ops2.cookie, customerId);
    myJobIds.push(job.id);
    const create = await createAttempt(
      makeRequest(`/api/jobs/${job.id}/swatch/attempts`, { method: "POST", cookie: ops2.cookie, body: { sampleQty: 1 } }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(create.status).toBe(201);
    const { id, version } = (await create.json()) as { id: string; version: number };
    const ok = await patchAttempt(
      makeRequest(`/api/jobs/${job.id}/swatch/attempts/${id}`, {
        method: "PATCH",
        cookie: ops2.cookie,
        body: { status: "in_progress", version },
      }),
      { params: Promise.resolve({ id: job.id, attemptId: id }) },
    );
    expect(ok.status).toBe(200);
    const stale = await patchAttempt(
      makeRequest(`/api/jobs/${job.id}/swatch/attempts/${id}`, {
        method: "PATCH",
        cookie: ops2.cookie,
        body: { status: "awaiting", version: version }, // stale: version bumped by in_progress
      }),
      { params: Promise.resolve({ id: job.id, attemptId: id }) },
    );
    expect(stale.status).toBe(409);
    expect(await recipients("swatch_awaiting", job.id)).toEqual([]);
  });
  it("import execute-fail → admin + other ops notified; actor ops excluded", async () => {
    const marker = randomUUID().slice(0, 8);
    const custId = await newCustomer(ops1.cookie, `Nfy Hold ${marker}`);
    await query(`INSERT INTO jobs (id, legacy_id, job_number, customer_id) VALUES ($1,$2,$3,$4)`, [
      randomUUID(),
      `nfy-inj-${marker}`,
      `NFY-HOLD-${marker}`,
      custId,
    ]);
    // minimal shape-B state whose legacy_id collides with the pre-inserted job → mid-execute SQL failure
    const state = JSON.stringify({
      schemaVersion: 3,
      customers: [{ id: `nfy-cust-${marker}`, name: `Nfy Co ${marker}` }],
      products: [],
      jobs: [
        {
          id: `nfy-inj-${marker}`,
          jobNumber: "NFY-1",
          customer: `Nfy Co ${marker}`,
          customerId: `nfy-cust-${marker}`,
          orderDate: "2026-09-01",
          processDate: "2026-09-03",
          dispatchDate: "2026-09-05",
          quantity: 5,
          priority: "Normal",
          stages: [],
          positions: [],
          skuLines: [
            { id: `nfy-${marker}-l1`, jobId: `nfy-inj-${marker}`, sku: "NFY-1-SKU", quantity: 5, size: "M", unitPrice: 9.99 },
          ],
          swatch: { required: false, attempts: [] },
          dispatch: { method: "Collection", shipments: [] },
        },
      ],
      stockEvents: [],
      operationsEvents: [],
    });
    const up = await uploadRoute(
      new Request("http://localhost/api/admin/import", {
        method: "POST",
        headers: { "x-file-name": "nfy.json", cookie: ops1.cookie },
        body: state,
      }),
    );
    expect(up.status).toBe(201);
    const upBody = (await up.json()) as any;
    myBatchIds.push(upBody.batch.id);
    const conf = await importIdRoute.POST(
      new Request(`http://localhost/api/admin/import/${upBody.batch.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops1.cookie },
        body: JSON.stringify({ action: "confirm", version: upBody.batch.version, counts: upBody.counts }),
      }),
      { params: Promise.resolve({ id: upBody.batch.id }) },
    );
    expect(conf.status).toBe(200);
    const confBody = (await conf.json()) as any;
    const ex = await importIdRoute.POST(
      new Request(`http://localhost/api/admin/import/${upBody.batch.id}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: ops1.cookie },
        body: JSON.stringify({ action: "execute", version: confBody.batch.version }),
      }),
      { params: Promise.resolve({ id: upBody.batch.id }) },
    );
    expect(ex.status).toBe(500);
    const rows = await query<{ recipient_id: string }>(
      `SELECT recipient_id FROM notifications WHERE kind = 'import_failed' AND body LIKE $1`,
      [`%${upBody.batch.id}%`],
    );
    const got = rows.map((r) => r.recipient_id);
    expect(got).toContain(admin.id);
    expect(got).toContain(ops2.id);
    expect(got).not.toContain(ops1.id); // actor excluded
    expect(got).not.toContain(office.id);
    const batch = await query<{ status: string }>(`SELECT status FROM import_batches WHERE id = $1`, [upBody.batch.id]);
    expect(batch[0].status).toBe("failed");
  });
});

describe("notifications routes", () => {
  it("GET: anon 401; owner sees own rows only", async () => {
    const anon = await notificationsGet(makeRequest("/api/notifications"));
    expect(anon.status).toBe(401);

    await emitNotification({ kind: "import_failed", title: "NfySeed", body: "seed", roles: ["office"], actorId: null });

    const offRes = await notificationsGet(makeRequest("/api/notifications", { cookie: office.cookie }));
    expect(offRes.status).toBe(200);
    const off = (await offRes.json()) as { items: any[]; unreadCount: number };
    expect(off.unreadCount).toBeGreaterThan(0);
    expect(off.items.every((i) => i.title === "NfySeed")).toBe(true);

    const admRes = await notificationsGet(makeRequest("/api/notifications", { cookie: admin.cookie }));
    const adm = (await admRes.json()) as { items: any[] };
    expect(adm.items.some((i) => i.title === "NfySeed")).toBe(false);
  });

  it("POST read: mark one → all → idempotent; foreign id no-leak; validation + anon", async () => {
    await emitNotification({ kind: "import_failed", title: "NfySeed2", body: "s2", roles: ["office"], actorId: null });
    await emitNotification({ kind: "import_failed", title: "NfySeed3", body: "s3", roles: ["office"], actorId: null });

    const before = (await (
      await notificationsGet(makeRequest("/api/notifications", { cookie: office.cookie }))
    ).json()) as { items: any[]; unreadCount: number };
    expect(before.unreadCount).toBeGreaterThanOrEqual(3);
    const target = before.items[0].id as string;

    const one = await notificationsRead(
      makeRequest("/api/notifications/read", { method: "POST", cookie: office.cookie, body: { id: target } }),
    );
    expect(one.status).toBe(200);
    expect(((await one.json()) as { updated: number }).updated).toBe(1);

    const again = await notificationsRead(
      makeRequest("/api/notifications/read", { method: "POST", cookie: office.cookie, body: { id: target } }),
    );
    expect(((await again.json()) as { updated: number }).updated).toBe(0);

    // foreign: office marks an admin row → 0 rows affected, admin row untouched
    const admList = (await (
      await notificationsGet(makeRequest("/api/notifications", { cookie: admin.cookie }))
    ).json()) as { items: any[]; unreadCount: number };
    if (admList.items.length > 0) {
      const foreignId = admList.items[0].id as string;
      const foreign = await notificationsRead(
        makeRequest("/api/notifications/read", { method: "POST", cookie: office.cookie, body: { id: foreignId } }),
      );
      expect(((await foreign.json()) as { updated: number }).updated).toBe(0);
      const admAfter = (await (
        await notificationsGet(makeRequest("/api/notifications", { cookie: admin.cookie }))
      ).json()) as { unreadCount: number };
      expect(admAfter.unreadCount).toBe(admList.unreadCount);
    }

    const bad = await notificationsRead(
      makeRequest("/api/notifications/read", { method: "POST", cookie: office.cookie, body: { id: "not-a-uuid" } }),
    );
    expect(bad.status).toBe(400);

    const anon = await notificationsRead(makeRequest("/api/notifications/read", { method: "POST", body: {} }));
    expect(anon.status).toBe(401);

    const all = await notificationsRead(makeRequest("/api/notifications/read", { method: "POST", cookie: office.cookie, body: {} }));
    const allBody = (await all.json()) as { updated: number };
    expect(allBody.updated).toBeGreaterThanOrEqual(2);
    const after = (await (
      await notificationsGet(makeRequest("/api/notifications", { cookie: office.cookie }))
    ).json()) as { unreadCount: number };
    expect(after.unreadCount).toBe(0);
  });
});
