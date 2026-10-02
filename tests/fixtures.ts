// Shared P2 fixtures: job/stage/line handles + swatch happy-path helpers.
// Not a *.test.ts — vitest include pattern skips it.
import { makeRequest, randomUUID } from "./helpers";
import { POST as createCustomer } from "@/app/api/customers/route";
import { POST as createJob } from "@/app/api/jobs/route";
import { GET as getJobRoute } from "@/app/api/jobs/[id]/route";
import { POST as createAttempt } from "@/app/api/jobs/[id]/swatch/attempts/route";
import { PATCH as patchAttempt } from "@/app/api/jobs/[id]/swatch/attempts/[attemptId]/route";
import { PATCH as patchSwatchReq } from "@/app/api/jobs/[id]/swatch/route";
import { PATCH as patchScreensRoute } from "@/app/api/jobs/[id]/screens/route";
import { PATCH as patchStockRoute } from "@/app/api/jobs/[id]/stock/route";

export type StageHandle = { id: string; version: number; status: string; qty: number; department_key: string };
export type LineHandle = { id: string; version: number; qty_ordered: number };
export type JobHandle = { id: string; customerId: string; lines: LineHandle[]; stages: Record<string, StageHandle> };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

export async function newCustomer(cookie: string, name?: string): Promise<string> {
  const res = await createCustomer(
    makeRequest("/api/customers", { method: "POST", cookie, body: { name: name ?? `Fix Co ${randomUUID().slice(0, 8)}` } }),
  );
  if (res.status !== 201) throw new Error(`customer create failed: ${res.status} ${await res.text()}`);
  return (await res.json()).id as string;
}

export async function getJob(cookie: string, id: string): Promise<Json> {
  const res = await getJobRoute(makeRequest(`/api/jobs/${id}`, { cookie }), {
    params: Promise.resolve({ id }),
  });
  if (res.status !== 200) throw new Error(`getJob failed: ${res.status} ${await res.text()}`);
  return (await res.json()).job as Json;
}

export async function refreshStages(cookie: string, id: string): Promise<Record<string, StageHandle>> {
  const job = await getJob(cookie, id);
  return Object.fromEntries(
    (job.stages as Json[]).map((s) => [
      s.department_key as string,
      {
        id: s.id as string,
        version: Number(s.version),
        status: s.status as string,
        qty: Number(s.qty),
        department_key: s.department_key as string,
      },
    ]),
  );
}

export async function newJob(
  cookie: string,
  customerId: string,
  opts: { lines?: { skuText: string; qtyOrdered: number }[]; jobNumber?: string } = {},
): Promise<JobHandle> {
  const res = await createJob(
    makeRequest("/api/jobs", {
      method: "POST",
      cookie,
      body: {
        jobNumber: opts.jobNumber ?? `FIX-${randomUUID().slice(0, 8)}`,
        customerId,
        lines: opts.lines ?? [{ skuText: "FIX-SKU", qtyOrdered: 10 }],
      },
    }),
  );
  if (res.status !== 201) throw new Error(`job create failed: ${res.status} ${await res.text()}`);
  const { id } = (await res.json()) as { id: string };
  const job = await getJob(cookie, id);
  const lines = (job.lines as Json[]).map((l) => ({
    id: l.id as string,
    version: Number(l.version),
    qty_ordered: Number(l.qty_ordered),
  }));
  const stages = Object.fromEntries(
    (job.stages as Json[]).map((s) => [
      s.department_key as string,
      {
        id: s.id as string,
        version: Number(s.version),
        status: s.status as string,
        qty: Number(s.qty),
        department_key: s.department_key as string,
      },
    ]),
  );
  return { id, customerId, lines, stages };
}

// swatch happy path: draft → in_progress → awaiting → approved. Returns attempt id.
export async function swatchApprove(cookie: string, jobId: string): Promise<string> {
  const create = await createAttempt(
    makeRequest(`/api/jobs/${jobId}/swatch/attempts`, { method: "POST", cookie, body: { sampleQty: 1 } }),
    { params: Promise.resolve({ id: jobId }) },
  );
  if (create.status !== 201) throw new Error(`attempt create failed: ${create.status} ${await create.text()}`);
  const { id, version } = (await create.json()) as { id: string; version: number };
  let v = version;
  for (const status of ["in_progress", "awaiting"] as const) {
    const res = await patchAttempt(
      makeRequest(`/api/jobs/${jobId}/swatch/attempts/${id}`, {
        method: "PATCH",
        cookie,
        body: { status, version: v },
      }),
      { params: Promise.resolve({ id: jobId, attemptId: id }) },
    );
    if (res.status !== 200) throw new Error(`attempt ${status} failed: ${res.status} ${await res.text()}`);
    v = (await res.json()).version as number;
  }
  const ok = await patchAttempt(
    makeRequest(`/api/jobs/${jobId}/swatch/attempts/${id}`, {
      method: "PATCH",
      cookie,
      body: { status: "approved", reason: "fixture approval", version: v },
    }),
    { params: Promise.resolve({ id: jobId, attemptId: id }) },
  );
  if (ok.status !== 200) throw new Error(`attempt approve failed: ${ok.status} ${await ok.text()}`);
  return id;
}

// screens gate pass: required=made=2, confirmed
export async function fillScreens(cookie: string, jobId: string): Promise<void> {
  const job = await getJob(cookie, jobId);
  const res = await patchScreensRoute(
    makeRequest(`/api/jobs/${jobId}/screens`, {
      method: "PATCH",
      cookie,
      body: { required: 2, made: 2, confirmed: true, version: Number(job.screen.version) },
    }),
    { params: Promise.resolve({ id: jobId }) },
  );
  if (res.status !== 200) throw new Error(`fillScreens failed: ${res.status} ${await res.text()}`);
}

// stock gate pass: ordered + fully received + confirmed + no issue (receipt for first line)
export async function passStock(cookie: string, jobId: string): Promise<void> {
  const job = await getJob(cookie, jobId);
  for (const l of job.lines as Json[]) {
    const res = await patchStockRoute(
      makeRequest(`/api/jobs/${jobId}/stock`, {
        method: "PATCH",
        cookie,
        body: {
          lineId: l.id,
          version: Number(l.version),
          stockOrdered: true,
          stockConfirmed: true,
          receipt: { qty: Number(l.qty_ordered) },
        },
      }),
      { params: Promise.resolve({ id: jobId }) },
    );
    if (res.status !== 200) throw new Error(`passStock failed: ${res.status} ${await res.text()}`);
  }
}

// drop the swatch gate (admin/ops only, reason required when removing)
export async function swatchWaive(cookie: string, jobId: string): Promise<void> {
  const res = await patchSwatchReq(
    makeRequest(`/api/jobs/${jobId}/swatch`, {
      method: "PATCH",
      cookie,
      body: { required: false, confirm: true, reason: "fixture: no embroidery" },
    }),
    { params: Promise.resolve({ id: jobId }) },
  );
  if (res.status !== 200) throw new Error(`swatch waive failed: ${res.status} ${await res.text()}`);
}
