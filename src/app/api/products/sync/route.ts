import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTenantContext } from "@/lib/tenants";
import { isDatabaseConfigured } from "@/lib/db";
import { syncTenantStores, type SyncStoreResult } from "@/lib/catalog/sync";

export const dynamic = "force-dynamic";

/**
 * ── Product catalog sync ──────────────────────────────────────────────────────
 * POST /api/products/sync            → sync every connected store in the tenant
 * POST /api/products/sync {storeId}  → sync one store
 * POST {storeId, retryAfterScopeGrant: true} → one automatic retry pass for
 *   stores that failed with needsScopeGrant (call right after the merchant
 *   granted `read_products` and refreshed the token — no second manual click).
 *
 * Pulls products from each store's platform API (Shopify Admin / Salla Admin)
 * and upserts them into the tenant's products table. Cost prices from the
 * provider win; user-set costs are preserved when the provider has none.
 *
 * Response shape (graceful scope handling):
 *   { ok, results: SyncStoreResult[] }
 * where a result with `needsScopeGrant` tells the UI exactly which scopes are
 * missing (e.g. read_products) so it can render a warning + auto-retry offer
 * instead of a dead-end error.
 */

/** Stores whose failure is a scope/auth problem, from a previous result set. */
function scopeBlocked(results: SyncStoreResult[]): SyncStoreResult[] {
  return results.filter((r) => r.needsScopeGrant);
}

export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Database is not configured — set DATABASE_URL (Neon) in the environment." },
      { status: 503 },
    );
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in to sync products." }, { status: 401 });
  }

  const { schema } = await getTenantContext();
  if (!schema) {
    return NextResponse.json(
      { error: "No tenant provisioned for this account — sign out and back in." },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    storeId?: string;
    retryAfterScopeGrant?: boolean;
  };

  try {
    const results = await syncTenantStores(schema, body.storeId);

    // Auto-retry once: after the merchant grants the missing scope(s) and
    // rotates the token, a single follow-up pass usually succeeds — do it for
    // them so the UI's "Retry automatically" actually just works.
    if (body.retryAfterScopeGrant && scopeBlocked(results).length > 0) {
      const retryTargets = scopeBlocked(results).map((r) => r.storeId);
      const retryResults = await syncTenantStores(schema, retryTargets[0]);
      // Merge: retry results replace the blocked entries for those stores.
      const merged = results.map(
        (r) => retryResults.find((rr) => rr.storeId === r.storeId) ?? r,
      );
      return NextResponse.json({
        ok: true,
        results: merged,
        retried: retryTargets,
      });
    }

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Sync failed: ${message}` }, { status: 500 });
  }
}
