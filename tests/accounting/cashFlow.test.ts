import { describe, expect, it } from "vitest";
import { buildCashFlowStatement } from "@/lib/accounting/cashFlow";
import type { AccountType, EntrySource, JournalEntry, JournalLine } from "@/types";

function line(
  account_code: string,
  account_name: string,
  account_type: AccountType,
  debit: number,
  credit: number,
): JournalLine {
  return { account_code, account_name, account_type, description: "", debit, credit };
}

function entry(
  entry_number: number,
  entry_date: string,
  source: EntrySource,
  lines: JournalLine[],
): JournalEntry {
  return {
    store_id: "store-1",
    entry_number,
    entry_date,
    description: `entry ${entry_number}`,
    reference: `ref-${entry_number}`,
    source,
    status: "posted",
    lines,
  };
}

// A realistic mini-ledger:
//   #1 sale    → Dr Cash 90, Dr Fees 10, Cr Sales 100      (+90 cash)
//   #2 refund  → Dr Refunds 20, Cr Cash 20                 (−20 cash)
//   #3 fee     → Dr Fees 5,  Cr Cash 5                     (−5 cash)
//   #4 owner   → Dr Cash 500, Cr Owner's Equity 500        (+500 cash)
const SALE = entry(1, "2026-01-05", "order", [
  line("1000", "Cash", "asset", 90, 0),
  line("5200", "Payment Processing Fees", "expense", 10, 0),
  line("4000", "Sales Revenue", "revenue", 0, 100),
]);
const REFUND = entry(2, "2026-01-10", "refund", [
  line("4500", "Refunds Given", "revenue", 20, 0),
  line("1000", "Cash", "asset", 0, 20),
]);
const FEE = entry(3, "2026-01-12", "fee", [
  line("5200", "Payment Processing Fees", "expense", 5, 0),
  line("1000", "Cash", "asset", 0, 5),
]);
const OWNER = entry(4, "2026-01-15", "manual", [
  line("1000", "Cash", "asset", 500, 0),
  line("3000", "Owner's Equity", "equity", 0, 500),
]);

const LEDGER = [SALE, REFUND, FEE, OWNER];

describe("buildCashFlowStatement", () => {
  it("classifies cash movements and reconciles opening + net change = closing", () => {
    const statement = buildCashFlowStatement(LEDGER);

    // Operating: +90 sales, −20 refunds, −5 fees = 65.
    expect(statement.operating.net).toBe(65);
    expect(statement.operating.lines.map((l) => l.key).sort()).toEqual([
      "fees_paid",
      "refunds",
      "sales",
    ]);

    // Owner capital is a financing flow, not operating.
    expect(statement.financing.net).toBe(500);
    expect(statement.financing.lines[0]?.key).toBe("owner");

    // No fixed assets in the chart of accounts yet → investing is empty.
    expect(statement.investing.net).toBe(0);

    expect(statement.net_change).toBe(565);
    expect(statement.opening_cash).toBe(0);
    expect(statement.closing_cash).toBe(565);
    expect(statement.reconciles).toBe(true);
  });

  it("slices the period and carries opening cash forward", () => {
    const statement = buildCashFlowStatement(LEDGER, "2026-01-10");

    // Only the sale pre-dates the window → opening cash is 90.
    expect(statement.opening_cash).toBe(90);
    // Refund + fee + owner capital = −20 − 5 + 500 = 475.
    expect(statement.net_change).toBe(475);
    expect(statement.closing_cash).toBe(565);
    expect(statement.reconciles).toBe(true);
  });

  it("treats a positive 'fee'-source entry as a receivable collection", () => {
    const collected = entry(5, "2026-01-20", "fee", [
      line("1000", "Cash", "asset", 95, 0),
      line("1100", "Accounts Receivable", "asset", 0, 95),
    ]);
    const statement = buildCashFlowStatement([SALE, collected]);
    const collection = statement.operating.lines.find((l) => l.key === "receivable_collections");
    expect(collection?.amount).toBe(95);
    expect(statement.operating.net).toBe(185);
  });
});
