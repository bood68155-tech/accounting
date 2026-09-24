/**
 * ── Demo data seed (multi-tenant, Neon) ───────────────────────────────────────
 *
 * Provisions a working demo tenant + schema + store with ~8 months of
 * realistic, deterministic orders — including deliberately planted anomalies —
 * so the AI features (cash-flow forecast, anomaly detection, insights,
 * balance sheet with AR) have meaningful history to work with:
 *
 *   • growth trend across months        → forecast shows a slope
 *   • a 3-day refund spike (last days)  → anomaly: refund-rate spike
 *   • one unusually large bulk order    → anomaly: order-value outlier (z>3)
 *   • one order sold below cost         → anomaly: COGS/pricing misconfig
 *   • orders with zero item costs       → anomaly: missing COGS
 *   • a few pending (unpaid) orders     → Accounts Receivable on the balance sheet
 *
 * Requirements (in .env.local):
 *   DATABASE_URL         — Neon (or any Postgres) connection string
 *   SEED_USER_EMAIL      — the account that should own the demo tenant
 *                          (defaults to the platform admin email)
 *
 * Usage:
 *   npm run db:seed
 *
 * The script is idempotent: it resets only the fixed demo store's data
 * (orders, journal entries, events) and re-inserts the same deterministic
 * dataset, so re-running never duplicates anything.
 */
import pg from "pg";

const { Client } = pg;

// The demo seed wipes the demo store's transactional data before rebuilding
// it, so the ERPNext-style ledger immutability guard must be suspended for
// this maintenance session (see scripts/ledger-guard.mjs).
let ledgerGuardSuspended = false;

// ─── deterministic PRNG + catalog ─────────────────────────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATALOG = [
  { sku: "AUR-101", name: "Amber + Cedar Candle (8oz)", cost: 4.6, price: 24.0 },
  { sku: "AUR-102", name: "Sea Salt & Sage Candle (8oz)", cost: 4.6, price: 24.0 },
  { sku: "AUR-103", name: "Midnight Diffuser Reed Set", cost: 7.2, price: 32.0 },
  { sku: "AUR-104", name: "Botanical Gift Box (3pc)", cost: 13.4, price: 58.0 },
  { sku: "AUR-105", name: "Linen Room Spray 100ml", cost: 2.9, price: 18.0 },
  { sku: "AUR-106", name: "Matcha Cleansing Bar (trio)", cost: 3.4, price: 15.0 },
  { sku: "AUR-107", name: "Stoneware Travel Candle", cost: 3.1, price: 14.0 },
  { sku: "AUR-108", name: "Oak Holder + Candle Set", cost: 8.8, price: 42.0 },
];

const CUSTOMERS = [
  "Elena Vasquez", "Marcus Reed", "Priya Nair", "Tom Okafor", "Sofia Lindgren",
  "James Whitfield", "Amara Osei", "Noah Bergström", "Layla Haddad", "Ethan Cole",
  "Chloe Martin", "Omar Farouk", "Hana Yoshida", "Daniel Kessler", "Ruby Turner",
  "Liam O'Connor",
];

const round2 = (n) => Math.round(n * 100) / 100;

function startOfMonth(offset) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
}

function daysInMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

/**
 * ~8 months of realistic orders (deterministic) with a growth trend and
 * planted anomalies for the AI engines.
 */
function generateOrders(storeId) {
  const rand = mulberry32(20260714);
  const orders = [];
  let orderCounter = 1000;

  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const between = (min, max) => min + rand() * (max - min);

  /** How many orders a given month gets — grows toward the present. */
  const orderCountFor = (monthOffset) =>
    8 + Math.round((7 - monthOffset) * 1.8) + Math.floor(rand() * 3);

  for (let monthOffset = 7; monthOffset >= 0; monthOffset--) {
    const monthStart = startOfMonth(monthOffset);
    const dim = daysInMonth(monthStart);
    const orderCount = orderCountFor(monthOffset);

    for (let i = 0; i < orderCount; i++) {
      orderCounter += 1;

      // ── planted anomalies (deterministic, current/previous month only) ────
      const isCurrentMonth = monthOffset === 0;
      const isLastMonth = monthOffset === 1;

      // Refund spike: the first 3 orders of the current month land within the
      // last 3 days and are refunded in full → recent refund-rate spike.
      const isRefundSpike = isCurrentMonth && i < 3;
      // Order-value outlier: one huge bulk order in the current month.
      const isOutlier = isCurrentMonth && i === 3;
      // Sold below cost: heavy discount on a high-cost product.
      const isBelowCost = isCurrentMonth && i === 4;
      // Missing COGS: items arrive with zero unit cost.
      const isMissingCost = isLastMonth && (i === 0 || i === 1);
      // Pending (unpaid) orders → booked as credit sales → AR on the balance sheet.
      const isPending = (isCurrentMonth && i === 5) || (isLastMonth && i === 2);

      const lineCount = isOutlier ? 1 : 1 + Math.floor(rand() * 3);
      const chosen = new Set();
      const items = [];
      for (let l = 0; l < lineCount; l++) {
        let idx;
        if (isOutlier) {
          idx = 3; // AUR-104 Botanical Gift Box — high ticket
        } else {
          idx = Math.floor(rand() * CATALOG.length);
          while (chosen.has(idx)) idx = Math.floor(rand() * CATALOG.length);
        }
        chosen.add(idx);
        const product = CATALOG[idx];
        const quantity = isOutlier ? 14 : rand() < 0.25 ? 2 : 1;
        const unitCost = isMissingCost ? 0 : product.cost; // planted: cost not tracked
        items.push({
          sku: product.sku,
          name: product.name,
          quantity,
          unit_price: product.price,
          unit_cost: unitCost,
          line_subtotal: round2(product.price * quantity),
          line_cost: round2(unitCost * quantity),
        });
      }

      const subtotal = round2(items.reduce((s, i) => s + i.line_subtotal, 0));
      let discountRate = rand() < 0.35 ? between(0.05, 0.2) : 0;
      if (isBelowCost) discountRate = 0.62; // planted: sells below cost
      const discountAmount = round2(subtotal * discountRate);
      const shippingAmount = round2(between(5.95, 11.95));
      const taxAmount = round2((subtotal - discountAmount) * 0.0725);
      const totalAmount = round2(subtotal - discountAmount + shippingAmount + taxAmount);
      // Pending orders haven't captured payment yet → no gateway fee.
      const paymentFee = isPending ? 0 : round2(totalAmount * 0.029 + 0.3);
      const gateway = rand() < 0.7 ? "Shopify Payments" : "PayPal";

      let orderedAt;
      if (isRefundSpike) {
        // Guarantee the refund cluster sits inside the recent-window that
        // anomaly detection scans: today minus i days.
        const d = new Date(Date.now() - i * 86_400_000);
        d.setUTCHours(3 + Math.floor(rand() * 12), Math.floor(rand() * 60), 0, 0);
        orderedAt = d.toISOString();
      } else {
        const day = 1 + Math.floor(rand() * dim);
        orderedAt = new Date(
          Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day, 3 + Math.floor(rand() * 16), Math.floor(rand() * 60)),
        ).toISOString();
      }

      const isRefunded = isRefundSpike || (!isPending && rand() < 0.06);
      const refundAmount = isRefunded
        ? round2(totalAmount * (isRefundSpike ? 1 : rand() < 0.5 ? 0.5 : 1))
        : 0;

      orders.push({
        store_id: storeId,
        external_id: `shopify-${450000000 + orderCounter}`,
        order_number: `#${orderCounter}`,
        customer_name: pick(CUSTOMERS),
        currency: "USD",
        subtotal,
        shipping_amount: shippingAmount,
        discount_amount: discountAmount,
        tax_amount: taxAmount,
        total_amount: totalAmount,
        payment_gateway: gateway,
        payment_fee: paymentFee,
        shipping_cost: round2(between(3.2, 6.9)),
        refund_amount: refundAmount,
        status: isPending
          ? "pending"
          : refundAmount >= totalAmount
            ? "refunded"
            : refundAmount > 0
              ? "partially_refunded"
              : "paid",
        ordered_at: orderedAt,
        items,
        gateway_provider: gateway === "PayPal" ? "paypal" : "shopify",
      });
    }
  }

  return orders.sort((a, b) => a.ordered_at.localeCompare(b.ordered_at));
}

// ─── double-entry helpers (mirror of src/lib/accounting/doubleEntry.ts) ──────

// journal_lines rejects all-zero rows; builders push every line and the
// shared filter drops the zero-value ones before insert.
const dropZeroLines = (lines) => lines.filter((l) => l.debit !== 0 || l.credit !== 0);

function createSaleEntry(order, entryNumber) {
  const line = (account_code, account_name, account_type, debit, credit, description) => ({
    account_code, account_name, account_type, debit, credit, description,
  });
  // Mirrors createSaleEntry in src/lib/accounting/doubleEntry.ts.
  const lines = [];
  const cogs = round2(order.items.reduce((s, i) => s + i.line_cost, 0));
  lines.push(line("1000", "Cash", "asset", round2(order.total_amount - order.payment_fee), 0, `Net proceeds from ${order.order_number}`));
  lines.push(line("5200", "Payment Processing Fees", "expense", order.payment_fee, 0, `Payment gateway fee on ${order.order_number}`));
  lines.push(line("4400", "Discounts Given", "revenue", order.discount_amount, 0, `Discounts on ${order.order_number}`));
  lines.push(line("4000", "Sales Revenue", "revenue", 0, order.subtotal, `Product sales ${order.order_number}`));
  lines.push(line("4100", "Shipping Revenue", "revenue", 0, order.shipping_amount, `Shipping charged ${order.order_number}`));
  lines.push(line("2100", "Sales Tax Payable", "liability", 0, order.tax_amount, `Sales tax collected ${order.order_number}`));
  lines.push(line("5000", "Cost of Goods Sold", "expense", cogs, 0, `COGS ${order.order_number} (${order.items.length} line items)`));
  lines.push(line("1200", "Inventory", "asset", 0, cogs, `Inventory out for ${order.order_number}`));
  return {
    store_id: order.store_id,
    entry_number: entryNumber,
    entry_date: order.ordered_at.slice(0, 10),
    description: `Sale ${order.order_number} — ${order.customer_name}`,
    reference: order.external_id,
    source: "order",
    status: "posted",
    lines: dropZeroLines(lines),
  };
}

function createCreditSaleEntry(order, entryNumber) {
  const line = (account_code, account_name, account_type, debit, credit, description) => ({
    account_code, account_name, account_type, debit, credit, description,
  });
  // Mirrors createCreditSaleEntry in src/lib/accounting/doubleEntry.ts:
  // pending orders are booked on credit — Dr Accounts Receivable, not cash.
  const lines = [];
  const cogs = round2(order.items.reduce((s, i) => s + i.line_cost, 0));
  lines.push(line("1100", "Accounts Receivable", "asset", order.total_amount, 0, `Receivable for ${order.order_number}`));
  lines.push(line("4400", "Discounts Given", "revenue", order.discount_amount, 0, `Discounts on ${order.order_number}`));
  lines.push(line("4000", "Sales Revenue", "revenue", 0, order.subtotal, `Product sales ${order.order_number}`));
  lines.push(line("4100", "Shipping Revenue", "revenue", 0, order.shipping_amount, `Shipping charged ${order.order_number}`));
  lines.push(line("2100", "Sales Tax Payable", "liability", 0, order.tax_amount, `Sales tax collected ${order.order_number}`));
  lines.push(line("5000", "Cost of Goods Sold", "expense", cogs, 0, `COGS ${order.order_number} (${order.items.length} line items)`));
  lines.push(line("1200", "Inventory", "asset", 0, cogs, `Inventory out for ${order.order_number}`));
  return {
    store_id: order.store_id,
    entry_number: entryNumber,
    entry_date: order.ordered_at.slice(0, 10),
    description: `Credit sale ${order.order_number} — ${order.customer_name}`,
    reference: order.external_id,
    source: "order",
    status: "posted",
    lines: dropZeroLines(lines),
  };
}

function createRefundEntry(order, refundAmount, entryNumber) {
  const line = (account_code, account_name, account_type, debit, credit, description) => ({
    account_code, account_name, account_type, debit, credit, description,
  });
  // Mirrors createRefundEntry in src/lib/accounting/doubleEntry.ts:
  //   Dr Refunds Given (refund amount) / Cr Cash (refund amount)
  //   Dr Inventory (COGS × refunded share) / Cr COGS (COGS × refunded share)
  const refundedShare = order.total_amount > 0 ? Math.min(1, refundAmount / order.total_amount) : 0;
  const cogsRefunded = round2(order.items.reduce((s, i) => s + i.line_cost, 0) * refundedShare);
  const lines = [];
  lines.push(line("4500", "Refunds Given", "revenue", refundAmount, 0, `Refund issued for ${order.order_number}`));
  lines.push(line("1000", "Cash", "asset", 0, refundAmount, `Cash back to customer ${order.order_number}`));
  lines.push(line("1200", "Inventory", "asset", cogsRefunded, 0, `Returned inventory ${order.order_number}`));
  lines.push(line("5000", "Cost of Goods Sold", "expense", 0, cogsRefunded, `COGS reversal for returned goods ${order.order_number}`));
  return {
    store_id: order.store_id,
    entry_number: entryNumber,
    entry_date: order.ordered_at.slice(0, 10),
    description: `Refund ${order.order_number} — ${order.customer_name}`,
    reference: order.external_id,
    source: "refund",
    status: "posted",
    lines: dropZeroLines(lines),
  };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function fail(message) {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

function randomUUID() {
  return crypto.randomUUID();
}

/** Quote a Postgres identifier (schema/table names built by this app). */
function qI(name) {
  const normalized = String(name).toLowerCase();
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(normalized)) {
    fail(`Invalid database identifier: ${JSON.stringify(name)}`);
  }
  return `"${normalized}"`;
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    fail("DATABASE_URL missing. Add your Neon connection string to .env.local.");
  }

  const ownerEmail = process.env.SEED_USER_EMAIL || "bood68155@gmail.com";
  console.log(`\nSeeding demo data for ${ownerEmail} …\n`);

  const client = new Client({ connectionString });
  await client.connect();

  try {
    // 1. Resolve the owner user (must already exist — sign up first).
    const userRes = await client.query(
      "select id, email from users where lower(email) = $1 limit 1",
      [ownerEmail.toLowerCase()],
    );
    const owner = userRes.rows[0];
    if (!owner) {
      fail(
        `No user with email "${ownerEmail}" found. Sign up first (or set SEED_USER_EMAIL to an existing account), then re-run.`,
      );
    }

    // 2. Ensure a tenant + schema exist for the owner.
    const tenantRes = await client.query(
      "select id, schema_name from tenants where owner_id = $1 limit 1",
      [owner.id],
    );

    let tenantId = tenantRes.rows[0]?.id ?? null;
    let schemaName = tenantRes.rows[0]?.schema_name ?? null;

    if (!tenantId) {
      const created = await client.query(
        "insert into tenants (owner_id, name, slug, schema_name) values ($1, $2, $3, '') returning id",
        [owner.id, "Demo Workspace", `demo-${randomUUID().slice(0, 8)}`],
      );
      tenantId = created.rows[0].id;

      const provisioned = await client.query(
        "select public.create_tenant_schema($1) as schema",
        [tenantId],
      );
      schemaName = provisioned.rows[0].schema;

      await client.query("update tenants set schema_name = $2 where id = $1", [tenantId, schemaName]);
      await client.query(
        "insert into tenant_users (tenant_id, user_id, role) values ($1, $2, 'owner') on conflict do nothing",
        [tenantId, owner.id],
      );
      console.log(`  created tenant ${tenantId} → schema ${schemaName}`);
    } else {
      console.log(`  reusing tenant ${tenantId} → schema ${schemaName}`);
    }

    if (!schemaName) fail("Could not resolve the tenant schema.");
    const T = (table) => `${qI(schemaName)}.${qI(table)}`;

    // 3. Demo store (fixed id so re-seeding is idempotent).
    const DEMO_STORE_ID = "00000000-0000-4000-8000-00000000a000";
    await client.query(
      `insert into ${T("stores")} (id, user_id, name, platform, domain, currency, status, config)
       values ($1, $2, 'Aurora & Oak', 'shopify', 'auroraandoak.myshopify.com', 'USD', 'connected', '{"seeded":true}'::jsonb)
       on conflict (id) do update set name = excluded.name, updated_at = now()`,
      [DEMO_STORE_ID, owner.id],
    );

    // 4. Chart of accounts.
    await client.query(`select ${qI(schemaName)}.seed_chart_of_accounts($1)`, [DEMO_STORE_ID]);

    // 5. Products.
    for (const [i, p] of CATALOG.entries()) {
      await client.query(
        `insert into ${T("products")} (store_id, external_id, sku, title, cost_price, selling_price)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (store_id, sku) do update set
           title = excluded.title, cost_price = excluded.cost_price,
           selling_price = excluded.selling_price, updated_at = now()`,
        [DEMO_STORE_ID, `shopify-prod-${1000 + i}`, p.sku, p.name, p.cost, p.price],
      );
    }

    // 6. Reset the demo store's transactional data so the deterministic
    //    dataset (and its entry numbering) is rebuilt cleanly each run.
    //    Cascades take care of order_items and journal_lines.
    //    The journal immutability triggers are suspended first — this is an
    //    explicit maintenance rewrite of the demo ledger.
    if (!ledgerGuardSuspended) {
      await client.query("set app.ledger_guard = 'off'");
      ledgerGuardSuspended = true;
      console.log("  ledger immutability guard suspended for the demo re-seed");
    }
    await client.query(`delete from ${T("integration_events")} where store_id = $1`, [DEMO_STORE_ID]);
    await client.query(`delete from ${T("journal_entries")} where store_id = $1`, [DEMO_STORE_ID]);
    await client.query(`delete from ${T("orders")} where store_id = $1`, [DEMO_STORE_ID]);

    // 7. Orders → order_items → journal entries → integration events.
    const orders = generateOrders(DEMO_STORE_ID);

    let entryNumber = 0;
    let orderCount = 0;
    let entryCount = 0;
    let pendingCount = 0;

    for (const order of orders) {
      const inserted = await client.query(
        `insert into ${T("orders")}
           (store_id, external_id, order_number, customer_name, currency,
            subtotal, shipping_amount, discount_amount, tax_amount, total_amount,
            payment_gateway, payment_fee, shipping_cost, refund_amount, status, ordered_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         returning id`,
        [
          order.store_id, order.external_id, order.order_number, order.customer_name, order.currency,
          order.subtotal, order.shipping_amount, order.discount_amount, order.tax_amount, order.total_amount,
          order.payment_gateway, order.payment_fee, order.shipping_cost, order.refund_amount,
          order.status, order.ordered_at,
        ],
      );
      const orderId = inserted.rows[0].id;
      orderCount += 1;
      if (order.status === "pending") pendingCount += 1;

      for (const item of order.items) {
        await client.query(
          `insert into ${T("order_items")}
             (order_id, sku, name, quantity, unit_price, unit_cost, line_subtotal, line_cost)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [orderId, item.sku, item.name, item.quantity, item.unit_price, item.unit_cost, item.line_subtotal, item.line_cost],
        );
      }

      // Journal entries: pending orders book as credit sales (Dr AR); paid
      // orders book cash sales; refunds post their reversal entry.
      const entries = [];
      entryNumber += 1;
      if (order.status === "pending") {
        entries.push(createCreditSaleEntry(order, entryNumber));
      } else {
        entries.push(createSaleEntry(order, entryNumber));
      }
      if (order.refund_amount > 0) {
        entryNumber += 1;
        entries.push(createRefundEntry(order, order.refund_amount, entryNumber));
      }

      const postedNumbers = [];
      for (const entry of entries) {
        const entryRow = await client.query(
          `insert into ${T("journal_entries")}
             (store_id, entry_number, entry_date, description, reference, source, status)
           values ($1,$2,$3,$4,$5,$6,$7)
           returning id`,
          [entry.store_id, entry.entry_number, entry.entry_date, entry.description, entry.reference, entry.source, entry.status],
        );
        const entryId = entryRow.rows[0].id;
        entryCount += 1;
        postedNumbers.push(entry.entry_number);

        for (const line of entry.lines) {
          await client.query(
            `insert into ${T("journal_lines")}
               (entry_id, account_code, account_name, account_type, description, debit, credit)
             values ($1,$2,$3,$4,$5,$6,$7)`,
            [entryId, line.account_code, line.account_name, line.account_type, line.description, line.debit, line.credit],
          );
        }
      }

      await client.query(
        `update ${T("orders")} set entry_numbers = $2 where id = $1`,
        [orderId, postedNumbers],
      );

      await client.query(
        `insert into ${T("integration_events")}
           (store_id, provider, event_type, payload, status, processed_at)
         values ($1, $2, $3, $4::jsonb, 'processed', $5)`,
        [
          DEMO_STORE_ID,
          order.gateway_provider,
          order.refund_amount > 0 ? "refund" : "orders/create",
          JSON.stringify({ order_number: order.order_number }),
          new Date(new Date(order.ordered_at).getTime() + 45_000).toISOString(),
        ],
      );
    }

    const monthsCovered = new Set(orders.map((o) => o.ordered_at.slice(0, 7)));
    console.log(`  store:        Aurora & Oak (${DEMO_STORE_ID})`);
    console.log(`  products:     ${CATALOG.length}`);
    console.log(`  months:       ${monthsCovered.size}`);
    console.log(`  orders:       ${orderCount} (${pendingCount} pending → Accounts Receivable)`);
    console.log(`  entries:      ${entryCount}`);
    console.log(`  events:       ${orders.length}`);
    console.log(
      `\n✅ Demo data seeded with ${monthsCovered.size} months of history and planted anomalies\n` +
      `   (refund spike, order outlier, below-cost sale, missing COGS) —\n` +
      `   sign in as the owner to see the AI insights, forecast and balance sheet light up.\n`,
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
