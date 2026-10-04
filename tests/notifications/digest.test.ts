import { describe, expect, it } from "vitest";
import { buildDailyDigest, renderDigest, renderDigestHtml, renderDigestText } from "@/lib/notifications/digest";
import { escapeHtml, normalizeWhatsAppPhone, isValidWhatsAppPhone, isValidTelegramChat, isRetryableStatus, providerError, providerMessageId } from "@/lib/notifications/channels";
import { buildTaxPeriodReport } from "@/lib/accounting/taxEngine";
import { buildCreditPortfolio } from "@/lib/accounting/creditTerms";
import { round2 } from "@/lib/utils";
import type { JournalEntry, JournalLine, Order } from "@/types";
import { ALL_DIGEST_SECTIONS } from "@/lib/notifications/types";

const line = (
  account_code: string,
  account_name: string,
  account_type: JournalLine["account_type"],
  debit = 0,
  credit = 0,
): JournalLine => ({ account_code, account_name, account_type, description: "", debit, credit });

const entry = (n: number, date: string, lines: JournalLine[]): JournalEntry => ({
  store_id: "store-1",
  entry_number: n,
  entry_date: date,
  description: `E${n}`,
  reference: `r${n}`,
  source: "order",
  status: "posted",
  lines,
});

/** A paid order entry: Dr Cash + Dr Fees + Cr Revenue + Cr Tax. */
function saleEntry(n: number, date: string, revenue: number, tax: number): JournalEntry {
  return entry(n, date, [
    line("1000", "Cash", "asset", round2(revenue + tax - 3)),
    line("5200", "Payment Processing Fees", "expense", 3),
    line("2100", "Sales Tax Payable", "liability", 0, tax),
    line("4000", "Sales Revenue", "revenue", 0, revenue),
  ]);
}

const order = (over: Partial<Order> = {}): Order => ({
  store_id: "store-1",
  external_id: "ext-1",
  order_number: "ORD-1",
  customer_name: "Ada",
  currency: "USD",
  subtotal: 100,
  shipping_amount: 0,
  discount_amount: 0,
  tax_amount: 10,
  total_amount: 110,
  payment_gateway: "stripe",
  payment_fee: 3,
  shipping_cost: 0,
  refund_amount: 0,
  status: "paid",
  ordered_at: "2026-03-01T12:00:00.000Z",
  items: [
    { sku: "A1", name: "Widget", quantity: 2, unit_price: 50, unit_cost: 20, line_subtotal: 100, line_cost: 40 },
  ],
  ...over,
});

const STORE = { id: "store-1", name: "Ada's Store", currency: "USD" };
const PERIOD = { from: "2026-03-01", to: "2026-03-01" };

describe("buildDailyDigest", () => {
  const entries = [
    saleEntry(1, "2026-03-01", 100, 10),
    saleEntry(2, "2026-03-01", 200, 20),
    // A prior-period sale that must not land in the headline.
    saleEntry(3, "2026-02-01", 999, 0),
  ];

  it("derives revenue, profit and AOV for the period only", () => {
    const d = buildDailyDigest({
      store: STORE,
      orders: [order(), order({ external_id: "e2", order_number: "ORD-2", subtotal: 200, total_amount: 220, tax_amount: 20 })],
      entries,
      period: PERIOD,
      generated_at: "2026-03-02T08:00:00.000Z",
    });

    expect(d.headline.revenue).toBe(300); // 100 + 200, not the 999 from February
    expect(d.headline.orders).toBe(2);
    expect(d.headline.aov).toBe(150);
    expect(d.headline.net_profit).toBe(294); // 300 revenue - 2 x 3 gateway fees
    expect(d.balances.cash).toBe(round2(107 + 217 + 996));
    expect(d.balances.tax_payable).toBe(30);
  });

  it("aggregates top products by revenue across orders", () => {
    const d = buildDailyDigest({
      store: STORE,
      orders: [
        order(),
        order({
          external_id: "e2",
          order_number: "ORD-2",
          items: [
            { sku: "B2", name: "Gadget", quantity: 1, unit_price: 500, unit_cost: 100, line_subtotal: 500, line_cost: 100 },
            { sku: "A1", name: "Widget", quantity: 1, unit_price: 50, unit_cost: 20, line_subtotal: 50, line_cost: 20 },
          ],
        }),
      ],
      entries,
      period: PERIOD,
    });

    expect(d.top_products).toEqual([
      { name: "Gadget", units: 1, revenue: 500 },
      { name: "Widget", units: 3, revenue: 150 },
    ]);
  });

  it("carries the Account 2100 report into the digest", () => {
    const tax = buildTaxPeriodReport(entries, undefined, { from: PERIOD.from, to: PERIOD.to });
    const d = buildDailyDigest({ store: STORE, orders: [], entries, period: PERIOD, tax });
    expect(d.balances.tax_payable).toBe(tax.account_balance);
  });

  it("flags a negative-margin day as critical", () => {
    // Revenue 100, COGS 150 → a net loss.
    const lossy = [
      entry(1, "2026-03-01", [
        line("1000", "Cash", "asset", 100),
        line("4000", "Sales Revenue", "revenue", 0, 100),
        line("5000", "Cost of Goods Sold", "expense", 150),
        line("1200", "Inventory", "asset", 0, 150),
      ]),
    ];
    const d = buildDailyDigest({
      store: STORE,
      orders: [order()],
      entries: lossy,
      period: PERIOD,
      generated_at: "2026-03-02T08:00:00.000Z",
    });
    expect(d.headline.net_profit).toBe(-50);
    expect(d.alerts.some((a) => a.level === "critical" && /net loss/i.test(a.message))).toBe(true);
  });

  it("flags thin margins as a warning", () => {
    const thin = [
      entry(1, "2026-03-01", [
        line("1000", "Cash", "asset", 100),
        line("4000", "Sales Revenue", "revenue", 0, 100),
        line("5000", "Cost of Goods Sold", "expense", 96),
        line("1200", "Inventory", "asset", 0, 96),
      ]),
    ];
    const d = buildDailyDigest({ store: STORE, orders: [order()], entries: thin, period: PERIOD });
    expect(d.alerts.some((a) => a.level === "warning" && /margin/i.test(a.message))).toBe(true);
  });

  it("surfaces blocked customers and overdue balances from the credit portfolio", () => {
    const credit = buildCreditPortfolio(
      [
        { customer_id: "C1", customer_name: "Bad Co", credit_limit: 1000, payment_terms_code: "net_30", currency: "USD" },
      ],
      [
        { invoice_number: "I1", customer_id: "C1", issued_at: "2026-01-01", due_at: "2026-01-31", amount: 800 },
      ],
      PERIOD.to,
    );
    const d = buildDailyDigest({ store: STORE, orders: [], entries: [], period: PERIOD, credit });
    expect(d.credit.blocked_customers).toBe(1);
    expect(d.credit.overdue).toBe(800);
    expect(d.credit.top_customers[0].customer_name).toBe("Bad Co");
    expect(d.alerts.some((a) => /blocked on credit/.test(a.message))).toBe(true);
  });

  it("marks a quiet day as empty", () => {
    const d = buildDailyDigest({ store: STORE, orders: [], entries: [], period: PERIOD });
    expect(d.is_empty).toBe(true);
    expect(d.alerts).toEqual([]);
  });

  it("is not empty when a tax liability is outstanding", () => {
    const tax = buildTaxPeriodReport(entries, undefined, { from: PERIOD.from, to: PERIOD.to });
    const d = buildDailyDigest({ store: STORE, orders: [], entries, period: PERIOD, tax });
    expect(d.is_empty).toBe(false);
    expect(d.alerts.some((a) => /2100/.test(a.message))).toBe(true);
  });

  it("suppresses credit alerts when the section is disabled", () => {
    const credit = buildCreditPortfolio(
      [{ customer_id: "C1", customer_name: "Bad Co", credit_limit: 1000, payment_terms_code: "net_30", currency: "USD" }],
      [{ invoice_number: "I1", customer_id: "C1", issued_at: "2026-01-01", due_at: "2026-01-31", amount: 800 }],
      PERIOD.to,
    );
    const d = buildDailyDigest({
      store: STORE,
      orders: [],
      entries: [],
      period: PERIOD,
      credit,
      sections: { ...ALL_DIGEST_SECTIONS, credit: false },
    });
    expect(d.alerts.some((a) => /blocked on credit/.test(a.message))).toBe(false);
  });
});

describe("renderers", () => {
  const digest = buildDailyDigest({
    store: STORE,
    orders: [order()],
    entries: [saleEntry(1, "2026-03-01", 100, 10)],
    period: PERIOD,
    credit: buildCreditPortfolio(
      [{ customer_id: "C1", customer_name: "Acme & Co", credit_limit: 1000, payment_terms_code: "net_30", currency: "USD" }],
      [{ invoice_number: "I1", customer_id: "C1", issued_at: "2026-01-01", due_at: "2026-01-31", amount: 800 }],
      PERIOD.to,
    ),
    generated_at: "2026-03-02T08:00:00.000Z",
  });

  it("renders WhatsApp text with *bold* markers and no HTML", () => {
    const text = renderDigestText(digest);
    expect(text).toContain("*Ada's Store — daily digest*");
    expect(text).toContain("Revenue: *$100*");
    expect(text).toContain("*Top products*");
    expect(text).not.toContain("<b>");
    expect(text).toContain("Acme & Co"); // raw ampersand is fine in plain text
  });

  it("renders Telegram HTML with every interpolated value escaped", () => {
    const html = renderDigestHtml(digest);
    expect(html).toContain("<b>Ada's Store — daily digest</b>");
    expect(html).toContain("Acme &amp; Co"); // must NOT stay a bare "&"
    expect(html).not.toMatch(/&(?!amp;|lt;|gt;)/); // no stray unescaped ampersands
  });

  it("picks the renderer matching the channel", () => {
    expect(renderDigest(digest, "telegram")).toContain("<b>");
    expect(renderDigest(digest, "whatsapp")).toContain("*");
  });

  it("states plainly when there is nothing to report", () => {
    const quiet = buildDailyDigest({ store: STORE, orders: [], entries: [], period: PERIOD });
    expect(renderDigestText(quiet)).toContain("No orders and no alerts today.");
  });
});

describe("channel helpers", () => {
  it("escapes the three characters that can break Telegram HTML", () => {
    expect(escapeHtml('a & b < c > d')).toBe("a &amp; b &lt; c &gt; d");
    expect(escapeHtml("plain")).toBe("plain");
  });

  it("normalizes phone numbers to bare digits", () => {
    expect(normalizeWhatsAppPhone("+1 (555) 010-9999")).toBe("15550109999");
    expect(normalizeWhatsAppPhone(" 966 50 123 4567 ")).toBe("966501234567");
  });

  it("validates destinations", () => {
    expect(isValidWhatsAppPhone("+966501234567")).toBe(true);
    expect(isValidWhatsAppPhone("123")).toBe(false);
    expect(isValidWhatsAppPhone("1234567890123456789")).toBe(false); // too long for E.164
    expect(isValidTelegramChat("-1001234567890")).toBe(true);
    expect(isValidTelegramChat("@ops_team")).toBe(true);
    expect(isValidTelegramChat("@bad")).toBe(false);
  });

  it("classifies retryable HTTP statuses", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
  });

  it("reads error text and message ids from both provider shapes", () => {
    expect(providerError({ ok: false, description: "chat not found" }, 400)).toBe("chat not found");
    expect(providerError({ error: { message: "Invalid phone number" } }, 400)).toBe("Invalid phone number");
    expect(providerError(null, 503)).toBe("HTTP 503");
    expect(providerMessageId({ result: { message_id: 42 } })).toBe("42");
    expect(providerMessageId({ messages: [{ id: "wamid.1" }] })).toBe("wamid.1");
    expect(providerMessageId({})).toBeUndefined();
  });
});
