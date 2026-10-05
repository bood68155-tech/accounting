/**
 * ── Drizzle schema: public (shared) tables ───────────────────────────────────
 * Mirrors db/migrations/20260921000000_neon_init.sql. Tenant data lives in
 * per-tenant Postgres schemas — those tables are built dynamically in
 * `src/lib/db/tenant.ts` via `pgTable` with `pgSchema`, which Drizzle supports.
 *
 * This module must stay side-effect free (no client creation) so it is safe to
 * import from anywhere, including drizzle-kit config.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
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
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trial",
  "active",
  "past_due",
  "cancelled",
]);
export const discountTypeEnum = pgEnum("discount_type", ["percent", "fixed"]);
export const couponDurationEnum = pgEnum("coupon_duration", [
  "once",
  "repeating",
  "forever",
]);

// ── Auth users (bcrypt hashes; auth handled by NextAuth v5) ──────────────────
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  /** Nullable: Google-OAuth users have no local password. */
  passwordHash: text("password_hash"),
  /** Name/email-verified state mirrored from the OAuth provider when present. */
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  /** Latest Telegram chat verified through the bot auth flow. */
  telegramChatId: text("telegram_chat_id").unique(),
  /** Phone number shared during Telegram verification (E.164-ish). */
  phoneNumber: text("phone_number"),
  disabled: boolean("disabled").notNull().default(false),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** NextAuth OAuth account links (provider ↔ user), e.g. Google. */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    accessToken: text("access_token"),
    tokenType: text("token_type"),
    scope: text("scope"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("accounts_provider_account_key").on(t.provider, t.providerAccountId)],
);

/** 6-digit email one-time passcodes (signup/login/password-reset verification). */
export const otpCodes = pgTable(
  "otp_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    /** bcrypt hash of the 6-digit code — plaintext only ever lives in the email. */
    codeHash: text("code_hash").notNull(),
    purpose: text("purpose").notNull().default("signup"), // 'signup' | 'login'
    attempts: integer("attempts").notNull().default(0),
    consumed: boolean("consumed").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("otp_codes_email_created_idx").on(t.email, t.createdAt.desc())],
);

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

// ── Billing: plans, subscriptions, coupons, audit log (admin console) ────────

/** Plan tier with first-month / recurring monthly pricing. */
/**
 * ── Telegram link tokens ────────────────────────────────────────────────────
 * Shared lookup for the `/start <token>` deep-link handshake. Telegram inbound
 * webhooks carry no session and therefore no tenant context, so the
 * token → tenant mapping has to live in the public schema for the same reason
 * `store_registry` does: to resolve an owning tenant from an inbound request.
 *
 * Only the SHA-256 hash of the token is stored, so a leaked row cannot be
 * replayed as a working deep link.
 */
export const telegramLinkTokens = pgTable(
  "telegram_link_tokens",
  {
    /** SHA-256 hex of the token — never the token itself. */
    tokenHash: text("token_hash").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Denormalized so binding needs a single query, not a join. */
    schemaName: text("schema_name").notNull(),
    storeId: uuid("store_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    boundChatId: text("bound_chat_id"),
    boundChatTitle: text("bound_chat_title"),
  },
  (t) => [
    // One live token per store: re-minting replaces the previous one.
    unique("telegram_link_tokens_store_key").on(t.schemaName, t.storeId),
    index("telegram_link_tokens_expires_idx").on(t.expiresAt),
  ],
);

/**
 * Telegram bot authentication sessions & the verified chat mapping.
 *
 * An inbound Telegram webhook carries no tenant context, so the
 * phone_number + email → telegram_chat_id mapping lives in the public
 * schema (like telegram_link_tokens). `state` tracks which step of the
 * contact → email → PIN flow the chat is on, because webhooks are
 * stateless and Telegram gives the bot no other session storage.
 */
export const telegramSessions = pgTable(
  "telegram_sessions",
  {
    chatId: text("chat_id").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    phoneNumber: text("phone_number"),
    email: text("email"),
    isVerified: boolean("is_verified").notNull().default(false),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /** awaiting_phone | awaiting_email | awaiting_pin | verified */
    state: text("state").notNull().default("awaiting_phone"),
    /** Failed PIN attempts; AUTH_MAX_ATTEMPTS locks the chat. */
    attempts: integer("attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("telegram_sessions_user_idx").on(t.userId).where(sql`is_verified`),
    index("telegram_sessions_phone_idx").on(t.phoneNumber).where(sql`is_verified`),
    index("telegram_sessions_email_idx").on(t.email).where(sql`is_verified`),
  ],
);

export const subscriptionPlans = pgTable("subscription_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  /** First-month price — 0 for the "first month free" pattern. */
  firstMonthPrice: numeric("first_month_price", { precision: 12, scale: 2, mode: "number" })
    .notNull()
    .default(0),
  monthlyPrice: numeric("monthly_price", { precision: 12, scale: 2, mode: "number" })
    .notNull()
    .default(30),
  currency: text("currency").notNull().default("USD"),
  trialDays: integer("trial_days").notNull().default(14),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Per-user subscription with optional price overrides (null = plan price). */
export const userSubscriptions = pgTable("user_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").references(() => subscriptionPlans.id, { onDelete: "set null" }),
  status: subscriptionStatusEnum("status").notNull().default("trial"),
  monthlyPrice: numeric("monthly_price", { precision: 12, scale: 2, mode: "number" }),
  firstMonthPrice: numeric("first_month_price", { precision: 12, scale: 2, mode: "number" }),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull().defaultNow(),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  couponCode: text("coupon_code"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Percent/fixed discount code — global or bound to a single user. */
export const coupons = pgTable(
  "coupons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    description: text("description"),
    discountType: discountTypeEnum("discount_type").notNull(),
    discountValue: numeric("discount_value", { precision: 12, scale: 2, mode: "number" }).notNull(),
    /** Null = global coupon; otherwise redeemable by this user only. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    maxRedemptions: integer("max_redemptions"),
    timesUsed: integer("times_used").notNull().default(0),
    duration: couponDurationEnum("duration").notNull().default("once"),
    /** Months the discount repeats (only for `repeating`). */
    durationMonths: integer("duration_months"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("coupons_user_idx").on(t.userId)],
);

/** Discount usage history — one row per redeemed coupon. */
export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    couponId: uuid("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    discountAmount: numeric("discount_amount", { precision: 12, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("coupon_redemptions_coupon_idx").on(t.couponId, t.redeemedAt.desc())],
);

/** Admin-console change history — who changed what, when. */
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("admin_audit_log_created_idx").on(t.createdAt.desc())],
);

/** Internal migration-tracking table written by scripts/apply-migrations.mjs. */
export const migrations = pgTable("_migrations", {
  name: text("name").primaryKey(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Row shapes inferred from the schema (used by repositories) ───────────────
export type UserRow = typeof users.$inferSelect;
export type AccountRow = typeof accounts.$inferSelect;
export type OtpCodeRow = typeof otpCodes.$inferSelect;
export type ProfileRow = typeof profiles.$inferSelect;
export type TenantRow = typeof tenants.$inferSelect;
export type TenantUserRow = typeof tenantUsers.$inferSelect;
export type StoreRegistryRow = typeof storeRegistry.$inferSelect;
export type SubscriptionPlanRow = typeof subscriptionPlans.$inferSelect;
export type UserSubscriptionRow = typeof userSubscriptions.$inferSelect;
export type CouponRow = typeof coupons.$inferSelect;
export type CouponRedemptionRow = typeof couponRedemptions.$inferSelect;
export type AdminAuditLogRow = typeof adminAuditLog.$inferSelect;
export type TelegramSessionRow = typeof telegramSessions.$inferSelect;
