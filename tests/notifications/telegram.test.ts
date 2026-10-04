import { describe, expect, it } from "vitest";
import {
  createLinkToken,
  describeChat,
  extractLinkToken,
  extractMessage,
  hashLinkToken,
  isValidLinkToken,
  normalizeChatId,
  parseTelegramCommand,
  telegramDeepLink,
  verifyTelegramWebhookSecret,
  LINK_TOKEN_PREFIX,
} from "@/lib/notifications/telegram";
import { resolveDigestTargets } from "@/lib/notifications/delivery";
import { buildDailyDigest } from "@/lib/notifications/digest";
import { UNLINKED_TELEGRAM, type DigestSettings } from "@/lib/notifications/types";
import type { JournalEntry, Order } from "@/types";

const PERIOD = { from: "2026-03-01", to: "2026-03-01" };

const settings = (over: Partial<DigestSettings> = {}): DigestSettings => ({
  store_id: "store-1",
  enabled: true,
  channels: [],
  send_hour: 8,
  timezone: "UTC",
  currency: "USD",
  sections: { revenue: true, orders: true, cash: true, tax: true, credit: true, top_products: true },
  skip_when_empty: true,
  telegram: { ...UNLINKED_TELEGRAM },
  ...over,
});

describe("link tokens", () => {
  it("mints prefixed, high-entropy, URL-safe tokens", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => createLinkToken()));
    expect(tokens.size).toBe(50); // no collisions
    for (const t of tokens) {
      expect(t.startsWith(LINK_TOKEN_PREFIX)).toBe(true);
      expect(t).toMatch(/^tgl_[A-Za-z0-9_-]{43}$/);
      expect(isValidLinkToken(t)).toBe(true);
    }
  });

  it("never stores the raw token — only a hash", () => {
    const token = createLinkToken();
    const hash = hashLinkToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hash).not.toContain(LINK_TOKEN_PREFIX);
    expect(hashLinkToken(token)).toBe(hash); // stable
  });

  it("normalizes whitespace so a token cannot fork into two valid forms", () => {
    const token = createLinkToken();
    expect(hashLinkToken(`  ${token}  `)).toBe(hashLinkToken(token));
  });

  it("rejects malformed tokens before any database work", () => {
    expect(isValidLinkToken("")).toBe(false);
    expect(isValidLinkToken(null)).toBe(false);
    expect(isValidLinkToken("tgl_short")).toBe(false);
    expect(isValidLinkToken(`xgl_${"a".repeat(43)}`)).toBe(false);
    expect(isValidLinkToken(`${createLinkToken()}extra`)).toBe(false);
  });

  it("builds a t.me deep link with the bot handle and token", () => {
    const link = telegramDeepLink("bood_store_bot", "tgl_abc");
    expect(link).toBe("https://t.me/bood_store_bot?start=tgl_abc");
    // A leading @ is tolerated so the env var can be pasted either way.
    expect(telegramDeepLink("@bood_store_bot", "tgl_abc")).toBe(
      "https://t.me/bood_store_bot?start=tgl_abc",
    );
  });
});

describe("telegram command parsing", () => {
  const token = `tgl_${"a".repeat(43)}`;

  it("parses a plain /start payload", () => {
    expect(parseTelegramCommand(`/start ${token}`)).toEqual({
      command: "start",
      payload: token,
      botMention: null,
    });
  });

  it("parses the bot-addressed form Telegram sends in groups", () => {
    expect(parseTelegramCommand(`/start@bood_store_bot ${token}`)).toEqual({
      command: "start",
      payload: token,
      botMention: "bood_store_bot",
    });
  });

  it("treats a bare /start as having no payload", () => {
    expect(parseTelegramCommand("/start")).toEqual({ command: "start", payload: null, botMention: null });
    // Telegram echoes the command when a deep link carries no payload.
    expect(parseTelegramCommand("/start start")?.payload).toBeNull();
  });

  it("lower-cases the command", () => {
    expect(parseTelegramCommand("/START abc")?.command).toBe("start");
  });

  it("ignores ordinary chat text so it can never be read as a link", () => {
    expect(parseTelegramCommand("hello there")).toBeNull();
    expect(parseTelegramCommand("")).toBeNull();
    expect(parseTelegramCommand(null)).toBeNull();
    expect(extractLinkToken("just chatting")).toBeNull();
  });

  it("only accepts a token on /start, never on another command", () => {
    expect(extractLinkToken(`/start ${token}`)).toBe(token);
    expect(extractLinkToken(`/start@bood_store_bot ${token}`)).toBe(token);
    // /help tgl_… must not bind anything.
    expect(extractLinkToken(`/help ${token}`)).toBeNull();
    expect(extractLinkToken("/start not-a-token")).toBeNull();
    expect(extractLinkToken("/start")).toBeNull();
  });
});

describe("webhook secret verification", () => {
  it("accepts only the exact secret", () => {
    expect(verifyTelegramWebhookSecret("s3cr3t", "s3cr3t")).toBe(true);
    expect(verifyTelegramWebhookSecret("wrong", "s3cr3t")).toBe(false);
    expect(verifyTelegramWebhookSecret("s3cr3t", "s3cr3tx")).toBe(false);
  });

  it("fails closed when either side is missing", () => {
    expect(verifyTelegramWebhookSecret(null, "s3cr3t")).toBe(false);
    expect(verifyTelegramWebhookSecret("s3cr3t", undefined)).toBe(false);
    expect(verifyTelegramWebhookSecret("", "")).toBe(false);
  });
});

describe("update extraction", () => {
  it("reads message and channel_post", () => {
    expect(extractMessage({ message: { text: "/start" } })?.text).toBe("/start");
    expect(extractMessage({ channel_post: { text: "/start" } })?.text).toBe("/start");
    expect(extractMessage({ message: { text: "/start" }, channel_post: { text: "x" } })?.text).toBe("/start");
    expect(extractMessage({})).toBeNull();
  });

  it("normalises and validates chat ids", () => {
    expect(normalizeChatId({ id: 12345 })).toBe("12345");
    expect(normalizeChatId({ id: -1001234567890 })).toBe("-1001234567890");
    expect(normalizeChatId({ id: "" })).toBeNull();
    expect(normalizeChatId(undefined)).toBeNull();
  });

  it("describes a chat for the UI", () => {
    expect(describeChat({ id: 1, title: "Ops Room" })).toBe("Ops Room");
    expect(describeChat({ id: 1, username: "ops_team" })).toBe("@ops_team");
    expect(describeChat({ id: 1, first_name: "Ada", last_name: "L" })).toBe("Ada L");
    expect(describeChat(undefined)).toBe("Unknown chat");
  });
});

describe("resolveDigestTargets", () => {
  it("includes the linked chat even when no channels are configured", () => {
    const targets = resolveDigestTargets(
      settings({ telegram: { ...UNLINKED_TELEGRAM, chat_id: "555", chat_title: "Ops" } }),
    );
    expect(targets).toEqual([{ channel: "telegram", destination: "555", label: "Ops" }]);
  });

  it("falls back to username, then the chat id, for the label", () => {
    expect(
      resolveDigestTargets(settings({ telegram: { ...UNLINKED_TELEGRAM, chat_id: "555", username: "ada" } }))[0]
        .label,
    ).toBe("@ada");
    expect(
      resolveDigestTargets(settings({ telegram: { ...UNLINKED_TELEGRAM, chat_id: "555" } }))[0].label,
    ).toBe("Linked Telegram");
  });

  it("does not double-send when the linked chat is also in the channel list", () => {
    const targets = resolveDigestTargets(
      settings({
        channels: [
          { channel: "telegram", destination: "555" },
          { channel: "whatsapp", destination: "+966501234567" },
        ],
        telegram: { ...UNLINKED_TELEGRAM, chat_id: "555" },
      }),
    );
    expect(targets).toHaveLength(2);
    expect(targets.filter((t) => t.channel === "telegram")).toHaveLength(1);
  });

  it("keeps explicit channels when nothing is linked", () => {
    const targets = resolveDigestTargets(
      settings({ channels: [{ channel: "whatsapp", destination: "+966501234567" }] }),
    );
    expect(targets).toEqual([{ channel: "whatsapp", destination: "+966501234567" }]);
  });

  it("returns nothing when unlinked and unconfigured, so the store is skipped", () => {
    expect(resolveDigestTargets(settings())).toEqual([]);
    expect(resolveDigestTargets(settings({ channels: undefined as never }))).toEqual([]);
  });

  it("ignores a blank linked chat id", () => {
    expect(resolveDigestTargets(settings({ telegram: { ...UNLINKED_TELEGRAM, chat_id: "  " } }))).toEqual([]);
  });
});

describe("tenant-isolated digest dispatch", () => {
  const order = (over: Partial<Order> = {}): Order => ({
    store_id: "store-1",
    external_id: "e1",
    order_number: "ORD-1",
    customer_name: "Ada",
    currency: "USD",
    subtotal: 100,
    shipping_amount: 0,
    discount_amount: 0,
    tax_amount: 0,
    total_amount: 100,
    payment_gateway: "stripe",
    payment_fee: 0,
    shipping_cost: 0,
    refund_amount: 0,
    status: "paid",
    ordered_at: "2026-03-01T10:00:00.000Z",
    items: [{ sku: "A", name: "Widget", quantity: 1, unit_price: 100, unit_cost: 60, line_subtotal: 100, line_cost: 60 }],
    ...over,
  });

  /** A sale entry for one tenant, revenue in, COGS out. */
  const entry = (storeId: string, n: number, revenue: number, cogs: number): JournalEntry => ({
    store_id: storeId,
    entry_number: n,
    entry_date: "2026-03-01",
    description: `E${n}`,
    reference: `r${n}`,
    source: "order",
    status: "posted",
    lines: [
      { account_code: "1000", account_name: "Cash", account_type: "asset", description: "", debit: revenue, credit: 0 },
      { account_code: "4000", account_name: "Sales Revenue", account_type: "revenue", description: "", debit: 0, credit: revenue },
      { account_code: "5000", account_name: "COGS", account_type: "expense", description: "", debit: cogs, credit: 0 },
      { account_code: "1200", account_name: "Inventory", account_type: "asset", description: "", debit: 0, credit: cogs },
    ],
  });

  const tenantA = { id: "store-a", name: "Tenant A", currency: "USD" };
  const tenantB = { id: "store-b", name: "Tenant B", currency: "USD" };

  it("computes each tenant's P&L from only its own ledger", () => {
    const a = buildDailyDigest({
      store: tenantA,
      orders: [order({ store_id: "store-a" })],
      entries: [entry("store-a", 1, 100, 60)],
      period: PERIOD,
    });
    const b = buildDailyDigest({
      store: tenantB,
      orders: [order({ store_id: "store-b", order_number: "ORD-B" })],
      entries: [entry("store-b", 1, 500, 200)],
      period: PERIOD,
    });

    expect(a.headline.revenue).toBe(100);
    expect(a.headline.net_profit).toBe(40);
    expect(b.headline.revenue).toBe(500);
    expect(b.headline.net_profit).toBe(300);
    // Neither digest leaks the other's figures.
    expect(a.headline.revenue).not.toBe(b.headline.revenue);
    expect(a.balances.cash).toBe(100);
    expect(b.balances.cash).toBe(500);
  });

  it("keeps tenant A's numbers unchanged when tenant B's ledger is larger", () => {
    const alone = buildDailyDigest({
      store: tenantA,
      orders: [order()],
      entries: [entry("store-a", 1, 100, 60)],
      period: PERIOD,
    });
    // Same entries plus a second tenant's, passed in by mistake.
    const withOther = buildDailyDigest({
      store: tenantA,
      orders: [order()],
      entries: [entry("store-a", 1, 100, 60), entry("store-b", 1, 9999, 1)],
      period: PERIOD,
    });
    expect(withOther.headline.revenue).toBe(alone.headline.revenue);
    expect(withOther.headline.net_profit).toBe(alone.headline.net_profit);
  });

  it("counts orders and derives AOV per tenant", () => {
    const d = buildDailyDigest({
      store: tenantA,
      orders: [
        order({ store_id: "store-a", order_number: "O1" }),
        order({ store_id: "store-a", order_number: "O2", external_id: "e2" }),
        order({ store_id: "store-a", order_number: "O3", external_id: "e3" }),
      ],
      entries: [entry("store-a", 1, 100, 60)],
      period: PERIOD,
    });
    expect(d.headline.orders).toBe(3);
    expect(d.headline.aov).toBe(33.33);
  });
});
