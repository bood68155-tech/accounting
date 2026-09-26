"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getTenantSchema } from "@/lib/tenants";
import { tenantDb, getTenantTables } from "@/lib/db";

// ─── Store settings actions ──────────────────────────────────────────────────
// Server actions behind the store detail page: per-store settings stored in
// stores.config (JSONB) — currently the ad spend input that powers ROAS.

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Persist the store's ad spend (per attribution window) into stores.config.
 * Numeric > 0 stores the value; 0/empty clears it (ROAS returns to its
 * "not connected" placeholder state).
 */
export async function updateAdSpend(storeId: string, amount: number): Promise<ActionResult> {
  const schema = await getTenantSchema();
  if (!schema) return { ok: false, error: "No tenant context — sign in and try again." };

  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, error: "Ad spend must be a non-negative number." };
  }
  if (amount > 1_000_000_000) {
    return { ok: false, error: "Ad spend is unrealistically large — check the value." };
  }

  try {
    const db = tenantDb(schema);
    const t = getTenantTables(schema);

    // Scope by store id within the tenant schema; verify existence for a
    // precise error instead of a silent no-op update.
    const rows = await db.select({ id: t.stores.id }).from(t.stores).where(eq(t.stores.id, storeId)).limit(1);
    if (rows.length === 0) {
      return { ok: false, error: "Store not found in this workspace." };
    }

    const current = (await db
      .select({ config: t.stores.config })
      .from(t.stores)
      .where(eq(t.stores.id, storeId))
      .limit(1))[0]?.config ?? {};

    const nextConfig: Record<string, unknown> = { ...current };
    if (amount > 0) {
      nextConfig.adSpend = Math.round(amount * 100) / 100;
    } else {
      delete nextConfig.adSpend;
      delete nextConfig.ad_spend;
      delete nextConfig.marketingSpend;
    }

    await db
      .update(t.stores)
      .set({ config: nextConfig, updatedAt: new Date() })
      .where(eq(t.stores.id, storeId));

    revalidatePath(`/stores/${storeId}`);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update ad spend.",
    };
  }
}
