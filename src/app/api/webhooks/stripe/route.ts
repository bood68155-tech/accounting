import { NextRequest, NextResponse } from "next/server";
import { verifyStripeWebhook, normalizeStripeCharge } from "@/lib/providers/stripe";
import { processPaymentWebhook } from "@/lib/webhooks/ingest";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const storeId = request.nextUrl.searchParams.get("store_id") ?? request.headers.get("x-store-id");
  if (!storeId) {
    return NextResponse.json(
      { ok: false, error: "Missing store_id — pass ?store_id=<uuid> or an X-Store-Id header." },
      { status: 400 },
    );
  }

  const verification = verifyStripeWebhook(
    rawBody,
    request.headers.get("stripe-signature"),
    process.env.STRIPE_WEBHOOK_SECRET ?? "",
  );

  if (!verification.valid) {
    const configured = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
    return NextResponse.json(
      {
        ok: false,
        error: verification.reason,
        ...(configured ? {} : { hint: "Set STRIPE_WEBHOOK_SECRET (whsec_…) to enable signature verification." }),
      },
      { status: configured ? 401 : 503 },
    );
  }

  const eventType = String(payload.type ?? "unknown");
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
