import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Drive the webhook route through its real interface — an HTTP POST carrying a
 * Telegram update — with the persistence layer mocked in memory and the
 * outbound Bot API calls captured. This is what verifies the *wiring*: that
 * /start issues a request_contact button, that a shared contact advances to the
 * email step, that a valid email advances to the PIN step, and that a PIN runs
 * the verifier.
 */

interface Row {
  chatId: string;
  userId: string | null;
  phoneNumber: string | null;
  email: string | null;
  isVerified: boolean;
  state: string;
  attempts: number;
  [key: string]: unknown;
}

const sessions = new Map<string, Row>();

/** Stores returned by the mocked `fetchTelegramUserStores` (set per test). */
let stores: TelegramUserStore[] = [];

vi.mock("@/lib/data/telegramAuth", () => ({
  AUTH_MAX_ATTEMPTS: 5,
  AUTH_LOCK_MINUTES: 15,
  getTelegramSession: vi.fn(async (chatId: string) => sessions.get(chatId) ?? null),
  upsertTelegramSession: vi.fn(async (chatId: string, patch: Partial<Row>) => {
    const base: Row =
      sessions.get(chatId) ??
      ({
        chatId,
        userId: null,
        phoneNumber: null,
        email: null,
        isVerified: false,
        state: "awaiting_phone",
        attempts: 0,
      } satisfies Row);
    const next = { ...base, ...patch, updatedAt: new Date() };
    sessions.set(chatId, next);
    return next;
  }),
  startTelegramAuth: vi.fn(async (chatId: string) => {
    const row: Row = {
      chatId,
      userId: null,
      phoneNumber: null,
      email: null,
      isVerified: false,
      state: "awaiting_phone",
      attempts: 0,
      updatedAt: new Date(),
    };
    sessions.set(chatId, row);
    return row;
  }),
  cancelTelegramAuth: vi.fn(async (chatId: string) => {
    sessions.delete(chatId);
  }),
  verifyTelegramCredentials: vi.fn(async (input: { email: string }) => ({
    ok: true,
    user: { id: "u1", email: input.email, name: "Ada" },
  })),
  fetchTelegramUserStores: vi.fn(async () => stores),
  sessionLabel: (session: Row) => session.email ?? session.phoneNumber ?? "your account",
}));

// The store figures come from the accounting engines; the loaders are stubbed so
// these tests exercise the menu wiring, not the ledger math (covered elsewhere).
vi.mock("@/lib/data/digest", () => ({
  fetchOrdersForPeriod: vi.fn(async () => []),
  fetchLedgerForDigest: vi.fn(async () => []),
}));

import { POST } from "@/app/api/telegram/webhook/route";
import {
  cancelTelegramAuth,
  startTelegramAuth,
  upsertTelegramSession,
  verifyTelegramCredentials,
  type TelegramUserStore,
} from "@/lib/data/telegramAuth";

interface Sent {
  url: string;
  body: Record<string, unknown>;
}

let sent: Sent[] = [];

/** A fetch stub that records every outbound Bot API request. */
function installFetchStub() {
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body?: string }) => {
      sent.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : {} });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }),
  );
}

function post(update: unknown, secret = "s3cr3t"): Promise<Response> {
  return POST(
    new Request("http://test/api/telegram/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": secret,
      },
      body: JSON.stringify(update),
    }),
  );
}

const last = (): Sent => sent[sent.length - 1];

beforeEach(() => {
  process.env.TELEGRAM_WEBHOOK_SECRET = "s3cr3t";
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  if (typeof fetch !== "function") {
    /* the stub below always installs one */
  }
  installFetchStub();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  sessions.clear();
  stores = [];
});

describe("telegram webhook — account linking", () => {
  it("rejects an update without the webhook secret", async () => {
    const res = await post({ message: { text: "/start", chat: { id: 1 } } }, "wrong");
    expect(res.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("/start starts the flow and issues the native request_contact button", async () => {
    const res = await post({ message: { text: "/start", chat: { id: 111 } } });
    expect(res.status).toBe(200);
    expect(startTelegramAuth).toHaveBeenCalledWith("111");

    expect(last().url).toContain("sendMessage");
    const markup = last().body.reply_markup as { keyboard: Array<Array<Record<string, unknown>>> };
    expect(markup.keyboard[0][0].request_contact).toBe(true);
  });

  it("normalises a shared contact and moves to the email step", async () => {
    await post({ message: { contact: { phone_number: "+966 50 123 4567" }, chat: { id: 222 } } });

    expect(upsertTelegramSession).toHaveBeenCalledWith(
      "222",
      expect.objectContaining({ phoneNumber: "+966501234567", state: "awaiting_email" }),
    );
    expect(String(last().body.text)).toContain("Step 2 of 3");
    // The contact keyboard is dismissed once the number is captured.
    expect(last().body.reply_markup).toEqual({ remove_keyboard: true });
  });

  it("rejects a malformed email without advancing the flow", async () => {
    await post({ message: { text: "/start", chat: { id: 333 } } });
    await post({ message: { contact: { phone_number: "+966500000000" }, chat: { id: 333 } } });

    await post({ message: { text: "not-an-email", chat: { id: 333 } } });

    expect(upsertTelegramSession).not.toHaveBeenCalledWith(
      "333",
      expect.objectContaining({ state: "awaiting_pin" }),
    );
    expect(String(last().body.text)).toContain("doesn't look like an email");
  });

  it("stores a valid email and moves to the PIN step", async () => {
    await post({ message: { text: "/start", chat: { id: 444 } } });
    await post({ message: { contact: { phone_number: "+966500000000" }, chat: { id: 444 } } });

    await post({ message: { text: "User@Example.com", chat: { id: 444 } } });

    expect(upsertTelegramSession).toHaveBeenLastCalledWith("444", {
      email: "user@example.com",
      state: "awaiting_pin",
    });
    expect(String(last().body.text)).toContain("Step 3 of 3");
  });

  it("verifies phone + email + PIN and confirms the link", async () => {
    await post({ message: { text: "/start", chat: { id: 555 } } });
    await post({ message: { contact: { phone_number: "+966500000000" }, chat: { id: 555 } } });
    await post({ message: { text: "user@example.com", chat: { id: 555 } } });

    await post({ message: { text: "123456", chat: { id: 555 } } });

    expect(verifyTelegramCredentials).toHaveBeenCalledWith({
      chatId: "555",
      phoneNumber: "+966500000000",
      email: "user@example.com",
      secret: "123456",
    });
    expect(String(last().body.text)).toContain("Account linked");
  });

  it("/cancel abandons the flow", async () => {
    await post({ message: { text: "/start", chat: { id: 666 } } });
    await post({ message: { text: "/cancel", chat: { id: 666 } } });

    expect(cancelTelegramAuth).toHaveBeenCalledWith("666");
    expect(String(last().body.text)).toContain("Cancelled");
  });

  it("nudges an unknown chat back to the contact button", async () => {
    await post({ message: { text: "hello", chat: { id: 777 } } });

    const markup = last().body.reply_markup as { keyboard: Array<Array<Record<string, unknown>>> };
    expect(markup.keyboard[0][0].request_contact).toBe(true);
  });
});

// ── Post-verification store menu ──────────────────────────────────────────────

const STORE_ID = "11111111-1111-1111-1111-111111111111";

const sampleStore = (over: Partial<TelegramUserStore> = {}): TelegramUserStore => ({
  tenantId: "t1",
  tenantName: "Tenant A",
  schemaName: `tenant_${"a".repeat(32)}`,
  storeId: STORE_ID,
  storeName: "Store A",
  currency: "USD",
  ...over,
});

/** Run the full contact → email → PIN flow so the chat ends up verified. */
async function completeLinking(chatId: number): Promise<void> {
  await post({ message: { text: "/start", chat: { id: chatId } } });
  await post({ message: { contact: { phone_number: "+966500000000" }, chat: { id: chatId } } });
  await post({ message: { text: "user@example.com", chat: { id: chatId } } });
  await post({ message: { text: "123456", chat: { id: chatId } } });
}

/** The first message that carried an inline keyboard. */
function menuMessage(): Sent | undefined {
  return sent.find(
    (s) => ((s.body.reply_markup as { inline_keyboard?: unknown } | undefined)?.inline_keyboard),
  );
}

function seedVerified(chatId: string): void {
  sessions.set(chatId, {
    chatId,
    userId: "u1",
    phoneNumber: "+966500000000",
    email: "user@example.com",
    isVerified: true,
    state: "verified",
    attempts: 0,
  });
}

describe("telegram webhook — post-verification store menu", () => {
  it("offers balance, orders and summary buttons for each store after linking", async () => {
    stores = [sampleStore()];
    await completeLinking(901);

    const menu = menuMessage();
    expect(menu).toBeDefined();
    const keyboard = (menu!.body.reply_markup as {
      inline_keyboard: Array<Array<{ callback_data: string }>>;
    }).inline_keyboard;
    const datas = keyboard.flat().map((b) => b.callback_data);
    expect(datas).toContain(`bal:${STORE_ID}`);
    expect(datas).toContain(`ord:${STORE_ID}`);
    expect(datas).toContain(`sum:${STORE_ID}`);
    // Telegram rejects callback_data over 64 bytes.
    for (const d of datas) expect(Buffer.byteLength(d, "utf8")).toBeLessThanOrEqual(64);
  });

  it("explains the empty state when the user owns no stores", async () => {
    stores = [];
    await completeLinking(902);
    expect(String(last().body.text)).toContain("don't have any stores");
  });

  it("answers a balance tap with the store's balances", async () => {
    stores = [sampleStore()];
    seedVerified("903");
    await post({
      callback_query: { id: "cb-bal", data: `bal:${STORE_ID}`, message: { chat: { id: 903 } } },
    });

    expect(String(last().body.text)).toContain("Balance");
    expect(String(last().body.text)).toContain("Cash");
    // The loading spinner is always cleared.
    expect(sent.some((s) => s.url.includes("answerCallbackQuery"))).toBe(true);
  });

  it("renders the financial summary for a summary tap", async () => {
    stores = [sampleStore()];
    seedVerified("904");
    await post({
      callback_query: { id: "cb-sum", data: `sum:${STORE_ID}`, message: { chat: { id: 904 } } },
    });

    const text = String(last().body.text);
    expect(text).toContain("Store A");
    expect(text).toContain("Balances");
  });

  it("answers a recent-orders tap even when there are no orders", async () => {
    stores = [sampleStore()];
    seedVerified("905");
    await post({
      callback_query: { id: "cb-ord", data: `ord:${STORE_ID}`, message: { chat: { id: 905 } } },
    });

    expect(String(last().body.text)).toContain("No orders");
  });

  it("refuses a menu tap when the chat is not verified", async () => {
    stores = [sampleStore()];
    await post({
      callback_query: { id: "cb-x", data: `bal:${STORE_ID}`, message: { chat: { id: 906 } } },
    });

    expect(String(last().body.text)).toContain("link your account");
  });

  it("rejects a callback for a store the user does not own", async () => {
    stores = [];
    seedVerified("907");
    await post({
      callback_query: { id: "cb-y", data: `bal:${STORE_ID}`, message: { chat: { id: 907 } } },
    });

    expect(String(last().body.text)).toContain("no longer available");
  });
});
