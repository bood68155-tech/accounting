/**
 * ── Manual store sync runner (products + orders) ──────────────────────────────
 * CLI wrapper around the exact same sync engines the UI buttons call:
 *   • syncTenantStores — products via Shopify/Salla Admin API
 *   • syncTenantOrders — orders via Shopify Admin REST (shpat_ token)
 *
 * Run:
 *   node --env-file=.env.local scripts/run-ts.mjs scripts/sync-store.ts \
 *     --domain test-store-sgzxx2c2.myshopify.com
 *
 * Omit --domain to sync every connected Shopify store in the tenant.
 * Add --days 90 to widen the order pull window (default 30).
 */
import { isTenantSchema, requireDb, publicSchema } from "@/lib/db";
import { getTenantTables, tenantDb } from "@/lib/db";
import { eq } from "drizzle-orm";
import { syncTenantStores } from "@/lib/catalog/sync";
import { syncTenantOrders } from "@/lib/orders/sync";

const args = process.argv.slice(2);
function arg(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — pass --env-file=.env.local");
    process.exit(1);
  }

  // The runner operates on the first tenant schema that owns the target store
  // (single-tenant ops setups; multi-tenant users should use the UI buttons).
  const { tenants } = publicSchema;
  const tenantRows = await requireDb().select().from(tenants);

  const domain = arg("domain");
  const days = Number.parseInt(arg("days") ?? "30", 10);

  for (const tenant of tenantRows) {
    const schema = tenant.schemaName;
    if (!isTenantSchema(schema)) continue;

    const t = getTenantTables(schema);
    const stores = await tenantDb(schema).select().from(t.stores);
    const match = domain
      ? stores.find((s) => s.domain === domain.toLowerCase())
      : stores.find((s) => s.platform === "shopify");
    if (!match) continue;

    console.log(`\n── Store: ${match.name} (${match.platform} · ${match.domain ?? "no domain"}) ──`);

    // 1. Products (catalog — feeds COGS enrichment)
    console.log("\n[1/2] Syncing products…");
    const catalog = await syncTenantStores(schema, match.id);
    for (const r of catalog) {
      if (r.error) console.error(`  products: ERROR ${r.error}`);
      else if (r.skipped) console.warn(`  products: skipped — ${r.skipped}`);
      else console.log(`  products: ✓ ${r.synced} upserted`);
    }

    // 2. Orders (Admin REST pull through the real ingest pipeline)
    console.log("\n[2/2] Syncing orders…");
    const orders = await syncTenantOrders(schema, { storeId: match.id, days });
    for (const r of orders.stores) {
      if (r.error) console.error(`  orders: ERROR ${r.error}`);
      else if (r.skippedNote) console.warn(`  orders: skipped — ${r.skippedNote}`);
      else
        console.log(
          `  orders: fetched ${r.fetched} · imported ${r.imported} · already-synced/skipped ${r.skipped}`,
        );
    }

    // 3. Verify what actually landed in the tenant schema
    const t2 = getTenantTables(schema);
    const productCount = await tenantDb(schema)
      .select({ id: t2.products.id })
      .from(t2.products)
      .where(eq(t2.products.storeId, match.id));
    const orderCount = await tenantDb(schema)
      .select({ id: t2.orders.id })
      .from(t2.orders)
      .where(eq(t2.orders.storeId, match.id));
    console.log(
      `\nDB check → products in catalog: ${productCount.length} · orders in ledger: ${orderCount.length}`,
    );
    return;
  }

  console.error(`No matching store found${domain ? ` for domain ${domain}` : ""}.`);
  process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("sync-store FAILED:", error);
    process.exit(1);
  });
