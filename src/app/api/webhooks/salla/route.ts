import { NextRequest, NextResponse } from "next/server";
import {
  extractSallaWebhook,
  normalizeSallaOrder,
  verifySallaWebhook,
} from "@/lib/providers/salla";
import { processOrderWebhook, resolveStoreByDomain } from "@/lib/webhooks/ingest";
import { getTenantTables, isTenantSchema, publicSchema, requireDb, tenantDb } from "@/lib/db";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * ── Salla webhook endpoint ────────────────────────────────────────────────────
 * Receives Salla store events for connected Salla stores:
 *   • order.created / order.updated — booked (credit sale when pending)
 *   • order.refunded               — booked with refund amounts
 *   • order.status.updated / order.cancelled / order.deleted — cancelled →
 *     auto-reversal of previously posted entries (ERPNext-style)
 *
 * Payload shape (v2, per docs.salla.dev): the order is wrapped in an envelope
 *   { event, merchant, created_at, data: { …order } }
 * — the adapter's extractSallaWebhook() unwraps it (top-level orders from
 * older integrations still work).
 *
 * Store resolution, in order:
 *   1. `?store_id=<uuid>` (or `X-Store-Id` header) — shown in the connect wizard
 *   2. merchant id — the Salla merchant (store) id is saved in the store's
 *      config (`config.merchant`) or equals the domain; resolved across tenants
 *   3. store domain from the payload's admin/customer URL host, when present
 *
 * Signature (per docs.salla.dev): `X-Salla-Signature` =
 * HMAC-SHA256(SALLA_WEBHOOK_SECRET, raw body) as lowercase hex, compared
 * timing-safe. Raw body is read BEFORE JSON parsing so verification covers the
 * exact bytes Salla signed.
 */

/** Events that book/adjust orders; everything else is acked unprocessed. */
const SUPPORTED_EVENTS = new Set([
  "order.created",
  "order.updated",
  "order.refunded",
  "order.status.updated",
  "order.cancelled",
  "order.deleted",
]);

function storeIdFrom(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get("store_id") ?? request.headers.get("x-store-id");
}

/**
 * Resolve the Salla store by merchant id: the merchant number Salla sends on
 * every webhook is stored in stores.config.merchant at connect time. Falls
 * back to null when no store matches.
 */
async function resolveStoreByMerchant(
  merchant: string | number | undefined,
): Promise<{ storeId: string; schemaName: string } | null> {
  if (!merchant || !Number.isFinite(Number(merchant))) return null;
  const merchantStr = String(merchant);

  const { tenants } = publicSchema;
  const tenantRows = await requireDb().select({ schemaName: tenants.schemaName }).from(tenants);
  for (const { schemaName } of tenantRows) {
    if (!isTenantSchema(schemaName)) continue;
    const t = getTenantTables(schemaName);
    const rows = await tenantDb(schemaName)
      .select({ id: t.stores.id, config: t.stores.config })
      .from(t.stores)
      .where(eq(t.stores.platform, "salla"));
    for (const row of rows) {
      const config = (row.config ?? {}) as Record<string, unknown>;
      if (
        config.merchant === merchantStr ||
        config.merchant === Number(merchantStr) ||
        String(config.merchant) === merchantStr
      ) {
        return { storeId: row.id, schemaName };
      }
    }
  }
  return null;
}

/** Best-effort domain extraction from the payload's Salla URLs. */
function domainFromPayload(payload: Record<string, unknown>): string | null {
  const data = (payload.data ?? payload) as Record<string, unknown>;
  const urls = data.urls as { admin?: string; customer?: string } | undefined;
  for (const candidate of [urls?.admin, urls?.customer]) {
    if (typeof candidate === "string" && candidate.startsWith("http")) {
      try {
        const host = new URL(candidate).hostname;
        // Salla hosts look like <store>.salla.sa or <store>.zid.shop —
        // only accept subdomains of salla.sa (the merchant's own domain).
        if (host.endsWith(".salla.sa")) return host;
      } catch {
        /* not a URL — skip */
      }
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error("[salla-webhook] FAILED to parse JSON body:", rawBody.slice(0, 200));
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
    console.error(
      `[salla-webhook] SIGNATURE VERIFICATION FAILED — reason="${verification.reason}" secretConfigured=${configured}`,
    );
    return NextResponse.json(
      {
        ok: false,
        error: verification.reason,
        ...(configured ? {} : { hint: "Set SALLA_WEBHOOK_SECRET to enable signature verification." }),
      },
      { status: configured ? 401 : 503 },
    );
  }

  const { event, merchant, order: sallaOrder } = extractSallaWebhook(payload);
  if (!event) {
    return NextResponse.json({ ok: false, error: "Missing event field." }, { status: 400 });
  }
  if (!SUPPORTED_EVENTS.has(event)) {
    console.log(`[salla-webhook] ignored event=${event} (not an order event we book)`);
    return NextResponse.json({ ok: true, ignored: true, event });
  }

  // Resolve the target store: explicit id → merchant id → payload domain.
  let storeId = storeIdFrom(request);
  if (!storeId && merchant) {
    const resolved = await resolveStoreByMerchant(merchant);
    if (resolved) {
      storeId = resolved.storeId;
      console.log(`[salla-webhook] resolved merchant=${merchant} → store=${storeId}`);
    }
  }
  if (!storeId) {
    const domain = domainFromPayload(payload);
    if (domain) {
      const resolved = await resolveStoreByDomain(domain);
      if (resolved) {
        storeId = resolved.storeId;
        console.log(`[salla-webhook] resolved domain=${domain} → store=${storeId}`);
      }
    }
  }
  if (!storeId) {
    console.error(
      `[salla-webhook] UNKNOWN STORE — event=${event} merchant=${merchant ?? "?"}. ` +
        `Pass ?store_id=<uuid>, or save the merchant id in the store's config ({"merchant": ${merchant ?? "…"}}).`,
    );
    return NextResponse.json(
      {
        ok: false,
        error:
          "Unknown store — pass ?store_id=<uuid> or save the Salla merchant id in the store config ({\"merchant\": <id>}).",
      },
      { status: 404 },
    );
  }

  const normalized = normalizeSallaOrder(sallaOrder);
  const orderLabel = normalized.order_number || String(sallaOrder.id ?? "?");
  console.log(
    `[salla-webhook] event=${event} order=${orderLabel} status=${normalized.status} ` +
      `total=${normalized.total_amount} ${normalized.currency} items=${normalized.items.length}`,
  );

  const result = await processOrderWebhook({
    provider: "salla",
    storeId,
    storeCurrency: normalized.currency || "SAR",
    normalized,
    eventType: event,
    rawPayload: payload,
  });

  if (!result.ok) {
    console.error(`[salla-webhook] ORDER SAVE FAILED — order=${orderLabel} event=${event}: ${result.message}`);
    return NextResponse.json(result, { status: 500 });
  }
  console.log(`[salla-webhook] order ${orderLabel} processed: ${result.message}`);
  return NextResponse.json(result, { status: 200 });
}

export async function GET() {
  return NextResponse.json({
    name: "Salla webhook endpoint",
    expectedHeaders: ["X-Salla-Signature", "X-Salla-Security-Strategy"],
    events: [...SUPPORTED_EVENTS],
    storeResolution:
      "?store_id=<uuid> (or X-Store-Id) → stores.config.merchant (Salla merchant id) → payload URL domain",
    hint: "Register the webhook in the Salla Partner dashboard with the secret matching SALLA_WEBHOOK_SECRET (signature security strategy). Payloads wrap the order under data{}.",
  });
}
