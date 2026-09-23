"use server";

import { revalidatePath } from "next/cache";
import { getTenantSchema } from "@/lib/tenants";
import { syncTenantOrders, type OrderSyncSummary } from "@/lib/orders/sync";

// ─── Orders page actions ──────────────────────────────────────────────────────
// Manual "Sync Shopify Orders" action: pulls recent orders straight from the
// Shopify Admin REST API (shpat_… token) into the tenant — the webhook-free
// fallback that works at any time.

export type OrderSyncResult =
  | { ok: true; summary: OrderSyncSummary }
  | { ok: false; error: string };

export async function syncShopifyOrders(
  storeId?: string,
): Promise<OrderSyncResult> {
  const schema = await getTenantSchema();
  if (!schema) return { ok: false, error: "No tenant context — sign in and try again." };

  try {
    const summary = await syncTenantOrders(schema, { storeId });
    if (!summary.ok) {
      return { ok: false, error: summary.error ?? "Order sync failed." };
    }
    revalidatePath("/orders");
    revalidatePath("/dashboard");
    revalidatePath("/reports/balance-sheet");
    revalidatePath("/reports/income-statement");
    return { ok: true, summary };
  } catch (err) {
    console.error("[order-sync] server action FAILED:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Order sync failed.",
    };
  }
}
