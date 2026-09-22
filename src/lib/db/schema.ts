/**
 * ── Drizzle schema: public (shared) tables ───────────────────────────────────
 * Mirrors db/migrations/20260921000000_neon_init.sql. Tenant data lives in
 * per-tenant Postgres schemas — those tables are built dynamically in
 * `src/lib/db/tenant.ts` via `pgTable` with `pgSchema`, which Drizzle supports.
 *
 * This module must stay side-effect free (no client creation) so it is safe to
 * import from anywhere, including drizzle-kit config.
 */
import {
  boolean,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ── Enums (public scope — shared by public and tenant tables) ────────────────
export const platformEnum = pgEnum("platform", [
  "shopify",
  "woocommerce",
  "stripe",
  "paypal",
  "salla",
  "custom",
]);
export const storeStatusEnum = pgEnum("store_status", [
  "connected",
  "syncing",
  "disconnected",
]);
export const orderStatusEnum = pgEnum("order_status", [
  "paid",
  "pending",
  "refunded",
  "partially_refunded",
  "cancelled",
]);
export const accountTypeEnum = pgEnum("account_type", [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
]);
export const normalBalanceEnum = pgEnum("normal_balance", ["debit", "credit"]);
export const entrySourceEnum = pgEnum("entry_source", [
  "order",
  "refund",
  "fee",
  "adjustment",
  "manual",
]);
export const entryStatusEnum = pgEnum("entry_status", ["draft", "posted"]);
export const eventStatusEnum = pgEnum("event_status", ["processed", "failed"]);

// ── Auth users (bcrypt hashes; auth handled by NextAuth v5) ──────────────────
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  disabled: boolean("disabled").notNull().default(false),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  fullName: text("full_name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** Postgres schema holding this tenant's data (tenant_<uuid-hex>). */
  schemaName: text("schema_name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantUsers = pgTable(
  "tenant_users",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("owner"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] })],
);

/** Maps every store to its tenant schema (read by webhooks + admin). */
export const storeRegistry = pgTable("store_registry", {
  storeId: uuid("store_id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  schemaName: text("schema_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Internal migration-tracking table written by scripts/apply-migrations.mjs. */
export const migrations = pgTable("_migrations", {
  name: text("name").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Row shapes inferred from the schema (used by repositories) ───────────────
export type UserRow = typeof users.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;
export type TenantRow = typeof tenants.$inferSelect;
export type TenantUserRow = typeof tenantUsers.$inferSelect;
export type StoreRegistryRow = typeof storeRegistry.$inferSelect;
