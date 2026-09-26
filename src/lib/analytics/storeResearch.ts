import type { JournalEntry, Order, Product, Store } from "@/types";
import type { Anomaly } from "@/lib/ai/categorizer";
import { detectAnomalies } from "@/lib/ai/categorizer";
import { computeAggregateProfit } from "@/lib/accounting/profitEngine";
import { round2 } from "@/lib/utils";

/**
 * ── Deep Store Research & Automated Audit engine ──────────────────────────────
 * A deterministic research layer over the tenant's books that continuously
 * "audits" store health. Everything here is derived from real rows (orders,
 * products, journal entries) so the numbers reconcile 1:1 with the dashboard
 * and the general ledger — the LLM may explain these findings, never invent them.
 *
 * Three exported studies:
 *   • computeStoreAnalytics  — deep business analytics (margins, ROAS-ready ad
 *     spend placeholders, top SKUs, inventory warnings)
 *   • runStoreAudit          — continuous audit: missing cost rates, anomalous
 *     transactions, missing COGS, unbalanced ledger…
 *   • computeStoreHealth     — a single 0–100 score with grade + signals
 */

// ── Deep business analytics ──────────────────────────────────────────────────

/** Revenue a SKU produced (rebuilt from order lines, refund-aware). */
export interface SkuPerformance {
  sku: string;
  name: string;
  units: number;
  revenue: number;
  cogs: number;
  profit: number;
  margin: number; // 0..1, profit / revenue
}

/** One actionable inventory warning. */
export interface InventoryWarning {
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  sku?: string;
}

/** Ad-spend attribution input: from config or a future Ads integration. */
export interface AdSpendInput {
  /** Total ad spend in the store currency for the analyzed period. */
  amount: number | null;
  /** Optional source label, e.g. "config" or "meta-ads-api". */
  source: string;
}

/**
 * Deep analytics for one store — the data behind the dashboard's
 * "Deep analytics" panel and the AI assistant's analytics tool.
 */
export interface StoreAnalytics {
  storeId: string;
  storeName: string;
  currency: string;
  periodDays: number;
  ordersAnalyzed: number;

  /** Gross margin (0..1) and net margin across ALL analyzed orders. */
  grossMargin: number;
  netMargin: number;

  /** Average order value and average fulfillment cost per order. */
  aov: number;
  avgShippingCost: number;
  avgPaymentFee: number;
  /** Payment fees as a share of net sales (fee drag). */
  feeRate: number;
  /** COGS as a share of net sales. */
  cogsRate: number;

  /** Refunds as a share of gross sales. */
  refundRate: number;

  /**
   * ROAS placeholder: net sales ÷ ad spend. null when no ad spend is
   * configured yet (Ads integrations land later) — the UI renders an explicit
   * "connect ad spend" placeholder instead of a misleading number.
   */
  roas: number | null;
  adSpend: AdSpendInput;

  /** Product winners ranked by revenue (top N). */
  topSkus: SkuPerformance[];
  /** SKUs selling below their configured cost — repricing candidates. */
  lossMakingSkus: SkuPerformance[];

  /** Catalog coverage + inventory-level warnings. */
  inventoryWarnings: InventoryWarning[];
}

/** Attribution window for analytics (trailing days). */
const DEFAULT_PERIOD_DAYS = 30;

function isWithinPeriod(iso: string, periodDays: number): boolean {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= Date.now() - periodDays * 86_400_000;
}

/** Ad spend may be configured per store (store.config.adSpend) — read defensively. */
function readAdSpend(store: Store | null): AdSpendInput {
  const config = (store?.config ?? {}) as Record<string, unknown>;
  const raw = config.adSpend ?? config.ad_spend ?? config.marketingSpend;
  const amount = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
  return { amount, source: amount != null ? "config" : "not-connected" };
}

/** Rebuild per-SKU performance from order lines (refund-proportional). */
export function computeSkuPerformance(orders: Order[], limit = 10): SkuPerformance[] {
  const bySku = new Map<string, SkuPerformance>();

  for (const order of orders) {
    const refundedShare =
      order.total_amount > 0 ? Math.min(1, order.refund_amount / order.total_amount) : 0;

    for (const item of order.items) {
      const key = item.sku || item.name;
      const row =
        bySku.get(key) ??
        ({ sku: item.sku, name: item.name, units: 0, revenue: 0, cogs: 0, profit: 0, margin: 0 } as SkuPerformance);

      const gross = round2(item.line_subtotal);
      const refunds = round2(gross * refundedShare);
      const net = round2(gross - refunds);
      const cost = round2(item.line_cost * (1 - refundedShare));

      row.units += item.quantity;
      row.revenue = round2(row.revenue + net);
      row.cogs = round2(row.cogs + cost);
      row.profit = round2(row.revenue - row.cogs);
      bySku.set(key, row);
    }
  }

  return [...bySku.values()]
    .map((row) => ({ ...row, margin: row.revenue > 0 ? round2(row.profit / row.revenue) : 0 }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

/** Build the full analytics study for one store. */
export function computeStoreAnalytics(
  store: Store | null,
  orders: Order[],
  products: Product[],
  options: { periodDays?: number; adSpend?: number | null } = {},
): StoreAnalytics {
  const periodDays = options.periodDays ?? DEFAULT_PERIOD_DAYS;
  const scoped = orders.filter((o) => isWithinPeriod(o.ordered_at, periodDays));
  const analyzed = scoped.length > 0 ? scoped : orders; // fall back to full history

  const agg = computeAggregateProfit(analyzed);
  const adSpend: AdSpendInput =
    options.adSpend != null && options.adSpend > 0
      ? { amount: options.adSpend, source: "config" }
      : readAdSpend(store);

  const roas = adSpend.amount && adSpend.amount > 0 ? round2(agg.net_sales / adSpend.amount) : null;

  // Top SKUs by revenue + loss makers ranked by worst profit.
  const topSkus = computeSkuPerformance(analyzed, 10);
  const lossMakingSkus = [...topSkus].filter((s) => s.profit < 0).sort((a, b) => a.profit - b.profit);

  const inventoryWarnings = buildInventoryWarnings(products, analyzed, topSkus);

  return {
    storeId: store?.id ?? "",
    storeName: store?.name ?? "your store",
    currency: store?.currency ?? "USD",
    periodDays,
    ordersAnalyzed: analyzed.length,

    grossMargin: agg.gross_margin,
    netMargin: agg.net_margin,

    aov: analyzed.length > 0 ? round2(agg.net_sales / analyzed.length) : 0,
    avgShippingCost: analyzed.length > 0 ? round2(agg.shipping_cost / analyzed.length) : 0,
    avgPaymentFee: analyzed.length > 0 ? round2(agg.payment_fees / analyzed.length) : 0,
    feeRate: agg.net_sales > 0 ? round2(agg.payment_fees / agg.net_sales) : 0,
    cogsRate: agg.net_sales > 0 ? round2(agg.cogs / agg.net_sales) : 0,

    refundRate: agg.gross_sales > 0 ? round2(agg.refunds / agg.gross_sales) : 0,

    roas,
    adSpend,

    topSkus,
    lossMakingSkus,
    inventoryWarnings,
  };
}

// ── Inventory / catalog warnings ─────────────────────────────────────────────

/**
 * Catalog-health warnings: missing cost rates on sold SKUs (COGS understated),
 * products with zero/negative margin, and best-sellers absent from the catalog.
 */
function buildInventoryWarnings(
  products: Product[],
  orders: Order[],
  topSkus: SkuPerformance[],
): InventoryWarning[] {
  const warnings: InventoryWarning[] = [];
  const catalogBySku = new Map(products.map((p) => [p.sku, p]));

  // 1. Sold SKUs with no cost price in the catalog → COGS & profit unreliable.
  const missingCostSkus = new Set<string>();
  for (const order of orders) {
    for (const item of order.items) {
      if (item.unit_cost > 0) continue;
      if (catalogBySku.has(item.sku) && (catalogBySku.get(item.sku)?.cost_price ?? 0) > 0) continue;
      missingCostSkus.add(item.sku || item.name);
    }
  }
  if (missingCostSkus.size > 0) {
    warnings.push({
      severity: "critical",
      title: `${missingCostSkus.size} sold SKU${missingCostSkus.size === 1 ? "" : "s"} missing cost prices`,
      detail:
        "These items sold with unit_cost = 0, so COGS is understated and profit is overstated. Set costs in the catalog or re-run catalog sync.",
      sku: [...missingCostSkus].slice(0, 5).join(", "),
    });
  }

  // 2. Catalog entries with zero margin (cost ≥ price) — repricing candidates.
  const zeroMargin = products.filter((p) => p.selling_price > 0 && p.cost_price >= p.selling_price);
  if (zeroMargin.length > 0) {
    warnings.push({
      severity: "warning",
      title: `${zeroMargin.length} product${zeroMargin.length === 1 ? "" : "s"} at or below cost`,
      detail: `Catalog price does not cover cost for: ${zeroMargin.slice(0, 5).map((p) => p.sku).join(", ")}${zeroMargin.length > 5 ? "…" : ""}. Re-price or renegotiate supply.`,
    });
  }

  // 3. Best sellers missing from the catalog entirely (unsynced store?).
  const orphanSkus = topSkus.filter((s) => s.sku && !catalogBySku.has(s.sku));
  if (orphanSkus.length > 0) {
    warnings.push({
      severity: "info",
      title: `${orphanSkus.length} best seller${orphanSkus.length === 1 ? "" : "s"} not in the catalog`,
      detail: `Top-selling SKUs without catalog rows (costs fall back to the order line): ${orphanSkus.slice(0, 5).map((s) => s.sku).join(", ")}. Sync the catalog to track their true cost.`,
    });
  }

  // 4. Empty catalog while orders exist — COGS entirely unmanaged.
  if (products.length === 0 && orders.length > 0) {
    warnings.push({
      severity: "warning",
      title: "Catalog is empty but orders exist",
      detail: "Sync the product catalog (or add products manually) so incoming orders pick up real unit costs for COGS.",
    });
  }

  return warnings;
}

// ── Continuous store audit ───────────────────────────────────────────────────

export type AuditCheckId =
  | "missing_cogs"
  | "below_cost_sales"
  | "value_outliers"
  | "refund_spike"
  | "catalog_coverage"
  | "ledger_balance"
  | "unmatched_fee_rate";

export type AuditSeverity = "pass" | "info" | "warning" | "critical";

/** One automated audit check result. */
export interface AuditFinding {
  id: AuditCheckId;
  severity: AuditSeverity;
  title: string;
  detail: string;
  /** Number of rows/records implicated (orders, SKUs, entries…). */
  affected: number;
  /** Machine-readable subjects (order numbers, SKUs, account codes). */
  subjects: string[];
  /** What the merchant should do about it. */
  recommendation: string;
}

/** Full audit report — passed checks included, so the UI can show coverage. */
export interface StoreAuditReport {
  storeId: string;
  storeName: string;
  currency: string;
  auditedAt: string;
  ordersAudited: number;
  productsAudited: number;
  journalEntriesAudited: number;
  findings: AuditFinding[];
  /** 0–100 store-health score (100 = every check passes cleanly). */
  healthScore: number;
  healthGrade: "A" | "B" | "C" | "D";
  /** Short signals for the dashboard health card. */
  signals: Array<{ label: string; severity: AuditSeverity }>;
}

/** Weights per check for the health score (critical > warning). */
const SEVERITY_PENALTY: Record<Exclude<AuditSeverity, "pass" | "info">, number> = {
  warning: 12,
  critical: 25,
};

/**
 * Run the continuous audit over one store's rows. Deterministic and cheap:
 * pure functions over already-fetched data, safe to call per dashboard render.
 */
export function runStoreAudit(
  store: Store | null,
  orders: Order[],
  products: Product[],
  journalEntries: JournalEntry[],
  anomalies?: Anomaly[],
): StoreAuditReport {
  const findings: AuditFinding[] = [];

  // ── Check: missing COGS (orders with items but zero unit costs) ────────────
  const missingCogs = orders.filter((o) => o.items.length > 0 && o.items.every((i) => i.unit_cost === 0));
  findings.push({
    id: "missing_cogs",
    severity: missingCogs.length === 0 ? "pass" : missingCogs.length > Math.max(3, orders.length * 0.1) ? "critical" : "warning",
    title: missingCogs.length === 0 ? "COGS coverage complete" : `${missingCogs.length} order${missingCogs.length === 1 ? "" : "s"} booked without item costs`,
    detail:
      missingCogs.length === 0
        ? "Every order carries real unit costs — COGS and profit are trustworthy."
        : "These orders have items but unit_cost = 0, so COGS is zero and profit is overstated until costs are filled in.",
    affected: missingCogs.length,
    subjects: missingCogs.slice(0, 5).map((o) => o.order_number),
    recommendation:
      "Sync the product catalog (Products → Sync catalogs) or set cost prices so webhook orders book true COGS.",
  });

  // ── Check: below-cost sales (item cost exceeds line revenue) ───────────────
  const belowCost = orders.filter((o) => {
    const revenue = o.subtotal + o.shipping_amount - o.discount_amount;
    const cost = o.items.reduce((s, i) => s + i.line_cost, 0);
    return revenue > 0 && cost > revenue;
  });
  findings.push({
    id: "below_cost_sales",
    severity: belowCost.length === 0 ? "pass" : "warning",
    title: belowCost.length === 0 ? "No below-cost sales" : `${belowCost.length} order${belowCost.length === 1 ? "" : "s"} sold below cost`,
    detail:
      belowCost.length === 0
        ? "Item costs stay under selling revenue on every order."
        : "Item cost exceeds revenue on these orders — either pricing or the cost catalog is wrong.",
    affected: belowCost.length,
    subjects: belowCost.slice(0, 5).map((o) => o.order_number),
    recommendation: "Re-check those orders' SKUs in the catalog: fix cost_price or raise selling_price.",
  });

  // ── Check: anomalous transactions (statistical detectors, reused) ──────────
  const detected = anomalies ?? detectAnomalies(orders);
  const outlierSubjects = detected.filter((a) => a.subject !== "cogs" && a.subject !== "refunds");
  const refundAnomaly = detected.find((a) => a.subject === "refunds");
  findings.push({
    id: "value_outliers",
    severity: outlierSubjects.length === 0 ? "pass" : "warning",
    title:
      outlierSubjects.length === 0
        ? "No anomalous transactions detected"
        : `${outlierSubjects.length} anomalous transaction pattern${outlierSubjects.length === 1 ? "" : "s"} flagged`,
    detail:
      outlierSubjects.length === 0
        ? "Order values and margins sit within normal statistical bounds."
        : outlierSubjects.map((a) => `${a.title} — ${a.detail}`).join(" · "),
    affected: outlierSubjects.length,
    subjects: outlierSubjects.slice(0, 5).map((a) => a.subject),
    recommendation: "Review the flagged orders in Orders → recent; reverse or correct any mispriced entries.",
  });

  // ── Check: refund-rate spike ───────────────────────────────────────────────
  findings.push({
    id: "refund_spike",
    severity: refundAnomaly ? "critical" : "pass",
    title: refundAnomaly ? refundAnomaly.title : "Refund rate stable",
    detail: refundAnomaly ? refundAnomaly.detail : "Recent refund rates match the historical baseline.",
    affected: refundAnomaly ? 1 : 0,
    subjects: refundAnomaly ? ["refunds"] : [],
    recommendation: refundAnomaly ? "Investigate the spiked window: product quality, shipping damage, or pricing errors." : "Keep monitoring — refunds are watched continuously.",
  });

  // ── Check: catalog coverage (share of sold SKUs with a catalog cost) ───────
  const soldSkus = new Set(orders.flatMap((o) => o.items.map((i) => i.sku || i.name)).filter(Boolean));
  const catalogSkus = new Set(products.map((p) => p.sku));
  const withCost = new Set(products.filter((p) => p.cost_price > 0).map((p) => p.sku));
  const covered = [...soldSkus].filter((sku) => catalogSkus.has(sku) && withCost.has(sku));
  const coverage = soldSkus.size === 0 ? 1 : covered.length / soldSkus.size;
  findings.push({
    id: "catalog_coverage",
    severity: coverage >= 0.95 ? "pass" : coverage >= 0.7 ? "info" : "warning",
    title:
      soldSkus.size === 0
        ? "No sold SKUs to cover yet"
        : `Catalog covers ${(coverage * 100).toFixed(0)}% of sold SKUs`,
    detail:
      soldSkus.size === 0
        ? "Once orders arrive, this check verifies every sold SKU has a catalog cost price."
        : `${covered.length} of ${soldSkus.size} sold SKUs have a real cost in the catalog; the rest fall back to webhook line costs.`,
    affected: soldSkus.size - covered.length,
    subjects: [...soldSkus].filter((sku) => !catalogSkus.has(sku) || !withCost.has(sku)).slice(0, 5),
    recommendation: "Run catalog sync after connecting stores, and fill remaining costs by hand in Products.",
  });

  // ── Check: ledger balance (debits == credits per entry) ────────────────────
  const unbalanced = journalEntries.filter((e) => {
    const debits = round2(e.lines.reduce((s, l) => s + l.debit, 0));
    const credits = round2(e.lines.reduce((s, l) => s + l.credit, 0));
    return Math.abs(debits - credits) > 0.01;
  });
  findings.push({
    id: "ledger_balance",
    severity: unbalanced.length === 0 ? "pass" : "critical",
    title: unbalanced.length === 0 ? "Ledger is balanced" : `${unbalanced.length} unbalanced journal entr${unbalanced.length === 1 ? "y" : "ies"}`,
    detail:
      unbalanced.length === 0
        ? `Σ debits = Σ credits across ${journalEntries.length} entries — double-entry integrity holds.`
        : "These entries have Σ debits ≠ Σ credits and must be reversed and re-posted.",
    affected: unbalanced.length,
    subjects: unbalanced.slice(0, 5).map((e) => `#${e.entry_number}`),
    recommendation: "Use the ledger reversal flow (Ledger → entry → Reverse) to correct unbalanced entries.",
  });

  // ── Check: payment fee-rate sanity (fee share of net sales) ────────────────
  const agg = computeAggregateProfit(orders);
  const feeRate = agg.net_sales > 0 ? agg.payment_fees / agg.net_sales : 0;
  findings.push({
    id: "unmatched_fee_rate",
    severity: feeRate <= 0.05 ? "pass" : feeRate <= 0.1 ? "info" : "warning",
    title:
      agg.net_sales === 0
        ? "No fee data yet"
        : `Gateway fees consume ${(feeRate * 100).toFixed(1)}% of net sales`,
    detail:
      agg.net_sales === 0
        ? "Fees are tracked per order once webhooks (or synced orders) arrive."
        : feeRate <= 0.05
          ? "Fees look healthy for e-commerce (≤5%)."
          : feeRate <= 0.1
            ? "Fees are elevated (5–10%) — worth comparing gateway offers."
            : "Fees are unusually high (>10%) — a gateway misconfiguration or missing net amounts may be inflating fee postings.",
    affected: feeRate > 0.1 ? 1 : 0,
    subjects: [],
    recommendation: feeRate > 0.1 ? "Verify gateway fee extraction per provider and consider negotiating rates." : "No action needed.",
  });

  // ── Health score + grade ───────────────────────────────────────────────────
  let score = 100;
  for (const f of findings) {
    if (f.severity === "critical") score -= SEVERITY_PENALTY.critical;
    else if (f.severity === "warning") score -= SEVERITY_PENALTY.warning;
  }
  // Partial credit for partial catalog coverage when that's the only issue.
  if (coverage < 0.95 && coverage >= 0.7) score += 6;
  const healthScore = Math.max(0, Math.min(100, Math.round(score)));
  const healthGrade: StoreAuditReport["healthGrade"] =
    healthScore >= 90 ? "A" : healthScore >= 75 ? "B" : healthScore >= 55 ? "C" : "D";

  return {
    storeId: store?.id ?? "",
    storeName: store?.name ?? "your store",
    currency: store?.currency ?? "USD",
    auditedAt: new Date().toISOString(),
    ordersAudited: orders.length,
    productsAudited: products.length,
    journalEntriesAudited: journalEntries.length,
    findings,
    healthScore,
    healthGrade,
    signals: findings
      .filter((f) => f.severity !== "pass")
      .slice(0, 4)
      .map((f) => ({ label: f.title, severity: f.severity === "info" ? "info" : f.severity })),
  };
}

// ── Convenience: both studies in one pass ────────────────────────────────────

export interface DeepStoreResearch {
  analytics: StoreAnalytics;
  audit: StoreAuditReport;
}

export function runDeepStoreResearch(
  store: Store | null,
  orders: Order[],
  products: Product[],
  journalEntries: JournalEntry[],
  options: { periodDays?: number; adSpend?: number | null } = {},
): DeepStoreResearch {
  const analytics = computeStoreAnalytics(store, orders, products, options);
  const audit = runStoreAudit(store, orders, products, journalEntries);
  return { analytics, audit };
}
