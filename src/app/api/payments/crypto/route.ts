import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isDatabaseConfigured, requireDb, publicSchema } from "@/lib/db";
import {
  createNowPaymentsInvoice,
  isCryptoGatewayConfigured,
} from "@/lib/providers/nowpayments";
import { recordCryptoPendingPayment } from "@/lib/subscription/renewal";

export const dynamic = "force-dynamic";

/**
 * ── Automated crypto checkout (USDT via NOWPayments) ──────────────────────────
 * POST /api/payments/crypto
 *
 * Creates a hosted crypto invoice for the signed-in user's subscription and
 * files a `pending_payments` row keyed by the returned order id. When the payer
 * completes the transfer, POST /api/webhooks/payments auto-approves it — no
 * manual admin step. The manual Binance Pay form on /renew stays as fallback.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, error: "You must be signed in." }, { status: 401 });
  }
  if (!isCryptoGatewayConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: "Automated crypto checkout is not configured.",
        hint: "Set CRYPTO_PAYMENT_API_KEY — or use the manual Binance Pay option below.",
      },
      { status: 503 },
    );
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Database is not configured (DATABASE_URL)." },
      { status: 503 },
    );
  }

  // Resolve the plan to charge (default plan first).
  let planCode: string | null = null;
  let amountUsd = 30;
  let currency = "USD";
  const { subscriptionPlans } = publicSchema;
  const plans = await requireDb()
    .select()
    .from(subscriptionPlans)
    .orderBy(subscriptionPlans.monthlyPrice);
  const plan = plans.find((p) => p.isDefault) ?? plans[0] ?? null;
  if (plan) {
    planCode = plan.code;
    amountUsd = plan.monthlyPrice;
    currency = plan.currency;
  }

  const origin =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;
  const orderId = `sub_${userId}_${Date.now()}`;

  const invoice = await createNowPaymentsInvoice({
    orderId,
    priceAmount: amountUsd,
    priceCurrency: currency,
    description: plan ? `Subscription renewal — ${plan.name}` : "Subscription renewal",
    ipnCallbackUrl: `${origin}/api/webhooks/payments`,
    successUrl: `${origin}/renew?paid=1`,
    cancelUrl: `${origin}/renew`,
  });

  if (!invoice.ok) {
    return NextResponse.json({ ok: false, error: invoice.error }, { status: 502 });
  }

  const recorded = await recordCryptoPendingPayment({
    userId,
    orderId: invoice.orderId || orderId,
    amountUsd,
    planCode,
  });
  if (!recorded.ok) {
    return NextResponse.json({ ok: false, error: recorded.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    invoiceUrl: invoice.invoiceUrl,
    orderId: invoice.orderId || orderId,
  });
}

export async function GET() {
  return NextResponse.json({
    name: "Crypto checkout endpoint (NOWPayments)",
    method: "POST",
    configured: isCryptoGatewayConfigured(),
    hint: "Returns a hosted invoice URL; payment confirmation is handled by /api/webhooks/payments.",
  });
}
