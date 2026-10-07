// Unit tests for the audit Details diff (app/(app)/audit/diff.ts) — the human-readable
// rendering that replaced the raw JSON dump in the audit log's Details column.
import { describe, it, expect } from "vitest";
import { diffAudit, fieldLabel, fmtValue, humanizeAction } from "@/app/(app)/audit/diff";

describe("diffAudit — update (before + after)", () => {
  it("returns only changed fields", () => {
    const c = diffAudit(
      { status: "draft", notes: null, machine: "M1" },
      { status: "in_progress", notes: null, machine: "M1" },
    );
    expect(c).toEqual([{ field: "status", from: "draft", to: "in_progress" }]);
  });

  it("skips id and job_id (own columns)", () => {
    const c = diffAudit({ id: "a", job_id: "b", status: "x" }, { id: "a", job_id: "b", status: "x" });
    expect(c).toEqual([]);
  });

  it("reports cleared fields (value → null)", () => {
    const c = diffAudit({ reason: "too slow" }, { reason: null });
    expect(c).toEqual([{ field: "reason", from: "too slow", to: null }]);
  });
});

describe("diffAudit — create (before null)", () => {
  it("lists non-null after fields, nulls skipped", () => {
    const c = diffAudit(null, { status: "draft", attempt_no: 1, decided_at: null, id: "x" });
    expect(c).toEqual([
      { field: "status", from: null, to: "draft" },
      { field: "attempt_no", from: null, to: 1 },
    ]);
  });

  it("empty result when after is all null", () => {
    expect(diffAudit(null, { a: null, b: null })).toEqual([]);
  });
});

describe("diffAudit — delete (after null) and empty", () => {
  it("lists non-null before fields", () => {
    const c = diffAudit({ status: "open", closed_at: null }, null);
    expect(c).toEqual([{ field: "status", from: "open", to: null }]);
  });

  it("both null → no changes", () => {
    expect(diffAudit(null, null)).toEqual([]);
  });
});

describe("diffAudit — defensive input", () => {
  it("parses stringified JSON (text column fallback)", () => {
    const c = diffAudit('{"status":"a"}', '{"status":"b"}');
    expect(c).toEqual([{ field: "status", from: "a", to: "b" }]);
  });

  it("unparseable string → no crash, treated as absent", () => {
    expect(diffAudit("not-json", null)).toEqual([]);
  });
});

describe("humanizeAction", () => {
  it("maps all audit slugs", () => {
    expect(humanizeAction("job-header")).toBe("Job header");
    expect(humanizeAction("order-lines")).toBe("Order lines");
    expect(humanizeAction("customer-master")).toBe("Customer master");
    expect(humanizeAction("swatch")).toBe("Swatch");
    expect(humanizeAction("dispatch")).toBe("Dispatch");
    expect(humanizeAction("artwork")).toBe("Artwork");
    expect(humanizeAction("stage")).toBe("Stage");
    expect(humanizeAction("stencil")).toBe("Stencil");
  });

  it("fallback capitalizes unknown slug", () => {
    expect(humanizeAction("approve")).toBe("Approve");
  });
});

describe("fieldLabel / fmtValue", () => {
  it("snake_case and camelCase → Title", () => {
    expect(fieldLabel("attempt_no")).toBe("Attempt no");
    expect(fieldLabel("thread_colours")).toBe("Thread colours");
    expect(fieldLabel("startedAt")).toBe("Started at");
  });

  it("formats values for humans", () => {
    expect(fmtValue(null)).toBe("—");
    expect(fmtValue(undefined)).toBe("—");
    expect(fmtValue("")).toBe("—");
    expect(fmtValue(3)).toBe("3");
    expect(fmtValue(true)).toBe("yes");
    expect(fmtValue("2026-10-07T02:39:03.242Z")).toBe("2026-10-07 02:39");
    expect(fmtValue("55fbbc84-e39c-422e-a0fd-905b79bd65a7")).toBe("55fbbc84…");
    expect(fmtValue({ a: 1 })).toBe('{"a":1}');
  });
});
