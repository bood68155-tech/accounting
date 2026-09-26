import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTenantContext } from "@/lib/tenants";
import { isDatabaseConfigured } from "@/lib/db";
import { fetchStoreOverview, fetchLedger } from "@/lib/data/repository";
import { runDeepStoreResearch } from "@/lib/analytics/storeResearch";

export const dynamic = "force-dynamic";

/**
 * ── Deep store analytics & audit endpoint ─────────────────────────────────────
 * GET /api/analytics/overview              → deep analytics + continuous audit
 * GET /api/analytics/overview?days=60      → custom attribution window
 * GET /api/analytics/overview?adSpend=2500 → ROAS simulation for the window
 *
 * Grounded in the signed-in tenant's schema only. Numbers reconcile with the
 * dashboard because they are computed from the same repository reads.
 */
export async function GET(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Database is not configured — set DATABASE_URL (Neon) in the environment." },
      { status: 503 },
    );
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in to view store analytics." }, { status: 401 });
  }

  const { schema } = await getTenantContext();
  if (!schema) {
    return NextResponse.json(
      { error: "No tenant provisioned for this account — sign out and back in." },
      { status: 409 },
    );
  }

  try {
    const params = request.nextUrl.searchParams;
    const daysRaw = Number.parseInt(params.get("days") ?? "", 10);
    const periodDays = Number.isFinite(daysRaw) && daysRaw >= 1 && daysRaw <= 365 ? daysRaw : undefined;
    const adSpendRaw = Number.parseFloat(params.get("adSpend") ?? "");
    const adSpend = Number.isFinite(adSpendRaw) && adSpendRaw > 0 ? adSpendRaw : undefined;

    const overview = await fetchStoreOverview();
    if (!overview.store) {
      return NextResponse.json({ error: "Connect a store first — there is nothing to analyze yet." }, { status: 404 });
    }

    const ledger = await fetchLedger(overview.store.id);
    const research = runDeepStoreResearch(overview.store, overview.orders, overview.products, ledger, {
      periodDays,
      adSpend,
    });

    return NextResponse.json({
      ok: true,
      analytics: research.analytics,
      audit: research.audit,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Analytics failed: ${message}` }, { status: 500 });
  }
}
