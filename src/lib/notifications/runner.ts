import type { JournalEntry, Order } from "@/types";
import type { CreditPortfolio } from "@/lib/accounting/creditTerms";
import type { TaxPeriodReport } from "@/lib/accounting/taxEngine";
import { buildDailyDigest } from "@/lib/notifications/digest";
import { deliverDigest, type DeliveryDeps, type DigestStore } from "@/lib/notifications/delivery";
import type { DailyDigest, DeliveryRunResult, DigestSettings } from "@/lib/notifications/types";

/**
 * ── Digest runner ───────────────────────────────────────────────────────────
 * Orchestration only: decide which day a run covers, build the payload from the
 * journal, hand it to the delivery layer. Everything here is timezone-aware but
 * database-free, so the whole flow is testable with plain fixtures.
 */

/** `YYYY-MM-DD` parts of an instant as seen in a given IANA zone. */
export function zonedDateParts(date: Date, timeZone: string): {
  year: string;
  month: string;
  day: string;
  hour: number;
} {
  // en-CA formats as YYYY-MM-DD, which is exactly the shape we want.
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "0";
  // `hour: "24"` is how some ICU versions render midnight under hour12: false.
  const hour = Number(get("hour")) % 24;
  return { year: get("year"), month: get("month"), day: get("day"), hour };
}

/** Shift an ISO date by whole days. */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The window a digest covers: the previous local day.
 *
 * A digest sent at 08:00 local summarises yesterday, not a 24-hour window
 * ending at the send time — otherwise a quiet morning always reports a partial
 * day and a busy evening is invisible.
 */
export function digestPeriodFor(runAt: Date, timeZone: string): { from: string; to: string } {
  const { year, month, day } = zonedDateParts(runAt, timeZone);
  const localToday = `${year}-${month}-${day}`;
  const yesterday = addDaysIso(localToday, -1);
  return { from: yesterday, to: yesterday };
}

/**
 * Whether a store's configured send hour has arrived in its own timezone.
 * The cron runs hourly; this keeps each store on its own schedule.
 */
export function isDueForSend(settings: DigestSettings, now: Date): boolean {
  if (!settings.enabled) return false;
  let parts: { hour: number };
  try {
    parts = zonedDateParts(now, settings.timezone);
  } catch {
    // An invalid timezone must not wedge the whole cron — fall back to UTC.
    parts = zonedDateParts(now, "UTC");
  }
  return parts.hour === settings.send_hour;
}

export interface RunDigestInput {
  settings: DigestSettings;
  store: { id: string; name: string; currency: string };
  orders: Order[];
  entries: JournalEntry[];
  /** Digest payload source; omit when the store has no ledger activity. */
  tax?: TaxPeriodReport;
  credit?: CreditPortfolio;
  /** Overrides the auto-derived period (used by tests and manual re-sends). */
  period?: { from: string; to: string };
  /** Overrides the auto-derived digest date; part of the idempotency key. */
  digestDate?: string;
  generatedAt?: string;
  deliveryStore: DigestStore;
  deps: DeliveryDeps;
  maxAttempts?: number;
}

export interface RunDigestResult {
  digest: DailyDigest;
  delivery: DeliveryRunResult;
}

/**
 * Build and deliver one store's digest.
 *
 * The digest date is derived from the *period* rather than the wall clock, so a
 * manual re-send of a specific day is idempotent against that day instead of
 * always colliding with today's key.
 */
export async function runDailyDigest(input: RunDigestInput): Promise<RunDigestResult> {
  const period = input.period ?? digestPeriodFor(new Date(), input.settings.timezone);
  const digestDate = input.digestDate ?? period.to;

  const digest = buildDailyDigest({
    store: input.store,
    orders: input.orders,
    entries: input.entries,
    period,
    tax: input.tax,
    credit: input.credit,
    sections: input.settings.sections,
    ...(input.generatedAt ? { generated_at: input.generatedAt } : {}),
  });

  const delivery = await deliverDigest(
    input.settings,
    digest,
    input.deliveryStore,
    input.deps,
    {
      digestDate,
      ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
    },
  );

  return { digest, delivery };
}
