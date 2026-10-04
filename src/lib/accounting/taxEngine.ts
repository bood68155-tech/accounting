import type { JournalEntry, JournalLine, Order } from "@/types";
import { round2 } from "@/lib/utils";

/**
 * ── Tax / VAT engine (Account 2100) ──────────────────────────────────────────
 * Account 2100 `Sales Tax Payable` is a credit-normal liability: every sale
 * credits it with the tax charged to the customer, every refund debits it back,
 * and a remittance to the tax authority debits it with a matching credit to Cash.
 *
 * This module is deliberately pure — no database, no ambient clock in the tax
 * math — so the liability can be recomputed from the immutable journal at any
 * point and always tie back to the trial balance.
 *
 * Key invariant (used by the daily digest and the VAT return):
 *
 *   balance(2100) = Σ credits(2100) − Σ debits(2100)
 *                  = tax collected − tax reversed − tax paid to the authority
 */

// ── Chart-of-accounts constants this engine relies on ───────────────────────
export const SALES_TAX_ACCOUNT = "2100";
export const CASH_ACCOUNT = "1000";
export const RECEIVABLE_ACCOUNT = "1100";
export const REFUNDS_GIVEN_ACCOUNT = "4500";

/** Accounts whose movement represents revenue subject to tax. */
export const TAXABLE_REVENUE_ACCOUNTS = ["4000", "4100", "4200"];

// ── Rate presets ────────────────────────────────────────────────────────────

export interface TaxRatePreset {
  /** Stable identifier referenced by a store's tax configuration. */
  code: string;
  label: string;
  jurisdiction: string;
  /** Decimal fraction: 0.20 === 20%. */
  rate: number;
  /** True when listed shelf prices already contain the tax (EU / GCC style). */
  prices_include_tax: boolean;
}

/**
 * A pragmatic preset table — enough to cover the marketplaces the app ingests
 * from. Stores override these with `TaxConfig`, which is what the engine reads.
 */
export const TAX_RATE_PRESETS: TaxRatePreset[] = [
  { code: "us-none", label: "No sales tax", jurisdiction: "US (export / tax-free)", rate: 0, prices_include_tax: false },
  { code: "us-ca", label: "CA sales tax", jurisdiction: "US-California", rate: 0.0725, prices_include_tax: false },
  { code: "us-ny", label: "NY sales tax", jurisdiction: "US-New York", rate: 0.08875, prices_include_tax: false },
  { code: "uk-vat", label: "UK VAT", jurisdiction: "United Kingdom", rate: 0.2, prices_include_tax: true },
  { code: "de-vat", label: "German VAT", jurisdiction: "Germany", rate: 0.19, prices_include_tax: true },
  { code: "fr-vat", label: "French VAT", jurisdiction: "France", rate: 0.2, prices_include_tax: true },
  { code: "sa-vat", label: "Saudi Arabia VAT", jurisdiction: "Saudi Arabia", rate: 0.15, prices_include_tax: true },
  { code: "ae-vat", label: "UAE VAT", jurisdiction: "United Arab Emirates", rate: 0.05, prices_include_tax: true },
  { code: "eg-vat", label: "Egypt VAT", jurisdiction: "Egypt", rate: 0.14, prices_include_tax: true },
];

export function getTaxRatePreset(code: string): TaxRatePreset | undefined {
  return TAX_RATE_PRESETS.find((p) => p.code === code);
}

export interface TaxConfig {
  /** Preset code, or a custom label when `rate` is supplied directly. */
  rate_code: string;
  /** Decimal fraction override (0.20 === 20%). Takes precedence over the preset. */
  rate: number | null;
  /** Whether the store's catalog prices already contain tax. */
  prices_include_tax: boolean;
  /** Whether shipping forms part of the taxable base. */
  shipping_taxable: boolean;
  /** Tax jurisdiction label used in the VAT return. */
  jurisdiction: string;
}

export const DEFAULT_TAX_CONFIG: TaxConfig = {
  rate_code: "us-none",
  rate: null,
  prices_include_tax: false,
  shipping_taxable: false,
  jurisdiction: "US (no sales tax)",
};

/**
 * Build a config from a preset code, letting the caller override individual
 * fields. Throws on an unknown preset so a typo can never silently post a 0%
 * return — a missed tax filing is far more expensive than a failed ingest.
 *
 * `shipping_taxable` deliberately does NOT follow the preset's
 * `prices_include_tax`: whether shelf prices include tax tells us nothing about
 * whether the carrier charge is taxable, and the two jurisdictions disagree.
 * It therefore defaults to false and must be opted into explicitly.
 */
export function taxConfigFor(
  rateCode: string,
  overrides: Partial<Omit<TaxConfig, "rate_code">> = {},
): TaxConfig {
  const preset = getTaxRatePreset(rateCode);
  if (!preset) {
    throw new Error(
      `Unknown tax rate preset "${rateCode}" — expected one of ${TAX_RATE_PRESETS.map((p) => p.code).join(", ")}.`,
    );
  }
  return {
    rate_code: preset.code,
    rate: overrides.rate ?? null,
    prices_include_tax: overrides.prices_include_tax ?? preset.prices_include_tax,
    shipping_taxable: overrides.shipping_taxable ?? false,
    jurisdiction: overrides.jurisdiction ?? preset.jurisdiction,
  };
}

/** Effective decimal rate for a config (explicit override wins over the preset). */
export function effectiveRate(config: TaxConfig = DEFAULT_TAX_CONFIG): number {
  if (config.rate !== null && config.rate !== undefined) {
    if (!Number.isFinite(config.rate) || config.rate < 0 || config.rate >= 1) {
      throw new Error(`Tax rate must be a fraction in [0, 1) — received ${config.rate}.`);
    }
    return config.rate;
  }
  const preset = getTaxRatePreset(config.rate_code);
  return preset ? preset.rate : 0;
}

// ── Core tax math ───────────────────────────────────────────────────────────

export interface TaxAmount {
  /** The taxable base, excluding tax. */
  net: number;
  /** The tax component. */
  tax: number;
  /** net + tax — the amount actually charged. */
  gross: number;
  rate: number;
  inclusive: boolean;
}

/**
 * Tax added on top of a tax-exclusive net amount.
 *   net 100 @ 20% → tax 20.00, gross 120.00
 */
export function taxFromExclusive(net: number, rate: number): TaxAmount {
  const tax = round2(net * rate);
  return { net: round2(net), tax, gross: round2(net + tax), rate, inclusive: false };
}

/**
 * Tax extracted from a tax-inclusive gross amount.
 *   gross 120 @ 20% → tax 20.00, net 100.00
 *
 * The base is rounded FIRST and the tax is the remainder, so the two always add
 * back up to the gross amount to the cent (a float sum may differ by ~1e-15 —
 * compare with `round2(net + tax)`).
 */
export function taxFromInclusive(gross: number, rate: number): TaxAmount {
  const net = round2(gross / (1 + rate));
  const tax = round2(gross - net);
  return { net, tax, gross: round2(gross), rate, inclusive: true };
}

/** Direction-agnostic tax split for an amount whose tax treatment is known. */
export function splitTax(amount: number, rate: number, inclusive: boolean): TaxAmount {
  return inclusive ? taxFromInclusive(amount, rate) : taxFromExclusive(amount, rate);
}

// ── Order-level tax ─────────────────────────────────────────────────────────

export interface TaxComponent {
  /** This component's share of the taxable base (already tax-exclusive). */
  amount: number;
  rate: number;
  /** Overrides `config.prices_include_tax` for this component. */
  inclusive?: boolean;
}

/**
 * Whether the amounts on an order row are stated net of tax or gross of tax.
 *
 * `Order.subtotal` is documented as "before shipping/discounts/tax", so `net`
 * is the default and the correct assumption for a US sales-tax store. A VAT
 * store whose provider reports tax-inclusive line totals must pass `gross`;
 * guessing here silently mis-states the VAT return.
 */
export type TaxBasis = "net" | "gross";

export interface ComputeOrderTaxOptions {
  basis?: TaxBasis;
  /** Mixed-rate baskets: tax each component separately instead of the flat rate. */
  components?: TaxComponent[];
}

export interface OrderTaxResult {
  order_number: string;
  /** Taxable base, clamped at zero for the tax computation. */
  taxable_base: number;
  /** Net sales figure before clamping (can be negative on an over-discounted order). */
  raw_base: number;
  rate: number;
  expected_tax: number;
  /** Tax actually recorded on the order row (what was credited to 2100). */
  posted_tax: number;
  /** posted_tax − expected_tax; zero when the order reconciles. */
  variance: number;
  expected_total: number;
  posted_total: number;
  total_variance: number;
  reconciled: boolean;
  issues: string[];
}

/**
 * Recompute the tax on a single order and compare it with what was recorded.
 *
 * The order row stores `tax_amount`, which the webhook provider supplies and
 * `createSaleEntry` credits to Account 2100. This detects the case where the
 * provider's tax disagrees with the store's own configured rate — usually a
 * tax-inclusive/exclusive mix-up — before it becomes a bad VAT return.
 *
 * A negative base (discounts exceeding the subtotal) produces no tax and is
 * reported as an issue instead of a negative liability.
 */
export function computeOrderTax(
  order: Order,
  config: TaxConfig = DEFAULT_TAX_CONFIG,
  options: ComputeOrderTaxOptions = {},
): OrderTaxResult {
  const basis = options.basis ?? "net";
  const issues: string[] = [];
  const rate = effectiveRate(config);

  // What the customer was charged tax *on*, before any tax component.
  const goods = round2(order.subtotal - order.discount_amount);
  const raw_base = config.shipping_taxable ? round2(goods + order.shipping_amount) : goods;
  const taxable_base = Math.max(0, raw_base);

  let expectedTax: number;
  if (options.components && options.components.length > 0) {
    // Mixed basket: tax each component separately, then sum. Rounding per
    // component (not on the total) mirrors how tax authorities assess VAT.
    let total = 0;
    for (const c of options.components) {
      total += splitTax(Math.max(0, c.amount), c.rate, c.inclusive ?? basis === "gross").tax;
    }
    expectedTax = round2(total);
  } else {
    expectedTax = splitTax(taxable_base, rate, basis === "gross").tax;
  }

  // On a gross order the recorded subtotal already contains the tax, so the
  // total is just the goods + shipping; otherwise tax is added on top.
  const expectedTotal =
    basis === "gross"
      ? round2(order.subtotal + order.shipping_amount - order.discount_amount)
      : round2(order.subtotal + order.shipping_amount - order.discount_amount + expectedTax);

  const postedTax = round2(order.tax_amount);
  const taxVariance = round2(postedTax - expectedTax);
  const totalVariance = round2(order.total_amount - expectedTotal);

  if (order.subtotal < 0 || order.discount_amount < 0 || order.total_amount < 0) {
    issues.push("Order carries a negative subtotal, discount or total — it was likely reversed upstream.");
  }
  if (raw_base < 0) {
    issues.push(
      `Discounts (${order.discount_amount}) exceed the goods charged (${order.subtotal}) — the taxable base is ${raw_base.toFixed(2)}; no tax assessed.`,
    );
  }
  if (Math.abs(taxVariance) > 0.005) {
    issues.push(
      `Tax mismatch: order recorded ${postedTax.toFixed(2)} but ${(rate * 100).toFixed(2)}% of ${taxable_base.toFixed(2)} is ${expectedTax.toFixed(2)} (tax basis: ${basis}).`,
    );
  }
  if (Math.abs(totalVariance) > 0.005) {
    issues.push(
      `Total mismatch: order recorded ${order.total_amount.toFixed(2)} but its components sum to ${expectedTotal.toFixed(2)}.`,
    );
  }

  return {
    order_number: order.order_number,
    taxable_base,
    raw_base,
    rate,
    expected_tax: expectedTax,
    posted_tax: postedTax,
    variance: taxVariance,
    expected_total: expectedTotal,
    posted_total: round2(order.total_amount),
    total_variance: totalVariance,
    reconciled: issues.length === 0,
    issues,
  };
}

/**
 * Re-derive the tax on an order and return a corrected copy.
 * Callers use this after a `computeOrderTax` warning — the journal entry for the
 * sale must then be reversed and reposted for Account 2100 to stay correct
 * (posted entries are immutable; see db/migrations/20260924000000).
 */
export function applyOrderTax(
  order: Order,
  config: TaxConfig = DEFAULT_TAX_CONFIG,
  options: ComputeOrderTaxOptions = {},
): Order {
  const result = computeOrderTax(order, config, options);
  return { ...order, tax_amount: result.expected_tax, total_amount: result.expected_total };
}

// ── Ledger-side: Account 2100 liability ──────────────────────────────────────

export type TaxMovementKind = "collected" | "reversed" | "paid" | "adjustment";

export interface TaxMovement {
  entry_number: number;
  entry_date: string;
  kind: TaxMovementKind;
  /** Signed effect on the 2100 balance (positive = more tax owed). */
  amount: number;
  description: string;
}

const isCode = (l: JournalLine, code: string) => l.account_code === code;

/**
 * Classify a journal entry's effect on Account 2100 by looking at what the 2100
 * legs are offset against:
 *
 *   credit 2100 vs revenue / receivable → tax collected from a sale
 *   debit  2100 vs revenue / refunds   → tax reversed by a refund or credit note
 *   debit  2100 vs cash                → remittance paid to the tax authority
 *   anything else                      → adjustment
 *
 * Reversal is checked BEFORE cash on purpose: a refund leaves through the bank
 * account, so its entry touches both 4500 and 1000 — testing cash first would
 * report every refund as a tax remittance and wipe out real tax owed.
 */
export function classifyTaxMovement(entry: JournalEntry): TaxMovement[] {
  const taxLines = entry.lines.filter((l) => isCode(l, SALES_TAX_ACCOUNT));
  if (taxLines.length === 0) return [];
  const offsets = entry.lines.filter((l) => !isCode(l, SALES_TAX_ACCOUNT));

  const offsetCodes = new Set(offsets.map((l) => l.account_code));
  const touchesRevenue = TAXABLE_REVENUE_ACCOUNTS.some((c) => offsetCodes.has(c));
  const touchesReceivable = offsetCodes.has(RECEIVABLE_ACCOUNT);
  const touchesCash = offsetCodes.has(CASH_ACCOUNT);
  const touchesRefunds = offsetCodes.has(REFUNDS_GIVEN_ACCOUNT);

  const movements: TaxMovement[] = [];
  for (const taxLine of taxLines) {
    const kind: TaxMovementKind = (() => {
      if (taxLine.credit > 0 && (touchesRevenue || touchesReceivable)) return "collected";
      if (taxLine.debit > 0 && (touchesRefunds || touchesRevenue || touchesReceivable)) return "reversed";
      if (taxLine.debit > 0 && touchesCash) return "paid";
      return "adjustment";
    })();

    movements.push({
      entry_number: entry.entry_number,
      entry_date: entry.entry_date,
      kind,
      // Credit-normal account: credits increase the liability, debits decrease it.
      amount: round2(taxLine.credit - taxLine.debit),
      description: taxLine.description || entry.description,
    });
  }
  return movements;
}

export interface TaxRateBucket {
  rate: number;
  taxable_base: number;
  tax_collected: number;
  tax_reversed: number;
  tax_paid: number;
  net_due: number;
}

export interface TaxPeriodReport {
  period: { from: string; to: string };
  jurisdiction: string;
  /** Revenue credited during the period (4000/4100/4200), net of refunds. */
  net_sales: number;
  /** Taxable portion of net sales (excludes shipping when it is not taxed). */
  taxable_base: number;
  tax_collected: number;
  tax_reversed: number;
  /** Input tax: tax already remitted to the authority. */
  tax_paid: number;
  /** collected − reversed − paid — the movement owed on Account 2100. */
  net_tax_payable: number;
  /** Signed credit-normal balance of Account 2100 (all-time, not period). */
  account_balance: number;
  movement_counts: Record<TaxMovementKind, number>;
  by_rate: TaxRateBucket[];
  movements: TaxMovement[];
  /** True when every entry in the period balanced (Σ debits = Σ credits). */
  ledger_balanced: boolean;
}

export interface TaxReportOptions {
  /** Only entries on or after this ISO date. */
  from?: string;
  /** Only entries on or before this ISO date. */
  to?: string;
  /** How many movements to retain in the report detail (default 100). */
  max_movements?: number;
}

/**
 * Build the Account 2100 liability report for a period straight from the
 * journal. Period figures answer "what do I owe for this period?"; the account
 * balance is all-time so it always agrees with the trial balance.
 */
export function buildTaxPeriodReport(
  entries: JournalEntry[],
  config: TaxConfig = DEFAULT_TAX_CONFIG,
  options: TaxReportOptions = {},
): TaxPeriodReport {
  const { from, to } = options;
  const maxMovements = options.max_movements ?? 100;

  const inPeriod = entries.filter((e) => {
    if (from && e.entry_date < from) return false;
    if (to && e.entry_date > to) return false;
    return true;
  });

  const movements = inPeriod.flatMap(classifyTaxMovement);

  const movement_counts: Record<TaxMovementKind, number> = {
    collected: 0,
    reversed: 0,
    paid: 0,
    adjustment: 0,
  };
  let tax_collected = 0;
  let tax_reversed = 0;
  let tax_paid = 0;
  for (const m of movements) {
    movement_counts[m.kind] += 1;
    if (m.kind === "collected") tax_collected += m.amount;
    else if (m.kind === "reversed") tax_reversed += -m.amount;
    else if (m.kind === "paid") tax_paid += -m.amount;
  }
  tax_collected = round2(tax_collected);
  tax_reversed = round2(tax_reversed);
  tax_paid = round2(tax_paid);

  // Revenue movement for the period (credit-normal revenue accounts).
  let revenueCredits = 0;
  let refundDebits = 0;
  for (const entry of inPeriod) {
    for (const l of entry.lines) {
      if (TAXABLE_REVENUE_ACCOUNTS.includes(l.account_code)) revenueCredits += l.credit - l.debit;
      if (isCode(l, REFUNDS_GIVEN_ACCOUNT)) refundDebits += l.debit - l.credit;
    }
  }
  const net_sales = round2(revenueCredits - refundDebits);

  const rate = effectiveRate(config);
  // Gross up the net revenue when prices are tax-inclusive so the base is the
  // tax-exclusive amount the authority expects.
  const taxable_base =
    config.prices_include_tax && rate > 0 ? round2(net_sales / (1 + rate)) : net_sales;

  const net_tax_payable = round2(tax_collected - tax_reversed - tax_paid);

  // All-time 2100 balance — must equal the trial balance row for the account.
  let allTimeCredits = 0;
  let allTimeDebits = 0;
  for (const entry of entries) {
    for (const l of entry.lines) {
      if (isCode(l, SALES_TAX_ACCOUNT)) {
        allTimeCredits += l.credit;
        allTimeDebits += l.debit;
      }
    }
  }
  const account_balance = round2(allTimeCredits - allTimeDebits);

  const ledger_balanced = inPeriod.every((e) => {
    const d = round2(e.lines.reduce((s, l) => s + l.debit, 0));
    const c = round2(e.lines.reduce((s, l) => s + l.credit, 0));
    return Math.abs(d - c) <= 0.005;
  });

  const by_rate: TaxRateBucket[] =
    rate > 0 || tax_collected !== 0
      ? [
          {
            rate,
            taxable_base,
            tax_collected,
            tax_reversed,
            tax_paid,
            net_due: net_tax_payable,
          },
        ]
      : [];

  return {
    period: { from: from ?? "", to: to ?? "" },
    jurisdiction: config.jurisdiction,
    net_sales,
    taxable_base,
    tax_collected,
    tax_reversed,
    tax_paid,
    net_tax_payable,
    account_balance,
    movement_counts,
    by_rate,
    movements: movements.slice(0, maxMovements),
    ledger_balanced,
  };
}

// ── VAT return ──────────────────────────────────────────────────────────────

export interface VatReturnLine {
  box: string;
  label: string;
  amount: number;
}

export interface VatReturn {
  jurisdiction: string;
  period: { from: string; to: string };
  currency: string;
  /** Output tax: tax charged on sales (net of refunds). */
  output_tax: number;
  /** Input tax: tax paid on purchases / already remitted. */
  input_tax: number;
  /** Payable to the authority (negative = reclaim/credit carried forward). */
  net_payable: number;
  /** Closing balance of Account 2100 for cross-checking the return. */
  closing_tax_payable: number;
  lines: VatReturnLine[];
}

/**
 * Assemble a filing-ready VAT return from the journal. Every figure traces to a
 * posted entry — nothing is estimated — so `net_payable` must reconcile with
 * the period movement in Account 2100.
 */
export function buildVatReturn(
  entries: JournalEntry[],
  config: TaxConfig = DEFAULT_TAX_CONFIG,
  options: TaxReportOptions & { currency?: string } = {},
): VatReturn {
  const report = buildTaxPeriodReport(entries, config, options);
  const rate = (effectiveRate(config) * 100).toFixed(2).replace(/\.?0+$/, "");
  const currency = options.currency ?? "USD";

  const output_tax = round2(report.tax_collected - report.tax_reversed);
  const input_tax = report.tax_paid;
  const net_payable = round2(output_tax - input_tax);

  return {
    jurisdiction: report.jurisdiction,
    period: report.period,
    currency,
    output_tax,
    input_tax,
    net_payable,
    closing_tax_payable: report.account_balance,
    lines: [
      { box: "1", label: `Taxable supplies net of tax @ ${rate}%`, amount: report.taxable_base },
      { box: "2", label: "Output tax on sales", amount: report.tax_collected },
      { box: "3", label: "Tax reversed on refunds and credit notes", amount: -report.tax_reversed },
      { box: "4", label: "Net output tax", amount: output_tax },
      { box: "5", label: "Input tax paid to the authority", amount: input_tax },
      { box: "6", label: "Net tax payable (4 − 5)", amount: net_payable },
    ],
  };
}

/** One-line human summary used by the daily digest and the AI agent. */
export function describeTaxLiability(report: TaxPeriodReport, currency = "USD"): string {
  const money = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  return (
    `${report.jurisdiction}: collected ${money(report.tax_collected)}, ` +
    `reversed ${money(report.tax_reversed)}, paid ${money(report.tax_paid)}, ` +
    `balance on 2100 ${money(report.account_balance)}.`
  );
}
