#!/usr/bin/env node
// Phase 0 data-quality analysis for Fanela backups.
// Usage: node analyze-backup.mjs <backup.json>
// Accepts: full localStorage dump | v11 state object | Backup-button {version,jobs} | raw jobs array

import { readFileSync } from "node:fs";

const STATE_KEYS = [
  "fanela_internal_production_planner_ops_v11",
  "fanela_internal_production_planner_stock_v9",
  "fanela_internal_production_planner_excel_v8",
  "fanela_internal_production_planner_v10",
  "fanela_internal_production_planner_v9",
  "fanela_internal_production_planner_v8",
  "fanela_internal_production_planner_v7",
  "fanela_internal_production_planner_v6",
  "fanela_internal_production_planner_v5",
  "fanela_internal_production_planner_v4",
  "fanela_production_planner_v3",
  "fanela_multi_department_planner_v2",
  "fanela_daily_planner_v1",
];

const path = process.argv[2];
if (!path) {
  console.error("Usage: node analyze-backup.mjs <backup.json>");
  process.exit(1);
}
const raw = JSON.parse(readFileSync(path, "utf8"));

// ---- resolve shape -------------------------------------------------------
let shape, state, jobs, customers, products, stockEvents, opsEvents, accounts, usedKey;
if (Array.isArray(raw)) {
  shape = "raw jobs array";
  jobs = raw;
} else if (raw.jobs && (raw.schemaVersion || raw.customers || raw.products)) {
  shape = "v11 state object";
  state = raw;
} else if (raw.jobs) {
  shape = "Backup-button export {version,jobs} — MISSING customers/products/stockEvents/operationsEvents";
  jobs = raw.jobs;
} else if (typeof raw === "object" && Object.values(raw).every((v) => typeof v === "string")) {
  shape = "full localStorage dump";
  for (const k of STATE_KEYS) {
    if (raw[k]) {
      state = JSON.parse(raw[k]);
      usedKey = k;
      break;
    }
  }
  if (!state) {
    // accept any key holding a parseable object with jobs
    for (const [k, v] of Object.entries(raw)) {
      try {
        const p = JSON.parse(v);
        if (p && Array.isArray(p.jobs)) {
          state = p;
          usedKey = k;
          break;
        }
      } catch {}
    }
  }
  if (!state) {
    console.error("No planner state found in dump. Keys present:\n" + Object.keys(raw).join("\n"));
    process.exit(1);
  }
  for (const [k, v] of Object.entries(raw)) {
    if (k.endsWith("_accounts")) {
      try { accounts = JSON.parse(v); } catch {}
    }
  }
} else {
  console.error("Unrecognised JSON shape. Expected jobs array, state object, {jobs}, or localStorage dump.");
  process.exit(1);
}

jobs = state?.jobs ?? jobs ?? [];
customers = state?.customers ?? [];
products = state?.products ?? [];
stockEvents = state?.stockEvents ?? [];
opsEvents = state?.operationsEvents ?? [];

// ---- helpers -------------------------------------------------------------
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const count = (v) => Math.max(0, Math.floor(num(v)));
const byStatus = (arr) =>
  arr.reduce((m, x) => ((m[x.status ?? "(none)"] = (m[x.status ?? "(none)"] || 0) + 1), m), {});
const dupes = (arr, keyFn) => {
  const seen = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (k == null || k === "") continue;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k, n]) => `${k} ×${n}`);
};
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));

const stageDone = (s) => s.status === "Completed" || (count(s.quantity) > 0 && count(s.completed) >= count(s.quantity));
const jobComplete = (j) => Array.isArray(j.stages) && j.stages.length > 0 && j.stages.every(stageDone);

// ---- gather --------------------------------------------------------------
const lines = jobs.flatMap((j) => (Array.isArray(j.skuLines) ? j.skuLines : []));
const stages = jobs.flatMap((j) => (Array.isArray(j.stages) ? j.stages : []));
const attempts = jobs.flatMap((j) => (j.swatch?.attempts || []));
const shipments = jobs.flatMap((j) => (j.dispatch?.shipments || []));
const positions = jobs.flatMap((j) => (Array.isArray(j.positions) ? j.positions : []));
const jobNumbers = jobs.map((j) => j.jobNumber ?? "");
const custNames = customers.map((c) => String(c.name ?? "").trim().toLowerCase());
const orphanCust = jobs.filter((j) => j.customerId && !customers.some((c) => c.id === j.customerId));
const orphanLines = lines.filter((l) => !l.sku);
const badDates = jobs.filter((j) => (j.processDate && !isDate(j.processDate)) || (j.dispatchDate && !isDate(j.dispatchDate)) || (j.orderDate && !isDate(j.orderDate)));
const blankScreens = jobs.filter((j) => j.screensRequired == null || j.screensRequired === "");
const embJobs = jobs.filter((j) => (j.stages || []).some((s) => s.department === "Embroidery"));
const terminalAttempts = attempts.filter((a) => ["Approved", "Rejected", "Re-swatch Required"].includes(a.status));
const legacyKeysPresent = Array.isArray(raw) || raw.jobs ? [] : Object.keys(raw).filter((k) => STATE_KEYS.includes(k));

// ---- report --------------------------------------------------------------
const out = [];
out.push(`# Data-quality analysis — ${path}`);
out.push("");
out.push(`- Detected shape: **${shape}**` + (usedKey ? ` (state key: \`${usedKey}\`)` : ""));
out.push(`- schemaVersion: **${state?.schemaVersion ?? "(absent — legacy backup)"}**` + (state?.schemaVersion && state.schemaVersion > 3 ? " ⚠ NEWER THAN SUPPORTED" : ""));
out.push(`- edition: ${state?.edition ?? "n/a"} | revision: ${state?.revision ?? "n/a"} | updatedAt: ${state?.updatedAt ?? "n/a"}`);
out.push(`- Legacy keys in dump: ${legacyKeysPresent.length ? legacyKeysPresent.join(", ") : "none"}`);
if (shape.startsWith("Backup-button")) out.push("- ⚠ **F9: stockEvents/operationsEvents/customers/products absent — obtain full localStorage dump (see 05 report §0).**");
out.push("");
out.push("## Counts");
out.push("");
out.push("| Entity | Count |");
out.push("|---|---:|");
out.push(`| Customers | ${customers.length} |`);
out.push(`| Products (catalog) | ${products.length} |`);
out.push(`| Jobs total | ${jobs.length} |`);
out.push(`| — complete (all stages done) | ${jobs.filter(jobComplete).length} |`);
out.push(`| — open | ${jobs.filter((j) => !jobComplete(j)).length} |`);
out.push(`| — archived flag | ${jobs.filter((j) => j.archived).length} |`);
out.push(`| Job lines | ${lines.length} |`);
out.push(`| Stages | ${stages.length} |`);
out.push(`| Print position entries | ${positions.length} |`);
out.push(`| Swatch attempts | ${attempts.length} |`);
out.push(`| Shipments | ${shipments.length} |`);
out.push(`| Stock events | ${stockEvents.length}${state ? "" : " (absent)"} |`);
out.push(`| Operational audit events | ${opsEvents.length}${state ? "" : " (absent)"} |`);
out.push(`| Accounts | ${accounts?.length ?? "(not in file)"} |`);
out.push("");
out.push("### Swatch attempts by status");
out.push("");
const st = byStatus(attempts);
out.push(Object.keys(st).length ? Object.entries(st).map(([k, n]) => `- ${k}: ${n}`).join("\n") : "- none");
out.push("");
out.push("### Shipments by void flag");
out.push("");
out.push(`- voided: ${shipments.filter((s) => s.voided).length} | not voided: ${shipments.filter((s) => !s.voided).length}`);
out.push(`- with final dispatch (${"finalAt"}): ${shipments.filter((s) => s.finalAt).length}`);
out.push("");
out.push("### Audit events by kind");
out.push("");
const kinds = opsEvents.reduce((m, e) => ((m[e.kind ?? "(none)"] = (m[e.kind ?? "(none)"] || 0) + 1), m), {});
out.push(Object.keys(kinds).length ? Object.entries(kinds).map(([k, n]) => `- ${k}: ${n}`).join("\n") : "- none (jobs-only file)");
out.push("");
out.push("## Gate-relevant populations");
out.push("");
out.push(`- Jobs with Embroidery stage (swatch gate): **${embJobs.length}**`);
out.push(`  - of which swatch required: ${embJobs.filter((j) => j.swatch?.required).length}`);
out.push(`  - of which latest attempt Approved: ${embJobs.filter((j) => (j.swatch?.attempts || []).at(-1)?.status === "Approved").length}`);
out.push(`- Jobs with blank screens required (null): **${blankScreens.length}** ← open item 3 population`);
out.push(`- Jobs with screensNotRequired: ${jobs.filter((j) => j.screensNotRequired === true).length}`);
out.push("");
out.push("## Quality issues");
out.push("");
const issue = (label, arr, fmt = (x) => x) =>
  out.push(`- ${label}: ${arr.length ? `**${arr.length}** → ${arr.slice(0, 20).map(fmt).join("; ")}${arr.length > 20 ? " …" : ""}` : "0 ✓"}`);
issue("Duplicate job numbers", dupes(jobNumbers, (x) => String(x).trim()).filter(() => true), (x) => x);
const dupJobs = dupes(jobs, (j) => String(j.jobNumber ?? "").trim());
out[out.length - 1] = `- Duplicate job numbers: ${dupJobs.length ? `**${dupJobs.length}** → ${dupJobs.slice(0, 20).join("; ")}` : "0 ✓"}`;
const dupCust = [...new Set(custNames)].filter((n) => n && custNames.filter((x) => x === n).length > 1);
out.push(`- Duplicate customers (case-insensitive): ${dupCust.length ? `**${dupCust.length}** → ${dupCust.slice(0, 20).join("; ")}` : "0 ✓"}`);
const catKeys = lines.map((l) => `${(l.sku || "").toLowerCase()}|${(l.colour || "").toLowerCase()}|${(l.size || "").toLowerCase()}`);
const dupCatNames = [...new Set(catKeys)].filter((k) => k !== "||" && catKeys.filter((x) => x === k).length > 1);
out.push(`- Duplicate SKU/colour/size line combos: ${dupCatNames.length ? `**${dupCatNames.length}** distinct keys repeated` : "0 ✓"}`);
out.push(`- Jobs with missing/blank job number: ${jobs.filter((j) => !String(j.jobNumber ?? "").trim()).length || "0 ✓"}`);
out.push(`- Jobs referencing missing customer id: ${orphanCust.length ? `**${orphanCust.length}** (rebuildable via linkCatalogs)` : "0 ✓"}`);
out.push(`- Lines without SKU: ${orphanLines.length || "0 ✓"}`);
out.push(`- Jobs with invalid date fields: ${badDates.length ? `**${badDates.length}** → ${badDates.slice(0, 10).map((j) => j.jobNumber).join("; ")}` : "0 ✓"}`);
out.push(`- Non-integer quantities (lines): ${lines.filter((l) => !Number.isInteger(num(l.quantity))).length || "0 ✓"} (negative received = valid over-delivery, not flagged)`);
out.push(`- Terminal swatch attempts (must migrate bit-identical, immutable): **${terminalAttempts.length}**`);
out.push("");
out.push("## Verdict");
out.push("");
if (shape.startsWith("Backup-button")) {
  out.push("**REJECT as migration source** — obtain full localStorage dump (F9). Use this file only as cross-check.");
} else if (!state?.schemaVersion) {
  out.push("Legacy shape (no schemaVersion) — run through prototype `migrateState` first or map manually per 06-migration-mapping.");
} else {
  out.push(`Usable as migration source (schemaVersion ${state.schemaVersion}). Resolve every issue above before dry run.`);
}
console.log(out.join("\n"));
