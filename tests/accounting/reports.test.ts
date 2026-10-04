import { describe, expect, it } from "vitest";
import {
  buildIncomeStatementFromEntries,
  buildIncomeStatementFromOrders,
  incomeStatementRows,
} from "@/lib/accounting/incomeStatement";
import { buildBalanceSheet, retainedEarnings } from "@/lib/accounting/balanceSheet";
import { buildTrialBalance } from "@/lib/accounting/trialBalance";
import {
  aggregateAccountBalances,
  buildReversalEntry,
  createCreditSaleEntry,
  createFeeEntry,
  createPaymentCollectionEntry,
  createRefundEntry,
  createSaleEntry,
} from "@/lib/accounting/doubleEntry";
import { computeAggregateProfit, computeOrderProfit } from "@/lib/accounting/profitEngine";
import { makeItem, makeOrder, STORE_ID } from "./fixtures";

/**
 * Financial-statement reconciliation suite.
 *
 * The product's core promise is that the dashboard, the P&L, the balance sheet
 * and the ledger all report the SAME number. These tests prove the three
 * independently-built reports reconcile against each other and against the
 * orders that generated them.
 *
 * The orders-derived P&L and the GL-derived P&L round independently, so
 * assertions allow a cent of drift.
 */

/**
 * A book whose journal entries correspond 1:1 to the orders — two paid sales
 * with a partial refund, one credit sale later settled. No manual entries, so
 * the orders-derived and entries-derived statements MUST agree.
 */
function buildBook() {
  const orderA = makeOrder({
    external_id: "ext-A",
    order_number: "#A",
    tax_amount: 6,
    discount_amount: 10,
    refund_amount: 15,
  });
  const orderB = makeOrder({
    external_id: "ext-B",
    order_number: "#B",
    ordered_at: "2026-02-10T12:00:00.000Z",
    items: [makeItem({ sku: "SKU-2", name: "Gadget", quantity: 3, unit_price: 40, unit_cost: 15 })],
  });
  const orderC = makeOrder({
    external_id: "ext-C",
    order_number: "#C",
    ordered_at: "2026-02-20T12:00:00.000Z",
    status: "pending",
    shipping_amount: 5,
  });

  return {
    orders: [orderA, orderB, orderC],
    entries: [
      createSaleEntry(orderA, 1),
      createSaleEntry(orderB, 2),
      createRefundEntry(orderA, orderA.refund_amount, 3),
      createCreditSaleEntry(orderC, 4),
      createPaymentCollectionEntry(orderC, 5, "pay_C"),
    ],
  };
}

describe("income statement", () => {
  it("produces the same net profit from orders and from the journal entries", () => {
    const { orders, entries } = buildBook();
    const fromOrders = buildIncomeStatementFromOrders(orders);
    const fromEntries = buildIncomeStatementFromEntries(entries);
    // The core invariant: the GL ties to true net profit, including the
    // fulfilment cost the store actually pays.
    expect(fromEntries.net_profit).toBeCloseTo(fromOrders.net_profit, 2);
    expect(fromEntries.revenue.net_revenue).toBeCloseTo(fromOrders.revenue.net_revenue, 2);
    expect(fromEntries.cogs).toBeCloseTo(fromOrders.cogs, 2);
    expect(fromEntries.operating_expenses.shipping_cost).toBeCloseTo(
      orders.reduce((s, o) => s + o.shipping_cost, 0),
      2,
    );
  });

  it("derives revenue net of discounts and refunds", () => {
    const { orders } = buildBook();
    const pl = buildIncomeStatementFromOrders(orders);
    expect(pl.revenue.net_revenue).toBeCloseTo(
      pl.revenue.sales + pl.revenue.shipping - pl.revenue.discounts - pl.revenue.refunds,
      2,
    );
    expect(pl.gross_profit).toBeCloseTo(pl.revenue.net_revenue - pl.cogs, 2);
    expect(pl.net_profit).toBeCloseTo(pl.gross_profit - pl.operating_expenses.total, 2);
  });

  it("books manual expenses in the GL that the orders know nothing about", () => {
    const { orders, entries } = buildBook();
    const withFees = [
      ...entries,
      createFeeEntry(STORE_ID, 6, "2026-02-01", "Payout fee", "po_1", 9, "5200"),
      createFeeEntry(STORE_ID, 7, "2026-02-05", "Ad spend", "ad_1", 120, "5300"),
    ];

    const base = buildIncomeStatementFromEntries(entries);
    const withManual = buildIncomeStatementFromEntries(withFees);
    const fromOrders = buildIncomeStatementFromOrders(orders);

    // The GL statement drops by exactly the manual spend; the orders-derived one
    // is unchanged because it cannot see non-order expenses.
    expect(base.net_profit - withManual.net_profit).toBeCloseTo(129, 1);
    expect(withManual.operating_expenses.marketing).toBe(120);
    expect(fromOrders.operating_expenses.marketing).toBe(0);
    expect(fromOrders.net_profit).toBeCloseTo(base.net_profit, 2);
  });

  it("keeps margins finite and zero-safe when there is no revenue", () => {
    const empty = buildIncomeStatementFromOrders([]);
    expect(empty.net_margin).toBe(0);
    expect(empty.gross_margin).toBe(0);
    expect(Number.isFinite(empty.net_margin)).toBe(true);
  });

  it("filters both orders and entries to the requested period", () => {
    const { orders, entries } = buildBook();
    const february = buildIncomeStatementFromOrders(orders, "2026-02-01", "2026-02-28");
    const all = buildIncomeStatementFromOrders(orders);
    expect(february.revenue.net_revenue).toBeLessThan(all.revenue.net_revenue);

    const january = buildIncomeStatementFromEntries(entries, "2026-01-01", "2026-01-31");
    expect(january.revenue.sales).toBeGreaterThan(0);
  });

  it("renders contra-revenue and expenses as negative rows that sum to net profit", () => {
    const { entries } = buildBook();
    const rows = incomeStatementRows(buildIncomeStatementFromEntries(entries));
    const netRow = rows.find((r) => r.key === "net-profit")!;
    const summed = rows
      .filter((r) => r.kind !== "total" && r.kind !== "subtotal")
      .reduce((s, r) => s + r.value, 0);
    expect(netRow.value).toBeCloseTo(summed, 2);
    expect(rows.find((r) => r.key === "discounts")!.value).toBeLessThan(0);
  });
});

describe("balance sheet", () => {
  it("satisfies Assets = Liabilities + Equity for a full book of activity", () => {
    const { entries } = buildBook();
    const sheet = buildBalanceSheet(entries);
    expect(sheet.balances).toBe(true);
    expect(sheet.assets.total_assets).toBeCloseTo(sheet.total_liabilities_and_equity, 2);
  });

  it("closes equity with cumulative net profit as retained earnings", () => {
    const { entries } = buildBook();
    const sheet = buildBalanceSheet(entries);
    expect(sheet.equity.retained_earnings).toBeCloseTo(retainedEarnings(entries), 2);
    expect(sheet.equity.total_equity).toBeCloseTo(
      sheet.equity.owners_equity + sheet.equity.retained_earnings,
      2,
    );
  });

  it("reconciles retained earnings against the order-derived net profit", () => {
    const { orders, entries } = buildBook();
    // Every entry corresponds to an order, so cumulative profit in the books
    // must equal the profit computed straight from the orders.
    const orderProfit = computeAggregateProfit(orders).net_profit;
    expect(retainedEarnings(entries)).toBeCloseTo(orderProfit, 2);
  });

  it("excludes entries dated after the as-of date", () => {
    const { entries } = buildBook();
    const january = buildBalanceSheet(entries, "2026-01-31");
    const february = buildBalanceSheet(entries, "2026-02-28");
    expect(january.assets.total_assets).toBeLessThan(february.assets.total_assets);
    expect(january.balances).toBe(true);
  });

  it("stays balanced when every entry is reversed", () => {
    const { orders } = buildBook();
    const posted = createSaleEntry(orders[0], 1);
    const sheet = buildBalanceSheet([
      posted,
      buildReversalEntry({ ...posted, id: "e1" }, 2, "cancelled"),
    ]);
    expect(sheet.balances).toBe(true);
    expect(sheet.assets.total_assets).toBeCloseTo(0, 2);
    expect(sheet.equity.retained_earnings).toBeCloseTo(0, 2);
  });
});

describe("trial balance", () => {
  it("balances both columns for a full book", () => {
    const { entries } = buildBook();
    const tb = buildTrialBalance(entries);
    expect(tb.balanced).toBe(true);
    expect(tb.total_debit).toBeCloseTo(tb.total_credit, 2);
  });

  it("sums its columns to the ledger's gross debits and credits", () => {
    const { entries } = buildBook();
    const tb = buildTrialBalance(entries);
    const grossDebits = entries.reduce((s, e) => s + e.lines.reduce((x, l) => x + l.debit, 0), 0);
    const grossCredits = entries.reduce((s, e) => s + e.lines.reduce((x, l) => x + l.credit, 0), 0);
    expect(tb.total_debit).toBeCloseTo(grossDebits, 2);
    expect(tb.total_credit).toBeCloseTo(grossCredits, 2);
  });

  it("orders rows by account code and drops zero-movement accounts", () => {
    const { entries } = buildBook();
    const tb = buildTrialBalance(entries);
    const codes = tb.rows.map((r) => r.account_code);
    expect([...codes].sort()).toEqual(codes);
    for (const row of tb.rows) {
      expect(row.debit !== 0 || row.credit !== 0).toBe(true);
    }
  });

  it("agrees with the balance sheet on cash, receivables and inventory", () => {
    const { entries } = buildBook();
    const tb = buildTrialBalance(entries);
    const sheet = buildBalanceSheet(entries);
    const gl = new Map(aggregateAccountBalances(entries).map((b) => [b.account_code, b.balance]));
    const tbBalance = (code: string) => tb.rows.find((r) => r.account_code === code)?.balance ?? 0;

    expect(tbBalance("1000")).toBeCloseTo(gl.get("1000")!, 2);
    expect(tbBalance("1000")).toBeCloseTo(sheet.assets.cash, 2);
    expect(tbBalance("1100")).toBeCloseTo(sheet.assets.accounts_receivable, 2);
    expect(tbBalance("1200")).toBeCloseTo(sheet.assets.inventory, 2);
  });

  it("shows contra-revenue activity on the debit side", () => {
    const entries = [createSaleEntry(makeOrder({ discount_amount: 40 }), 1)];
    const row = buildTrialBalance(entries).rows.find((r) => r.account_code === "4400")!;
    expect(row.debit).toBe(40);
    expect(row.credit).toBe(0);
    // Signed by normal balance: 4400 is revenue-typed but debit-normal.
    expect(row.balance).toBe(40);
  });

  it("honours the as-of cutoff", () => {
    const { entries } = buildBook();
    const january = buildTrialBalance(entries, "2026-01-31");
    const february = buildTrialBalance(entries, "2026-02-28");
    expect(january.total_debit).toBeLessThan(february.total_debit);
    expect(january.balanced).toBe(true);
  });

  it("returns an empty, balanced report for an empty ledger", () => {
    const tb = buildTrialBalance([]);
    expect(tb.rows).toEqual([]);
    expect(tb.total_debit).toBe(0);
    expect(tb.balanced).toBe(true);
  });

  it("nets a fully-reversed book back to zero balances", () => {
    const posted = createSaleEntry(makeOrder(), 1);
    const reversed = [
      posted,
      buildReversalEntry({ ...posted, id: "e1" }, 2, "cancelled"),
    ];
    const tb = buildTrialBalance(reversed);
    expect(tb.balanced).toBe(true);
    // Rows survive on gross activity, but every account nets back to zero.
    for (const row of tb.rows) {
      expect(row.balance).toBeCloseTo(0, 5);
    }
    expect(tb.rows.some((r) => r.balance !== 0)).toBe(false);
  });
});

describe("profit engine", () => {
  it("treats gross revenue as not-profit once costs are deducted", () => {
    const order = makeOrder({ discount_amount: 10, payment_fee: 3, shipping_cost: 6 });
    const p = computeOrderProfit(order);
    expect(p.net_profit).toBeCloseTo(
      p.gross_profit - order.payment_fee - order.shipping_cost,
      2,
    );
    expect(p.net_profit).toBeLessThan(order.total_amount);
  });

  it("nets COGS back proportionally when an order is refunded", () => {
    const order = makeOrder();
    const full = computeOrderProfit(order);
    const half = computeOrderProfit({ ...order, refund_amount: order.total_amount / 2 });
    expect(half.cogs).toBeCloseTo(full.cogs * 0.5, 1);
  });

  it("sums per-order profit into the aggregate", () => {
    const orders = [makeOrder(), makeOrder({ external_id: "ext-2", order_number: "#2" })];
    const agg = computeAggregateProfit(orders);
    expect(agg.net_profit).toBeCloseTo(
      orders.reduce((s, o) => s + computeOrderProfit(o).net_profit, 0),
      2,
    );
  });

  it("returns an all-zero breakdown for no orders", () => {
    const agg = computeAggregateProfit([]);
    expect(agg.net_profit).toBe(0);
    expect(agg.net_margin).toBe(0);
  });
});