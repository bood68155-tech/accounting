import { isSupabaseConfigured } from "@/lib/data/config";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  aggregateAdminData,
  summarizeEvents,
  type RawEvent,
  type RawOrder,
  type RawProfile,
  type RawStore,
  type RawUser,
} from "@/lib/admin/aggregate";
import { getDemoAdminData } from "@/lib/admin/demo";
import type {
  AdminData,
  AdminEvent,
  AdminOverview,
  AdminStore,
  AdminUser,
  FeeBreakdown,
} from "@/lib/admin/types";

// ─── Admin repository ─────────────────────────────────────────────────────────
// Live mode reads the whole platform through the service-role client (bypasses
// RLS); demo mode returns the deterministic sample dataset. Falls back to demo
// data whenever the live query fails (e.g. schema not migrated yet).

export async function fetchAdminData(): Promise<AdminData> {
  if (!isSupabaseConfigured()) return getDemoAdminData();

  try {
    const supabase = createAdminClient();

    const { data: usersPage, error: usersError } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (usersError) throw new Error(usersError.message);

    const [profilesRes, storesRes, productsRes, ordersRes, eventsRes] = await Promise.all([
      supabase.from("profiles").select("id, full_name, avatar_url"),
      supabase.from("stores").select("id, user_id, name, platform, domain, currency, status, created_at"),
      supabase.from("products").select("id, store_id"),
      supabase.from("orders").select("store_id, payment_gateway, total_amount, refund_amount, payment_fee, ordered_at"),
      supabase
        .from("integration_events")
        .select("id, store_id, provider, event_type, status, error, processed_at")
        .order("processed_at", { ascending: false })
        .limit(500),
    ]);

    if (profilesRes.error) throw new Error(profilesRes.error.message);
    if (storesRes.error) throw new Error(storesRes.error.message);
    if (productsRes.error) throw new Error(productsRes.error.message);
    if (ordersRes.error) throw new Error(ordersRes.error.message);
    if (eventsRes.error) throw new Error(eventsRes.error.message);

    const users: RawUser[] = (usersPage?.users ?? []).map((u) => ({
      id: u.id,
      email: u.email ?? "",
      created_at: u.created_at ?? new Date().toISOString(),
      last_sign_in_at: u.last_sign_in_at ?? null,
      banned_until: u.banned_until ?? null,
    }));

    const profiles: RawProfile[] = (profilesRes.data ?? []).map((row) => ({
      id: row.id,
      full_name: row.full_name,
      avatar_url: row.avatar_url,
    }));

    const stores: RawStore[] = (storesRes.data ?? []).map((row) => ({
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      platform: row.platform,
      domain: row.domain,
      currency: row.currency,
      status: row.status,
      created_at: row.created_at,
    }));

    const orders: RawOrder[] = (ordersRes.data ?? []).map((row) => ({
      store_id: row.store_id,
      payment_gateway: row.payment_gateway,
      total_amount: Number(row.total_amount),
      refund_amount: Number(row.refund_amount),
      payment_fee: Number(row.payment_fee),
      ordered_at: row.ordered_at,
    }));

    const events: RawEvent[] = (eventsRes.data ?? []).map((row) => ({
      id: row.id,
      store_id: row.store_id,
      provider: row.provider,
      event_type: row.event_type,
      status: row.status,
      error: row.error,
      processed_at: row.processed_at,
    }));

    return aggregateAdminData({
      demo: false,
      users,
      profiles,
      stores,
      orders,
      products: (productsRes.data ?? []).map((row) => ({ id: row.id, store_id: row.store_id })),
      events,
    });
  } catch {
    return getDemoAdminData();
  }
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
