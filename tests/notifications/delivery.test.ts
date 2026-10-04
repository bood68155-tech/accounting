import { describe, expect, it } from "vitest";
import { deliverDigest, type DigestStore, type DigestDeliveryRecord } from "@/lib/notifications/delivery";
import { buildDailyDigest } from "@/lib/notifications/digest";
import {
  digestIdempotencyKey,
  UNLINKED_TELEGRAM,
  type DigestSettings,
} from "@/lib/notifications/types";
import { addDaysIso, digestPeriodFor, isDueForSend, runDailyDigest, zonedDateParts } from "@/lib/notifications/runner";
import type { HttpClient } from "@/lib/notifications/channels";
import type { Order } from "@/types";

const PERIOD = { from: "2026-03-01", to: "2026-03-01" };
const DIGEST_DATE = "2026-03-01";

const order: Order = {
  store_id: "store-1",
  external_id: "ext-1",
  order_number: "ORD-1",
  customer_name: "Ada",
  currency: "USD",
  subtotal: 100,
  shipping_amount: 0,
  discount_amount: 0,
  tax_amount: 0,
  total_amount: 100,
  payment_gateway: "stripe",
  payment_fee: 3,
  shipping_cost: 0,
  refund_amount: 0,
  status: "paid",
  ordered_at: "2026-03-01T12:00:00.000Z",
  items: [{ sku: "A1", name: "Widget", quantity: 1, unit_price: 100, unit_cost: 40, line_subtotal: 100, line_cost: 40 }],
};

const entry = (n: number, date: string) => ({
  store_id: "store-1",
  entry_number: n,
  entry_date: date,
  description: `E${n}`,
  reference: `r${n}`,
  source: "order" as const,
  status: "posted" as const,
  lines: [
    { account_code: "1000", account_name: "Cash", account_type: "asset" as const, description: "", debit: 97, credit: 0 },
    { account_code: "5200", account_name: "Payment Processing Fees", account_type: "expense" as const, description: "", debit: 3, credit: 0 },
    { account_code: "4000", account_name: "Sales Revenue", account_type: "revenue" as const, description: "", debit: 0, credit: 100 },
  ],
});

/** In-memory DigestStore that records what the runner logged. */
function memoryStore(seed: string[] = []) {
  const sent = new Set<string>(seed);
  const records: DigestDeliveryRecord[] = [];
  const store: DigestStore = {
    alreadyDelivered: async (key) => sent.has(key),
    recordDelivery: async (record) => {
      const key = digestIdempotencyKey(record.store_id, record.digest_date, record.channel, record.destination);
      sent.add(key);
      records.push(record);
    },
  };
  return { store, records, sent };
}

const settings = (over: Partial<DigestSettings> = {}): DigestSettings => ({
  store_id: "store-1",
  enabled: true,
  channels: [{ channel: "telegram", destination: "12345" }],
  send_hour: 8,
  timezone: "UTC",
  currency: "USD",
  sections: { revenue: true, orders: true, cash: true, tax: true, credit: true, top_products: true },
  skip_when_empty: true,
  telegram: { ...UNLINKED_TELEGRAM },
  ...over,
});

const digest = buildDailyDigest({
  store: { id: "store-1", name: "Ada's Store", currency: "USD" },
  orders: [order],
  entries: [entry(1, "2026-03-01")],
  period: PERIOD,
  generated_at: "2026-03-02T08:00:00.000Z",
});

/** Build a fetch stub that replays a scripted sequence of responses. */
function stubFetch(responses: Array<{ ok: boolean; status: number; body?: unknown }>) {
  const calls: Array<{ url: string; init: { body: string; headers: Record<string, string> } }> = [];
  let i = 0;
  const fetchImpl: HttpClient = async (url, init) => {
    calls.push({ url, init });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return { ok: r.ok, status: r.status, json: async () => r.body ?? {} };
  };
  return { fetchImpl, calls };
}

const TG_CREDS = { bot_token: "tok" };
const WA_CREDS = { phone_number_id: "pid", access_token: "atk" };

const noSleep = async () => {};

describe("deliverDigest", () => {
  it("sends to Telegram and logs the delivery", async () => {
    const { store, records } = memoryStore();
    const { fetchImpl, calls } = stubFetch([
      { ok: true, status: 200, body: { ok: true, result: { message_id: 99 } } },
    ]);

    const result = await deliverDigest(
      settings(),
      digest,
      store,
      { fetch: fetchImpl, credentials: { telegram: TG_CREDS }, sleep: noSleep },
      { digestDate: DIGEST_DATE },
    );

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.results[0].provider_message_id).toBe("99");
    expect(calls[0].url).toContain("/bottok/sendMessage");
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("sent");
  });

  it("sends to WhatsApp with a bearer token and normalized recipient", async () => {
    const { store } = memoryStore();
    const { fetchImpl, calls } = stubFetch([{ ok: true, status: 200, body: { messages: [{ id: "wamid.9" }] } }]);

    const result = await deliverDigest(
      settings({ channels: [{ channel: "whatsapp", destination: "+966 50 123 4567" }] }),
      digest,
      store,
      { fetch: fetchImpl, credentials: { whatsapp: WA_CREDS }, sleep: noSleep },
      { digestDate: DIGEST_DATE },
    );

    expect(result.sent).toBe(1);
    expect(calls[0].url).toContain("/v21.0/pid/messages");
    expect(calls[0].init.headers.Authorization).toBe("Bearer atk");
    const body = JSON.parse(calls[0].init.body);
    expect(body.to).toBe("966501234567");
    expect(body.messaging_product).toBe("whatsapp");
  });

  it("fans out to every configured channel in one run", async () => {
    const { store } = memoryStore();
    const { fetchImpl, calls } = stubFetch([{ ok: true, status: 200, body: {} }]);

    const result = await deliverDigest(
      settings({
        channels: [
          { channel: "telegram", destination: "12345" },
          { channel: "whatsapp", destination: "+966501234567" },
        ],
      }),
      digest,
      store,
      { fetch: fetchImpl, credentials: { telegram: TG_CREDS, whatsapp: WA_CREDS }, sleep: noSleep },
      { digestDate: DIGEST_DATE },
    );

    expect(result.sent).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it("skips a destination that already received this digest", async () => {
    const key = digestIdempotencyKey("store-1", DIGEST_DATE, "telegram", "12345");
    const { store, records } = memoryStore([key]);
    const { fetchImpl, calls } = stubFetch([{ ok: true, status: 200, body: {} }]);

    const result = await deliverDigest(
      settings(),
      digest,
      store,
      { fetch: fetchImpl, credentials: { telegram: TG_CREDS }, sleep: noSleep },
      { digestDate: DIGEST_DATE },
    );

    expect(result.skipped).toBe(1);
    expect(result.results[0].reason).toMatch(/Already delivered/);
    expect(calls).toHaveLength(0); // no network call at all
    expect(records).toHaveLength(0);
  });

  it("retries a 500 then succeeds, and reports the attempt count", async () => {
    const { store } = memoryStore();
    const { fetchImpl, calls } = stubFetch([
      { ok: false, status: 500, body: { description: "Internal Server Error" } },
      { ok: true, status: 200, body: { ok: true, result: { message_id: 7 } } },
    ]);

    const result = await deliverDigest(
      settings(),
      digest,
      store,
      { fetch: fetchImpl, credentials: { telegram: TG_CREDS }, sleep: noSleep },
      { digestDate: DIGEST_DATE, maxAttempts: 3, backoffMs: 1 },
    );

    expect(result.sent).toBe(1);
    expect(result.results[0].attempts).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it("gives up after maxAttempts and does NOT log the failure, so the next cron can retry", async () => {
    const { store, records } = memoryStore();
    const { fetchImpl, calls } = stubFetch([{ ok: false, status: 503, body: { description: "down" } }]);

    const result = await deliverDigest(
      settings(),
      digest,
      store,
      { fetch: fetchImpl, credentials: { telegram: TG_CREDS }, sleep: noSleep },
      { digestDate: DIGEST_DATE, maxAttempts: 2, backoffMs: 1 },
    );

    expect(result.failed).toBe(1);
    expect(result.results[0].attempts).toBe(2);
    expect(result.results[0].error).toBe("down");
    expect(calls).toHaveLength(2);
    expect(records).toHaveLength(0);
  });

  it("does not retry a permanently invalid destination", async () => {
    const { store } = memoryStore();
    const { fetchImpl, calls } = stubFetch([{ ok: true, status: 200, body: {} }]);

    const result = await deliverDigest(
      settings({ channels: [{ channel: "telegram", destination: "!!" }] }),
      digest,
      store,
      { fetch: fetchImpl, credentials: { telegram: TG_CREDS }, sleep: noSleep },
      { digestDate: DIGEST_DATE, maxAttempts: 3, backoffMs: 1 },
    );

    expect(result.failed).toBe(1);
    expect(calls).toHaveLength(0); // rejected before any network call
    expect(result.results[0].error).toMatch(/is not a valid Telegram chat id/);
  });

  it("reports an unconfigured channel as skipped, not failed", async () => {
    const { store, records } = memoryStore();
    const { fetchImpl } = stubFetch([{ ok: true, status: 200, body: {} }]);

    const result = await deliverDigest(
      settings({
        channels: [
          { channel: "telegram", destination: "12345" },
          { channel: "whatsapp", destination: "+966501234567" },
        ],
      }),
      digest,
      store,
      { fetch: fetchImpl, credentials: { telegram: TG_CREDS }, sleep: noSleep },
      { digestDate: DIGEST_DATE },
    );

    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(records).toHaveLength(2); // the skip is recorded so it is not retried daily
    expect(records[1].error).toMatch(/No credentials configured for whatsapp/);
  });

  it("reads credentials from the environment when none are injected", async () => {
    const { store } = memoryStore();
    const { fetchImpl, calls } = stubFetch([{ ok: true, status: 200, body: {} }]);

    const result = await deliverDigest(
      settings(),
      digest,
      store,
      { fetch: fetchImpl, env: { TELEGRAM_BOT_TOKEN: "env-tok" }, sleep: noSleep },
      { digestDate: DIGEST_DATE },
    );

    expect(result.sent).toBe(1);
    expect(calls[0].url).toContain("/botenv-tok/sendMessage");
  });

  it("does nothing when the digest is disabled", async () => {
    const { store } = memoryStore();
    const { fetchImpl, calls } = stubFetch([{ ok: true, status: 200, body: {} }]);

    const result = await deliverDigest(
      settings({ enabled: false }),
      digest,
      store,
      { fetch: fetchImpl, credentials: { telegram: TG_CREDS }, sleep: noSleep },
      { digestDate: DIGEST_DATE },
    );

    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("stays silent on an empty day when skip_when_empty is set", async () => {
    const { store } = memoryStore();
    const { fetchImpl, calls } = stubFetch([{ ok: true, status: 200, body: {} }]);
    const quiet = buildDailyDigest({
      store: { id: "store-1", name: "Ada's Store", currency: "USD" },
      orders: [],
      entries: [],
      period: PERIOD,
    });

    const result = await deliverDigest(
      settings(),
      quiet,
      store,
      { fetch: fetchImpl, credentials: { telegram: TG_CREDS }, sleep: noSleep },
      { digestDate: DIGEST_DATE },
    );

    expect(result.skipped).toBe(1);
    expect(result.results[0].reason).toMatch(/skip_when_empty/);
    expect(calls).toHaveLength(0);
  });

  it("still sends an empty day when skip_when_empty is off", async () => {
    const { store } = memoryStore();
    const { fetchImpl } = stubFetch([{ ok: true, status: 200, body: {} }]);
    const quiet = buildDailyDigest({
      store: { id: "store-1", name: "Ada's Store", currency: "USD" },
      orders: [],
      entries: [],
      period: PERIOD,
    });

    const result = await deliverDigest(
      settings({ skip_when_empty: false }),
      quiet,
      store,
      { fetch: fetchImpl, credentials: { telegram: TG_CREDS }, sleep: noSleep },
      { digestDate: DIGEST_DATE },
    );

    expect(result.sent).toBe(1);
  });

  it("isolates a channel whose transport throws — the others still send", async () => {
    const { store } = memoryStore();
    // Telegram's endpoint blows up; WhatsApp answers normally.
    const flaky: HttpClient = async (url) => {
      if (url.includes("telegram")) throw new Error("network down");
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.ok" }] }) };
    };

    const result = await deliverDigest(
      settings({
        channels: [
          { channel: "telegram", destination: "12345" },
          { channel: "whatsapp", destination: "+966501234567" },
        ],
      }),
      digest,
      store,
      { fetch: flaky, credentials: { telegram: TG_CREDS, whatsapp: WA_CREDS }, sleep: noSleep },
      { digestDate: DIGEST_DATE, maxAttempts: 2, backoffMs: 1 },
    );

    expect(result.failed).toBe(1);
    expect(result.sent).toBe(1);
    expect(result.results.find((r) => r.channel === "telegram")?.error).toBe("network down");
    expect(result.results.find((r) => r.channel === "whatsapp")?.provider_message_id).toBe("wamid.ok");
  });
});

describe("timezone helpers", () => {
  it("reads the local date and hour in a zone", () => {
    // 2026-03-02T02:00Z is 05:00 in Riyadh (UTC+3).
    const riyadh = zonedDateParts(new Date("2026-03-02T02:00:00.000Z"), "Asia/Riyadh");
    expect(riyadh).toEqual({ year: "2026", month: "03", day: "02", hour: 5 });
    const utc = zonedDateParts(new Date("2026-03-02T02:00:00.000Z"), "UTC");
    expect(utc.hour).toBe(2);
  });

  it("renders midnight as hour 0, not 24", () => {
    expect(zonedDateParts(new Date("2026-03-02T00:00:00.000Z"), "UTC").hour).toBe(0);
  });

  it("covers the previous local day", () => {
    expect(digestPeriodFor(new Date("2026-03-02T08:00:00.000Z"), "UTC")).toEqual({
      from: "2026-03-01",
      to: "2026-03-01",
    });
    // 01:00Z on Mar 2 is 04:00 in Riyadh — still Mar 2 locally, so Mar 1.
    expect(digestPeriodFor(new Date("2026-03-02T01:00:00.000Z"), "Asia/Riyadh")).toEqual({
      from: "2026-03-01",
      to: "2026-03-01",
    });
    // 22:00Z on Mar 2 is already 01:00 on Mar 3 in Riyadh, so the local day
    // (and therefore the digest window) rolls forward a day ahead of UTC.
    expect(digestPeriodFor(new Date("2026-03-02T22:00:00.000Z"), "Asia/Riyadh")).toEqual({
      from: "2026-03-02",
      to: "2026-03-02",
    });
    // A zone behind UTC rolls the other way.
    expect(digestPeriodFor(new Date("2026-03-02T02:00:00.000Z"), "America/New_York")).toEqual({
      from: "2026-02-28",
      to: "2026-02-28",
    });
  });

  it("shifts ISO dates across month and year boundaries", () => {
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysIso("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("gates on the store's own send hour", () => {
    const s = settings({ send_hour: 8, timezone: "UTC" });
    expect(isDueForSend(s, new Date("2026-03-02T08:30:00.000Z"))).toBe(true);
    expect(isDueForSend(s, new Date("2026-03-02T09:30:00.000Z"))).toBe(false);
    expect(isDueForSend(settings({ send_hour: 5, timezone: "Asia/Riyadh" }), new Date("2026-03-02T02:30:00.000Z"))).toBe(true);
    expect(isDueForSend(settings({ enabled: false }), new Date("2026-03-02T08:30:00.000Z"))).toBe(false);
  });

  it("falls back to UTC rather than throwing on an invalid zone", () => {
    expect(isDueForSend(settings({ timezone: "Not/AZone" }), new Date("2026-03-02T08:30:00.000Z"))).toBe(true);
  });
});

describe("runDailyDigest", () => {
  it("keys idempotency off the period, not the wall clock", async () => {
    const { store, records } = memoryStore();
    const { fetchImpl } = stubFetch([{ ok: true, status: 200, body: {} }]);

    const result = await runDailyDigest({
      settings: settings(),
      store: { id: "store-1", name: "Ada's Store", currency: "USD" },
      orders: [order],
      entries: [entry(1, "2026-03-01")],
      period: PERIOD,
      digestDate: DIGEST_DATE,
      generatedAt: "2026-03-05T08:00:00.000Z",
      deliveryStore: store,
      deps: { fetch: fetchImpl, credentials: { telegram: TG_CREDS }, sleep: noSleep },
    });

    expect(result.delivery.digest_date).toBe(DIGEST_DATE);
    expect(records[0].digest_date).toBe(DIGEST_DATE);
    expect(result.digest.period).toEqual(PERIOD);
  });

  it("a second run on the same date sends nothing", async () => {
    const { store } = memoryStore();
    const { fetchImpl, calls } = stubFetch([{ ok: true, status: 200, body: {} }]);
    const deps = { fetch: fetchImpl, credentials: { telegram: TG_CREDS }, sleep: noSleep };
    const base = {
      settings: settings(),
      store: { id: "store-1", name: "Ada's Store", currency: "USD" },
      orders: [order],
      entries: [entry(1, "2026-03-01")],
      period: PERIOD,
      digestDate: DIGEST_DATE,
      deliveryStore: store,
      deps,
    };

    const first = await runDailyDigest(base);
    const second = await runDailyDigest(base);

    expect(first.delivery.sent).toBe(1);
    expect(second.delivery.sent).toBe(0);
    expect(second.delivery.skipped).toBe(1);
    expect(calls).toHaveLength(1);
  });
});
