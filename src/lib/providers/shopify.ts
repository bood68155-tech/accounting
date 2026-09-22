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

/** One catalog row extracted from the Shopify Admin API. */
export interface ShopifyCatalogProduct {
  external_id: string;
  sku: string;
  title: string;
  selling_price: number;
  /** Cost from the variant's inventory item; null when Shopify doesn't track it. */
  cost_price: number | null;
}

const SHOPIFY_API_VERSION = "2024-10";

/**
 * Fetch the product catalog from the Shopify Admin REST API.
 * Token: a custom-app Admin API access token (shpat_…). Variants without a
 * SKU are skipped — SKU is our catalog key. Unit costs live on inventory
 * items, so they are fetched in a second batched pass.
 */
export async function fetchShopifyProducts(
  domain: string,
  token: string,
): Promise<ShopifyCatalogProduct[]> {
  const base = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}`;
  const headers = { "X-Shopify-Access-Token": token };

  type Draft = ShopifyCatalogProduct & { inventoryItemId?: string };
  const drafts: Draft[] = [];

  let url: string | null = `${base}/products.json?limit=250&status=active`;
  while (url) {
    const res: Response = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Shopify products API ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      products?: Array<{
        id: number;
        title: string;
        variants?: Array<{
          id: number;
          title?: string;
          sku?: string | null;
          price?: string;
          inventory_item_id?: number;
        }>;
      }>;
    };

    for (const product of data.products ?? []) {
      for (const variant of product.variants ?? []) {
        const sku = variant.sku?.trim();
        if (!sku) continue; // SKU is the catalog key
        drafts.push({
          external_id: String(product.id),
          sku,
          title:
            variant.title && variant.title !== "Default Title"
              ? `${product.title} — ${variant.title}`
              : product.title,
          selling_price: Number.parseFloat(variant.price ?? "0") || 0,
          cost_price: null,
          inventoryItemId: variant.inventory_item_id
            ? String(variant.inventory_item_id)
            : undefined,
        });
      }
    }

    // Follow the Link header for pagination (rel="next").
    const link: string | null = res.headers.get("link");
    url = link?.match(/<([^>]+)>; rel="next"/)?.[1] ?? null;
  }

  // Second pass: unit costs live on inventory items (≤100 ids per call).
  const itemIds = [
    ...new Set(drafts.map((d) => d.inventoryItemId).filter((x): x is string => Boolean(x))),
  ];
  const costByItemId = new Map<string, number>();
  for (let i = 0; i < itemIds.length; i += 100) {
    const chunk = itemIds.slice(i, i + 100);
    const res = await fetch(`${base}/inventory_items.json?ids=${chunk.join(",")}`, {
      headers,
      cache: "no-store",
    });
    if (!res.ok) continue; // costs stay null — the user can set them in the UI
    const data = (await res.json()) as {
      inventory_items?: Array<{ id: number; cost?: string | null }>;
    };
    for (const it of data.inventory_items ?? []) {
      const cost = Number.parseFloat(it.cost ?? "");
      if (Number.isFinite(cost)) costByItemId.set(String(it.id), cost);
    }
  }

  return drafts.map(({ inventoryItemId, ...row }) => ({
    ...row,
    cost_price:
      (inventoryItemId ? costByItemId.get(inventoryItemId) : undefined) ?? null,
  }));
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
