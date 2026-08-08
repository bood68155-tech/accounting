import type { NormalizedOrder } from "@/lib/providers/types";
import { money } from "@/lib/providers/types";

/**
 * ── WooCommerce adapter ───────────────────────────────────────────────────────
 * Webhook: POST /api/webhooks/woocommerce  (order.completed, order.refunded…)
 * Verification: WooCommerce webhooks are authenticated with a custom secret
 * header — for production, check the secret against the store config or proxy
 * through the REST API (WOO_CONSUMER_KEY/SECRET) for order sync.
 */

interface WooLineItem {
  sku?: string;
  name?: string;
  product_id?: number;
  quantity?: number;
  price?: number;
  total?: string;
  subtotal?: string;
}

interface WooOrderPayload {
  id?: number;
  number?: string;
  billing?: { first_name?: string; last_name?: string; email?: string };
  currency?: string;
  status?: string;
  date_created?: string;
  line_items?: WooLineItem[];
  shipping_lines?: Array<{ total?: string }>;
  discount_total?: string;
  cart_tax?: string;
  total_tax?: string;
  total?: string;
  payment_method_title?: string;
  fee_lines?: Array<{ total?: string; name?: string }>;
}

/** Normalize a WooCommerce order webhook payload. */
export function normalizeWooOrder(payload: WooOrderPayload): NormalizedOrder {
  const items = (payload.line_items ?? []).map((item) => {
    const quantity = Math.max(1, money(item.quantity, 1));
    const unitPrice = money(item.price) || money(item.subtotal) / quantity;
    return {
      sku: item.sku ?? String(item.product_id ?? ""),
      name: item.name ?? "Unknown product",
      quantity,
      unit_price: unitPrice,
      unit_cost: 0, // cost basis lives in the product catalog
      line_subtotal: round(money(item.subtotal) || unitPrice * quantity),
      line_cost: 0,
    };
  });

  const subtotal = round(items.reduce((s, i) => s + i.line_subtotal, 0));
  const shipping = round((payload.shipping_lines ?? []).reduce((s, line) => s + money(line.total), 0));
  const discounts = money(payload.discount_total);
  const tax = money(payload.total_tax) || money(payload.cart_tax);
  const total = money(payload.total) || round(subtotal + shipping + tax - discounts);

  const billing = payload.billing;
  const customerName = [billing?.first_name, billing?.last_name].filter(Boolean).join(" ") ||
    billing?.email ||
    "Guest";

  return {
    external_id: String(payload.id ?? ""),
    order_number: payload.number ? `#${payload.number}` : `#${payload.id ?? ""}`,
    customer_name: customerName,
    currency: payload.currency ?? "USD",
    subtotal,
    shipping_amount: shipping,
    discount_amount: discounts,
    tax_amount: tax,
    total_amount: total,
    payment_gateway: payload.payment_method_title ?? "woocommerce",
    payment_fee: round((payload.fee_lines ?? []).reduce((s, f) => s + money(f.total), 0)),
    shipping_cost: 0,
    refund_amount: 0,
    status:
      payload.status === "completed" || payload.status === "processing"
        ? "paid"
        : payload.status === "refunded"
          ? "refunded"
          : "pending",
    ordered_at: payload.date_created ?? new Date().toISOString(),
    items,
  };
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
