"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getTenantSchema } from "@/lib/tenants";
import { tenantDb, getTenantTables } from "@/lib/db";
import { syncTenantStores, type SyncStoreResult } from "@/lib/catalog/sync";

// ─── Products admin actions ───────────────────────────────────────────────────
// Server actions behind the /products page: inline cost-price editing and
// catalog sync from the store platform APIs.

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Set the true item cost for one product (drives webhook COGS + margins). */
export async function updateProductCost(
  storeId: string,
  productId: string,
  costPrice: number,
): Promise<ActionResult> {
  const schema = await getTenantSchema();
  if (!schema) return { ok: false, error: "No tenant context — sign in and try again." };
  if (!Number.isFinite(costPrice) || costPrice < 0) {
    return { ok: false, error: "Cost price must be a non-negative number." };
  }

  try {
    const db = tenantDb(schema);
    const t = getTenantTables(schema);

    const updated = await db
      .update(t.products)
      .set({ costPrice, updatedAt: new Date() })
      .where(and(eq(t.products.id, productId), eq(t.products.storeId, storeId)))
      .returning({ id: t.products.id });
    if (updated.length === 0) {
      return { ok: false, error: "Product not found in this store." };
    }

    revalidatePath("/products");
    revalidatePath(`/stores/${storeId}/products`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to update cost price." };
  }
}

/**
 * Pull products from the store platform APIs into the tenant catalog.
 * `retryAfterScopeGrant` triggers the one-shot auto-retry pass for stores that
 * previously failed with needsScopeGrant (used right after the merchant grants
 * the missing Shopify scope and updates the token).
 */
export async function syncProducts(
  storeId?: string,
  options: { retryAfterScopeGrant?: boolean } = {},
): Promise<
  | { ok: true; results: SyncStoreResult[]; retried?: string[] }
  | { ok: false; error: string }
> {
  const schema = await getTenantSchema();
  if (!schema) return { ok: false, error: "No tenant context — sign in and try again." };

  try {
    const results = await syncTenantStores(schema, storeId);

    let retried: string[] | undefined;
    if (options.retryAfterScopeGrant) {
      const blocked = results.filter((r) => r.needsScopeGrant);
      if (blocked.length > 0) {
        retried = blocked.map((r) => r.storeId);
        const retryResults = await syncTenantStores(schema, blocked[0].storeId);
        for (let i = 0; i < results.length; i += 1) {
          const match = retryResults.find((rr) => rr.storeId === results[i].storeId);
          if (match) results[i] = match;
        }
      }
    }

    revalidatePath("/products");
    revalidatePath("/stores");
    return { ok: true, results, retried };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Catalog sync failed.",
    };
  }
}
