// Storage policy (E5 + B2): upload quota → 413, retention sweep → orphan/expiry removal.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, utimes, rm, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import {
  uploadImport,
  sweepUploads,
  storageQuotaBytes,
  storageUsageBytes,
  ImportFailure,
  DEFAULT_STORAGE_QUOTA_BYTES,
} from "@/lib/services/import";
import { makeUser } from "./helpers";

let admin: Awaited<ReturnType<typeof makeUser>>;
const tempDirs: string[] = [];
const tempFileIds: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "fanela-sweep-"));
  tempDirs.push(dir);
  return dir;
}

async function age(filePath: string, days: number): Promise<void> {
  const t = new Date(Date.now() - days * 86_400_000);
  await utimes(filePath, t, t);
}

beforeAll(async () => {
  admin = await makeUser({ roles: ["admin"] });
});

afterAll(async () => {
  for (const id of tempFileIds) await query(`DELETE FROM files WHERE id = $1`, [id]);
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
  delete process.env.STORAGE_QUOTA_BYTES;
});

describe("storage quota", () => {
  it("falls back to the 5 GB default when env is unset or invalid", () => {
    delete process.env.STORAGE_QUOTA_BYTES;
    expect(storageQuotaBytes()).toBe(DEFAULT_STORAGE_QUOTA_BYTES);
    process.env.STORAGE_QUOTA_BYTES = "not-a-number";
    expect(storageQuotaBytes()).toBe(DEFAULT_STORAGE_QUOTA_BYTES);
    process.env.STORAGE_QUOTA_BYTES = "-5";
    expect(storageQuotaBytes()).toBe(DEFAULT_STORAGE_QUOTA_BYTES);
    process.env.STORAGE_QUOTA_BYTES = "12345";
    expect(storageQuotaBytes()).toBe(12345);
    delete process.env.STORAGE_QUOTA_BYTES;
  });

  it("upload over quota → 413 import_storage_quota, no file/batch written", async () => {
    const before = await query<{ n: number }>(`SELECT count(*)::int AS n FROM import_batches`);
    process.env.STORAGE_QUOTA_BYTES = "1"; // any usage + any payload exceeds it
    try {
      await uploadImport("{}", "quota-test.json", {
        id: admin.id,
        email: admin.email,
        name: "Test User",
        roles: ["admin"],
        departments: [],
        totpEnabled: true,
      });
      expect.unreachable("upload should have failed with 413");
    } catch (e) {
      expect(e).toBeInstanceOf(ImportFailure);
      const f = e as ImportFailure;
      expect(f.status).toBe(413);
      expect(f.code).toBe("import_storage_quota");
    } finally {
      delete process.env.STORAGE_QUOTA_BYTES;
    }
    const after = await query<{ n: number }>(`SELECT count(*)::int AS n FROM import_batches`);
    expect(after[0].n).toBe(before[0].n);
  });
});

describe("storageUsageBytes", () => {
  it("sums file sizes in the dir, skipping subdirectories", async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, "a.json"), "x".repeat(100));
    await writeFile(path.join(dir, "b.json"), "x".repeat(50));
    await mkdtemp(path.join(dir, "nested-")); // subdirectory contributes 0
    expect(await storageUsageBytes(dir)).toBe(150);
  });
});

describe("sweepUploads", () => {
  it("removes orphaned + expired files, keeps recent + keyed + non-json", async () => {
    const dir = await tempDir();
    const orphanOld = path.join(dir, "orphan-old.json");
    const orphanNew = path.join(dir, "orphan-new.json");
    const keyedOld = path.join(dir, "keyed-old.json");
    const keyedNew = path.join(dir, "keyed-new.json");
    const notJson = path.join(dir, "notes.txt");

    await writeFile(orphanOld, "orphan".repeat(10));
    await writeFile(orphanNew, "new");
    await writeFile(keyedOld, "old");
    await writeFile(keyedNew, "fresh");
    await writeFile(notJson, "keep me");

    await age(orphanOld, 3); // > grace (1 d) and no files row → remove
    await age(keyedOld, 100); // > retention (90 d) with files row → remove
    await age(notJson, 400); // non-json → never touched

    const fileId = randomUUID();
    tempFileIds.push(fileId);
    await query(
      `INSERT INTO files (id, entity_type, name, size, mime, bucket, key, uploaded_by)
       VALUES ($1, 'import', 'keyed-old.json', 3, 'application/json', 'local', 'keyed-old.json', $2)`,
      [fileId, admin.id],
    );

    const res = await sweepUploads({ dir, retentionDays: 90, graceHours: 24 });

    expect(res.removedOrphans).toBe(1);
    expect(res.removedExpired).toBe(1);
    expect(res.bytesFreed).toBe(Buffer.byteLength("orphan".repeat(10)) + 3);

    const left = (await readdir(dir)).sort();
    expect(left).toEqual(["keyed-new.json", "notes.txt", "orphan-new.json"]);

    // files row survives the disk delete (batch history keeps name/counts)
    const rows = await query<{ id: string }>(`SELECT id FROM files WHERE key = 'keyed-old.json'`);
    expect(rows.length).toBe(1);
    await query(`DELETE FROM files WHERE id = $1`, [fileId]);
    tempFileIds.pop();
  });

  it("idempotent: second run frees nothing", async () => {
    const dir = await tempDir();
    const stale = path.join(dir, "stale.json");
    await writeFile(stale, "gone");
    await age(stale, 5);
    const first = await sweepUploads({ dir, retentionDays: 90, graceHours: 24 });
    expect(first.removedOrphans).toBe(1);
    const second = await sweepUploads({ dir, retentionDays: 90, graceHours: 24 });
    expect(second).toEqual({ removedOrphans: 0, removedExpired: 0, bytesFreed: 0 });
    expect(await readdir(dir)).toEqual([]);
  });

  it("file older than grace but under retention with files row → kept", async () => {
    const dir = await tempDir();
    const p = path.join(dir, "mid.json");
    await writeFile(p, "kept");
    await age(p, 30);
    const fileId = randomUUID();
    tempFileIds.push(fileId);
    await query(
      `INSERT INTO files (id, entity_type, name, size, mime, bucket, key, uploaded_by)
       VALUES ($1, 'import', 'mid.json', 4, 'application/json', 'local', 'mid.json', $2)`,
      [fileId, admin.id],
    );
    const res = await sweepUploads({ dir, retentionDays: 90, graceHours: 24 });
    expect(res).toEqual({ removedOrphans: 0, removedExpired: 0, bytesFreed: 0 });
    expect((await stat(p)).isFile()).toBe(true);
    await query(`DELETE FROM files WHERE id = $1`, [fileId]);
    tempFileIds.pop();
  });
});
