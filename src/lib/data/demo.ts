import type { JournalEntry, Order, Product, Store, WebhookEvent } from "@/types";
import { mulberry32, round2 } from "@/lib/utils";
import { createRefundEntry, createSaleEntry } from "@/lib/accounting/doubleEntry";
import { computeMonthlySeries, computeStats } from "@/lib/accounting/profitEngine";
import { buildIncomeStatementFromOrders } from "@/lib/accounting/incomeStatement";

/**
 * ── Demo dataset ──────────────────────────────────────────────────────────────
 * A deterministic (seeded) dataset so the product is fully explorable before a
 * Supabase project is connected. Numbers are generated realistically and run
 * through the same profit engine + double-entry logic as live data.
 */

export const DEMO_STORE_ID = "demo-aurora-oak";

export const DEMO_STORE: Store = {
  id: DEMO_STORE_ID,
  user_id: "demo-user",
  name: "Aurora & Oak",
  platform: "shopify",
  domain: "auroraandoak.myshopify.com",
  currency: "USD",
  status: "connected",
  config: { demo: true, webhook_secret: "demo-webhook-secret" },
  created_at: new Date(Date.now() - 420 * 86_400_000).toISOString(),
};

interface CatalogItem {
  sku: string;
  name: string;
  cost: number;
  price: number;
}

const CATALOG: CatalogItem[] = [
  { sku: "AUR-101", name: "Amber + Cedar Candle (8oz)", cost: 4.6, price: 24.0 },
  { sku: "AUR-102", name: "Sea Salt & Sage Candle (8oz)", cost: 4.6, price: 24.0 },
  { sku: "AUR-103", name: "Midnight Diffuser Reed Set", cost: 7.2, price: 32.0 },
  { sku: "AUR-104", name: "Botanical Gift Box (3pc)", cost: 13.4, price: 58.0 },
  { sku: "AUR-105", name: "Linen Room Spray 100ml", cost: 2.9, price: 18.0 },
  { sku: "AUR-106", name: "Matcha Cleansing Bar (trio)", cost: 3.4, price: 15.0 },
  { sku: "AUR-107", name: "Stoneware Travel Candle", cost: 3.1, price: 14.0 },
  { sku: "AUR-108", name: "Oak Holder + Candle Set", cost: 8.8, price: 42.0 },
];

const CUSTOMERS = [
  "Elena Vasquez", "Marcus Reed", "Priya Nair", "Tom Okafor", "Sofia Lindgren",
  "James Whitfield", "Amara Osei", "Noah Bergström", "Layla Haddad", "Ethan Cole",
  "Chloe Martin", "Omar Farouk", "Hana Yoshida", "Daniel Kessler", "Ruby Turner",
  "Liam O'Connor",
];

const SEED = 20260714;

function startOfMonth(offset: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
}

function daysInMonth(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

let cachedOrders: Order[] | null = null;

/** Generate ~6 months of realistic orders (deterministic). */
export function getDemoOrders(): Order[] {
  if (cachedOrders) return cachedOrders;

  const rand = mulberry32(SEED);
  const orders: Order[] = [];
  let orderCounter = 1000;

  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
  const between = (min: number, max: number): number => min + rand() * (max - min);

  for (let monthOffset = 5; monthOffset >= 0; monthOffset--) {
    const monthStart = startOfMonth(monthOffset);
    const dim = daysInMonth(monthStart);
    const orderCount = 8 + Math.floor(rand() * 5); // 8–12 per month

    for (let i = 0; i < orderCount; i++) {
      orderCounter += 1;

      // 1–3 line items
      const lineCount = 1 + Math.floor(rand() * 3);
      const chosen = new Set<number>();
      const items = [];
      for (let l = 0; l < lineCount; l++) {
        let idx = Math.floor(rand() * CATALOG.length);
        while (chosen.has(idx)) idx = Math.floor(rand() * CATALOG.length);
        chosen.add(idx);
        const product = CATALOG[idx];
        const quantity = rand() < 0.25 ? 2 : 1;
        items.push({
          sku: product.sku,
          name: product.name,
          quantity,
          unit_price: product.price,
          unit_cost: product.cost,
          line_subtotal: round2(product.price * quantity),
          line_cost: round2(product.cost * quantity),
        });
      }

      const subtotal = round2(items.reduce((s, i) => s + i.line_subtotal, 0));
      const hasDiscount = rand() < 0.35;
      const discountAmount = hasDiscount ? round2(subtotal * between(0.05, 0.2)) : 0;
      const shippingAmount = round2(between(5.95, 11.95));
      const taxAmount = round2((subtotal - discountAmount) * 0.0725);
      const totalAmount = round2(subtotal - discountAmount + shippingAmount + taxAmount);
      const paymentFee = round2(totalAmount * 0.029 + 0.3);

      const day = 1 + Math.floor(rand() * dim);
      const orderedAt = new Date(
        Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day, 3 + Math.floor(rand() * 16), Math.floor(rand() * 60)),
      ).toISOString();

      const isRefunded = rand() < 0.06;
      const refundAmount = isRefunded ? round2(totalAmount * (rand() < 0.5 ? 0.5 : 1)) : 0;

      orders.push({
        store_id: DEMO_STORE_ID,
        external_id: `shopify-${450000000 + orderCounter}`,
        order_number: `#${orderCounter}`,
        customer_name: pick(CUSTOMERS),
        currency: "USD",
        subtotal,
        shipping_amount: shippingAmount,
        discount_amount: discountAmount,
        tax_amount: taxAmount,
        total_amount: totalAmount,
        payment_gateway: rand() < 0.7 ? "Shopify Payments" : "PayPal",
        payment_fee: paymentFee,
        shipping_cost: round2(between(3.2, 6.9)),
        refund_amount: refundAmount,
        status: refundAmount >= totalAmount ? "refunded" : refundAmount > 0 ? "partially_refunded" : "paid",
        ordered_at: orderedAt,
        items,
      });
    }
  }

  cachedOrders = orders.sort((a, b) => a.ordered_at.localeCompare(b.ordered_at));
  return cachedOrders;
}

export function getDemoProducts(): Product[] {
  return CATALOG.map((p, i) => ({
    store_id: DEMO_STORE_ID,
    external_id: `shopify-prod-${1000 + i}`,
    sku: p.sku,
    name: p.name,
    unit_cost: p.cost,
    unit_price: p.price,
    created_at: new Date(Date.now() - 400 * 86_400_000).toISOString(),
  }));
}

let cachedEntries: JournalEntry[] | null = null;

/** Journal entries generated from the demo orders via the double-entry engine. */
export function getDemoLedgerEntries(): JournalEntry[] {
  if (cachedEntries) return cachedEntries;

  const orders = getDemoOrders();
  const entries: JournalEntry[] = [];
  let entryNumber = 0;

  for (const order of orders) {
    entryNumber += 1;
    entries.push(createSaleEntry(order, entryNumber));
    if (order.refund_amount > 0) {
      entryNumber += 1;
      entries.push(createRefundEntry(order, order.refund_amount, entryNumber));
    }
  }

  cachedEntries = entries;
  return cachedEntries;
}

export function getDemoStats() {
  return computeStats(DEMO_STORE_ID, getDemoOrders());
}

export function getDemoMonthlySeries() {
  return computeMonthlySeries(getDemoOrders(), 6);
}

let cachedEvents: WebhookEvent[] | null = null;

export function getDemoWebhookEvents(): WebhookEvent[] {
  if (cachedEvents) return cachedEvents;

  const orders = getDemoOrders().slice(-12).reverse();
  const events: WebhookEvent[] = orders.map((order, i) => ({
    store_id: DEMO_STORE_ID,
    provider: order.payment_gateway === "PayPal" ? "paypal" : "shopify",
    event_type: order.refund_amount > 0 ? "refund" : "order",
    payload: { order_number: order.order_number },
    status: "processed",
    error: null,
    processed_at: new Date(new Date(order.ordered_at).getTime() + 900_000 * (i + 1)).toISOString(),
  }));
  events.unshift({
    store_id: DEMO_STORE_ID,
    provider: "stripe",
    event_type: "charge.succeeded",
    payload: { id: "ch_demo_0001" },
    status: "processed",
    error: null,
    processed_at: new Date().toISOString(),
  });
  cachedEvents = events;
  return cachedEvents;
}

export function getDemoIncomeStatement(from?: string, to?: string) {
  return buildIncomeStatementFromOrders(getDemoOrders(), from, to);
}

export const DEMO_ORDER_COUNT = getDemoOrders().length;
