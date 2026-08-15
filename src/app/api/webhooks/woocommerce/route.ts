import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { normalizeWooOrder } from "@/lib/providers/woo";
import { processOrderWebhook } from "@/lib/webhooks/ingest";

export const dynamic = "force-dynamic";

function verifyWooSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!secret) return false; // no secret configured → cannot verify
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const storeId = request.nextUrl.searchParams.get("store_id") ?? request.headers.get("x-store-id");
  if (!storeId) {
    return NextResponse.json(
      { ok: false, error: "Missing store_id — pass ?store_id=<uuid> or an X-Store-Id header." },
      { status: 400 },
    );
  }

  const secret = process.env.WOO_CONSUMER_SECRET ?? "";
  if (!secret) {
    return NextResponse.json(
      {
        ok: false,
        error: "WOO_CONSUMER_SECRET is not configured — cannot verify webhook signatures.",
        hint: "Set WOO_CONSUMER_SECRET to enable signature verification.",
      },
      { status: 503 },
    );
  }

  const signature = request.headers.get("x-wc-webhook-signature");
  if (!verifyWooSignature(rawBody, signature, secret)) {
    return NextResponse.json({ ok: false, error: "Signature mismatch" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const eventType = request.headers.get("x-wc-webhook-topic") ?? "order.updated";

  const normalized = normalizeWooOrder(payload);
  const result = await processOrderWebhook({
    provider: "woocommerce",
    storeId,
    storeCurrency: String(payload.currency ?? "USD"),
    normalized,
    eventType,
    rawPayload: payload,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET() {
  return NextResponse.json({
    name: "WooCommerce webhook endpoint",
    expectedHeaders: ["X-Wc-Webhook-Signature", "X-Wc-Webhook-Source"],
    events: ["order.completed", "order.refunded"],
    hint: "WooCommerce signs webhooks with your consumer secret (WOO_CONSUMER_SECRET).",
  });
}
