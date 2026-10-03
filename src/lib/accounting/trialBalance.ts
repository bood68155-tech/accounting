import type { AccountType, JournalEntry } from "@/types";
import { aggregateAccountBalances } from "@/lib/accounting/doubleEntry";
import { round2 } from "@/lib/utils";

/**
 * ── Trial balance ─────────────────────────────────────────────────────────────
 * The classic pre-statement control report: every account's total debits and
 * credits with a net balance, proving Σ debits === Σ credits. It is the same
 * aggregation the double-entry engine already uses (single source of truth), so
 * the trial balance always ties to the ledger.
 *
 * Also exposes a dependency-free CSV serializer for the accountant's export
 * workflow (GnuCash / hledger both ship a trial-balance export in this shape).
 */

export interface TrialBalanceRow {
  account_code: string;
  account_name: string;
  account_type: AccountType;
  debit: number;
  credit: number;
  /** Signed by the account's normal balance (positive = normal direction). */
  balance: number;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  total_debit: number;
  total_credit: number;
  /** True when total debits equal total credits (within rounding). */
  balanced: boolean;
}

/**
 * Build the trial balance over all (or as-of) entries. Zero-movement accounts
 * are dropped; rows are ordered by account code.
 */
export function buildTrialBalance(entries: JournalEntry[], asOf?: string): TrialBalance {
  const inScope = asOf ? entries.filter((e) => e.entry_date <= asOf) : entries;

  const rows: TrialBalanceRow[] = aggregateAccountBalances(inScope)
    .filter((b) => b.debits !== 0 || b.credits !== 0)
    .map((b) => ({
      account_code: b.account_code,
      account_name: b.account_name,
      account_type: b.account_type,
      debit: b.debits,
      credit: b.credits,
      balance: b.balance,
    }));

  const totalDebit = round2(rows.reduce((s, r) => s + r.debit, 0));
  const totalCredit = round2(rows.reduce((s, r) => s + r.credit, 0));

  return {
    rows,
    total_debit: totalDebit,
    total_credit: totalCredit,
    balanced: Math.abs(totalDebit - totalCredit) < 0.005,
  };
}

/** Escape one CSV field (quote when it contains a quote, comma or newline). */
function csvField(value: string | number): string {
  const str = String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** Serialize a trial balance to CSV (header + rows + totals line). */
export function trialBalanceToCsv(trialBalance: TrialBalance): string {
  const header = ["Account Code", "Account Name", "Type", "Debit", "Credit", "Balance"];
  const rows = trialBalance.rows.map((r) => [
    r.account_code,
    r.account_name,
    r.account_type,
    r.debit.toFixed(2),
    r.credit.toFixed(2),
    r.balance.toFixed(2),
  ]);
  const totals = ["", "TOTAL", "", trialBalance.total_debit.toFixed(2), trialBalance.total_credit.toFixed(2), ""];
  return [header, ...rows, totals].map((row) => row.map(csvField).join(",")).join("\r\n");
}
