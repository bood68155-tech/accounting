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

/** Pull products from the store platform APIs into the tenant catalog. */
export async function syncProducts(
  storeId?: string,
): Promise<{ ok: true; results: SyncStoreResult[] } | { ok: false; error: string }> {
  const schema = await getTenantSchema();
  if (!schema) return { ok: false, error: "No tenant context — sign in and try again." };

  try {
    const results = await syncTenantStores(schema, storeId);
    revalidatePath("/products");
    revalidatePath("/stores");
    return { ok: true, results };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Catalog sync failed.",
    };
  }
}
