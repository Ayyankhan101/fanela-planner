import { NextResponse } from "next/server";
import { requirePermission, err, toResponse } from "@/lib/http";
import { isExportView, exportWorkbook } from "@/lib/services/export";
import { MSG_EXPORT_UNKNOWN_VIEW, CODE_EXPORT_VIEW_UNKNOWN } from "@/lib/errors";

type Params = { params: Promise<{ view: string }> };

export async function GET(req: Request, { params }: Params) {
  const auth = await requirePermission("import.export", { req });
  if ("error" in auth) return auth.error;
  const { view } = await params;
  if (!isExportView(view)) return err(404, MSG_EXPORT_UNKNOWN_VIEW, CODE_EXPORT_VIEW_UNKNOWN);
  try {
    const q = new URL(req.url).searchParams.get("q");
    const result = await exportWorkbook(view, auth.user, { q });
    if ("error" in result) return result.error;
    return new NextResponse(new Uint8Array(result.buffer), {
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename="${result.filename}"`,
      },
    });
  } catch (e) {
    return toResponse(e);
  }
}
