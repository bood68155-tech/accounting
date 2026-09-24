/**
 * ── Validate stored Shopify Admin API tokens against the live API ────────────
 *
 * For every connected Shopify store in every tenant: reads the stored token
 * (stores.config.accessToken, falling back to SHOPIFY_ADMIN_TOKEN) and:
 *
 *   1. GET /shop.json                → 401 = token DEAD (app uninstalled or
 *      regenerated) → re-auth required. 404 = shop does not exist (bad domain).
 *   2. GET /oauth/access_scopes.json → when available (OAuth apps), lists the
 *      granted scopes and checks for read_orders / read_products. Admin-created
 *      custom apps (shpat_ tokens) get 404 here, so scopes are probed directly:
 *   3. GET /orders.json?limit=1      → 403 "requires merchant approval for
 *      read_orders scope" = the token lacks order access (the exact 403 the
 *      Sync Orders endpoint was surfacing).
 *
 * Exit code 1 when any store needs attention (dead token / missing scopes).
 * Run: node --env-file-if-exists=.env.local scripts/validate-store-tokens.mjs
 */
import pg from "pg";

const { Client } = pg;

const API_VERSION = "2024-10";
const REQUIRED_SCOPES = ["read_products", "read_orders"];

async function apiGet(domain, token, path) {
  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/${path}`, {
    headers: { "X-Shopify-Access-Token": token },
  });
  const body = await res.text().catch(() => "");
  return { status: res.status, body };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — pass --env-file=.env.local");
    process.exit(1);
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let failures = 0;

  try {
    if (!process.env.SHOPIFY_WEBHOOK_SECRET) {
      console.warn("⚠ SHOPIFY_WEBHOOK_SECRET is not set — real Shopify webhooks will be rejected with 401. Set it to the app's webhook secret.");
    }

    const tenants = await client.query(
      `select id, slug, schema_name from public.tenants order by created_at`,
    );

    for (const tenant of tenants.rows) {
      const schema = tenant.schema_name;
      if (!/^tenant_[0-9a-f]{32}$/.test(schema)) continue;
      const T = (t) => `"${schema}"."${t}"`;

      console.log(`\n── tenant ${tenant.slug} (${schema})`);
      const stores = await client.query(
        `select id, name, domain, config from ${T("stores")} where platform = 'shopify' order by created_at`,
      );

      for (const store of stores.rows) {
        console.log(`\n  store: ${store.name} (${store.domain ?? "no domain"})`);
        if (!store.domain) {
          console.error("    ✗ no domain configured — cannot reach the Admin API");
          failures += 1;
          continue;
        }

        const cfg = store.config ?? {};
        const token =
          (typeof cfg.accessToken === "string" && cfg.accessToken.trim()) ||
          process.env.SHOPIFY_ADMIN_TOKEN ||
          "";
        if (!token) {
          console.error("    ✗ no Admin API token (add accessToken to the store config or set SHOPIFY_ADMIN_TOKEN)");
          failures += 1;
          continue;
        }

        // 1. Is the token alive at all?
        let probe;
        try {
          probe = await apiGet(store.domain, token, "shop.json");
        } catch (error) {
          console.error(`    ✗ network error: ${error.message}`);
          failures += 1;
          continue;
        }
        if (probe.status === 401 || probe.status === 403) {
          console.error(`    ✗ ${probe.status} on shop.json — token is dead ("${probe.body.replace(/\s+/g, " ").slice(0, 120)}"). Reconnect the store with a fresh shpat_ token.`);
          failures += 1;
          continue;
        }
        if (probe.status === 404) {
          console.error(`    ✗ 404 on shop.json — the shop domain does not exist (or the store is frozen). Check the domain spelling.`);
          failures += 1;
          continue;
        }
        if (probe.status !== 200) {
          console.error(`    ✗ HTTP ${probe.status} on shop.json: ${probe.body.slice(0, 160)}`);
          failures += 1;
          continue;
        }
        console.log("    ✓ token is live (shop.json 200)");

        // 2. Granted scopes — via the OAuth endpoint when it exists.
        let granted = [];
        let missing = [...REQUIRED_SCOPES];
        const scopesRes = await apiGet(store.domain, token, "oauth/access_scopes.json");
        if (scopesRes.status === 200) {
          try {
            granted = (JSON.parse(scopesRes.body).access_scopes ?? [])
              .map((s) => s.handle ?? "")
              .filter(Boolean);
            missing = REQUIRED_SCOPES.filter(
              (r) => !granted.some((g) => g.toLowerCase() === r.toLowerCase()),
            );
          } catch {
            /* fall through to probing */
          }
        }

        if (missing.length === 0 && granted.length > 0) {
          console.log(`    ✓ granted scopes: ${granted.join(", ")}`);
          continue;
        }

        // 3. Custom-app path (scopes endpoint 404s): probe the real resources.
        const ordersProbe = await apiGet(store.domain, token, "orders.json?limit=1&status=any");
        if (ordersProbe.status === 403) {
          console.error(`    ✗ 403 on orders.json — ${ordersProbe.body.replace(/\s+/g, " ").slice(0, 160)}`);
          console.error("      Fix: Shopify admin → Settings → Apps and sales channels → Develop apps → your app → Configuration → Admin API integration → grant read_products + read_orders → Save → reinstall/rotate the token → update the store config accessToken.");
          failures += 1;
          continue;
        }
        if (ordersProbe.status !== 200) {
          console.error(`    ✗ HTTP ${ordersProbe.status} on orders.json: ${ordersProbe.body.slice(0, 160)}`);
          failures += 1;
          continue;
        }
        console.log("    ✓ orders.json accessible (200) — order sync will work");
      }
    }
  } finally {
    await client.end();
  }

  console.log(failures === 0 ? "\n✅ All Shopify store tokens are valid and carry the required scopes." : `\n✗ ${failures} store(s) need attention — reconnect / update scopes, then re-run.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("validate FAILED:", err.message);
  process.exit(1);
});
