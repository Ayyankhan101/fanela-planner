import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/http";
import { listAudit } from "@/lib/services/audit";

export async function GET(req: Request) {
  const auth = await requirePermission("audit.view", { req });
  if ("error" in auth) return auth.error;
  const url = new URL(req.url);
  const rows = await listAudit(
    {
      jobId: url.searchParams.get("jobId") ?? undefined,
      entityType: url.searchParams.get("entityType") ?? undefined,
      limit: Number(url.searchParams.get("limit") ?? "200") || 200,
    },
    auth.user,
  );
  return NextResponse.json({ events: rows });
}
