import type { JournalEntry, JournalLine, Order } from "@/types";
import { balanceSide, getAccount } from "@/lib/accounting/chartOfAccounts";
import { computeOrderProfit } from "@/lib/accounting/profitEngine";
import { round2 } from "@/lib/utils";

/**
 * ── Double-entry bookkeeping engine ───────────────────────────────────────────
 * Every transaction is posted as a journal entry where Σ debits === Σ credits.
 * The engine derives entries directly from normalized orders + the profit
 * engine, so the General Ledger always ties to true net profit.
 */

export function line(
  accountCode: string,
  description: string,
  debit = 0,
  credit = 0,
): JournalLine {
  const account = getAccount(accountCode);
  if (!account) throw new Error(`Unknown ledger account code: ${accountCode}`);
  return {
    account_code: account.code,
    account_name: account.name,
    account_type: account.type,
    description,
    debit: round2(debit),
    credit: round2(credit),
  };
}

/** Full (unadjusted) cost of goods for an order: Σ item cost × qty. */
export function fullCogs(order: Order): number {
  return round2(order.items.reduce((sum, item) => sum + item.line_cost, 0));
}

/** Throws unless the entry is balanced (debits === credits). */
export function validateEntry(entry: JournalEntry): JournalEntry {
  const debits = entry.lines.reduce((sum, l) => sum + l.debit, 0);
  const credits = entry.lines.reduce((sum, l) => sum + l.credit, 0);
  const difference = Math.abs(debits - credits);
  if (difference > 0.005) {
    throw new Error(
      `Unbalanced journal entry #${entry.entry_number}: debits ${debits.toFixed(2)} ≠ credits ${credits.toFixed(2)}`,
    );
  }
  return entry;
}

/** Generate the next sequential entry number for a store. */
export function nextEntryNumber(entries: Array<Pick<JournalEntry, "entry_number">>): number {
  const max = entries.reduce((m, e) => Math.max(m, e.entry_number), 0);
  return max + 1;
}

/**
 * Journal entry for a paid order:
 *
 *   Dr  Cash                       total − gateway fee   (net cash in)
 *   Dr  Payment Processing Fees     gateway fee
 *   Dr  Discounts Given             discounts
 *   Cr  Sales Revenue               subtotal
 *   Cr  Shipping Revenue            shipping charged
 *   Cr  Sales Tax Payable           tax collected
 *   Dr  Cost of Goods Sold          Σ unit_cost × qty   (full COGS)
 *   Cr  Inventory                   Σ unit_cost × qty
 */
export function createSaleEntry(order: Order, entryNumber: number): JournalEntry {
  const cogs = fullCogs(order);

  return validateEntry({
    store_id: order.store_id,
    entry_number: entryNumber,
    entry_date: order.ordered_at.slice(0, 10), // journal_entries.entry_date is a date column
    description: `Sale ${order.order_number} — ${order.customer_name}`,
    reference: order.external_id,
    source: "order",
    status: "posted",
    lines: [
      line("1000", `Net proceeds from ${order.order_number}`, order.total_amount - order.payment_fee),
      line("5200", `Payment gateway fee on ${order.order_number}`, order.payment_fee),
      line("4400", `Discounts on ${order.order_number}`, order.discount_amount),
      line("4000", `Product sales ${order.order_number}`, 0, order.subtotal),
      line("4100", `Shipping charged ${order.order_number}`, 0, order.shipping_amount),
      line("2100", `Sales tax collected ${order.order_number}`, 0, order.tax_amount),
      line("5000", `COGS ${order.order_number} (${order.items.length} line items)`, cogs),
      line("1200", `Inventory out for ${order.order_number}`, 0, cogs),
    ],
  });
}

/**
 * Journal entry for a refund — reverses the refunded share of COGS:
 *
 *   Dr  Refunds Given              refund amount
 *   Cr  Cash                       refund amount
 *   Dr  Inventory                  full COGS × refunded share
 *   Cr  Cost of Goods Sold         full COGS × refunded share
 */
export function createRefundEntry(order: Order, refundAmount: number, entryNumber: number): JournalEntry {
  // Cap the share at 1 so an over-refund cannot reverse more COGS than was posted.
  const refundedShare = order.total_amount > 0 ? Math.min(1, refundAmount / order.total_amount) : 0;
  const cogsRefunded = round2(fullCogs(order) * refundedShare);

  return validateEntry({
    store_id: order.store_id,
    entry_number: entryNumber,
    entry_date: new Date().toISOString().slice(0, 10),
    description: `Refund ${order.order_number} — ${order.customer_name}`,
    reference: order.external_id,
    source: "refund",
    status: "posted",
    lines: [
      line("4500", `Refund issued for ${order.order_number}`, refundAmount),
      line("1000", `Cash back to customer ${order.order_number}`, 0, refundAmount),
      line("1200", `Returned inventory ${order.order_number}`, cogsRefunded),
      line("5000", `COGS reversal for returned goods ${order.order_number}`, 0, cogsRefunded),
    ],
  });
}

/**
 * Journal entry for a standalone fee (e.g. a gateway payout fee, app fee,
 * or marketing expense posted manually).
 */
export function createFeeEntry(
  storeId: string,
  entryNumber: number,
  entryDate: string,
  description: string,
  reference: string,
  feeAmount: number,
  accountCode = "5200",
): JournalEntry {
  return validateEntry({
    store_id: storeId,
    entry_number: entryNumber,
    entry_date: entryDate,
    description,
    reference,
    source: "fee",
    status: "posted",
    lines: [
      line(accountCode, description, feeAmount),
      line("1000", `Cash out — ${description}`, 0, feeAmount),
    ],
  });
}

export interface AccountBalance {
  account_code: string;
  account_name: string;
  account_type: JournalLine["account_type"];
  debits: number;
  credits: number;
  /** Signed by normal balance: positive = net normal-direction balance. */
  balance: number;
}

/** Aggregate journal lines into per-account balances (the General Ledger). */
export function aggregateAccountBalances(entries: JournalEntry[]): AccountBalance[] {
  const map = new Map<string, AccountBalance>();

  for (const entry of entries) {
    for (const l of entry.lines) {
      if (l.debit === 0 && l.credit === 0) continue;
      const existing = map.get(l.account_code);
      if (existing) {
        existing.debits = round2(existing.debits + l.debit);
        existing.credits = round2(existing.credits + l.credit);
      } else {
        map.set(l.account_code, {
          account_code: l.account_code,
          account_name: l.account_name,
          account_type: l.account_type,
          debits: round2(l.debit),
          credits: round2(l.credit),
          balance: 0,
        });
      }
    }
  }

  const result = Array.from(map.values());
  for (const account of result) {
    // Sign by the account's normal balance (debit-normal → debits − credits).
    // Contra-revenue accounts (4400/4500) are revenue-typed but debit-normal,
    // so we prefer the chart of accounts over the type.
    const normal = getAccount(account.account_code)?.normal_balance ?? balanceSide(account.account_type);
    account.balance =
      normal === "debit"
        ? round2(account.debits - account.credits)
        : round2(account.credits - account.debits);
  }

  return result.sort((a, b) => a.account_code.localeCompare(b.account_code));
}

export function entriesTotalDebits(entries: JournalEntry[]): number {
  return round2(entries.reduce((s, e) => s + e.lines.reduce((x, l) => x + l.debit, 0), 0));
}

export function entriesTotalCredits(entries: JournalEntry[]): number {
  return round2(entries.reduce((s, e) => s + e.lines.reduce((x, l) => x + l.credit, 0), 0));
}

// Re-exported for callers that need the profit engine's refund-adjusted COGS.
export { computeOrderProfit };
