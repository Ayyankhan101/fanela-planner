#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_KEY = "fanela_internal_production_planner_ops_v11";
const BASE_MS = Date.parse("2026-09-01T09:00:00Z");

let seq = 0;
const uid = (p) => `${p}-${String(++seq).padStart(4, "0")}`;
const iso = (days = 0, hour = 9) =>
  new Date(BASE_MS + days * 86400000 + (hour - 9) * 3600000).toISOString();
const day = (days = 0) => iso(days).slice(0, 10);

const SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];
const DEPARTMENTS = [
  "Warehouse",
  "Stencil Room",
  "Screen Print",
  "DTG",
  "Transfers / DTF",
  "Embroidery",
  "Sewing",
  "Packing",
  "Dispatch",
];
const STAGE_STATUSES = ["Waiting", "Ready", "In Progress", "Blocked", "Completed"];
const SWATCH_STATUSES = [
  "Waiting",
  "In Progress",
  "Awaiting Approval",
  "Approved",
  "Rejected",
  "Re-swatch Required",
];
const STOCK_ISSUES = ["Short", "Backorder", "Picking Error", "Damaged / Incorrect Stock"];

function emptyState(over = {}) {
  return {
    schemaVersion: 3,
    edition: "v11-operations",
    revision: 1,
    updatedAt: iso(0),
    currency: "GBP",
    customers: [],
    products: [],
    jobs: [],
    stockEvents: [],
    operationsEvents: [],
    ...over,
  };
}

function customer(n, over = {}) {
  return {
    id: uid("cust"),
    name: `Customer ${String(n).padStart(2, "0")}`,
    contactName: `Contact ${n}`,
    email: `contact${n}@example.test`,
    phone: `07700 900${String(n).padStart(3, "0")}`,
    defaultDispatchMethod: "Collection",
    address: `${n} High Street, Manchester M1 1AA`,
    dispatchAddress: `${n} High Street, Manchester M1 1AA`,
    accountReference: `ACC-${String(n).padStart(3, "0")}`,
    notes: "",
    createdAt: iso(0),
    updatedAt: iso(0),
    externalRefs: {},
    ...over,
  };
}

function product(sku, colour, size, over = {}) {
  return {
    id: uid("prod"),
    supplierSKU: `SUP-${sku}`,
    buyingCost: 4.5,
    sku,
    description: `${sku} ${colour}`,
    colour,
    size,
    unitPrice: 9.99,
    taxCode: "S-20",
    taxRate: 20,
    createdAt: iso(0),
    updatedAt: iso(0),
    externalRefs: {},
    ...over,
  };
}

function stockControl(over = {}) {
  return {
    stockOrdered: false,
    status: "",
    backorderDueDate: "",
    expectedDeliveryDate: "",
    ...over,
  };
}

function line(jobId, over = {}) {
  return {
    id: uid("line"),
    jobId,
    productId: over.productId ?? "",
    sku: "SKU-001",
    description: "Cotton T-Shirt",
    colour: "Navy",
    size: "M",
    quantity: 50,
    unitPrice: 9.99,
    taxCode: "S-20",
    taxRate: 20,
    receivedQuantity: 0,
    stockConfirmed: false,
    externalRefs: {},
    ...over,
    stockControl: stockControl(over.stockControl || {}),
  };
}

function stage(order, over = {}) {
  const s = {
    id: uid("stage"),
    order,
    department: "Screen Print",
    processDate: day(4),
    quantity: 50,
    completed: 0,
    speedPerHour: 350,
    setupMinutes: 5,
    status: "Waiting",
    notes: "",
    finishedAt: "",
    updatedAt: iso(1),
    waste: 0,
    reprint: 0,
    ...over,
  };
  if (s.status === "Completed" && !s.finishedAt) s.finishedAt = iso(6, 16);
  return s;
}

function attempt(status, over = {}) {
  const terminal = ["Approved", "Rejected", "Re-swatch Required"].includes(status);
  return {
    id: uid("swatch"),
    status,
    quantity: 1,
    notes: "",
    fileReference: "proof-v1.pdf",
    threadColours: "12",
    stitchCount: 8400,
    placement: "Front",
    machine: "Tajima 12",
    photos: [],
    startedBy: status === "Waiting" ? "" : "M. Embroider",
    startedAt: ["Waiting"].includes(status) ? "" : iso(5, 10),
    completedBy: terminal ? "M. Embroider" : "",
    completedAt: terminal ? iso(6, 15) : "",
    approvedBy: status === "Approved" ? "A. Director" : "",
    approvedAt: status === "Approved" ? iso(7, 11) : "",
    rejectionReason: status === "Rejected" ? "Thread colour mismatch vs Pantone 19-4052" : "",
    reswatchRequired: status === "Re-swatch Required",
    createdAt: iso(5, 9),
    ...over,
  };
}

function shipment(over = {}) {
  return {
    id: uid("ship"),
    method: "DPD",
    parcels: 1,
    tracking: "",
    consignment: "",
    parcelWeights: [12.4],
    serviceType: "Next Day",
    dispatchAddress: "10 Depot Road, Manchester M12 6AS",
    bookedBy: "D. Dispatcher",
    bookedAt: iso(8, 9),
    labels: 0,
    printRequests: 0,
    reprints: 0,
    labelPrinted: false,
    voided: false,
    voidReason: "",
    voidBy: "",
    voidAt: "",
    finalAt: "",
    source: "Manually recorded external booking",
    ...over,
  };
}

function dispatchState(over = {}) {
  return {
    method: "DPD",
    status: "Not Ready",
    notes: "",
    parcels: 0,
    tracking: "",
    consignment: "",
    collectionContact: "",
    collectionPhone: "",
    collectionDate: "",
    collectionTime: "",
    collectionConfirmed: false,
    courier: "",
    driverContact: "",
    collectionAt: "",
    deliveryETA: "",
    driver: "",
    routeNotes: "",
    departureTime: "",
    serviceType: "",
    contactPhone: "",
    contactEmail: "",
    deliveryInstructions: "",
    shipments: [],
    ...over,
  };
}

function job(customerObj, number, over = {}) {
  return {
    id: uid("job"),
    jobNumber: number,
    customer: customerObj.name,
    customerId: customerObj.id,
    quantity: 50,
    priority: "Normal",
    priorityNumber: 50,
    assignedStaff: "",
    processDate: day(4),
    dispatchDate: day(8),
    dispatchTime: "16:00",
    notes: "",
    createdAt: iso(0),
    updatedAt: iso(2),
    stages: [stage(1)],
    positions: ["Front"],
    skuLines: [],
    customerAddress: customerObj.address,
    dispatchAddress: customerObj.dispatchAddress,
    screensRequired: null,
    screensReady: 0,
    screensConfirmed: false,
    screensNotRequired: false,
    screensNotes: "",
    artworkReference: "proof-v1.pdf",
    artworkLink: "",
    artworkNotes: "",
    artworkFiles: [],
    artworkApproval: {
      proofReference: "proof-v1.pdf",
      version: "1",
      status: "Approved",
      pantoneNotes: "",
      approvedBy: "A. Director",
      approvedAt: iso(3, 12),
    },
    swatch: { required: false, attempts: [] },
    dispatch: dispatchState(),
    orderDate: day(0),
    orderType: "Bulk",
    contactName: customerObj.contactName,
    customerEmail: customerObj.email,
    customerPhone: customerObj.phone,
    customerPO: "",
    printName: "",
    currency: "GBP",
    externalRefs: {},
    stockControl: stockControl(),
    ...over,
  };
}

function stockEvent(j, lineOrNull, over = {}) {
  const ordered = lineOrNull ? lineOrNull.quantity : j.skuLines.reduce((a, l) => a + l.quantity, 0);
  const received = lineOrNull ? lineOrNull.receivedQuantity : j.skuLines.reduce((a, l) => a + l.receivedQuantity, 0);
  const st = lineOrNull
    ? lineOrNull.stockControl.status
    : j.stockControl.status;
  const derived = st || (received >= ordered && received > 0 ? "Complete" : received > 0 ? "Part Received" : "Not Ordered");
  const snapshot = {
    scope: lineOrNull ? "line" : "job",
    lineId: lineOrNull ? lineOrNull.id : null,
    sku: lineOrNull ? lineOrNull.sku : "",
    colour: lineOrNull ? lineOrNull.colour : "",
    size: lineOrNull ? lineOrNull.size : "",
    quantityOrdered: ordered,
    quantityReceived: received,
    quantityOutstanding: Math.max(0, ordered - received),
    confirmed: lineOrNull ? !!lineOrNull.stockConfirmed : j.skuLines.length > 0,
    stockOrdered: lineOrNull ? !!lineOrNull.stockControl.stockOrdered : !!j.stockControl.stockOrdered,
    status: derived,
    declaredStatus: st || "",
    backorderDueDate: (lineOrNull ? lineOrNull.stockControl.backorderDueDate : j.stockControl.backorderDueDate) || "",
    expectedDeliveryDate: (lineOrNull ? lineOrNull.stockControl.expectedDeliveryDate : j.stockControl.expectedDeliveryDate) || "",
  };
  const evt = {
    id: uid("sev"),
    jobId: j.id,
    jobNumber: j.jobNumber,
    lineId: lineOrNull ? lineOrNull.id : null,
    at: iso(5, 8),
    userId: "u-warehouse",
    user: "W. Handler",
    role: "Warehouse",
    kind: "update",
    correctsEventId: null,
    note: "Initial stock record",
    status: derived,
    quantityOrdered: ordered,
    quantityReceived: received,
    quantityOutstanding: Math.max(0, ordered - received),
    ...over,
    snapshot: { ...snapshot, ...(over.snapshot || {}) },
  };
  return evt;
}

function opsEvent(over) {
  return {
    id: uid("oev"),
    jobId: "",
    jobNumber: "",
    kind: "job-header",
    at: iso(2, 14),
    userId: "u-director",
    user: "A. Director",
    role: "Director",
    before: null,
    after: null,
    ...over,
  };
}

function dump(state) {
  return JSON.stringify({ [STATE_KEY]: JSON.stringify(state) }, null, 2) + "\n";
}

function makeLines(jobObj, rows, over = {}) {
  return rows.map((r) => line(jobObj.id, { ...over, ...r }));
}

const fx = {};

fx["fx-01-core-catalog"] = () => {
  const customers = [
    customer(1, { name: "Northwind Apparel" }),
    customer(2, { name: "NORTHWIND APPAREL" }),
    customer(3, { name: "Harbour Workwear" }),
    customer(4, { name: "Pine & Co Studios" }),
    customer(5, { name: "Red Kite Sports" }),
  ];
  const products = [];
  const skus = ["FAN-TEE-01", "FAN-TEE-02", "FAN-HOOD-01", "FAN-HOOD-02", "FAN-CAP-01", "FAN-SOCK-01", "FAN-TOTE-01", "FAN-POL-01", "FAN-ZIP-01", "FAN-BEAN-01"];
  const colours = ["Navy", "White", "Black", "Red", "Forest"];
  for (let i = 0; i < 15; i++) {
    products.push(product(skus[i % 10], colours[i % 5], SIZES[i % SIZES.length]));
  }
  return emptyState({ customers, products, revision: 3 });
};

fx["fx-02-happy-path"] = () => {
  const c = customer(1);
  const products = [
    product("FAN-TEE-01", "Navy", "M"),
    product("FAN-TEE-01", "Navy", "L"),
  ];
  const j = job(c, "HP-001", {
    quantity: 45,
    positions: ["Front", "Back", "Sleeve"],
    screensRequired: 3,
    screensReady: 3,
    screensConfirmed: true,
    swatch: { required: true, attempts: [attempt("Approved")] },
    stages: DEPARTMENTS.map((department, i) =>
      stage(i + 1, {
        department,
        quantity: 45,
        completed: 45,
        status: "Completed",
        processDate: day(3 + Math.floor(i / 3)),
        finishedAt: iso(6 + Math.floor(i / 3), 17),
      })
    ),
    dispatch: dispatchState({
      status: "Dispatched",
      parcels: 2,
      tracking: "DPD1234567890",
      consignment: "CON-77881",
      shipments: [
        shipment({
          tracking: "DPD1234567890",
          consignment: "CON-77881",
          labelPrinted: true,
          labels: 2,
          finalAt: iso(8, 16),
          parcels: 2,
        }),
      ],
    }),
  });
  j.skuLines = [
    line(j.id, {
      productId: products[0].id,
      sku: "FAN-TEE-01",
      colour: "Navy",
      size: "M",
      quantity: 20,
      receivedQuantity: 20,
      stockConfirmed: true,
      quantities: { XS: 5, S: 5, M: 5, L: 5, XL: 5, "2XL": 5, "3XL": 5, "4XL": 5, "5XL": 5 },
    }),
    line(j.id, {
      productId: products[1].id,
      sku: "FAN-TEE-01",
      colour: "Navy",
      size: "L",
      quantity: 25,
      receivedQuantity: 25,
      stockConfirmed: true,
    }),
  ];
  const state = emptyState({ customers: [c], products, revision: 7 });
  state.jobs = [j];
  state.stockEvents = [
    stockEvent(j, j.skuLines[0], { note: "Goods received and counted", kind: "update", at: iso(4, 11), snapshot: { quantityReceived: 20, quantityOutstanding: 0, confirmed: true, status: "Complete" } }),
  ];
  state.operationsEvents = [
    opsEvent({ jobId: j.id, jobNumber: j.jobNumber, kind: "job-header", after: { jobNumber: j.jobNumber, quantity: 45 } }),
  ];
  return state;
};

fx["fx-03-swatch-lifecycle"] = () => {
  const c = customer(2);
  const state = emptyState({ customers: [c], products: [product("FAN-EMB-01", "White", "M")], revision: 5 });
  state.jobs = SWATCH_STATUSES.map((status, i) => {
    const j = job(c, `SW-${String(i + 1).padStart(3, "0")}`, {
      quantity: 30,
      swatch: {
        required: true,
        attempts:
          status === "Re-swatch Required"
            ? [attempt("Approved"), attempt("Re-swatch Required")]
            : [attempt(status)],
      },
      stages: [
        stage(1, { department: "Embroidery", quantity: 30, completed: status === "Approved" ? 30 : 0, status: status === "Approved" ? "Completed" : "Waiting" }),
        stage(2, { department: "Packing", quantity: 30, completed: 0, status: "Waiting" }),
      ],
    });
    j.skuLines = makeLines(j, [{ sku: "FAN-EMB-01", colour: "White", size: "M", quantity: 30 }]);
    return j;
  });
  return state;
};

fx["fx-04-swatch-gate"] = () => {
  const c = customer(3);
  const state = emptyState({ customers: [c], products: [product("FAN-EMB-02", "Black", "L")], revision: 4 });
  const j = job(c, "SG-001", {
    quantity: 100,
    swatch: { required: true, attempts: [attempt("Awaiting Approval")] },
    stages: [
      stage(1, { department: "Embroidery", quantity: 100, completed: 0, status: "Waiting" }),
      stage(2, { department: "Packing", quantity: 100, completed: 0, status: "Waiting" }),
    ],
  });
  j.skuLines = makeLines(j, [{ sku: "FAN-EMB-02", colour: "Black", size: "L", quantity: 100 }]);
  state.jobs = [j];
  return state;
};

fx["fx-05-readiness-matrix"] = () => {
  const c = customer(4);
  const products = [product("FAN-TEE-09", "White", "M"), product("FAN-TEE-10", "Red", "M")];
  const state = emptyState({ customers: [c], products, revision: 6 });
  const mk = (number, over) => {
    const j = job(c, number, over);
    j.skuLines = (over.skuLines || []).map((r) => line(j.id, r));
    return j;
  };
  const white = mk("RD-001", {
    quantity: 20,
    screensNotRequired: true,
    swatch: { required: false, attempts: [] },
    stages: [stage(1, { department: "Screen Print", quantity: 20, completed: 0, status: "Waiting" })],
    skuLines: [],
  });
  const amber = mk("RD-002", {
    quantity: 40,
    screensRequired: 2,
    screensReady: 2,
    screensConfirmed: true,
    swatch: { required: false, attempts: [] },
    stages: [stage(1, { department: "Screen Print", quantity: 40, completed: 0, status: "Waiting" })],
    skuLines: [
      { sku: "FAN-TEE-09", colour: "White", size: "M", quantity: 40, receivedQuantity: 40, stockConfirmed: false },
    ],
  });
  const green = mk("RD-003", {
    quantity: 60,
    screensRequired: 2,
    screensReady: 2,
    screensConfirmed: true,
    swatch: { required: true, attempts: [attempt("Approved")] },
    stages: [stage(1, { department: "Embroidery", quantity: 60, completed: 0, status: "Waiting" })],
    skuLines: [
      { sku: "FAN-TEE-09", colour: "White", size: "M", quantity: 60, receivedQuantity: 60, stockConfirmed: true },
    ],
  });
  const issue = mk("RD-004", {
    quantity: 80,
    screensRequired: 2,
    screensReady: 2,
    screensConfirmed: true,
    swatch: { required: false, attempts: [] },
    stages: [stage(1, { department: "Screen Print", quantity: 80, completed: 0, status: "Waiting" })],
    skuLines: [
      {
        sku: "FAN-TEE-10",
        colour: "Red",
        size: "M",
        quantity: 80,
        receivedQuantity: 20,
        stockConfirmed: false,
        stockControl: stockControl({ status: "Short", backorderDueDate: day(12) }),
      },
    ],
  });
  const blank = mk("RD-005", {
    quantity: 15,
    screensRequired: null,
    screensReady: 0,
    screensConfirmed: false,
    screensNotRequired: false,
    swatch: { required: false, attempts: [] },
    stages: [stage(1, { department: "Screen Print", quantity: 15, completed: 0, status: "Waiting" })],
    skuLines: [
      { sku: "FAN-TEE-09", colour: "White", size: "M", quantity: 15, receivedQuantity: 15, stockConfirmed: true },
    ],
  });
  state.jobs = [white, amber, green, issue, blank];
  return state;
};

fx["fx-06-shipment-states"] = () => {
  const c = customer(5);
  const state = emptyState({ customers: [c], products: [product("FAN-TOTE-01", "Natural", "OS")], revision: 9 });
  const base = (number, method, over = {}) =>
    job(c, number, {
      quantity: 25,
      stages: [stage(1, { department: "Packing", quantity: 25, completed: 25, status: "Completed" })],
      dispatch: dispatchState({ method, ...over.dispatch }),
      ...over.job,
    });
  const draft = base("DS-001", "DPD");
  const arranged = base("DS-002", "DPD", {
    dispatch: { status: "Booking Arranged", consignment: "CON-9001", parcels: 1, shipments: [shipment({ consignment: "CON-9001", bookedBy: "D. Dispatcher" })] },
  });
  const booked = base("DS-003", "DPD", {
    dispatch: { status: "Booked", tracking: "DPD555000111", consignment: "CON-9002", parcels: 1, shipments: [shipment({ tracking: "DPD555000111", consignment: "CON-9002" })] },
  });
  const labels = base("DS-004", "DPD", {
    dispatch: { status: "Labels Printed", tracking: "DPD555000222", parcels: 1, shipments: [shipment({ tracking: "DPD555000222", labelPrinted: true, labels: 1, printRequests: 1 })] },
  });
  const dispatched = base("DS-005", "DPD", {
    dispatch: { status: "Dispatched", tracking: "DPD555000333", parcels: 1, shipments: [shipment({ tracking: "DPD555000333", labelPrinted: true, labels: 1, finalAt: iso(9, 17) })] },
  });
  const collected = base("DS-006", "Collection", {
    dispatch: { status: "Collected", method: "Collection", shipments: [shipment({ method: "Collection", finalAt: iso(9, 15), source: "Customer collection" })] },
  });
  const voided = base("DS-007", "DPD", {
    dispatch: { status: "Not Ready", parcels: 1, shipments: [shipment({ voided: true, voidReason: "Customer cancelled order", voidBy: "D. Dispatcher", voidAt: iso(9, 10) })] },
  });
  const part = base("DS-008", "DPD", {
    dispatch: {
      status: "Part Dispatched",
      parcels: 3,
      shipments: [
        shipment({ tracking: "DPD555000444", labelPrinted: true, labels: 2, finalAt: iso(9, 17), parcels: 2 }),
        shipment({ tracking: "DPD555000555", consignment: "CON-9005", parcels: 1 }),
      ],
    },
  });
  state.jobs = [draft, arranged, booked, labels, dispatched, collected, voided, part];
  return state;
};

fx["fx-07-stock-history"] = () => {
  const c = customer(1);
  const products = [product("FAN-HOOD-07", "Ash", "L"), product("FAN-HOOD-08", "Ash", "XL")];
  const state = emptyState({ customers: [c], products, revision: 11 });
  const events = [];
  const issueJobs = STOCK_ISSUES.map((issue, i) => {
    const j = job(c, `ST-00${i + 1}`, {
      quantity: 100,
      stages: [stage(1, { department: "Warehouse", quantity: 100, completed: 0, status: "Waiting" })],
      stockControl: stockControl({ status: issue, stockOrdered: true, backorderDueDate: day(15) }),
    });
    j.skuLines = makeLines(j, [
      { sku: "FAN-HOOD-07", colour: "Ash", size: i % 2 ? "XL" : "L", quantity: 100, receivedQuantity: i === 3 ? 120 : 40, stockConfirmed: false, stockControl: stockControl({ status: issue, stockOrdered: true }) },
    ]);
    events.push(stockEvent(j, j.skuLines[0], { kind: "update", note: `Stock issue recorded: ${issue}`, at: iso(6 + i, 10), status: issue, snapshot: { status: issue, declaredStatus: issue, quantityReceived: i === 3 ? 120 : 40 } }));
    return j;
  });
  const rec = job(c, "ST-101", {
    quantity: 50,
    stages: [stage(1, { department: "Warehouse", quantity: 50, completed: 0, status: "Waiting" })],
  });
  rec.skuLines = makeLines(rec, [
    { sku: "FAN-HOOD-07", colour: "Ash", size: "L", quantity: 50, receivedQuantity: 0, stockConfirmed: false },
  ]);
  const e1 = stockEvent(rec, rec.skuLines[0], { kind: "update", note: "Initial stock record", at: iso(4, 8), snapshot: { quantityReceived: 0, quantityOutstanding: 50, status: "Ordered", confirmed: false } });
  const e2 = stockEvent(rec, rec.skuLines[0], { kind: "update", note: "Goods received: 30 units", at: iso(5, 12), snapshot: { quantityReceived: 30, quantityOutstanding: 20, status: "Part Received", confirmed: false } });
  rec.skuLines[0].receivedQuantity = 30;
  const e3 = stockEvent(rec, rec.skuLines[0], { kind: "correction", correctsEventId: e2.id, note: "Correction: count was 25 not 30", at: iso(6, 9), snapshot: { quantityReceived: 25, quantityOutstanding: 25, status: "Part Received", confirmed: false } });
  const over = job(c, "ST-102", {
    quantity: 20,
    stages: [stage(1, { department: "Warehouse", quantity: 20, completed: 0, status: "Waiting" })],
  });
  over.skuLines = makeLines(over, [
    { sku: "FAN-HOOD-08", colour: "Ash", size: "XL", quantity: 20, receivedQuantity: 24, stockConfirmed: true },
  ]);
  const e4 = stockEvent(over, over.skuLines[0], { kind: "update", note: "Over-delivery: 24 received vs 20 ordered", at: iso(6, 14), snapshot: { quantityReceived: 24, quantityOutstanding: 0, status: "Complete", confirmed: true } });
  const gone = job(c, "ST-103", {
    quantity: 30,
    stages: [stage(1, { department: "Warehouse", quantity: 30, completed: 0, status: "Waiting" })],
  });
  gone.skuLines = makeLines(gone, [{ sku: "FAN-HOOD-07", colour: "Ash", size: "L", quantity: 30 }]);
  const e5 = stockEvent(gone, gone.skuLines[0], { kind: "line-removed", note: "Product line removed from the current order; earlier stock history retained.", at: iso(7, 10) });
  events.push(e1, e2, e3, e4, e5);
  state.jobs = [...issueJobs, rec, over, gone];
  state.stockEvents = events;
  return state;
};

fx["fx-08-audit-trail"] = () => {
  const c = customer(3);
  const state = emptyState({ customers: [c], products: [product("FAN-POL-01", "Royal", "M")], revision: 8 });
  const j = job(c, "AU-001", {
    quantity: 40,
    stages: [stage(1, { department: "Stencil Room", quantity: 40, completed: 0, status: "Waiting" })],
  });
  j.skuLines = makeLines(j, [{ sku: "FAN-POL-01", colour: "Royal", size: "M", quantity: 40, unitPrice: 9.99 }]);
  state.jobs = [j];
  state.operationsEvents = [
    opsEvent({ jobId: j.id, jobNumber: j.jobNumber, kind: "job-header", before: { priority: "Normal", processDate: day(4) }, after: { priority: "Urgent", processDate: day(3) } }),
    opsEvent({
      jobId: j.id,
      jobNumber: j.jobNumber,
      kind: "order-lines",
      before: { sku: "FAN-POL-01", quantity: 30, unitPrice: 8.5, buyingCost: 4.1 },
      after: { sku: "FAN-POL-01", quantity: 40, unitPrice: 9.99, buyingCost: 4.5 },
    }),
    opsEvent({ jobId: j.id, jobNumber: j.jobNumber, kind: "stage", before: { department: "Screen Print", status: "Waiting" }, after: { department: "Stencil Room", status: "In Progress" } }),
    opsEvent({ jobId: j.id, jobNumber: j.jobNumber, kind: "artwork", before: { status: "Draft" }, after: { status: "Approved", approvedBy: "A. Director" } }),
    opsEvent({ jobId: j.id, jobNumber: j.jobNumber, kind: "swatch", before: { status: "Waiting" }, after: { status: "Awaiting Approval" } }),
    opsEvent({ jobId: j.id, jobNumber: j.jobNumber, kind: "dispatch", before: { method: "Collection" }, after: { method: "DPD" } }),
    opsEvent({ jobId: j.id, jobNumber: j.jobNumber, kind: "stencil", before: { screensReady: 0 }, after: { screensReady: 2, screensRequired: 2 } }),
    opsEvent({ customerId: c.id, kind: "customer-master", before: { phone: "07700 900003" }, after: { phone: "07700 900111" } }),
  ];
  return state;
};

fx["fx-09-dirty-data"] = () => {
  const c = customer(4);
  const orphan = customer(9, { id: "cust-orphan-ref" });
  const state = emptyState({ customers: [c], products: [product("FAN-TEE-09", "White", "M")], revision: 2 });
  const dupA = job(c, "DN-1001", {
    quantity: 10,
    stages: [stage(1, { department: "Screen Print", quantity: 10, completed: 0, status: "Waiting" })],
  });
  dupA.skuLines = makeLines(dupA, [{ sku: "FAN-TEE-09", colour: "White", size: "M", quantity: 10 }]);
  const dupB = job(c, "DN-1001", {
    quantity: 15,
    processDate: "31/02/2026",
    dispatchDate: "not-a-date",
    customerId: "cust-ghost-404",
    stages: [stage(1, { department: "Packing", quantity: 15, completed: 0, status: "Waiting" })],
  });
  dupB.skuLines = makeLines(dupB, [{ sku: "", colour: "", size: "", quantity: 5 }]);
  const orphanJob = job(c, "DN-1002", {
    quantity: 12,
    customerId: orphan.id + "-missing",
    stages: [stage(1, { department: "Sewing", quantity: 12, completed: 0, status: "Waiting" })],
  });
  orphanJob.skuLines = makeLines(orphanJob, [{ sku: "FAN-TEE-09", colour: "White", size: "M", quantity: 12 }]);
  state.jobs = [dupA, dupB, orphanJob];
  return state;
};

fx["fx-10-500-jobs"] = () => {
  const customers = Array.from({ length: 20 }, (_, i) => customer(i + 1));
  const products = Array.from({ length: 10 }, (_, i) => product(`BULK-${String(i + 1).padStart(3, "0")}`, ["Navy", "White", "Black", "Red", "Forest"][i % 5], SIZES[i % SIZES.length]));
  const state = emptyState({ customers, products, revision: 40 });
  state.jobs = Array.from({ length: 500 }, (_, i) => {
    const c = customers[i % 20];
    const j = job(c, `BULK-${String(i + 1).padStart(4, "0")}`, {
      quantity: 10 + (i % 90),
      priority: ["Normal", "High", "Urgent"][i % 3],
      priorityNumber: [50, 30, 10][i % 3],
      processDate: day(4 + (i % 20)),
      dispatchDate: day(8 + (i % 20)),
      stages: [
        stage(1, { department: DEPARTMENTS[i % 9], quantity: 10 + (i % 90), completed: i % 5 === 0 ? 10 + (i % 90) : 0, status: i % 5 === 0 ? "Completed" : STAGE_STATUSES[i % 4] }),
        stage(2, { department: "Packing", quantity: 10 + (i % 90), completed: 0, status: "Waiting", processDate: day(6 + (i % 20)) }),
      ],
      screensRequired: i % 4 === 0 ? 1 : null,
      screensNotRequired: i % 4 !== 0,
      swatch: { required: i % 9 === 5, attempts: i % 9 === 5 ? [attempt(i % 2 ? "Approved" : "Awaiting Approval")] : [] },
    });
    j.skuLines = makeLines(j, [
      {
        sku: products[i % 10].sku,
        colour: products[i % 10].colour,
        size: products[i % 10].size,
        quantity: 10 + (i % 90),
        receivedQuantity: i % 3 === 0 ? 10 + (i % 90) : 0,
        stockConfirmed: i % 3 === 0,
      },
    ]);
    return j;
  });
  return state;
};

fx["fx-11-role-probe"] = () => {
  const c = customer(5, { name: "Role Probe Ltd" });
  const state = emptyState({ customers: [c], products: [product("FAN-PROBE-01", "Grey", "M")], revision: 12 });
  state.jobs = DEPARTMENTS.map((department, i) => {
    const j = job(c, `RP-${String(i + 1).padStart(2, "0")}`, {
      quantity: 5 + i,
      assignedStaff: "",
      stages: [stage(1, { department, quantity: 5 + i, completed: 0, status: STAGE_STATUSES[i % STAGE_STATUSES.length] })],
      swatch: { required: department === "Embroidery", attempts: department === "Embroidery" ? [attempt("Awaiting Approval")] : [] },
    });
    j.skuLines = makeLines(j, [{ sku: "FAN-PROBE-01", colour: "Grey", size: "M", quantity: 5 + i }]);
    return j;
  });
  return state;
};

mkdirSync(HERE, { recursive: true });
const names = Object.keys(fx);
for (const name of names) {
  const state = fx[name]();
  const path = join(HERE, `${name}.json`);
  const body = dump(state);
  writeFileSync(path, body);
  console.log(
    `${name.padEnd(24)} jobs=${String(state.jobs.length).padStart(3)} customers=${String(state.customers.length).padStart(2)} products=${String(state.products.length).padStart(3)} stockEvents=${String(state.stockEvents.length).padStart(3)} opsEvents=${String(state.operationsEvents.length).padStart(3)} ${(Buffer.byteLength(body) / 1024).toFixed(1)} KB`
  );
}
if (names.length !== 11) {
  console.error(`FAIL: expected 11 fixtures, generated ${names.length}`);
  process.exit(1);
}
console.log(`OK: ${names.length} fixtures written to ${HERE}`);
