import { describe, expect, it } from "vitest";
import { buildTrialBalance, trialBalanceToCsv } from "@/lib/accounting/trialBalance";
import type { JournalEntry } from "@/types";

const SALE: JournalEntry = {
  store_id: "store-1",
  entry_number: 1,
  entry_date: "2026-01-05",
  description: "Sale",
  reference: "ref-1",
  source: "order",
  status: "posted",
  lines: [
    { account_code: "1000", account_name: "Cash", account_type: "asset", description: "", debit: 90, credit: 0 },
    { account_code: "5200", account_name: "Payment Processing Fees", account_type: "expense", description: "", debit: 10, credit: 0 },
    { account_code: "4000", account_name: "Sales Revenue", account_type: "revenue", description: "", debit: 0, credit: 100 },
  ],
};

const COGS: JournalEntry = {
  store_id: "store-1",
  entry_number: 2,
  entry_date: "2026-01-06",
  description: "COGS",
  reference: "ref-2",
  source: "order",
  status: "posted",
  lines: [
    { account_code: "5000", account_name: "Cost of Goods Sold", account_type: "expense", description: "", debit: 40, credit: 0 },
    { account_code: "1200", account_name: "Inventory", account_type: "asset", description: "", debit: 0, credit: 40 },
  ],
};

describe("buildTrialBalance", () => {
  it("totals debits and credits and confirms they balance", () => {
    const tb = buildTrialBalance([SALE, COGS]);
    expect(tb.total_debit).toBe(140); // 90 + 10 + 40
    expect(tb.total_credit).toBe(140); // 100 + 40
    expect(tb.balanced).toBe(true);
    expect(tb.rows.map((r) => r.account_code)).toEqual(["1000", "1200", "4000", "5000", "5200"]);
  });

  it("honours the as-of date", () => {
    const tb = buildTrialBalance([SALE, COGS], "2026-01-05");
    expect(tb.rows.map((r) => r.account_code)).not.toContain("5000");
    expect(tb.balanced).toBe(true);
  });

  it("serializes to CSV with a totals line", () => {
    const csv = trialBalanceToCsv(buildTrialBalance([SALE, COGS]));
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Account Code,Account Name,Type,Debit,Credit,Balance");
    expect(lines[lines.length - 1]).toContain("TOTAL");
    expect(csv).toContain("Cost of Goods Sold");
  });
});
