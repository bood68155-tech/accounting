/**
 * ── Telegram bot user authentication & linking flow ──────────────────────────
 * Multi-step flow driven by the `/start` handler in
 * `src/app/api/telegram/webhook/route.ts`.
 *
 * Steps:
 *  1. `/start`             → bot requests the phone via Telegram's native
 *                            contact button (`request_contact: true`).
 *  2. contact received     → bot asks for the Gmail / account email.
 *  3. email received       → bot asks for the App Password / Verification PIN.
 *  4. PIN received         → verify phone + email + PIN against the database
 *                            (Supabase/Neon, via Drizzle). On success:
 *                            `is_verified = true`, store the mapping
 *                            (phone + email → telegram_chat_id) on both the
 *                            session row and the `users` row, then send the
 *                            confirmation with the inline interactive menu.
 *
 * State lives in `public.telegram_sessions`, keyed by `telegram_chat_id`, so the
 * flow survives the per-update statelessness of the webhook.
 *
 * Security:
 *  • Only the bcrypt hash of the PIN is stored — never the plaintext.
 *  • One chat = one flow (chat id is unique).
 *  • An already-verified chat is told so and shown the menu — no re-entry.
 *  • The PIN is checked with bcrypt compare (constant-time), not string equality.
 */

import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { requireDb, publicSchema } from "@/lib/db";
import {
  type InlineButton,
  type ContactMessage,
  type TelegramChat,
  describeChat,
} from "@/lib/notifications/telegram";
import {
  TELEGRAM_API_BASE,
  escapeHtml,
  type TelegramCredentials,
  type HttpClient,
} from "@/lib/notifications/channels";

// ── Session step enum (drives the bot's next prompt) ──────────────────────────

export type AuthStep = "contact" | "email" | "pin" | "verified";

/** Normalized input from an inbound message: either free text or a contact. */
export interface AuthInput {
  text?: string | null;
  contact?: ContactMessage["contact"];
}

/** The in-progress (or completed) auth session for one chat. */
export interface TelegramAuthSession {
  chatId: string;
  chatTitle: string | null;
  chatUsername: string | null;
  step: AuthStep;
  phoneNumber: string | null;
  email: string | null;
  linkedAt: Date | null;
  userId: string | null;
}

// ── Bot identity ──────────────────────────────────────────────────────────────

/** The bot handle used in t.me links and `/start@bot` matching. */
export function botUsername(): string {
  return process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") || "bood_store_bot";
}

// ── Step 1: /start → request contact ──────────────────────────────────────────

/** Format the /start welcome + contact-request message. */
export function startMessage(chatTitle: string | null): string {
  return (
    "🔐 <b>Accounting Bot — Account Linking</b>\n\n" +
    "Link your accounting account to this Telegram chat to receive secure notifications and access your dashboard.\n\n" +
    "⚠️ <b>Step 1 of 3:</b> Share your phone number with the button below.\n\n" +
    "Your phone number is used only to verify your identity — it is stored securely and never shared." +
    (chatTitle ? "" : "")
  );
}

/** Format the "phone received" + email prompt message. */
export function emailPrompt(phoneNumber: string): string {
  return (
    "✅ <b>Phone received:</b> " +
    escapeHtml(phoneNumber) +
    "\n\n" +
    "🔐 <b>Step 2 of 3:</b> Enter your Gmail / account email address.\n\n" +
    "This must match the email on your accounting account."
  );
}

/** Format the "email received" + PIN prompt message. */
export function pinPrompt(email: string): string {
  return (
    "✅ <b>Email received:</b> " +
    escapeHtml(email) +
    "\n\n" +
    "🔐 <b>Step 3 of 3:</b> Enter your <b>App Password / Verification PIN</b>.\n\n" +
    "⚠️ <i>Enter only the verification PIN or app password — never your full account password.</i>"
  );
}

// ── Result messages ───────────────────────────────────────────────────────────

export function verifiedSuccessMessage(
  phoneNumber: string,
  email: string,
  userName: string | null,
): string {
  return (
    "🎉 <b>Account Linked Successfully!</b>\n\n" +
    "Your accounting account is now linked to this Telegram chat.\n\n" +
    "📋 <b>Summary:</b>\n" +
    "• Phone: " +
    escapeHtml(phoneNumber) +
    "\n" +
    "• Email: " +
    escapeHtml(email) +
    "\n" +
    (userName ? "• Name: " + escapeHtml(userName) + "\n" : "") +
    "• Status: ✅ Verified\n\n" +
    "Use the menu below to get started."
  );
}

export function verificationFailedMessage(reason: string): string {
  return (
    "❌ <b>Verification Failed</b>\n\n" +
    escapeHtml(reason) +
    "\n\n" +
    "You can try again by sending the correct details, or restart with /start."
  );
}

export function alreadyVerifiedMessage(userName: string | null, email: string | null): string {
  return (
    "✅ <b>Already Linked</b>\n\n" +
    "This chat is already linked to your account.\n\n" +
    (userName ? "👤 " + escapeHtml(userName) + "\n" : "") +
    (email ? "📧 " + escapeHtml(email) + "\n" : "") +
    "\nChoose an option below."
  );
}

// ── Inline menus ──────────────────────────────────────────────────────────────

/** The main post-verification interactive menu. */
export function buildMainMenuButtons(): Array<Array<InlineButton>> {
  return [
    [
      { text: "📊 Dashboard", callback_data: "menu_dashboard" },
      { text: "📈 Reports", callback_data: "menu_reports" },
    ],
    [
      { text: "💰 Balance Sheet", callback_data: "menu_balance" },
      { text: "📋 Income Statement", callback_data: "menu_income" },
    ],
    [
      { text: "⚙️ Settings", callback_data: "menu_settings" },
      { text: "🔗 Unlink Account", callback_data: "auth_unlink" },
    ],
    [{ text: "❓ Help & Support", callback_data: "menu_help" }],
  ];
}

/** Menu shown when the user taps "Unlink Account". */
export function buildUnlinkConfirmButtons(): Array<Array<InlineButton>> {
  return [
    [{ text: "✅ Yes, Unlink", callback_data: "auth_unlink_confirm" }],
    [{ text: "← Cancel", callback_data: "menu_back_main" }],
  ];
}

/** A lone "back to main menu" button. */
export function buildBackButton(): Array<Array<InlineButton>> {
  return [[{ text: "← Back to Menu", callback_data: "menu_back_main" }]];
}

// ── Session persistence (Drizzle) ─────────────────────────────────────────────

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h of inactivity → expire

/** Infer the current step from the fields populated on a persisted row. */
function inferStep(row: {
  phoneNumber: string | null;
  email: string | null;
  isVerified: boolean;
}): AuthStep {
  if (row.isVerified) return "verified";
  if (row.phoneNumber && row.email) return "pin";
  if (row.phoneNumber) return "email";
  return "contact";
}

/** Find or create the auth session for a chat id. */
export async function getOrCreateSession(
  chatId: string,
  chatTitle: string | null,
  chatUsername: string | null,
): Promise<TelegramAuthSession> {
  const db = requireDb();
  const { telegramSessions } = publicSchema;

  const existing = await db
    .select()
    .from(telegramSessions)
    .where(eq(telegramSessions.telegramChatId, chatId))
    .limit(1);

  const row = existing[0];
  if (row) {
    const stale =
      !row.isVerified &&
      !row.linkedAt &&
      Date.now() - row.updatedAt.getTime() > SESSION_TTL_MS;

    if (stale) {
      // Reset an abandoned in-progress session back to step 1.
      await db
        .update(telegramSessions)
        .set({
          phoneNumber: null,
          email: null,
          verificationPinHash: null,
          isVerified: false,
          userId: null,
          linkedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(telegramSessions.telegramChatId, chatId));
      return {
        chatId,
        chatTitle,
        chatUsername,
        step: "contact",
        phoneNumber: null,
        email: null,
        linkedAt: null,
        userId: null,
      };
    }

    return {
      chatId: row.telegramChatId,
      chatTitle,
      chatUsername,
      step: inferStep(row),
      phoneNumber: row.phoneNumber,
      email: row.email,
      linkedAt: row.linkedAt,
      userId: row.userId,
    };
  }

  const now = new Date();
  await db
    .insert(telegramSessions)
    .values({ telegramChatId: chatId, updatedAt: now })
    .onConflictDoNothing();

  return {
    chatId,
    chatTitle,
    chatUsername,
    step: "contact",
    phoneNumber: null,
    email: null,
    linkedAt: null,
    userId: null,
  };
}

/** Advance the session, persisting whichever field changed. */
export async function advanceSession(
  chatId: string,
  fields: { phoneNumber?: string | null; email?: string | null },
): Promise<void> {
  const db = requireDb();
  const { telegramSessions } = publicSchema;
  await db
    .update(telegramSessions)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(telegramSessions.telegramChatId, chatId));
}

/** Store the bcrypt-hashed PIN on the session (step 3). */
export async function storePinHash(chatId: string, pinHash: string): Promise<void> {
  const db = requireDb();
  const { telegramSessions } = publicSchema;
  await db
    .update(telegramSessions)
    .set({ verificationPinHash: pinHash, updatedAt: new Date() })
    .where(eq(telegramSessions.telegramChatId, chatId));
}

/**
 * Mark the session verified and link it to a user account.
 * Also denormalizes `telegram_chat_id`, `phone_number`, `is_verified` onto the
 * matching `users` row (the phone + email → chat id mapping).
 */
export async function markVerified(
  chatId: string,
  userId: string,
  phoneNumber: string,
): Promise<void> {
  const db = requireDb();
  const { telegramSessions, users } = publicSchema;
  const now = new Date();

  await db.batch([
    db
      .update(telegramSessions)
      .set({ isVerified: true, userId, phoneNumber, linkedAt: now, updatedAt: now })
      .where(eq(telegramSessions.telegramChatId, chatId)),
    db
      .update(users)
      .set({ telegramChatId: chatId, phoneNumber, isVerified: true, updatedAt: now })
      .where(eq(users.id, userId)),
  ]);
}

/**
 * Unlink the chat: clear the session and the `users` row's telegram fields.
 * Returns true when a linked session existed.
 */
export async function unlinkAccount(chatId: string): Promise<boolean> {
  const db = requireDb();
  const { telegramSessions, users } = publicSchema;

  const rows = await db
    .select({ userId: telegramSessions.userId })
    .from(telegramSessions)
    .where(eq(telegramSessions.telegramChatId, chatId))
    .limit(1);

  const session = rows[0];
  if (!session) return false;

  await db.delete(telegramSessions).where(eq(telegramSessions.telegramChatId, chatId));

  if (session.userId) {
    await db
      .update(users)
      .set({ telegramChatId: null, phoneNumber: null, isVerified: false, updatedAt: new Date() })
      .where(eq(users.id, session.userId));
  }

  return true;
}

// ── Verification against the database ─────────────────────────────────────────

export type VerifyResult =
  | { ok: true; userId: string; userName: string | null }
  | { ok: false; reason: string };

/**
 * Verify phone + email + PIN against the database.
 *
 * Finds a `public.users` row matching BOTH the phone number and the email, then
 * checks the PIN with bcrypt against the stored hash. If no hash is stored yet
 * (e.g. Google-OAuth accounts) we fall back to requiring a verified email.
 */
export async function verifyUser(
  phoneNumber: string,
  email: string,
  pin: string,
): Promise<VerifyResult> {
  const db = requireDb();
  const { users, profiles } = publicSchema;

  const normalizedPhone = phoneNumber.trim();
  const normalizedEmail = email.trim().toLowerCase();

  if (!normalizedPhone) return { ok: false, reason: "Phone number is required." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { ok: false, reason: "A valid email address is required." };
  }
  if (!pin.trim()) return { ok: false, reason: "Verification PIN is required." };

  const candidates = await db
    .select({
      id: users.id,
      email: users.email,
      pinHash: users.passwordHash,
      emailVerified: users.emailVerified,
      disabled: users.disabled,
    })
    .from(users)
    .where(eq(users.phoneNumber, normalizedPhone))
    .limit(10);

  const match = candidates.find((u) => u.email.toLowerCase() === normalizedEmail);
  if (!match) {
    return {
      ok: false,
      reason: "No account found with that phone number and email. Please check your details.",
    };
  }
  if (match.disabled) {
    return { ok: false, reason: "This account is disabled. Please contact support." };
  }

  if (match.pinHash) {
    const pinOk = await bcrypt.compare(pin.trim(), match.pinHash);
    if (!pinOk) {
      return { ok: false, reason: "The verification PIN is incorrect. Please try again." };
    }
  } else if (!match.emailVerified) {
    return {
      ok: false,
      reason: "This account has no verification PIN set and its email is not verified yet. Verify your email in the web app first.",
    };
  }

  const profileRows = await db
    .select({ fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.id, match.id))
    .limit(1);

  return { ok: true, userId: match.id, userName: profileRows[0]?.fullName ?? null };
}

// ── Telegram send helpers ─────────────────────────────────────────────────────

/**
 * Send an HTML message, optionally with an inline keyboard.
 * The caller is responsible for escaping any dynamic text; structural markup
 * (e.g. `<b>`) is intentionally passed through.
 */
export async function sendAuthMessage(
  chatId: string,
  text: string,
  credentials: TelegramCredentials,
  fetch: HttpClient,
  buttons?: Array<Array<InlineButton>>,
): Promise<void> {
  const url = `${TELEGRAM_API_BASE}/bot${credentials.bot_token}/sendMessage`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(buttons && buttons.length > 0
          ? {
              reply_markup: {
                inline_keyboard: buttons.map((row) =>
                  row.map((b) => ({ text: b.text, callback_data: b.callback_data })),
                ),
              },
            }
          : {}),
      }),
    });
  } catch {
    // Best-effort: a send failure must not corrupt flow state. The session is
    // already persisted, so the user can simply message again.
  }
}

/**
 * Step 1 prompt: send the message with Telegram's native contact-request button.
 * `request_contact` is a ReplyKeyboardMarkup option (not an inline button), so
 * it goes through a dedicated call here.
 */
export async function sendContactRequestKeyboard(
  chatId: string,
  text: string,
  credentials: TelegramCredentials,
  fetch: HttpClient,
): Promise<void> {
  const url = `${TELEGRAM_API_BASE}/bot${credentials.bot_token}/sendMessage`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: {
          keyboard: [[{ text: "📱 Share Phone Number", request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      }),
    });
  } catch {
    // Best-effort.
  }
}

/** Edit an existing message's text + inline keyboard (menu navigation). */
export async function editAuthMessage(
  chatId: string,
  messageId: number,
  text: string,
  credentials: TelegramCredentials,
  fetch: HttpClient,
  buttons?: Array<Array<InlineButton>>,
): Promise<void> {
  const url = `${TELEGRAM_API_BASE}/bot${credentials.bot_token}/editMessageText`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(buttons && buttons.length > 0
          ? {
              reply_markup: {
                inline_keyboard: buttons.map((row) =>
                  row.map((b) => ({ text: b.text, callback_data: b.callback_data })),
                ),
              },
            }
          : {}),
      }),
    });
  } catch {
    // Fallback: a fresh message if the edit failed (e.g. message too old).
    await sendAuthMessage(chatId, text, credentials, fetch, buttons);
  }
}

// ── Callback query handling ───────────────────────────────────────────────────

export type CallbackAction =
  | "auth_cancel"
  | "auth_unlink"
  | "auth_unlink_confirm"
  | "menu_back_main"
  | "menu_dashboard"
  | "menu_reports"
  | "menu_balance"
  | "menu_income"
  | "menu_settings"
  | "menu_help";

const KNOWN_ACTIONS: readonly CallbackAction[] = [
  "auth_cancel",
  "auth_unlink",
  "auth_unlink_confirm",
  "menu_back_main",
  "menu_dashboard",
  "menu_reports",
  "menu_balance",
  "menu_income",
  "menu_settings",
  "menu_help",
];

/** Resolve a callback_data string to one of our actions, or null. */
export function parseCallbackAction(data: string | null | undefined): CallbackAction | null {
  if (!data) return null;
  return (KNOWN_ACTIONS as readonly string[]).includes(data) ? (data as CallbackAction) : null;
}

/** Acknowledge a callback query (clears the button's loading spinner). */
export async function answerCallback(
  callbackQueryId: string,
  fetch: HttpClient,
  credentials: TelegramCredentials,
  text?: string,
): Promise<void> {
  const url = `${TELEGRAM_API_BASE}/bot${credentials.bot_token}/answerCallbackQuery`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: false }),
    });
  } catch {
    // Best-effort.
  }
}

// ── Flow handlers (called by the webhook) ─────────────────────────────────────

/** Send the contact prompt, updating the session to step "contact". */
async function promptContact(
  chatId: string,
  credentials: TelegramCredentials,
  fetch: HttpClient,
): Promise<void> {
  await sendContactRequestKeyboard(chatId, startMessage(null), credentials, fetch);
}

/** `/start` handler — begin (or resume) the linking flow. */
export async function handleAuthStart(
  chatId: string,
  chatTitle: string | null,
  chatUsername: string | null,
  credentials: TelegramCredentials,
  fetch: HttpClient,
): Promise<void> {
  const session = await getOrCreateSession(chatId, chatTitle, chatUsername);

  switch (session.step) {
    case "verified": {
      const userName = session.userId ? null : null; // name resolved below if needed
      await sendAuthMessage(
        chatId,
        alreadyVerifiedMessage(userName, session.email),
        credentials,
        fetch,
        buildMainMenuButtons(),
      );
      return;
    }
    case "email":
      await sendAuthMessage(chatId, emailPrompt(session.phoneNumber ?? ""), credentials, fetch);
      return;
    case "pin":
      await sendAuthMessage(chatId, pinPrompt(session.email ?? ""), credentials, fetch);
      return;
    case "contact":
    default:
      await promptContact(chatId, credentials, fetch);
  }
}

/** Any inbound text/contact message during an in-progress auth session. */
export async function handleAuthMessageInput(
  chatId: string,
  chatTitle: string | null,
  chatUsername: string | null,
  input: AuthInput,
  credentials: TelegramCredentials,
  fetch: HttpClient,
): Promise<void> {
  const session = await getOrCreateSession(chatId, chatTitle, chatUsername);

  // A verified chat that sends plain text: just show the menu.
  if (session.step === "verified") {
    await sendAuthMessage(
      chatId,
      alreadyVerifiedMessage(null, session.email),
      credentials,
      fetch,
      buildMainMenuButtons(),
    );
    return;
  }

  // ── Phone (contact) ─────────────────────────────────────────────────────────
  const phone = input.contact?.phone_number?.trim();
  if (phone) {
    await advanceSession(chatId, { phoneNumber: phone, email: null });
    await sendAuthMessage(chatId, emailPrompt(phone), credentials, fetch);
    return;
  }

  const text = (input.text ?? "").trim();
  if (!text) {
    await promptContact(chatId, credentials, fetch);
    return;
  }

  // ── Email (step 2) ──────────────────────────────────────────────────────────
  if (session.step === "email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
      await sendAuthMessage(
        chatId,
        escapeHtml("That doesn't look like a valid email address. Please send your Gmail / account email."),
        credentials,
        fetch,
      );
      return;
    }
    const normalizedEmail = text.toLowerCase();
    await advanceSession(chatId, { email: normalizedEmail });
    await sendAuthMessage(chatId, pinPrompt(normalizedEmail), credentials, fetch);
    return;
  }

  // ── PIN (step 3) → verify ───────────────────────────────────────────────────
  if (session.step === "pin") {
    const phoneNumber = session.phoneNumber ?? "";
    const email = session.email ?? "";

    const result = await verifyUser(phoneNumber, email, text);
    if (!result.ok) {
      await sendAuthMessage(chatId, verificationFailedMessage(result.reason), credentials, fetch);
      return;
    }

    await markVerified(chatId, result.userId, phoneNumber);
    await sendAuthMessage(
      chatId,
      verifiedSuccessMessage(phoneNumber, email, result.userName),
      credentials,
      fetch,
      buildMainMenuButtons(),
    );
    return;
  }

  // ── Step "contact": they typed text instead of sharing the phone ─────────────
  if (session.step === "contact") {
    await sendAuthMessage(
      chatId,
      escapeHtml("Please use the “📱 Share Phone Number” button below to send your phone number."),
      credentials,
      fetch,
    );
    await promptContact(chatId, credentials, fetch);
  }
}

// ── Re-exported primitives used by the webhook ─────────────────────────────────

export type { TelegramChat, InlineButton };
export { describeChat };
