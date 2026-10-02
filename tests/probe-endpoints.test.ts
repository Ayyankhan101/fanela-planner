// Permission probe: role × endpoint → exact allow/deny (phase0/04 Part C).
// Direct route-handler invocation with per-role session cookies (deterministic, no server).
// New endpoints added in P2+ must append rows here.
import { describe, it, expect, beforeAll } from "vitest";
import { makeUser, makeRequest, login, query, randomUUID, type TestUser } from "./helpers";
import { GET as listJobs, POST as createJob } from "@/app/api/jobs/route";
import { GET as getJob, PATCH as patchJob } from "@/app/api/jobs/[id]/route";
import { GET as listCustomers, POST as createCustomer } from "@/app/api/customers/route";
import { PATCH as patchCustomer } from "@/app/api/customers/[id]/route";
import { GET as meRoute } from "@/app/api/auth/me/route";
import * as jobsIdRoute from "@/app/api/jobs/[id]/route";
import * as customersIdRoute from "@/app/api/customers/[id]/route";

const ROLES = ["admin", "ops", "office", "director", "dispatch", "packing", "dept"] as const;
const ip = () => `10.12.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

let users: Record<string, TestUser>;
let cookies: Record<string, string>;
let customerId: string;
let jobId: string;

beforeAll(async () => {
  users = {};
  cookies = {};
  for (const role of ROLES) {
    users[role] = await makeUser({ roles: [role], departments: role === "dept" ? ["print"] : [] });
    cookies[role] = await login(users[role]);
  }

  const c = await createCustomer(
    makeRequest("/api/customers", {
      method: "POST",
      cookie: cookies.admin,
      body: { name: `Probe Co ${randomUUID().slice(0, 6)}` },
    }),
  );
  expect(c.status).toBe(201);
  customerId = (await c.json()).id as string;

  const j = await createJob(
    makeRequest("/api/jobs", {
      method: "POST",
      cookie: cookies.admin,
      body: { jobNumber: `PROBE-${randomUUID().slice(0, 8)}`, customerId, lines: [{ skuText: "PROBE", qtyOrdered: 1 }] },
    }),
  );
  expect(j.status).toBe(201);
  jobId = (await j.json()).id as string;
});

async function currentVersion(): Promise<number> {
  const rows = await query<{ version: number }>(`SELECT version FROM jobs WHERE id = $1`, [jobId]);
  return Number(rows[0].version);
}

function expectAllow(allowed: readonly string[]): Record<(typeof ROLES)[number], boolean> {
  return Object.fromEntries(ROLES.map((r) => [r, allowed.includes(r)])) as Record<
    (typeof ROLES)[number],
    boolean
  >;
}

describe("probe — GET /api/jobs (jobs.view)", () => {
  const want = expectAllow([...ROLES]); // all 7 roles
  for (const role of ROLES) {
    it(`${role} → ${want[role] ? 200 : 403}`, async () => {
      const res = await listJobs(makeRequest("/api/jobs", { cookie: cookies[role], ip: ip() }));
      expect(res.status).toBe(want[role] ? 200 : 403);
    });
  }
});

describe("probe — GET /api/jobs/:id (jobs.view)", () => {
  const want = expectAllow([...ROLES]);
  for (const role of ROLES) {
    it(role, async () => {
      const res = await getJob(makeRequest(`/api/jobs/${jobId}`, { cookie: cookies[role], ip: ip() }), {
        params: Promise.resolve({ id: jobId }),
      });
      expect(res.status).toBe(want[role] ? 200 : 403);
    });
  }
});

describe("probe — POST /api/jobs (jobs.edit = admin, ops, office)", () => {
  const want = expectAllow(["admin", "ops", "office"]);
  for (const role of ROLES) {
    it(role, async () => {
      const res = await createJob(
        makeRequest("/api/jobs", {
          method: "POST",
          cookie: cookies[role],
          ip: ip(),
          body: {
            jobNumber: `PROBE-POST-${role}-${randomUUID().slice(0, 6)}`,
            customerId,
            lines: [{ skuText: "X", qtyOrdered: 1 }],
          },
        }),
      );
      expect(res.status).toBe(want[role] ? 201 : 403);
    });
  }
});

describe("probe — PATCH /api/jobs/:id header (jobs.edit = admin, ops, office)", () => {
  const want = expectAllow(["admin", "ops", "office"]);
  for (const role of ROLES) {
    it(role, async () => {
      const version = await currentVersion();
      const res = await patchJob(
        makeRequest(`/api/jobs/${jobId}`, {
          method: "PATCH",
          cookie: cookies[role],
          ip: ip(),
          body: { version, notes: `probe by ${role}` },
        }),
        { params: Promise.resolve({ id: jobId }) },
      );
      expect(res.status).toBe(want[role] ? 200 : 403);
    });
  }
});

describe("probe — PATCH archived:true (admin, ops only — office 403)", () => {
  const want = expectAllow(["admin", "ops"]);
  for (const role of ROLES) {
    it(role, async () => {
      const version = await currentVersion();
      const res = await patchJob(
        makeRequest(`/api/jobs/${jobId}`, {
          method: "PATCH",
          cookie: cookies[role],
          ip: ip(),
          body: { version, archived: true },
        }),
        { params: Promise.resolve({ id: jobId }) },
      );
      expect(res.status).toBe(want[role] ? 200 : 403);
    });
  }
});

describe("probe — GET /api/customers (customers.view = all but dept)", () => {
  const want = expectAllow(["admin", "ops", "office", "director", "dispatch", "packing"]);
  for (const role of ROLES) {
    it(role, async () => {
      const res = await listCustomers(makeRequest("/api/customers", { cookie: cookies[role], ip: ip() }));
      expect(res.status).toBe(want[role] ? 200 : 403);
    });
  }
});

describe("probe — POST /api/customers (customers.edit = admin, ops, office)", () => {
  const want = expectAllow(["admin", "ops", "office"]);
  for (const role of ROLES) {
    it(role, async () => {
      const res = await createCustomer(
        makeRequest("/api/customers", {
          method: "POST",
          cookie: cookies[role],
          ip: ip(),
          body: { name: `ProbeC ${role} ${randomUUID().slice(0, 6)}` },
        }),
      );
      expect(res.status).toBe(want[role] ? 201 : 403);
    });
  }
});

describe("probe — PATCH /api/customers/:id (update_master = admin, ops only)", () => {
  const want = expectAllow(["admin", "ops"]);
  for (const role of ROLES) {
    it(role, async () => {
      const res = await patchCustomer(
        makeRequest(`/api/customers/${customerId}`, {
          method: "PATCH",
          cookie: cookies[role],
          ip: ip(),
          body: { confirm: true, notes: `probe ${role}` },
        }),
        { params: Promise.resolve({ id: customerId }) },
      );
      expect(res.status).toBe(want[role] ? 200 : 403);
    });
  }
});

describe("probe — unauthenticated", () => {
  const handlers: [string, () => Promise<Response>][] = [
    ["GET /api/jobs", () => listJobs(makeRequest("/api/jobs", { ip: ip() }))],
    ["GET /api/customers", () => listCustomers(makeRequest("/api/customers", { ip: ip() }))],
    ["GET /api/jobs/:id", () => getJob(makeRequest(`/api/jobs/${jobId}`, { ip: ip() }), { params: Promise.resolve({ id: jobId }) })],
    ["GET /api/auth/me", () => meRoute(makeRequest("/api/auth/me", { ip: ip() }))],
    [
      "POST /api/jobs",
      () =>
        createJob(
          makeRequest("/api/jobs", {
            method: "POST",
            ip: ip(),
            body: { jobNumber: `UNAUTH-${randomUUID().slice(0, 6)}`, customerId, lines: [{ skuText: "X", qtyOrdered: 1 }] },
          }),
        ),
    ],
  ];
  for (const [name, fn] of handlers) {
    it(`${name} → 401`, async () => {
      expect((await fn()).status).toBe(401);
    });
  }
});

describe("probe — no DELETE handlers (B6, structural)", () => {
  it("jobs/:id and customers/:id expose no DELETE export", () => {
    expect((jobsIdRoute as Record<string, unknown>).DELETE).toBeUndefined();
    expect((customersIdRoute as Record<string, unknown>).DELETE).toBeUndefined();
  });
});
