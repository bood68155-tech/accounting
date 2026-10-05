import { NextResponse } from "next/server";
import { bindTelegramChat } from "@/lib/data/telegramLinks";
import {
  cancelTelegramAuth,
  fetchTelegramUserStores,
  getTelegramSession,
  startTelegramAuth,
  upsertTelegramSession,
  verifyTelegramCredentials,
  type TelegramUserStore,
} from "@/lib/data/telegramAuth";
import { fetchLedgerForDigest, fetchOrdersForPeriod } from "@/lib/data/digest";
import { isValidEmail } from "@/lib/auth/otp";
import {
  extractContact,
  extractLinkToken,
  extractMessage,
  normalizeChatId,
  normalizeTelegramPhone,
  parseTelegramCommand,
  resolveTelegramBotUsername,
  verifyTelegramWebhookSecret,
  type TelegramCallbackQuery,
  type TelegramChat,
  type TelegramUpdate,
} from "@/lib/notifications/telegram";
import { buildDailyDigest, renderDigestHtml } from "@/lib/notifications/digest";
import {
  escapeHtml,
  sendTelegram,
  TELEGRAM_API_BASE,
  type HttpClient,
} from "@/lib/notifications/channels";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * POST /api/telegram/webhook — Telegram inbound updates for the digest bot and
 * the account-linking bot.
 *
 * Three flows share this endpoint:
 *
 *  1. `/start <tenant_link_token>` — the store digest handshake. The token
 *     resolves to exactly one tenant schema, and the incoming `chat_id` is
 *     written into that store's `digest_settings`. Single-use and short-lived.
 *
 *  2. `/start` (no token), then contact → email → app-password/PIN — the
 *     per-account verification flow in `src/lib/data/telegramAuth.ts`, whose
 *     step is persisted in `public.telegram_sessions` because a webhook carries
 *     no session or tenant context.
 *
 *  3. Inline-keyboard taps on the post-verification store menu, which read the
 *     store's balance, recent orders and financial summary through the same
 *     accounting engines the dashboard and digest use.
 *
 * Register with:
 *   curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
 *        -d url="$APP_URL/api/telegram/webhook" \
 *        -d secret_token="$TELEGRAM_WEBHOOK_SECRET"
 *
 * Auth: Telegram's `X-Telegram-Bot-Api-Secret-Token` header, compared in
 * constant time. Without a configured secret this endpoint refuses every
 * request rather than serving as an open binding oracle.
 */

/** Adapt the platform fetch to the narrow client the channel adapters expect. */
const httpFetch: HttpClient = (url, init) =>
  fetch(url, init).then((r) => ({
    ok: r.ok,
    status: r.status,
    json: () => r.json() as Promise<unknown>,
  }));

const LINK_WELCOME_HTML =
  "🔐 <b>Link your accounting account</b>\n\n" +
  "<b>Step 1 of 3</b> — tap the button below to share your phone number.\n\n" +
  "Your number is used only to verify your identity and is never shared.";

/** Inline keyboard rows — `callback_data` must stay under 64 bytes. */
type InlineKeyboard = Array<Array<{ text: string; callback_data: string }>>;

/** Keep the menu to a digestible size; each store adds two rows. */
const MAX_MENU_STORES = 3;

/** Orders listed by the "recent orders" button. */
const RECENT_ORDER_LIMIT = 5;

/** Days covered by the summary / recent-orders views. */
const SUMMARY_WINDOW_DAYS = 30;
const ORDERS_WINDOW_DAYS = 7;

export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "TELEGRAM_WEBHOOK_SECRET is not configured — refusing inbound updates." },
      { status: 500 },
    );
  }

  const provided = request.headers.get("x-telegram-bot-api-secret-token");
  if (!verifyTelegramWebhookSecret(provided, secret)) {
    return NextResponse.json({ error: "Invalid webhook secret." }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "Malformed JSON." }, { status: 400 });
  }

  // ── Inline-keyboard taps (post-verification store menu) ─────────────────────
  if (update.callback_query) {
    try {
      await handleCallbackQuery(update.callback_query);
    } catch (error) {
      console.error("[telegram] callback handling failed:", error);
    }
    return NextResponse.json({ ok: true, handled: true, flow: "callback" });
  }

  const message = extractMessage(update);
  if (!message) {
    // Acknowledged but unhandled: Telegram retries non-2xx forever, and edits,
    // reactions and join events are not ours to act on.
    return NextResponse.json({ ok: true, handled: false });
  }

  const chat = message.chat;
  const chatId = normalizeChatId(chat);
  const parsed = parseTelegramCommand(message.text);
  const token = extractLinkToken(message.text);

  // ── Flow 1: deep-link store binding (`/start <tenant_link_token>`) ──────────
  if (token) {
    if (!chatId) {
      return NextResponse.json({ ok: true, handled: false, reason: "no chat id" });
    }
    const botUsername = resolveTelegramBotUsername();
    const result = await bindTelegramChat(token, chat as TelegramChat, botUsername);

    if (result.ok) {
      await reply(
        chatId,
        `Connected ✓\n\nYour daily digest for ${result.storeName} will arrive here each morning.\n\n` +
          "Change or disconnect it any time from Settings.",
      );
      return NextResponse.json({ ok: true, handled: true, bound: true, store: result.storeName });
    }

    // Tell the owner why it failed, but keep the HTTP response 200 — Telegram
    // would otherwise redeliver the same doomed update indefinitely.
    await reply(chatId, `Could not connect: ${result.reason ?? "unknown error"}`);
    return NextResponse.json({ ok: true, handled: true, bound: false, reason: result.reason });
  }

  if (!chatId) {
    return NextResponse.json({ ok: true, handled: false, reason: "no chat id" });
  }

  // ── Flows 2 & 3: account linking, then the store menu ──────────────────────
  try {
    const handled = await handleAccountLinking({
      chatId,
      command: parsed?.command ?? null,
      text: message.text,
      contact: extractContact(message),
    });
    return NextResponse.json({ ok: true, handled, flow: "auth" });
  } catch (error) {
    // Never 500 an inbound update: Telegram would redeliver the same doomed
    // update forever. The failure is logged and the user can retry with /start.
    console.error("[telegram] account linking failed:", error);
    return NextResponse.json({ ok: true, handled: false, reason: "linking error" });
  }
}

// ── Account linking (contact → email → PIN) ───────────────────────────────────

interface LinkingInput {
  chatId: string;
  /** Lowercased command word when the message was a bot command, else null. */
  command: string | null;
  text: string | null | undefined;
  /** Present when the update carried a shared contact. */
  contact: { phone_number?: string | null } | null;
}

/**
 * Drive the contact → email → PIN state machine for one update.
 *
 * Returns whether the update was handled. Every branch persists its step in
 * `public.telegram_sessions` before the next webhook arrives, since all the
 * bot has between steps is that row.
 */
async function handleAccountLinking(input: LinkingInput): Promise<boolean> {
  const { chatId, command, text, contact } = input;

  // ── /cancel — abandon the flow ─────────────────────────────────────────────
  if (command === "cancel") {
    await cancelTelegramAuth(chatId);
    await sendText(chatId, "Cancelled. Send /start whenever you want to link your account.");
    return true;
  }

  // ── /start — resume a verified chat, else begin (or restart) the flow ───────
  if (command === "start") {
    const existing = await getTelegramSession(chatId);
    if (existing?.state === "verified" && existing.userId) {
      await sendStoreMenu(chatId, existing.userId);
      return true;
    }
    await startTelegramAuth(chatId);
    await sendContactRequest(chatId);
    return true;
  }

  // ── Step 1: the phone arrived as a shared contact ──────────────────────────
  const sharedPhone = contact?.phone_number?.trim();
  if (sharedPhone) {
    const phone = normalizeTelegramPhone(sharedPhone);
    if (!phone) {
      await sendContactRequest(chatId);
      return true;
    }
    await upsertTelegramSession(chatId, {
      phoneNumber: phone,
      email: null,
      state: "awaiting_email",
    });
    await sendTelegramHtml(
      chatId,
      `✅ Phone received: ${escapeHtml(phone)}\n\n<b>Step 2 of 3</b> — send the email address on your accounting account.`,
      { removeKeyboard: true },
    );
    return true;
  }

  const trimmed = (text ?? "").trim();
  if (!trimmed) return false;

  const session = await getTelegramSession(chatId);
  if (!session) {
    await sendContactRequest(chatId);
    return true;
  }

  switch (session.state) {
    // ── Step 2: the email arrived as plain text ─────────────────────────────
    case "awaiting_email": {
      if (!isValidEmail(trimmed)) {
        await sendText(
          chatId,
          "That doesn't look like an email address. Send the email on your account, e.g. you@gmail.com.",
        );
        return true;
      }
      const email = trimmed.toLowerCase();
      await upsertTelegramSession(chatId, { email, state: "awaiting_pin" });
      await sendTelegramHtml(
        chatId,
        "✅ Email received.\n\n<b>Step 3 of 3</b> — send your app password or the 6-digit verification PIN.\n\n" +
          "<i>Only ever send the verification code — never your full password.</i>",
      );
      return true;
    }

    // ── Step 3: the app password / PIN arrived — verify it ──────────────────
    case "awaiting_pin": {
      if (!session.phoneNumber || !session.email) {
        // The session lost its earlier steps; restart rather than guess.
        await startTelegramAuth(chatId);
        await sendContactRequest(chatId);
        return true;
      }
      const result = await verifyTelegramCredentials({
        chatId,
        phoneNumber: session.phoneNumber,
        email: session.email,
        secret: trimmed,
      });
      if (result.ok && result.user) {
        const label = result.user.name ?? result.user.email;
        await sendTelegramHtml(
          chatId,
          `🎉 <b>Account linked!</b>\n\n${escapeHtml(label)} is now connected to this chat.`,
        );
        // The post-verification menu is built from the user's own stores.
        await sendStoreMenu(chatId, result.user.id);
        return true;
      }
      await sendText(chatId, result.reason ?? "Verification failed. Send /start to try again.");
      return true;
    }

    // ── Already verified — show the menu ────────────────────────────────────
    case "verified":
      if (session.userId) {
        await sendStoreMenu(chatId, session.userId);
      } else {
        await sendText(chatId, "This chat is already linked. Send /start to re-verify.");
      }
      return true;

    // ── Still waiting on the phone: nudge toward the contact button ──────────
    case "awaiting_phone":
    default:
      await sendContactRequest(chatId);
      return true;
  }
}

// ── Post-verification inline menu ─────────────────────────────────────────────

/** ISO date (UTC) `offsetDays` from today — the windows the actions query. */
function isoDay(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Build the store menu from the stores a user owns.
 *
 * Each store contributes a titled row (tapping it shows the financial summary)
 * and a row with its balance and recent orders. Returns null when the user has
 * no stores, so the caller can send a "nothing to show" hint instead.
 */
function buildStoreMenu(stores: TelegramUserStore[]): InlineKeyboard | null {
  const shown = stores.slice(0, MAX_MENU_STORES);
  if (shown.length === 0) return null;

  const rows: InlineKeyboard = [];
  for (const store of shown) {
    rows.push([{ text: `🏪 ${store.storeName} — 📊 Summary`, callback_data: `sum:${store.storeId}` }]);
    rows.push([
      { text: "💰 Balance", callback_data: `bal:${store.storeId}` },
      { text: "🧾 Recent orders", callback_data: `ord:${store.storeId}` },
    ]);
  }
  return rows;
}

/** Fetch the user's stores and send the inline menu (or an empty-state hint). */
async function sendStoreMenu(chatId: string, userId: string): Promise<void> {
  const stores = await fetchTelegramUserStores(userId);
  const menu = buildStoreMenu(stores);

  if (!menu) {
    await sendText(
      chatId,
      "✅ Account linked. You don't have any stores yet — add one in the dashboard and it will appear here.",
    );
    return;
  }

  await sendTelegramHtml(chatId, "📂 <b>Your stores</b>\n\nChoose what you'd like to see:", {
    inlineKeyboard: menu,
  });
}

type StoreAction = "bal" | "ord" | "sum";

/** Parse `bal:<uuid>` / `ord:<uuid>` / `sum:<uuid>` callback data. */
function parseStoreCallback(data: string | null | undefined): {
  action: StoreAction;
  storeId: string;
} | null {
  if (!data) return null;
  const match = /^(bal|ord|sum):([0-9a-fA-F-]{36})$/.exec(data);
  if (!match) return null;
  return { action: match[1] as StoreAction, storeId: match[2] };
}

/** Handle a tap on the post-verification store menu. */
async function handleCallbackQuery(callback: TelegramCallbackQuery): Promise<void> {
  // Always acknowledge, even on failure: an unanswered tap leaves the button
  // spinning with no feedback for the user.
  await answerCallbackQuery(callback.id);

  const chatId = normalizeChatId(callback.message?.chat);
  if (!chatId) return;

  const parsed = parseStoreCallback(callback.data);
  if (!parsed) {
    await sendText(chatId, "That button is no longer available. Send /start to see your stores.");
    return;
  }

  const session = await getTelegramSession(chatId);
  if (!session?.userId || !session.isVerified) {
    await sendText(chatId, "Please link your account first — send /start.");
    return;
  }

  // Resolve the tapped store from the user's own stores: the callback carries
  // only an id, and this keeps the lookup scoped to what the chat may see.
  const stores = await fetchTelegramUserStores(session.userId);
  const store = stores.find((s) => s.storeId === parsed.storeId);
  if (!store) {
    await sendText(chatId, "That store is no longer available.");
    return;
  }

  try {
    await renderStoreAction(chatId, store, parsed.action);
  } catch (error) {
    // A tenant whose schema predates a migration has no tables to read; report
    // it rather than failing the whole update.
    console.error("[telegram] store action failed:", error);
    await sendText(chatId, "Couldn't load that right now. Please try again later.");
  }
}

/** Load a store's figures through the accounting engines and reply in chat. */
async function renderStoreAction(
  chatId: string,
  store: TelegramUserStore,
  action: StoreAction,
): Promise<void> {
  const to = isoDay();
  const from = isoDay(-(action === "sum" ? SUMMARY_WINDOW_DAYS : ORDERS_WINDOW_DAYS) + 1);

  const orders = await fetchOrdersForPeriod(store.schemaName, store.storeId, from, to);
  const entries = await fetchLedgerForDigest(store.schemaName, store.storeId);
  const digest = buildDailyDigest({
    store: { id: store.storeId, name: store.storeName, currency: store.currency },
    orders,
    entries,
    period: { from, to },
  });

  switch (action) {
    case "sum": {
      // renderDigestHtml already HTML-escapes its interpolations.
      await sendTelegramHtml(chatId, renderDigestHtml(digest));
      return;
    }
    case "bal": {
      const c = digest.balances;
      await sendTelegramHtml(
        chatId,
        `💰 <b>Balance — ${escapeHtml(store.storeName)}</b>\n\n` +
          `Cash: <b>${escapeHtml(formatCurrency(c.cash, store.currency))}</b>\n` +
          `Receivable: ${escapeHtml(formatCurrency(c.receivable, store.currency))}\n` +
          `Inventory: ${escapeHtml(formatCurrency(c.inventory, store.currency))}\n` +
          `Tax payable: ${escapeHtml(formatCurrency(c.tax_payable, store.currency))}`,
      );
      return;
    }
    case "ord": {
      const recent = [...orders]
        .sort((a, b) => b.ordered_at.localeCompare(a.ordered_at))
        .slice(0, RECENT_ORDER_LIMIT);

      if (recent.length === 0) {
        await sendText(
          chatId,
          `🧾 No orders for ${store.storeName} in the last ${ORDERS_WINDOW_DAYS} days.`,
        );
        return;
      }

      const lines = recent.map(
        (o) =>
          `#${escapeHtml(o.order_number)} · ${escapeHtml(o.customer_name)} · ` +
          `${escapeHtml(formatCurrency(o.total_amount, o.currency || store.currency))} · ${escapeHtml(o.status)}`,
      );
      await sendTelegramHtml(
        chatId,
        `🧾 <b>Recent orders — ${escapeHtml(store.storeName)}</b>\n\n${lines.join("\n")}`,
      );
      return;
    }
  }
}

// ── Telegram transport (interactive prompts must notify the user) ─────────────

interface SendOptions {
  /** Replace the reply keyboard with the default one. */
  removeKeyboard?: boolean;
  /** Show the phone-sharing button. */
  contactRequest?: boolean;
  /** Attach an inline keyboard. */
  inlineKeyboard?: InlineKeyboard;
}

/**
 * Send an HTML message, optionally with a reply or inline keyboard.
 *
 * Unlike the digest path (which uses `sendTelegram` and mutes notifications),
 * prompts are sent with notifications on — an auth step the user never sees
 * would stall the flow.
 */
async function sendTelegramHtml(
  chatId: string,
  html: string,
  options: SendOptions = {},
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return;

  const replyMarkup = options.contactRequest
    ? {
        keyboard: [[{ text: "📱 Share phone number", request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      }
    : options.inlineKeyboard
      ? { inline_keyboard: options.inlineKeyboard }
      : options.removeKeyboard
        ? { remove_keyboard: true }
        : undefined;

  try {
    await httpFetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: html,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
  } catch {
    // Swallowed on purpose: the session state is already persisted, so a failed
    // prompt is retried by the user's next message rather than a 500.
  }
}

/** Clear a button's loading spinner. */
async function answerCallbackQuery(callbackQueryId: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return;
  try {
    await httpFetch(`${TELEGRAM_API_BASE}/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
    });
  } catch {
    // Best-effort.
  }
}

/** Escape + send plain text, optionally adjusting the reply keyboard. */
async function sendText(chatId: string, text: string, options: SendOptions = {}): Promise<void> {
  await sendTelegramHtml(chatId, escapeHtml(text), options);
}

/** Ask for the phone with Telegram's native contact button (`request_contact`). */
async function sendContactRequest(chatId: string): Promise<void> {
  await sendTelegramHtml(chatId, LINK_WELCOME_HTML, { contactRequest: true });
}

/** Best-effort reply. A send failure must never change the webhook's outcome. */
async function reply(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return;
  try {
    // Escape rather than strip: the store name can contain '&' and stripping
    // would silently mangle it.
    await sendTelegram(chatId, escapeHtml(text), { bot_token: token }, { fetch: httpFetch });
  } catch {
    // Swallowed on purpose: the binding already succeeded and is persisted;
    // the confirmation message is a courtesy, not the transaction.
  }
}
