import { createHmac, timingSafeEqual } from "node:crypto";
import type { SignatureVerification } from "@/lib/providers/types";

/**
 * ── NOWPayments adapter (USDT / crypto payment gateway) ───────────────────────
 * Webhook: POST /api/webhooks/payments   (IPN — payment confirmation events)
 * Verification: `x-nowpayments-sig` header — HMAC-SHA512(ipn_secret, sortedBody)
 * where sortedBody is the JSON body with keys sorted alphabetically (recursively)
 * and no extra whitespace. Hex, timing-safe comparison.
 *
 * Invoices are created via the REST API (`x-api-key`) and pay a fixed fiat price;
 * the payer picks the crypto/USDT rail on the hosted checkout.
 */

const NOWPAYMENTS_API_BASE = "https://api.nowpayments.io/v1";

/** Payment statuses that mean the money actually arrived — auto-approve these. */
const PAID_STATUSES = new Set(["finished", "confirmed"]);

/** True when the API key that creates crypto invoices is present. */
export function isCryptoGatewayConfigured(): boolean {
  return Boolean(process.env.CRYPTO_PAYMENT_API_KEY);
}

/** Recursively sort object keys so the signed body is deterministic. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys(obj[key]);
        return acc;
      }, {});
  }
  return value;
}

export function verifyNowPaymentsWebhook(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
): SignatureVerification {
  if (!signatureHeader) return { valid: false, reason: "Missing x-nowpayments-sig header" };
  if (!secret) return { valid: false, reason: "CRYPTO_WEBHOOK_SECRET is not configured" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { valid: false, reason: "Invalid JSON body" };
  }

  const canonical = JSON.stringify(sortKeys(parsed));
  const expected = createHmac("sha512", secret).update(canonical, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signatureHeader.trim(), "utf8");

  if (a.length !== b.length) return { valid: false, reason: "Signature length mismatch" };
  return timingSafeEqual(a, b)
    ? { valid: true }
    : { valid: false, reason: "Signature mismatch" };
}

export interface NormalizedCryptoPayment {
  /** NOWPayments payment id. */
  paymentId: string;
  /** The order id we passed when creating the invoice (our pending-payment tx id). */
  orderId: string;
  status: string;
  /** Fiat amount we asked for. */
  priceAmount: number;
  priceCurrency: string;
  /** Crypto actually received. */
  payAmount: number | null;
  payCurrency: string | null;
  /** Amount the payer actually sent (may differ on partial payments). */
  actuallyPaid: number | null;
  paid: boolean;
  paidAt: string;
}

function num(value: unknown): number | null {
  const n = typeof value === "string" ? Number.parseFloat(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Normalize a NOWPayments IPN payload into a canonical payment. */
export function normalizeNowPaymentsPayment(payload: Record<string, unknown>): NormalizedCryptoPayment {
  const status = String(payload.payment_status ?? "unknown");
  return {
    paymentId: String(payload.payment_id ?? ""),
    orderId: String(payload.order_id ?? ""),
    status,
    priceAmount: num(payload.price_amount) ?? 0,
    priceCurrency: String(payload.price_currency ?? "usd").toUpperCase(),
    payAmount: num(payload.pay_amount),
    payCurrency: payload.pay_currency ? String(payload.pay_currency) : null,
    actuallyPaid: num(payload.actually_paid),
    paid: PAID_STATUSES.has(status),
    paidAt: String(payload.updated_at ?? payload.created_at ?? new Date().toISOString()),
  };
}

export interface CreateInvoiceInput {
  orderId: string;
  priceAmount: number;
  priceCurrency?: string;
  description?: string;
  ipnCallbackUrl: string;
  successUrl?: string;
  cancelUrl?: string;
}

export type CreateInvoiceResult =
  | { ok: true; invoiceId: string; invoiceUrl: string; orderId: string }
  | { ok: false; error: string };

/** Create a hosted crypto checkout invoice and return its URL. */
export async function createNowPaymentsInvoice(
  input: CreateInvoiceInput,
): Promise<CreateInvoiceResult> {
  const apiKey = process.env.CRYPTO_PAYMENT_API_KEY;
  if (!apiKey) return { ok: false, error: "CRYPTO_PAYMENT_API_KEY is not configured." };

  const body: Record<string, unknown> = {
    price_amount: input.priceAmount,
    price_currency: (input.priceCurrency ?? "usd").toLowerCase(),
    order_id: input.orderId,
    order_description: input.description ?? "Subscription renewal",
    ipn_callback_url: input.ipnCallbackUrl,
    is_fixed_rate: true,
    is_fee_paid_by_user: false,
  };
  if (input.successUrl) body.success_url = input.successUrl;
  if (input.cancelUrl) body.cancel_url = input.cancelUrl;

  try {
    const response = await fetch(`${NOWPAYMENTS_API_BASE}/invoice`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { ok: false, error: `NOWPayments rejected the invoice (${response.status}). ${detail.slice(0, 300)}` };
    }
    const json = (await response.json()) as Record<string, unknown>;
    const invoiceUrl = json.invoice_url ? String(json.invoice_url) : "";
    if (!invoiceUrl) return { ok: false, error: "NOWPayments did not return an invoice URL." };
    return {
      ok: true,
      invoiceId: String(json.id ?? ""),
      invoiceUrl,
      orderId: String(json.order_id ?? input.orderId),
    };
  } catch (error) {
    return { ok: false, error: `Could not reach NOWPayments: ${String(error)}` };
  }
}
