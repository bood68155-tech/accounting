import { NextRequest, NextResponse } from "next/server";
import { verifyStripeWebhook, normalizeStripeCharge } from "@/lib/providers/stripe";
import { processPaymentWebhook } from "@/lib/webhooks/ingest";
import { isSupabaseConfigured } from "@/lib/data/config";
import { DEMO_STORE_ID } from "@/lib/data/demo";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const verification = verifyStripeWebhook(
    rawBody,
    request.headers.get("stripe-signature"),
    process.env.STRIPE_WEBHOOK_SECRET ?? "",
  );

  // In demo mode (no secret configured) accept payloads for evaluation.
  const demoUnverified = !verification.valid && !isSupabaseConfigured();
  if (!verification.valid && !demoUnverified) {
    return NextResponse.json({ ok: false, error: verification.reason }, { status: 401 });
  }

  const eventType = String(payload.type ?? "unknown");
  const storeId = request.nextUrl.searchParams.get("store_id") ?? request.headers.get("x-store-id") ?? DEMO_STORE_ID;

  const object = (payload.data as { object?: Record<string, unknown> } | undefined)?.object ?? {};
  const payment = normalizeStripeCharge(object);

  const result = await processPaymentWebhook({
    provider: "stripe",
    storeId,
    payment,
    eventType,
    rawPayload: payload,
  });

  // Stripe expects a 200 as fast as possible.
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET() {
  return NextResponse.json({
    name: "Stripe webhook endpoint",
    expectedHeaders: ["Stripe-Signature"],
    events: ["charge.succeeded", "charge.refunded", "balance_transaction.created"],
    hint: "Set the signing secret in STRIPE_WEBHOOK_SECRET (whsec_…).",
  });
}
