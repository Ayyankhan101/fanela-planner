import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminOrOps, err, toResponse } from "@/lib/http";
import {
  previewBatch,
  confirmBatch,
  discardBatch,
  revalidateBatch,
  executeBatch,
  readOriginal,
  errorCsv,
} from "@/lib/services/import";
import { MSG_INVALID_REQUEST, CODE_INVALID_REQUEST } from "@/lib/errors";

type Params = { params: Promise<{ id: string }> };

// GET /api/admin/import/:id?view=preview|original|errors&page=&filter=
export async function GET(req: Request, { params }: Params) {
  const auth = await requireAdminOrOps(req);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const url = new URL(req.url);
  const view = url.searchParams.get("view") ?? "preview";
  try {
    if (view === "original") {
      const { name, bytes } = await readOriginal(id);
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "content-type": "application/json",
          "content-disposition": `attachment; filename="${name.replace(/"/g, "")}"`,
        },
      });
    }
    if (view === "errors") {
      const csv = await errorCsv(id);
      return new NextResponse(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="import-${id}-errors.csv"`,
        },
      });
    }
    if (view !== "preview") return err(400, MSG_INVALID_REQUEST, CODE_INVALID_REQUEST);
    const page = Number(url.searchParams.get("page") ?? 1);
    const filter = url.searchParams.get("filter") ?? "issues";
    const data = await previewBatch(id, { page: Number.isFinite(page) ? page : 1, filter });
    return NextResponse.json(data);
  } catch (e) {
    return toResponse(e);
  }
}

const bodySchema = z
  .object({
    action: z.enum(["confirm", "execute", "discard", "revalidate"]),
    version: z.number().int().min(1),
    counts: z
      .object({
        create: z.number().int(),
        skip: z.number().int(),
        error: z.number().int(),
        warn: z.number().int(),
        info: z.number().int().optional(),
      })
      .partial()
      .optional(),
    typedCount: z.number().int().min(0).optional(),
  })
  .strict();

// POST /api/admin/import/:id — confirm | execute | discard | revalidate (CAS version)
export async function POST(req: Request, { params }: Params) {
  const auth = await requireAdminOrOps(req);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, MSG_INVALID_REQUEST, CODE_INVALID_REQUEST);
  const { action, version, counts, typedCount } = parsed.data;
  try {
    if (action === "confirm") {
      const batch = await confirmBatch(id, version, counts ?? {}, auth.user);
      return NextResponse.json({ batch });
    }
    if (action === "execute") {
      const result = await executeBatch(id, version, auth.user, typedCount);
      return NextResponse.json(result);
    }
    if (action === "discard") {
      const batch = await discardBatch(id, version);
      return NextResponse.json({ batch });
    }
    const batch = await revalidateBatch(id, auth.user);
    return NextResponse.json({ batch });
  } catch (e) {
    return toResponse(e);
  }
}
