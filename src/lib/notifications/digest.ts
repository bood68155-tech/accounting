import type { JournalEntry, Order } from "@/types";
import { buildBalanceSheet } from "@/lib/accounting/balanceSheet";
import { buildIncomeStatementFromEntries } from "@/lib/accounting/incomeStatement";
import { round2, formatCurrency, formatPercent } from "@/lib/utils";
import type { CreditPortfolio } from "@/lib/accounting/creditTerms";
import type { TaxPeriodReport } from "@/lib/accounting/taxEngine";
import { escapeHtml } from "@/lib/notifications/channels";
import {
  ALL_DIGEST_SECTIONS,
  type DailyDigest,
  type DigestAlert,
  type DigestChannelId,
  type DigestProductLine,
  type DigestSections,
} from "@/lib/notifications/types";

/**
 * ── Daily digest builder + renderers ────────────────────────────────────────
 * Every figure is derived from the immutable journal through the existing
 * accounting engines — the digest never recomputes revenue or profit on its
 * own, so the message the owner reads always ties to the dashboard and the
 * trial balance.
 */

export interface BuildDigestInput {
  store: { id: string; name: string; currency: string };
  /** Orders placed inside the period (drives order counts, AOV, top products). */
  orders: Order[];
  /** Full ledger — period statements are sliced from it by date. */
  entries: JournalEntry[];
  /** Inclusive ISO dates. */
  period: { from: string; to: string };
  /** Optional Account 2100 report for the same period. */
  tax?: TaxPeriodReport;
  /** Optional credit portfolio snapshot as of `period.to`. */
  credit?: CreditPortfolio;
  sections?: DigestSections;
  /** ISO timestamp; injected so digests are reproducible in tests. */
  generated_at?: string;
  /** How many product rows to list. Default 5. */
  top_product_limit?: number;
}

/**
 * Assemble the digest payload.
 *
 * `entries` is the full journal rather than the period slice because the
 * balance-sheet columns (cash, receivable, tax balance) are cumulative as of
 * the period end — slicing first would understate them.
 */
export function buildDailyDigest(input: BuildDigestInput): DailyDigest {
  const { store, orders, entries, period } = input;
  const sections = input.sections ?? { ...ALL_DIGEST_SECTIONS };
  const topLimit = input.top_product_limit ?? 5;
  const currency = store.currency || "USD";

  const statement = buildIncomeStatementFromEntries(entries, period.from, period.to);
  const sheet = buildBalanceSheet(entries, period.to);

  const revenue = round2(statement.revenue.net_revenue);
  const netProfit = round2(statement.net_profit);
  const netMargin = statement.net_margin;
  const aov = orders.length > 0 ? round2(revenue / orders.length) : 0;

  const tax_payable = input.tax?.account_balance ?? sheet.liabilities.sales_tax_payable;

  // Top products by revenue within the period.
  const productMap = new Map<string, { units: number; revenue: number }>();
  for (const order of orders) {
    for (const item of order.items) {
      const slot = productMap.get(item.name) ?? { units: 0, revenue: 0 };
      slot.units += item.quantity;
      slot.revenue = round2(slot.revenue + item.line_subtotal);
      productMap.set(item.name, slot);
    }
  }
  const top_products: DigestProductLine[] = Array.from(productMap.entries())
    .map(([name, v]) => ({ name, units: v.units, revenue: v.revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, topLimit);

  const portfolio = input.credit;
  const credit = {
    outstanding: round2(portfolio?.total_outstanding ?? 0),
    overdue: round2(portfolio?.total_overdue ?? 0),
    blocked_customers: portfolio?.blocked_customers ?? 0,
    warning_customers: portfolio?.warning_customers ?? 0,
    top_customers: (portfolio?.rows ?? []).slice(0, topLimit).map<CreditLine>((r) => ({
      customer_name: r.customer_name,
      outstanding: r.outstanding_balance,
      overdue: r.overdue_amount,
      status: r.status,
    })),
  };

  const alerts = buildAlerts({
    revenue,
    netProfit,
    orders: orders.length,
    balances: {
      cash: sheet.assets.cash,
      receivable: sheet.assets.accounts_receivable,
      inventory: sheet.assets.inventory,
      tax_payable,
    },
    tax: input.tax,
    credit,
    currency,
    sections,
  });

  // "Empty" means no orders AND no money worth talking about AND no alerts —
  // a quiet day should not produce a message full of zeroes.
  const is_empty =
    orders.length === 0 &&
    revenue === 0 &&
    alerts.length === 0 &&
    credit.outstanding === 0 &&
    tax_payable === 0;

  return {
    store,
    period,
    generated_at: input.generated_at ?? new Date().toISOString(),
    headline: { revenue, net_profit: netProfit, net_margin: netMargin, orders: orders.length, aov },
    balances: {
      cash: sheet.assets.cash,
      receivable: sheet.assets.accounts_receivable,
      inventory: sheet.assets.inventory,
      tax_payable,
    },
    credit,
    top_products,
    alerts,
    is_empty,
  };
}

// Local alias so the map callback stays readable above.
type CreditLine = DailyDigest["credit"]["top_customers"][number];

interface AlertInput {
  revenue: number;
  netProfit: number;
  orders: number;
  balances: DailyDigest["balances"];
  tax?: TaxPeriodReport;
  credit: DailyDigest["credit"];
  currency: string;
  sections: DigestSections;
}

/**
 * Turn the numbers into the handful of sentences the owner actually needs.
 * Only actionable conditions produce an alert — a digest padded with noise
 * stops being read.
 */
function buildAlerts(input: AlertInput): DigestAlert[] {
  const { revenue, netProfit, orders, balances, tax, credit, currency, sections } = input;
  const alerts: DigestAlert[] = [];

  if (orders > 0 && netProfit < 0) {
    alerts.push({
      level: "critical",
      message: `Sold ${orders} order${orders === 1 ? "" : "s"} at a net loss of ${formatCurrency(Math.abs(netProfit), currency)}.`,
    });
  } else if (orders > 0 && revenue > 0 && netProfit / revenue < 0.05) {
    alerts.push({
      level: "warning",
      message: `Net margin is only ${formatPercent(netProfit / revenue)} — below the 5% floor.`,
    });
  }

  if (balances.cash < 0) {
    alerts.push({ level: "critical", message: `Cash is negative (${formatCurrency(balances.cash, currency)}).` });
  }

  if (sections.credit) {
    if (credit.blocked_customers > 0) {
      alerts.push({
        level: "critical",
        message: `${credit.blocked_customers} customer${credit.blocked_customers === 1 ? "" : "s"} blocked on credit checks.`,
      });
    }
    if (credit.overdue > 0) {
      alerts.push({
        level: "warning",
        message: `${formatCurrency(credit.overdue, currency)} is overdue across receivables.`,
      });
    }
  }

  if (sections.tax && tax && tax.net_tax_payable > 0) {
    alerts.push({
      level: "info",
      message: `Account 2100 owes ${formatCurrency(tax.net_tax_payable, currency)} for ${tax.period.from || "the period"}.`,
    });
  }
  if (sections.tax && tax && !tax.ledger_balanced) {
    alerts.push({ level: "critical", message: "Journal is out of balance — the tax position cannot be trusted." });
  }

  if (balances.receivable > 0 && balances.cash <= 0) {
    alerts.push({
      level: "warning",
      message: `Receivables of ${formatCurrency(balances.receivable, currency)} are outstanding with no cash on hand.`,
    });
  }

  return alerts;
}

// ── Renderers ───────────────────────────────────────────────────────────────

const ALERT_ICON: Record<DigestAlert["level"], string> = {
  info: "ℹ",
  warning: "⚠",
  critical: "🔴",
};

function formatDateRange(from: string, to: string): string {
  return from === to ? from : `${from} → ${to}`;
}

/**
 * Render for WhatsApp: plain text with `*bold*` markup, which is the only
 * formatting the Cloud API text message understands.
 */
export function renderDigestText(digest: DailyDigest): string {
  const currency = digest.store.currency || "USD";
  const money = (n: number) => formatCurrency(n, currency);
  const lines: string[] = [];

  lines.push(`*${digest.store.name} — daily digest*`);
  lines.push(formatDateRange(digest.period.from, digest.period.to));
  lines.push("");

  lines.push(`Revenue: *${money(digest.headline.revenue)}*`);
  lines.push(
    `Net profit: *${money(digest.headline.net_profit)}* (${formatPercent(digest.headline.net_margin)})`,
  );
  lines.push(`Orders: *${digest.headline.orders}* · AOV ${money(digest.headline.aov)}`);
  lines.push("");

  lines.push("*Balances*");
  lines.push(`Cash: ${money(digest.balances.cash)}`);
  lines.push(`Receivable: ${money(digest.balances.receivable)}`);
  lines.push(`Tax payable (2100): ${money(digest.balances.tax_payable)}`);
  lines.push("");

  if (digest.top_products.length > 0) {
    lines.push("*Top products*");
    for (const p of digest.top_products) {
      lines.push(`${p.name} — ${p.units} sold, ${money(p.revenue)}`);
    }
    lines.push("");
  }

  if (digest.credit.outstanding > 0 || digest.credit.blocked_customers > 0) {
    lines.push("*Credit*");
    lines.push(`Outstanding: ${money(digest.credit.outstanding)} · Overdue: ${money(digest.credit.overdue)}`);
    for (const c of digest.credit.top_customers) {
      lines.push(`${c.customer_name} — ${money(c.outstanding)} (${c.status})`);
    }
    lines.push("");
  }

  if (digest.alerts.length > 0) {
    lines.push("*Alerts*");
    for (const a of digest.alerts) {
      lines.push(`${ALERT_ICON[a.level]} ${a.message}`);
    }
    lines.push("");
  }

  if (digest.is_empty) {
    lines.push("No orders and no alerts today.");
  }

  lines.push(`_Sent ${digest.generated_at.slice(0, 16).replace("T", " ")} UTC_`);
  return lines.join("\n");
}

/**
 * Render for Telegram with HTML parse mode. The same facts, plus bold headings,
 * because Telegram's client displays it far more readably than WhatsApp's plain
 * text and users read it on a lock screen.
 */
export function renderDigestHtml(digest: DailyDigest): string {
  const currency = digest.store.currency || "USD";
  const money = (n: number) => formatCurrency(n, currency);
  const e = escapeHtml;
  const lines: string[] = [];

  lines.push(`<b>${e(digest.store.name)} — daily digest</b>`);
  lines.push(e(formatDateRange(digest.period.from, digest.period.to)));
  lines.push("");

  lines.push(`Revenue: <b>${e(money(digest.headline.revenue))}</b>`);
  lines.push(
    `Net profit: <b>${e(money(digest.headline.net_profit))}</b> (${e(formatPercent(digest.headline.net_margin))})`,
  );
  lines.push(`Orders: <b>${digest.headline.orders}</b> · AOV ${e(money(digest.headline.aov))}`);
  lines.push("");

  lines.push("<b>Balances</b>");
  lines.push(`Cash: ${e(money(digest.balances.cash))}`);
  lines.push(`Receivable: ${e(money(digest.balances.receivable))}`);
  lines.push(`Tax payable (2100): ${e(money(digest.balances.tax_payable))}`);

  if (digest.top_products.length > 0) {
    lines.push("");
    lines.push("<b>Top products</b>");
    for (const p of digest.top_products) {
      lines.push(`${e(p.name)} — ${p.units} sold, ${e(money(p.revenue))}`);
    }
  }

  if (digest.credit.outstanding > 0 || digest.credit.blocked_customers > 0) {
    lines.push("");
    lines.push("<b>Credit</b>");
    lines.push(
      `Outstanding: ${e(money(digest.credit.outstanding))} · Overdue: ${e(money(digest.credit.overdue))}`,
    );
    for (const c of digest.credit.top_customers) {
      lines.push(`${e(c.customer_name)} — ${e(money(c.outstanding))} (${e(c.status)})`);
    }
  }

  if (digest.alerts.length > 0) {
    lines.push("");
    lines.push("<b>Alerts</b>");
    for (const a of digest.alerts) {
      lines.push(`${ALERT_ICON[a.level]} ${e(a.message)}`);
    }
  }

  if (digest.is_empty) {
    lines.push("");
    lines.push("No orders and no alerts today.");
  }

  lines.push("");
  lines.push(`<i>Sent ${e(digest.generated_at.slice(0, 16).replace("T", " "))} UTC</i>`);
  return lines.join("\n");
}

/** Pick the right renderer for a channel. */
export function renderDigest(digest: DailyDigest, channel: DigestChannelId): string {
  return channel === "telegram" ? renderDigestHtml(digest) : renderDigestText(digest);
}
