import {
  resolveChannelCredentials,
  sendDigestMessage,
  type ChannelCredentials,
  type HttpClient,
} from "@/lib/notifications/channels";
import { renderDigest } from "@/lib/notifications/digest";
import {
  digestIdempotencyKey,
  type DailyDigest,
  type DeliveryAttempt,
  type DeliveryRunResult,
  type DigestChannelId,
  type DigestSettings,
} from "@/lib/notifications/types";

/**
 * ── Digest delivery ─────────────────────────────────────────────────────────
 * Sends one rendered digest to every configured channel target. Three
 * properties matter and are enforced here rather than trusted to the caller:
 *
 *   • Idempotency — a store/date/channel/destination that already delivered is
 *     skipped, so a retried cron run never double-messages.
 *   • Bounded retry — transient faults are retried with backoff, but a rejected
 *     destination (bad phone number) is permanent and never retried.
 *   • Isolation — one bad destination never prevents the others from sending.
 */

/** Persisted log of what was delivered, keyed for idempotency. */
export interface DigestDeliveryRecord {
  store_id: string;
  digest_date: string;
  channel: DigestChannelId;
  destination: string;
  status: DeliveryAttempt["status"];
  attempts: number;
  provider_message_id?: string;
  error?: string;
}

/** Storage port — implemented over Drizzle in src/lib/data/digest.ts. */
export interface DigestStore {
  /** True when this exact destination already received this store's digest. */
  alreadyDelivered(key: string): Promise<boolean>;
  recordDelivery(record: DigestDeliveryRecord): Promise<void>;
}

export interface DeliveryDeps {
  fetch: HttpClient;
  /** Injected for deterministic retry tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Environment used for credential lookup. */
  env?: Record<string, string | undefined>;
  /** Credentials resolved by the caller; overrides the environment. */
  credentials?: Partial<Record<DigestChannelId, ChannelCredentials>>;
}

export interface DeliverOptions {
  /** ISO date (YYYY-MM-DD) the digest covers — part of the idempotency key. */
  digestDate: string;
  /** Total attempts per destination, including the first. Default 3. */
  maxAttempts?: number;
  /** Base backoff in ms; doubles per attempt. Default 500. */
  backoffMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Adapter failures that will never succeed on a retry: the destination itself is
 * malformed, so re-sending only burns the provider quota.
 */
function isPermanentFailure(error: string | undefined): boolean {
  if (!error) return false;
  return error.includes("is not a valid");
}

/**
 * Send one digest to one destination, retrying transient faults with
 * exponential backoff. The adapter collapses transport throws and 5xx into the
 * same `error` string, so both are retried; a validation error short-circuits.
 */
async function deliverToTarget(
  digest: DailyDigest,
  target: { channel: DigestChannelId; destination: string },
  credentials: ChannelCredentials,
  deps: DeliveryDeps,
  options: DeliverOptions,
): Promise<DeliveryAttempt> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const backoffMs = options.backoffMs ?? 500;
  const sleep = deps.sleep ?? defaultSleep;
  const body = renderDigest(digest, target.channel);

  let last: DeliveryAttempt | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await sendDigestMessage(target.channel, target.destination, body, credentials, {
      fetch: deps.fetch,
      attempt,
    });
    last = result;

    if (result.status === "sent") return result;
    if (isPermanentFailure(result.error)) return result;

    if (attempt < maxAttempts) await sleep(backoffMs * 2 ** (attempt - 1));
  }

  return (
    last ?? {
      channel: target.channel,
      destination: target.destination,
      status: "failed",
      attempts: maxAttempts,
      error: "Delivery failed for an unknown reason.",
    }
  );
}

/**
 * Deliver the digest to every configured channel.
 *
 * A channel with no credentials is reported as `skipped` rather than `failed`:
 * an operator who has not wired up WhatsApp yet should not see a red mark every
 * morning, and the run should still succeed for the channels that are live.
 */
export async function deliverDigest(
  settings: DigestSettings,
  digest: DailyDigest,
  store: DigestStore,
  deps: DeliveryDeps,
  options: DeliverOptions,
): Promise<DeliveryRunResult> {
  const emptyRun = (reason: string): DeliveryRunResult => ({
    store_id: settings.store_id,
    digest_date: options.digestDate,
    results: [{ channel: "telegram", destination: "", status: "skipped", attempts: 0, reason }],
    sent: 0,
    failed: 0,
    skipped: 1,
  });

  if (!settings.enabled) return emptyRun("Daily digest is disabled for this store.");
  if (settings.skip_when_empty && digest.is_empty) {
    return emptyRun("Nothing to report and skip_when_empty is on.");
  }

  const results: DeliveryAttempt[] = [];

  for (const target of settings.channels) {
    const key = digestIdempotencyKey(
      settings.store_id,
      options.digestDate,
      target.channel,
      target.destination,
    );

    if (await store.alreadyDelivered(key)) {
      results.push({
        channel: target.channel,
        destination: target.destination,
        status: "skipped",
        attempts: 0,
        reason: "Already delivered for this date.",
      });
      continue;
    }

    const credentials =
      deps.credentials?.[target.channel] ?? resolveChannelCredentials(target.channel, deps.env);

    if (!credentials) {
      const skipped: DeliveryAttempt = {
        channel: target.channel,
        destination: target.destination,
        status: "skipped",
        attempts: 0,
        reason: `No credentials configured for ${target.channel}.`,
      };
      results.push(skipped);
      await store.recordDelivery({
        store_id: settings.store_id,
        digest_date: options.digestDate,
        channel: skipped.channel,
        destination: skipped.destination,
        status: skipped.status,
        attempts: 0,
        error: skipped.reason,
      });
      continue;
    }

    let attempt: DeliveryAttempt;
    try {
      attempt = await deliverToTarget(digest, target, credentials, deps, options);
    } catch (error) {
      // Defensive net: one target blowing up must not abort the others.
      attempt = {
        channel: target.channel,
        destination: target.destination,
        status: "failed",
        attempts: 1,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    results.push(attempt);

    // Only non-transient outcomes are remembered: a failed send must stay
    // retryable on the next cron run, while a skip must not re-send either.
    if (attempt.status !== "failed") {
      await store.recordDelivery({
        store_id: settings.store_id,
        digest_date: options.digestDate,
        channel: attempt.channel,
        destination: attempt.destination,
        status: attempt.status,
        attempts: attempt.attempts,
        provider_message_id: attempt.provider_message_id,
        error: attempt.error,
      });
    }
  }

  return {
    store_id: settings.store_id,
    digest_date: options.digestDate,
    results,
    sent: results.filter((r) => r.status === "sent").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
  };
}
