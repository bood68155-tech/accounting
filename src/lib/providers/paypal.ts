import { verify } from "node:crypto";
import type {
  NormalizedOrder,
  NormalizedPayment,
  SignatureVerification,
} from "@/lib/providers/types";
import { money } from "@/lib/providers/types";

/**
 * ── PayPal adapter ────────────────────────────────────────────────────────────
 * Webhook: POST /api/webhooks/paypal  (CHECKOUT.ORDER.APPROVED, PAYMENT.SALE.COMPLETED…)
 * Verification: PayPal signs `transmission_id|transmission_time|webhook_id|crc32(payload)`
 * with the certificate fetched from `cert_url`; we verify with the TLS public key.
 */

export async function verifyPayPalWebhook(params: {
  rawBody: string;
  transmissionId?: string | null;
  transmissionTime?: string | null;
  certUrl?: string | null;
  authAlgo?: string | null;
  signature?: string | null;
  webhookId?: string | null;
}): Promise<SignatureVerification> {
  const {
    rawBody,
    transmissionId,
    transmissionTime,
    certUrl,
    authAlgo,
    signature,
    webhookId,
  } = params;

  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !signature) {
    return { valid: false, reason: "Missing PayPal webhook verification headers" };
  }
  if (!webhookId) return { valid: false, reason: "PAYPAL_WEBHOOK_ID is not configured" };
  const transmissionTimeMs = new Date(transmissionTime).getTime();
  if (Number.isNaN(transmissionTimeMs) || Date.now() - transmissionTimeMs > 5 * 60 * 1000) {
    return { valid: false, reason: "PayPal transmission is too old (possible replay)" };
  }
  if (authAlgo !== "SHA256withRSA") return { valid: false, reason: `Unsupported algorithm: ${authAlgo}` };

  const crc = crc32(rawBody) >>> 0;
  const message = `${transmissionId}|${transmissionTime}|${webhookId}|${crc}`;

  try {
    const certResponse = await fetch(certUrl, { cache: "no-store" });
    if (!certResponse.ok) return { valid: false, reason: `Cert fetch failed: ${certResponse.status}` };
    const pem = await certResponse.text();
    const ok = verify("sha256", Buffer.from(message, "utf8"), pem, Buffer.from(signature, "base64"));
    return ok ? { valid: true } : { valid: false, reason: "PayPal signature mismatch" };
  } catch (error) {
    return { valid: false, reason: `PayPal verification error: ${String(error)}` };
  }
}

/** CRC-32 (IEEE), used by PayPal webhook identity. */
export function crc32(input: string): number {
  let crc = 0xffffffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i);
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface PayPalPurchaseUnit {
  reference_id?: string;
  amount?: {
    currency_code?: string;
    value?: string;
    breakdown?: {
      item_total?: { currency_code?: string; value?: string };
      shipping?: { currency_code?: string; value?: string };
      discount?: { currency_code?: string; value?: string };
      tax_total?: { currency_code?: string; value?: string };
    };
  };
  items?: Array<{
    name?: string;
    sku?: string;
    quantity?: string;
    unit_amount?: { currency_code?: string; value?: string };
  }>;
  shipping?: { address?: { address_line_1?: string } };
}

interface PayPalOrderPayload {
  id?: string;
  status?: string;
  create_time?: string;
  purchase_units?: PayPalPurchaseUnit[];
  payer?: { name?: { given_name?: string; surname?: string }; email_address?: string };
}

/** Normalize a PayPal `CHECKOUT.ORDER.APPROVED` / sale payload. */
export function normalizePayPalOrder(payload: PayPalOrderPayload): NormalizedOrder {
  const unit = payload.purchase_units?.[0];
  const breakdown = unit?.amount?.breakdown;
  const currency = unit?.amount?.currency_code ?? "USD";

  const items = (unit?.items ?? []).map((item) => {
    const quantity = Math.max(1, money(item.quantity, 1));
    const unitPrice = money(item.unit_amount?.value);
    return {
      sku: item.sku ?? "",
      name: item.name ?? "Unknown product",
      quantity,
      unit_price: unitPrice,
      unit_cost: 0, // item cost must come from the product catalog
      line_subtotal: round(unitPrice * quantity),
      line_cost: 0,
    };
  });

  const subtotal = money(breakdown?.item_total?.value);
  const shipping = money(breakdown?.shipping?.value);
  const discounts = money(breakdown?.discount?.value);
  const tax = money(breakdown?.tax_total?.value);
  const total = money(unit?.amount?.value) || round(subtotal + shipping + tax - discounts);

  const payer = payload.payer;
  const customerName =
    [payer?.name?.given_name, payer?.name?.surname].filter(Boolean).join(" ") ||
    payer?.email_address ||
    "Guest";

  return {
    external_id: payload.id ?? "",
    order_number: `PP-${(payload.id ?? "").slice(-8)}`,
    customer_name: customerName,
    currency,
    subtotal,
    shipping_amount: shipping,
    discount_amount: discounts,
    tax_amount: tax,
    total_amount: total,
    payment_gateway: "paypal",
    payment_fee: 0,
    shipping_cost: 0,
    refund_amount: 0,
    status: payload.status === "COMPLETED" || payload.status === "APPROVED" ? "paid" : "pending",
    ordered_at: payload.create_time ?? new Date().toISOString(),
    items,
  };
}

/** PayPal sale events carry the gateway fee in `transaction_fee`. */
export function normalizePayPalSale(payload: {
  id?: string;
  create_time?: string;
  amount?: { total?: string; currency?: string };
  transaction_fee?: { value?: string; currency?: string };
  state?: string;
}): NormalizedPayment {
  return {
    external_id: payload.id ?? "",
    currency: (payload.amount?.currency ?? payload.transaction_fee?.currency ?? "USD").toUpperCase(),
    amount: money(payload.amount?.total),
    fee: money(payload.transaction_fee?.value),
    net: round(money(payload.amount?.total) - money(payload.transaction_fee?.value)),
    status: payload.state ?? "completed",
    paid_at: payload.create_time ?? new Date().toISOString(),
    gateway: "paypal",
  };
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
