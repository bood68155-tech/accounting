import type { JournalEntry } from "@/types";
import { aggregateAccountBalances } from "@/lib/accounting/doubleEntry";
import { round2 } from "@/lib/utils";

/**
 * ── Statement of Cash Flows (direct method) ───────────────────────────────────
 * Built from the General Ledger by isolating every journal line that touches
 * the Cash account (1000) — a cash movement is real exactly when a cash line
 * exists, so the statement always reconciles with the balance sheet's cash
 * movement over the same window (opening + net change = closing).
 *
 * Classification follows the standard operating / investing / financing split
 * (Firefly III and GnuCash classify ledger cash by account type the same way):
 *   • sales collected and receivable settlements → operating inflow
 *   • refunds and gateway/operating fees          → operating outflow
 *   • owner capital & drawings                    → financing
 *
 * The e-commerce chart of accounts has no fixed-asset accounts yet, so the
 * investing section is present but empty — honest about what the ledger holds.
 */

/** The Cash account code in the chart of accounts. */
export const CASH_ACCOUNT_CODE = "1000";

/** Owner's equity account code — a cash line against it is a financing flow. */
const OWNER_EQUITY_CODE = "3000";

export type CashFlowCategory = "operating" | "investing" | "financing";

export interface CashFlowLine {
  key: string;
  label: string;
  /** Signed amount: positive = cash in, negative = cash out. */
  amount: number;
  category: CashFlowCategory;
}

export interface CashFlowSection {
  lines: CashFlowLine[];
  net: number;
}

export interface CashFlowStatement {
  period: { from: string; to: string };
  operating: CashFlowSection;
  investing: CashFlowSection;
  financing: CashFlowSection;
  /** Net change in cash across the period (Σ cash movements). */
  net_change: number;
  opening_cash: number;
  closing_cash: number;
  /** True when closing_cash === opening_cash + net_change (within rounding). */
  reconciles: boolean;
}

/** Net movement of the cash account inside a set of entries (debit − credit). */
function cashDelta(entry: JournalEntry): number {
  let delta = 0;
  for (const l of entry.lines) {
    if (l.account_code !== CASH_ACCOUNT_CODE) continue;
    delta += l.debit - l.credit;
  }
  return round2(delta);
}

/** Cash balance (debit-normal) across a set of entries. */
function cashBalance(entries: JournalEntry[]): number {
  const balance = aggregateAccountBalances(entries).find(
    (b) => b.account_code === CASH_ACCOUNT_CODE,
  );
  return round2(balance?.balance ?? 0);
}

/**
 * Classify one entry's cash movement into a cash-flow line. The rule cascade
 * mirrors the AI categorizer's auditable-cascade idea: source → sign →
 * counterpart account.
 */
function classify(entry: JournalEntry): { key: string; label: string; category: CashFlowCategory } {
  const touchesOwnerEquity = entry.lines.some((l) => l.account_code === OWNER_EQUITY_CODE);
  if (touchesOwnerEquity) {
    return { key: "owner", label: "Owner capital & drawings", category: "financing" };
  }

  switch (entry.source) {
    case "refund":
      return { key: "refunds", label: "Refunds paid to customers", category: "operating" };
    case "order":
      return { key: "sales", label: "Cash collected from customers", category: "operating" };
    case "fee":
      // A payment-collection entry is a positive cash movement (settling AR);
      // a negative one is a genuine outflow (gateway / operating fee).
      return cashDelta(entry) >= 0
        ? {
            key: "receivable_collections",
            label: "Collections on outstanding receivables",
            category: "operating",
          }
        : { key: "fees_paid", label: "Gateway & operating fees paid", category: "operating" };
    case "adjustment":
      return { key: "adjustments", label: "Manual adjustments", category: "operating" };
    default:
      return { key: "manual", label: "Manual entries", category: "operating" };
  }
}

function buildSection(lines: CashFlowLine[], category: CashFlowCategory): CashFlowSection {
  const mine = lines.filter((l) => l.category === category);
  return { lines: mine, net: round2(mine.reduce((s, l) => s + l.amount, 0)) };
}

/**
 * Build the cash flow statement for a period. When `from`/`to` are omitted the
 * period spans every entry (opening cash is then zero by definition).
 */
export function buildCashFlowStatement(
  entries: JournalEntry[],
  from?: string,
  to?: string,
): CashFlowStatement {
  const dates = entries.map((e) => e.entry_date).sort();
  const fromDate = from ?? dates[0] ?? new Date().toISOString().slice(0, 10);
  const toDate = to ?? dates[dates.length - 1] ?? fromDate;

  const openingEntries = entries.filter((e) => e.entry_date < fromDate);
  const periodEntries = entries.filter((e) => e.entry_date >= fromDate && e.entry_date <= toDate);

  const openingCash = cashBalance(openingEntries);

  // Group every cash movement in the period into a line by classification.
  const byKey = new Map<string, CashFlowLine>();
  for (const entry of periodEntries) {
    const delta = cashDelta(entry);
    if (delta === 0) continue;
    const { key, label, category } = classify(entry);
    const existing = byKey.get(key);
    if (existing) existing.amount = round2(existing.amount + delta);
    else byKey.set(key, { key, label, amount: delta, category });
  }

  const lines = [...byKey.values()].sort((a, b) =>
    a.category === b.category ? a.label.localeCompare(b.label) : a.category.localeCompare(b.category),
  );

  const operating = buildSection(lines, "operating");
  const investing = buildSection(lines, "investing");
  const financing = buildSection(lines, "financing");
  const netChange = round2(operating.net + investing.net + financing.net);

  const closingCash = cashBalance(entries.filter((e) => e.entry_date <= toDate));

  return {
    period: { from: fromDate, to: toDate },
    operating,
    investing,
    financing,
    net_change: netChange,
    opening_cash: openingCash,
    closing_cash: closingCash,
    reconciles: Math.abs(closingCash - (openingCash + netChange)) < 0.005,
  };
}

/** Flat rows for rendering the statement (sections + reconciliation). */
export function cashFlowRows(statement: CashFlowStatement): CashFlowLine[] {
  return [
    ...statement.operating.lines,
    {
      key: "operating-net",
      label: "Net cash from operating activities",
      amount: statement.operating.net,
      category: "operating",
    },
    ...statement.investing.lines,
    {
      key: "investing-net",
      label: "Net cash from investing activities",
      amount: statement.investing.net,
      category: "investing",
    },
    ...statement.financing.lines,
    {
      key: "financing-net",
      label: "Net cash from financing activities",
      amount: statement.financing.net,
      category: "financing",
    },
    {
      key: "net-change",
      label: "Net change in cash",
      amount: statement.net_change,
      category: "operating",
    },
  ];
}
