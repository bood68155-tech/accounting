#!/usr/bin/env node
/**
 * simulate-salla-webhook.mjs
 *
 * Simulates Salla sending order.created / order.refunded / order.cancelled
 * webhooks to a running instance and verifies the route's response — mirrors
 * scripts/simulate-shopify-webhook.mjs. Payloads follow the v2 envelope from
 * docs.salla.dev ({ event, merchant, data: {…order} }) and are signed with
 * HMAC-SHA256 hex of the raw body (Salla "signature" security strategy).
 *
 * Usage (app must be running: `npm run dev`):
 *   SALLA_WEBHOOK_SECRET=... STORE_ID=<uuid> npm run webhook:simulate-salla
 *   BASE_URL=http://localhost:3000 STORE_ID=... npm run webhook:simulate-salla
 *
 * STORE_ID is the uuid of a connected Salla store (see /stores).
 */
import { createHmac } from "node:crypto";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.SALLA_WEBHOOK_SECRET ?? "";
const STORE_ID = process.env.STORE_ID ?? "";
const MERCHANT = process.env.SALLA_MERCHANT ?? "1305146709";
const ENDPOINT = `${BASE_URL}/api/webhooks/salla${STORE_ID ? `?store_id=${encodeURIComponent(STORE_ID)}` : ""}`;

if (!SECRET) {
  console.error("\n❌ SALLA_WEBHOOK_SECRET is required — the app rejects unverified webhooks.");
  console.error("   Set it in .env.local and pass it to this script.\n");
  process.exit(1);
}
if (!STORE_ID) {
  console.error("\n❌ STORE_ID is required — pass the uuid of a connected Salla store (see /stores).\n");
  process.exit(1);
}

const ORDER_ID = 2116149737;
const REFERENCE_ID = 41027662;

function orderBase(statusSlug, statusName) {
  return {
    id: ORDER_ID,
    reference_id: REFERENCE_ID,
    date: { date: "2026-09-24 12:21:45.000000", timezone_type: 3, timezone: "Asia/Riyadh" },
    status: { id: 566146469, name: statusName, slug: statusSlug },
    payment_method: "credit_card",
    currency: "SAR",
    amounts: {
      sub_total: { amount: 186, currency: "SAR" },
      shipping_cost: { amount: 15, currency: "SAR" },
      cash_on_delivery: { amount: 0, currency: "SAR" },
      tax: { percent: "15.00", amount: { amount: 27.9, currency: "SAR" } },
      discounts: [{ title: "welcome", type: "coupon", code: "WELCOME10", discount: "10.00", discounted_shipping: 0 }],
      total: { amount: 218.9, currency: "SAR" },
    },
    customer: { first_name: "Mohammed", last_name: "Ali", mobile: 501806978, mobile_code: "+966" },
    items: [
      {
        id: 70815337,
        name: "بيتزا",
        sku: "SALLA-TEST-1",
        quantity: 2,
        currency: "SAR",
        amounts: {
          price_without_tax: { amount: 186, currency: "SAR" },
          total_discount: { amount: 10, currency: "SAR" },
          tax: { percent: "15.00", amount: { amount: 27.9, currency: "SAR" } },
          total: { amount: 203.9, currency: "SAR" },
        },
        product: { id: 720881993, sku: "SALLA-TEST-1", name: "بيتزا" },
      },
    ],
  };
}

const events = [
  { name: "order.created", payload: { event: "order.created", merchant: Number(MERCHANT), data: orderBase("under_review", "بإنتظار المراجعة") } },
  { name: "order.status.updated (paid)", payload: { event: "order.status.updated", merchant: Number(MERCHANT), data: orderBase("completed", "مكتمل") } },
  { name: "order.refunded", payload: { event: "order.refunded", merchant: Number(MERCHANT), data: { ...orderBase("restored", "مسترجع"), refunds: [{ id: 9001, amounts: { total: { amount: 218.9, currency: "SAR" } } }] } } },
  { name: "order.cancelled", payload: { event: "order.cancelled", merchant: Number(MERCHANT), data: orderBase("canceled", "ملغي") } },
];

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

// Salla signs with lowercase hex HMAC-SHA256 of the raw body.
const sign = (rawBody) => createHmac("sha256", SECRET).update(rawBody, "utf8").digest("hex");

async function send(name, payload, signature) {
  const raw = JSON.stringify(payload);
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Salla-Signature": signature ?? sign(raw),
      "X-Salla-Security-Strategy": "signature",
      Connection: "close",
    },
    body: raw,
  });
  const json = await res.json().catch(() => ({}));
  return { name, res, json };
}

async function main() {
  console.log(`\nSalla webhook simulator -> ${ENDPOINT}\n`);

  // 0. Route metadata.
  let meta;
  try {
    meta = await fetch(ENDPOINT).then((r) => r.json());
  } catch {
    console.error("\nCould not reach the app. Start it first with:  npm run dev");
    process.exit(1);
  }
  check("GET metadata names the endpoint", meta.name === "Salla webhook endpoint");
  check("metadata lists refund event", (meta.events ?? []).includes("order.refunded"));

  for (const ev of events) {
    console.log(`\n-- ${ev.name} ----------------------------------------------------------`);
    const { res, json } = await send(ev.name, ev.payload);
    console.log(`  response: ${JSON.stringify({ ok: json.ok, status: res.status, message: json.message })}`);
    if (ev.name === "order.created") {
      check("HTTP 200", res.status === 200);
      check("ok: true", json.ok === true);
      check("order imported", json.order?.external_id === String(ORDER_ID));
    } else if (ev.name === "order.refunded") {
      check("refund recorded", json.ok === true);
    } else if (ev.name === "order.cancelled") {
      check("cancellation processed (auto-reversal)", json.ok === true);
    }
  }

  // HMAC enforcement.
  {
    const { res } = await send("tampered signature", events[0].payload, "b".repeat(64));
    check("tampered signature rejected with 401", res.status === 401);
  }

  console.log(`\n${failed === 0 ? "PASS" : "FAIL"}: ${passed} passed, ${failed} failed${failures.length ? "\n  " + failures.join("\n  ") : ""}\n`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
