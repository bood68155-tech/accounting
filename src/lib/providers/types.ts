import type { Order, OrderItem, OrderStatus, Platform } from "@/types";

/**
 * Provider adapters normalize each platform's webhook/API payloads into a
 * canonical {@link NormalizedOrder} so the profit engine + double-entry
 * bookkeeping are platform-agnostic.
 */
export interface NormalizedOrder {
  external_id: string;
  order_number: string;
  customer_name: string;
  currency: string;
  subtotal: number;
  shipping_amount: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  payment_gateway: string;
  payment_fee: number;
  shipping_cost: number;
  refund_amount: number;
  status: OrderStatus;
  ordered_at: string;
  items: Array<{
    sku: string;
    name: string;
    quantity: number;
    unit_price: number;
    unit_cost: number;
    line_subtotal: number;
    line_cost: number;
  }>;
}

export interface SignatureVerification {
  valid: boolean;
  reason?: string;
}

/** Attach a store + materialize order items. */
export function toOrder(normalized: NormalizedOrder, storeId: string, storeCurrency?: string): Order {
  const items: OrderItem[] = normalized.items.map((item) => ({
    sku: item.sku || "N/A",
    name: item.name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    unit_cost: item.unit_cost,
    line_subtotal: item.line_subtotal,
    line_cost: item.line_cost,
  }));

  return {
    store_id: storeId,
    external_id: normalized.external_id,
    order_number: normalized.order_number,
    customer_name: normalized.customer_name,
    currency: normalized.currency || storeCurrency || "USD",
    subtotal: normalized.subtotal,
    shipping_amount: normalized.shipping_amount,
    discount_amount: normalized.discount_amount,
    tax_amount: normalized.tax_amount,
    total_amount: normalized.total_amount,
    payment_gateway: normalized.payment_gateway,
    payment_fee: normalized.payment_fee,
    shipping_cost: normalized.shipping_cost,
    refund_amount: normalized.refund_amount,
    status: normalized.status,
    ordered_at: normalized.ordered_at,
    items,
  };
}

/** A payment event (Stripe/PayPal) that carries gateway-fee information. */
export interface NormalizedPayment {
  external_id: string;
  order_external_id?: string;
  currency: string;
  amount: number;
  fee: number;
  net: number;
  status: string;
  paid_at: string;
  gateway: Platform;
}

export function money(value: unknown, fallback = 0): number {
  const n = typeof value === "string" ? parseFloat(value) : Number(value);
  return Number.isFinite(n) ? n : fallback;
}
