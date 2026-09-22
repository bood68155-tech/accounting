/**
 * ── Webhook replay (idempotent) ───────────────────────────────────────────────
 *
 * Re-processes failed integration events through the REAL pipeline: the same
 * provider normalizers and the same `processOrderWebhook`/`processPaymentWebhook`
 * functions the live webhook routes call. Because ingestion upserts orders by
 * (store_id, external_id) and skips journal posting when the order already
 * exists, replaying an event that already succeeded is a no-op — replay is
 * idempotent by construction.
 *
 * What it does:
 *   1. Scans every tenant schema (or `--tenant <schema>` to limit).
 *   2. Loads `integration_events` with status = 'failed'.
 *   3. Re-normalizes the stored raw payload with the provider adapter.
 *   4. Re-runs ingestion; marks the event processed/failed accordingly.
 *   5. Events that can't be understood (unknown provider/event) are marked
 *      with a clear reason and left failed instead of looping forever.
 *
 * Safety: it never re-verifies signatures (they were verified on receipt;
 * payloads come straight from your own database), and it never deletes
 * anything — a replay that fails again just updates the event's error field.
 *
 * Usage:
 *   npm run webhooks:replay                    # all tenants
 *   npm run webhooks:replay -- --tenant tenant_xxx   # one tenant schema
 *   npm run webhooks:replay -- --dry-run       # report without writing
 */
import { desc, eq } from "drizzle-orm";
import {
  isDatabaseConfigured,
  isTenantSchema,
  requireDb,
  publicSchema,
  tenantDb,
  getTenantTables,
} from "@/lib/db";
import { processOrderWebhook, processPaymentWebhook } from "@/lib/webhooks/ingest";
import { normalizeShopifyOrder } from "@/lib/providers/shopify";
import { normalizeWooOrder } from "@/lib/providers/woo";
import { normalizePayPalOrder, normalizePayPalSale } from "@/lib/providers/paypal";
import { normalizeSallaOrder } from "@/lib/providers/salla";
import { normalizeStripeCharge } from "@/lib/providers/stripe";
import type { NormalizedOrder, NormalizedPayment } from "@/lib/providers/types";

// ─── CLI flags ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flagValue = (name: string): string | null => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};
const hasFlag = (name: string) => args.includes(`--${name}`);
const DRY_RUN = hasFlag("dry-run");
const TENANT_FILTER = flagValue("tenant");

// ─── payload → normalized model, per provider ─────────────────────────────────

interface ReplayInput {
  provider: string;
  normalizedOrder?: NormalizedOrder;
  normalizedPayment?: NormalizedPayment;
  note?: string;
}

function buildReplayInput(provider: string, eventType: string, payload: Record<string, unknown>): ReplayInput {
  switch (provider) {
    case "shopify":
      return { provider, normalizedOrder: normalizeShopifyOrder(payload as never) };

    case "salla":
      return { provider, normalizedOrder: normalizeSallaOrder(payload as never) };

    case "woocommerce":
      return { provider, normalizedOrder: normalizeWooOrder(payload as never) };

    case "paypal": {
      const type = String(payload.event_type ?? eventType ?? "unknown");
      const resource = (payload.resource ?? payload) as never;
      if (type === "CHECKOUT.ORDER.APPROVED" || type === "PAYMENT.CAPTURE.COMPLETED") {
        return { provider, normalizedOrder: normalizePayPalOrder(resource) };
      }
      if (type.startsWith("PAYMENT.SALE")) {
        return { provider, normalizedPayment: normalizePayPalSale(resource) };
      }
      return { provider, note: `Unsupported PayPal event "${type}"` };
    }

    case "stripe": {
      // Stored payloads are the full Stripe envelope: { id, type, data: { object } }.
      const object = (payload.data as { object?: Record<string, unknown> } | undefined)?.object ?? payload;
      return { provider, normalizedPayment: normalizeStripeCharge(object as never) };
    }

    default:
      return { provider, note: `Unknown provider "${provider}" — cannot normalize.` };
  }
}

// ─── replay pass over one tenant schema ───────────────────────────────────────

interface TenantReplayStats {
  schema: string;
  scanned: number;
  replayed: number;
  succeeded: number;
  failedAgain: number;
  skipped: number;
}

async function replayTenant(schema: string): Promise<TenantReplayStats> {
  const stats: TenantReplayStats = {
    schema,
    scanned: 0,
    replayed: 0,
    succeeded: 0,
    failedAgain: 0,
    skipped: 0,
  };
  const t = getTenantTables(schema);
  const db = tenantDb(schema);

  const failedEvents = await db
    .select()
    .from(t.integrationEvents)
    .where(eq(t.integrationEvents.status, "failed"))
    .orderBy(desc(t.integrationEvents.processedAt))
    .limit(200);
  stats.scanned = failedEvents.length;

  for (const event of failedEvents) {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const input = buildReplayInput(event.provider, event.eventType, payload);

    if (input.note || (!input.normalizedOrder && !input.normalizedPayment)) {
      // Not normalizable — annotate and leave failed so it isn't retried blind.
      stats.skipped += 1;
      console.warn(`  ⚠ [${schema}] event ${event.id} skipped: ${input.note ?? "payload not normalizable"}`);
      if (!DRY_RUN) {
        await db
          .update(t.integrationEvents)
          .set({ error: `Replay skipped: ${input.note ?? "payload not normalizable"}` })
          .where(eq(t.integrationEvents.id, event.id));
      }
      continue;
    }

    try {
      const result = input.normalizedOrder
        ? await processOrderWebhook({
            provider: input.provider,
            storeId: event.storeId,
            normalized: input.normalizedOrder,
            eventType: event.eventType,
            rawPayload: payload,
          })
        : await processPaymentWebhook({
            provider: input.provider,
            storeId: event.storeId,
            payment: input.normalizedPayment!,
            eventType: event.eventType,
            rawPayload: payload,
          });

      if (result.ok) {
        stats.succeeded += 1;
        console.log(`  ✓ [${schema}] ${event.provider} ${event.eventType} → ${result.message}`);
      } else {
        stats.failedAgain += 1;
        console.warn(`  ✗ [${schema}] ${event.provider} ${event.eventType} → ${result.message}`);
      }

      if (!DRY_RUN) {
        await db
          .update(t.integrationEvents)
          .set({
            status: result.ok ? "processed" : "failed",
            error: result.ok ? null : `Replay failed again: ${result.message}`,
          })
          .where(eq(t.integrationEvents.id, event.id));
      }
    } catch (error) {
      stats.failedAgain += 1;
      console.warn(
        `  ✗ [${schema}] ${event.provider} ${event.eventType} threw: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (!DRY_RUN) {
        await db
          .update(t.integrationEvents)
          .set({ error: `Replay threw: ${error instanceof Error ? error.message : String(error)}` })
          .where(eq(t.integrationEvents.id, event.id));
      }
    }

    stats.replayed += 1;
  }

  return stats;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!isDatabaseConfigured()) {
    console.error("\n❌ DATABASE_URL missing — add your Neon connection string to .env.local.\n");
    process.exit(1);
  }
  if (DRY_RUN) {
    console.log("\n(replay running in --dry-run mode: nothing will be written)\n");
  }

  const db = requireDb();
  const { tenants } = publicSchema;

  const tenantRows = TENANT_FILTER
    ? await db.select().from(tenants).where(eq(tenants.schemaName, TENANT_FILTER))
    : await db.select().from(tenants).orderBy(tenants.createdAt);

  if (tenantRows.length === 0) {
    console.log("No tenants found — nothing to replay.");
    return;
  }

  const schemas = tenantRows
    .map((row) => row.schemaName)
    .filter((name): name is string => Boolean(name) && isTenantSchema(name));

  console.log(`Replaying failed webhook events across ${schemas.length} tenant(s)…\n`);

  const totals = { replayed: 0, succeeded: 0, failedAgain: 0, skipped: 0 };

  for (const schema of schemas) {
    const stats = await replayTenant(schema);
    console.log(
      `  ${schema}: ${stats.scanned} failed event(s) → ${stats.succeeded} recovered, ` +
        `${stats.failedAgain} failed again, ${stats.skipped} skipped`,
    );
    totals.replayed += stats.replayed;
    totals.succeeded += stats.succeeded;
    totals.failedAgain += stats.failedAgain;
    totals.skipped += stats.skipped;
  }

  console.log(
    `\n✅ Replay complete: ${totals.replayed} attempted, ${totals.succeeded} recovered, ` +
      `${totals.failedAgain} failed again, ${totals.skipped} skipped.`,
  );
}

main().catch((error) => {
  console.error("\n❌ Replay failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
