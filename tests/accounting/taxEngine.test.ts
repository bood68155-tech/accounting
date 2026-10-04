import { describe, expect, it } from "vitest";
import {
  buildTaxPeriodReport,
  buildVatReturn,
  computeOrderTax,
  effectiveRate,
  classifyTaxMovement,
  SALES_TAX_ACCOUNT,
  taxConfigFor,
  taxFromExclusive,
  taxFromInclusive,
  getTaxRatePreset,
  DEFAULT_TAX_CONFIG,
} from "@/lib/accounting/taxEngine";
import { round2 } from "@/lib/utils";
import type { JournalEntry, JournalLine, Order } from "@/types";

const line = (
  account_code: string,
  account_name: string,
  account_type: JournalLine["account_type"],
  debit = 0,
  credit = 0,
  description = "",
): JournalLine => ({ account_code, account_name, account_type, description, debit, credit });

const entry = (
  entry_number: number,
  entry_date: string,
  lines: JournalLine[],
  source: JournalEntry["source"] = "order",
): JournalEntry => ({
  store_id: "store-1",
  entry_number,
  entry_date,
  description: `Entry ${entry_number}`,
  reference: `ref-${entry_number}`,
  source,
  status: "posted",
  lines,
});

const order = (over: Partial<Order> = {}): Order => ({
  store_id: "store-1",
  external_id: "ext-1",
  order_number: "ORD-1",
  customer_name: "Ada",
  currency: "USD",
  subtotal: 100,
  shipping_amount: 10,
  discount_amount: 0,
  tax_amount: 0,
  total_amount: 110,
  payment_gateway: "stripe",
  payment_fee: 3,
  shipping_cost: 5,
  refund_amount: 0,
  status: "paid",
  ordered_at: "2026-01-05T10:00:00.000Z",
  items: [
    {
      sku: "A1",
      name: "Widget",
      quantity: 1,
      unit_price: 100,
      unit_cost: 40,
      line_subtotal: 100,
      line_cost: 40,
    },
  ],
  ...over,
});

const EXCLUSIVE = taxConfigFor("uk-vat", { prices_include_tax: false });

describe("tax math", () => {
  it("adds tax on top of a tax-exclusive amount", () => {
    const r = taxFromExclusive(100, 0.2);
    expect(r.net).toBe(100);
    expect(r.tax).toBe(20);
    expect(r.gross).toBe(120);
    expect(r.inclusive).toBe(false);
  });

  it("extracts tax from a tax-inclusive amount so the split adds back to the cent", () => {
    const r = taxFromInclusive(120, 0.2);
    expect(r.net).toBe(100);
    expect(r.tax).toBe(20);
    expect(round2(r.net + r.tax)).toBe(r.gross);
  });

  it("keeps inclusive extraction exact on amounts that do not divide evenly", () => {
    // 19.99 @ 19% is the classic rounding trap: rounding the base first and
    // taking the tax as the remainder keeps the split exact.
    const r = taxFromInclusive(19.99, 0.19);
    expect(round2(r.net + r.tax)).toBe(19.99);
    expect(r.net).toBe(16.8);
    expect(r.tax).toBe(3.19);
  });

  it("resolves the effective rate from a preset, and rejects an out-of-range override", () => {
    expect(effectiveRate(taxConfigFor("uk-vat"))).toBe(0.2);
    expect(effectiveRate(taxConfigFor("sa-vat"))).toBe(0.15);
    expect(effectiveRate(taxConfigFor("us-ca"))).toBe(0.0725);
    expect(effectiveRate({ ...DEFAULT_TAX_CONFIG, rate: 0.05 })).toBe(0.05);
    expect(getTaxRatePreset("de-vat")?.prices_include_tax).toBe(true);
    expect(() => effectiveRate({ ...DEFAULT_TAX_CONFIG, rate: 1.5 })).toThrow(/\[0, 1\)/);
    expect(() => taxConfigFor("nope")).toThrow(/Unknown tax rate preset/);
  });

  it("never infers shipping_taxable from prices_include_tax", () => {
    // UK VAT is a tax-inclusive regime but says nothing about carrier charges.
    expect(taxConfigFor("uk-vat").shipping_taxable).toBe(false);
    expect(taxConfigFor("uk-vat", { shipping_taxable: true }).shipping_taxable).toBe(true);
  });
});

describe("computeOrderTax", () => {
  it("recomputes tax on the net goods base for a tax-exclusive order", () => {
    const r = computeOrderTax(order({ tax_amount: 0, total_amount: 110 }), EXCLUSIVE);
    // Shipping is not taxable by default, so the base is the goods only.
    expect(r.taxable_base).toBe(100);
    expect(r.expected_tax).toBe(20);
    expect(r.reconciled).toBe(false); // the order recorded 0 tax
    expect(r.variance).toBe(-20);
  });

  it("flags a clean exclusive order as reconciled", () => {
    const r = computeOrderTax(order({ tax_amount: 20, total_amount: 130 }), EXCLUSIVE);
    expect(r.expected_tax).toBe(20);
    expect(r.variance).toBe(0);
    expect(r.total_variance).toBe(0);
    expect(r.reconciled).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("splits a tax-inclusive order back out to net + tax", () => {
    // Provider reports 120 gross for goods at 20% inclusive VAT.
    const r = computeOrderTax(
      order({ subtotal: 120, shipping_amount: 0, tax_amount: 20, total_amount: 120 }),
      EXCLUSIVE,
      { basis: "gross" },
    );
    expect(r.taxable_base).toBe(120);
    expect(r.expected_tax).toBe(20);
    expect(r.reconciled).toBe(true);
  });

  it("detects an inclusive/exclusive mix-up by disagreeing on the same order", () => {
    const incl = order({ subtotal: 120, shipping_amount: 0, tax_amount: 20, total_amount: 120 });
    // Read as a net order the engine expects 120 + 24 tax = 144, not 120.
    const r = computeOrderTax(incl, EXCLUSIVE);
    expect(r.expected_tax).toBe(24);
    expect(r.reconciled).toBe(false);
    expect(r.issues.join(" ")).toMatch(/Tax mismatch/);
    expect(r.issues.join(" ")).toMatch(/tax basis: net/);
  });

  it("includes shipping in the base when the store taxes shipping", () => {
    const r = computeOrderTax(
      order({ tax_amount: 22, total_amount: 132 }),
      taxConfigFor("uk-vat", { prices_include_tax: false, shipping_taxable: true }),
    );
    expect(r.taxable_base).toBe(110);
    expect(r.expected_tax).toBe(22);
    expect(r.reconciled).toBe(true);
  });

  it("sums per-component rates for a mixed-rate basket", () => {
    const r = computeOrderTax(
      order({ tax_amount: 15, total_amount: 125 }),
      EXCLUSIVE,
      { components: [
        { amount: 50, rate: 0.2 }, // 10
        { amount: 50, rate: 0.1 }, // 5
      ] },
    );
    expect(r.expected_tax).toBe(15);
    expect(r.reconciled).toBe(true);
  });

  it("assesses no tax on an over-discounted order but still flags it", () => {
    const r = computeOrderTax(
      order({ subtotal: 50, discount_amount: 80, tax_amount: 0, total_amount: 0 }),
      EXCLUSIVE,
    );
    expect(r.raw_base).toBe(-30);
    expect(r.taxable_base).toBe(0);
    expect(r.expected_tax).toBe(0);
    expect(r.reconciled).toBe(false);
    expect(r.issues.join(" ")).toMatch(/no tax assessed/);
  });
});

describe("Account 2100 classification", () => {
  it("classifies a sale as collected and a remittance as paid", () => {
    const sale = entry(1, "2026-01-05", [
      line("1000", "Cash", "asset", 110),
      line(SALES_TAX_ACCOUNT, "Sales Tax Payable", "liability", 0, 10),
      line("4000", "Sales Revenue", "revenue", 0, 100),
    ]);
    const remittance = entry(2, "2026-01-20", [
      line(SALES_TAX_ACCOUNT, "Sales Tax Payable", "liability", 10),
      line("1000", "Cash", "asset", 0, 10),
    ], "manual");

    expect(classifyTaxMovement(sale)[0].kind).toBe("collected");
    expect(classifyTaxMovement(sale)[0].amount).toBe(10);
    expect(classifyTaxMovement(remittance)[0].kind).toBe("paid");
    expect(classifyTaxMovement(remittance)[0].amount).toBe(-10);
  });

  it("classifies a credit sale against receivable as collected", () => {
    const creditSale = entry(5, "2026-01-06", [
      line("1100", "Accounts Receivable", "asset", 120),
      line(SALES_TAX_ACCOUNT, "Sales Tax Payable", "liability", 0, 20),
      line("4000", "Sales Revenue", "revenue", 0, 100),
    ]);
    expect(classifyTaxMovement(creditSale)[0].kind).toBe("collected");
  });

  it("prefers 'reversed' over 'paid' for a refund that also touches cash", () => {
    // A refund debits 2100 AND credits cash. Testing cash first would report
    // this as a tax remittance and erase tax the store genuinely still owes.
    const refund = entry(3, "2026-01-07", [
      line(SALES_TAX_ACCOUNT, "Sales Tax Payable", "liability", 10),
      line("4500", "Refunds Given", "revenue", 0, 110),
      line("1000", "Cash", "asset", 0, 110),
    ], "refund");
    const noTax = entry(4, "2026-01-08", [
      line("1000", "Cash", "asset", 5),
      line("4000", "Sales Revenue", "revenue", 0, 5),
    ]);

    expect(classifyTaxMovement(refund)[0].kind).toBe("reversed");
    expect(classifyTaxMovement(refund)[0].amount).toBe(-10);
    expect(classifyTaxMovement(noTax)).toEqual([]);
  });

  it("falls back to 'adjustment' for an unrecognised 2100 pairing", () => {
    const odd = entry(6, "2026-01-08", [
      line(SALES_TAX_ACCOUNT, "Sales Tax Payable", "liability", 5),
      line("2000", "Accounts Payable", "liability", 0, 5),
    ], "adjustment");
    expect(classifyTaxMovement(odd)[0].kind).toBe("adjustment");
  });
});

describe("buildTaxPeriodReport", () => {
  const saleA = entry(1, "2026-01-05", [
    line("1000", "Cash", "asset", 110),
    line("2100", "Sales Tax Payable", "liability", 0, 10),
    line("4000", "Sales Revenue", "revenue", 0, 100),
  ]);
  const saleB = entry(2, "2026-02-05", [
    line("1100", "Accounts Receivable", "asset", 220),
    line("2100", "Sales Tax Payable", "liability", 0, 20),
    line("4000", "Sales Revenue", "revenue", 0, 200),
  ]);
  const refundA = entry(3, "2026-01-09", [
    line("2100", "Sales Tax Payable", "liability", 4),
    line("4500", "Refunds Given", "revenue", 44),
    line("1000", "Cash", "asset", 0, 48),
  ], "refund");
  const remit = entry(4, "2026-01-31", [
    line("2100", "Sales Tax Payable", "liability", 6),
    line("1000", "Cash", "asset", 0, 6),
  ], "manual");

  const all = [saleA, saleB, refundA, remit];

  it("splits collected / reversed / paid and nets the period liability", () => {
    const r = buildTaxPeriodReport(all, EXCLUSIVE, { from: "2026-01-01", to: "2026-01-31" });
    expect(r.tax_collected).toBe(10);
    expect(r.tax_reversed).toBe(4);
    expect(r.tax_paid).toBe(6);
    expect(r.net_tax_payable).toBe(0); // 10 - 4 - 6
    expect(r.net_sales).toBe(56); // 100 revenue - 44 refunds
    expect(r.movement_counts).toEqual({ collected: 1, reversed: 1, paid: 1, adjustment: 0 });
    expect(r.ledger_balanced).toBe(true);
  });

  it("reports the all-time 2100 balance, which must include later periods", () => {
    const r = buildTaxPeriodReport(all, EXCLUSIVE, { from: "2026-01-01", to: "2026-01-31" });
    // All-time: 10 + 20 collected - 4 reversed - 6 paid = 20
    expect(r.account_balance).toBe(20);
  });

  it("ignores entries outside the period", () => {
    const r = buildTaxPeriodReport(all, EXCLUSIVE, { from: "2026-01-01", to: "2026-01-31" });
    expect(r.tax_collected).toBe(10); // saleB (Feb) excluded
    expect(r.movements.every((m) => m.entry_date <= "2026-01-31")).toBe(true);
  });

  it("grosses an inclusive base up to the tax-exclusive amount", () => {
    const r = buildTaxPeriodReport(
      [saleA],
      taxConfigFor("uk-vat", { prices_include_tax: true }),
      { from: "2026-01-01", to: "2026-01-31" },
    );
    // 100 recorded revenue is treated as tax-inclusive → base = 100 / 1.2
    expect(r.taxable_base).toBe(83.33);
  });

  it("omits the per-rate bucket entirely at a 0% rate with no movements", () => {
    const r = buildTaxPeriodReport([], DEFAULT_TAX_CONFIG, { from: "2026-01-01", to: "2026-01-31" });
    expect(r.by_rate).toEqual([]);
    expect(r.net_tax_payable).toBe(0);
  });

  it("flags an unbalanced journal", () => {
    const broken = entry(9, "2026-01-05", [
      line("1000", "Cash", "asset", 110),
      line("2100", "Sales Tax Payable", "liability", 0, 10),
      line("4000", "Sales Revenue", "revenue", 0, 99),
    ]);
    expect(buildTaxPeriodReport([broken]).ledger_balanced).toBe(false);
  });
});

describe("buildVatReturn", () => {
  const entries = [
    entry(1, "2026-01-05", [
      line("1000", "Cash", "asset", 120),
      line("2100", "Sales Tax Payable", "liability", 0, 20),
      line("4000", "Sales Revenue", "revenue", 0, 100),
    ]),
    entry(2, "2026-01-31", [
      line("2100", "Sales Tax Payable", "liability", 5),
      line("1000", "Cash", "asset", 0, 5),
    ], "manual"),
  ];

  it("returns output less input tax and reconciles with the 2100 balance", () => {
    const v = buildVatReturn(entries, EXCLUSIVE, {
      from: "2026-01-01",
      to: "2026-01-31",
      currency: "GBP",
    });
    expect(v.output_tax).toBe(20);
    expect(v.input_tax).toBe(5);
    expect(v.net_payable).toBe(15);
    expect(v.closing_tax_payable).toBe(15);
    expect(v.currency).toBe("GBP");
    expect(v.lines.find((l) => l.box === "6")?.amount).toBe(15);
  });

  it("produces a negative payable (reclaim) when input tax exceeds output", () => {
    const v = buildVatReturn(
      [
        ...entries,
        entry(3, "2026-01-15", [
          line("2100", "Sales Tax Payable", "liability", 100),
          line("1000", "Cash", "asset", 0, 100),
        ], "manual"),
      ],
      EXCLUSIVE,
      { from: "2026-01-01", to: "2026-01-31" },
    );
    expect(v.net_payable).toBe(-85);
  });
});
