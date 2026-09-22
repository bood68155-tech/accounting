/**
 * ── Per-tenant Drizzle tables (schema-per-tenant isolation) ───────────────────
 * Every tenant owns a Postgres schema `tenant_<uuid-hex>` containing an
 * identical set of tables. Drizzle supports dynamic schemas via `pgSchema`, so
 * instead of string-splicing table names we build real, fully-typed table
 * objects per tenant schema and memoize them.
 *
 * Column names and types mirror db/migrations/20260921000000_neon_init.sql
 * (`create_tenant_schema()`), including `numeric(..., { mode: "number" })`
 * mapping so monetary amounts come back as JS numbers instead of strings.
 *
 * These tables are runtime-only: drizzle-kit is pointed at `./schema.ts`
 * (public tables) exclusively, so it never tries to manage tenant schemas —
 * they are provisioned by `public.create_tenant_schema()` in the SQL migration.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
  type PgSchema,
} from "drizzle-orm/pg-core";
import {
  accountTypeEnum,
  entrySourceEnum,
  entryStatusEnum,
  eventStatusEnum,
  normalBalanceEnum,
  orderStatusEnum,
  platformEnum,
  storeStatusEnum,
  users,
} from "./schema";

export const TENANT_SCHEMA_RE = /^tenant_[0-9a-f]{32}$/;

// One Drizzle schema object per tenant schema name, memoized.
const schemaCache = new Map<string, PgSchema>();

/** Get (or create) the Drizzle schema object for a tenant schema name. */
function tenantPgSchema(name: string): PgSchema {
  if (!TENANT_SCHEMA_RE.test(name)) {
    throw new Error(`Invalid tenant schema name: ${JSON.stringify(name)}`);
  }
  let schema = schemaCache.get(name);
  if (!schema) {
    schema = pgSchema(name);
    schemaCache.set(name, schema);
  }
  return schema;
}

// ── Shared column shorthands (explicit snake_case names) ─────────────────────
const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: "number" });
const bigMoney = (name: string) => numeric(name, { precision: 14, scale: 2, mode: "number" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/**
 * The typed tables inside one tenant schema. Use `getTenantTables(schema)` —
 * this function is memoized through it and not intended to be called directly:
 *
 *   const t = getTenantTables(schema);
 *   await db.select().from(t.orders).where(eq(t.orders.storeId, storeId));
 */
function buildTenantTables(name: string) {
  const s = tenantPgSchema(name);

  const stores = s.table(
    "stores",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
      name: text("name").notNull(),
      platform: platformEnum("platform").notNull(),
      domain: text("domain"),
      currency: text("currency").notNull().default("USD"),
      status: storeStatusEnum("status").notNull().default("connected"),
      config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [unique("stores_user_id_domain_key").on(t.userId, t.domain)],
  );

  const products = s.table(
    "products",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      storeId: uuid("store_id")
        .notNull()
        .references(() => stores.id, { onDelete: "cascade" }),
      externalId: text("external_id"),
      sku: text("sku").notNull(),
      name: text("name").notNull(),
      unitCost: money("unit_cost").notNull().default(0),
      unitPrice: money("unit_price").notNull().default(0),
      createdAt: createdAt(),
      updatedAt: updatedAt(),
    },
    (t) => [unique("products_store_id_sku_key").on(t.storeId, t.sku)],
  );

  const orders = s.table(
    "orders",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      storeId: uuid("store_id")
        .notNull()
        .references(() => stores.id, { onDelete: "cascade" }),
      externalId: text("external_id").notNull(),
      orderNumber: text("order_number").notNull(),
      customerName: text("customer_name"),
      currency: text("currency").notNull().default("USD"),
      subtotal: money("subtotal").notNull().default(0),
      shippingAmount: money("shipping_amount").notNull().default(0),
      discountAmount: money("discount_amount").notNull().default(0),
      taxAmount: money("tax_amount").notNull().default(0),
      totalAmount: money("total_amount").notNull().default(0),
      paymentGateway: text("payment_gateway").notNull().default("unknown"),
      paymentFee: money("payment_fee").notNull().default(0),
      shippingCost: money("shipping_cost").notNull().default(0),
      refundAmount: money("refund_amount").notNull().default(0),
      status: orderStatusEnum("status").notNull().default("pending"),
      orderedAt: timestamp("ordered_at", { withTimezone: true }).notNull().defaultNow(),
      raw: jsonb("raw").$type<Record<string, unknown> | null>(),
      entryNumbers: integer("entry_numbers")
        .array()
        .notNull()
        .default(sql`'{}'::integer[]`),
      createdAt: createdAt(),
    },
    (t) => [
      unique("orders_store_id_external_id_key").on(t.storeId, t.externalId),
      index("orders_store_ordered_idx").on(t.storeId, t.orderedAt.desc()),
    ],
  );

  const orderItems = s.table("order_items", {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitPrice: money("unit_price").notNull().default(0),
    unitCost: money("unit_cost").notNull().default(0),
    lineSubtotal: money("line_subtotal").notNull().default(0),
    lineCost: money("line_cost").notNull().default(0),
    createdAt: createdAt(),
  });

  const ledgerAccounts = s.table(
    "ledger_accounts",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      storeId: uuid("store_id")
        .notNull()
        .references(() => stores.id, { onDelete: "cascade" }),
      code: text("code").notNull(),
      name: text("name").notNull(),
      type: accountTypeEnum("type").notNull(),
      normalBalance: normalBalanceEnum("normal_balance").notNull(),
      isSystem: boolean("is_system").notNull().default(false),
      description: text("description"),
      createdAt: createdAt(),
    },
    (t) => [unique("ledger_accounts_store_id_code_key").on(t.storeId, t.code)],
  );

  const journalEntries = s.table(
    "journal_entries",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      storeId: uuid("store_id")
        .notNull()
        .references(() => stores.id, { onDelete: "cascade" }),
      entryNumber: integer("entry_number").notNull(),
      entryDate: date("entry_date").notNull(),
      description: text("description").notNull(),
      reference: text("reference"),
      source: entrySourceEnum("source").notNull().default("manual"),
      status: entryStatusEnum("status").notNull().default("posted"),
      createdBy: uuid("created_by").references(() => users.id),
      createdAt: createdAt(),
      postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      unique("journal_entries_store_id_entry_number_key").on(t.storeId, t.entryNumber),
      index("journal_entries_store_date_idx").on(t.storeId, t.entryDate),
    ],
  );

  const journalLines = s.table(
    "journal_lines",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      entryId: uuid("entry_id")
        .notNull()
        .references(() => journalEntries.id, { onDelete: "cascade" }),
      accountCode: text("account_code").notNull(),
      accountName: text("account_name").notNull(),
      accountType: accountTypeEnum("account_type").notNull(),
      description: text("description"),
      debit: bigMoney("debit").notNull().default(0),
      credit: bigMoney("credit").notNull().default(0),
    },
    (t) => [index("journal_lines_entry_idx").on(t.entryId)],
  );

  const integrationEvents = s.table(
    "integration_events",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      storeId: uuid("store_id")
        .notNull()
        .references(() => stores.id, { onDelete: "cascade" }),
      provider: text("provider").notNull(),
      eventType: text("event_type").notNull(),
      payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
      status: eventStatusEnum("status").notNull().default("processed"),
      error: text("error"),
      processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index("integration_events_store_idx").on(t.storeId, t.processedAt.desc())],
  );

  return {
    stores,
    products,
    orders,
    orderItems,
    ledgerAccounts,
    journalEntries,
    journalLines,
    integrationEvents,
  };
}

// ── Memoization ───────────────────────────────────────────────────────────────
const tablesCache = new Map<string, ReturnType<typeof buildTenantTables>>();

/** Typed tenant tables for a tenant schema name, memoized per schema. */
export function getTenantTables(name: string): ReturnType<typeof buildTenantTables> {
  let tables = tablesCache.get(name);
  if (!tables) {
    tables = buildTenantTables(name);
    tablesCache.set(name, tables);
  }
  return tables;
}

export type TenantTables = ReturnType<typeof buildTenantTables>;

// ── Row shapes inferred from the schema ──────────────────────────────────────
export type TenantStoreRow = TenantTables["stores"]["$inferSelect"];
export type TenantProductRow = TenantTables["products"]["$inferSelect"];
export type TenantOrderRow = TenantTables["orders"]["$inferSelect"];
export type TenantOrderItemRow = TenantTables["orderItems"]["$inferSelect"];
export type TenantJournalEntryRow = TenantTables["journalEntries"]["$inferSelect"];
export type TenantJournalLineRow = TenantTables["journalLines"]["$inferSelect"];
export type TenantEventRow = TenantTables["integrationEvents"]["$inferSelect"];
