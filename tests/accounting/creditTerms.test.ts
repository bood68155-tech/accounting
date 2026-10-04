import { describe, expect, it } from "vitest";
import {
  ageBucket,
  buildAgingReport,
  buildCreditPortfolio,
  computeDueDate,
  daysBetween,
  daysPastDue,
  evaluateCreditLimit,
  getPaymentTerms,
  isOverdue,
  openBalance,
  parsePaymentTerms,
  DEFAULT_CREDIT_POLICY,
  type CustomerCreditProfile,
  type OpenInvoice,
} from "@/lib/accounting/creditTerms";

const AS_OF = "2026-03-01";

const invoice = (over: Partial<OpenInvoice> = {}): OpenInvoice => ({
  invoice_number: "INV-1",
  customer_id: "CUST-1",
  customer_name: "Acme",
  issued_at: "2026-02-01",
  due_at: "2026-03-01",
  amount: 1000,
  amount_paid: 0,
  currency: "USD",
  ...over,
});

const profile = (over: Partial<CustomerCreditProfile> = {}): CustomerCreditProfile => ({
  customer_id: "CUST-1",
  customer_name: "Acme",
  credit_limit: 5000,
  payment_terms_code: "net_30",
  currency: "USD",
  ...over,
});

describe("payment terms", () => {
  it("resolves known terms and rejects unknown ones", () => {
    expect(getPaymentTerms("net_30")?.net_days).toBe(30);
    expect(getPaymentTerms("due_on_receipt")?.net_days).toBe(0);
    expect(parsePaymentTerms("net_90").net_days).toBe(90);
    expect(() => parsePaymentTerms("net_45ish")).toThrow(/Unknown payment terms/);
  });

  it("adds the net days to the invoice date", () => {
    expect(computeDueDate("2026-01-15", "net_30")).toBe("2026-02-14");
    expect(computeDueDate("2026-01-15", "due_on_receipt")).toBe("2026-01-15");
  });

  it("rolls a weekend due date forward only when asked", () => {
    // 2026-01-17 is a Saturday.
    const sat = computeDueDate("2026-01-17", { code: "due_on_receipt", label: "x", net_days: 0 });
    expect(sat).toBe("2026-01-17");
    expect(computeDueDate("2026-01-17", "due_on_receipt", { roll_to_business_day: true })).toBe("2026-01-19");
  });

  it("skips listed holidays when rolling forward", () => {
    // 2026-01-19 is a Monday but flagged as a holiday → rolls to Tuesday.
    expect(
      computeDueDate("2026-01-17", "due_on_receipt", {
        roll_to_business_day: true,
        holidays: ["2026-01-19"],
      }),
    ).toBe("2026-01-20");
  });

  it("crosses month and year boundaries without overflowing", () => {
    expect(computeDueDate("2026-12-20", "net_30")).toBe("2027-01-19");
    expect(computeDueDate("2026-01-31", "net_30")).toBe("2026-03-02"); // Feb has 28 days in 2026
  });

  it("rejects a malformed date", () => {
    expect(() => computeDueDate("15/01/2026", "net_30")).toThrow(/Invalid ISO date/);
  });
});

describe("invoice status", () => {
  it("computes the open balance net of payments", () => {
    expect(openBalance(invoice())).toBe(1000);
    expect(openBalance(invoice({ amount_paid: 250 }))).toBe(750);
    expect(openBalance(invoice({ amount_paid: 1000 }))).toBe(0);
  });

  it("treats an invoice as overdue only after its due date", () => {
    expect(isOverdue(invoice({ due_at: "2026-03-02" }), AS_OF)).toBe(false);
    expect(isOverdue(invoice({ due_at: "2026-03-01" }), AS_OF)).toBe(false); // due today
    expect(isOverdue(invoice({ due_at: "2026-02-28" }), AS_OF)).toBe(true);
    expect(daysPastDue(invoice({ due_at: "2026-02-26" }), AS_OF)).toBe(3);
    expect(daysPastDue(invoice({ due_at: "2026-03-05" }), AS_OF)).toBe(0);
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
  });

  it("maps days late onto the standard aging buckets", () => {
    expect(ageBucket(0)).toBe("current");
    expect(ageBucket(-5)).toBe("current");
    expect(ageBucket(1)).toBe("d1_30");
    expect(ageBucket(30)).toBe("d1_30");
    expect(ageBucket(31)).toBe("d31_60");
    expect(ageBucket(60)).toBe("d31_60");
    expect(ageBucket(61)).toBe("d61_90");
    expect(ageBucket(90)).toBe("d61_90");
    expect(ageBucket(91)).toBe("d90_plus");
  });
});

describe("buildAgingReport", () => {
  it("buckets open balances and ignores settled invoices", () => {
    const report = buildAgingReport(
      [
        invoice({ invoice_number: "I1", due_at: "2026-03-20", amount: 500 }), // current
        invoice({ invoice_number: "I2", due_at: "2026-02-20", amount: 300 }), // 9 days
        invoice({ invoice_number: "I3", due_at: "2026-01-20", amount: 200 }), // 40 days
        invoice({ invoice_number: "I4", due_at: "2025-11-30", amount: 100 }), // 91 days
        invoice({ invoice_number: "I5", due_at: "2026-01-01", amount: 900, amount_paid: 900 }), // settled
      ],
      AS_OF,
    );

    expect(report.total_count).toBe(4);
    expect(report.total_amount).toBe(1100);
    expect(report.overdue_amount).toBe(600); // 300 + 200 + 100
    const byBucket = Object.fromEntries(report.lines.map((l) => [l.bucket, l]));
    expect(byBucket.current).toMatchObject({ count: 1, amount: 500 });
    expect(byBucket.d1_30).toMatchObject({ count: 1, amount: 300 });
    expect(byBucket.d31_60).toMatchObject({ count: 1, amount: 200 });
    expect(byBucket.d90_plus).toMatchObject({ count: 1, amount: 100 });
    expect(report.lines).toHaveLength(5);
  });

  it("is empty-safe", () => {
    const report = buildAgingReport([], AS_OF);
    expect(report.total_amount).toBe(0);
    expect(report.lines.every((l) => l.count === 0)).toBe(true);
  });
});

describe("evaluateCreditLimit", () => {
  it("approves an order that fits inside the limit", () => {
    const r = evaluateCreditLimit({
      profile: profile(),
      order_amount: 1200,
      open_invoices: [invoice({ amount: 500, due_at: "2026-03-20" })],
      as_of: AS_OF,
    });
    expect(r.decision).toBe("approved");
    expect(r.approved).toBe(true);
    expect(r.outstanding_balance).toBe(500);
    expect(r.exposure_after_order).toBe(1700);
    expect(r.available_credit).toBe(4500);
    expect(r.utilization).toBeCloseTo(0.34, 5);
    expect(r.due_date).toBe("2026-03-31");
  });

  it("declines an order that breaches the limit and reports the excess", () => {
    const r = evaluateCreditLimit({
      profile: profile({ credit_limit: 1000 }),
      order_amount: 600,
      open_invoices: [invoice({ amount: 500, due_at: "2026-03-20" })],
      as_of: AS_OF,
    });
    expect(r.decision).toBe("declined");
    expect(r.approved).toBe(false);
    expect(r.overridable).toBe(true);
    expect(r.exceeded_by).toBe(100);
    expect(r.reason).toMatch(/100\.00 over their 1000\.00 credit limit/);
  });

  it("treats a null limit as unlimited", () => {
    const r = evaluateCreditLimit({
      profile: profile({ credit_limit: null, customer_name: "Cash Co" }),
      order_amount: 99_999,
      open_invoices: [],
      as_of: AS_OF,
    });
    expect(r.decision).toBe("approved");
    expect(r.available_credit).toBeNull();
    expect(r.utilization).toBeNull();
    expect(r.reason).toMatch(/no credit limit/);
  });

  it("declines on any overdue invoice, even well inside the limit", () => {
    const r = evaluateCreditLimit({
      profile: profile(),
      order_amount: 100,
      open_invoices: [invoice({ amount: 200, due_at: "2026-02-25" })], // 4 days late
      as_of: AS_OF,
    });
    expect(r.decision).toBe("declined");
    expect(r.overdue_invoice_count).toBe(1);
    expect(r.oldest_overdue_days).toBe(4);
    expect(r.overdue_amount).toBe(200);
    expect(r.reason).toMatch(/overdue invoice/);
  });

  it("hard-blocks and disallows override past the policy threshold", () => {
    const r = evaluateCreditLimit({
      profile: profile(),
      order_amount: 100,
      open_invoices: [invoice({ amount: 200, due_at: "2026-01-01" })], // 59 days late
      as_of: AS_OF,
    });
    expect(r.decision).toBe("declined");
    expect(r.overridable).toBe(false);
    expect(r.oldest_overdue_days).toBe(59);
    expect(r.reason).toMatch(/past the 30-day hard block/);
  });

  it("never overrides an administrative credit hold", () => {
    const r = evaluateCreditLimit({
      profile: profile({ credit_hold: true }),
      order_amount: 1,
      open_invoices: [],
      as_of: AS_OF,
    });
    expect(r.decision).toBe("declined");
    expect(r.overridable).toBe(false);
    expect(r.reason).toMatch(/credit hold/);
  });

  it("flags the high-utilization band for review but still releases", () => {
    const r = evaluateCreditLimit({
      profile: profile({ credit_limit: 1000 }),
      order_amount: 400,
      open_invoices: [invoice({ amount: 500, due_at: "2026-03-20" })], // 90% utilization
      as_of: AS_OF,
    });
    expect(r.decision).toBe("review");
    expect(r.approved).toBe(true);
    expect(r.utilization).toBeCloseTo(0.9, 5);
    expect(r.reason).toMatch(/90% of their/);
  });

  it("honours a relaxed policy that tolerates overdue balances", () => {
    const r = evaluateCreditLimit(
      {
        profile: profile(),
        order_amount: 100,
        open_invoices: [invoice({ amount: 200, due_at: "2026-02-25" })],
        as_of: AS_OF,
      },
      { block_on_overdue: false, hard_block_after_days: null, approval_utilization: 0.9 },
    );
    expect(r.decision).toBe("approved");
  });

  it("lets a single order override its payment terms for the due date", () => {
    const r = evaluateCreditLimit({
      profile: profile(),
      order_amount: 100,
      open_invoices: [],
      as_of: AS_OF,
      payment_terms_code: "net_15",
    });
    expect(r.payment_terms_code).toBe("net_15");
    expect(r.due_date).toBe("2026-03-16");
  });

  it("sends an unknown terms code to review rather than throwing mid-check", () => {
    const r = evaluateCreditLimit({
      profile: profile({ payment_terms_code: "net_21" }),
      order_amount: 100,
      open_invoices: [],
      as_of: AS_OF,
    });
    expect(r.decision).toBe("review");
    expect(r.reason).toMatch(/not configured/);
    expect(r.due_date).toBe("2026-03-31"); // falls back to Net 30
  });

  it("keeps a 0% credit limit unlimited rather than dividing by zero", () => {
    const r = evaluateCreditLimit({
      profile: profile({ credit_limit: 0 }),
      order_amount: 50,
      open_invoices: [],
      as_of: AS_OF,
    });
    expect(r.utilization).toBeNull();
    // 50 exposure over a zero limit still blocks.
    expect(r.decision).toBe("declined");
    expect(r.exceeded_by).toBe(50);
  });

  it("does not treat a settled invoice as exposure", () => {
    const r = evaluateCreditLimit({
      profile: profile(),
      order_amount: 100,
      open_invoices: [invoice({ amount: 5000, amount_paid: 5000 })],
      as_of: AS_OF,
    });
    expect(r.outstanding_balance).toBe(0);
    expect(r.decision).toBe("approved");
  });
});

describe("buildCreditPortfolio", () => {
  const invoices = [
    invoice({ invoice_number: "B1", customer_id: "CLEAN", due_at: "2026-03-20", amount: 100 }),
    invoice({ invoice_number: "W1", customer_id: "WARN", due_at: "2026-02-27", amount: 950 }), // 2 days late
    invoice({ invoice_number: "D1", customer_id: "BAD", due_at: "2026-01-01", amount: 800 }),
  ];

  const profiles = [
    profile({ customer_id: "CLEAN", customer_name: "Clean Co" }),
    profile({ customer_id: "WARN", customer_name: "Warn Co", credit_limit: 1000 }),
    profile({ customer_id: "BAD", customer_name: "Bad Co" }),
  ];

  it("blocks every overdue customer under the default policy and ranks by risk", () => {
    const p = buildCreditPortfolio(profiles, invoices, AS_OF, DEFAULT_CREDIT_POLICY);
    // Overdue accounts cannot be released at all, so both WARN and BAD block;
    // the tie is broken by utilization (WARN 95% vs BAD 16%).
    expect(p.rows.map((r) => r.customer_id)).toEqual(["WARN", "BAD", "CLEAN"]);
    expect(p.rows.map((r) => r.status)).toEqual(["blocked", "blocked", "ok"]);
    expect(p.rows[0].utilization).toBeCloseTo(0.95, 5);
    expect(p.total_outstanding).toBe(1850);
    expect(p.total_overdue).toBe(1750);
    expect(p.blocked_customers).toBe(2);
    expect(p.warning_customers).toBe(0);
  });

  it("marks a clean but nearly-full customer as a warning", () => {
    const p = buildCreditPortfolio(
      [profile({ customer_id: "TIGHT", customer_name: "Tight Co", credit_limit: 1000 })],
      [invoice({ customer_id: "TIGHT", due_at: "2026-03-20", amount: 950 })],
      AS_OF,
      DEFAULT_CREDIT_POLICY,
    );
    expect(p.rows[0].status).toBe("warning");
    expect(p.rows[0].available_credit).toBe(50);
    expect(p.warning_customers).toBe(1);
    expect(p.blocked_customers).toBe(0);
  });

  it("marks a customer on hold as blocked even with a clean ledger", () => {
    const p = buildCreditPortfolio(
      [profile({ customer_id: "HELD", credit_hold: true })],
      [],
      AS_OF,
    );
    expect(p.rows[0].status).toBe("blocked");
  });
});
