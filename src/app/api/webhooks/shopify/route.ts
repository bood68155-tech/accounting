import { NextRequest, NextResponse } from "next/server";
import { verifyShopifyWebhook, normalizeShopifyOrder } from "@/lib/providers/shopify";
import { processOrderWebhook, resolveStoreByDomain } from "@/lib/webhooks/ingest";

export const dynamic = "force-dynamic";

/**
 * ── Shopify webhook endpoint ──────────────────────────────────────────────────
 * The store can be addressed in two ways:
 *   1. `?store_id=<uuid>` (or an `X-Store-Id` header) — shown in the app's
 *      connect wizard;
 *   2. nothing at all — the store is resolved from the `X-Shopify-Shop-Domain`
 *      header Shopify sends with every webhook (cross-tenant lookup by domain).
 *
 * Signature: `X-Shopify-Hmac-SHA256` = HMAC-SHA256(SHOPIFY_WEBHOOK_SECRET, body).
 * The raw body is read BEFORE JSON parsing so verification covers exact bytes.
 */

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

  // Verify first: nothing is processed or revealed before the payload is
  // proven to come from Shopify.
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

  // Resolve the target store: explicit id wins, then the shop domain header.
  let storeId = storeIdFrom(request);
  if (!storeId) {
    const shopDomain = request.headers.get("x-shopify-shop-domain");
    if (shopDomain) {
      const resolved = await resolveStoreByDomain(shopDomain);
      if (resolved) storeId = resolved.storeId;
    }
  }
  if (!storeId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Unknown store — connect the store in the app first (its domain must match X-Shopify-Shop-Domain), or pass ?store_id=<uuid>.",
      },
      { status: 404 },
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
    expectedHeaders: ["X-Shopify-Hmac-SHA256", "X-Shopify-Shop-Domain", "X-Shopify-Topic"],
    events: ["orders/create", "orders/refund"],
    storeResolution: "?store_id=<uuid> (or X-Store-Id), else X-Shopify-Shop-Domain lookup",
    hint: "Create the webhook in Shopify admin with a secret matching SHOPIFY_WEBHOOK_SECRET.",
  });
}
