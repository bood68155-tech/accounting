import { NextResponse } from "next/server";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { getTenantTables, isDatabaseConfigured, publicSchema, requireDb, tenantDb } from "@/lib/db";
import {
  createDigestStore,
  fetchDigestSettings,
  fetchLedgerForDigest,
  fetchOrdersForPeriod,
} from "@/lib/data/digest";
import { buildTaxPeriodReport } from "@/lib/accounting/taxEngine";
import {
  digestPeriodFor,
  isDueForSend,
  runDailyDigest,
  type RunDigestResult,
} from "@/lib/notifications/runner";
import { buildDailyDigest } from "@/lib/notifications/digest";
import type { HttpClient } from "@/lib/notifications/channels";

/**
 * Adapt the platform `fetch` to the narrow client the channel adapters expect.
 * Typed at the boundary rather than cast to `never` so a signature change here
 * fails the build instead of failing at runtime against a live provider.
 */
const globalFetch: HttpClient = (url, init) =>
  fetch(url, init).then((r) => ({
    ok: r.ok,
    status: r.status,
    json: () => r.json() as Promise<unknown>,
  }));

export const dynamic = "force-dynamic";

/**
 * POST /api/notifications/daily-digest — send yesterday's digest to every store
 * that has WhatsApp and/or Telegram configured.
 *
 * Invoked by the platform cron (see vercel.json) once an hour; `isDueForSend`
 * gates each store to its own local `send_hour` so one schedule serves tenants
 * in every timezone.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET`. Vercel Cron sends this
 * automatically when CRON_SECRET is set; manual runs can pass it explicitly.
 *
 * Query params:
 *   ?store=<id>  — limit to one store (tenant schema + store id)
 *   ?dry_run=1   — build and render the digest, send nothing
 *   ?force=1     — ignore the send_hour gate (used for manual re-sends)
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured — refusing to run an unauthenticated digest job." },
      { status: 500 },
    );
  }

  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const storeFilter = url.searchParams.get("store");
  const dryRun = url.searchParams.get("dry_run") === "1";
  const force = url.searchParams.get("force") === "1";

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
  }

  const now = new Date();
  const targets = storeFilter
    ? [await resolveSingleTarget(storeFilter)]
    : await resolveAllTargets();

  const runs: Array<RunDigestResult & { schema: string; name: string }> = [];
  const errors: Array<{ schema: string; error: string }> = [];

  for (const target of targets) {
    if (!target) continue;
    try {
      const settings = await fetchDigestSettings(target.schema, target.store.id);
      if (!settings.enabled || settings.channels.length === 0) continue;
      if (!force && !isDueForSend(settings, now)) continue;

      const period = digestPeriodFor(now, settings.timezone);

      if (dryRun) {
        const entries = await fetchLedgerForDigest(target.schema, target.store.id);
        const orders = await fetchOrdersForPeriod(
          target.schema,
          target.store.id,
          period.from,
          period.to,
        );
        const digest = buildDailyDigest({
          store: { id: target.store.id, name: target.store.name, currency: settings.currency },
          orders,
          entries,
          period,
          sections: settings.sections,
        });
        runs.push({
          schema: target.schema,
          name: target.store.name,
          digest,
          delivery: {
            store_id: target.store.id,
            digest_date: period.to,
            results: [],
            sent: 0,
            failed: 0,
            skipped: 1,
          },
        });
        continue;
      }

      const entries = await fetchLedgerForDigest(target.schema, target.store.id);
      const orders = await fetchOrdersForPeriod(target.schema, target.store.id, period.from, period.to);
      const tax = buildTaxPeriodReport(entries, undefined, { from: period.from, to: period.to });

      const result = await runDailyDigest({
        settings,
        store: { id: target.store.id, name: target.store.name, currency: settings.currency },
        orders,
        entries,
        tax,
        period,
        generatedAt: now.toISOString(),
        deliveryStore: createDigestStore(target.schema),
        deps: { fetch: globalFetch as HttpClient },
      });

      runs.push({ schema: target.schema, name: target.store.name, ...result });
    } catch (error) {
      // One tenant's failure must not abort the rest of the fleet.
      errors.push({
        schema: target.schema,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({
    dry_run: dryRun,
    processed: runs.length,
    sent: runs.reduce((n, r) => n + r.delivery.sent, 0),
    failed: runs.reduce((n, r) => n + r.delivery.failed, 0),
    skipped: runs.reduce((n, r) => n + r.delivery.skipped, 0),
    runs: runs.map((r) => ({
      store: r.name,
      digest_date: r.delivery.digest_date,
      sent: r.delivery.sent,
      failed: r.delivery.failed,
      skipped: r.delivery.skipped,
      results: r.delivery.results,
    })),
    errors,
  });
}

/** Resolve `?store=<id>` to its owning tenant schema via the store registry. */
async function resolveSingleTarget(
  storeId: string,
): Promise<{ schema: string; store: { id: string; name: string } } | null> {
  const db = requireDb();
  const rows = await db
    .select()
    .from(publicSchema.storeRegistry)
    .where(eq(publicSchema.storeRegistry.storeId, storeId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const t = getTenantTables(row.schemaName);
  const stores = await tenantDb(row.schemaName)
    .select({ id: t.stores.id, name: t.stores.name })
    .from(t.stores)
    .where(eq(t.stores.id, storeId))
    .limit(1);

  const store = stores[0];
  return store ? { schema: row.schemaName, store } : null;
}

/** Every tenant with a schema, so the digest can fan out across the platform. */
async function resolveAllTargets(): Promise<Array<{ schema: string; store: { id: string; name: string } }>> {
  const db = requireDb();
  const tenants = await db
    .select({ schemaName: publicSchema.tenants.schemaName })
    .from(publicSchema.tenants)
    .where(
      and(
        isNotNull(publicSchema.tenants.schemaName),
        ne(publicSchema.tenants.schemaName, ""),
      ),
    );

  const targets: Array<{ schema: string; store: { id: string; name: string } }> = [];

  for (const tenant of tenants) {
    if (!tenant.schemaName) continue;
    try {
      const t = getTenantTables(tenant.schemaName);
      const stores = await tenantDb(tenant.schemaName).select({ id: t.stores.id, name: t.stores.name }).from(t.stores);
      for (const store of stores) targets.push({ schema: tenant.schemaName, store });
    } catch (error) {
      // A tenant provisioned before the digest migration has no digest tables;
      // fetchDigestStores would throw on it, so surface it as a run error.
      console.error(`[digest] skipping tenant ${tenant.schemaName}:`, error);
    }
  }

  return targets;
}
