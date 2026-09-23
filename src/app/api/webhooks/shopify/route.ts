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
 * Signature: `X-Shopify-Hmac-SHA256` = base64(HMAC-SHA256(SHOPIFY_WEBHOOK_SECRET, body)).
 * The raw body is read BEFORE JSON parsing so verification covers exact bytes.
 *
 * Every failure mode is logged with a `[shopify-webhook]` prefix so it shows up
 * in `vercel logs` / server console: bad signatures, unknown stores, parse
 * errors, and order-save failures.
 */

function storeIdFrom(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get("store_id") ?? request.headers.get("x-store-id");
}

/** Topics we book; anything else is acked 200 without processing. */
const SUPPORTED_TOPICS = new Set(["orders/create", "orders/paid", "orders/updated", "orders/cancelled", "orders/refund"]);

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const topic = request.headers.get("x-shopify-topic") ?? "unknown";
  const shopDomain = request.headers.get("x-shopify-shop-domain") ?? "unknown";
  const webhookId = request.headers.get("x-shopify-webhook-id") ?? "unknown";

  console.log(
    `[shopify-webhook] received topic=${topic} shop=${shopDomain} webhook_id=${webhookId} bytes=${rawBody.length}`,
  );

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error(
      `[shopify-webhook] FAILED to parse JSON body — topic=${topic} shop=${shopDomain} body[:200]=${rawBody.slice(0, 200)}`,
    );
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
    // Signature failures MUST be loud — they mean either a secret mismatch or
    // someone probing the endpoint. Show up in Vercel logs with full context.
    console.error(
      `[shopify-webhook] SIGNATURE VERIFICATION FAILED — reason="${verification.reason}" ` +
        `topic=${topic} shop=${shopDomain} webhook_id=${webhookId} ` +
        `secretConfigured=${Boolean(process.env.SHOPIFY_WEBHOOK_SECRET)} ` +
        `receivedHmac=${(request.headers.get("x-shopify-hmac-sha256") ?? "").slice(0, 12)}…`,
    );
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

  // Ignore topics we don't book (webhooks/ping, products/*, app/uninstalled…).
  if (!SUPPORTED_TOPICS.has(topic)) {
    console.log(`[shopify-webhook] ignored topic=${topic} (not an order event)`);
    return NextResponse.json({ ok: true, ignored: true, topic });
  }

  // Resolve the target store: explicit id wins, then the shop domain header.
  let storeId = storeIdFrom(request);
  if (!storeId && shopDomain !== "unknown") {
    const resolved = await resolveStoreByDomain(shopDomain);
    if (resolved) {
      storeId = resolved.storeId;
      console.log(`[shopify-webhook] resolved shop=${shopDomain} → store=${storeId}`);
    } else {
      console.error(
        `[shopify-webhook] UNKNOWN STORE — shop=${shopDomain} is not connected in the app. ` +
          `Connect the store (domain must match exactly) or pass ?store_id=<uuid> in the webhook URL.`,
      );
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

  // Log a compact summary of the incoming order (full payload is stored in the
  // integration_events table; this line makes Vercel logs useful at a glance).
  const orderName = typeof payload.name === "string" ? payload.name : `#${String(payload.id ?? "?")}`;
  console.log(
    `[shopify-webhook] order ${orderName} — financial_status=${String(payload.financial_status ?? "?")} ` +
      `total=${String(payload.total_price ?? "?")} ${String(payload.currency ?? "")} line_items=${Array.isArray(payload.line_items) ? payload.line_items.length : 0}`,
  );

  const normalized = normalizeShopifyOrder(payload as never);
  const result = await processOrderWebhook({
    provider: "shopify",
    storeId,
    storeCurrency: String(payload.currency ?? "USD"),
    normalized,
    eventType: topic,
    rawPayload: payload,
  });

  if (!result.ok) {
    // Order failed to save — print the reason (already recorded in
    // integration_events with the full payload by the ingest pipeline).
    console.error(
      `[shopify-webhook] ORDER SAVE FAILED — order=${orderName} store=${storeId} topic=${topic}: ${result.message}`,
    );
    return NextResponse.json(result, { status: 500 });
  }

  console.log(`[shopify-webhook] order ${orderName} processed: ${result.message}`);
  return NextResponse.json(result, { status: 200 });
}

export async function GET() {
  return NextResponse.json({
    name: "Shopify webhook endpoint",
    expectedHeaders: ["X-Shopify-Hmac-SHA256", "X-Shopify-Shop-Domain", "X-Shopify-Topic"],
    events: ["orders/create", "orders/paid", "orders/updated", "orders/cancelled", "orders/refund"],
    storeResolution: "?store_id=<uuid> (or X-Store-Id), else X-Shopify-Shop-Domain lookup",
    hint: "Create the webhook in Shopify admin with a secret matching SHOPIFY_WEBHOOK_SECRET. Signature is base64(HMAC-SHA256(secret, rawBody)).",
  });
}
