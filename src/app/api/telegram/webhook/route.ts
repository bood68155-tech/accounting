import { NextResponse } from "next/server";
import { bindTelegramChat } from "@/lib/data/telegramLinks";
import {
  cancelTelegramAuth,
  getTelegramSession,
  startTelegramAuth,
  upsertTelegramSession,
  verifyTelegramCredentials,
} from "@/lib/data/telegramAuth";
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
  type TelegramChat,
  type TelegramUpdate,
} from "@/lib/notifications/telegram";
import {
  escapeHtml,
  sendTelegram,
  TELEGRAM_API_BASE,
  type HttpClient,
} from "@/lib/notifications/channels";

export const dynamic = "force-dynamic";

/**
 * POST /api/telegram/webhook — Telegram inbound updates for the digest bot and
 * the account-linking bot.
 *
 * Two flows share this endpoint:
 *
 *  1. `/start <tenant_link_token>` — the store digest handshake. The token
 *     resolves to exactly one tenant schema, and the incoming `chat_id` is
 *     written into that store's `digest_settings`. This is the only path by
 *     which a chat id becomes trusted for digests; the token is single-use and
 *     short-lived.
 *
 *  2. `/start` (no token), then contact → email → app-password/PIN — the
 *     per-account verification flow in `src/lib/data/telegramAuth.ts`. The
 *     chat's step is persisted in `public.telegram_sessions`, because an
 *     inbound webhook carries no session and no tenant context.
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

  // ── Flow 2: account linking (contact → email → app password/PIN) ────────────
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

  // ── /start — begin (or restart) the flow and ask for the phone ─────────────
  if (command === "start") {
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
          `🎉 <b>Account linked!</b>\n\n${escapeHtml(label)} is now connected to this chat.\n\n` +
            "You'll receive your store notifications here.",
        );
        return true;
      }
      await sendText(chatId, result.reason ?? "Verification failed. Send /start to try again.");
      return true;
    }

    // ── Already verified — nothing left to do ───────────────────────────────
    case "verified":
      await sendText(
        chatId,
        "This chat is already linked to an account. Send /start to re-verify with different details.",
      );
      return true;

    // ── Still waiting on the phone: nudge toward the contact button ──────────
    case "awaiting_phone":
    default:
      await sendContactRequest(chatId);
      return true;
  }
}

// ── Telegram transport (interactive prompts must notify the user) ─────────────

interface SendOptions {
  /** Replace the reply keyboard with the default one. */
  removeKeyboard?: boolean;
  /** Show the phone-sharing button. */
  contactRequest?: boolean;
}

/**
 * Send an HTML message, optionally with a reply keyboard.
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
