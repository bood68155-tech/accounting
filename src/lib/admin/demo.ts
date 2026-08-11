import {
  aggregateAdminData,
  type RawEvent,
  type RawOrder,
  type RawProduct,
  type RawProfile,
  type RawStore,
  type RawUser,
} from "@/lib/admin/aggregate";
import type { AdminData } from "@/lib/admin/types";
import { mulberry32, round2 } from "@/lib/utils";

// ─── Admin demo dataset ───────────────────────────────────────────────────────
// Deterministic platform-wide sample data so the admin console is fully
// explorable before Supabase credentials are added.

const NOW = Date.now();
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

const USERS: RawUser[] = [
  { id: "usr-elena", email: "elena@auroraandoak.com", created_at: daysAgo(410), last_sign_in_at: daysAgo(1), banned_until: null },
  { id: "usr-marcus", email: "marcus@northlightgoods.com", created_at: daysAgo(385), last_sign_in_at: daysAgo(3), banned_until: null },
  { id: "usr-priya", email: "priya@maisonpriya.shop", created_at: daysAgo(340), last_sign_in_at: daysAgo(12), banned_until: null },
  { id: "usr-tom", email: "tom@okafor.co", created_at: daysAgo(290), last_sign_in_at: daysAgo(0.2), banned_until: null },
  { id: "usr-sofia", email: "sofia@nordglas.se", created_at: daysAgo(215), last_sign_in_at: daysAgo(2), banned_until: null },
  { id: "usr-kai", email: "kai@abandoned.demo", created_at: daysAgo(160), last_sign_in_at: daysAgo(90), banned_until: daysAgo(-30) },
];

const PROFILES: RawProfile[] = [
  { id: "usr-elena", full_name: "Elena Vasquez", avatar_url: null },
  { id: "usr-marcus", full_name: "Marcus Reed", avatar_url: null },
  { id: "usr-priya", full_name: "Priya Nair", avatar_url: null },
  { id: "usr-tom", full_name: "Tom Okafor", avatar_url: null },
  { id: "usr-sofia", full_name: "Sofia Lindgren", avatar_url: null },
  { id: "usr-kai", full_name: "Kai Nakamura", avatar_url: null },
];

const STORES: RawStore[] = [
  { id: "st-aurora", user_id: "usr-elena", name: "Aurora & Oak", platform: "shopify", domain: "auroraandoak.myshopify.com", currency: "USD", status: "connected", created_at: daysAgo(400) },
  { id: "st-northlight", user_id: "usr-marcus", name: "Northlight Goods", platform: "shopify", domain: "northlightgoods.myshopify.com", currency: "USD", status: "connected", created_at: daysAgo(375) },
  { id: "st-priya", user_id: "usr-priya", name: "Maison Priya", platform: "woocommerce", domain: "maisonpriya.shop", currency: "EUR", status: "connected", created_at: daysAgo(330) },
  { id: "st-okafor", user_id: "usr-tom", name: "Okafor Supply", platform: "woocommerce", domain: "okafor.co", currency: "USD", status: "syncing", created_at: daysAgo(280) },
  { id: "st-nordglas", user_id: "usr-sofia", name: "Nordglas", platform: "shopify", domain: "nordglas.myshopify.com", currency: "SEK", status: "connected", created_at: daysAgo(205) },
  { id: "st-aurora-outlet", user_id: "usr-elena", name: "Aurora & Oak Outlet", platform: "paypal", domain: "outlet.auroraandoak.com", currency: "USD", status: "disconnected", created_at: daysAgo(150) },
];

const GATEWAYS_BY_STORE: Record<string, string[]> = {
  "st-aurora": ["Shopify Payments", "Shopify Payments", "PayPal"],
  "st-northlight": ["Shopify Payments", "Stripe"],
  "st-priya": ["WooCommerce Payments", "Stripe"],
  "st-okafor": ["WooCommerce Payments", "PayPal"],
  "st-nordglas": ["Shopify Payments", "PayPal"],
  "st-aurora-outlet": ["PayPal"],
};

function feeFor(gateway: string, volume: number): number {
  if (gateway === "PayPal") return round2(volume * 0.0349 + 0.49);
  return round2(volume * 0.029 + 0.3);
}

function providerFor(gateway: string, platform: string): string {
  if (platform === "woocommerce") return "woocommerce";
  if (gateway === "PayPal") return "paypal";
  if (gateway === "Stripe") return "stripe";
  return "shopify";
}

function generateOrders(): RawOrder[] {
  const rand = mulberry32(20260810);
  const orders: RawOrder[] = [];
  for (const store of STORES) {
    const count = 8 + Math.floor(rand() * 7); // 8–14 per store
    const gateways = GATEWAYS_BY_STORE[store.id] ?? ["Stripe"];
    for (let i = 0; i < count; i++) {
      const gateway = gateways[Math.floor(rand() * gateways.length)];
      const total = 24 + rand() * 160;
      const refunded = rand() < 0.08;
      const refund = refunded ? total * (rand() < 0.5 ? 0.5 : 1) : 0;
      const volume = total - refund;
      orders.push({
        store_id: store.id,
        payment_gateway: gateway,
        total_amount: round2(total),
        refund_amount: round2(refund),
        payment_fee: feeFor(gateway, volume),
        ordered_at: daysAgo(Math.floor(rand() * 180)),
      });
    }
  }
  return orders.sort((a, b) => a.ordered_at.localeCompare(b.ordered_at));
}

function generateEvents(orders: RawOrder[]): RawEvent[] {
  const platformById = new Map(STORES.map((s) => [s.id, s.platform]));
  const events: RawEvent[] = orders.map((order, i) => {
    const platform = platformById.get(order.store_id) ?? "shopify";
    const provider = providerFor(order.payment_gateway, platform);
    const eventType =
      provider === "stripe"
        ? "charge.succeeded"
        : provider === "paypal"
          ? "payment.sale.completed"
          : "orders/create";
    return {
      id: `evt-order-${i}`,
      store_id: order.store_id,
      provider,
      event_type: eventType,
      status: "processed",
      error: null,
      processed_at: new Date(new Date(order.ordered_at).getTime() + 45_000).toISOString(),
    };
  });
  events.push(
    { id: "evt-fail-1", store_id: "st-okafor", provider: "woocommerce", event_type: "orders/create", status: "failed", error: "Signature verification failed — HMAC mismatch", processed_at: daysAgo(0.2) },
    { id: "evt-fail-2", store_id: "st-okafor", provider: "woocommerce", event_type: "order.updated", status: "failed", error: "Payload too large (413)", processed_at: daysAgo(1.1) },
    { id: "evt-fail-3", store_id: "st-aurora-outlet", provider: "paypal", event_type: "payment.sale.completed", status: "failed", error: "Webhook identity verification failed", processed_at: daysAgo(2.1) },
    { id: "evt-charge-1", store_id: "st-nordglas", provider: "stripe", event_type: "charge.succeeded", status: "processed", error: null, processed_at: daysAgo(0.08) },
    { id: "evt-charge-2", store_id: "st-aurora", provider: "stripe", event_type: "charge.succeeded", status: "processed", error: null, processed_at: daysAgo(0.02) },
  );
  return events;
}

function generateProducts(): RawProduct[] {
  const products: RawProduct[] = [];
  STORES.forEach((store, si) => {
    const count = 5 + si; // 5–10 per store
    for (let i = 0; i < count; i++) {
      products.push({ id: `prod-${store.id}-${i}`, store_id: store.id });
    }
  });
  return products;
}

let cached: AdminData | null = null;

export function getDemoAdminData(): AdminData {
  if (cached) return cached;
  const orders = generateOrders();
  cached = aggregateAdminData({
    demo: true,
    users: USERS,
    profiles: PROFILES,
    stores: STORES,
    orders,
    products: generateProducts(),
    events: generateEvents(orders),
  });
  return cached;
}
