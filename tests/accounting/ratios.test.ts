import { describe, expect, it } from "vitest";
import { computeFinancialRatios, formatRatio } from "@/lib/accounting/ratios";
import type { BalanceSheet, IncomeStatement } from "@/types";

const BALANCE_SHEET: BalanceSheet = {
  as_of: "2026-01-31",
  assets: {
    cash: 1000,
    accounts_receivable: 200,
    inventory: 300,
    current_assets: 1500,
    total_assets: 1500,
  },
  liabilities: {
    accounts_payable: 100,
    sales_tax_payable: 50,
    current_liabilities: 150,
    total_liabilities: 150,
  },
  equity: {
    owners_equity: 500,
    retained_earnings: 850,
    total_equity: 1350,
  },
  total_liabilities_and_equity: 1500,
  balances: true,
};

const INCOME_STATEMENT: IncomeStatement = {
  period: { from: "2026-01-01", to: "2026-01-31" },
  revenue: { sales: 1000, shipping: 0, discounts: 0, refunds: 0, net_revenue: 1000 },
  cogs: 600,
  gross_profit: 400,
  gross_margin: 0.4,
  operating_expenses: {
    payment_fees: 100,
    shipping_cost: 150,
    marketing: 0,
    software: 0,
    other: 0,
    total: 250,
  },
  net_profit: 150,
  net_margin: 0.15,
};

describe("computeFinancialRatios", () => {
  const health = computeFinancialRatios(BALANCE_SHEET, INCOME_STATEMENT, { periodDays: 30 });
  const byKey = new Map(health.ratios.map((r) => [r.key, r]));

  it("computes liquidity ratios", () => {
    expect(byKey.get("current_ratio")?.value).toBe(10);
    expect(byKey.get("current_ratio")?.status).toBe("strong");
    // (cash 1000 + AR 200) / 150 = 8
    expect(byKey.get("quick_ratio")?.value).toBe(8);
    expect(health.working_capital).toBe(1350);
  });

  it("computes profitability ratios", () => {
    expect(byKey.get("gross_margin")?.value).toBe(0.4);
    expect(byKey.get("net_margin")?.value).toBe(0.15);
    // 150 / 1350 = 0.111…
    expect(byKey.get("return_on_equity")?.value).toBeCloseTo(0.11, 2);
  });

  it("computes the cash conversion cycle (DIO + DSO − DPO)", () => {
    expect(byKey.get("dio_days")?.value).toBe(15); // 300 / 600 × 30
    expect(byKey.get("dso_days")?.value).toBe(6); // 200 / 1000 × 30
    expect(byKey.get("dpo_days")?.value).toBe(5); // 100 / 600 × 30
    expect(health.cash_conversion_cycle_days).toBe(16);
    // Paying suppliers in 5 days is the weakest link.
    expect(byKey.get("dpo_days")?.status).toBe("risk");
  });

  it("produces a composite score and grade", () => {
    expect(health.score).toBeGreaterThanOrEqual(85);
    expect(health.grade).toBe("A");
  });

  it("returns null (n/a) instead of dividing by zero", () => {
    const noLiabilities: BalanceSheet = {
      ...BALANCE_SHEET,
      liabilities: {
        accounts_payable: 0,
        sales_tax_payable: 0,
        current_liabilities: 0,
        total_liabilities: 0,
      },
    };
    const result = computeFinancialRatios(noLiabilities, INCOME_STATEMENT);
    const current = result.ratios.find((r) => r.key === "current_ratio");
    expect(current?.value).toBeNull();
    expect(current?.status).toBe("n/a");
  });

  it("formats ratios by kind", () => {
    expect(formatRatio(byKey.get("current_ratio")!)).toBe("10.00×");
    expect(formatRatio(byKey.get("net_margin")!)).toBe("15.0%");
    expect(formatRatio(byKey.get("dso_days")!)).toBe("6.0d");
    expect(formatRatio({ ...byKey.get("current_ratio")!, value: null })).toBe("—");
  });
});
