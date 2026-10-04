import type { DeliveryAttempt, DigestChannelId } from "@/lib/notifications/types";

/**
 * ── Channel adapters (Telegram Bot API · WhatsApp Cloud API) ────────────────
 * Both providers are plain HTTPS POSTs, so each adapter takes an injectable
 * `fetch` and never touches module state. That keeps the send path unit
 * testable without a network or credentials, and lets the delivery runner
 * retry against a stub.
 */

export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** Minimal `fetch` shape — compatible with the global. */
export type HttpClient = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<HttpResponse>;

export interface TelegramCredentials {
  bot_token: string;
}

export interface WhatsAppCredentials {
  phone_number_id: string;
  access_token: string;
  /** Graph API version; defaults to the current one. */
  api_version?: string;
}

export type ChannelCredentials = TelegramCredentials | WhatsAppCredentials;

export const TELEGRAM_API_BASE = "https://api.telegram.org";
export const WHATSAPP_API_BASE = "https://graph.facebook.com";
export const WHATSAPP_DEFAULT_API_VERSION = "v21.0";

/**
 * Escape text for Telegram's HTML parse mode.
 *
 * HTML is used rather than MarkdownV2 because MarkdownV2 requires escaping a
 * dozen punctuation characters *everywhere* — one unescaped hyphen in a product
 * name makes the whole send fail. Only `& < >` can break HTML.
 */
export function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Normalize a WhatsApp recipient to bare digits with a leading country code.
 * Cloud API rejects spaces, dashes, parentheses and a leading `+`.
 */
export function normalizeWhatsAppPhone(input: string): string {
  const trimmed = input.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  return digits;
}

/** True when the phone looks like it has a country code and is plausible. */
export function isValidWhatsAppPhone(input: string): boolean {
  const digits = normalizeWhatsAppPhone(input);
  return digits.length >= 8 && digits.length <= 15;
}

/** True when a Telegram chat id is a plausible numeric id or @username. */
export function isValidTelegramChat(input: string): boolean {
  const trimmed = input.trim();
  if (/^-?\d+$/.test(trimmed)) return true;
  return /^@[A-Za-z0-9_]{5,}$/.test(trimmed);
}

/**
 * Read a channel's credentials out of the environment.
 *
 * Per-tenant overrides are supported through `settings.channels[].credentials`,
 * but the environment is the default so a deployment only needs secrets in one
 * place. Returns null when the channel is not configured — the delivery runner
 * reports that as "skipped", never as a hard failure.
 */
export function resolveChannelCredentials(
  channel: DigestChannelId,
  env: Record<string, string | undefined> = process.env,
): ChannelCredentials | null {
  if (channel === "telegram") {
    const bot_token = env.TELEGRAM_BOT_TOKEN?.trim();
    return bot_token ? { bot_token } : null;
  }
  const phone_number_id = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const access_token = env.WHATSAPP_ACCESS_TOKEN?.trim();
  return phone_number_id && access_token ? { phone_number_id, access_token } : null;
}

/** Statuses worth a retry: rate limits and server-side faults, not bad input. */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/** Extract a human-usable error message from either provider's JSON error. */
export function providerError(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.description === "string") return b.description; // Telegram
    const err = b.error as Record<string, unknown> | undefined;
    if (err && typeof err.message === "string") return err.message; // WhatsApp / Graph
    if (typeof b.message === "string") return b.message;
  }
  return `HTTP ${status}`;
}

/** Pull the provider's message id out of either response shape. */
export function providerMessageId(body: unknown): string | undefined {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const result = b.result as Record<string, unknown> | undefined;
    if (result && typeof result.message_id === "number") return String(result.message_id);
    const messages = b.messages as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(messages) && messages[0] && typeof messages[0].id === "string") {
      return messages[0].id;
    }
  }
  return undefined;
}

export interface SendOptions {
  fetch: HttpClient;
  /** Attempt number, recorded on the result for delivery-log diagnostics. */
  attempt?: number;
}

/**
 * Send one digest message to Telegram.
 *
 * @param html Already-rendered, HTML-escaped message body.
 */
export async function sendTelegram(
  destination: string,
  html: string,
  credentials: TelegramCredentials,
  options: SendOptions,
): Promise<DeliveryAttempt> {
  const attempt = options.attempt ?? 1;

  if (!isValidTelegramChat(destination)) {
    return {
      channel: "telegram",
      destination,
      status: "failed",
      attempts: attempt,
      error: `"${destination}" is not a valid Telegram chat id or @username.`,
    };
  }

  const url = `${TELEGRAM_API_BASE}/bot${credentials.bot_token}/sendMessage`;
  let response: HttpResponse;
  try {
    response = await options.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: destination,
        text: html,
        parse_mode: "HTML",
        // Digests are operational, not marketing — keep them out of the chat list.
        disable_notification: true,
        disable_web_page_preview: true,
      }),
    });
  } catch (error) {
    return {
      channel: "telegram",
      destination,
      status: "failed",
      attempts: attempt,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      channel: "telegram",
      destination,
      status: "failed",
      attempts: attempt,
      error: providerError(body, response.status),
    };
  }

  return {
    channel: "telegram",
    destination,
    status: "sent",
    attempts: attempt,
    provider_message_id: providerMessageId(body),
  };
}

/**
 * Send one digest message over the WhatsApp Cloud API.
 *
 * @param text Plain-text body — WhatsApp supports `*bold*`, not HTML or Markdown.
 */
export async function sendWhatsApp(
  destination: string,
  text: string,
  credentials: WhatsAppCredentials,
  options: SendOptions,
): Promise<DeliveryAttempt> {
  const attempt = options.attempt ?? 1;
  const to = normalizeWhatsAppPhone(destination);

  if (!isValidWhatsAppPhone(to)) {
    return {
      channel: "whatsapp",
      destination,
      status: "failed",
      attempts: attempt,
      error: `"${destination}" is not a valid international phone number.`,
    };
  }

  const version = credentials.api_version ?? WHATSAPP_DEFAULT_API_VERSION;
  const url = `${WHATSAPP_API_BASE}/${version}/${credentials.phone_number_id}/messages`;

  let response: HttpResponse;
  try {
    response = await options.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.access_token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: text },
      }),
    });
  } catch (error) {
    return {
      channel: "whatsapp",
      destination,
      status: "failed",
      attempts: attempt,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      channel: "whatsapp",
      destination,
      status: "failed",
      attempts: attempt,
      error: providerError(body, response.status),
    };
  }

  return {
    channel: "whatsapp",
    destination,
    status: "sent",
    attempts: attempt,
    provider_message_id: providerMessageId(body),
  };
}

/** Dispatch to the adapter for a channel. */
export async function sendDigestMessage(
  channel: DigestChannelId,
  destination: string,
  body: string,
  credentials: ChannelCredentials,
  options: SendOptions,
): Promise<DeliveryAttempt> {
  return channel === "telegram"
    ? sendTelegram(destination, body, credentials as TelegramCredentials, options)
    : sendWhatsApp(destination, body, credentials as WhatsAppCredentials, options);
}
