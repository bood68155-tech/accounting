import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyWebhook, normalizeShopifyOrder } from "@/lib/providers/shopify";
import { processOrderWebhook } from "@/lib/webhooks/ingest";

export const dynamic = "force-dynamic";

function storeIdFrom(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get("store_id") ?? request.headers.get("x-store-id");
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const storeId = storeIdFrom(request);
  if (!storeId) {
    return NextResponse.json(
      { ok: false, error: "Missing store_id — pass ?store_id=<uuid> or an X-Store-Id header." },
      { status: 400 },
    );
  }

  const verification = verifyShopifyWebhook(
    rawBody,
    request.headers.get("x-shopify-hmac-sha256"),
    process.env.SHOPIFY_WEBHOOK_SECRET ?? "",
  );

  if (!verification.valid) {
    const configured = Boolean(process.env.SHOPIFY_WEBHOOK_SECRET);
    return NextResponse.json(
      {
        ok: false,
        error: verification.reason,
        ...(configured ? {} : { hint: "Set SHOPIFY_WEBHOOK_SECRET to enable signature verification." }),
      },
      { status: configured ? 401 : 503 },
    );
  }

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
