import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import {
  verifyNowPaymentsWebhook,
  normalizeNowPaymentsPayment,
} from "@/lib/providers/nowpayments";
import {
  approvePendingPayment,
  findPendingPaymentByTxId,
  recordCryptoPendingPayment,
  type ApprovePendingPaymentResult,
} from "@/lib/subscription/renewal";
import { isDatabaseConfigured, requireDb, publicSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * ── Automated crypto payment webhook (NOWPayments IPN) ────────────────────────
 * POST /api/webhooks/payments
 *
 * On a confirmed/finished payment event the matching `pending_payments` row is
 * flipped `pending → approved` and the owner's subscription is activated — no
 * manual admin approval. Idempotent, so gateway retries are safe.
 *
 * The manual Binance Pay flow (POSTing a TxID from /renew) is untouched and
 * remains the fallback when the gateway is unconfigured or unavailable.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const verification = verifyNowPaymentsWebhook(
    rawBody,
    request.headers.get("x-nowpayments-sig"),
    process.env.CRYPTO_WEBHOOK_SECRET ?? "",
  );
  if (!verification.valid) {
    const configured = Boolean(process.env.CRYPTO_WEBHOOK_SECRET);
    return NextResponse.json(
      {
        ok: false,
        error: verification.reason,
        ...(configured
          ? {}
          : { hint: "Set CRYPTO_WEBHOOK_SECRET (NOWPayments IPN secret) to enable verification." }),
      },
      { status: configured ? 401 : 503 },
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Database is not configured (DATABASE_URL)." },
      { status: 503 },
    );
  }

  const payment = normalizeNowPaymentsPayment(payload);
  if (!payment.paid) {
    // Non-terminal events (waiting/confirming/failed/expired) are acknowledged
    // so the gateway stops retrying; nothing is approved yet.
    return NextResponse.json({ ok: true, ignored: payment.status }, { status: 200 });
  }

  // Match on the order id we set when creating the invoice, falling back to the
  // gateway payment id.
  const reference = payment.orderId || payment.paymentId;
  let pending = await findPendingPaymentByTxId(reference);
  if (!pending && payment.paymentId) {
    pending = await findPendingPaymentByTxId(payment.paymentId);
  }

  // Recover the owner from an `sub_<userId>_<timestamp>` order id if the pending
  // row was never recorded (e.g. a retried callback after a partial failure).
  if (!pending && payment.orderId.startsWith("sub_")) {
    const userId = payment.orderId.split("_")[1];
    if (userId) {
      await recordCryptoPendingPayment({
        userId,
        orderId: payment.orderId,
        amountUsd: payment.priceAmount,
        planCode: null,
      });
      pending = await findPendingPaymentByTxId(payment.orderId);
    }
  }

  if (!pending) {
    // Unknown reference — acknowledge without approving anything.
    return NextResponse.json(
      { ok: true, ignored: "unmatched_payment", reference },
      { status: 200 },
    );
  }

  // Resolve the plan from the code the user checked out with, when known.
  let planId: string | undefined;
  if (pending.planCode) {
    const { subscriptionPlans } = publicSchema;
    const plan = await requireDb()
      .select({ id: subscriptionPlans.id })
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.code, pending.planCode.toLowerCase()))
      .limit(1);
    if (plan[0]) planId = plan[0].id;
  }

  let result: ApprovePendingPaymentResult;
  try {
    result = await approvePendingPayment({
      paymentId: pending.id,
      reviewedBy: `crypto-gateway:${payment.paymentId || "nowpayments"}`,
      notes: `Auto-approved by crypto webhook (${payment.payCurrency ?? payment.priceCurrency} ${payment.actuallyPaid ?? payment.payAmount ?? payment.priceAmount})`,
      planId,
    });
  } catch (error) {
    console.error("[webhooks/payments] auto-approval failed:", error);
    return NextResponse.json(
      { ok: false, error: `Auto-approval failed: ${String(error)}` },
      { status: 500 },
    );
  }

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: true,
      approved: !result.alreadyApproved,
      alreadyApproved: result.alreadyApproved,
      txId: pending.txId,
      paymentStatus: payment.status,
    },
    { status: 200 },
  );
}

export async function GET() {
  return NextResponse.json({
    name: "Crypto payment webhook endpoint (NOWPayments IPN)",
    expectedHeaders: ["x-nowpayments-sig"],
    events: ["payment_status: finished | confirmed"],
    hint: "Set CRYPTO_PAYMENT_API_KEY (create invoices) and CRYPTO_WEBHOOK_SECRET (verify IPN).",
  });
}
