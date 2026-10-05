// C6 rule-ID coverage meta-test: every phase0/01 register rule ID must be referenced in
// some test file or the ops runbook. First-real-import drift audit stays a separate task.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REGISTER = join(process.cwd(), "docs", "phase0", "01-rule-register.md");
const RUNBOOK = join(process.cwd(), "docs", "ops", "runbook.md");
const TESTS_DIR = join(process.cwd(), "tests");
const SELF = "rule-coverage.test.ts";

// Documented exceptions (C6 audit 2026-10-06): rule has no as-built surface — not just a missing tag.
const EXCEPTIONS: Record<string, string> = {
  D6: "total-prints formula is v11-only; new system has no surface or test (register row corrected)",
};

const registerText = readFileSync(REGISTER, "utf8");
const ids = [...registerText.matchAll(/^\| ([A-Z]\d+) \|/gm)].map((m) => m[1]);

const corpus = [
  ...readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith(".test.ts") && f !== SELF)
    .map((f) => readFileSync(join(TESTS_DIR, f), "utf8")),
  readFileSync(RUNBOOK, "utf8"),
].join("\n");

describe("C6 — rule-ID coverage (register ↔ tests + runbook)", () => {
  it("parses all 77 register rule IDs, no duplicates", () => {
    expect(ids.length).toBe(77);
    expect(new Set(ids).size).toBe(77);
  });

  it("every register ID referenced in tests or runbook (except documented exceptions)", () => {
    const missing = ids.filter((id) => !Object.hasOwn(EXCEPTIONS, id) && !new RegExp(`\\b${id}\\b`).test(corpus));
    expect(missing).toEqual([]);
  });

  it("no stale exceptions", () => {
    for (const id of Object.keys(EXCEPTIONS)) expect(ids).toContain(id);
  });
});
