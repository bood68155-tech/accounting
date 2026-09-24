"use server";

import { revalidatePath } from "next/cache";
import { getTenantSchema } from "@/lib/tenants";
import { syncTenantOrders, type OrderSyncSummary } from "@/lib/orders/sync";

// ─── Orders page actions ──────────────────────────────────────────────────────
// Manual "Sync Shopify Orders" action: pulls recent orders straight from the
// Shopify Admin REST API (shpat_… token) into the tenant — the webhook-free
// fallback that works at any time.
//
// Auth failures (401 dead token / 403 missing scopes) are surfaced through
// `summary.needsReauth` so the UI can prompt a reconnect/re-authorize flow
// instead of a raw error string.

export type OrderSyncResult =
  | { ok: true; summary: OrderSyncSummary }
  | { ok: false; error: string; needsReauth?: boolean; storeName?: string };

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

    // Every store hit an auth error and nothing could be pulled: report as a
    // re-auth failure so the UI shows the reconnect prompt prominently.
    const authStores = summary.stores.filter((s) => s.needsReauth);
    const allAuthFailed =
      authStores.length > 0 && summary.fetched === 0 && summary.imported === 0;
    if (allAuthFailed) {
      const first = authStores[0];
      return {
        ok: false,
        error:
          first.error ??
          "The store's Shopify access token needs to be re-authorized.",
        needsReauth: true,
        storeName: first.storeName,
      };
    }
    return { ok: true, summary };
  } catch (err) {
    console.error("[order-sync] server action FAILED:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Order sync failed.",
    };
  }
}
