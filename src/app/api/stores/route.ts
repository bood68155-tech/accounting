import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getTenantContext } from "@/lib/tenants";
import { isDatabaseConfigured, tenantDb, getTenantTables } from "@/lib/db";
import type { Platform, StoreStatus } from "@/types";

export const dynamic = "force-dynamic";

const PLATFORMS: Platform[] = ["shopify", "salla", "woocommerce", "stripe", "paypal", "custom"];

/**
 * ── Connect a store ───────────────────────────────────────────────────────────
 * Creates the store row inside the signed-in user's tenant schema (the
 * register_store trigger mirrors it into public.store_registry so webhooks can
 * resolve the tenant), then seeds the standard chart of accounts so the first
 * order can post balanced journal entries immediately.
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
    return NextResponse.json({ error: "Sign in to connect a store." }, { status: 401 });
  }

  const { schema } = await getTenantContext();
  if (!schema) {
    return NextResponse.json(
      { error: "No tenant provisioned for this account — sign out and back in." },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    platform?: string;
    domain?: string;
    currency?: string;
    config?: Record<string, unknown>;
  };

  const name = (body.name ?? "").trim();
  const platform = (body.platform ?? "").trim() as Platform;
  const domain = (body.domain ?? "").trim().toLowerCase() || null;
  const currency = (body.currency ?? "USD").trim().toUpperCase() || "USD";

  if (!name) {
    return NextResponse.json({ error: "Store name is required." }, { status: 400 });
  }
  if (!PLATFORMS.includes(platform)) {
    return NextResponse.json({ error: "Unsupported platform." }, { status: 400 });
  }

  const db = tenantDb(schema);
  const t = getTenantTables(schema);

  try {
    // One store per domain per user (unique constraint). If it already exists,
    // treat the connect flow as idempotent and return the existing row.
    const existing = domain
      ? await db
          .select()
          .from(t.stores)
          .where(and(eq(t.stores.userId, session.user.id), eq(t.stores.domain, domain)))
          .limit(1)
      : [];

    if (existing.length > 0) {
      const store = existing[0];
      return NextResponse.json({
        ok: true,
        store: {
          id: store.id,
          name: store.name,
          platform: store.platform,
          domain: store.domain,
          currency: store.currency,
          status: store.status,
        },
        created: false,
      });
    }

    const inserted = await db
      .insert(t.stores)
      .values({
        userId: session.user.id,
        name,
        platform,
        domain,
        currency,
        status: "connected" as StoreStatus,
        config: body.config ?? {},
      })
      .returning();

    const store = inserted[0];

    // Seed the standard chart of accounts (the function is created by the
    // migration inside each tenant schema; the schema name is regex-validated
    // and the store id is a bound parameter).
    await db.execute(sql`select ${sql.raw(`"${schema}"`)}.seed_chart_of_accounts(${store.id}::uuid)`);

    return NextResponse.json({
      ok: true,
      store: {
        id: store.id,
        name: store.name,
        platform: store.platform,
        domain: store.domain,
        currency: store.currency,
        status: store.status,
      },
      created: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Could not connect the store: ${message}` }, { status: 500 });
  }
}
