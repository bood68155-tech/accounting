import { eq } from "drizzle-orm";
import { tenantDb, getTenantTables, isDatabaseConfigured, isTenantSchema } from "@/lib/db";
import {
  fetchShopifyOrders,
  isShopifyAuthError,
  normalizeShopifyOrder,
  validateShopifyTokenScopes,
} from "@/lib/providers/shopify";
import { processOrderWebhook, type IngestResult } from "@/lib/webhooks/ingest";
import type { Platform } from "@/types";

/**
 * ── Manual order sync (Shopify Admin REST pull) ───────────────────────────────
 * Pulls recent orders directly from the Shopify Admin API (`orders.json`,
 * status=any) using the store's Admin access token — the same shpat_… token
 * resolution as the catalog sync (stores.config.accessToken, falling back to
 * SHOPIFY_ADMIN_TOKEN). Runs every pulled order through the REAL ingestion
 * pipeline (`processOrderWebhook`), so it benefits from catalog-cost
 * enrichment, balanced journal posting, and idempotent upserts by
 * (store_id, external_id) — clicking it twice never double-books revenue.
 *
 * This is the manual fallback for when webhooks fail (signature issues,
 * deployment downtime, missed deliveries): the user can always pull orders on
 * demand from the /orders page.
 */

export interface OrderSyncStoreResult {
  storeId: string;
  storeName: string;
  platform: string;
  fetched: number;
  imported: number;
  skipped: number;
  skippedNote?: string;
  error?: string;
  /**
   * Set when the store's Admin API token failed auth (401) or lacks required
   * scopes (403). The UI shows a reconnect/re-authorize prompt for these.
   */
  needsReauth?: boolean;
  /** Human-readable scope mismatch detail (missing scopes, granted scopes). */
  scopeDetail?: string;
  /** Scopes granted to the stored token (when Shopify reported them). */
  grantedScopes?: string[];
  /** Scopes the app requires (read_products, read_orders). */
  requiredScopes?: string[];
}

export interface OrderSyncSummary {
  ok: boolean;
  fetched: number;
  imported: number;
  skipped: number;
  stores: OrderSyncStoreResult[];
  error?: string;
  /** True when at least one store failed auth and must be reconnected. */
  needsReauth?: boolean;
}

/** Read an access token for a store from its config, falling back to env. */
function tokenFor(platform: string, config: Record<string, unknown>): string | null {
  const fromConfig = typeof config.accessToken === "string" ? config.accessToken.trim() : "";
  if (fromConfig) return fromConfig;
  if (platform === "shopify") return process.env.SHOPIFY_ADMIN_TOKEN?.trim() || null;
  return null;
}

/**
 * Sync orders for one Shopify store (or every connected Shopify store in the
 * tenant). Per-store failures are reported, not thrown — one broken store must
 * not block the rest.
 */
export async function syncTenantOrders(
  schema: string,
  options: { storeId?: string; days?: number; limit?: number } = {},
): Promise<OrderSyncSummary> {
  const summary: OrderSyncSummary = {
    ok: true,
    fetched: 0,
    imported: 0,
    skipped: 0,
    stores: [],
  };

  if (!isDatabaseConfigured() || !isTenantSchema(schema)) {
    return { ...summary, ok: false, error: "Database or tenant context is not available." };
  }

  const db = tenantDb(schema);
  const t = getTenantTables(schema);

  const stores = options.storeId
    ? await db.select().from(t.stores).where(eq(t.stores.id, options.storeId)).limit(1)
    : await db.select().from(t.stores).orderBy(t.stores.createdAt);

  for (const store of stores) {
    const base = {
      storeId: store.id,
      storeName: store.name,
      platform: store.platform as Platform | string,
    };

    if (store.platform !== "shopify") {
      const skippedNote = `Order pull is currently Shopify-only (${store.platform} uses webhooks).`;
      summary.stores.push({
        ...base,
        platform: store.platform,
        fetched: 0,
        imported: 0,
        skipped: 0,
        skippedNote,
      });
      continue;
    }

    const config = (store.config ?? {}) as Record<string, unknown>;
    const token = tokenFor(store.platform, config);
    if (!token) {
      summary.stores.push({
        ...base,
        platform: store.platform,
        fetched: 0,
        imported: 0,
        skipped: 0,
        needsReauth: true,
        error:
          "Missing Admin API access token — add accessToken in the store config or set SHOPIFY_ADMIN_TOKEN.",
      });
      summary.needsReauth = true;
      continue;
    }
    if (!store.domain) {
      summary.stores.push({
        ...base,
        platform: store.platform,
        fetched: 0,
        imported: 0,
        skipped: 0,
        error: "Store has no domain — needed to reach the Shopify Admin API.",
      });
      continue;
    }

    try {
      // Validate the stored OAuth token BEFORE pulling: a 401 (dead token) or
      // 403 (missing read_orders/read_products scope) must surface as a clean
      // reconnect prompt, not a raw "Shopify orders API 403" error.
      const grantedScopes = await validateShopifyTokenScopes(store.domain, token);
      console.log(
        `[order-sync] ${store.name}: token scopes OK (${grantedScopes.join(", ") || "none reported"})`,
      );

      const rawOrders = await fetchShopifyOrders(store.domain, token, {
        days: options.days,
        limit: options.limit,
      });
      console.log(`[order-sync] pulled ${rawOrders.length} orders from ${store.domain} (Shopify Admin API)`);

      let imported = 0;
      let skipped = 0;

      for (const raw of rawOrders) {
        let normalized;
        try {
          normalized = normalizeShopifyOrder(raw as never);
        } catch (error) {
          skipped += 1;
          console.error(
            `[order-sync] failed to normalize order ${String((raw as { id?: unknown }).id ?? "?")}:`,
            error,
          );
          continue;
        }
        if (!normalized.external_id) {
          skipped += 1;
          continue;
        }

        const result: IngestResult = await processOrderWebhook({
          provider: "shopify",
          storeId: store.id,
          storeCurrency: store.currency,
          normalized,
          eventType: "orders/sync",
          rawPayload: raw,
        });

        if (result.ok) {
          if (result.upserted) imported += 1;
          else skipped += 1; // already in the DB (idempotent)
        } else {
          skipped += 1;
          // Failures are already logged (console + integration_events) inside
          // the ingest pipeline; keep pulling the remaining orders.
        }
      }

      console.log(
        `[order-sync] ${store.name}: fetched ${rawOrders.length}, imported ${imported}, skipped ${skipped} (already synced or failed)`,
      );

      summary.stores.push({
        ...base,
        platform: store.platform,
        fetched: rawOrders.length,
        imported,
        skipped,
        grantedScopes,
      });
      summary.fetched += rawOrders.length;
      summary.imported += imported;
      summary.skipped += skipped;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[order-sync] ${store.name} FAILED:`, error);
      // Auth failures (401 dead token / 403 missing scopes) are actionable:
      // flag the store so the UI can prompt a reconnect instead of showing a
      // dead-end error string.
      const isAuth = isShopifyAuthError(error);
      summary.stores.push({
        ...base,
        platform: store.platform,
        fetched: 0,
        imported: 0,
        skipped: 0,
        ...(isAuth
          ? {
              needsReauth: true,
              scopeDetail: message,
              grantedScopes: error.tokenScopes ?? undefined,
              requiredScopes: [...error.requiredScopes],
            }
          : {}),
        error: message,
      });
      if (isAuth) summary.needsReauth = true;
    }
  }

  return summary;
}
