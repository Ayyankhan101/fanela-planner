import { NextResponse } from "next/server";
import { requireAdminOrOps, err, toResponse } from "@/lib/http";
import { uploadImport, listBatches, MAX_UPLOAD_BYTES } from "@/lib/services/import";
import { MSG_FILE_TOO_LARGE, CODE_IMPORT_FILE_TOO_LARGE, MSG_RATE_LIMITED, CODE_RATE_LIMITED } from "@/lib/errors";
import { uploadBlocked, recordUpload } from "@/lib/auth/rate-limit";

// POST /api/admin/import — upload original file (raw body, x-file-name) → previewed batch
export async function POST(req: Request) {
  const auth = await requireAdminOrOps(req);
  if ("error" in auth) return auth.error;
  if (await uploadBlocked(auth.user.id)) return err(429, MSG_RATE_LIMITED, CODE_RATE_LIMITED);
  await recordUpload(auth.user.id);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD_BYTES) return err(413, MSG_FILE_TOO_LARGE, CODE_IMPORT_FILE_TOO_LARGE);
  const text = await req.text();
  const fileName = (req.headers.get("x-file-name") ?? "import.json").slice(0, 255);
  try {
    const { batch, counts } = await uploadImport(text, fileName, auth.user);
    return NextResponse.json({ batch, counts }, { status: 201 });
  } catch (e) {
    return toResponse(e);
  }
}

// GET /api/admin/import — batch history (newest first)
export async function GET(req: Request) {
  const auth = await requireAdminOrOps(req);
  if ("error" in auth) return auth.error;
  const batches = await listBatches();
  return NextResponse.json({ batches });
}
