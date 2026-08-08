import { createHmac, timingSafeEqual } from "node:crypto";
import type { NormalizedPayment, SignatureVerification } from "@/lib/providers/types";
import { money } from "@/lib/providers/types";

/**
 * ── Stripe adapter ────────────────────────────────────────────────────────────
 * Webhook: POST /api/webhooks/stripe  (charge.succeeded, charge.refunded…)
 * Verification: `Stripe-Signature` header — t=<timestamp>,v1=<hmac>
 * HMAC-SHA256(secret, `${t}.${rawBody}`), hex, timing-safe comparison.
 */

export function verifyStripeWebhook(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
): SignatureVerification {
  if (!signatureHeader) return { valid: false, reason: "Missing Stripe-Signature header" };
  if (!secret) return { valid: false, reason: "STRIPE_WEBHOOK_SECRET is not configured" };

  const parts = signatureHeader.split(",").map((p) => p.trim());
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  const signature = parts.find((p) => p.startsWith("v1="))?.slice(3);
  if (!timestamp || !signature) return { valid: false, reason: "Malformed Stripe-Signature header" };
  const timestampSeconds = parseInt(timestamp, 10);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > 300) {
    return { valid: false, reason: "Stripe webhook timestamp is too old (possible replay)" };
  }

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");

  if (a.length !== b.length) return { valid: false, reason: "Signature length mismatch" };
  return timingSafeEqual(a, b)
    ? { valid: true }
    : { valid: false, reason: "Signature mismatch" };
}

interface StripeBalanceTransaction {
  fee?: number;
  net?: number;
  currency?: string;
}

interface StripeChargePayload {
  id?: string;
  amount?: number; // cents
  currency?: string;
  status?: string;
  created?: number; // unix seconds
  balance_transaction?: string | StripeBalanceTransaction;
  metadata?: Record<string, string>;
}

/** Normalize a Stripe `charge.succeeded` event into a payment with fee info. */
export function normalizeStripeCharge(payload: StripeChargePayload): NormalizedPayment {
  const balanceTransaction: StripeBalanceTransaction =
    typeof payload.balance_transaction === "object" && payload.balance_transaction
      ? payload.balance_transaction
      : {};

  const amount = money(payload.amount, 0) / 100; // cents → dollars
  const fee = money(balanceTransaction.fee, 0) / 100;
  const net = money(balanceTransaction.net, 0) / 100;

  return {
    external_id: payload.id ?? "",
    order_external_id: payload.metadata?.order_id,
    currency: (payload.currency ?? "usd").toUpperCase(),
    amount,
    fee,
    net: net || round(amount - fee),
    status: payload.status ?? "succeeded",
    paid_at: payload.created ? new Date(payload.created * 1000).toISOString() : new Date().toISOString(),
    gateway: "stripe",
  };
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
