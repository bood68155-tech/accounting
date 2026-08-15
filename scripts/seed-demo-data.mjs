/**
 * ── Demo data seed (multi-tenant) ─────────────────────────────────────────────
 *
 * Provisions a working demo tenant + schema + store with realistic orders,
 * journal entries and webhook events, using the service role. This replaces the
 * old in-app "demo mode": the app itself always talks to Supabase, and this
 * script is how you get sample data into a fresh database.
 *
 * Requirements (in .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   SEED_USER_EMAIL            — the account that should own the demo tenant
 *                                (defaults to the platform admin email)
 *
 * Usage:
 *   npm run db:seed
 *
 * The script is idempotent: re-running it will not duplicate the demo store
 * (it upserts by the fixed demo store id / order external ids).
 */
import { createClient } from "@supabase/supabase-js";

// ─── deterministic PRNG + catalog (same dataset as the legacy demo mode) ─────

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

/** ~6 months of realistic orders (deterministic). */
function generateOrders(storeId) {
  const rand = mulberry32(20260714);
  const orders = [];
  let orderCounter = 1000;

  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const between = (min, max) => min + rand() * (max - min);

  for (let monthOffset = 5; monthOffset >= 0; monthOffset--) {
    const monthStart = startOfMonth(monthOffset);
    const dim = daysInMonth(monthStart);
    const orderCount = 8 + Math.floor(rand() * 5);

    for (let i = 0; i < orderCount; i++) {
      orderCounter += 1;

      const lineCount = 1 + Math.floor(rand() * 3);
      const chosen = new Set();
      const items = [];
      for (let l = 0; l < lineCount; l++) {
        let idx = Math.floor(rand() * CATALOG.length);
        while (chosen.has(idx)) idx = Math.floor(rand() * CATALOG.length);
        chosen.add(idx);
        const product = CATALOG[idx];
        const quantity = rand() < 0.25 ? 2 : 1;
        items.push({
          sku: product.sku,
          name: product.name,
          quantity,
          unit_price: product.price,
          unit_cost: product.cost,
          line_subtotal: round2(product.price * quantity),
          line_cost: round2(product.cost * quantity),
        });
      }

      const subtotal = round2(items.reduce((s, i) => s + i.line_subtotal, 0));
      const hasDiscount = rand() < 0.35;
      const discountAmount = hasDiscount ? round2(subtotal * between(0.05, 0.2)) : 0;
      const shippingAmount = round2(between(5.95, 11.95));
      const taxAmount = round2((subtotal - discountAmount) * 0.0725);
      const totalAmount = round2(subtotal - discountAmount + shippingAmount + taxAmount);
      const paymentFee = round2(totalAmount * 0.029 + 0.3);
      const gateway = rand() < 0.7 ? "Shopify Payments" : "PayPal";

      const day = 1 + Math.floor(rand() * dim);
      const orderedAt = new Date(
        Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day, 3 + Math.floor(rand() * 16), Math.floor(rand() * 60)),
      ).toISOString();

      const isRefunded = rand() < 0.06;
      const refundAmount = isRefunded ? round2(totalAmount * (rand() < 0.5 ? 0.5 : 1)) : 0;

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
        status: refundAmount >= totalAmount ? "refunded" : refundAmount > 0 ? "partially_refunded" : "paid",
        ordered_at: orderedAt,
        items,
        gateway_provider: gateway === "PayPal" ? "paypal" : "shopify",
      });
    }
  }

  return orders.sort((a, b) => a.ordered_at.localeCompare(b.ordered_at));
}

// ─── double-entry helpers (mirror of src/lib/accounting/doubleEntry.ts) ──────

function createSaleEntry(order, entryNumber) {
  const line = (account_code, account_name, account_type, debit, credit, description) => ({
    account_code, account_name, account_type, debit, credit, description,
  });
  // Mirrors createSaleEntry in src/lib/accounting/doubleEntry.ts, skipping
  // zero-value lines (journal_lines rejects all-zero rows).
  const lines = [];
  const cogs = round2(order.items.reduce((s, i) => s + i.line_cost, 0));
  lines.push(line("1000", "Cash", "asset", round2(order.total_amount - order.payment_fee), 0, `Net proceeds from ${order.order_number}`));
  if (order.payment_fee > 0) lines.push(line("5200", "Payment Processing Fees", "expense", order.payment_fee, 0, `Payment gateway fee on ${order.order_number}`));
  if (order.discount_amount > 0) lines.push(line("4400", "Discounts Given", "revenue", order.discount_amount, 0, `Discounts on ${order.order_number}`));
  lines.push(line("4000", "Sales Revenue", "revenue", 0, order.subtotal, `Product sales ${order.order_number}`));
  if (order.shipping_amount > 0) lines.push(line("4100", "Shipping Revenue", "revenue", 0, order.shipping_amount, `Shipping charged ${order.order_number}`));
  if (order.tax_amount > 0) lines.push(line("2100", "Sales Tax Payable", "liability", 0, order.tax_amount, `Sales tax collected ${order.order_number}`));
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
    lines,
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
    lines,
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

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    fail(
      "Supabase credentials missing. Add NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.local.",
    );
  }

  const ownerEmail = process.env.SEED_USER_EMAIL || "bood68155@gmail.com";
  console.log(`\nSeeding demo data for ${ownerEmail} …\n`);

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Resolve the owner user (must exist in auth.users).
  const { data: userPage, error: userError } = await admin.auth.admin.listUsers();
  if (userError) fail(`Failed to list users: ${userError.message}`);
  const owner = (userPage?.users ?? []).find((u) => u.email?.toLowerCase() === ownerEmail.toLowerCase());
  if (!owner) {
    fail(
      `No auth user with email "${ownerEmail}" found. Sign up first (or set SEED_USER_EMAIL to an existing account), then re-run.`,
    );
  }

  // 2. Ensure a tenant + schema exist for the owner.
  const { data: tenant } = await admin
    .from("tenants")
    .select("id, schema_name")
    .eq("owner_id", owner.id)
    .maybeSingle();

  let tenantId = tenant?.id ?? null;
  let schemaName = tenant?.schema_name ?? null;

  if (!tenantId) {
    const { data: created, error: tenantError } = await admin
      .from("tenants")
      .insert({ owner_id: owner.id, name: "Demo Workspace", slug: `demo-${randomUUID().slice(0, 8)}`, schema_name: "" })
      .select("id")
      .single();
    if (tenantError) fail(`Failed to create tenant: ${tenantError.message}`);
    tenantId = created.id;

    const { data: provisioned, error: provisionError } = await admin.rpc("create_tenant_schema", {
      p_tenant_id: tenantId,
    });
    if (provisionError) fail(`Failed to provision tenant schema: ${provisionError.message}`);
    schemaName = provisioned;

    await admin.from("tenants").update({ schema_name: schemaName }).eq("id", tenantId);
    await admin.from("tenant_users").insert({ tenant_id: tenantId, user_id: owner.id, role: "owner" });
    console.log(`  created tenant ${tenantId} → schema ${schemaName}`);
  } else {
    console.log(`  reusing tenant ${tenantId} → schema ${schemaName}`);
  }

  if (!schemaName) fail("Could not resolve the tenant schema.");

  const db = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: schemaName },
  });

  // 3. Demo store (fixed id so re-seeding is idempotent).
  const DEMO_STORE_ID = "00000000-0000-4000-8000-00000000a000";
  const store = {
    id: DEMO_STORE_ID,
    user_id: owner.id,
    name: "Aurora & Oak",
    platform: "shopify",
    domain: "auroraandoak.myshopify.com",
    currency: "USD",
    status: "connected",
    config: { seeded: true },
  };
  const { error: storeError } = await db.from("stores").upsert(store, { onConflict: "id" });
  if (storeError) fail(`Failed to upsert demo store: ${storeError.message}`);

  // 4. Chart of accounts.
  const { error: coaError } = await db.rpc("seed_chart_of_accounts", { p_store_id: DEMO_STORE_ID });
  if (coaError) fail(`Failed to seed chart of accounts: ${coaError.message}`);

  // 5. Products.
  const products = CATALOG.map((p, i) => ({
    store_id: DEMO_STORE_ID,
    external_id: `shopify-prod-${1000 + i}`,
    sku: p.sku,
    name: p.name,
    unit_cost: p.cost,
    unit_price: p.price,
  }));
  const { error: productsError } = await db.from("products").upsert(products, { onConflict: "store_id,sku" });
  if (productsError) fail(`Failed to upsert products: ${productsError.message}`);

  // 6. Orders → order_items → journal entries → integration events.
  const orders = generateOrders(DEMO_STORE_ID);
  let entryNumber = 0;
  let orderCount = 0;
  let entryCount = 0;

  for (const order of orders) {
    const { data: inserted, error: orderError } = await db
      .from("orders")
      .upsert(
        {
          store_id: order.store_id,
          external_id: order.external_id,
          order_number: order.order_number,
          customer_name: order.customer_name,
          currency: order.currency,
          subtotal: order.subtotal,
          shipping_amount: order.shipping_amount,
          discount_amount: order.discount_amount,
          tax_amount: order.tax_amount,
          total_amount: order.total_amount,
          payment_gateway: order.payment_gateway,
          payment_fee: order.payment_fee,
          shipping_cost: order.shipping_cost,
          refund_amount: order.refund_amount,
          status: order.status,
          ordered_at: order.ordered_at,
        },
        { onConflict: "store_id,external_id" },
      )
      .select("id")
      .single();
    if (orderError) fail(`Failed to upsert order ${order.order_number}: ${orderError.message}`);
    orderCount += 1;

    // Keep items idempotent: replace items for this order rather than upserting.
    await db.from("order_items").delete().eq("order_id", inserted.id);
    const { error: itemsError } = await db.from("order_items").insert(
      order.items.map((item) => ({
        order_id: inserted.id,
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        unit_cost: item.unit_cost,
        line_subtotal: item.line_subtotal,
        line_cost: item.line_cost,
      })),
    );
    if (itemsError) fail(`Failed to insert order items for ${order.order_number}: ${itemsError.message}`);

    // Journal entries (sale + refund) + entry_numbers tracking.
    const entries = [];
    entryNumber += 1;
    entries.push(createSaleEntry(order, entryNumber));
    if (order.refund_amount > 0) {
      entryNumber += 1;
      entries.push(createRefundEntry(order, order.refund_amount, entryNumber));
    }

    for (const entry of entries) {
      const { data: entryRow, error: entryError } = await db
        .from("journal_entries")
        .upsert(
          {
            store_id: entry.store_id,
            entry_number: entry.entry_number,
            entry_date: entry.entry_date,
            description: entry.description,
            reference: entry.reference,
            source: entry.source,
            status: entry.status,
          },
          { onConflict: "store_id,entry_number" },
        )
        .select("id")
        .single();
      if (entryError) fail(`Failed to upsert journal entry: ${entryError.message}`);
      entryCount += 1;

      await db.from("journal_lines").delete().eq("entry_id", entryRow.id);
      const { error: linesError } = await db.from("journal_lines").insert(
        entry.lines.map((line) => ({
          entry_id: entryRow.id,
          account_code: line.account_code,
          account_name: line.account_name,
          account_type: line.account_type,
          description: line.description,
          debit: line.debit,
          credit: line.credit,
        })),
      );
      if (linesError) fail(`Failed to insert journal lines: ${linesError.message}`);
    }

    await db
      .from("orders")
      .update({ entry_numbers: entries.map((e) => e.entry_number) })
      .eq("id", inserted.id);

    const { error: eventError } = await db.from("integration_events").insert({
      store_id: DEMO_STORE_ID,
      provider: order.gateway_provider,
      event_type: order.refund_amount > 0 ? "refund" : "orders/create",
      payload: { order_number: order.order_number },
      status: "processed",
      processed_at: new Date(new Date(order.ordered_at).getTime() + 45_000).toISOString(),
    });
    if (eventError) fail(`Failed to insert integration event: ${eventError.message}`);
  }

  console.log(`  store:        Aurora & Oak (${DEMO_STORE_ID})`);
  console.log(`  products:     ${CATALOG.length}`);
  console.log(`  orders:       ${orderCount}`);
  console.log(`  entries:      ${entryCount}`);
  console.log(`  events:       ${orders.length}`);
  console.log("\n✅ Demo data seeded. Sign in as the owner to explore the dashboard, ledger and income statement.\n");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
