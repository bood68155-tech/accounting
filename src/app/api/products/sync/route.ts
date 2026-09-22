import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTenantContext } from "@/lib/tenants";
import { isDatabaseConfigured } from "@/lib/db";
import { syncTenantStores } from "@/lib/catalog/sync";

export const dynamic = "force-dynamic";

/**
 * ── Product catalog sync ──────────────────────────────────────────────────────
 * POST /api/products/sync            → sync every connected store in the tenant
 * POST /api/products/sync {storeId}  → sync one store
 *
 * Pulls products from each store's platform API (Shopify Admin / Salla Admin)
 * and upserts them into the tenant's products table. Cost prices from the
 * provider win; user-set costs are preserved when the provider has none.
 */
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

  const body = (await request.json().catch(() => ({}))) as { storeId?: string };

  try {
    const results = await syncTenantStores(schema, body.storeId);
    return NextResponse.json({ ok: true, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Sync failed: ${message}` }, { status: 500 });
  }
}
