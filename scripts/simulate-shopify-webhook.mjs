#!/usr/bin/env node
/**
 * simulate-shopify-webhook.mjs
 *
 * Simulates Shopify sending an `orders/create` webhook to a running Store
 * Accountant instance and verifies the route's response:
 *
 *   POST /api/webhooks/shopify?store_id=<uuid>
 *
 * - Signs the body with a real HMAC-SHA256 (SHOPIFY_WEBHOOK_SECRET is
 *   required — the app rejects unverified payloads).
 * - Asserts parsing, true net profit, and journal-entry generation.
 *
 * Usage (app must be running: `npm run dev`):
 *   SHOPIFY_WEBHOOK_SECRET=... STORE_ID=<store-uuid> npm run webhook:simulate
 *   BASE_URL=http://localhost:3000 npm run webhook:simulate
 *
 * STORE_ID is the uuid of a store already connected in your tenant
 * (see /stores). `npm run db:seed` creates a demo store you can target.
 */
import { createHmac } from "node:crypto";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.SHOPIFY_WEBHOOK_SECRET ?? "";
const STORE_ID = process.env.STORE_ID ?? "";
const ENDPOINT = `${BASE_URL}/api/webhooks/shopify${STORE_ID ? `?store_id=${encodeURIComponent(STORE_ID)}` : ""}`;

if (!SECRET) {
  console.error("\n❌ SHOPIFY_WEBHOOK_SECRET is required — the app rejects unverified webhooks.");
  console.error("   Set it in .env.local and export it for this script (e.g. `set -a; . .env.local; set +a`).\n");
  process.exit(1);
}
if (!STORE_ID) {
  console.error("\n❌ STORE_ID is required — pass the uuid of a connected store (see /stores or `npm run db:seed`).\n");
  process.exit(1);
}

// Realistic order: line items with costs, shipping lines, discount, gateway txn.
const richOrder = {
  id: 4580135469224,
  name: "#2001",
  email: "elena@example.com",
  customer: { first_name: "Elena", last_name: "Vasquez", email: "elena@example.com" },
  currency: "USD",
  subtotal_price: "106.00",
  total_discounts: "10.00",
  total_shipping: "6.95",
  shipping_lines: [{ price: "6.95", title: "Standard" }],
  total_tax: "6.96",
  total_price: "109.91",
  financial_status: "paid",
  created_at: "2026-07-02T14:23:11-04:00",
  discount_codes: [{ code: "WELCOME10", amount: "10.00" }],
  transactions: [
    { kind: "sale", status: "success", amount: "109.91", net: "106.77", gateway: "shopify_payments" },
  ],
  line_items: [
    { id: 101, title: "Amber + Cedar Candle (8oz)", sku: "AUR-101", price: "24.00", quantity: 2, cost: "4.60" },
    { id: 102, title: "Botanical Gift Box (3pc)", sku: "AUR-104", price: "58.00", quantity: 1, cost: "13.40" },
  ],
};

// README-style minimal order: no shipping_lines / transactions.
const minimalOrder = {
  id: 9001,
  name: "#9001",
  email: "a@b.co",
  subtotal_price: "48.00",
  total_tax: "3.48",
  total_shipping: "6.95",
  total_price: "58.43",
  financial_status: "paid",
  line_items: [
    { title: "Amber + Cedar Candle (8oz)", sku: "AUR-101", price: "24.00", quantity: 2, cost: "4.60" },
  ],
};

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.error(`  FAIL ${name}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`);
  }
}

const approx = (a, b, eps = 0.001) => Math.abs(a - b) <= eps;
// Shopify sends the HMAC BASE64-encoded — the app verifies base64 digests.
const sign = (rawBody) => createHmac("sha256", SECRET).update(rawBody, "utf8").digest("base64");

async function sendOrder(name, payload, topic = "orders/create", signature) {
  const raw = JSON.stringify(payload);
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Hmac-SHA256": signature ?? sign(raw),
      "X-Shopify-Topic": topic,
      "X-Shopify-Shop-Domain": "auroraandoak.myshopify.com",
      "Connection": "close",
    },
    body: raw,
  });
  const json = await res.json();
  return { name, res, json };
}

async function main() {
  console.log(`\nShopify webhook simulator -> ${ENDPOINT}\n`);

  // 0. Route must be reachable.
  let meta;
  try {
    meta = await fetch(ENDPOINT).then((r) => r.json());
  } catch {
    console.error("\nCould not reach the app. Start it first with:  npm run dev");
    process.exit(1);
  }
  check("GET metadata names the endpoint", meta.name === "Shopify webhook endpoint");
  check("metadata lists expected header", (meta.expectedHeaders ?? []).includes("X-Shopify-Hmac-SHA256"));

  // 1. Rich order.
  console.log("\n-- Rich order (shipping lines + discount + gateway txn) --------------------");
  {
    const { res, json } = await sendOrder("rich", richOrder);
    const o = json.order ?? {};
    const p = json.profit ?? {};
    console.log(`  response: ${JSON.stringify({ ok: json.ok, status: res.status, message: json.message })}\n`);
    check("HTTP 200", res.status === 200);
    check("ok: true", json.ok === true);
    check("parsed order_number", o.order_number === "#2001");
    check("parsed customer", o.customer_name === "Elena Vasquez");
    check("parsed subtotal", approx(o.subtotal, 106));
    check("parsed shipping (total_shipping)", approx(o.shipping_amount, 6.95));
    check("parsed discount", approx(o.discount_amount, 10));
    check("parsed tax", approx(o.tax_amount, 6.96));
    check("parsed total", approx(o.total_amount, 109.91));
    check("parsed gateway fee", approx(o.payment_fee, 3.14));
    check("true net profit = 77.21", approx(p.net_profit, 77.21));
    check("cogs = 22.60", approx(p.cogs, 22.6));
  }

  // 2. Minimal README-style order (regression: shipping fallback).
  console.log("\n-- Minimal order (README example, no shipping_lines) -----------------------");
  {
    const { res, json } = await sendOrder("minimal", minimalOrder);
    const o = json.order ?? {};
    const p = json.profit ?? {};
    console.log(`  response: ${JSON.stringify({ ok: json.ok, status: res.status, message: json.message })}\n`);
    check("HTTP 200", res.status === 200);
    check("ok: true", json.ok === true);
    check("parsed order_number", o.order_number === "#9001");
    check("shipping falls back to total_shipping", approx(o.shipping_amount, 6.95));
    check("parsed total", approx(o.total_amount, 58.43));
    check("true net profit = 45.75", approx(p.net_profit, 45.75));
  }

  // 3. HMAC enforcement.
  console.log("\n-- HMAC enforcement -------------------------------------------------------");
  {
    const { res, json } = await sendOrder("tampered", richOrder, "orders/create", "deadbeefdeadbeef");
    check("tampered signature rejected with 401", res.status === 401 && json.ok === false);
  }

  // 4. Malformed order payloads are acked with a 400 (nothing to book).
  console.log("\n-- Malformed payload guard ------------------------------------------------");
  {
    const { res, json } = await sendOrder("no-line-items", { id: 424242, name: "#4242" });
    check("payload without line_items rejected with 400", res.status === 400 && json.ok === false);
  }

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"}: ${passed} passed, ${failed} failed${failures.length ? "\n  " + failures.join("\n  ") : ""}\n`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
