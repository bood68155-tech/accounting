/**
 * verify-shopify-pipeline.ts
 *
 * In-process verification of the Shopify webhook pipeline WITHOUT a server
 * or a database:
 *   1. verifyShopifyWebhook  - HMAC-SHA256 signature checks
 *   2. normalizeShopifyOrder - payload parsing into a canonical order
 *   3. computeOrderProfit    - true net profit (net sales - COGS - fees - shipping)
 *   4. createSaleEntry       - balanced double-entry journal entry
 *   5. createRefundEntry     - balanced refund entry
 *
 * Run:  node scripts/run-ts.mjs scripts/verify-shopify-pipeline.ts
 *       (or: npm run test:shopify)
 */
import { createHmac } from "node:crypto";
import { verifyShopifyWebhook, normalizeShopifyOrder } from "@/lib/providers/shopify";
import { toOrder } from "@/lib/providers/types";
import { computeOrderProfit } from "@/lib/accounting/profitEngine";
import {
  createSaleEntry,
  createRefundEntry,
  validateEntry,
  line,
} from "@/lib/accounting/doubleEntry";
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
const lineTotal = (entry: ReturnType<typeof createSaleEntry>, side: "debit" | "credit") =>
  entry.lines.reduce((sum, l) => sum + l[side], 0);

// Realistic orders/create payload: shipping lines, discount code + gateway txn.
const richPayload = {
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

// README example - no shipping_lines / transactions (shipping fallback regression).
const minimalPayload = {
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

console.log("\n-- 1. Signature verification (HMAC-SHA256) --------------------------------");
{
  const secret = "test-webhook-secret";
  const raw = JSON.stringify(richPayload);
  const goodDigest = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  check("valid HMAC accepted", verifyShopifyWebhook(raw, goodDigest, secret).valid);
  check("tampered HMAC rejected", !verifyShopifyWebhook(raw, "deadbeef", secret).valid);
  check("missing header rejected", !verifyShopifyWebhook(raw, null, secret).valid);
  check("unconfigured secret rejected", !verifyShopifyWebhook(raw, goodDigest, "").valid);
  check("wrong-length header rejected", !verifyShopifyWebhook(raw, "tooshort", secret).valid);
}

console.log("\n-- 2. Payload normalization (orders/create) -------------------------------");
let order: Order;
let minimalOrder: Order;
{
  const n = normalizeShopifyOrder(richPayload as Parameters<typeof normalizeShopifyOrder>[0]);
  order = toOrder(n, "demo-aurora-oak", "USD");
  check("external_id", n.external_id === "4580135469224");
  check("order_number", n.order_number === "#2001");
  check("customer_name", n.customer_name === "Elena Vasquez");
  check("currency", n.currency === "USD");
  check("subtotal", approx(n.subtotal, 106));
  check("shipping_amount", approx(n.shipping_amount, 6.95));
  check("discount_amount", approx(n.discount_amount, 10));
  check("tax_amount", approx(n.tax_amount, 6.96));
  check("total_amount", approx(n.total_amount, 109.91));
  check("payment_fee (amount - net)", approx(n.payment_fee, 3.14));
  check("payment_gateway", n.payment_gateway === "shopify_payments");
  check("status", n.status === "paid");
  check("line item qty/price/cost",
    n.items[0].quantity === 2 && approx(n.items[0].unit_price, 24) && approx(n.items[0].unit_cost, 4.6));
  check("line_subtotal", approx(n.items[0].line_subtotal, 48));
  check("line_cost", approx(n.items[0].line_cost, 9.2));
  check("store_id attached", order.store_id === "demo-aurora-oak");

  const m = normalizeShopifyOrder(minimalPayload as Parameters<typeof normalizeShopifyOrder>[0]);
  minimalOrder = toOrder(m, "demo-aurora-oak", "USD");
  check("minimal: shipping falls back to total_shipping", approx(m.shipping_amount, 6.95));
  check("minimal: fee defaults to 0", approx(m.payment_fee, 0));
  check("minimal: total preserved", approx(m.total_amount, 58.43));
}

console.log("\n-- 3. True net profit (net sales - COGS - gateway fees - shipping) ----------");
{
  const p = computeOrderProfit(order);
  check("gross_sales = subtotal + shipping", approx(p.gross_sales, 112.95));
  check("net_sales", approx(p.net_sales, 102.95));
  check("cogs = sum(item cost x qty)", approx(p.cogs, 22.6));
  check("gross_profit", approx(p.gross_profit, 80.35));
  check("payment_fees", approx(p.payment_fees, 3.14));
  check("net_profit = gross - fees - shipping_cost", approx(p.net_profit, 77.21));

  const pm = computeOrderProfit(minimalOrder);
  check("minimal net_profit", approx(pm.net_profit, 45.75));
}

console.log("\n-- 4. Double-entry sale journal entry --------------------------------------");
{
  const entry = createSaleEntry(order, 1);
  validateEntry(entry); // throws if unbalanced
  const d = lineTotal(entry, "debit");
  const c = lineTotal(entry, "credit");
  check("8 lines posted", entry.lines.length === 8);
  check("balanced (debits === credits)", approx(d, c) && approx(d, 142.51));
  const byCode = new Map(entry.lines.map((l) => [l.account_code, l]));
  check("Dr Cash = total - gateway fee", approx(byCode.get("1000")!.debit, 106.77));
  check("Dr Payment Fees = fee", approx(byCode.get("5200")!.debit, 3.14));
  check("Dr Discounts = discounts", approx(byCode.get("4400")!.debit, 10));
  check("Cr Sales = subtotal", approx(byCode.get("4000")!.credit, 106));
  check("Cr Shipping = charged shipping", approx(byCode.get("4100")!.credit, 6.95));
  check("Cr Tax Payable = tax", approx(byCode.get("2100")!.credit, 6.96));
  check("Dr COGS = full cogs", approx(byCode.get("5000")!.debit, 22.6));
  check("Cr Inventory = full cogs", approx(byCode.get("1200")!.credit, 22.6));
  check("entry_date is a plain date", /^\d{4}-\d{2}-\d{2}$/.test(entry.entry_date));

  // regression: README-style payload (no shipping_lines) must also balance
  const entryMinimal = createSaleEntry(minimalOrder, 2);
  validateEntry(entryMinimal);
  check("minimal payload entry balances",
    approx(lineTotal(entryMinimal, "debit"), lineTotal(entryMinimal, "credit")));
  check("minimal shipping credited",
    approx(entryMinimal.lines.find((l) => l.account_code === "4100")!.credit, 6.95));
}

console.log("\n-- 5. Refund entry + guards ------------------------------------------------");
{
  const refund = createRefundEntry(order, order.total_amount, 2);
  validateEntry(refund);
  const byCode = new Map(refund.lines.map((l) => [l.account_code, l]));
  check("refund: Dr Refunds Given", approx(byCode.get("4500")!.debit, 109.91));
  check("refund: Cr Cash", approx(byCode.get("1000")!.credit, 109.91));
  check("refund: Dr Inventory (cogs back)", approx(byCode.get("1200")!.debit, 22.6));
  check("refund: Cr COGS", approx(byCode.get("5000")!.credit, 22.6));

  let threw = false;
  try {
    validateEntry({
      store_id: "s", entry_number: 99, entry_date: "2026-01-01",
      description: "x", reference: "r", source: "manual", status: "posted",
      lines: [line("1000", "cash", 10), line("4000", "sales", 0, 9)],
    });
  } catch {
    threw = true;
  }
  check("validateEntry rejects unbalanced entries", threw);

  let unknownThrew = false;
  try {
    line("9999", "nope", 1, 0);
  } catch {
    unknownThrew = true;
  }
  check("line() rejects unknown account codes", unknownThrew);
}

console.log(`\n${failed === 0 ? "PASS" : "FAIL"}: ${passed} passed, ${failed} failed`
  + `${failures.length ? "\n  " + failures.join("\n  ") : ""}\n`);
process.exit(failed === 0 ? 0 : 1);
