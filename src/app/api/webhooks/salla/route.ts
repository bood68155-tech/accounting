import { NextRequest, NextResponse } from "next/server";
import { verifySallaWebhook, normalizeSallaOrder } from "@/lib/providers/salla";
import { processOrderWebhook } from "@/lib/webhooks/ingest";

export const dynamic = "force-dynamic";

/**
 * ── Salla webhook endpoint ────────────────────────────────────────────────────
 * Receives Salla store events (order.created, order.updated, …) for connected
 * Salla stores.
 *
 * The store is addressed in two ways:
 *   1. `?store_id=<uuid>` (or an `X-Store-Id` header) — shown in the app;
 *   2. nothing — Salla app webhooks carry the merchant context implicitly, so
 *      fall back to the tenant whose Salla store matches the payload merchant
 *      (handled upstream via store registry when a single Salla store exists).
 *
 * Signature (per docs.salla.dev): `X-Salla-Signature` =
 * HMAC-SHA256(SALLA_WEBHOOK_SECRET, raw body) as lowercase hex, compared
 * timing-safe. The raw body is read BEFORE JSON parsing so verification covers
 * the exact bytes Salla signed.
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
  // proven to come from Salla.
  const verification = verifySallaWebhook(
    rawBody,
    request.headers.get("x-salla-signature"),
    process.env.SALLA_WEBHOOK_SECRET ?? "",
  );

  if (!verification.valid) {
    const configured = Boolean(process.env.SALLA_WEBHOOK_SECRET);
    return NextResponse.json(
      {
        ok: false,
        error: verification.reason,
        ...(configured ? {} : { hint: "Set SALLA_WEBHOOK_SECRET to enable signature verification." }),
      },
      { status: configured ? 401 : 503 },
    );
  }

  const storeId = storeIdFrom(request);
  if (!storeId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Unknown store — pass ?store_id=<uuid> (shown in the app's connect wizard). Salla events do not carry a resolvable store domain.",
      },
      { status: 404 },
    );
  }

  const event = (payload.event ?? payload.webhook_event ?? "order.created") as string;
  const merchant = payload.merchant as number | undefined;
  const normalized = normalizeSallaOrder(payload as never);

  const result = await processOrderWebhook({
    provider: "salla",
    storeId,
    storeCurrency: "SAR",
    normalized,
    eventType: String(event),
    rawPayload: { ...payload, merchant },
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET() {
  return NextResponse.json({
    name: "Salla webhook endpoint",
    expectedHeaders: ["X-Salla-Signature", "X-Salla-Security-Strategy"],
    events: ["order.created", "order.updated", "order.status.updated"],
    storeResolution: "?store_id=<uuid> (or X-Store-Id header)",
    hint: "Register the webhook in the Salla Partner dashboard with the secret matching SALLA_WEBHOOK_SECRET (signature security strategy).",
  });
}
