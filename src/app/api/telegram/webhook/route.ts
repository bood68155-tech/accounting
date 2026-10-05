import { NextResponse } from "next/server";
import { bindTelegramChat } from "@/lib/data/telegramLinks";
import {
  extractLinkToken,
  extractMessage,
  extractContact,
  normalizeChatId,
  parseTelegramCommand,
  resolveTelegramBotUsername,
  verifyTelegramWebhookSecret,
  type TelegramChat,
  type TelegramUpdate,
} from "@/lib/notifications/telegram";
import { escapeHtml, sendTelegram, type HttpClient } from "@/lib/notifications/channels";
import {
  handleAuthStart,
  handleAuthMessageInput,
  sendAuthMessage,
  answerCallback,
  parseCallbackAction,
  buildMainMenuButtons,
  buildUnlinkConfirmButtons,
  unlinkAccount,
  type AuthInput,
} from "@/lib/telegram/auth-flow";

export const dynamic = "force-dynamic";

/**
 * POST /api/telegram/webhook — Telegram inbound updates for the digest bot and
 * the user account-linking flow.
 *
 * Handles two flows:
 *  1. `/start <tenant_link_token>` — deep-link handshake that binds this chat to
 *     a store's digest settings (existing behavior).
 *  2. `/start` (no token), or any message/contact during an in-progress auth
 *     session — the multi-step user authentication & linking flow
 *     (contact → email → PIN → verified), plus the post-verification inline menu.
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

  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) {
    return NextResponse.json(
      { error: "TELEGRAM_BOT_TOKEN is not configured — refusing inbound updates." },
      { status: 500 },
    );
  }
  const credentials = { bot_token: botToken };

  // ── Inline keyboard callbacks (post-verification menu) ───────────────────────
  const callback = update.callback_query;
  if (callback) {
    await handleCallbackQuery(callback, credentials, httpFetch);
    return NextResponse.json({ ok: true, handled: true });
  }

  const message = extractMessage(update);
  if (!message) {
    // Acknowledged but unhandled: Telegram retries non-2xx forever, and edits,
    // reactions and join events are not ours to act on.
    return NextResponse.json({ ok: true, handled: false });
  }

  const chat = message.chat;
  const chatId = normalizeChatId(chat);
  const chatTitle = chat ? (chat.title ?? null) : null;
  const chatUsername = chat?.username ?? null;

  const parsed = parseTelegramCommand(message.text);
  const token = extractLinkToken(message.text);
  const contact = extractContact(message);

  // ── Deep-link path: /start <tenant_link_token> ───────────────────────────────
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

    await reply(chatId, `Could not connect: ${result.reason ?? "unknown error"}`);
    return NextResponse.json({ ok: true, handled: true, bound: false, reason: result.reason });
  }

  if (!chatId) {
    return NextResponse.json({ ok: true, handled: false, reason: "no chat id" });
  }

  // ── User auth & linking flow: /start (no token), contact, or free text ────────
  try {
    if (parsed?.command === "start") {
      await handleAuthStart(chatId, chatTitle, chatUsername, credentials, httpFetch);
      return NextResponse.json({ ok: true, handled: true, flow: "auth", step: "start" });
    }

    const text = (message.text ?? "").trim();
    const phone = contact?.phone_number;
    if (phone || text.length > 0) {
      const input: AuthInput = phone ? { contact } : { text };
      await handleAuthMessageInput(chatId, chatTitle, chatUsername, input, credentials, httpFetch);
      return NextResponse.json({ ok: true, handled: true, flow: "auth" });
    }

    return NextResponse.json({ ok: true, handled: false });
  } catch (err) {
    // Never 500 a webhook: Telegram would redeliver the same doomed update.
    console.error("Telegram auth flow error:", err);
    return NextResponse.json({ ok: true, handled: false, reason: "auth flow error" });
  }
}

/** Handle a post-verification inline-menu tap. */
async function handleCallbackQuery(
  callback: NonNullable<TelegramUpdate["callback_query"]>,
  credentials: { bot_token: string },
  fetch: HttpClient,
): Promise<void> {
  const action = parseCallbackAction(callback.data);
  const chatId = normalizeChatId(callback.message?.chat);

  if (!action || !chatId) {
    await answerCallback(callback.id, fetch, credentials);
    return;
  }

  await answerCallback(callback.id, fetch, credentials);

  switch (action) {
    case "auth_cancel":
      await sendAuthMessage(
        chatId,
        escapeHtml("Account linking cancelled.\n\nSend /start to try again."),
        credentials,
        fetch,
      );
      break;
    case "auth_unlink":
      await sendAuthMessage(
        chatId,
        "⚠️ Unlink your accounting account from this chat?",
        credentials,
        fetch,
        buildUnlinkConfirmButtons(),
      );
      break;
    case "auth_unlink_confirm":
      if (await unlinkAccount(chatId)) {
        await sendAuthMessage(
          chatId,
          escapeHtml("✅ Your account has been unlinked.\n\nSend /start to relink."),
          credentials,
          fetch,
        );
      } else {
        await sendAuthMessage(chatId, escapeHtml("No linked account found."), credentials, fetch);
      }
      break;
    case "menu_back_main":
      await sendAuthMessage(chatId, escapeHtml("🏠 Main Menu"), credentials, fetch, buildMainMenuButtons());
      break;
    case "menu_dashboard":
      await sendAuthMessage(
        chatId,
        escapeHtml("📊 Dashboard\n\nOpen the web app to see your live figures."),
        credentials,
        fetch,
        buildMainMenuButtons(),
      );
      break;
    case "menu_reports":
      await sendAuthMessage(
        chatId,
        escapeHtml("📈 Reports\n\nGenerate detailed reports from the web app."),
        credentials,
        fetch,
        buildMainMenuButtons(),
      );
      break;
    case "menu_balance":
      await sendAuthMessage(
        chatId,
        escapeHtml("💰 Balance Sheet\n\nView your balance sheet in the web app."),
        credentials,
        fetch,
        buildMainMenuButtons(),
      );
      break;
    case "menu_income":
      await sendAuthMessage(
        chatId,
        escapeHtml("📋 Income Statement\n\nView your income statement in the web app."),
        credentials,
        fetch,
        buildMainMenuButtons(),
      );
      break;
    case "menu_settings":
      await sendAuthMessage(
        chatId,
        escapeHtml("⚙️ Settings\n\nManage notifications and linking from the web app."),
        credentials,
        fetch,
        buildMainMenuButtons(),
      );
      break;
    case "menu_help":
      await sendAuthMessage(
        chatId,
        escapeHtml("❓ Help & Support\n\nSend /start to restart the linking flow."),
        credentials,
        fetch,
        buildMainMenuButtons(),
      );
      break;
  }
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
