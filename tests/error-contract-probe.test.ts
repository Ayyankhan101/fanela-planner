// F1 error-contract probe: route bodies must carry taxonomy codes, never zod internals.
// Adds coverage only — does not change existing assertions.
import { describe, it, expect, beforeAll } from "vitest";
import { makeUser, makeRequest, randomUUID } from "./helpers";
import { newCustomer } from "./fixtures";
import { POST as createCustomer } from "@/app/api/customers/route";
import { PATCH as patchCustomer } from "@/app/api/customers/[id]/route";
import { POST as createJob } from "@/app/api/jobs/route";
import { GET as getJobRoute } from "@/app/api/jobs/[id]/route";
import { POST as cancelJob } from "@/app/api/jobs/[id]/cancel/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as importRoute } from "@/app/api/admin/import/route";
import {
  MSG_INVALID_REQUEST,
  CODE_VALIDATION_ERROR,
  MSG_INVALID_CREDENTIALS,
  CODE_INVALID_CREDENTIALS,
  MSG_CUSTOMER_NOT_FOUND,
  CODE_CUSTOMER_NOT_FOUND,
  MSG_JOB_NOT_FOUND,
  CODE_JOB_NOT_FOUND,
  MSG_NOTHING_TO_UPDATE,
  CODE_NOTHING_TO_UPDATE,
  MSG_FORBIDDEN_ADMIN_OPS,
  CODE_FORBIDDEN_ADMIN_OPS,
  MSG_UNAUTHENTICATED,
  CODE_UNAUTHENTICATED,
  CODE_DUPLICATE_JOB_NUMBER,
} from "@/lib/errors";

let adminCookie = "";
let customerId = "";

beforeAll(async () => {
  const admin = await makeUser({ roles: ["admin"] });
  adminCookie = admin.cookie;
  customerId = await newCustomer(adminCookie, `EC ${randomUUID().slice(0, 8)}`);
});

describe("error contract — zod/validation failures", () => {
  it("POST customers: empty name → validation_error, no zod leak", async () => {
    const res = await createCustomer(
      makeRequest("/api/customers", { method: "POST", cookie: adminCookie, body: { name: "" } }),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: MSG_INVALID_REQUEST, code: CODE_VALIDATION_ERROR });
  });

  it("POST jobs: invalid body → validation_error", async () => {
    const res = await createJob(
      makeRequest("/api/jobs", { method: "POST", cookie: adminCookie, body: { jobNumber: "EC-" + randomUUID().slice(0, 6) } }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe(CODE_VALIDATION_ERROR);
    expect(body.error).toBe(MSG_INVALID_REQUEST);
  });

  it("PATCH customers/[id]: missing confirm field → validation_error (schema gate)", async () => {
    const res = await patchCustomer(
      makeRequest(`/api/customers/${customerId}`, {
        method: "PATCH",
        cookie: adminCookie,
        body: { name: "EC Updated" },
      }),
      { params: Promise.resolve({ id: customerId }) },
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: MSG_INVALID_REQUEST, code: CODE_VALIDATION_ERROR });
  });

  it("PATCH customers/[id]: confirm true but nothing to update → nothing_to_update", async () => {
    const res = await patchCustomer(
      makeRequest(`/api/customers/${customerId}`, {
        method: "PATCH",
        cookie: adminCookie,
        body: { confirm: true },
      }),
      { params: Promise.resolve({ id: customerId }) },
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: MSG_NOTHING_TO_UPDATE, code: CODE_NOTHING_TO_UPDATE });
  });

  it("PATCH customers/[id]: unknown id → customer_not_found", async () => {
    const res = await patchCustomer(
      makeRequest(`/api/customers/${randomUUID()}`, {
        method: "PATCH",
        cookie: adminCookie,
        body: { confirm: true, name: "X" },
      }),
      { params: Promise.resolve({ id: randomUUID() }) },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: MSG_CUSTOMER_NOT_FOUND, code: CODE_CUSTOMER_NOT_FOUND });
  });

  it("POST cancel: bad body → validation_error", async () => {
    const res = await cancelJob(
      makeRequest(`/api/jobs/${randomUUID()}/cancel`, {
        method: "POST",
        cookie: adminCookie,
        body: { reason: "" },
      }),
      { params: Promise.resolve({ id: randomUUID() }) },
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: MSG_INVALID_REQUEST, code: CODE_VALIDATION_ERROR });
  });

  it("GET jobs/[id]: unknown id → job_not_found", async () => {
    const id = randomUUID();
    const res = await getJobRoute(makeRequest(`/api/jobs/${id}`, { cookie: adminCookie }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: MSG_JOB_NOT_FOUND, code: CODE_JOB_NOT_FOUND });
  });
});

describe("error contract — conflicts", () => {
  it("POST jobs: duplicate job number → duplicate_job_number (409, no message-only)", async () => {
    const jobNumber = "EC-DUP-" + randomUUID().slice(0, 8);
    const payload = { jobNumber, customerId, lines: [{ skuText: "EC-SKU", qtyOrdered: 5 }] };
    const first = await createJob(makeRequest("/api/jobs", { method: "POST", cookie: adminCookie, body: payload }));
    expect(first.status).toBe(201);
    const second = await createJob(makeRequest("/api/jobs", { method: "POST", cookie: adminCookie, body: payload }));
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "Job number already exists.", code: CODE_DUPLICATE_JOB_NUMBER });
  });
});

describe("error contract — auth", () => {
  it("POST login: wrong password → invalid_credentials", async () => {
    const res = await loginRoute(
      makeRequest("/api/auth/login", {
        method: "POST",
        body: { email: `ec-${randomUUID().slice(0, 8)}@fanela.test`, password: "wrong-pass" },
        ip: `10.77.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: MSG_INVALID_CREDENTIALS, code: CODE_INVALID_CREDENTIALS });
  });

  it("GET admin/import: anon → unauthenticated", async () => {
    const res = await importRoute(makeRequest("/api/admin/import"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: MSG_UNAUTHENTICATED, code: CODE_UNAUTHENTICATED });
  });

  it("GET admin/import: office → forbidden_admin_ops", async () => {
    const office = await makeUser({ roles: ["office"] });
    const res = await importRoute(makeRequest("/api/admin/import", { cookie: office.cookie }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: MSG_FORBIDDEN_ADMIN_OPS, code: CODE_FORBIDDEN_ADMIN_OPS });
  });
});
