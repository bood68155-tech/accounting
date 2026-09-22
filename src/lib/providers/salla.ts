/**
 * ── Salla adapter ─────────────────────────────────────────────────────────────
 * Product catalog sync via the Salla Admin API v2, plus order webhook support.
 *
 * Auth: a Salla access token (OAuth2 authorization-code flow or a personal
 * token) scoped to `products.read`. Stored per store in `stores.config`
 * (`accessToken`) or provided via the SALLA_ACCESS_TOKEN env var.
 *
 * Catalog endpoint: GET https://api.salla.dev/admin/v2/products?page=N&per_page=100
 * The response shape is parsed defensively: titles may be plain strings or
 * localized objects ({ ar, en, … }) and price fields may be numbers, strings,
 * or { amount } objects depending on the app scope/API version.
 *
 * Order webhooks: POST /api/webhooks/salla (`order.created`, `order.updated`…).
 * Verification per Salla docs: `X-Salla-Signature` = HMAC-SHA256(secret, body)
 * as lowercase hex, compared timing-safe.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NormalizedOrder, OrderStatus, SignatureVerification } from "@/lib/providers/types";
import { money } from "@/lib/providers/types";
import { round2 } from "@/lib/utils";

/** HMAC-SHA256 hex signature check (Salla "signature" security strategy). */
export function verifySallaWebhook(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
): SignatureVerification {
  if (!signatureHeader) return { valid: false, reason: "Missing X-Salla-Signature header" };
  if (!secret) return { valid: false, reason: "SALLA_WEBHOOK_SECRET is not configured" };

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(signatureHeader, "utf8");

  if (expectedBuf.length !== receivedBuf.length) {
    return { valid: false, reason: "Signature length mismatch" };
  }
  return timingSafeEqual(expectedBuf, receivedBuf)
    ? { valid: true }
    : { valid: false, reason: "Signature mismatch" };
}

const SALLA_API_BASE = "https://api.salla.dev/admin/v2";

export interface SallaCatalogProduct {
  external_id: string;
  sku: string;
  title: string;
  selling_price: number;
  cost_price: number | null;
}

/** Numbers may arrive as number, string, or { amount } — coerce defensively. */
function toNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number.parseFloat(value);
    if (Number.isFinite(n)) return n;
    return null;
  }
  if (value && typeof value === "object" && "amount" in value) {
    return toNum((value as { amount?: unknown }).amount);
  }
  return null;
}

function toTitle(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    const localized = value as Record<string, unknown>;
    for (const key of ["ar", "en"]) {
      const v = localized[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    const first = Object.values(localized).find((v) => typeof v === "string" && v.trim());
    if (typeof first === "string") return first.trim();
  }
  return "";
}

interface SallaApiProduct {
  id?: number | string;
  sku?: string | null;
  title?: unknown;
  name?: unknown;
  price?: unknown;
  regular_price?: unknown;
  sale_price?: unknown;
  cost?: unknown;
  skus?: Array<{ sku?: string | null; price?: unknown; cost?: unknown }>;
}

export async function fetchSallaProducts(token: string): Promise<SallaCatalogProduct[]> {
  const out: SallaCatalogProduct[] = [];
  const maxPages = 20; // safety valve: 20 × 100 = 2000 products per sync

  for (let page = 1; page <= maxPages; page += 1) {
    const res = await fetch(`${SALLA_API_BASE}/products?page=${page}&per_page=100`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Salla products API ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { data?: SallaApiProduct[] };
    const products = data.data ?? [];
    if (products.length === 0) break;

    for (const p of products) {
      // SKU may live on the product or on its SKU sub-records.
      const variants =
        Array.isArray(p.skus) && p.skus.length > 0
          ? p.skus.map((s) => ({
              sku: s.sku ?? "",
              selling: toNum(s.price) ?? toNum(p.sale_price) ?? toNum(p.price) ?? toNum(p.regular_price),
              cost: toNum(s.cost),
            }))
          : [
              {
                sku: p.sku ?? "",
                selling:
                  toNum(p.sale_price) ?? toNum(p.price) ?? toNum(p.regular_price) ?? 0,
                cost: toNum(p.cost),
              },
            ];

      for (const variant of variants) {
        const sku = variant.sku.trim();
        if (!sku) continue; // SKU is the catalog key
        out.push({
          external_id: String(p.id ?? ""),
          sku,
          title: toTitle(p.title) || toTitle(p.name) || sku,
          selling_price: variant.selling ?? 0,
          cost_price: variant.cost,
        });
      }
    }

    if (products.length < 100) break; // last page
  }

  return out;
}

// ── Order webhook normalization ───────────────────────────────────────────────

interface SallaMoney {
  amount?: number | string;
  currency?: string;
}

interface SallaOrderItem {
  id?: number | string;
  sku?: string | null;
  name?: unknown;
  quantity?: number | string;
  amounts?: {
    price_without_tax?: SallaMoney;
    price_with_tax?: SallaMoney;
    cost_real?: SallaMoney;
    /** Webhook v2 nests totals under `item.amounts`. */
    total?: SallaMoney;
  };
  product?: { id?: number | string; sku?: string | null };
}

interface SallaOrderPayload {
  id?: number | string;
  reference_id?: number | string;
  date?: { date?: string } | string;
  status?: { id?: number; name?: unknown } | string;
  payment_method?: string;
  currency?: SallaMoney | string;
  amounts?: {
    sub_total?: SallaMoney;
    shipping_cost?: SallaMoney;
    discount?: SallaMoney;
    tax?: SallaMoney;
    total?: SallaMoney;
    cash_on_net?: SallaMoney;
    gateway_fee?: SallaMoney;
  };
  customer?: { first_name?: string; last_name?: string; mobile?: string | null };
  items?: SallaOrderItem[];
}

/** Salla money fields may be numbers or { amount, currency } objects. */
function moneyField(value: SallaMoney | string | number | undefined): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === "object") return money(value.amount);
  return money(value);
}

function mapSallaStatus(status: unknown): OrderStatus {
  const name =
    typeof status === "string"
      ? status
      : typeof status === "object" && status !== null
        ? toTitle((status as { name?: unknown }).name)
        : "";
  switch (name.toLowerCase()) {
    case "paid":
    case "completed":
    case "delivered":
      return "paid";
    case "canceled":
    case "cancelled":
      return "cancelled";
    case "restored":
    case "refunded":
      return "refunded";
    default:
      // under_construction / in_progress / awaiting… land as pending → credit sale.
      return "pending";
  }
}

/**
 * Normalize a Salla `order.created` webhook (v2) into a canonical order.
 * Payload docs: docs.salla.dev — order object with `amounts` (money objects)
 * and `items[].amounts` per line. Cost real comes from the item when the
 * merchant tracks cost; otherwise 0 and the catalog lookup fills it.
 */
export function normalizeSallaOrder(payload: SallaOrderPayload): NormalizedOrder {
  const items = (payload.items ?? []).map((item) => {
    const quantity = Math.max(1, money(item.quantity, 1));
    // Line price: pre-tax price when present, else the line total.
    const unitPrice =
      moneyField(item.amounts?.price_without_tax) > 0
        ? round2(moneyField(item.amounts?.price_without_tax) / quantity)
        : round2(moneyField(item.amounts?.total) / quantity);
    const unitCost = round2(moneyField(item.amounts?.cost_real) / quantity);
    return {
      sku: item.sku ?? String(item.product?.sku ?? item.id ?? ""),
      name: toTitle(item.name) || String(item.product?.id ?? "Salla item"),
      quantity,
      unit_price: unitPrice,
      unit_cost: unitCost,
      line_subtotal: round2(unitPrice * quantity),
      line_cost: round2(unitCost * quantity),
    };
  });

  const a = payload.amounts ?? {};
  const subtotal = moneyField(a.sub_total) || round2(items.reduce((s, i) => s + i.line_subtotal, 0));
  const shipping = moneyField(a.shipping_cost);
  const discounts = moneyField(a.discount);
  const tax = moneyField(a.tax);
  const total = moneyField(a.total) || round2(subtotal + shipping + tax - discounts);
  // Gateway fee when Salla exposes it (payment gateway apps); else 0.
  const fee = moneyField(a.gateway_fee);

  const firstName = payload.customer?.first_name ?? "";
  const lastName = payload.customer?.last_name ?? "";
  const customerName =
    [firstName, lastName].filter(Boolean).join(" ") || payload.customer?.mobile || "Guest";

  const dateStr =
    typeof payload.date === "string" ? payload.date : (payload.date?.date ?? undefined);

  return {
    external_id: String(payload.id ?? payload.reference_id ?? ""),
    order_number: `#${payload.reference_id ?? payload.id ?? ""}`,
    customer_name: customerName,
    currency:
      (typeof payload.currency === "object" ? payload.currency?.currency : payload.currency) ?? "SAR",
    subtotal,
    shipping_amount: shipping,
    discount_amount: discounts,
    tax_amount: tax,
    total_amount: total,
    payment_gateway: payload.payment_method ?? "salla",
    payment_fee: fee,
    shipping_cost: 0, // filled from catalog/store config when known
    refund_amount: 0,
    status: mapSallaStatus(payload.status),
    ordered_at: dateStr ?? new Date().toISOString(),
    items,
  };
}
