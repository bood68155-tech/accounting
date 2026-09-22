import type { JournalEntry, Order } from "@/types";
import { round2 } from "@/lib/utils";

/**
 * ── AI transaction categorization & ledger mapping ───────────────────────────
 * Inspired by the intelligent-mapping patterns in ERPNext's Chart of Accounts
 * auto-tooling and Akaunting's category model: transactions are classified into
 * account codes by an ordered rule cascade (vendor/gateway hints → amount
 * heuristics → source), with confidence scores. Decisions are auditable — every
 * categorization explains itself via `reason`.
 */

export interface CategorizedTransaction {
  /** Suggested ledger account code. */
  accountCode: string;
  accountName: string;
  /** 0..1 — rule cascade produces calibrated confidences. */
  confidence: number;
  /** Why this mapping was chosen (auditable, shown in the UI). */
  reason: string;
  category:
    | "revenue"
    | "cogs"
    | "gateway-fee"
    | "shipping"
    | "marketing"
    | "software"
    | "tax"
    | "refund"
    | "other";
}

interface Rule {
  category: CategorizedTransaction["category"];
  accountCode: string;
  confidence: number;
  match: (text: string, amount: number, source: string) => boolean;
  reason: string;
}

/** Keyword → account rules, ordered by specificity (first hit wins). */
const RULES: Rule[] = [
  {
    category: "gateway-fee",
    accountCode: "5200",
    confidence: 0.95,
    match: (text) =>
      /\b(stripe|paypal|shopify payments|gateway|processing fee|payment fee|mada|hyperpay|tap)\b/.test(text),
    reason: "Payment gateway keyword matched — maps to Payment Processing Fees.",
  },
  {
    category: "marketing",
    accountCode: "5300",
    confidence: 0.9,
    match: (text) =>
      /\b(meta ads|facebook|instagram|tiktok|google ads|ads|ad spend|marketing|campaign|influencer|promo)\b/.test(text),
    reason: "Marketing keyword matched — maps to Marketing & Advertising.",
  },
  {
    category: "software",
    accountCode: "5400",
    confidence: 0.9,
    match: (text) =>
      /\b(shopify plan|subscription|saas|software|app store|zoom|notion|figma|openai|anthropic)\b/.test(text),
    reason: "Software/subscription keyword matched — maps to Software & Subscriptions.",
  },
  {
    category: "shipping",
    accountCode: "5100",
    confidence: 0.85,
    match: (text) => /\b(shipping|freight|courier|dhl|aramex|smsa|fulfillment|postage)\b/.test(text),
    reason: "Shipping keyword matched — maps to Shipping Expense.",
  },
  {
    category: "refund",
    accountCode: "4500",
    confidence: 0.9,
    match: (text, _amount, source) => /\b(refund|return|chargeback)\b/.test(text) || source === "refund",
    reason: "Refund keyword or refund source — maps to Refunds Given.",
  },
  {
    category: "cogs",
    accountCode: "5000",
    confidence: 0.8,
    match: (text) => /\b(cogs|cost of goods|inventory purchase|supplier|restock|wholesale)\b/.test(text),
    reason: "Inventory/supplier keyword matched — maps to Cost of Goods Sold.",
  },
];

/**
 * Categorize a free-text transaction description into a ledger account.
 * Deterministic rule cascade — same input always yields the same mapping, so
 * results are reproducible and auditable.
 */
export function categorizeTransaction(
  description: string,
  amount: number,
  source: JournalEntry["source"] = "manual",
): CategorizedTransaction {
  const text = `${description} ${source}`.toLowerCase();

  for (const rule of RULES) {
    if (rule.match(text, amount, source)) {
      return {
        accountCode: rule.accountCode,
        accountName: accountNameFor(rule.accountCode),
        confidence: rule.confidence,
        reason: rule.reason,
        category: rule.category,
      };
    }
  }

  // Heuristics for unlabeled flows.
  if (source === "order") {
    return {
      accountCode: "4000",
      accountName: accountNameFor("4000"),
      confidence: 0.9,
      reason: "Order source — maps to Sales Revenue.",
      category: "revenue",
    };
  }
  if (amount < 0) {
    return {
      accountCode: "5900",
      accountName: accountNameFor("5900"),
      confidence: 0.4,
      reason: "Negative amount with no keyword — routed to Miscellaneous Expenses (review recommended).",
      category: "other",
    };
  }

  return {
    accountCode: "4200",
    accountName: accountNameFor("4200"),
    confidence: 0.4,
    reason: "No matching pattern — routed to Other Revenue (review recommended).",
    category: "other",
  };
}

function accountNameFor(code: string): string {
  const names: Record<string, string> = {
    "4000": "Sales Revenue",
    "4200": "Other Revenue",
    "4400": "Discounts Given",
    "4500": "Refunds Given",
    "5000": "Cost of Goods Sold",
    "5100": "Shipping Expense",
    "5200": "Payment Processing Fees",
    "5300": "Marketing & Advertising",
    "5400": "Software & Subscriptions",
    "5900": "Miscellaneous Expenses",
  };
  return names[code] ?? "Unknown Account";
}

/**
 * Bulk categorize a batch (e.g. uncategorized fee entries), returning only
 * low-confidence items for human review — the AI proposes, the accountant
 * approves.
 */
export function suggestCategorizations(
  entries: JournalEntry[],
): Array<{
  entry: JournalEntry;
  suggestion: CategorizedTransaction;
}> {
  const out: Array<{ entry: JournalEntry; suggestion: CategorizedTransaction }> = [];
  for (const entry of entries) {
    if (entry.source !== "manual" && entry.source !== "adjustment") continue;
    const amount = entry.lines.reduce((s, l) => s + l.debit - l.credit, 0);
    const suggestion = categorizeTransaction(entry.description, amount, entry.source);
    if (suggestion.confidence < 0.85) {
      out.push({ entry, suggestion });
    }
  }
  return out;
}

// ── Anomaly detection ────────────────────────────────────────────────────────

export type AnomalySeverity = "low" | "medium" | "high";

export interface Anomaly {
  severity: AnomalySeverity;
  title: string;
  detail: string;
  /** Account/subject the anomaly concerns. */
  subject: string;
}

/**
 * Statistical anomaly detection over orders (z-score on order values + margin
 * floors + refund-rate monitoring). Like ERPNext's validation webhooks and
 * Crater's expense guards: unusual flows surface before they hit the books.
 */
export function detectAnomalies(orders: Order[]): Anomaly[] {
  const anomalies: Anomaly[] = [];
  if (orders.length < 5) return anomalies;

  // 1. Order-value outliers (z-score > 3).
  const totals = orders.map((o) => o.total_amount);
  const mean = totals.reduce((s, v) => s + v, 0) / totals.length;
  const std = Math.sqrt(totals.reduce((s, v) => s + (v - mean) ** 2, 0) / totals.length) || 1;
  for (const order of orders) {
    const z = (order.total_amount - mean) / std;
    if (z > 3) {
      anomalies.push({
        severity: "medium",
        title: `Unusually large order ${order.order_number}`,
        detail: `Value ${order.total_amount.toFixed(2)} is ${z.toFixed(1)}σ above the ${mean.toFixed(2)} average — verify it isn't a pricing or quantity error.`,
        subject: order.order_number,
      });
    }
  }

  // 2. Negative / zero-margin orders (cost exceeds revenue).
  for (const order of orders) {
    const itemsCost = order.items.reduce((s, i) => s + i.line_cost, 0);
    const revenue = order.subtotal + order.shipping_amount - order.discount_amount;
    if (revenue > 0 && itemsCost > revenue) {
      anomalies.push({
        severity: "high",
        title: `Order ${order.order_number} sells below cost`,
        detail: `Item cost ${itemsCost.toFixed(2)} exceeds revenue ${revenue.toFixed(2)} — COGS or pricing is misconfigured.`,
        subject: order.order_number,
      });
    }
  }

  // 3. Refund-rate spikes (per day, last 14 days vs baseline).
  const byDay = new Map<string, { total: number; refunded: number }>();
  for (const order of orders) {
    const day = order.ordered_at.slice(0, 10);
    const bucket = byDay.get(day) ?? { total: 0, refunded: 0 };
    bucket.total += 1;
    if (order.refund_amount > 0) bucket.refunded += 1;
    byDay.set(day, bucket);
  }
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-14);
  if (days.length >= 7) {
    const baseline = days.slice(0, -3);
    const recent = days.slice(-3);
    const baseRate =
      baseline.reduce((s, [, b]) => s + b.refunded / Math.max(1, b.total), 0) / baseline.length;
    const recentRate =
      recent.reduce((s, [, b]) => s + b.refunded / Math.max(1, b.total), 0) / recent.length;
    if (recentRate > 0.2 && recentRate > baseRate * 2) {
      anomalies.push({
        severity: "high",
        title: "Refund rate spike detected",
        detail: `Refunds jumped to ${(recentRate * 100).toFixed(0)}% of orders (baseline ${(baseRate * 100).toFixed(0)}%). Check product quality or a possible pricing error.`,
        subject: "refunds",
      });
    }
  }

  // 4. Missing COGS — orders with items but zero unit costs (unbooked profit).
  const missingCost = orders.filter(
    (o) => o.items.length > 0 && o.items.every((i) => i.unit_cost === 0),
  );
  if (missingCost.length > 0) {
    anomalies.push({
      severity: "medium",
      title: `${missingCost.length} order${missingCost.length === 1 ? "" : "s"} booked without item costs`,
      detail:
        "COGS is zero for these orders, so profit is overstated. Set cost prices in Products or sync the catalog.",
      subject: "cogs",
    });
  }

  return anomalies;
}

// ── Cash-flow forecasting ────────────────────────────────────────────────────

export interface CashFlowForecast {
  /** Historical weekly net cash (net profit proxy) used for the fit. */
  history: Array<{ week: string; net: number }>;
  /** Next 4 weeks of projected net cash with a naive-trend + seasonality model. */
  projection: Array<{ week: string; net: number; low: number; high: number }>;
  /** Projected cumulative cash movement over the horizon. */
  horizonNet: number;
  method: string;
}

/**
 * Cash-flow forecast: weekly net-cash series with a linear-trend +
 * recent-momentum blend, and an interval band from historical volatility.
 * Deterministic (no LLM in the numeric path) — the LLM explains it, it doesn't
 * invent it.
 */
export function forecastCashFlow(orders: Order[], weeksAhead = 4): CashFlowForecast {
  const weekly = new Map<string, number>();
  for (const order of orders) {
    const date = new Date(order.ordered_at);
    // ISO week bucket (Monday-based).
    const day = (date.getUTCDay() + 6) % 7;
    const monday = new Date(date);
    monday.setUTCDate(date.getUTCDate() - day);
    const key = monday.toISOString().slice(0, 10);
    const net =
      order.subtotal +
      order.shipping_amount -
      order.discount_amount -
      order.refund_amount -
      order.items.reduce((s, i) => s + i.line_cost, 0) -
      order.payment_fee -
      order.shipping_cost;
    weekly.set(key, round2((weekly.get(key) ?? 0) + net));
  }

  const history = [...weekly.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, net]) => ({ week, net }));

  if (history.length === 0) {
    return {
      history: [],
      projection: [],
      horizonNet: 0,
      method: "insufficient history",
    };
  }

  // Linear trend over the observed weeks.
  const n = history.length;
  const xs = history.map((_, i) => i);
  const ys = history.map((h) => h.net);
  const xMean = xs.reduce((s, v) => s + v, 0) / n;
  const yMean = ys.reduce((s, v) => s + v, 0) / n;
  const cov = xs.reduce((s, x, i) => s + (x - xMean) * (ys[i] - yMean), 0);
  const varX = xs.reduce((s, x) => s + (x - xMean) ** 2, 0) || 1;
  const slope = cov / varX;
  const intercept = yMean - slope * xMean;

  // Recent momentum: weight the last 2 weeks more than the trend alone.
  const recent = ys.slice(-2);
  const recentAvg = recent.length > 0 ? recent.reduce((s, v) => s + v, 0) / recent.length : yMean;

  // Volatility band from residuals.
  const residuals = ys.map((y, i) => y - (intercept + slope * i));
  const std = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / n);

  const lastWeek = new Date(`${history[history.length - 1].week}T00:00:00Z`);
  const projection: CashFlowForecast["projection"] = [];
  let cumulative = 0;
  for (let i = 1; i <= weeksAhead; i += 1) {
    const week = new Date(lastWeek);
    week.setUTCDate(week.getUTCDate() + 7 * i);
    const trendPoint = intercept + slope * (n - 1 + i);
    // Blend: 60% trend, 40% recent momentum (decayed).
    const net = round2(0.6 * trendPoint + 0.4 * recentAvg);
    const low = round2(net - 1.28 * std); // ~80% interval
    const high = round2(net + 1.28 * std);
    cumulative = round2(cumulative + net);
    projection.push({
      week: week.toISOString().slice(0, 10),
      net,
      low,
      high,
    });
  }

  return {
    history,
    projection,
    horizonNet: cumulative,
    method: "linear trend + recent momentum blend, 80% interval from residuals",
  };
}
