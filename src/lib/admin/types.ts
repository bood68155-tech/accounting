// ─── Store Accountant: admin console domain types ─────────────────────────────
// Platform-wide views of users, stores, webhook events and gateway fees.
// Consumed by the admin API routes and the admin console UI.

import type { Platform, StoreStatus } from "@/types";

/** Subscription status derived from user activity and store connectivity. */
export type SubscriptionStatus = "active" | "trial" | "inactive" | "expired";

/** A platform user with profile + usage aggregates. */
export interface AdminUser {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  banned: boolean;
  store_count: number;
  order_count: number;
  total_revenue: number;
}

/** A registered client/subscriber with subscription and activity data. */
export interface AdminClient {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  subscription_status: SubscriptionStatus;
  store_names: string[];
  store_count: number;
  order_count: number;
  total_revenue: number;
  latest_activity: string | null;
  latest_activity_type: string | null;
  latest_activity_detail: string | null;
}

/** A connected store with owner info + usage aggregates. */
export interface AdminStore {
  id: string;
  name: string;
  platform: Platform;
  domain: string | null;
  currency: string;
  status: StoreStatus;
  owner: {
    id: string;
    email: string;
    full_name: string | null;
  };
  order_count: number;
  product_count: number;
  event_count: number;
  revenue: number;
  fees: number;
  created_at: string;
}

/** A webhook integration event enriched with the store name. */
export interface AdminEvent {
  id: string;
  store_id: string;
  store_name: string;
  provider: string;
  event_type: string;
  status: "processed" | "failed";
  error: string | null;
  processed_at: string;
}

/** Gateway fee aggregation for a single payment provider. */
export interface GatewayFeeRow {
  gateway: string;
  order_count: number;
  gross_volume: number;
  fee_amount: number;
  /** fee / volume (0..1) */
  effective_rate: number;
  /** fee / total fees (0..1) */
  share: number;
}

/** Monthly fee/volume point for charts. */
export interface MonthlyFeePoint {
  key: string; // "2026-08"
  label: string; // "Aug"
  orders: number;
  volume: number;
  fees: number;
}

/** Full gateway fee breakdown. */
export interface FeeBreakdown {
  totals: {
    orders: number;
    volume: number;
    fees: number;
    effective_rate: number;
  };
  by_gateway: GatewayFeeRow[];
  monthly: MonthlyFeePoint[];
}

/** Platform-wide KPIs. */
export interface AdminOverview {
  user_count: number;
  store_count: number;
  connected_stores: number;
  order_count: number;
  event_count: number;
  failed_events: number;
  total_revenue: number;
  total_fees: number;
  recent_events: AdminEvent[];
}

/** Everything the admin console renders. */
export interface AdminData {
  mode: "demo" | "live";
  users: AdminUser[];
  clients: AdminClient[];
  stores: AdminStore[];
  events: AdminEvent[];
  overview: AdminOverview;
  fees: FeeBreakdown;
}
