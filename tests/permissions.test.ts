import { describe, it, expect } from "vitest";
import { ROLE_PERMISSIONS, PERMISSIONS, DEPARTMENTS, DEPARTMENT_SCOPED } from "@/lib/permissions";
import { can, hasPermission } from "@/lib/auth/access";
import type { SessionUser } from "@/lib/auth/session";

const user = (roles: string[], departments: string[] = []): SessionUser => ({
  id: "u",
  email: "t@t",
  name: "T",
  roles,
  departments,
  totpEnabled: false,
});

describe("permission catalogue", () => {
  it("is 20 permissions", () => {
    expect(PERMISSIONS.length).toBe(20);
    expect(new Set(PERMISSIONS).size).toBe(20);
  });

  it("7 roles exist", () => {
    expect(Object.keys(ROLE_PERMISSIONS)).toHaveLength(7);
  });

  it("only admin has users.manage", () => {
    expect(ROLE_PERMISSIONS.admin).toContain("users.manage");
    for (const r of Object.keys(ROLE_PERMISSIONS) as (keyof typeof ROLE_PERMISSIONS)[]) {
      if (r === "admin") continue;
      expect(ROLE_PERMISSIONS[r]).not.toContain("users.manage");
    }
  });

  it("costs: admin+ops enter; admin+ops+director view; office/dispatch/packing/dept never", () => {
    expect(ROLE_PERMISSIONS.admin).toContain("costs.enter");
    expect(ROLE_PERMISSIONS.ops).toContain("costs.enter");
    expect(ROLE_PERMISSIONS.director).not.toContain("costs.enter");
    expect(ROLE_PERMISSIONS.director).toContain("costs.view");
    for (const r of ["office", "dispatch", "packing", "dept"] as const) {
      expect(ROLE_PERMISSIONS[r]).not.toContain("costs.view");
      expect(ROLE_PERMISSIONS[r]).not.toContain("costs.enter");
    }
  });

  it("prices: only admin/ops/office/director", () => {
    for (const r of ["dispatch", "packing", "dept"] as const) {
      expect(ROLE_PERMISSIONS[r]).not.toContain("prices.view");
    }
  });

  it("artwork.approve + swatch.decide only admin/ops", () => {
    for (const r of ["office", "director", "dispatch", "packing", "dept"] as const) {
      expect(ROLE_PERMISSIONS[r]).not.toContain("artwork.approve");
      expect(ROLE_PERMISSIONS[r]).not.toContain("swatch.decide");
    }
  });

  it("dispatch.edit only admin/ops/dispatch", () => {
    expect(ROLE_PERMISSIONS.dispatch).toContain("dispatch.edit");
    expect(ROLE_PERMISSIONS.office).not.toContain("dispatch.edit");
    expect(ROLE_PERMISSIONS.packing).not.toContain("dispatch.edit");
  });
});

describe("department scoping (rule: dept role needs assignment)", () => {
  it("dept without warehouse cannot stock.edit", () => {
    expect(can(user(["dept"]), "stock.edit")).toBe(false);
  });
  it("dept with warehouse can stock.edit", () => {
    expect(can(user(["dept"], ["warehouse"]), "stock.edit")).toBe(true);
  });
  it("dept without embroidery cannot swatch.create", () => {
    expect(can(user(["dept"], ["print"]), "swatch.create")).toBe(false);
  });
  it("dept with embroidery can swatch.create", () => {
    expect(can(user(["dept"], ["embroidery"]), "swatch.create")).toBe(true);
  });
  it("ops can stage.update without department assignment", () => {
    expect(can(user(["ops"]), "stage.update")).toBe(true);
  });
  it("admin bypasses scoping", () => {
    expect(can(user(["admin"]), "stock.edit")).toBe(true);
  });
  it("every scoped permission has a department list", () => {
    for (const perm of Object.keys(DEPARTMENT_SCOPED)) {
      expect(PERMISSIONS).toContain(perm);
    }
  });
});

describe("hasPermission", () => {
  it("unions roles", () => {
    expect(hasPermission(user(["packing", "dispatch"]), "dispatch.edit")).toBe(true);
    expect(hasPermission(user(["packing", "dispatch"]), "costs.view")).toBe(false);
  });
});

describe("departments seed (9 keys)", () => {
  it("matches locked decision", () => {
    expect(DEPARTMENTS.map((d) => d.key)).toEqual([
      "print", "dtg", "dtf", "embroidery", "sewing", "screens", "warehouse", "packing", "dispatch",
    ]);
  });
});
