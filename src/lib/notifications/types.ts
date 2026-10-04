/**
 * ── Daily digest notification types ──────────────────────────────────────────
 * Shared vocabulary between the digest builder, the channel adapters, the
 * delivery runner and the persistence layer.
 */

export type DigestChannelId = "telegram" | "whatsapp";

export const DIGEST_CHANNELS: DigestChannelId[] = ["telegram", "whatsapp"];

/** One place a digest gets delivered. */
export interface ChannelTarget {
  channel: DigestChannelId;
  /**
   * Telegram: the numeric chat id (or `@channelusername` for a public channel).
   * WhatsApp: the recipient's phone number in international format.
   */
  destination: string;
  /** Optional label shown in delivery logs, e.g. "Ops group". */
  label?: string;
}

/**
 * A type alias rather than an interface on purpose: only aliases carry an
 * implicit index signature, which is what lets DigestSections be assigned
 * straight into a Drizzle `jsonb().$type<Record<string, unknown>>()` column.
 */
export type DigestSections = {
  revenue: boolean;
  orders: boolean;
  cash: boolean;
  tax: boolean;
  credit: boolean;
  top_products: boolean;
};

export const ALL_DIGEST_SECTIONS: DigestSections = {
  revenue: true,
  orders: true,
  cash: true,
  tax: true,
  credit: true,
  top_products: true,
};

/**
 * The owner's linked Telegram account.
 *
 * Populated by the `/start <token>` deep-link handshake, not by typing a chat
 * id — a bound chat_id is the only thing that can receive a digest, so it is
 * always proof the owner personally completed the handshake in that chat.
 */
export interface TelegramBinding {
  chat_id: string | null;
  chat_title: string | null;
  username: string | null;
  /** ISO timestamp of when the handshake completed. */
  linked_at: string | null;
  /** Bot that owns the binding, so a bot swap is visible rather than silent. */
  bot_username: string | null;
}

export const UNLINKED_TELEGRAM: TelegramBinding = {
  chat_id: null,
  chat_title: null,
  username: null,
  linked_at: null,
  bot_username: null,
};

export interface DigestSettings {
  store_id: string;
  enabled: boolean;
  channels: ChannelTarget[];
  /** 0–23, in the store's local `timezone`. */
  send_hour: number;
  /** IANA zone, e.g. "Asia/Riyadh". */
  timezone: string;
  currency: string;
  sections: DigestSections;
  /** Stay silent on a day with no orders and no alerts. */
  skip_when_empty: boolean;
  /** The owner's linked Telegram account, if any. */
  telegram: TelegramBinding;
}

export const DEFAULT_DIGEST_SETTINGS: DigestSettings = {
  store_id: "",
  enabled: true,
  channels: [],
  send_hour: 8,
  timezone: "UTC",
  currency: "USD",
  sections: { ...ALL_DIGEST_SECTIONS },
  skip_when_empty: true,
  telegram: { ...UNLINKED_TELEGRAM },
};

export type DeliveryStatus = "sent" | "failed" | "skipped";

export interface DeliveryAttempt {
  channel: DigestChannelId;
  destination: string;
  status: DeliveryStatus;
  attempts: number;
  provider_message_id?: string;
  error?: string;
  /** Set when the send was suppressed because the digest already went out. */
  reason?: string;
}

export interface DeliveryRunResult {
  store_id: string;
  digest_date: string;
  results: DeliveryAttempt[];
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Stable key for idempotency: one digest per store, per day, per destination.
 * The delivery log has a unique constraint on it, so a retried cron run
 * cannot double-send.
 */
export function digestIdempotencyKey(
  storeId: string,
  digestDate: string,
  channel: DigestChannelId,
  destination: string,
): string {
  return `${storeId}:${digestDate}:${channel}:${destination}`;
}

// ── Digest payload ──────────────────────────────────────────────────────────

export type AlertLevel = "info" | "warning" | "critical";

export interface DigestAlert {
  level: AlertLevel;
  message: string;
}

export interface DigestHeadline {
  revenue: number;
  net_profit: number;
  net_margin: number;
  orders: number;
  aov: number;
}

export interface DigestBalances {
  cash: number;
  receivable: number;
  inventory: number;
  tax_payable: number;
}

export interface DigestCreditLine {
  customer_name: string;
  outstanding: number;
  overdue: number;
  status: string;
}

export interface DigestProductLine {
  name: string;
  units: number;
  revenue: number;
}

export interface DailyDigest {
  store: { id: string; name: string; currency: string };
  /** Inclusive ISO dates covered by the digest. */
  period: { from: string; to: string };
  generated_at: string;
  headline: DigestHeadline;
  balances: DigestBalances;
  credit: {
    outstanding: number;
    overdue: number;
    blocked_customers: number;
    warning_customers: number;
    top_customers: DigestCreditLine[];
  };
  top_products: DigestProductLine[];
  alerts: DigestAlert[];
  /** True when there is nothing at all to report. */
  is_empty: boolean;
}
