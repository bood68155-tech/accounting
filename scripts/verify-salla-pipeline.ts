/**
 * verify-salla-pipeline.ts
 *
 * In-process verification of the Salla webhook pipeline WITHOUT a server or a
 * database — mirroring scripts/verify-shopify-pipeline.ts:
 *   1. verifySallaWebhook   — HMAC-SHA256 hex signature checks
 *   2. extractSallaWebhook  — v2 envelope unwrapping ({event, merchant, data})
 *   3. normalizeSallaOrder  — order.created payload → canonical order
 *      (status slugs, nested tax, discounts array, localized/Arabic names)
 *   4. order.refunded flow  — refund records set refund_amount/status
 *   5. cancellation mapping — order.cancelled status slug → "cancelled"
 *
 * Run:  node scripts/run-ts.mjs scripts/verify-salla-pipeline.ts
 *       (or: npm run test:salla)
 */
import { createHmac } from "node:crypto";
import {
  extractSallaWebhook,
  normalizeSallaOrder,
  verifySallaWebhook,
} from "@/lib/providers/salla";
import { toOrder } from "@/lib/providers/types";
import { computeOrderProfit } from "@/lib/accounting/profitEngine";
import type { Order } from "@/types";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.error(`  FAIL ${name}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`);
  }
}

const approx = (a: number, b: number, eps = 0.001) => Math.abs(a - b) <= eps;

// ── Realistic order.created payload (v2 envelope, per docs.salla.dev) ─────────
const docsOrderCreated = {
  event: "order.created",
  merchant: 1305146709,
  created_at: "Sun Jun 26 2022 12:21:48 GMT+0300",
  data: {
    id: 2116149737,
    reference_id: 41027662,
    date: { date: "2026-09-24 12:21:45.000000", timezone_type: 3, timezone: "Asia/Riyadh" },
    status: { id: 566146469, name: "بإنتظار المراجعة", slug: "under_review" },
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
        sku: "54534534",
        quantity: 2,
        currency: "SAR",
        amounts: {
          price_without_tax: { amount: 186, currency: "SAR" },
          total_discount: { amount: 10, currency: "SAR" },
          tax: { percent: "15.00", amount: { amount: 27.9, currency: "SAR" } },
          total: { amount: 203.9, currency: "SAR" },
        },
        product: { id: 720881993, sku: "54534534", name: "بيتزا" },
      },
    ],
  },
};

// order.status.updated → completed (paid)
const docsOrderCompleted = {
  event: "order.status.updated",
  merchant: 1305146709,
  data: {
    id: 2116149737,
    reference_id: 41027662,
    date: { date: "2026-09-24 14:00:00.000000", timezone_type: 3, timezone: "Asia/Riyadh" },
    status: { id: 99, name: "مكتمل", slug: "completed" },
    payment_method: "credit_card",
    currency: "SAR",
    amounts: {
      sub_total: { amount: 186, currency: "SAR" },
      shipping_cost: { amount: 15, currency: "SAR" },
      tax: { percent: "15.00", amount: { amount: 27.9, currency: "SAR" } },
      discounts: [{ discount: "10.00" }],
      total: { amount: 218.9, currency: "SAR" },
    },
    customer: { first_name: "Mohammed", last_name: "Ali" },
    items: docsOrderCreated.data.items,
  },
};

// order.refunded — refund records carried in the payload
const docsOrderRefunded = {
  event: "order.refunded",
  merchant: 1305146709,
  data: {
    id: 2116149737,
    reference_id: 41027662,
    date: { date: "2026-09-25 09:00:00.000000", timezone_type: 3, timezone: "Asia/Riyadh" },
    status: { id: 100, name: "مسترجع", slug: "restored" },
    payment_method: "credit_card",
    currency: "SAR",
    amounts: {
      sub_total: { amount: 186, currency: "SAR" },
      shipping_cost: { amount: 15, currency: "SAR" },
      tax: { percent: "15.00", amount: { amount: 27.9, currency: "SAR" } },
      discounts: [{ discount: "10.00" }],
      total: { amount: 218.9, currency: "SAR" },
    },
    refunds: [{ id: 9001, amounts: { total: { amount: 218.9, currency: "SAR" } } }],
    customer: { first_name: "Mohammed", last_name: "Ali" },
    items: docsOrderCreated.data.items,
  },
};

console.log("\n-- 1. Signature verification (HMAC-SHA256 hex) ------------------------------");
{
  const secret = "test-salla-secret";
  const raw = JSON.stringify(docsOrderCreated);
  const good = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  check("valid signature accepted", verifySallaWebhook(raw, good, secret).valid);
  check("tampered signature rejected", !verifySallaWebhook(raw, "a".repeat(64), secret).valid);
  check("missing header rejected", !verifySallaWebhook(raw, null, secret).valid);
  check("unconfigured secret rejected", !verifySallaWebhook(raw, good, "").valid);
}

console.log("\n-- 2. Envelope extraction (v2 data{} wrapper) -------------------------------");
{
  const extracted = extractSallaWebhook(docsOrderCreated as never);
  check("event extracted", extracted.event === "order.created");
  check("merchant extracted", extracted.merchant === 1305146709);
  check("order unwrapped from data{}", extracted.order.id === 2116149737);
  check("reference_id present", extracted.order.reference_id === 41027662);

  // Top-level (legacy) payloads still work.
  const legacy = { event: "order.created", id: 42, reference_id: 43, amounts: {} };
  const legacyExtracted = extractSallaWebhook(legacy as never);
  check("legacy top-level order supported", legacyExtracted.order.id === 42);
}

console.log("\n-- 3. Normalization (order.created) -----------------------------------------");
{
  const n = normalizeSallaOrder(docsOrderCreated.data as never);
  const order: Order = toOrder(n, "salla-test-store", "SAR");

  check("external_id = order id", n.external_id === "2116149737");
  check("order_number = #reference_id", n.order_number === "#41027662");
  check("customer name", n.customer_name === "Mohammed Ali");
  check("currency SAR", n.currency === "SAR");
  check("subtotal from amounts.sub_total", approx(n.subtotal, 186));
  check("shipping 15", approx(n.shipping_amount, 15));
  check("discounts array summed (10)", approx(n.discount_amount, 10));
  check("nested tax extracted (27.90)", approx(n.tax_amount, 27.9));
  check("total 218.90", approx(n.total_amount, 218.9));
  check("status slug under_review → pending", n.status === "pending");
  check("gateway from payment_method", n.payment_gateway === "credit_card");
  check("date normalized to ISO", n.ordered_at.startsWith("2026-09-24T12:21:45"));
  check("item unit price pre-tax", approx(n.items[0].unit_price, 93));
  check("item qty 2", n.items[0].quantity === 2);
  check("store attached", order.store_id === "salla-test-store");

  const profit = computeOrderProfit(order);
  check("profit engine runs on salla order", Number.isFinite(profit.net_profit));
}

console.log("\n-- 4. Status update → paid + refund flow ------------------------------------");
{
  const paid = normalizeSallaOrder(docsOrderCompleted.data as never);
  check("slug completed → paid", paid.status === "paid");

  const refunded = normalizeSallaOrder(docsOrderRefunded.data as never);
  check("refund amount from refunds[].amounts.total", approx(refunded.refund_amount, 218.9));
  check("full refund → refunded status", refunded.status === "refunded");
}

console.log("\n-- 5. Cancellation mapping ---------------------------------------------------");
{
  const cancelledPayload = {
    ...docsOrderCompleted.data,
    status: { id: 101, name: "ملغي", slug: "canceled" },
  };
  const cancelled = normalizeSallaOrder(cancelledPayload as never);
  check("slug canceled → cancelled", cancelled.status === "cancelled");
}

console.log(`\n${failed === 0 ? "PASS" : "FAIL"}: ${passed} passed, ${failed} failed`
  + `${failures.length ? "\n  " + failures.join("\n  ") : ""}\n`);
process.exit(failed === 0 ? 0 : 1);
