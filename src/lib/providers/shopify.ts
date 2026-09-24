import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  NormalizedOrder,
  SignatureVerification,
} from "@/lib/providers/types";
import { money } from "@/lib/providers/types";

/**
 * ── Shopify adapter ───────────────────────────────────────────────────────────
 * Webhook: POST /api/webhooks/shopify  (orders/create, orders/paid, orders/refund…)
 * Verification: `X-Shopify-Hmac-SHA256` = base64(HMAC-SHA256(secret, rawBody)).
 *
 * Manual pull: GET orders from the Admin REST API with the same custom-app
 * token (shpat_…) used for catalog sync.
 *
 * Auth errors (401/403) are surfaced as {@link ShopifyAuthError} so callers
 * (order sync, catalog sync) can distinguish "token expired / scopes missing
 * → reconnect the store" from transient API failures and prompt a clean
 * re-authorization in the UI instead of a raw error string.
 */

/** Admin REST API version used for all Shopify calls in this adapter. */
const SHOPIFY_API_VERSION = "2024-10";

/** Scopes required for order + catalog pulls (Admin REST custom app token). */
export const SHOPIFY_REQUIRED_SCOPES = ["read_products", "read_orders"] as const;

/** Error thrown when the store's Admin API token is invalid or lacks scopes. */
export class ShopifyAuthError extends Error {
  readonly kind: "unauthorized" | "forbidden";
  /** Scopes carried by the stored token (when the API reported them). */
  readonly tokenScopes: string[] | null;
  /** Scopes the app requires (SHOPIFY_REQUIRED_SCOPES). */
  readonly requiredScopes: string[];

  constructor(
    kind: "unauthorized" | "forbidden",
    message: string,
    options: { tokenScopes?: string[] | null; requiredScopes?: string[] } = {},
  ) {
    super(message);
    this.name = "ShopifyAuthError";
    this.kind = kind;
    this.tokenScopes = options.tokenScopes ?? null;
    this.requiredScopes = options.requiredScopes ?? [...SHOPIFY_REQUIRED_SCOPES];
  }
}

export function isShopifyAuthError(error: unknown): error is ShopifyAuthError {
  return error instanceof ShopifyAuthError;
}

function missingScopes(tokenScopes: string[], required: readonly string[]): string[] {
  const granted = new Set(tokenScopes.map((s) => s.toLowerCase()));
  return required.filter((scope) => !granted.has(scope.toLowerCase()));
}

/**
 * Validate that the stored OAuth access token still carries the scopes the
 * app needs (read_orders for order sync, read_products for catalog/COGS).
 * Calls `GET /admin/api/<v>/oauth/access_scopes.json` and returns the granted
 * scopes, or throws {@link ShopifyAuthError} when the token is dead (401).
 *
 * NOTE: admin-created custom apps (shpat_ tokens created in the Shopify
 * admin) get a 404 from this endpoint — scopes can't be listed for them, so
 * we return [] and let the real data fetch surface any 403 instead.
 */
export async function validateShopifyTokenScopes(
  domain: string,
  token: string,
): Promise<string[]> {
  const base = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}`;
  let res: Response;
  try {
    res = await fetch(`${base}/oauth/access_scopes.json`, {
      headers: { "X-Shopify-Access-Token": token },
      cache: "no-store",
    });
  } catch (error) {
    throw new Error(
      `Cannot reach Shopify (${domain}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (res.status === 401) {
    throw new ShopifyAuthError(
      "unauthorized",
      "The store's Admin API token was rejected (401 — invalid API key or access token). The app was uninstalled or the token was regenerated. Reconnect the store with a fresh shpat_ token.",
    );
  }
  if (res.status === 404) {
    // Admin-created custom apps don't expose the OAuth scopes endpoint.
    // The token may still be fine — the real fetch decides.
    return [];
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Shopify access_scopes API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { access_scopes?: Array<{ handle?: string }> };
  const scopes = (data.access_scopes ?? []).map((s) => s.handle ?? "").filter(Boolean);
  const missing = missingScopes(scopes, SHOPIFY_REQUIRED_SCOPES);
  if (missing.length > 0) {
    throw new ShopifyAuthError(
      "forbidden",
      `The store's access token is missing required scope${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Update the app's granted scopes in the Shopify admin, then reconnect the store to get a new token.`,
      { tokenScopes: scopes },
    );
  }
  return scopes;
}

/**
 * Wrap a Shopify Admin API fetch: non-2xx responses throw, with 401/403
 * mapped to {@link ShopifyAuthError} so callers can trigger the re-auth flow.
 * A 429 (rate limited) waits per the Retry-After header and retries once —
 * catalog/order pulls fan out across pages, so a single 429 shouldn't fail
 * the whole sync.
 */
async function shopifyApiFetch(url: string, token: string): Promise<Response> {
  let res = await fetch(url, {
    headers: { "X-Shopify-Access-Token": token },
    cache: "no-store",
  });
  if (res.status === 429) {
    const retryAfter = Number.parseFloat(res.headers.get("retry-after") ?? "2");
    const delayMs = Math.min(Math.max(Number.isFinite(retryAfter) ? retryAfter * 1000 : 2000, 500), 10_000);
    console.warn(`[shopify] rate limited (429) — retrying in ${Math.round(delayMs / 100) / 10}s: ${url.split("?")[0]}`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": token },
      cache: "no-store",
    });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401) {
      throw new ShopifyAuthError(
        "unauthorized",
        "Shopify rejected the Admin API token (401) — reconnect the store to re-authorize.",
      );
    }
    if (res.status === 403) {
      // Shopify's own body is the clearest: "This action requires merchant
      // approval for read_orders scope." Include it in the surfaced message.
      const scopeHint = /scope/i.test(body)
        ? ` (${body.slice(0, 200).replace(/\s+/g, " ").trim()})`
        : " — the access token is missing required scopes (e.g. read_orders)";
      throw new ShopifyAuthError(
        "forbidden",
        `This token does not have access to this resource (403)${scopeHint}. Grant the missing scopes in the Shopify admin and reconnect the store with a new token.`,
      );
    }
    throw new Error(`Shopify API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res;
}

export function verifyShopifyWebhook(
  rawBody: string,
  hmacHeader: string | null | undefined,
  secret: string,
): SignatureVerification {
  if (!hmacHeader) return { valid: false, reason: "Missing X-Shopify-Hmac-SHA256 header" };
  if (!secret) return { valid: false, reason: "SHOPIFY_WEBHOOK_SECRET is not configured" };

  // Shopify sends the digest BASE64-ENCODED (not hex). Computing a hex digest
  // here was the bug that made every real webhook fail with a length mismatch.
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const received = Buffer.from(hmacHeader.trim(), "base64");

  if (received.length !== expected.length) {
    return {
      valid: false,
      reason: `HMAC length mismatch (expected ${expected.length} bytes, got ${received.length} — header may not be base64)`,
    };
  }
  return timingSafeEqual(expected, received)
    ? { valid: true }
    : { valid: false, reason: "HMAC signature mismatch — SHOPIFY_WEBHOOK_SECRET differs from the secret set in Shopify admin" };
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

  type Draft = ShopifyCatalogProduct & { inventoryItemId?: string };
  const drafts: Draft[] = [];

  let url: string | null = `${base}/products.json?limit=250&status=active`;
  while (url) {
    const res: Response = await shopifyApiFetch(url, token);
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
    // Costs are best-effort: any failure just leaves them null (the user can
    // set them in the UI), so this fetch is deliberately not auth-wrapped.
    const res = await fetch(`${base}/inventory_items.json?ids=${chunk.join(",")}`, {
      headers: { "X-Shopify-Access-Token": token },
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

/** One raw order as returned by the Shopify Admin REST `orders.json` endpoint. */
export type ShopifyAdminOrder = Record<string, unknown>;

/**
 * Fetch recent orders from the Shopify Admin REST API for manual syncing
 * ("Sync Shopify Orders" on /orders). Same custom-app token as the catalog
 * pull (shpat_…); follows Link-header pagination.
 *
 * `status=any` includes open + closed + cancelled orders so refunds and
 * cancellations are captured, not just new sales.
 */
export async function fetchShopifyOrders(
  domain: string,
  token: string,
  options: { limit?: number; days?: number } = {},
): Promise<ShopifyAdminOrder[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 250);
  const days = Math.min(Math.max(options.days ?? 30, 1), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const base = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}`;

  const orders: ShopifyAdminOrder[] = [];
  let url: string | null =
    `${base}/orders.json?limit=${limit}&status=any&created_at_min=${encodeURIComponent(since)}`;

  while (url) {
    const res: Response = await shopifyApiFetch(url, token);
    const data = (await res.json()) as { orders?: ShopifyAdminOrder[] };
    orders.push(...(data.orders ?? []));
    const link: string | null = res.headers.get("link");
    url = link?.match(/<([^>]+)>; rel="next"/)?.[1] ?? null;
  }

  return orders;
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
  cancelled_at?: string | null;
  closed_at?: string | null;
  created_at?: string;
  line_items?: ShopifyLineItem[];
  shipping_lines?: Array<{ price?: string }>;
  discount_codes?: Array<{ amount?: string }>;
  transactions?: ShopifyTransaction[];
  refunds?: Array<{
    created_at?: string;
    transactions?: Array<{
      kind?: string;
      status?: string;
      amount?: string;
      gateway?: string;
    }>;
  }>;
}

/**
 * Normalize a Shopify order payload (webhook body or Admin REST order object)
 * into a canonical order.
 */
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

  // Refunds: sum refund transactions from the payload's `refunds` array
  // (Admin REST) or a `total_refunded` field when present.
  const refundTotal = round(
    (payload.refunds ?? []).reduce(
      (sum, refund) =>
        sum +
        (refund.transactions ?? [])
          .filter((t) => t.kind === "refund" && t.status !== "failure")
          .reduce((s, t) => s + money(t.amount), 0),
      0,
    ),
  );

  const firstName = payload.customer?.first_name ?? "";
  const lastName = payload.customer?.last_name ?? "";
  const customerName = [firstName, lastName].filter(Boolean).join(" ") || payload.email || "Guest";

  // Status precedence: cancelled > refunded > paid > pending.
  const financial = payload.financial_status ?? "";
  let status: NormalizedOrder["status"] = "pending";
  if (financial === "paid" || financial === "partially_paid" || financial === "captured") status = "paid";
  if (financial === "refunded") status = "refunded";
  if (financial === "partially_refunded") status = "partially_refunded";
  if (financial === "voided") status = "cancelled"; // payment never captured — no revenue
  if (refundTotal > 0 && refundTotal >= total && total > 0) status = "refunded";
  else if (refundTotal > 0 && status === "paid") status = "partially_refunded";
  if (payload.cancelled_at) status = "cancelled";

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
    refund_amount: refundTotal,
    status,
    ordered_at: payload.created_at ?? new Date().toISOString(),
    items,
  };
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
