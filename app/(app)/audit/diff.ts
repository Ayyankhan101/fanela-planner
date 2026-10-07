// Pure audit-diff helpers for the audit log UI (Details column).
// before/after arrive as parsed jsonb objects from node-pg; strings tolerated defensively.

export type Change = { field: string; from: unknown; to: unknown };

// already shown in their own columns
const SKIP = new Set(["id", "job_id"]);

const ACTION_LABELS: Record<string, string> = {
  "job-header": "Job header",
  "order-lines": "Order lines",
  "customer-master": "Customer master",
  swatch: "Swatch",
  dispatch: "Dispatch",
  artwork: "Artwork",
  stage: "Stage",
  stencil: "Stencil",
};

export function humanizeAction(action: string): string {
  return ACTION_LABELS[action] ?? action.charAt(0).toUpperCase() + action.slice(1);
}

export function fieldLabel(key: string): string {
  const spaced = key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

export function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    if (ISO_RE.test(v)) return v.replace("T", " ").slice(0, 16);
    if (UUID_RE.test(v)) return v.slice(0, 8) + "…";
    return v;
  }
  return JSON.stringify(v);
}

function parse(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    try {
      const p: unknown = JSON.parse(raw);
      return p !== null && typeof p === "object" ? (p as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

export function diffAudit(beforeRaw: unknown, afterRaw: unknown): Change[] {
  const before = parse(beforeRaw);
  const after = parse(afterRaw);
  const changes: Change[] = [];

  if (before && after) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const k of keys) {
      if (SKIP.has(k)) continue;
      if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
        changes.push({ field: k, from: before[k], to: after[k] });
      }
    }
  } else if (after) {
    for (const [k, v] of Object.entries(after)) {
      if (SKIP.has(k) || v === null) continue;
      changes.push({ field: k, from: null, to: v });
    }
  } else if (before) {
    for (const [k, v] of Object.entries(before)) {
      if (SKIP.has(k) || v === null) continue;
      changes.push({ field: k, from: v, to: null });
    }
  }

  return changes;
}
