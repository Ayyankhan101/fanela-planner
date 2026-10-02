import { pgTable, uuid, text, boolean, index } from "drizzle-orm/pg-core";

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    legacyId: text("legacy_id").unique(),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    email: text("email"),
    phone: text("phone"),
    billingAddress: text("billing_address"),
    defaultDispatchAddress: text("default_dispatch_address"),
    defaultDispatchMethod: text("default_dispatch_method"),
    accountRef: text("account_ref"),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [index("customers_name_idx").on(t.name)],
);

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  legacyId: text("legacy_id").unique(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
});

export const productSkus = pgTable(
  "product_skus",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    legacyId: text("legacy_id").unique(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    masterSku: text("master_sku").notNull().unique(),
    supplierSku: text("supplier_sku"),
    colour: text("colour"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [index("product_skus_supplier_idx").on(t.supplierSku)],
);
