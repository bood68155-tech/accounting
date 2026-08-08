import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  NormalizedOrder,
  SignatureVerification,
} from "@/lib/providers/types";
import { money } from "@/lib/providers/types";

/**
 * ── Shopify adapter ───────────────────────────────────────────────────────────
 * Webhook: POST /api/webhooks/shopify  (orders/create, orders/refund…)
 * Verification: `X-Shopify-Hmac-SHA256` = HMAC-SHA256(secret, rawBody), hex.
 */

export function verifyShopifyWebhook(
  rawBody: string,
  hmacHeader: string | null | undefined,
  secret: string,
): SignatureVerification {
  if (!hmacHeader) return { valid: false, reason: "Missing X-Shopify-Hmac-SHA256 header" };
  if (!secret) return { valid: false, reason: "SHOPIFY_WEBHOOK_SECRET is not configured" };

  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const expected = Buffer.from(digest, "utf8");
  const received = Buffer.from(hmacHeader, "utf8");

  if (expected.length !== received.length) {
    return { valid: false, reason: "HMAC length mismatch" };
  }
  return timingSafeEqual(expected, received)
    ? { valid: true }
    : { valid: false, reason: "HMAC signature mismatch" };
}

interface ShopifyLineItem {
  id?: number;
  sku?: string | null;
  title?: string;
  quantity?: number;
  price?: string;
  cost?: string | null;
}

interface ShopifyTransaction {
  kind?: string;
  status?: string;
  amount?: string;
  net?: string;
  gateway?: string;
}

interface ShopifyOrderPayload {
  id?: number | string;
  name?: string;
  email?: string;
  customer?: { first_name?: string; last_name?: string; email?: string };
  currency?: string;
  subtotal_price?: string;
  total_discounts?: string;
  total_tax?: string;
  total_shipping?: string;
  total_price?: string;
  financial_status?: string;
  created_at?: string;
  line_items?: ShopifyLineItem[];
  shipping_lines?: Array<{ price?: string }>;
  discount_codes?: Array<{ amount?: string }>;
  transactions?: ShopifyTransaction[];
}

/** Normalize a Shopify `orders/create` payload into a canonical order. */
export function normalizeShopifyOrder(payload: ShopifyOrderPayload): NormalizedOrder {
  const items = (payload.line_items ?? []).map((item) => {
    const quantity = Math.max(1, money(item.quantity, 1));
    const unitPrice = money(item.price);
    const unitCost = money(item.cost); // Shopify `cost` field when product cost tracking is on
    return {
      sku: item.sku ?? String(item.id ?? ""),
      name: item.title ?? "Unknown product",
      quantity,
      unit_price: unitPrice,
      unit_cost: unitCost,
      line_subtotal: round(unitPrice * quantity),
      line_cost: round(unitCost * quantity),
    };
  });

  const subtotal = money(payload.subtotal_price);
  // `total_shipping` is authoritative when present; some webhook configurations
  // omit `shipping_lines`, so fall back to the sum of the lines.
  const shippingFromTotal = money(payload.total_shipping);
  const shippingFromLines = round(
    (payload.shipping_lines ?? []).reduce((sum, line) => sum + money(line.price), 0),
  );
  const shipping = round(shippingFromTotal > 0 ? shippingFromTotal : shippingFromLines);
  const discounts = money(payload.total_discounts) || round(
    (payload.discount_codes ?? []).reduce((sum, code) => sum + money(code.amount), 0),
  );
  const tax = money(payload.total_tax);
  const total = money(payload.total_price) || round(subtotal + shipping + tax - discounts);

  // Payment fee: Stripe/Shopify Payments transactions expose `amount` and `net`.
  const txn = (payload.transactions ?? []).find((t) => t.kind === "sale" || t.kind === "capture");
  const fee = txn ? round(money(txn.amount) - money(txn.net)) : 0;

  const firstName = payload.customer?.first_name ?? "";
  const lastName = payload.customer?.last_name ?? "";
  const customerName = [firstName, lastName].filter(Boolean).join(" ") || payload.email || "Guest";

  return {
    external_id: String(payload.id ?? ""),
    order_number: payload.name ?? `#${payload.id ?? ""}`,
    customer_name: customerName,
    currency: payload.currency ?? "USD",
    subtotal,
    shipping_amount: shipping,
    discount_amount: discounts,
    tax_amount: tax,
    total_amount: total,
    payment_gateway: txn?.gateway ?? "shopify-payments",
    payment_fee: fee,
    shipping_cost: 0, // filled from store config when known
    refund_amount: 0,
    status: payload.financial_status === "paid" ? "paid" : "pending",
    ordered_at: payload.created_at ?? new Date().toISOString(),
    items,
  };
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
