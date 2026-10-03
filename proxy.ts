import { NextResponse, type NextRequest } from "next/server";
import { MSG_CSRF_ORIGIN_MISMATCH, CODE_CSRF_ORIGIN_MISMATCH } from "@/lib/errors";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Cross-site form posts / fetches send Origin (browsers); curl and route-handler
// tests send none. Missing both headers = non-browser client → no CSRF surface.
export function sameOriginBlocked(req: NextRequest): boolean {
  if (!MUTATING.has(req.method)) return false;
  const host = req.headers.get("host");
  if (!host) return false;
  const claim = req.headers.get("origin") ?? req.headers.get("referer");
  if (!claim || claim === "null") return claim === "null"; // opaque origin → block; absent → allow
  try {
    return new URL(claim).host !== host;
  } catch {
    return true;
  }
}

export default function proxy(req: NextRequest): NextResponse {
  if (sameOriginBlocked(req)) {
    return NextResponse.json(
      { error: MSG_CSRF_ORIGIN_MISMATCH, code: CODE_CSRF_ORIGIN_MISMATCH },
      { status: 403 },
    );
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
