import type { BalanceSheet, JournalEntry } from "@/types";
import { aggregateAccountBalances, type AccountBalance } from "@/lib/accounting/doubleEntry";
import { round2 } from "@/lib/utils";

/**
 * ── Balance Sheet ─────────────────────────────────────────────────────────────
 * Derived entirely from the General Ledger: every account balance is the sum of
 * its journal lines signed by normal balance, as of a date. Equity closes with
 * Retained Earnings — the cumulative net profit the ledger has produced — so the
 * accounting identity (Assets = Liabilities + Equity) always holds by
 * construction: every journal entry that moves an asset also moves a liability,
 * equity, or P&L account, and net profit flows into retained earnings.
 */

/** The period-of-record cumulative profit: revenue − contra-revenue − expenses. */
export function retainedEarnings(entries: JournalEntry[]): number {
  const balances = aggregateAccountBalances(entries);
  const byCode = new Map(balances.map((b) => [b.account_code, b]));
  const revenue = sumBalances(byCode, ["4000", "4100", "4200"]);
  const contra = sumBalances(byCode, ["4400", "4500"]);
  const expenses = sumBalances(byCode, ["5000", "5100", "5200", "5300", "5400", "5900"]);
  return round2(revenue - contra - expenses);
}

/** Sum normal-direction balances for a set of account codes. */
function sumBalances(byCode: Map<string, AccountBalance>, codes: string[]): number {
  let total = 0;
  for (const code of codes) {
    const balance = byCode.get(code);
    if (!balance) continue;
    total += balance.balance;
  }
  return round2(total);
}

export function buildBalanceSheet(entries: JournalEntry[], asOf?: string): BalanceSheet {
  // As-of date is inclusive: entries dated after the cutoff are excluded.
  const inScope = asOf ? entries.filter((e) => e.entry_date <= asOf) : entries;
  const balances = aggregateAccountBalances(inScope);
  const byCode = new Map(balances.map((b) => [b.account_code, b]));
  const pick = (code: string) => byCode.get(code)?.balance ?? 0;

  const cash = pick("1000");
  const accountsReceivable = pick("1100");
  const inventory = pick("1200");

  const currentAssets = round2(cash + accountsReceivable + inventory);
  const totalAssets = currentAssets; // no fixed-asset accounts yet (1xxx code range)

  const accountsPayable = pick("2000");
  const salesTaxPayable = pick("2100");

  const currentLiabilities = round2(accountsPayable + salesTaxPayable);
  const totalLiabilities = currentLiabilities;

  const ownerEquity = pick("3000");
  const retained = retainedEarnings(inScope);
  const totalEquity = round2(ownerEquity + retained);

  return {
    as_of: asOf ?? inScope[inScope.length - 1]?.entry_date ?? new Date().toISOString().slice(0, 10),
    assets: {
      cash,
      accounts_receivable: accountsReceivable,
      inventory,
      current_assets: currentAssets,
      total_assets: totalAssets,
    },
    liabilities: {
      accounts_payable: accountsPayable,
      sales_tax_payable: salesTaxPayable,
      current_liabilities: currentLiabilities,
      total_liabilities: totalLiabilities,
    },
    equity: {
      owners_equity: ownerEquity,
      retained_earnings: retained,
      total_equity: totalEquity,
    },
    total_liabilities_and_equity: round2(totalLiabilities + totalEquity),
    balances: Math.abs(round2(totalAssets - totalLiabilities - totalEquity)) < 0.005,
  };
}

/** Ordered rows for rendering a two-section balance sheet view. */
export function balanceSheetRows(sheet: BalanceSheet): Array<{
  key: string;
  label: string;
  value: number;
  kind: "line" | "subtotal" | "total";
  section: "assets" | "liabilities" | "equity";
}> {
  return [
    { key: "cash", label: "Cash", value: sheet.assets.cash, kind: "line", section: "assets" },
    {
      key: "ar",
      label: "Accounts Receivable",
      value: sheet.assets.accounts_receivable,
      kind: "line",
      section: "assets",
    },
    {
      key: "inventory",
      label: "Inventory",
      value: sheet.assets.inventory,
      kind: "line",
      section: "assets",
    },
    {
      key: "total-assets",
      label: "Total Assets",
      value: sheet.assets.total_assets,
      kind: "total",
      section: "assets",
    },
    {
      key: "ap",
      label: "Accounts Payable",
      value: sheet.liabilities.accounts_payable,
      kind: "line",
      section: "liabilities",
    },
    {
      key: "tax-payable",
      label: "Sales Tax Payable",
      value: sheet.liabilities.sales_tax_payable,
      kind: "line",
      section: "liabilities",
    },
    {
      key: "total-liabilities",
      label: "Total Liabilities",
      value: sheet.liabilities.total_liabilities,
      kind: "total",
      section: "liabilities",
    },
    {
      key: "owners-equity",
      label: "Owner's Equity",
      value: sheet.equity.owners_equity,
      kind: "line",
      section: "equity",
    },
    {
      key: "retained",
      label: "Retained Earnings",
      value: sheet.equity.retained_earnings,
      kind: "line",
      section: "equity",
    },
    {
      key: "total-equity",
      label: "Total Equity",
      value: sheet.equity.total_equity,
      kind: "total",
      section: "equity",
    },
    {
      key: "total-l-and-e",
      label: "Total Liabilities & Equity",
      value: sheet.total_liabilities_and_equity,
      kind: "total",
      section: "equity",
    },
  ];
}
