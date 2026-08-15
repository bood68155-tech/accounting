import { createAdminClient } from "@/lib/supabase/admin";
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
// The admin console spans every tenant. It reads shared metadata (auth users,
// profiles, tenants) from the `public` schema and then aggregates each tenant's
// stores/orders/products/events from its own schema via the service role
// (which bypasses RLS — this module is server-only).

interface TenantRow {
  id: string;
  schema_name: string | null;
}

async function fetchTenants(): Promise<TenantRow[]> {
  const { data, error } = await createAdminClient()
    .from("tenants")
    .select("id, schema_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as TenantRow[];
}

export async function fetchAdminData(): Promise<AdminData> {
  const supabase = createAdminClient();

  const { data: usersPage, error: usersError } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (usersError) throw new Error(usersError.message);

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url");
  if (profilesError) throw new Error(profilesError.message);

  const tenants = await fetchTenants();

  const users: RawUser[] = (usersPage?.users ?? []).map((u) => ({
    id: u.id,
    email: u.email ?? "",
    created_at: u.created_at ?? new Date().toISOString(),
    last_sign_in_at: u.last_sign_in_at ?? null,
    banned_until: u.banned_until ?? null,
  }));

  const rawProfiles: RawProfile[] = (profiles ?? []).map((row) => ({
    id: row.id,
    full_name: row.full_name,
    avatar_url: row.avatar_url,
  }));

  const stores: RawStore[] = [];
  const orders: RawOrder[] = [];
  const products: RawProduct[] = [];
  const events: RawEvent[] = [];

  // Aggregate each tenant's schema with a dedicated service-role client.
  for (const tenant of tenants) {
    if (!tenant.schema_name) continue;
    const tenantDb = createAdminClient(tenant.schema_name);

    const [storesRes, productsRes, ordersRes, eventsRes] = await Promise.all([
      tenantDb.from("stores").select("id, user_id, name, platform, domain, currency, status, created_at"),
      tenantDb.from("products").select("id, store_id"),
      tenantDb
        .from("orders")
        .select("store_id, payment_gateway, total_amount, refund_amount, payment_fee, ordered_at"),
      tenantDb
        .from("integration_events")
        .select("id, store_id, provider, event_type, status, error, processed_at")
        .order("processed_at", { ascending: false })
        .limit(500),
    ]);

    if (storesRes.error) throw new Error(storesRes.error.message);
    if (productsRes.error) throw new Error(productsRes.error.message);
    if (ordersRes.error) throw new Error(ordersRes.error.message);
    if (eventsRes.error) throw new Error(eventsRes.error.message);

    stores.push(...((storesRes.data ?? []) as RawStore[]));
    products.push(...((productsRes.data ?? []) as RawProduct[]));
    orders.push(
      ...((ordersRes.data ?? []) as unknown as RawOrder[]).map((row) => ({
        store_id: row.store_id,
        payment_gateway: row.payment_gateway,
        total_amount: Number(row.total_amount),
        refund_amount: Number(row.refund_amount),
        payment_fee: Number(row.payment_fee),
        ordered_at: row.ordered_at,
      })),
    );
    events.push(...((eventsRes.data ?? []) as RawEvent[]));
  }

  return aggregateAdminData({
    users,
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
