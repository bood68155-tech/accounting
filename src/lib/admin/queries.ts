import { desc } from "drizzle-orm";
import {
  isDatabaseConfigured,
  isTenantSchema,
  requireDb,
  publicSchema,
  tenantDb,
  getTenantTables,
} from "@/lib/db";
import {
  aggregateAdminData,
  summarizeEvents,
  type RawEvent,
  type RawOrder,
  type RawProduct,
  type RawProfile,
  type RawStore,
  type RawUser,
} from "@/lib/admin/aggregate";
import type {
  AdminData,
  AdminEvent,
  AdminOverview,
  AdminStore,
  AdminUser,
  FeeBreakdown,
} from "@/lib/admin/types";

// ─── Admin repository ─────────────────────────────────────────────────────────
// The admin console spans every tenant. It reads shared metadata (users,
// profiles, tenants) from the `public` schema and then aggregates each
// tenant's stores/orders/products/events from its own schema (this module is
// server-only; tenant scoping is enforced by schema-qualified Drizzle tables).

function toIso(value: Date | string | null): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export async function fetchAdminData(): Promise<AdminData> {
  if (!isDatabaseConfigured()) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const db = requireDb();
  const { users, profiles, tenants } = publicSchema;

  const userRows = await db
    .select({
      id: users.id,
      email: users.email,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
      disabled: users.disabled,
    })
    .from(users)
    .orderBy(users.createdAt);
  const profileRows = await db
    .select({ id: profiles.id, fullName: profiles.fullName, avatarUrl: profiles.avatarUrl })
    .from(profiles);
  const tenantRows = await db
    .select({ id: tenants.id, schemaName: tenants.schemaName })
    .from(tenants);

  const mappedUsers: RawUser[] = userRows.map((u) => ({
    id: u.id,
    email: u.email,
    created_at: toIso(u.createdAt),
    last_sign_in_at: u.lastLoginAt ? toIso(u.lastLoginAt) : null,
    // Reuse the existing "banned" concept: disabled accounts are flagged as banned.
    banned_until: u.disabled ? "9999-12-31T23:59:59Z" : null,
  }));

  const rawProfiles: RawProfile[] = profileRows.map((row) => ({
    id: row.id,
    full_name: row.fullName ?? null,
    avatar_url: row.avatarUrl ?? null,
  }));

  const stores: RawStore[] = [];
  const orders: RawOrder[] = [];
  const products: RawProduct[] = [];
  const events: RawEvent[] = [];

  // Aggregate each tenant's schema.
  for (const tenant of tenantRows) {
    const schema = tenant.schemaName;
    if (!schema || !isTenantSchema(schema)) continue;

    const t = getTenantTables(schema);
    const tdb = tenantDb(schema);

    const [tenantStores, tenantProducts, tenantOrders, tenantEvents] = await Promise.all([
      tdb
        .select({
          id: t.stores.id,
          userId: t.stores.userId,
          name: t.stores.name,
          platform: t.stores.platform,
          domain: t.stores.domain,
          currency: t.stores.currency,
          status: t.stores.status,
          createdAt: t.stores.createdAt,
        })
        .from(t.stores),
      tdb.select({ id: t.products.id, storeId: t.products.storeId }).from(t.products),
      tdb
        .select({
          storeId: t.orders.storeId,
          paymentGateway: t.orders.paymentGateway,
          totalAmount: t.orders.totalAmount,
          refundAmount: t.orders.refundAmount,
          paymentFee: t.orders.paymentFee,
          orderedAt: t.orders.orderedAt,
        })
        .from(t.orders),
      tdb
        .select({
          id: t.integrationEvents.id,
          storeId: t.integrationEvents.storeId,
          provider: t.integrationEvents.provider,
          eventType: t.integrationEvents.eventType,
          status: t.integrationEvents.status,
          error: t.integrationEvents.error,
          processedAt: t.integrationEvents.processedAt,
        })
        .from(t.integrationEvents)
        .orderBy(desc(t.integrationEvents.processedAt))
        .limit(500),
    ]);

    stores.push(
      ...tenantStores.map((s) => ({
        id: s.id,
        user_id: s.userId,
        name: s.name,
        platform: s.platform,
        domain: s.domain,
        currency: s.currency,
        status: s.status,
        created_at: toIso(s.createdAt),
      })),
    );
    products.push(...tenantProducts.map((p) => ({ id: p.id, store_id: p.storeId })));
    orders.push(
      ...tenantOrders.map((row) => ({
        store_id: row.storeId,
        payment_gateway: row.paymentGateway,
        total_amount: row.totalAmount,
        refund_amount: row.refundAmount,
        payment_fee: row.paymentFee,
        ordered_at: toIso(row.orderedAt),
      })),
    );
    events.push(
      ...tenantEvents.map((row) => ({
        id: row.id,
        store_id: row.storeId,
        provider: row.provider,
        event_type: row.eventType,
        status: row.status,
        error: row.error ?? null,
        processed_at: toIso(row.processedAt),
      })),
    );
  }

  return aggregateAdminData({
    users: mappedUsers,
    profiles: rawProfiles,
    stores,
    orders,
    products,
    events,
  });
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  return (await fetchAdminData()).users;
}

export async function fetchAdminStores(): Promise<AdminStore[]> {
  return (await fetchAdminData()).stores;
}

export async function fetchAdminEvents(): Promise<{
  events: AdminEvent[];
  summary: ReturnType<typeof summarizeEvents>;
}> {
  const data = await fetchAdminData();
  return { events: data.events, summary: summarizeEvents(data.events) };
}

export async function fetchAdminOverview(): Promise<AdminOverview> {
  return (await fetchAdminData()).overview;
}

export async function fetchAdminFees(): Promise<FeeBreakdown> {
  return (await fetchAdminData()).fees;
}
