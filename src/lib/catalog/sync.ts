import { and, eq, inArray, sql } from "drizzle-orm";
import { tenantDb, getTenantTables } from "@/lib/db";
import { fetchShopifyProducts, isShopifyAuthError, validateShopifyTokenScopes } from "@/lib/providers/shopify";
import { fetchSallaProducts } from "@/lib/providers/salla";

/**
 * ── Product catalog sync ──────────────────────────────────────────────────────
 * Pulls products from each connected store's platform API and upserts them
 * into the tenant's products table (keyed by store_id + sku).
 *
 * Sync policy:
 *   • title / selling_price / external_id — always refreshed from the API
 *   • cost_price — refreshed from the API when the provider exposes one
 *     (Shopify inventory items), otherwise the value the user set in the
 *     /products UI is preserved
 *
 * Credentials are read per store from stores.config.accessToken, falling back
 * to SHOPIFY_ADMIN_TOKEN / SALLA_ACCESS_TOKEN env vars (handy for single-store
 * setups).
 */

export interface CatalogProductInput {
  external_id: string | null;
  sku: string;
  title: string;
  selling_price: number;
  /** null = provider doesn't expose a cost; keep the user-set value. */
  cost_price: number | null;
}

export interface SyncStoreResult {
  storeId: string;
  storeName: string;
  platform: string;
  synced: number;
  skipped?: string;
  error?: string;
  /**
   * Structured sync failure, when the cause is authorization (not transient):
   * the UI renders a "grant scope → reconnect → auto-retry" flow instead of
   * a dead-end error string.
   */
  needsScopeGrant?: {
    /** Missing scopes the merchant must grant in the platform admin. */
    missingScopes: string[];
    /** All scopes the stored token currently carries ([] = unknown). */
    grantedScopes: string[];
    /** Scopes this integration requires (read_products, read_orders…). */
    requiredScopes: string[];
    /** Human detail from the provider API (401/403 body). */
    detail: string;
    /** 'unauthorized' → token dead; 'forbidden' → scope grant needed. */
    kind: "unauthorized" | "forbidden";
  };
}

/**
 * Map a thrown error from a provider catalog fetch onto a structured
 * needsScopeGrant result when it is an authorization problem (Shopify
 * 401/403, missing read_products…). Returns undefined for ordinary failures.
 */
function scopeGrantFromError(error: unknown): SyncStoreResult["needsScopeGrant"] | undefined {
  if (!isShopifyAuthError(error)) return undefined;
  const granted = error.tokenScopes ?? [];
  const missing =
    granted.length > 0
      ? error.requiredScopes.filter(
          (r) => !granted.some((g) => g.toLowerCase() === r.toLowerCase()),
        )
      : // Scopes endpoint unavailable (admin-created custom app): report the
        // required set so the UI can still instruct precisely.
        [...error.requiredScopes];
  return {
    missingScopes: missing,
    grantedScopes: granted,
    requiredScopes: [...error.requiredScopes],
    detail: error.message,
    kind: error.kind,
  };
}

/** Upsert catalog rows into one tenant schema, deduped by SKU. */
export async function upsertCatalogProducts(
  schema: string,
  storeId: string,
  items: CatalogProductInput[],
): Promise<number> {
  if (items.length === 0) return 0;
  const t = getTenantTables(schema);
  const db = tenantDb(schema);

  // Dedupe by SKU (the upsert target) — later rows win.
  const bySku = new Map<string, CatalogProductInput>();
  for (const item of items) bySku.set(item.sku, item);

  // Preserve user-set costs where the provider doesn't expose one.
  const skus = [...bySku.keys()];
  const existing = await db
    .select({ sku: t.products.sku, costPrice: t.products.costPrice })
    .from(t.products)
    .where(and(eq(t.products.storeId, storeId), inArray(t.products.sku, skus)));
  const existingCost = new Map(existing.map((e) => [e.sku, e.costPrice]));

  const values = [...bySku.values()].map((item) => ({
    storeId,
    externalId: item.external_id,
    sku: item.sku,
    title: item.title,
    sellingPrice: item.selling_price,
    costPrice: item.cost_price ?? existingCost.get(item.sku) ?? 0,
  }));

  await db
    .insert(t.products)
    .values(values)
    .onConflictDoUpdate({
      target: [t.products.storeId, t.products.sku],
      set: {
        externalId: sql`excluded.external_id`,
        title: sql`excluded.title`,
        sellingPrice: sql`excluded.selling_price`,
        costPrice: sql`excluded.cost_price`,
        updatedAt: new Date(),
      },
    });

  return values.length;
}

/** Read an access token for a store from its config, falling back to env. */
function tokenFor(platform: string, config: Record<string, unknown>): string | null {
  const fromConfig = typeof config.accessToken === "string" ? config.accessToken.trim() : "";
  if (fromConfig) return fromConfig;
  if (platform === "shopify") return process.env.SHOPIFY_ADMIN_TOKEN?.trim() || null;
  if (platform === "salla") return process.env.SALLA_ACCESS_TOKEN?.trim() || null;
  return null;
}

/**
 * Sync products for one store (storeId given) or every connected store in the
 * tenant. Per-store failures are reported, not thrown — one broken store must
 * not block the rest.
 */
export async function syncTenantStores(schema: string, storeId?: string): Promise<SyncStoreResult[]> {
  const t = getTenantTables(schema);
  const db = tenantDb(schema);

  const stores = storeId
    ? await db.select().from(t.stores).where(eq(t.stores.id, storeId)).limit(1)
    : await db.select().from(t.stores).orderBy(t.stores.createdAt);

  const results: SyncStoreResult[] = [];

  for (const store of stores) {
    const base = {
      storeId: store.id,
      storeName: store.name,
      platform: store.platform,
    };
    const config = (store.config ?? {}) as Record<string, unknown>;

    if (store.platform !== "shopify" && store.platform !== "salla") {
      results.push({ ...base, synced: 0, skipped: `Catalog sync is not available for ${store.platform}.` });
      continue;
    }

    const token = tokenFor(store.platform, config);
    if (!token) {
      results.push({
        ...base,
        synced: 0,
        skipped:
          store.platform === "shopify"
            ? "Missing Admin API access token — add one in the store config (shpat_…) or set SHOPIFY_ADMIN_TOKEN."
            : "Missing Salla access token — add one in the store config or set SALLA_ACCESS_TOKEN.",
      });
      continue;
    }
    if (store.platform === "shopify" && !store.domain) {
      results.push({ ...base, synced: 0, skipped: "Store has no domain — needed to reach the Shopify Admin API." });
      continue;
    }

    try {
      // Fail fast on scope problems BEFORE the paged product pull: a token
      // without read_products would otherwise surface only as a mid-pagination
      // 403 with products already half-synced.
      if (store.platform === "shopify") {
        await validateShopifyTokenScopes(store.domain!, token);
      }
      const items =
        store.platform === "shopify"
          ? await fetchShopifyProducts(store.domain!, token)
          : await fetchSallaProducts(token);
      const synced = await upsertCatalogProducts(schema, store.id, items);
      results.push({ ...base, synced });
    } catch (error) {
      const scopeGrant = scopeGrantFromError(error);
      if (scopeGrant) {
        results.push({
          ...base,
          synced: 0,
          error: scopeGrant.detail,
          needsScopeGrant: scopeGrant,
        });
      } else {
        results.push({
          ...base,
          synced: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return results;
}
