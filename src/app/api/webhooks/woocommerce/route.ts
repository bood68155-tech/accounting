import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { normalizeWooOrder } from "@/lib/providers/woo";
import { processOrderWebhook } from "@/lib/webhooks/ingest";
import { DEMO_STORE_ID } from "@/lib/data/demo";

export const dynamic = "force-dynamic";

function verifyWooSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!secret) return true; // no secret configured — skip verification
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const signature = request.headers.get("x-wc-webhook-signature");
  const secret = process.env.WOO_CONSUMER_SECRET ?? "";
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
  const storeId = request.nextUrl.searchParams.get("store_id") ?? request.headers.get("x-store-id") ?? DEMO_STORE_ID;

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
