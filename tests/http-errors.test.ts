// T20 — error contract: {error, code} envelope, default-code fill, dev/prod/unset 500 split.
import { describe, it, expect, vi, afterEach } from "vitest";
import { err, toResponse, requireUser, requirePermission, requireAdminOrOps } from "@/lib/http";
import {
  MSG_UNAUTHENTICATED,
  MSG_FORBIDDEN,
  MSG_FORBIDDEN_ADMIN_OPS,
  MSG_INTERNAL_ERROR,
  CODE_STALE_BATCH,
  CODE_VALIDATION_ERROR,
  ERROR_CODES,
} from "@/lib/errors";

const ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_ENV = ENV.NODE_ENV;
function setEnv(v: string | undefined): void {
  if (v === undefined) delete ENV.NODE_ENV;
  else ENV.NODE_ENV = v;
}

afterEach(() => {
  setEnv(ORIGINAL_ENV);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/x", { headers: new Headers(headers) });
}

describe("err()", () => {
  it("passes an explicit code through", async () => {
    const res = err(422, "Bad row.", CODE_VALIDATION_ERROR);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Bad row.", code: "validation_error" });
  });

  it("fills internal_error when no code passed", async () => {
    const res = err(400, "Bad request.");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Bad request.", code: "internal_error" });
  });

  it("every sample emission is in the exported ERROR_CODES set", async () => {
    const samples = [
      err(401, MSG_UNAUTHENTICATED),
      err(403, MSG_FORBIDDEN),
      err(403, MSG_FORBIDDEN_ADMIN_OPS),
      err(500, MSG_INTERNAL_ERROR),
      err(409, "Conflict.", CODE_STALE_BATCH),
    ];
    for (const res of samples) {
      const body = (await res.json()) as { code: string };
      expect(ERROR_CODES).toContain(body.code);
    }
  });
});

describe("auth guards emit frozen text + codes", () => {
  it("requireUser → 401 unauthenticated", async () => {
    const out = await requireUser(req());
    expect("error" in out).toBe(true);
    const res = (out as { error: Response }).error;
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: MSG_UNAUTHENTICATED, code: "unauthenticated" });
  });

  it("requirePermission (anon) → 401 unauthenticated", async () => {
    const out = await requirePermission("jobs.view", { req: req() });
    expect("error" in out).toBe(true);
    const res = (out as { error: Response }).error;
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: MSG_UNAUTHENTICATED, code: "unauthenticated" });
  });

  it("requireAdminOrOps (anon) → 401 unauthenticated", async () => {
    const out = await requireAdminOrOps(req());
    expect("error" in out).toBe(true);
    const res = (out as { error: Response }).error;
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: MSG_UNAUTHENTICATED, code: "unauthenticated" });
  });

  it("guard texts match frozen MSG constants byte-for-byte", () => {
    expect(MSG_UNAUTHENTICATED).toBe("Sign in required.");
    expect(MSG_FORBIDDEN).toBe("Not permitted.");
    expect(MSG_FORBIDDEN_ADMIN_OPS).toBe("Admin or Operations only.");
    expect(MSG_INTERNAL_ERROR).toBe("Unexpected server error.");
  });
});

describe("toResponse()", () => {
  it("passes status, message, code and current payload for a CAS conflict", async () => {
    const res = toResponse({
      status: 409,
      message: "Batch moved.",
      current: { status: "preview", version: 3 },
      code: CODE_STALE_BATCH,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Batch moved.",
      current: { status: "preview", version: 3 },
      code: "stale_batch",
    });
  });

  it("defaults internal_error for a typed error with no code", async () => {
    const res = toResponse({ status: 422, message: "Nothing to update." });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Nothing to update.", code: "internal_error" });
  });

  describe("500 body split (dev / prod / unset)", () => {
    const boom = () => toResponse(new Error("SQL: relation \"jobs\" does not exist"));

    it("production → generic message byte-identical, no detail", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      setEnv("production");
      const res = boom();
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: MSG_INTERNAL_ERROR, code: "internal_error" });
    });

    it("development → includes e.message", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      setEnv("development");
      const res = boom();
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: 'SQL: relation "jobs" does not exist',
        code: "internal_error",
      });
    });

    it("unset NODE_ENV → generic message, must NOT leak", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      setEnv(undefined);
      const res = boom();
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: MSG_INTERNAL_ERROR, code: "internal_error" });
    });

    it("test env → generic message (only development leaks)", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      setEnv("test");
      const res = boom();
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: MSG_INTERNAL_ERROR, code: "internal_error" });
    });

    it("non-Error thrown values stay generic even in development", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      setEnv("development");
      const res = toResponse("string failure");
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: MSG_INTERNAL_ERROR, code: "internal_error" });
    });
  });
});
