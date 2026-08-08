import type { IncomeStatement, JournalEntry, Order } from "@/types";
import { aggregateAccountBalances } from "@/lib/accounting/doubleEntry";
import { computeOrderProfit } from "@/lib/accounting/profitEngine";
import { round2 } from "@/lib/utils";

/**
 * ── Income Statement (P&L) ────────────────────────────────────────────────────
 * Built from the General Ledger (journal entries) or directly from orders.
 * Both paths use the same account mapping, so numbers always reconcile.
 */

function periodBounds(orders: Order[], from?: string, to?: string): { from: string; to: string } {
  if (from && to) return { from, to };
  const dates = orders.map((o) => o.ordered_at).sort();
  return {
    from: from ?? dates[0] ?? new Date().toISOString(),
    to: to ?? dates[dates.length - 1] ?? new Date().toISOString(),
  };
}

/** Build the statement from raw orders (used by the UI + demo mode). */
export function buildIncomeStatementFromOrders(
  orders: Order[],
  from?: string,
  to?: string,
): IncomeStatement {
  const inPeriod = from && to
    ? orders.filter((o) => o.ordered_at >= from && o.ordered_at <= to)
    : orders;

  const revenue = {
    sales: round2(inPeriod.reduce((s, o) => s + o.subtotal, 0)),
    shipping: round2(inPeriod.reduce((s, o) => s + o.shipping_amount, 0)),
    discounts: round2(inPeriod.reduce((s, o) => s + o.discount_amount, 0)),
    refunds: round2(inPeriod.reduce((s, o) => s + o.refund_amount, 0)),
    net_revenue: 0,
  };
  revenue.net_revenue = round2(revenue.sales + revenue.shipping - revenue.discounts - revenue.refunds);

  const cogs = round2(inPeriod.reduce((s, o) => s + computeOrderProfit(o).cogs, 0));
  const grossProfit = round2(revenue.net_revenue - cogs);

  const operating_expenses = {
    payment_fees: round2(inPeriod.reduce((s, o) => s + o.payment_fee, 0)),
    shipping_cost: round2(inPeriod.reduce((s, o) => s + o.shipping_cost, 0)),
    marketing: 0,
    software: 0,
    other: 0,
    total: 0,
  };
  operating_expenses.total = round2(
    operating_expenses.payment_fees + operating_expenses.shipping_cost,
  );

  const netProfit = round2(grossProfit - operating_expenses.total);

  return {
    period: periodBounds(inPeriod, from, to),
    revenue,
    cogs,
    gross_profit: grossProfit,
    gross_margin: revenue.net_revenue > 0 ? grossProfit / revenue.net_revenue : 0,
    operating_expenses,
    net_profit: netProfit,
    net_margin: revenue.net_revenue > 0 ? netProfit / revenue.net_revenue : 0,
  };
}

/** Balance of an account code from GL entries (positive = normal direction). */
function accountNet(entries: JournalEntry[], code: string): number {
  const balances = aggregateAccountBalances(entries).find((b) => b.account_code === code);
  return balances?.balance ?? 0;
}

/** Build the statement from journal entries (the source of truth). */
export function buildIncomeStatementFromEntries(
  entries: JournalEntry[],
  from?: string,
  to?: string,
): IncomeStatement {
  const inPeriod = from && to
    ? entries.filter((e) => e.entry_date >= from && e.entry_date <= to)
    : entries;

  const sales = accountNet(inPeriod, "4000");
  const shipping = accountNet(inPeriod, "4100");
  const discounts = accountNet(inPeriod, "4400");
  const refunds = accountNet(inPeriod, "4500");
  const cogs = accountNet(inPeriod, "5000");

  const revenue = {
    sales,
    shipping,
    discounts,
    refunds,
    net_revenue: round2(sales + shipping - discounts - refunds),
  };

  const grossProfit = round2(revenue.net_revenue - cogs);
  const operating_expenses = {
    payment_fees: accountNet(inPeriod, "5200"),
    shipping_cost: accountNet(inPeriod, "5100"),
    marketing: accountNet(inPeriod, "5300"),
    software: accountNet(inPeriod, "5400"),
    other: accountNet(inPeriod, "5900"),
    total: 0,
  };
  operating_expenses.total = round2(
    operating_expenses.payment_fees +
      operating_expenses.shipping_cost +
      operating_expenses.marketing +
      operating_expenses.software +
      operating_expenses.other,
  );

  const netProfit = round2(grossProfit - operating_expenses.total);

  return {
    period: {
      from: from ?? inPeriod[0]?.entry_date ?? new Date().toISOString(),
      to: to ?? inPeriod[inPeriod.length - 1]?.entry_date ?? new Date().toISOString(),
    },
    revenue,
    cogs,
    gross_profit: grossProfit,
    gross_margin: revenue.net_revenue > 0 ? grossProfit / revenue.net_revenue : 0,
    operating_expenses,
    net_profit: netProfit,
    net_margin: revenue.net_revenue > 0 ? netProfit / revenue.net_revenue : 0,
  };
}

/** Format the statement as ordered report rows for rendering. */
export function incomeStatementRows(statement: IncomeStatement) {
  const rows: Array<{
    key: string;
    label: string;
    value: number;
    kind: "revenue" | "contra" | "expense" | "subtotal" | "total";
    indent?: boolean;
  }> = [
    { key: "sales", label: "Sales Revenue", value: statement.revenue.sales, kind: "revenue" },
    { key: "shipping", label: "Shipping Revenue", value: statement.revenue.shipping, kind: "revenue" },
    { key: "discounts", label: "Discounts Given", value: -statement.revenue.discounts, kind: "contra" },
    { key: "refunds", label: "Refunds Given", value: -statement.revenue.refunds, kind: "contra" },
    {
      key: "net-revenue",
      label: "Net Revenue",
      value: statement.revenue.net_revenue,
      kind: "subtotal",
    },
    { key: "cogs", label: "Cost of Goods Sold", value: -statement.cogs, kind: "expense" },
    {
      key: "gross-profit",
      label: "Gross Profit",
      value: statement.gross_profit,
      kind: "subtotal",
    },
    {
      key: "fees",
      label: "Payment Processing Fees",
      value: -statement.operating_expenses.payment_fees,
      kind: "expense",
    },
    {
      key: "shipping-expense",
      label: "Shipping Expense",
      value: -statement.operating_expenses.shipping_cost,
      kind: "expense",
    },
    {
      key: "marketing",
      label: "Marketing & Advertising",
      value: -statement.operating_expenses.marketing,
      kind: "expense",
    },
    {
      key: "software",
      label: "Software & Subscriptions",
      value: -statement.operating_expenses.software,
      kind: "expense",
    },
    {
      key: "other",
      label: "Miscellaneous Expenses",
      value: -statement.operating_expenses.other,
      kind: "expense",
    },
    {
      key: "net-profit",
      label: "Net Profit (True Profit)",
      value: statement.net_profit,
      kind: "total",
    },
  ];
  return rows;
}
