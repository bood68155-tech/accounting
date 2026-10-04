import { NextResponse } from "next/server";
import { bindTelegramChat } from "@/lib/data/telegramLinks";
import {
  extractLinkToken,
  extractMessage,
  normalizeChatId,
  parseTelegramCommand,
  resolveTelegramBotUsername,
  verifyTelegramWebhookSecret,
  type TelegramUpdate,
} from "@/lib/notifications/telegram";
import { escapeHtml, sendTelegram, type HttpClient } from "@/lib/notifications/channels";

export const dynamic = "force-dynamic";

/**
 * POST /api/telegram/webhook — Telegram inbound updates for the digest bot.
 *
 * Handles the `/start <tenant_link_token>` deep-link handshake: the token
 * resolves to exactly one tenant schema, and the incoming `chat_id` is written
 * into that store's `digest_settings`. This is the only path by which a chat id
 * becomes trusted, and the token is single-use and short-lived.
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

  // A bare /start (no token) is the "what is this bot?" case — answer it.
  const parsed = parseTelegramCommand(message.text);
  const token = extractLinkToken(message.text);

  if (!token) {
    if (parsed?.command === "start" && chatId) {
      await reply(
        chatId,
        "This bot delivers your store's daily accounting digest.\n\n" +
          "To connect it, open Settings in your dashboard and " +
          "press “Connect Telegram Bot”. That gives you a personal link that binds this chat.",
      );
    }
    return NextResponse.json({ ok: true, handled: false });
  }

  if (!chatId) {
    return NextResponse.json({ ok: true, handled: false, reason: "no chat id" });
  }

  const botUsername = resolveTelegramBotUsername();
  const result = await bindTelegramChat(token, chat!, botUsername);

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
