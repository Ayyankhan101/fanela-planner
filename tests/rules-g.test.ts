// Rules G1–G8 + FX-5 readiness matrix (phase0/01 §G, spec §14 read).
import { describe, it, expect, beforeAll } from "vitest";
import { makeUser, makeRequest, query, randomUUID } from "./helpers";
import { newCustomer, newJob, getJob, fillScreens, passStock, swatchApprove, swatchWaive } from "./fixtures";
import { PATCH as patchJob } from "@/app/api/jobs/[id]/route";
import { PATCH as patchScreens } from "@/app/api/jobs/[id]/screens/route";
import { PATCH as patchStock } from "@/app/api/jobs/[id]/stock/route";

let cookie: string;
let customerId: string;
const suffix = randomUUID().slice(0, 8);

beforeAll(async () => {
  const admin = await makeUser({ roles: ["admin"] });
  cookie = admin.cookie;
  customerId = await newCustomer(cookie, `G Co ${suffix}`);
});

describe("G1 — readiness computed server-side only", () => {
  it("client cannot write readiness (strict schema → 422)", async () => {
    const job = await newJob(cookie, customerId);
    const res = await patchJob(
      makeRequest(`/api/jobs/${job.id}`, {
        method: "PATCH",
        cookie,
        body: { readiness: { colour: "green" }, version: 1 },
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(res.status).toBe(422);
  });

  it("cache column refreshed after stock change and matches GET", async () => {
    const job = await newJob(cookie, customerId);
    await passStock(cookie, job.id);
    await swatchWaive(cookie, job.id);
    await fillScreens(cookie, job.id);
    const fresh = await getJob(cookie, job.id);
    expect(fresh.readiness.colour).toBe("green");
    const [row] = await query<{ readiness_cache: string | null }>(`SELECT readiness_cache FROM jobs WHERE id = $1`, [job.id]);
    expect(row.readiness_cache).toBe("green");
  });
});

describe("FX-5 readiness matrix", () => {
  it("White — no gates active (G2)", async () => {
    const id = randomUUID();
    await query(`INSERT INTO jobs (id, job_number, customer_id) VALUES ($1, $2, $3)`, [id, `FX5W-${suffix}`, customerId]);
    await query(
      `INSERT INTO screen_records (id, job_id, not_required, confirmed) VALUES ($1, $2, true, false)`,
      [randomUUID(), id],
    );
    await query(`INSERT INTO swatch_requirements (job_id, required) VALUES ($1, false)`, [id]);
    const r = await getJob(cookie, id);
    expect(r.readiness).toMatchObject({ colour: "white", activeGates: 0, passedGates: 0 });
  });

  it("Amber — partial (1 of 2 active gates pass)", async () => {
    const job = await newJob(cookie, customerId); // stock unfilled → fails
    await swatchWaive(cookie, job.id);
    await fillScreens(cookie, job.id);
    const r = await getJob(cookie, job.id);
    expect(r.readiness).toMatchObject({ colour: "amber", activeGates: 2, passedGates: 1 });
    expect(r.readiness.gates.stock).toEqual({ active: true, pass: false });
    expect(r.readiness.gates.screens).toEqual({ active: true, pass: true });
  });

  it("Green — all active gates pass", async () => {
    const job = await newJob(cookie, customerId);
    await passStock(cookie, job.id);
    await fillScreens(cookie, job.id);
    await swatchApprove(cookie, job.id);
    const r = await getJob(cookie, job.id);
    expect(r.readiness).toMatchObject({ colour: "green", activeGates: 3, passedGates: 3 });
  });

  it("Amber — open stock issue floors colour even with nothing passing (G6)", async () => {
    const job = await newJob(cookie, customerId);
    await swatchWaive(cookie, job.id); // screens stay blank → fail, stock fails too
    const res = await patchStock(
      makeRequest(`/api/jobs/${job.id}/stock`, {
        method: "PATCH",
        cookie,
        body: { lineId: job.lines[0].id, version: job.lines[0].version, stockIssue: "Short" },
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(res.status).toBe(200);
    const r = await getJob(cookie, job.id);
    expect(r.readiness.passedGates).toBe(0);
    expect(r.readiness.colour).toBe("amber");
  });

  it("Amber — blank screens count as active + failing (G4), not pass", async () => {
    const job = await newJob(cookie, customerId);
    await passStock(cookie, job.id);
    await swatchWaive(cookie, job.id); // screens required=null (blank)
    const r = await getJob(cookie, job.id);
    expect(r.readiness.gates.screens).toEqual({ active: true, pass: false });
    expect(r.readiness).toMatchObject({ colour: "amber", activeGates: 2, passedGates: 1 });
  });

  it("G7 floor — swatch required + unfilled never Green", async () => {
    const job = await newJob(cookie, customerId);
    await passStock(cookie, job.id);
    await fillScreens(cookie, job.id);
    const r = await getJob(cookie, job.id);
    expect(r.readiness).toMatchObject({ colour: "amber", activeGates: 3, passedGates: 2 });
    expect(r.readiness.gates.swatch).toEqual({ active: true, pass: false });
  });
});

describe("G8 — screens gate validations", () => {
  it("confirmed without counts → 422; made>required → 422", async () => {
    const job = await newJob(cookie, customerId);
    const version = (await getJob(cookie, job.id)).screen.version as number;
    const a = await patchScreens(
      makeRequest(`/api/jobs/${job.id}/screens`, {
        method: "PATCH",
        cookie,
        body: { required: null, made: null, confirmed: true, version },
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(a.status).toBe(422);
    const b = await patchScreens(
      makeRequest(`/api/jobs/${job.id}/screens`, {
        method: "PATCH",
        cookie,
        body: { required: 2, made: 3, confirmed: false, version },
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(b.status).toBe(422);
  });

  it("structure edit unchecks confirmation (v11 parity)", async () => {
    const job = await newJob(cookie, customerId);
    await fillScreens(cookie, job.id);
    expect((await getJob(cookie, job.id)).screen.confirmed).toBe(true);
    const version = (await getJob(cookie, job.id)).screen.version as number;
    const res = await patchScreens(
      makeRequest(`/api/jobs/${job.id}/screens`, {
        method: "PATCH",
        cookie,
        body: { required: 3, made: 3, version },
      }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(res.status).toBe(200);
    const after = await getJob(cookie, job.id);
    expect(after.screen.confirmed).toBe(false);
    expect(after.readiness.gates.screens.pass).toBe(false); // confirmed cleared → gate fails again
  });

  it("explicit notRequired deactivates the gate", async () => {
    const job = await newJob(cookie, customerId);
    const version = (await getJob(cookie, job.id)).screen.version as number;
    const res = await patchScreens(
      makeRequest(`/api/jobs/${job.id}/screens`, { method: "PATCH", cookie, body: { notRequired: true, version } }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(res.status).toBe(200);
    const r = await getJob(cookie, job.id);
    expect(r.readiness.gates.screens.active).toBe(false);
  });
});
