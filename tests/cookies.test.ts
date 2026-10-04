import { describe, it, expect, afterEach } from "vitest";
import { cookieSecure } from "@/lib/auth/session";

// LAN HTTP deployment: Secure cookies over http://<lan-ip> are rejected by
// browsers (non-localhost) — login would bounce forever without the opt-out.
describe("cookieSecure — AUTH_COOKIE_SECURE LAN opt-out", () => {
  // NODE_ENV is readonly in Next's ProcessEnv type — flip via index access
  const env = process.env as Record<string, string | undefined>;
  const prevNode = env.NODE_ENV;
  const prevFlag = env.AUTH_COOKIE_SECURE;

  afterEach(() => {
    env.NODE_ENV = prevNode;
    if (prevFlag === undefined) delete env.AUTH_COOKIE_SECURE;
    else env.AUTH_COOKIE_SECURE = prevFlag;
  });

  it("production defaults to secure", () => {
    env.NODE_ENV = "production";
    delete env.AUTH_COOKIE_SECURE;
    expect(cookieSecure()).toBe(true);
  });

  it("production + AUTH_COOKIE_SECURE=false opts out (plain-HTTP LAN)", () => {
    env.NODE_ENV = "production";
    env.AUTH_COOKIE_SECURE = "false";
    expect(cookieSecure()).toBe(false);
  });

  it("non-production never secure regardless of flag", () => {
    env.NODE_ENV = "development";
    env.AUTH_COOKIE_SECURE = "false";
    expect(cookieSecure()).toBe(false);
    env.AUTH_COOKIE_SECURE = "true";
    expect(cookieSecure()).toBe(false);
  });
});
