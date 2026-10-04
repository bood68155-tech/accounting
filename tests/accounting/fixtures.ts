import type { JournalEntry, Order, OrderItem } from "@/types";

/**
 * Shared fixtures for the accounting + AI engine regression suites.
 *
 * Order math is kept internally consistent so the double-entry builders
 * balance: total = subtotal + shipping + tax − discount.
 */

export const STORE_ID = "store-test";

export function makeItem(overrides: Partial<OrderItem> = {}): OrderItem {
  const quantity = overrides.quantity ?? 2;
  const unitPrice = overrides.unit_price ?? 50;
  const unitCost = overrides.unit_cost ?? 20;
  return {
    sku: "SKU-1",
    name: "Widget",
    quantity,
    unit_price: unitPrice,
    unit_cost: unitCost,
    line_subtotal: overrides.line_subtotal ?? round2(unitPrice * quantity),
    line_cost: overrides.line_cost ?? round2(unitCost * quantity),
    ...overrides,
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function makeOrder(overrides: Partial<Order> = {}): Order {
  const items = overrides.items ?? [makeItem()];
  const subtotal = overrides.subtotal ?? items.reduce((s, i) => s + i.line_subtotal, 0);
  const shipping = overrides.shipping_amount ?? 10;
  const tax = overrides.tax_amount ?? 0;
  const discount = overrides.discount_amount ?? 0;
  const total = overrides.total_amount ?? round2(subtotal + shipping + tax - discount);

  return {
    store_id: STORE_ID,
    external_id: "ext-1001",
    order_number: "#1001",
    customer_name: "Test Customer",
    currency: "USD",
    subtotal,
    shipping_amount: shipping,
    discount_amount: discount,
    tax_amount: tax,
    total_amount: total,
    payment_gateway: "stripe",
    payment_fee: 3,
    shipping_cost: 6,
    refund_amount: 0,
    status: "paid",
    ordered_at: "2026-01-15T10:00:00.000Z",
    items,
    ...overrides,
  };
}

/** Build a JournalEntry literal without going through validateEntry. */
export function makeEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    store_id: STORE_ID,
    entry_number: 1,
    entry_date: "2026-01-15",
    description: "Test entry",
    reference: "ref-1",
    source: "manual",
    status: "posted",
    lines: [],
    ...overrides,
  };
}

/** Total debits and credits across every entry — the accounting identity. */
export function totals(entries: JournalEntry[]) {
  let debits = 0;
  let credits = 0;
  for (const entry of entries) {
    for (const l of entry.lines) {
      debits += l.debit;
      credits += l.credit;
    }
  }
  return { debits: round2(debits), credits: round2(credits) };
}