// Permission catalogue — single source for UI buttons AND API checks (spec §8).
// role_permissions seed maps these to the 7 roles exactly as phase0/04 matrix.

export const PERMISSIONS = [
  "users.manage", // Admin: users, roles, backups
  "customers.view",
  "customers.edit",
  "customers.update_master", // deliberate audited master update
  "jobs.view",
  "jobs.edit", // create/edit jobs (not cost fields)
  "jobs.plan_dispatch", // Office: planned method + address only
  "costs.enter",
  "costs.view", // Admin, Ops, Director(reports)
  "prices.view", // authorised commercial: Admin, Ops, Office, Director
  "artwork.approve", // Admin, Ops
  "swatch.create", // Admin, Ops + dept (embroidery scoped in service layer)
  "swatch.decide", // Admin, Ops (approve/reject/waive)
  "stage.update", // Admin, Ops + dept (own department scoped)
  "dispatch.edit", // Admin, Ops, Dispatch
  "import.export", // Excel import/export: Admin, Ops, Office
  "import.costs", // buying-cost import: Admin, Ops
  "import.swatch_waive", // Admin, Ops
  "audit.view",
  "stock.edit", // Admin, Ops + dept (warehouse scoped)
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type RoleKey = "admin" | "ops" | "office" | "director" | "dispatch" | "packing" | "dept";

// matrix phase0/04 Part A (Y/Y*/L rows; dept scoping enforced separately)
export const ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  admin: [...PERMISSIONS],
  ops: PERMISSIONS.filter((p) => p !== "users.manage"),
  office: [
    "customers.view", "customers.edit", "jobs.view", "jobs.edit", "jobs.plan_dispatch",
    "prices.view", "import.export", "audit.view",
  ],
  director: ["customers.view", "jobs.view", "costs.view", "prices.view", "audit.view"],
  dispatch: ["customers.view", "jobs.view", "dispatch.edit", "audit.view"],
  packing: ["customers.view", "jobs.view", "audit.view"],
  // Department Operator: granted broadly here; service layer scopes by department assignment
  dept: ["jobs.view", "stage.update", "swatch.create", "stock.edit", "audit.view"],
};

export const DEPARTMENTS = [
  { key: "print", name: "Screen Print" },
  { key: "dtg", name: "DTG" },
  { key: "dtf", name: "Transfers / DTF" },
  { key: "embroidery", name: "Embroidery" },
  { key: "sewing", name: "Sewing" },
  { key: "screens", name: "Stencil Room" },
  { key: "warehouse", name: "Warehouse" },
  { key: "packing", name: "Packing" },
  { key: "dispatch", name: "Dispatch" },
] as const;

export type DepartmentKey = (typeof DEPARTMENTS)[number]["key"];

// dept-scoped permissions: require this department assignment when role = dept
export const DEPARTMENT_SCOPED: Partial<Record<Permission, DepartmentKey[]>> = {
  "stage.update": ["print", "dtg", "dtf", "embroidery", "sewing", "screens", "warehouse", "packing", "dispatch"],
  "swatch.create": ["embroidery"],
  "stock.edit": ["warehouse"],
};
