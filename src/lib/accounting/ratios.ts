import type { BalanceSheet, IncomeStatement } from "@/types";
import { round2 } from "@/lib/utils";

/**
 * ── Financial ratio & health engine ───────────────────────────────────────────
 * Turns the two core statements (P&L + balance sheet) into the standard ratio
 * battery: liquidity, profitability, efficiency and leverage. Patterns follow
 * GnuCash/Firefly III ratio reports and the ERPNext "Financial Analytics"
 * dashboard, extended with the cash-conversion cycle (DIO + DSO − DPO).
 *
 * Every ratio is defensible: when a denominator is zero/negative we return
 * `null` (status "n/a") instead of inventing a number, and each ratio carries
 * its formula + a plain-language benchmark so the value is auditable.
 */

export type RatioStatus = "strong" | "healthy" | "watch" | "risk" | "n/a";

export type RatioGroup = "liquidity" | "profitability" | "efficiency" | "leverage";

export interface Ratio {
  key: string;
  label: string;
  group: RatioGroup;
  /** Raw ratio value, or null when it cannot be computed. */
  value: number | null;
  status: RatioStatus;
  benchmark: string;
  formula: string;
  hint: string;
}

export interface FinancialHealth {
  /** 0–100 composite across every computable ratio. */
  score: number;
  grade: "A" | "B" | "C" | "D";
  ratios: Ratio[];
  working_capital: number;
  /** DIO + DSO − DPO, or null when a leg can't be computed. */
  cash_conversion_cycle_days: number | null;
}

export interface RatioOptions {
  /** Window (days) the income statement covers — drives the efficiency ratios. */
  periodDays?: number;
}

/** Status → sub-score (used for the composite health score). */
const STATUS_SCORE: Record<RatioStatus, number | null> = {
  strong: 100,
  healthy: 80,
  watch: 55,
  risk: 25,
  "n/a": null,
};

/** Ratio display formatting: × for multiples, % for margins, days for cycles. */
export function formatRatio(ratio: Ratio): string {
  if (ratio.value === null) return "—";
  if (ratio.key.endsWith("_days")) return `${round2(ratio.value).toFixed(1)}d`;
  if (ratio.group === "profitability" || ratio.key.includes("margin")) {
    return `${(ratio.value * 100).toFixed(1)}%`;
  }
  return `${ratio.value.toFixed(2)}×`;
}

/** Map an observed value onto a status using descending thresholds. */
function band(value: number, strong: number, healthy: number, watch: number): RatioStatus {
  if (value >= strong) return "strong";
  if (value >= healthy) return "healthy";
  if (value >= watch) return "watch";
  return "risk";
}

/** Lower-is-better band (leverage, days outstanding). */
function bandLower(value: number, strong: number, healthy: number, watch: number): RatioStatus {
  if (value <= strong) return "strong";
  if (value <= healthy) return "healthy";
  if (value <= watch) return "watch";
  return "risk";
}

function safeDiv(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return round2(numerator / denominator);
}

export function computeFinancialRatios(
  balanceSheet: BalanceSheet,
  incomeStatement: IncomeStatement,
  options: RatioOptions = {},
): FinancialHealth {
  const periodDays = options.periodDays && options.periodDays > 0 ? options.periodDays : 30;
  const bs = balanceSheet;
  const pl = incomeStatement;

  const currentAssets = bs.assets.current_assets;
  const currentLiabilities = bs.liabilities.current_liabilities;
  const quickAssets = round2(bs.assets.cash + bs.assets.accounts_receivable);
  const netRevenue = pl.revenue.net_revenue;
  const equity = bs.equity.total_equity;
  const netProfit = pl.net_profit;

  const currentRatio = safeDiv(currentAssets, currentLiabilities);
  const quickRatio = safeDiv(quickAssets, currentLiabilities);
  const grossMargin = netRevenue > 0 ? round2(pl.gross_profit / netRevenue) : null;
  const netMargin = netRevenue > 0 ? round2(netProfit / netRevenue) : null;
  const roe = safeDiv(netProfit, equity);
  const debtToEquity = safeDiv(bs.liabilities.total_liabilities, equity);
  const inventoryTurnover =
    bs.assets.inventory > 0 && pl.cogs > 0
      ? round2((pl.cogs / bs.assets.inventory) * (365 / periodDays))
      : null;
  const dso = netRevenue > 0 ? round2((bs.assets.accounts_receivable / netRevenue) * periodDays) : null;
  const dio = pl.cogs > 0 ? round2((bs.assets.inventory / pl.cogs) * periodDays) : null;
  const dpo = pl.cogs > 0 ? round2((bs.liabilities.accounts_payable / pl.cogs) * periodDays) : null;
  const ccc = dso !== null && dio !== null && dpo !== null ? round2(dio + dso - dpo) : null;

  const ratios: Ratio[] = [
    {
      key: "current_ratio",
      label: "Current ratio",
      group: "liquidity",
      value: currentRatio,
      status: currentRatio === null ? "n/a" : band(currentRatio, 2, 1.2, 1),
      benchmark: "≥ 2.0 strong · ≥ 1.2 healthy · < 1.0 risk",
      formula: "current assets ÷ current liabilities",
      hint: "Can short-term assets cover short-term obligations?",
    },
    {
      key: "quick_ratio",
      label: "Quick ratio",
      group: "liquidity",
      value: quickRatio,
      status: quickRatio === null ? "n/a" : band(quickRatio, 1.5, 1, 0.8),
      benchmark: "≥ 1.5 strong · ≥ 1.0 healthy · < 0.8 risk",
      formula: "(cash + receivables) ÷ current liabilities",
      hint: "Liquidity without relying on selling inventory.",
    },
    {
      key: "working_capital",
      label: "Working capital",
      group: "liquidity",
      value: round2(currentAssets - currentLiabilities),
      status:
        currentLiabilities === 0
          ? "n/a"
          : band(currentAssets - currentLiabilities, 0.001, 0, -0.001),
      benchmark: "positive = healthy",
      formula: "current assets − current liabilities",
      hint: "Cash available to run day-to-day operations.",
    },
    {
      key: "gross_margin",
      label: "Gross margin",
      group: "profitability",
      value: grossMargin,
      status: grossMargin === null ? "n/a" : band(grossMargin, 0.4, 0.25, 0.1),
      benchmark: "≥ 40% strong · ≥ 25% healthy · < 10% risk",
      formula: "gross profit ÷ net revenue",
      hint: "How much of each sale survives COGS.",
    },
    {
      key: "net_margin",
      label: "Net margin",
      group: "profitability",
      value: netMargin,
      status: netMargin === null ? "n/a" : band(netMargin, 0.15, 0.07, 0.02),
      benchmark: "≥ 15% strong · ≥ 7% healthy · < 2% risk",
      formula: "net profit ÷ net revenue",
      hint: "True take-home after COGS, fees and shipping.",
    },
    {
      key: "return_on_equity",
      label: "Return on equity",
      group: "profitability",
      value: roe,
      status: roe === null ? "n/a" : band(roe, 0.2, 0.1, 0),
      benchmark: "≥ 20% strong · ≥ 10% healthy · < 0% risk",
      formula: "net profit ÷ total equity",
      hint: "Profit generated per unit of owner capital.",
    },
    {
      key: "inventory_turnover",
      label: "Inventory turnover",
      group: "efficiency",
      value: inventoryTurnover,
      status: inventoryTurnover === null ? "n/a" : band(inventoryTurnover, 6, 4, 2),
      benchmark: "≥ 6× strong · ≥ 4× healthy · < 2× risk",
      formula: "COGS ÷ inventory (annualized)",
      hint: "How many times inventory sells through per year.",
    },
    {
      key: "dso_days",
      label: "Days sales outstanding",
      group: "efficiency",
      value: dso,
      status: dso === null ? "n/a" : bandLower(dso, 30, 45, 60),
      benchmark: "≤ 30d strong · ≤ 45d healthy · > 60d risk",
      formula: "receivables ÷ net revenue × days",
      hint: "Average days to collect from customers.",
    },
    {
      key: "dio_days",
      label: "Days inventory outstanding",
      group: "efficiency",
      value: dio,
      status: dio === null ? "n/a" : bandLower(dio, 45, 60, 90),
      benchmark: "≤ 45d strong · ≤ 60d healthy · > 90d risk",
      formula: "inventory ÷ COGS × days",
      hint: "Average days inventory sits before selling.",
    },
    {
      key: "dpo_days",
      label: "Days payable outstanding",
      group: "efficiency",
      value: dpo,
      status: dpo === null ? "n/a" : band(dpo, 30, 15, 7),
      benchmark: "≥ 30d strong · ≥ 15d healthy · < 7d risk",
      formula: "payables ÷ COGS × days",
      hint: "Average days taken to pay suppliers.",
    },
    {
      key: "cash_conversion_cycle_days",
      label: "Cash conversion cycle",
      group: "efficiency",
      value: ccc,
      status: ccc === null ? "n/a" : bandLower(ccc, 30, 60, 90),
      benchmark: "≤ 30d strong · ≤ 60d healthy · > 90d risk",
      formula: "DIO + DSO − DPO",
      hint: "Days cash is tied up between paying and being paid.",
    },
    {
      key: "debt_to_equity",
      label: "Debt to equity",
      group: "leverage",
      value: debtToEquity,
      status: debtToEquity === null ? "n/a" : bandLower(debtToEquity, 0.5, 1, 2),
      benchmark: "≤ 0.5× strong · ≤ 1.0× healthy · > 2.0× risk",
      formula: "total liabilities ÷ total equity",
      hint: "How leveraged the business is against owner capital.",
    },
  ];

  // Composite score: average of every computable ratio's sub-score.
  const scores = ratios
    .map((r) => STATUS_SCORE[r.status])
    .filter((s): s is number => s !== null);
  const score = scores.length > 0 ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : 0;
  const grade: FinancialHealth["grade"] =
    score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : "D";

  return {
    score,
    grade,
    ratios,
    working_capital: round2(currentAssets - currentLiabilities),
    cash_conversion_cycle_days: ccc,
  };
}
