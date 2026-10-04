import { describe, expect, it } from "vitest";
import {
  categorizeTransaction,
  detectAnomalies,
  forecastCashFlow,
  suggestCategorizations,
} from "@/lib/ai/categorizer";
import { generateInsights } from "@/lib/ai/insights";
import { buildIncomeStatementFromOrders } from "@/lib/accounting/incomeStatement";
import { buildBalanceSheet } from "@/lib/accounting/balanceSheet";
import { createSaleEntry } from "@/lib/accounting/doubleEntry";
import { computeAggregateProfit, computeStats } from "@/lib/accounting/profitEngine";
import { makeItem, makeOrder } from "../accounting/fixtures";
import type { Order } from "@/types";

/**
 * AI engine regression suite.
 *
 * The AI layer is deterministic on purpose: the rule cascade, the anomaly
 * thresholds and the forecast must return identical output for identical input,
 * and the insight prose must only ever quote figures the ledger already
 * reports. These tests pin both properties.
 */

describe("categorizeTransaction", () => {
  it("maps gateway keywords to Payment Processing Fees", () => {
    const result = categorizeTransaction("Stripe processing fee", -12.5);
    expect(result.accountCode).toBe("5200");
    expect(result.category).toBe("gateway-fee");
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.reason).toBeTruthy();
  });

  it("is case-insensitive and matches on the source field", () => {
    expect(categorizeTransaction("STRIPE FEE", -1).accountCode).toBe("5200");
    expect(categorizeTransaction("Order 123", 100, "order").accountCode).toBe("4000");
  });

  it("routes marketing, software, shipping, refund and COGS keywords correctly", () => {
    const cases: Array<[string, string]> = [
      ["Meta ads campaign spend", "5300"],
      ["Zoom subscription renewal", "5400"],
      ["DHL courier label", "5100"],
      ["Customer refund issued", "4500"],
      ["Supplier restock invoice", "5000"],
    ];
    for (const [text, code] of cases) {
      expect(categorizeTransaction(text, -50).accountCode).toBe(code);
    }
  });

  it("prefers the more specific rule when several patterns match", () => {
    // Contains both a gateway and a marketing hint; the cascade is ordered.
    const result = categorizeTransaction("Stripe fee for Meta ads campaign", -20);
    expect(result.accountCode).toBe("5200");
  });

  it("flags low confidence when nothing matches, so a human reviews it", () => {
    const result = categorizeTransaction("zzz unclassifiable thing", 42);
    expect(result.confidence).toBeLessThan(0.85);
    expect(result.reason).toMatch(/review recommended/i);
  });

  it("is deterministic — the same input always yields the same mapping", () => {
    const input: Array<[string, number]> = [
      ["Stripe fee", -3],
      ["Meta ads", -40],
      ["mystery", 12],
    ];
    for (const [text, amount] of input) {
      expect(categorizeTransaction(text, amount)).toEqual(categorizeTransaction(text, amount));
    }
  });

  it("only suggests review for low-confidence manual entries", () => {
    const manual = { ...createSaleEntry(makeOrder(), 1), source: "manual" as const };
    const suggestions = suggestCategorizations([manual]);
    // An order-shaped entry categorizes confidently and is filtered out.
    expect(suggestions.length).toBeLessThanOrEqual(1);
    for (const s of suggestions) {
      expect(s.suggestion.confidence).toBeLessThan(0.85);
    }
  });
});

describe("detectAnomalies", () => {
  /** A baseline of similar orders so z-scores are meaningful. */
  function baseline(count: number): Order[] {
    return Array.from({ length: count }, (_, i) =>
      makeOrder({ external_id: `ext-${i}`, order_number: `#${i}` }),
    );
  }

  it("stays silent on a clean book", () => {
    expect(detectAnomalies(baseline(10))).toEqual([]);
  });

  it("flags an unusually large order by z-score", () => {
    const orders = [
      ...baseline(10),
      makeOrder({
        external_id: "ext-big",
        order_number: "#BIG",
        subtotal: 20_000,
        shipping_amount: 0,
        total_amount: 20_000,
        items: [makeItem({ quantity: 1, unit_price: 20_000, unit_cost: 5_000 })],
      }),
    ];
    const anomalies = detectAnomalies(orders);
    expect(anomalies.some((a) => a.subject === "#BIG" && /above the/i.test(a.detail))).toBe(true);
  });

  it("flags an order selling below cost as high severity", () => {
    const orders = [
      ...baseline(10),
      makeOrder({
        external_id: "ext-loss",
        order_number: "#LOSS",
        items: [makeItem({ quantity: 1, unit_price: 10, unit_cost: 40 })],
        shipping_amount: 0,
        total_amount: 10,
      }),
    ];
    const anomaly = detectAnomalies(orders).find((a) => a.subject === "#LOSS");
    expect(anomaly?.severity).toBe("high");
  });

  it("flags orders booked with no item costs as unbooked profit", () => {
    const orders = baseline(10).map((o, i) =>
      i === 0
        ? makeOrder({
            external_id: "ext-nocost",
            order_number: "#NOCOST",
            items: [makeItem({ quantity: 2, unit_price: 50, unit_cost: 0 })],
          })
        : o,
    );
    const anomaly = detectAnomalies(orders).find((a) => a.subject === "cogs");
    expect(anomaly?.detail).toMatch(/profit is overstated/i);
  });

  it("returns nothing when there is too little data to judge", () => {
    expect(detectAnomalies(baseline(3))).toEqual([]);
    expect(detectAnomalies([])).toEqual([]);
  });
});

describe("forecastCashFlow", () => {
  /** A steadily improving weekly series. */
  function growingWeeks(weeks: number): Order[] {
    return Array.from({ length: weeks }, (_, i) =>
      makeOrder({
        external_id: `ext-${i}`,
        order_number: `#${i}`,
        ordered_at: new Date(Date.UTC(2026, 0, 5 + i * 7)).toISOString(),
        subtotal: 100 * (i + 1),
        shipping_amount: 0,
        total_amount: 100 * (i + 1),
        items: [makeItem({ quantity: 1, unit_price: 100 * (i + 1), unit_cost: 10 })],
      }),
    );
  }

  it("reports insufficient history rather than inventing a projection", () => {
    const forecast = forecastCashFlow([]);
    expect(forecast.projection).toEqual([]);
    expect(forecast.horizonNet).toBe(0);
    expect(forecast.method).toMatch(/insufficient history/i);
  });

  it("projects the requested number of weeks with a bounded interval", () => {
    const forecast = forecastCashFlow(growingWeeks(8), 4);
    expect(forecast.projection).toHaveLength(4);
    for (const point of forecast.projection) {
      expect(point.low).toBeLessThanOrEqual(point.net);
      expect(point.net).toBeLessThanOrEqual(point.high);
      expect(Number.isFinite(point.net)).toBe(true);
    }
  });

  it("sums the projection into the horizon total", () => {
    const forecast = forecastCashFlow(growingWeeks(8), 4);
    const summed = forecast.projection.reduce((s, p) => s + p.net, 0);
    expect(forecast.horizonNet).toBeCloseTo(summed, 1);
  });

  it("projects into consecutive future weeks", () => {
    const forecast = forecastCashFlow(growingWeeks(6), 4);
    const weeks = forecast.projection.map((p) => p.week);
    for (let i = 1; i < weeks.length; i += 1) {
      expect(weeks[i] > weeks[i - 1]).toBe(true);
    }
    expect(weeks[0] > forecast.history[forecast.history.length - 1].week).toBe(true);
  });

  it("is deterministic for identical input", () => {
    const orders = growingWeeks(8);
    expect(forecastCashFlow(orders, 4)).toEqual(forecastCashFlow(orders, 4));
  });

  it("buckets orders into Monday-based weeks", () => {
    const forecast = forecastCashFlow(growingWeeks(4));
    for (const h of forecast.history) {
      expect(new Date(`${h.week}T00:00:00Z`).getUTCDay()).toBe(1);
    }
  });
});

describe("generateInsights", () => {
  function snapshot(orders: Order[]) {
    const entries = orders.map((o, i) => createSaleEntry(o, i + 1));
    const stats = computeStats("store-test", orders, 3650);
    return {
      stats,
      incomeStatement: buildIncomeStatementFromOrders(orders),
      balanceSheet: buildBalanceSheet(entries),
      monthly: [
        { label: "Jan", key: "2026-01", revenue: 100, net_profit: 20, cogs: 50, fees: 5 },
        { label: "Feb", key: "2026-02", revenue: 150, net_profit: 35, cogs: 70, fees: 6 },
      ],
      orders,
      journalEntries: entries,
      forecast: forecastCashFlow(orders),
      anomalies: detectAnomalies(orders),
      storeName: "Test Store",
      currency: "USD",
    };
  }

  it("produces grounded insights for a real book", () => {
    const orders = Array.from({ length: 8 }, (_, i) =>
      makeOrder({ external_id: `ext-${i}`, order_number: `#${i}` }),
    );
    const insights = generateInsights(snapshot(orders));
    expect(insights.length).toBeGreaterThan(0);
    for (const insight of insights) {
      expect(insight.title.length).toBeGreaterThan(0);
      expect(insight.body.length).toBeGreaterThan(0);
      expect(["positive", "neutral", "warning"]).toContain(insight.tone);
    }
  });

  it("quotes the margin it was actually given", () => {
    const orders = Array.from({ length: 8 }, (_, i) =>
      makeOrder({ external_id: `ext-${i}`, order_number: `#${i}` }),
    );
    const snap = snapshot(orders);
    const marginInsight = generateInsights(snap).find((i) => i.title.startsWith("Net margin"));
    expect(marginInsight?.title).toBe(
      `Net margin is ${(snap.stats.net_margin * 100).toFixed(1)}%`,
    );
  });

  it("does not invent a profitability insight when there is no revenue", () => {
    const snap = snapshot([]);
    const insights = generateInsights(snap);
    expect(insights.some((i) => i.title.startsWith("Net margin"))).toBe(false);
  });

  it("is deterministic for identical input", () => {
    const orders = Array.from({ length: 8 }, (_, i) =>
      makeOrder({ external_id: `ext-${i}`, order_number: `#${i}` }),
    );
    expect(generateInsights(snapshot(orders))).toEqual(generateInsights(snapshot(orders)));
  });
});

describe("profit math stability", () => {
  it("keeps aggregate profit equal to the sum of its parts", () => {
    const orders = Array.from({ length: 10 }, (_, i) =>
      makeOrder({
        external_id: `ext-${i}`,
        order_number: `#${i}`,
        refund_amount: i % 3 === 0 ? 5 : 0,
      }),
    );
    const agg = computeAggregateProfit(orders);
    expect(agg.net_profit).toBeCloseTo(
      orders.reduce((s, o) => s + computeAggregateProfit([o]).net_profit, 0),
      1,
    );
  });
});