import { NextRequest, NextResponse } from "next/server";
import { verifyPayPalWebhook, normalizePayPalOrder, normalizePayPalSale } from "@/lib/providers/paypal";
import { processOrderWebhook, processPaymentWebhook } from "@/lib/webhooks/ingest";

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

  const verification = await verifyPayPalWebhook({
    rawBody,
    transmissionId: request.headers.get("paypal-transmission-id"),
    transmissionTime: request.headers.get("paypal-transmission-time"),
    certUrl: request.headers.get("paypal-cert-url"),
    authAlgo: request.headers.get("paypal-auth-algo"),
    signature: request.headers.get("paypal-transmission-sig"),
    webhookId: process.env.PAYPAL_WEBHOOK_ID ?? null,
  });

  if (!verification.valid) {
    const configured = Boolean(process.env.PAYPAL_WEBHOOK_ID);
    return NextResponse.json(
      {
        ok: false,
        error: verification.reason,
        ...(configured ? {} : { hint: "Set PAYPAL_WEBHOOK_ID to enable signature verification." }),
      },
      { status: configured ? 401 : 503 },
    );
  }

  const eventType = String(payload.event_type ?? "unknown");
  const resource = (payload.resource ?? payload) as Record<string, unknown>;

  if (eventType === "CHECKOUT.ORDER.APPROVED" || eventType === "PAYMENT.CAPTURE.COMPLETED") {
    const normalized = normalizePayPalOrder(resource);
    const result = await processOrderWebhook({
      provider: "paypal",
      storeId,
      normalized,
      eventType,
      rawPayload: payload,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (eventType.startsWith("PAYMENT.SALE")) {
    const payment = normalizePayPalSale(resource);
    const result = await processPaymentWebhook({
      provider: "paypal",
      storeId,
      payment,
      eventType,
      rawPayload: payload,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  return NextResponse.json({ ok: true, ignored: eventType }, { status: 200 });
}

export async function GET() {
  return NextResponse.json({
    name: "PayPal webhook endpoint",
    expectedHeaders: ["PayPal-Transmission-Id", "PayPal-Cert-Url", "PayPal-Transmission-Sig"],
    events: ["CHECKOUT.ORDER.APPROVED", "PAYMENT.SALE.COMPLETED", "PAYMENT.CAPTURE.COMPLETED"],
    hint: "Set PAYPAL_WEBHOOK_ID to your webhook's ID from the PayPal developer dashboard.",
  });
}
