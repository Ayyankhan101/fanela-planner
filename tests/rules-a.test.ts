// Rules A1–A5: artwork approval machine (phase0/01 §D artwork rows, 03 §7).
import { describe, it, expect, beforeAll } from "vitest";
import { makeUser, makeRequest, query, randomUUID, type TestUser } from "./helpers";
import { newCustomer, newJob } from "./fixtures";
import { GET as getArtwork, PATCH as patchArtwork } from "@/app/api/jobs/[id]/artwork/route";

let adminCookie: string;
let office: TestUser;
let customerId: string;
const suffix = randomUUID().slice(0, 8);

async function artworkOf(jobId: string, cookie = adminCookie) {
  const res = await getArtwork(makeRequest(`/api/jobs/${jobId}/artwork`, { cookie }), {
    params: Promise.resolve({ id: jobId }),
  });
  expect(res.status).toBe(200);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await res.json()).artwork as Record<string, any>;
}

async function act(jobId: string, body: Record<string, unknown>, cookie = adminCookie) {
  const res = await patchArtwork(
    makeRequest(`/api/jobs/${jobId}/artwork`, { method: "PATCH", cookie, body }),
    { params: Promise.resolve({ id: jobId }) },
  );
  return { status: res.status, json: async () => res.json() };
}

beforeAll(async () => {
  const admin = await makeUser({ roles: ["admin"] });
  adminCookie = admin.cookie;
  office = await makeUser({ roles: ["office"] });
  customerId = await newCustomer(adminCookie, `A Co ${suffix}`);
});

describe("A1 — artwork record with proof/pantone fields", () => {
  it("draft auto-created; metadata persists", async () => {
    const job = await newJob(adminCookie, customerId);
    const a = await artworkOf(job.id);
    expect(a.status).toBe("draft");
    expect(a.version).toBe(1);
    const r = await act(job.id, { version: a.version, proofRef: "proof-v1.pdf", pantoneNotes: "186 C" });
    expect(r.status).toBe(200);
    const after = await artworkOf(job.id);
    expect(after.proof_ref).toBe("proof-v1.pdf");
    expect(after.pantone_notes).toBe("186 C");
  });
});

describe("A2 — approve/revise restricted to Admin/Ops; everyone reads", () => {
  it("office read → 200, office write → 403, director write → 403", async () => {
    const job = await newJob(adminCookie, customerId);
    expect((await artworkOf(job.id, office.cookie)).status).toBe("draft");
    const denied = await act(job.id, { action: "submit", version: 1 }, office.cookie);
    expect(denied.status).toBe(403);
    const director = await makeUser({ roles: ["director"] });
    expect((await act(job.id, { action: "submit", version: 1 }, director.cookie)).status).toBe(403);
  });
});

describe("A4 — full flow draft → submit → approve; withdraw back to draft", () => {
  it("submit moves to awaiting; approve sets approver; withdraw returns to draft", async () => {
    const job = await newJob(adminCookie, customerId);
    const sub = await act(job.id, { action: "submit", version: 1 });
    expect(sub.status).toBe(200);
    expect((await artworkOf(job.id)).status).toBe("awaiting");

    const wd = await act(job.id, { action: "withdraw", version: 1 });
    expect(wd.status).toBe(200);
    expect((await artworkOf(job.id)).status).toBe("draft");

    await act(job.id, { action: "submit", version: 1 });
    const ap = await act(job.id, { action: "approve", version: 1 });
    expect(ap.status).toBe(200);
    const approved = await artworkOf(job.id);
    expect(approved.status).toBe("approved");
    expect(approved.approved_by).toBeTruthy();

    const ev = await artworkOf(job.id);
    expect((ev.events as { action: string }[]).map((e) => e.action)).toContain("approve");
  });
});

describe("transition validity + reject reason", () => {
  it("draft → approve → 422; reject without reason → 422; reject with reason → rejected", async () => {
    const job = await newJob(adminCookie, customerId);
    expect((await act(job.id, { action: "approve", version: 1 })).status).toBe(422);
    expect((await act(job.id, { action: "reject", version: 1 })).status).toBe(422); // not awaiting yet
    await act(job.id, { action: "submit", version: 1 });
    const noReason = await act(job.id, { action: "reject", version: 1 });
    expect(noReason.status).toBe(422);
    const ok = await act(job.id, { action: "reject", version: 1, reason: "wrong colours" });
    expect(ok.status).toBe(200);
    const rej = await artworkOf(job.id);
    expect(rej.status).toBe("rejected");
    const events = await query<{ reason: string }>(
      `SELECT reason FROM artwork_events
        WHERE action = 'reject'
          AND artwork_version_id IN (SELECT id FROM artwork_versions WHERE artwork_id = (SELECT id FROM artworks WHERE job_id = $1))`,
      [job.id],
    );
    expect(events[0]?.reason).toBe("wrong colours");
  });
});

describe("A3 — revise creates new draft version; old record immutable", () => {
  it("approved row untouched, new version draft with approver cleared", async () => {
    const job = await newJob(adminCookie, customerId);
    await act(job.id, { action: "submit", version: 1 });
    await act(job.id, { action: "approve", version: 1, proofRef: "final.pdf" });
    const approvedRow = await query<Record<string, unknown>>(
      `SELECT id, version, status, approved_by FROM artwork_versions WHERE artwork_id = (SELECT id FROM artworks WHERE job_id = $1) AND version = 1`,
      [job.id],
    );

    const rv = await act(job.id, { action: "revise", version: 1, reason: "small tweak" });
    expect(rv.status).toBe(200);
    expect((await rv.json()).version).toBe(2);

    const now = await artworkOf(job.id);
    expect(now.status).toBe("draft");
    expect(now.version).toBe(2);
    expect(now.approved_by).toBeNull();

    const old = await query<Record<string, unknown>>(
      `SELECT status, approved_by FROM artwork_versions WHERE artwork_id = (SELECT id FROM artworks WHERE job_id = $1) AND version = 1`,
      [job.id],
    );
    expect(old[0]).toMatchObject({ status: "approved", approved_by: approvedRow[0].approved_by });
  });

  it("approved record rejects metadata edits until revised", async () => {
    const job = await newJob(adminCookie, customerId);
    await act(job.id, { action: "submit", version: 1 });
    await act(job.id, { action: "approve", version: 1 });
    const fix = await act(job.id, { version: 1, proofRef: "sneaky.pdf" });
    expect(fix.status).toBe(422);
  });
});

describe("optimistic lock + audit kind", () => {
  it("stale artwork version after revise → 409; mutations write artwork audit rows", async () => {
    const job = await newJob(adminCookie, customerId);
    await act(job.id, { action: "submit", version: 1 });
    await act(job.id, { action: "approve", version: 1 });
    expect((await act(job.id, { action: "revise", version: 1, reason: "v2" })).status).toBe(200);
    const stale = await act(job.id, { action: "submit", version: 1 }); // row is now version 2
    expect(stale.status).toBe(409);

    const rows = await query<{ n: string }>(
      `SELECT count(*)::int AS n FROM operational_audit WHERE job_id = $1 AND action = 'artwork'`,
      [job.id],
    );
    expect(Number(rows[0].n)).toBeGreaterThanOrEqual(3); // submit + approve + revise
  });
});
