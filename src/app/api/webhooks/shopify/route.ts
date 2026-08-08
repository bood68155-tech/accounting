import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyWebhook, normalizeShopifyOrder } from "@/lib/providers/shopify";
import { processOrderWebhook } from "@/lib/webhooks/ingest";
import { isSupabaseConfigured } from "@/lib/data/config";
import { DEMO_STORE_ID } from "@/lib/data/demo";

export const dynamic = "force-dynamic";

function storeIdFrom(request: NextRequest): string {
  return request.nextUrl.searchParams.get("store_id") ?? request.headers.get("x-store-id") ?? DEMO_STORE_ID;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const verification = verifyShopifyWebhook(
    rawBody,
    request.headers.get("x-shopify-hmac-sha256"),
    process.env.SHOPIFY_WEBHOOK_SECRET ?? "",
  );

  // In demo mode (no secret configured) accept payloads for evaluation.
  const demoUnverified = !verification.valid && !isSupabaseConfigured();
  if (!verification.valid && !demoUnverified) {
    return NextResponse.json({ ok: false, error: verification.reason }, { status: 401 });
  }

  const storeId = storeIdFrom(request);
  const normalized = normalizeShopifyOrder(payload);
  const result = await processOrderWebhook({
    provider: "shopify",
    storeId,
    storeCurrency: String(payload.currency ?? "USD"),
    normalized,
    eventType: request.headers.get("x-shopify-topic") ?? "orders/create",
    rawPayload: payload,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET() {
  return NextResponse.json({
    name: "Shopify webhook endpoint",
    expectedHeaders: ["X-Shopify-Hmac-SHA256"],
    events: ["orders/create", "orders/refund"],
    hint: "Create the webhook in Shopify admin with a secret matching SHOPIFY_WEBHOOK_SECRET.",
  });
}
