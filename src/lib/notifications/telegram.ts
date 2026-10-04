import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * ── Telegram deep linking & link tokens ─────────────────────────────────────
 * Pure helpers for the `/start <token>` handshake that binds an owner's
 * Telegram `chat_id` to one of their stores.
 *
 * Design notes:
 *   • Only the SHA-256 hash of a token is persisted, so a leaked database row
 *     cannot be replayed as a valid deep link.
 *   • Tokens carry a `tgl_` prefix and are validated by shape before any
 *     database work — a malformed `/start` payload is rejected without a query.
 *   • Webhook authenticity uses a constant-time compare, never `===`.
 */

/** Recognisable prefix so a token is greppable and never confused with other ids. */
export const LINK_TOKEN_PREFIX = "tgl_";

/** base64url of 32 bytes, plus the prefix. */
export const LINK_TOKEN_PATTERN = /^tgl_[A-Za-z0-9_-]{43}$/;

/** How long a minted link stays valid before it must be re-requested. */
export const DEFAULT_LINK_TOKEN_TTL_HOURS = 24;

/** Mint a fresh single-use link token (256 bits of entropy). */
export function createLinkToken(): string {
  return `${LINK_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** Shape check only — says nothing about whether the token exists. */
export function isValidLinkToken(token: string | null | undefined): boolean {
  return typeof token === "string" && LINK_TOKEN_PATTERN.test(token.trim());
}

/** Hash a token for storage/lookup. Normalized first so casing/space can't fork. */
export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

/**
 * Build the `t.me` deep link the owner opens.
 *
 * @param botUsername Bot handle without the leading `@`.
 * @param token       The minted link token.
 */
export function telegramDeepLink(botUsername: string, token: string): string {
  const bot = botUsername.trim().replace(/^@/, "");
  return `https://t.me/${encodeURIComponent(bot)}?start=${encodeURIComponent(token.trim())}`;
}

export interface ParsedStart {
  /** The command word, always lowercased (`start`, `help`, …). */
  command: string;
  /** Everything after the command, or null when the message carried none. */
  payload: string | null;
  /** The `/command@BotName` form Telegram sends in groups. */
  botMention: string | null;
}

/**
 * Parse a Telegram command message.
 *
 * Handles the two forms Telegram actually delivers:
 *   `/start tgl_xxx`        — private chat with the bot
 *   `/start@my_bot tgl_xxx` — group chat, where commands are bot-addressed
 *
 * Returns null for anything that is not a command, so ordinary chat text can
 * never be mistaken for a link attempt.
 */
export function parseTelegramCommand(text: string | null | undefined): ParsedStart | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const match = /^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match) return null;

  const command = match[1].toLowerCase();
  const botMention = match[2] ?? null;
  // Telegram appends the command when a deep link has no payload; treat a
  // payload equal to the command as absent.
  const raw = match[3]?.trim();
  const payload = !raw || raw === command || raw === `@${botMention}` ? null : raw;

  return { command, payload, botMention };
}

/**
 * Extract the link token from a `/start` message.
 *
 * Only `/start` carries a token — a `/help tgl_…` must not bind anything.
 * Returns null when the command is wrong or the payload is not token-shaped.
 */
export function extractLinkToken(text: string | null | undefined): string | null {
  const parsed = parseTelegramCommand(text);
  if (!parsed || parsed.command !== "start" || !parsed.payload) return null;
  const token = parsed.payload.trim();
  return isValidLinkToken(token) ? token : null;
}

/**
 * Constant-time compare of the webhook secret.
 *
 * Telegram sends the configured secret in `X-Telegram-Bot-Api-Secret-Token`.
 * `timingSafeEqual` throws on length mismatch, so both sides are hashed to a
 * fixed width first — that keeps the compare constant-time without leaking the
 * expected length.
 */
export function verifyTelegramWebhookSecret(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// ── Update shapes ───────────────────────────────────────────────────────────

export interface TelegramChat {
  id: number | string;
  type?: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramMessage {
  message_id?: number;
  text?: string | null;
  chat?: TelegramChat;
  from?: TelegramChat;
  date?: number;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: TelegramMessage;
  channel_post?: TelegramMessage;
  my_chat_member?: { chat?: TelegramChat; from?: TelegramChat };
}

/**
 * Pull the actionable message out of an update.
 *
 * `channel_post` is the group/channel equivalent of `message` — an owner who
 * connects from a channel announcement would otherwise be silently ignored.
 */
export function extractMessage(update: TelegramUpdate): TelegramMessage | null {
  return update.message ?? update.channel_post ?? null;
}

/**
 * Best-effort human label for a chat, used in the settings UI and in the
 * confirmation message ("Connected: Ada's Store").
 */
export function describeChat(chat: TelegramChat | undefined): string {
  if (!chat) return "Unknown chat";
  if (chat.title) return chat.title;
  if (chat.username) return `@${chat.username}`;
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ").trim();
  if (name) return name;
  return `Chat ${chat.id}`;
}

/** Telegram chat ids are integers; normalise to a string for storage. */
export function normalizeChatId(chat: TelegramChat | undefined): string | null {
  if (!chat || chat.id === undefined || chat.id === null) return null;
  const id = String(chat.id).trim();
  return id === "" ? null : id;
}
