import type {
  AdminClient,
  AdminData,
  AdminEvent,
  AdminOverview,
  AdminStore,
  AdminUser,
  FeeBreakdown,
  GatewayFeeRow,
  MonthlyFeePoint,
  SubscriptionStatus,
} from "@/lib/admin/types";
import type { Platform, StoreStatus } from "@/types";
import { round2 } from "@/lib/utils";

// ─── Raw row shapes (Supabase rows or demo fixtures) ──────────────────────────

export interface RawUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  banned_until: string | null;
}

export interface RawProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
}

export interface RawStore {
  id: string;
  user_id: string;
  name: string;
  platform: Platform;
  domain: string | null;
  currency: string;
  status: StoreStatus;
  created_at: string;
}

export interface RawOrder {
  store_id: string;
  payment_gateway: string;
  total_amount: number;
  refund_amount: number;
  payment_fee: number;
  ordered_at: string;
}

export interface RawProduct {
  id: string;
  store_id: string;
}

export interface RawEvent {
  id: string;
  store_id: string;
  provider: string;
  event_type: string;
  status: "processed" | "failed";
  error: string | null;
  processed_at: string;
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Number of days without activity before a user is considered inactive. */
const INACTIVE_THRESHOLD_DAYS = 30;
/** Number of days a user gets "trial" status after signup with no stores. */
const TRIAL_THRESHOLD_DAYS = 14;

/**
 * Derive subscription status from user activity and store data.
 * - active: has stores with orders in the last 30 days
 * - trial: signed up within last 14 days with no stores connected
 * - inactive: no recent activity (30+ days) or no stores
 * - expired: inactive for 90+ days
 */
function deriveSubscriptionStatus(
  lastSignInAt: string | null,
  createdAt: string,
  storeCount: number,
  orderCount: number,
  latestOrderAt: string | null,
): SubscriptionStatus {
  const now = Date.now();
  const daysSinceLastSignIn = lastSignInAt
    ? (now - new Date(lastSignInAt).getTime()) / 86_400_000
    : Infinity;
  const daysSinceSignup = (now - new Date(createdAt).getTime()) / 86_400_000;
  const daysSinceLastOrder = latestOrderAt
    ? (now - new Date(latestOrderAt).getTime()) / 86_400_000
    : Infinity;

  // Expired: inactive for 90+ days
  if (daysSinceLastSignIn > 90 && daysSinceLastOrder > 90) return "expired";

  // Inactive: no recent activity or no stores with orders
  if (daysSinceLastSignIn > INACTIVE_THRESHOLD_DAYS || (storeCount === 0 && orderCount === 0)) {
    // But still in trial period
    if (daysSinceSignup <= TRIAL_THRESHOLD_DAYS && storeCount === 0) return "trial";
    return "inactive";
  }

  // Trial: signed up recently with no stores
  if (daysSinceSignup <= TRIAL_THRESHOLD_DAYS && storeCount === 0) return "trial";

  // Active: has recent sign-in and stores/orders
  if (storeCount > 0 || orderCount > 0) return "active";

  return "inactive";
}

export function summarizeEvents(events: AdminEvent[]) {
  const byProvider = new Map<string, { provider: string; total: number; failed: number }>();
  for (const event of events) {
    const entry = byProvider.get(event.provider) ?? { provider: event.provider, total: 0, failed: 0 };
    entry.total += 1;
    if (event.status === "failed") entry.failed += 1;
    byProvider.set(event.provider, entry);
  }
  const failed = events.filter((e) => e.status === "failed").length;
  return {
    total: events.length,
    processed: events.length - failed,
    failed,
    by_provider: [...byProvider.values()].sort((a, b) => b.total - a.total),
  };
}

function computeFeeBreakdown(orders: RawOrder[]): FeeBreakdown {
  const byGateway = new Map<string, { gateway: string; order_count: number; gross_volume: number; fee_amount: number }>();
  const monthlyMap = new Map<string, { orders: number; volume: number; fees: number }>();

  for (const order of orders) {
    const gateway = order.payment_gateway || "Unknown";
    const volume = order.total_amount - order.refund_amount;

    const g = byGateway.get(gateway) ?? { gateway, order_count: 0, gross_volume: 0, fee_amount: 0 };
    g.order_count += 1;
    g.gross_volume += volume;
    g.fee_amount += order.payment_fee;
    byGateway.set(gateway, g);

    const key = order.ordered_at.slice(0, 7); // YYYY-MM
    const m = monthlyMap.get(key) ?? { orders: 0, volume: 0, fees: 0 };
    m.orders += 1;
    m.volume += volume;
    m.fees += order.payment_fee;
    monthlyMap.set(key, m);
  }

  const totalVolume = [...byGateway.values()].reduce((s, g) => s + g.gross_volume, 0);
  const totalFees = [...byGateway.values()].reduce((s, g) => s + g.fee_amount, 0);

  const by_gateway: GatewayFeeRow[] = [...byGateway.values()]
    .map((g) => ({
      gateway: g.gateway,
      order_count: g.order_count,
      gross_volume: round2(g.gross_volume),
      fee_amount: round2(g.fee_amount),
      effective_rate: g.gross_volume > 0 ? g.fee_amount / g.gross_volume : 0,
      share: totalFees > 0 ? g.fee_amount / totalFees : 0,
    }))
    .sort((a, b) => b.fee_amount - a.fee_amount);

  const monthly: MonthlyFeePoint[] = [...monthlyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .map(([key, m]) => {
      const month = Number(key.split("-")[1]);
      return {
        key,
        label: MONTH_LABELS[(month ?? 1) - 1] ?? key,
        orders: m.orders,
        volume: round2(m.volume),
        fees: round2(m.fees),
      };
    });

  return {
    totals: {
      orders: orders.length,
      volume: round2(totalVolume),
      fees: round2(totalFees),
      effective_rate: totalVolume > 0 ? totalFees / totalVolume : 0,
    },
    by_gateway,
    monthly,
  };
}

export function aggregateAdminData(input: {
  demo: boolean;
  users: RawUser[];
  profiles: RawProfile[];
  stores: RawStore[];
  orders: RawOrder[];
  products: RawProduct[];
  events: RawEvent[];
}): AdminData {
  const { demo, users, profiles, stores, orders, products, events } = input;

  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const storeNameById = new Map(stores.map((s) => [s.id, s.name]));
  const ordersByStore = new Map<string, RawOrder[]>();
  const eventsByStore = new Map<string, RawEvent[]>();
  const productCountByStore = new Map<string, number>();
  const storesByUser = new Map<string, RawStore[]>();

  for (const store of stores) {
    storesByUser.set(store.user_id, [...(storesByUser.get(store.user_id) ?? []), store]);
  }
  for (const order of orders) {
    ordersByStore.set(order.store_id, [...(ordersByStore.get(order.store_id) ?? []), order]);
  }
  for (const event of events) {
    eventsByStore.set(event.store_id, [...(eventsByStore.get(event.store_id) ?? []), event]);
  }
  for (const product of products) {
    productCountByStore.set(product.store_id, (productCountByStore.get(product.store_id) ?? 0) + 1);
  }

  const userById = new Map(users.map((u) => [u.id, u]));

  const adminUsers: AdminUser[] = users.map((user) => {
    const userStores = storesByUser.get(user.id) ?? [];
    const storeIds = new Set(userStores.map((s) => s.id));
    const userOrders = orders.filter((o) => storeIds.has(o.store_id));
    const profile = profileById.get(user.id);
    const revenue = round2(userOrders.reduce((s, o) => s + (o.total_amount - o.refund_amount), 0));
    return {
      id: user.id,
      email: user.email,
      full_name: profile?.full_name ?? null,
      avatar_url: profile?.avatar_url ?? null,
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at,
      banned: !!user.banned_until && new Date(user.banned_until as string).getTime() > Date.now(),
      store_count: userStores.length,
      order_count: userOrders.length,
      total_revenue: revenue,
    };
  });

  // Build admin clients with subscription status and activity data.
  const adminClients: AdminClient[] = users.map((user) => {
    const userStores = storesByUser.get(user.id) ?? [];
    const storeIds = new Set(userStores.map((s) => s.id));
    const userOrders = orders.filter((o) => storeIds.has(o.store_id));
    const userEvents = events.filter((e) => storeIds.has(e.store_id));
    const profile = profileById.get(user.id);
    const revenue = round2(userOrders.reduce((s, o) => s + (o.total_amount - o.refund_amount), 0));

    // Find latest activity: most recent order, event, or sign-in.
    const latestOrderAt = userOrders.length > 0
      ? [...userOrders].sort((a, b) => b.ordered_at.localeCompare(a.ordered_at))[0].ordered_at
      : null;
    const latestEventAt = userEvents.length > 0
      ? [...userEvents].sort((a, b) => b.processed_at.localeCompare(a.processed_at))[0].processed_at
      : null;

    const timestamps = [user.last_sign_in_at, latestOrderAt, latestEventAt].filter(Boolean) as string[];
    const latestActivity = timestamps.length > 0
      ? timestamps.sort((a, b) => b.localeCompare(a))[0]
      : null;

    // Determine latest activity type for display.
    let latestActivityType: string | null = null;
    let latestActivityDetail: string | null = null;
    if (latestEventAt && (!latestOrderAt || latestEventAt >= latestOrderAt) && (!user.last_sign_in_at || latestEventAt >= user.last_sign_in_at)) {
      const latestEvt = [...userEvents].sort((a, b) => b.processed_at.localeCompare(a.processed_at))[0];
      latestActivityType = "webhook";
      latestActivityDetail = `${latestEvt.provider} · ${latestEvt.event_type}`;
    } else if (latestOrderAt && (!user.last_sign_in_at || latestOrderAt >= user.last_sign_in_at)) {
      latestActivityType = "order";
      latestActivityDetail = `Order #${[...userOrders].sort((a, b) => b.ordered_at.localeCompare(a.ordered_at))[0].payment_gateway}`;
    } else if (user.last_sign_in_at) {
      latestActivityType = "sign_in";
      latestActivityDetail = "Last sign-in";
    }

    const subscription_status = deriveSubscriptionStatus(
      user.last_sign_in_at,
      user.created_at,
      userStores.length,
      userOrders.length,
      latestOrderAt,
    );

    return {
      id: user.id,
      email: user.email,
      full_name: profile?.full_name ?? null,
      avatar_url: profile?.avatar_url ?? null,
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at,
      subscription_status,
      store_names: userStores.map((s) => s.name),
      store_count: userStores.length,
      order_count: userOrders.length,
      total_revenue: revenue,
      latest_activity: latestActivity,
      latest_activity_type: latestActivityType,
      latest_activity_detail: latestActivityDetail,
    };
  });

  const adminStores: AdminStore[] = stores.map((store) => {
    const owner = userById.get(store.user_id);
    const ownerProfile = profileById.get(store.user_id);
    const storeOrders = ordersByStore.get(store.id) ?? [];
    const revenue = round2(storeOrders.reduce((s, o) => s + (o.total_amount - o.refund_amount), 0));
    const fees = round2(storeOrders.reduce((s, o) => s + o.payment_fee, 0));
    return {
      id: store.id,
      name: store.name,
      platform: store.platform,
      domain: store.domain,
      currency: store.currency,
      status: store.status,
      owner: {
        id: store.user_id,
        email: owner?.email ?? "—",
        full_name: ownerProfile?.full_name ?? null,
      },
      order_count: storeOrders.length,
      product_count: productCountByStore.get(store.id) ?? 0,
      event_count: (eventsByStore.get(store.id) ?? []).length,
      revenue,
      fees,
      created_at: store.created_at,
    };
  });

  const allEvents: AdminEvent[] = events
    .map((e) => ({
      id: e.id,
      store_id: e.store_id,
      store_name: storeNameById.get(e.store_id) ?? "Unknown store",
      provider: e.provider,
      event_type: e.event_type,
      status: e.status,
      error: e.error,
      processed_at: e.processed_at,
    }))
    .sort((a, b) => b.processed_at.localeCompare(a.processed_at));

  const overview: AdminOverview = {
    user_count: adminUsers.length,
    store_count: adminStores.length,
    connected_stores: adminStores.filter((s) => s.status === "connected").length,
    order_count: orders.length,
    event_count: allEvents.length,
    failed_events: allEvents.filter((e) => e.status === "failed").length,
    total_revenue: round2(orders.reduce((s, o) => s + (o.total_amount - o.refund_amount), 0)),
    total_fees: round2(orders.reduce((s, o) => s + o.payment_fee, 0)),
    recent_events: allEvents.slice(0, 8),
  };

  return {
    mode: demo ? "demo" : "live",
    users: adminUsers,
    clients: adminClients,
    stores: adminStores,
    events: allEvents,
    overview,
    fees: computeFeeBreakdown(orders),
  };
}
