import { randomUUID } from "node:crypto";
import { query, withTransaction } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { audit } from "./audit";
import { emitNotification } from "./notifications";
import { CODE_FORBIDDEN, CODE_NOT_FOUND, CODE_STALE_JOB, CODE_VALIDATION_ERROR } from "@/lib/errors";

// Artwork approval machine (A1–A5): Draft → Awaiting Approval → Approved | Rejected;
// revise Approved/Rejected → NEW version at Draft (A3), rejected record never rewritten.

export type ArtworkPatchInput = {
  action?: "submit" | "withdraw" | "approve" | "reject" | "revise";
  reason?: string;
  proofRef?: string;
  pantoneNotes?: string;
  version: number; // current artwork version for optimistic lock (spec §9)
};

type ArtworkState = {
  artwork_id: string;
  version_row_id: string;
  version: number;
  status: string;
  proof_ref: string | null;
  pantone_notes: string | null;
  approved_by: string | null;
};

async function loadArtwork(jobId: string): Promise<ArtworkState | null> {
  const rows = await query<ArtworkState>(
    `SELECT a.id AS artwork_id, v.id AS version_row_id, v.version, v.status, v.proof_ref,
            v.pantone_notes, v.approved_by
       FROM artworks a JOIN artwork_versions v ON v.id = a.current_version_id
      WHERE a.job_id = $1`,
    [jobId],
  );
  return rows[0] ?? null;
}

async function ensureArtwork(jobId: string, user: SessionUser | null): Promise<void> {
  const existing = await query(`SELECT id FROM artworks WHERE job_id = $1`, [jobId]);
  if (existing[0]) return;
  const artworkId = randomUUID();
  const versionId = randomUUID();
  await query(`INSERT INTO artworks (id, job_id, kind, current_version_id) VALUES ($1,$2,$3,$4)`, [
    artworkId,
    jobId,
    "print",
    versionId,
  ]);
  await query(
    `INSERT INTO artwork_versions (id, artwork_id, version, status, created_by) VALUES ($1,$2,1,'draft',$3)`,
    [versionId, artworkId, user?.id ?? null],
  );
}

export async function getArtwork(jobId: string, user: SessionUser | null): Promise<Record<string, unknown> | null> {
  await ensureArtwork(jobId, user);
  const st = await loadArtwork(jobId);
  if (!st) return null;
  const versions = await query(
    `SELECT v.id, v.version, v.status, v.proof_ref, v.pantone_notes, v.approved_by,
            to_char(v.approved_at, 'YYYY-MM-DD"T"HH24:MI:SSZ') AS approved_at,
            to_char(v.created_at, 'YYYY-MM-DD"T"HH24:MI:SSZ') AS created_at
       FROM artworks a JOIN artwork_versions v ON v.artwork_id = a.id
      WHERE a.job_id = $1 ORDER BY v.version`,
    [jobId],
  );
  const events = await query(
    `SELECT e.action, e.reason, e.before, e.after, to_char(e.ts, 'YYYY-MM-DD"T"HH24:MI:SSZ') AS ts
       FROM artwork_events e
      WHERE e.artwork_version_id IN (SELECT id FROM artwork_versions WHERE artwork_id = (SELECT id FROM artworks WHERE job_id = $1))
      ORDER BY e.ts`,
    [jobId],
  );
  return { ...st, versions, events };
}

async function writeArtworkEvent(versionRowId: string, action: string, user: SessionUser, reason: string | null, before: unknown, after: unknown): Promise<void> {
  await query(
    `INSERT INTO artwork_events (artwork_version_id, action, actor, reason, before, after) VALUES ($1,$2,$3,$4,$5,$6)`,
    [versionRowId, action, user.id, reason, JSON.stringify(before ?? null), JSON.stringify(after ?? null)],
  );
}

// [7A] atomic site — revise (new version + current pointer + events + audit) in one tx.
export function patchArtwork(jobId: string, input: ArtworkPatchInput, user: SessionUser): Promise<number> {
  return withTransaction(() => patchArtworkTx(jobId, input, user));
}

async function patchArtworkTx(jobId: string, input: ArtworkPatchInput, user: SessionUser): Promise<number> {
  // A2: approve / revise / any artwork mutation — Admin + Operations only (artwork.approve)
  const isApprover = user.roles.includes("admin") || user.roles.includes("ops");
  if (!isApprover) throw { status: 403, message: "Artwork changes require Admin or Operations.", code: CODE_FORBIDDEN };

  await ensureArtwork(jobId, user);
  const st = await loadArtwork(jobId);
  if (!st) throw { status: 404, message: "Artwork not found.", code: CODE_NOT_FOUND };
  if (Number(st.version) !== input.version) {
    throw { status: 409, message: "Artwork changed since you loaded it. Reload and retry.", code: CODE_STALE_JOB };
  }

  const before = { status: st.status, proofRef: st.proof_ref, pantoneNotes: st.pantone_notes, version: st.version };

  if (input.action == null) {
    // metadata edit allowed on draft/awaiting only — approved record immutable until revised (A3)
    if (st.status === "approved" || st.status === "rejected") {
      throw { status: 422, message: "Approved/rejected artwork is fixed. Revise to create a new version.", code: CODE_VALIDATION_ERROR };
    }
    await query(
      `UPDATE artwork_versions SET proof_ref = $1, pantone_notes = $2 WHERE id = $3 AND version = $4`,
      [input.proofRef ?? st.proof_ref, input.pantoneNotes ?? st.pantone_notes, st.version_row_id, input.version],
    );
    const after = await loadArtwork(jobId);
    await writeArtworkEvent(st.version_row_id, "update", user, input.reason ?? null, before, after);
    await audit({ entityType: "artwork", entityId: st.version_row_id, jobId, action: "artwork", user, before, after });
    return Number(after?.version ?? st.version);
  }

  const valid =
    (input.action === "submit" && st.status === "draft") ||
    (input.action === "withdraw" && st.status === "awaiting") ||
    (input.action === "approve" && st.status === "awaiting") ||
    (input.action === "reject" && st.status === "awaiting") ||
    (input.action === "revise" && (st.status === "approved" || st.status === "rejected"));
  if (!valid) {
    throw { status: 422, message: `Invalid artwork transition: ${st.status} → ${input.action}.`, code: CODE_VALIDATION_ERROR };
  }
  if ((input.action === "reject" || input.action === "revise") && !input.reason?.trim()) {
    throw { status: 422, message: "A reason is required.", code: CODE_VALIDATION_ERROR };
  }

  if (input.action === "revise") {
    // A3: new version at Draft, approver cleared, old record untouched (Rejected never rewritten)
    const next = await query<{ n: string }>(`SELECT coalesce(max(version),0)::int + 1 AS n FROM artwork_versions WHERE artwork_id = $1`, [st.artwork_id]);
    const nextVersion = Number(next[0].n);
    const versionId = randomUUID();
    await query(
      `INSERT INTO artwork_versions (id, artwork_id, version, status, proof_ref, pantone_notes, created_by)
       VALUES ($1,$2,$3,'draft',$4,$5,$6)`,
      [versionId, st.artwork_id, nextVersion, st.proof_ref, st.pantone_notes, user.id],
    );
    await query(`UPDATE artworks SET current_version_id = $1 WHERE id = $2`, [versionId, st.artwork_id]);
    const after = await loadArtwork(jobId);
    await writeArtworkEvent(versionId, "revise", user, input.reason ?? null, before, after);
    await audit({ entityType: "artwork", entityId: versionId, jobId, action: "artwork", user, before, after });
    return Number(after?.version ?? nextVersion);
  }

  const updates: Record<string, unknown> = { status: input.action === "submit" ? "awaiting" : input.action === "withdraw" ? "draft" : input.action === "approve" ? "approved" : "rejected" };
  if (input.action === "approve") {
    updates.approved_by = user.id;
    updates.approved_at = new Date().toISOString();
  }
  if (input.action === "reject" || input.action === "approve" || input.action === "submit") {
    if (input.proofRef !== undefined) updates.proof_ref = input.proofRef;
    if (input.pantoneNotes !== undefined) updates.pantone_notes = input.pantoneNotes;
  }
  const p: unknown[] = [st.version_row_id];
  const sets = Object.entries(updates).map(([k, v]) => {
    p.push(v);
    return `${k} = $${p.length}`;
  });
  const res = await query<{ n: string }>(
    `UPDATE artwork_versions SET ${sets.join(", ")} WHERE id = $1 AND version = ${Number(input.version)} RETURNING 'x' AS n`,
    p,
  );
  if (!res.length) throw { status: 409, message: "Artwork changed since you loaded it. Reload and retry.", code: CODE_STALE_JOB };

  const after = await loadArtwork(jobId);
  await writeArtworkEvent(st.version_row_id, input.action, user, input.reason ?? null, before, after);
  await audit({ entityType: "artwork", entityId: st.version_row_id, jobId, action: "artwork", user, before, after });
  if (input.action === "submit") {
    await emitNotification({
      kind: "artwork_awaiting",
      title: "Artwork awaiting approval",
      body: `Version ${Number(after?.version ?? st.version)} proof submitted for approval.`,
      jobId,
      roles: ["admin", "ops"],
      actorId: user.id,
    });
  }
  return Number(after?.version ?? st.version);
}
