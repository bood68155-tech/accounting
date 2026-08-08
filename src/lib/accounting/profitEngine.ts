import type { MonthPoint, Order, ProfitBreakdown, StoreStats } from "@/types";
import { round2 } from "@/lib/utils";

/**
 * ── True Net Profit Engine ────────────────────────────────────────────────────
 * Gross revenue is NOT profit. The engine deducts everything that actually
 * leaves the owner's pocket:
 *
 *   net sales      = subtotal + shipping − discounts − refunds
 *   gross profit   = net sales − COGS (Σ item cost × qty)
 *   true net profit = gross profit − gateway fees − shipping cost − other fees
 */

export function computeOrderProfit(order: Order): ProfitBreakdown {
  const grossSales = round2(order.subtotal + order.shipping_amount);
  const discounts = round2(order.discount_amount);
  const refunds = round2(order.refund_amount);

  const refundedShare = order.total_amount > 0 ? Math.min(1, refunds / order.total_amount) : 0;
  const cogs = round2(order.items.reduce((sum, item) => sum + item.line_cost, 0));
  const cogsAfterRefunds = round2(cogs * (1 - refundedShare));

  const netSales = round2(grossSales - discounts - refunds);
  const grossProfit = round2(netSales - cogsAfterRefunds);
  const netProfit = round2(grossProfit - order.payment_fee - order.shipping_cost);

  return {
    gross_sales: grossSales,
    discounts,
    refunds,
    net_sales: netSales,
    cogs: cogsAfterRefunds,
    gross_profit: grossProfit,
    gross_margin: grossSales > 0 ? grossProfit / grossSales : 0,
    payment_fees: round2(order.payment_fee),
    shipping_cost: round2(order.shipping_cost),
    other_fees: 0,
    net_profit: netProfit,
    net_margin: grossSales > 0 ? netProfit / grossSales : 0,
  };
}

/** Aggregate profit across a set of orders = Σ of per-order profits. */
export function computeAggregateProfit(orders: Order[]): ProfitBreakdown {
  if (orders.length === 0) {
    return {
      gross_sales: 0,
      discounts: 0,
      refunds: 0,
      net_sales: 0,
      cogs: 0,
      gross_profit: 0,
      gross_margin: 0,
      payment_fees: 0,
      shipping_cost: 0,
      other_fees: 0,
      net_profit: 0,
      net_margin: 0,
    };
  }

  const parts = orders.map(computeOrderProfit);
  const sum = (key: keyof ProfitBreakdown) => round2(parts.reduce((s, p) => s + p[key], 0));

  const grossSales = sum("gross_sales");
  const grossProfit = sum("gross_profit");
  const netProfit = sum("net_profit");

  return {
    gross_sales: grossSales,
    discounts: sum("discounts"),
    refunds: sum("refunds"),
    net_sales: sum("net_sales"),
    cogs: sum("cogs"),
    gross_profit: grossProfit,
    gross_margin: grossSales > 0 ? grossProfit / grossSales : 0,
    payment_fees: sum("payment_fees"),
    shipping_cost: sum("shipping_cost"),
    other_fees: 0,
    net_profit: netProfit,
    net_margin: grossSales > 0 ? netProfit / grossSales : 0,
  };
}

/** KPI stats for a store over an optional trailing period (in days). */
export function computeStats(
  storeId: string,
  orders: Order[],
  periodDays = 30,
): StoreStats {
  const now = Date.now();
  const cutoff = now - periodDays * 86_400_000;
  const periodOrders = orders.filter((o) => new Date(o.ordered_at).getTime() >= cutoff);

  const periodProfit = computeAggregateProfit(periodOrders);
  const allProfit = computeAggregateProfit(orders);

  const periodRevenue = round2(
    periodOrders.reduce((s, o) => s + o.total_amount - o.refund_amount, 0),
  );
  const totalRevenue = round2(orders.reduce((s, o) => s + o.total_amount - o.refund_amount, 0));

  return {
    store_id: storeId,
    period_revenue: periodRevenue,
    period_net_profit: periodProfit.net_profit,
    period_orders: periodOrders.length,
    period_cogs: periodProfit.cogs,
    period_payment_fees: periodProfit.payment_fees,
    period_shipping_cost: periodProfit.shipping_cost,
    net_margin: periodRevenue > 0 ? periodProfit.net_profit / periodRevenue : 0,
    aov: periodOrders.length > 0 ? periodRevenue / periodOrders.length : 0,
    total_orders: orders.length,
    total_revenue: totalRevenue,
    total_net_profit: allProfit.net_profit,
  };
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Monthly revenue / profit / cogs / fees series for charts. */
export function computeMonthlySeries(orders: Order[], months = 6): MonthPoint[] {
  const buckets = new Map<string, Order[]>();

  for (const order of orders) {
    const date = new Date(order.ordered_at);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, [...(buckets.get(key) ?? []), order]);
  }

  // Most recent `months` buckets, oldest first.
  const sortedKeys = Array.from(buckets.keys()).sort().slice(-months);
  return sortedKeys.map((key) => {
    const ordersInBucket = buckets.get(key) ?? [];
    const profit = computeAggregateProfit(ordersInBucket);
    const [, month] = key.split("-").map(Number);
    return {
      key,
      label: MONTH_LABELS[(month ?? 1) - 1],
      revenue: round2(ordersInBucket.reduce((s, o) => s + o.total_amount, 0)),
      net_profit: profit.net_profit,
      cogs: profit.cogs,
      fees: profit.payment_fees,
    };
  });
}
