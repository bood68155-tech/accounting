/**
 * ── Purge mock/demo data (orders, journal entries, integration events) ───────
 *
 * Cleans every tenant schema so the orders tables start completely fresh and
 * only ever show real synced orders:
 *
 *   1. Wipes all orders (+ items) / journal entries (+ lines) / integration
 *      events for EVERY store — the seeded demo store "Aurora & Oak"
 *      (auroraandoak.myshopify.com, created by scripts/seed-demo-data.mjs)
 *      and the simulated "#1001 / Jane Doe" webhook fixture on the test store.
 *      Store rows themselves are KEPT so tokens can be re-validated and real
 *      orders re-synced; the mock seeded catalog of the demo store is removed.
 *
 * Dry-run by default: pass --yes to actually delete.
 * Usage:
 *   node --env-file-if-exists=.env.local scripts/purge-demo-data.mjs [--yes]
 */
import pg from "pg";

const { Client } = pg;

const args = process.argv.slice(2);
const APPLY = args.includes("--yes");

const qI = (id) => `"${id.replace(/"/g, '""')}"`;

/** The known mock store (transactional data + seeded catalog are purged). */
const MOCK_STORE_DOMAINS = ["auroraandoak.myshopify.com"];
const MOCK_STORE_NAMES = ["Aurora & Oak"];

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const tenants = await client.query(
      `select id, slug, schema_name from public.tenants order by created_at`,
    );

    for (const tenant of tenants.rows) {
      const schema = tenant.schema_name;
      if (!/^tenant_[0-9a-f]{32}$/.test(schema)) continue;
      const T = (table) => `${qI(schema)}.${qI(table)}`;

      console.log(`\n── tenant ${tenant.slug} (${schema}) ${APPLY ? "" : "(dry run)"}`);
      const stores = await client.query(
        `select id, name, domain from ${T("stores")} order by created_at`,
      );

      // Purge transactional data for every store (all of it is mock today),
      // plus the mock seeded catalog for known demo stores.
      for (const store of stores.rows) {
        const isMockStore =
          MOCK_STORE_DOMAINS.includes((store.domain ?? "").toLowerCase()) ||
          MOCK_STORE_NAMES.includes(store.name);

        const counts = {};
        for (const table of ["orders", "journal_entries", "integration_events"]) {
          const { rows } = await client.query(
            `select count(*)::int as n from ${T(table)} where store_id = $1`,
            [store.id],
          );
          counts[table] = rows[0].n;
        }
        console.log(
          `   ${store.name}${isMockStore ? " (demo store)" : ""}: ${counts.orders} orders, ${counts.journal_entries} journal entries, ${counts.integration_events} events`,
        );

        if (APPLY) {
          // order_items/journal_lines cascade from their parents.
          await client.query(`delete from ${T("integration_events")} where store_id = $1`, [store.id]);
          await client.query(`delete from ${T("journal_entries")} where store_id = $1`, [store.id]);
          await client.query(`delete from ${T("orders")} where store_id = $1`, [store.id]);
          if (isMockStore) {
            await client.query(`delete from ${T("products")} where store_id = $1`, [store.id]);
            console.log(`   ✓ also removed the seeded mock catalog for "${store.name}"`);
          }
          console.log(`   ✓ purged transactional data for "${store.name}" (store kept for re-auth)`);
        }
      }
    }

    if (!APPLY) {
      console.log("\nDry run only — re-run with --yes to apply deletions.");
    } else {
      console.log("\n✅ Purge complete. Orders tables now hold only real synced orders.");
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("purge FAILED:", err.message);
  process.exit(1);
});
