import type { BalanceSheet, IncomeStatement, JournalEntry, Order, StoreStats } from "@/types";
import type { Anomaly, CashFlowForecast } from "@/lib/ai/categorizer";
import type { FinancialHealth } from "@/lib/accounting/ratios";
import type { CashFlowStatement } from "@/lib/accounting/cashFlow";

/**
 * ── AI financial insights (natural-language generation over the ledger) ──────
 * Every insight is derived deterministically from real financial data — the
 * numbers always reconcile with the dashboard because they ARE the dashboard's
 * numbers. An optional LLM (OPENAI_API_KEY) rephrases/extends these grounded
 * bullets into prose; without a key the deterministic text is served as-is, so
 * the feature never breaks and never hallucinates numbers.
 */

export interface Insight {
  tone: "positive" | "neutral" | "warning";
  title: string;
  body: string;
}

export interface FinancialSnapshot {
  stats: StoreStats;
  incomeStatement: IncomeStatement;
  balanceSheet: BalanceSheet;
  monthly: Array<{ label: string; key: string; revenue: number; net_profit: number; cogs: number; fees: number }>;
  orders: Order[];
  journalEntries: JournalEntry[];
  forecast: CashFlowForecast;
  anomalies: Anomaly[];
  storeName: string;
  currency: string;
  /** Optional ratio battery — when present, liquidity/efficiency insights are added. */
  ratios?: FinancialHealth;
  /** Optional direct-method cash flow statement — adds a cash-movement insight. */
  cashFlow?: CashFlowStatement;
}

/** Top products by revenue across all orders (for product-mix insights). */
function topProducts(orders: Order[], limit = 3): Array<{ name: string; revenue: number }> {
  const byProduct = new Map<string, number>();
  for (const order of orders) {
    for (const item of order.items) {
      byProduct.set(item.name, (byProduct.get(item.name) ?? 0) + item.line_subtotal);
    }
  }
  return [...byProduct.entries()]
    .map(([name, revenue]) => ({ name, revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

export function generateInsights(snapshot: FinancialSnapshot): Insight[] {
  const insights: Insight[] = [];
  const { stats, incomeStatement: pl, balanceSheet: bs, monthly, orders, forecast, anomalies } = snapshot;
  const cur = snapshot.currency;

  // ── Profitability ───────────────────────────────────────────────────────────
  if (stats.period_revenue > 0) {
    const marginTone = stats.net_margin >= 0.15 ? "positive" : stats.net_margin >= 0.05 ? "neutral" : "warning";
    insights.push({
      tone: marginTone,
      title: `Net margin is ${(stats.net_margin * 100).toFixed(1)}%`,
      body:
        marginTone === "positive"
          ? `You keep ${(stats.net_margin * 100).toFixed(0)} cents of every ${cur === "SAR" ? "riyal" : "dollar"} after COGS, fees and shipping. That's a healthy e-commerce margin — protect it by watching ad spend.`
          : marginTone === "neutral"
            ? `Margins are workable but thin. The fastest levers: negotiate item costs (COGS is ${((pl.cogs / Math.max(pl.revenue.net_revenue, 1)) * 100).toFixed(0)}% of net revenue) and cut gateway fees.`
            : `Margins are under pressure — COGS plus fees consume most of revenue. Re-price loss-making products and audit shipping cost before scaling ad spend.`,
    });
  }

  // ── Trend ───────────────────────────────────────────────────────────────────
  if (monthly.length >= 2) {
    const last = monthly[monthly.length - 1];
    const prev = monthly[monthly.length - 2];
    const delta = prev.revenue > 0 ? (last.revenue - prev.revenue) / prev.revenue : 0;
    insights.push({
      tone: delta >= 0 ? "positive" : "warning",
      title: `Revenue ${delta >= 0 ? "grew" : "declined"} ${Math.abs(delta * 100).toFixed(0)}% month-over-month`,
      body: `${last.label} revenue ${last.revenue >= prev.revenue ? "rose" : "fell"} to ${last.revenue.toFixed(0)} from ${prev.revenue.toFixed(0)}, with net profit at ${last.net_profit.toFixed(0)}. ${delta >= 0 ? "Reinvest in what's working." : "Check whether the drop is traffic, conversion, or refunds."}`,
    });
  }

  // ── Cash position & liquidity ───────────────────────────────────────────────
  if (bs.assets.total_assets > 0) {
    const cashShare = bs.assets.cash / bs.assets.total_assets;
    insights.push({
      tone: cashShare >= 0.2 ? "positive" : "neutral",
      title: `Cash is ${(cashShare * 100).toFixed(0)}% of assets`,
      body: `Balance sheet: ${bs.assets.cash.toFixed(0)} cash, ${bs.assets.accounts_receivable.toFixed(0)} receivables, ${bs.assets.inventory.toFixed(0)} in inventory. Liabilities stand at ${bs.liabilities.total_liabilities.toFixed(0)} — ${bs.liabilities.accounts_payable.toFixed(0)} of it supplier payables.`,
    });
  }

  // ── Receivables risk ────────────────────────────────────────────────────────
  if (bs.assets.accounts_receivable > 0 && stats.total_revenue > 0) {
    const arShare = bs.assets.accounts_receivable / Math.max(bs.assets.total_assets, 1);
    if (arShare > 0.3) {
      insights.push({
        tone: "warning",
        title: "Receivables are piling up",
        body: `${bs.assets.accounts_receivable.toFixed(0)} sits in unpaid orders — that's cash you've earned but can't spend. Follow up on pending payments or tighten prepayment terms.`,
      });
    }
  }

  // ── Forecast ────────────────────────────────────────────────────────────────
  if (forecast.projection.length > 0) {
    const next = forecast.projection[0];
    insights.push({
      tone: forecast.horizonNet >= 0 ? "positive" : "warning",
      title: `Cash-flow forecast: ${forecast.horizonNet >= 0 ? "+" : ""}${forecast.horizonNet.toFixed(0)} over 4 weeks`,
      body: `Next week projects ${next.net >= 0 ? "+" : ""}${next.net.toFixed(0)} (range ${next.low.toFixed(0)} to ${next.high.toFixed(0)}). Model: ${forecast.method}.`,
    });
  }

  // ── Product mix ─────────────────────────────────────────────────────────────
  const top = topProducts(orders);
  if (top.length > 0) {
    const totalRev = top.reduce((s, p) => s + p.revenue, 0);
    insights.push({
      tone: "neutral",
      title: `Top seller drives ${((top[0].revenue / Math.max(totalRev, 1)) * 100).toFixed(0)}% of tracked revenue`,
      body: `“${top[0].name}” leads at ${top[0].revenue.toFixed(0)}, followed by ${top.slice(1).map((p) => `${p.name} (${p.revenue.toFixed(0)})`).join(", ") || "no other tracked products"}. Bundle or discount around the leader to lift AOV.`,
    });
  }

  // ── Anomalies surfaced as insights ──────────────────────────────────────────
  for (const anomaly of anomalies.slice(0, 2)) {
    insights.push({
      tone: anomaly.severity === "high" ? "warning" : "neutral",
      title: anomaly.title,
      body: anomaly.detail,
    });
  }

  // ── Financial-health ratios (liquidity & efficiency) ────────────────────────
  if (snapshot.ratios) {
    const r = snapshot.ratios;
    const liquidity = r.ratios.find((x) => x.key === "current_ratio");
    const ccc = r.ratios.find((x) => x.key === "cash_conversion_cycle_days");
    const parts: string[] = [];
    if (liquidity?.value != null) {
      parts.push(`current ratio ${liquidity.value.toFixed(2)}× (${liquidity.status})`);
    }
    if (ccc?.value != null) {
      parts.push(`cash conversion cycle ${ccc.value.toFixed(0)} days (${ccc.status})`);
    }
    insights.push({
      tone: r.score >= 70 ? "positive" : r.score >= 50 ? "neutral" : "warning",
      title: `Financial health score ${r.score}/100 (grade ${r.grade})`,
      body:
        parts.length > 0
          ? `${parts.join(", ")}. ${
              r.working_capital >= 0
                ? `Working capital is positive at ${r.working_capital.toFixed(0)} ${cur}.`
                : `Working capital is negative (${r.working_capital.toFixed(0)} ${cur}) — tighten collections and supplier terms.`
            }`
          : "Not enough ledger data yet to score liquidity and efficiency ratios.",
    });
  }

  // ── Statement of cash flows ─────────────────────────────────────────────────
  if (snapshot.cashFlow && snapshot.cashFlow.operating.lines.length > 0) {
    const cf = snapshot.cashFlow;
    insights.push({
      tone: cf.net_change >= 0 ? "positive" : "warning",
      title: `Net cash ${cf.net_change >= 0 ? "increased" : "decreased"} ${Math.abs(cf.net_change).toFixed(0)} ${cur} in the period`,
      body: `Operating activities contributed ${cf.operating.net.toFixed(0)} ${cur}; financing ${cf.financing.net.toFixed(0)} ${cur}. Cash moved from ${cf.opening_cash.toFixed(0)} to ${cf.closing_cash.toFixed(0)}${cf.reconciles ? " (reconciled ✓)" : ""}.`,
    });
  }

  return insights;
}
