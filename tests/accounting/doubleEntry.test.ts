import { describe, expect, it } from "vitest";
import {
  aggregateAccountBalances,
  buildReversalEntry,
  createCreditSaleEntry,
  createFeeEntry,
  createPaymentCollectionEntry,
  createRefundEntry,
  createSaleEntry,
  entriesTotalCredits,
  entriesTotalDebits,
  fullCogs,
  line,
  nextEntryNumber,
  validateEntry,
} from "@/lib/accounting/doubleEntry";
import { makeEntry, makeItem, makeOrder, STORE_ID, totals } from "./fixtures";

/**
 * Double-entry invariant regression suite.
 *
 * These assertions are the safety net for every figure the product reports:
 * if Σ debits ≠ Σ credits for any builder, the ledger can no longer tie to the
 * P&L or the balance sheet, and every downstream number silently becomes wrong.
 */

/** Every builder must emit a balanced entry — Σ debits === Σ credits. */
function expectBalanced(entry: { entry_number: number; lines: { debit: number; credit: number }[] }) {
  const { debits, credits } = totals([entry as never]);
  expect(Math.abs(debits - credits)).toBeLessThan(0.005);
  return { debits, credits };
}

/**
 * Net amount posted to an account on one side. An account can hold several lines
 * in a single entry (Cash takes a debit for proceeds and a credit for the
 * shipping paid to the carrier), so lines must be summed, not looked up.
 */
function side(entry: { lines: { account_code: string; debit: number; credit: number }[] }, code: string) {
  return entry.lines
    .filter((l) => l.account_code === code)
    .reduce((s, l) => s + l.debit - l.credit, 0);
}

describe("double-entry builders", () => {
  it("createSaleEntry balances and posts cash, revenue, fees, COGS and shipping", () => {
    const order = makeOrder({ tax_amount: 5, discount_amount: 5 });
    const entry = createSaleEntry(order, 1);
    const { debits, credits } = expectBalanced(entry);

    const byCode = new Map(entry.lines.map((l) => [l.account_code, l]));
    expect(byCode.get("5200")!.debit).toBe(order.payment_fee);
    expect(byCode.get("4000")!.credit).toBe(order.subtotal);
    expect(byCode.get("2100")!.credit).toBe(order.tax_amount);
    expect(byCode.get("4400")!.debit).toBe(order.discount_amount);
    expect(byCode.get("5000")!.debit).toBe(fullCogs(order));
    expect(byCode.get("1200")!.credit).toBe(fullCogs(order));
    // Fulfilment cost is expensed and paid out of cash.
    expect(byCode.get("5100")!.debit).toBe(order.shipping_cost);
    // Net cash = proceeds less the gateway fee less the shipping paid.
    expect(side(entry, "1000")).toBe(order.total_amount - order.payment_fee - order.shipping_cost);
    expect(debits).toBe(credits);
  });

  it("createCreditSaleEntry debits receivables and never debits cash", () => {
    const order = makeOrder();
    const entry = createCreditSaleEntry(order, 1);
    expectBalanced(entry);

    const byCode = new Map(entry.lines.map((l) => [l.account_code, l]));
    expect(byCode.get("1100")!.debit).toBe(order.total_amount);
    // No cash IN until collection — cash only ever moves out for shipping here.
    expect(side(entry, "1000")).toBe(-order.shipping_cost);
    expect(byCode.get("5100")!.debit).toBe(order.shipping_cost);
  });

  it("createFeeEntry debits the expense and credits cash", () => {
    const entry = createFeeEntry(STORE_ID, 1, "2026-02-01", "Payout fee", "po_1", 25);
    expectBalanced(entry);

    const byCode = new Map(entry.lines.map((l) => [l.account_code, l]));
    expect(byCode.get("5200")!.debit).toBe(25);
    expect(byCode.get("1000")!.credit).toBe(25);
  });

  it("createRefundEntry debits refunds and credits cash, reversing only the refunded COGS share", () => {
    const order = makeOrder();
    const refund = order.total_amount / 2;
    const entry = createRefundEntry(order, refund, 2);
    expectBalanced(entry);

    const byCode = new Map(entry.lines.map((l) => [l.account_code, l]));
    expect(byCode.get("4500")!.debit).toBe(refund);
    expect(byCode.get("1000")!.credit).toBe(refund);
    expect(byCode.get("5000")!.credit).toBeCloseTo(fullCogs(order) * 0.5, 2);
    expect(byCode.get("1200")!.debit).toBeCloseTo(fullCogs(order) * 0.5, 2);
  });

  it("caps COGS reversal on an over-refund so inventory can never go negative", () => {
    const order = makeOrder();
    const entry = createRefundEntry(order, order.total_amount * 3, 3);
    expectBalanced(entry);

    const inventory = entry.lines.find((l) => l.account_code === "1200")!;
    expect(inventory.debit).toBeCloseTo(fullCogs(order), 2); // capped at 100%
  });

  it("never emits all-zero journal lines (the DB check constraint forbids them)", () => {
    const entries = [
      createSaleEntry(makeOrder({ tax_amount: 0, discount_amount: 0 }), 1),
      createSaleEntry(makeOrder({ shipping_amount: 0 }), 2),
      createFeeEntry(STORE_ID, 3, "2026-02-01", "Payout fee", "po_1", 12.5),
    ];
    for (const entry of entries) {
      expect(entry.lines.length).toBeGreaterThan(0);
      for (const l of entry.lines) {
        expect(l.debit === 0 && l.credit === 0).toBe(false);
      }
    }
  });

  it("rejects a zero-value fee/refund outright instead of persisting zero lines", () => {
    // A fee or refund that rounds to nothing carries no information; posting it
    // would violate `check (not (debit = 0 and credit = 0))` at the database.
    expect(() => createFeeEntry(STORE_ID, 1, "2026-02-01", "Zero fee", "po_2", 0)).toThrow(
      /nothing to post/i,
    );
    expect(() => createRefundEntry(makeOrder(), 0, 2)).toThrow(/nothing to post/i);
  });

  it("credits and debits are rounded to 2dp on every line", () => {
    const order = makeOrder({ items: [makeItem({ unit_price: 10.005, unit_cost: 3.333 })] });
    for (const entry of [createSaleEntry(order, 1), createCreditSaleEntry(order, 2)]) {
      for (const l of entry.lines) {
        expect(l.debit).toBe(Math.round(l.debit * 100) / 100);
        expect(l.credit).toBe(Math.round(l.credit * 100) / 100);
      }
    }
  });
});

describe("validateEntry", () => {
  const base = () => makeEntry({ lines: [line("1000", "cash", 50), line("4000", "sales", 0, 50)] });

  it("accepts a balanced entry", () => {
    expect(() => validateEntry(base())).not.toThrow();
  });

  it("rejects an empty entry", () => {
    expect(() => validateEntry(makeEntry({ lines: [] }))).toThrow(/nothing to post/i);
  });

  it("rejects an unbalanced entry", () => {
    expect(() =>
      validateEntry(makeEntry({ lines: [line("1000", "cash", 50), line("4000", "sales", 0, 49)] })),
    ).toThrow(/Unbalanced/i);
  });

  it("rejects a negative amount", () => {
    expect(() =>
      validateEntry(makeEntry({ lines: [line("1000", "cash", -50), line("4000", "sales", 0, -50)] })),
    ).toThrow(/negative amount/i);
  });

  it("rejects a line carrying both a debit and a credit", () => {
    expect(() =>
      validateEntry(makeEntry({ lines: [line("1000", "both", 10, 10)] })),
    ).toThrow(/both debit and credit/i);
  });

  it("rejects an unknown account code", () => {
    expect(() => line("9999", "nope", 1)).toThrow(/Unknown ledger account code/i);
  });
});

describe("settlement: credit sale + payment collection", () => {
  it("nets the receivable to zero and recognizes revenue exactly once", () => {
    const order = makeOrder();
    const sale = createCreditSaleEntry(order, 1);
    const collection = createPaymentCollectionEntry(order, 2, "pay_1");
    const both = [sale, collection];
    for (const e of both) expectBalanced(e);

    const balances = new Map(
      aggregateAccountBalances(both).map((b) => [b.account_code, b.balance]),
    );

    // AR fully settled.
    expect(balances.get("1100")).toBe(0);
    // Revenue recognized once — the collection must NOT re-book sales.
    expect(balances.get("4000")).toBe(order.subtotal);
    // Cash: collected less the gateway fee less the shipping paid out.
    expect(balances.get("1000")).toBe(
      order.total_amount - order.payment_fee - order.shipping_cost,
    );
    expect(balances.get("5200")).toBe(order.payment_fee);
    // Shipping expensed exactly once, at booking — not again at settlement.
    expect(balances.get("5100")).toBe(order.shipping_cost);
  });

  it("falls back to the order external id when no gateway payment id is given", () => {
    const order = makeOrder();
    const collection = createPaymentCollectionEntry(order, 2);
    expect(collection.reference).toBe(order.external_id);
  });
});

describe("reversal engine", () => {
  const original = () => ({ ...createSaleEntry(makeOrder(), 1), id: "entry-uuid-1" });

  it("swaps every line so the pair nets to zero in every account", () => {
    const original = createSaleEntry(makeOrder(), 1);
    const reversal = buildReversalEntry({ ...original, id: "entry-uuid-1" }, 2, "duplicate webhook");

    expectBalanced(reversal);
    const nets = aggregateAccountBalances([original, reversal]);
    for (const account of nets) {
      expect(account.balance).toBeCloseTo(0, 5);
    }
    expect(nets.length).toBeGreaterThan(0);
  });

  it("links back to the original and records the audit reason", () => {
    const reversal = buildReversalEntry(original(), 2, "  duplicate webhook  ");
    expect(reversal.reversal_of).toBe("entry-uuid-1");
    expect(reversal.reversal_reason).toBe("duplicate webhook"); // trimmed
    expect(reversal.source).toBe("adjustment");
    expect(reversal.status).toBe("posted");
  });

  it("rejects reversing a non-posted entry", () => {
    expect(() => buildReversalEntry({ ...original(), status: "draft" }, 2, "why")).toThrow(
      /not posted/i,
    );
  });

  it("requires a reason for the audit trail", () => {
    expect(() => buildReversalEntry(original(), 2, "   ")).toThrow(/reason is required/i);
  });
});

describe("general ledger aggregation", () => {
  it("signs balances by the account's normal direction, not its type", () => {
    // 4400 Discounts Given is revenue-*typed* but debit-normal: it must carry a
    // positive balance, not be netted against revenue.
    const entries = [
      createSaleEntry(makeOrder({ discount_amount: 40 }), 1),
    ];
    const balances = new Map(
      aggregateAccountBalances(entries).map((b) => [b.account_code, b.balance]),
    );
    expect(balances.get("4400")).toBe(40);
    expect(balances.get("4000")).toBeGreaterThan(0);
  });

  it("sums multi-entry activity and sorts by account code", () => {
    const entries = [
      createSaleEntry(makeOrder({ discount_amount: 10 }), 1),
      createSaleEntry(makeOrder({ external_id: "ext-1002", order_number: "#1002", discount_amount: 5 }), 2),
    ];
    const balances = aggregateAccountBalances(entries);
    const codes = balances.map((b) => b.account_code);
    expect([...codes].sort()).toEqual(codes);
    expect(new Map(balances.map((b) => [b.account_code, b.balance])).get("4400")).toBe(15);
  });

  it("agrees between the per-entry and whole-book debit/credit totals", () => {
    const entries = [
      createSaleEntry(makeOrder(), 1),
      createRefundEntry(makeOrder(), 20, 2),
      createFeeEntry(STORE_ID, 3, "2026-02-01", "Payout fee", "po_1", 12),
    ];
    expect(entriesTotalDebits(entries)).toBe(entriesTotalCredits(entries));
    const { debits, credits } = totals(entries);
    expect(entriesTotalDebits(entries)).toBe(debits);
    expect(entriesTotalCredits(entries)).toBe(credits);
  });
});

describe("nextEntryNumber", () => {
  it("returns one past the highest existing number", () => {
    expect(nextEntryNumber([])).toBe(1);
    expect(nextEntryNumber([{ entry_number: 4 }, { entry_number: 11 }, { entry_number: 7 }])).toBe(12);
  });
});