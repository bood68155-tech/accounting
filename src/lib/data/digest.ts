import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { getTenantTables, tenantDb } from "@/lib/db";
import type { DigestDeliveryRecord, DigestStore } from "@/lib/notifications/delivery";
import {
  ALL_DIGEST_SECTIONS,
  DEFAULT_DIGEST_SETTINGS,
  type DigestChannelId,
  type DigestSections,
  type DigestSettings,
  type ChannelTarget,
} from "@/lib/notifications/types";
import type { JournalEntry, Order, Store } from "@/types";

/**
 * ── Digest persistence + tenant data loading ────────────────────────────────
 * Every read here goes through `tenantDb(schema)` — tenant tables are never
 * queried through the public client, per the multi-tenant data-flow rules.
 *
 * The delivery store relies on the unique constraint on
 * (store_id, digest_date, channel, destination) for correctness. `alreadyDelivered`
 * is a fast path to avoid a pointless network call, not the guarantee.
 */

function isChannel(value: unknown): value is DigestChannelId {
  return value === "telegram" || value === "whatsapp";
}

/** Defensively narrow persisted JSON — it was written by an older code path. */
function parseChannels(raw: unknown): ChannelTarget[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): ChannelTarget[] => {
    if (!entry || typeof entry !== "object") return [];
    const e = entry as Record<string, unknown>;
    if (!isChannel(e.channel)) return [];
    if (typeof e.destination !== "string" || e.destination.trim() === "") return [];
    return [
      {
        channel: e.channel,
        destination: e.destination.trim(),
        ...(typeof e.label === "string" && e.label ? { label: e.label } : {}),
      },
    ];
  });
}

function parseSections(raw: unknown): DigestSections {
  if (!raw || typeof raw !== "object") return { ...ALL_DIGEST_SECTIONS };
  const r = raw as Record<string, unknown>;
  const merged: DigestSections = { ...ALL_DIGEST_SECTIONS };
  for (const key of Object.keys(ALL_DIGEST_SECTIONS) as (keyof DigestSections)[]) {
    if (typeof r[key] === "boolean") merged[key] = r[key];
  }
  return merged;
}

/** Load a store's digest settings, falling back to the defaults when unset. */
export async function fetchDigestSettings(
  schema: string,
  storeId: string,
): Promise<DigestSettings> {
  const db = tenantDb(schema);
  const t = getTenantTables(schema);

  const rows = await db
    .select()
    .from(t.digestSettings)
    .where(eq(t.digestSettings.storeId, storeId))
    .limit(1);

  const row = rows[0];
  if (!row) return { ...DEFAULT_DIGEST_SETTINGS, store_id: storeId, sections: { ...ALL_DIGEST_SECTIONS } };

  return {
    store_id: row.storeId,
    enabled: row.enabled,
    channels: parseChannels(row.channels),
    send_hour: row.sendHour,
    timezone: row.timezone,
    currency: row.currency,
    sections: parseSections(row.sections),
    skip_when_empty: row.skipWhenEmpty,
  };
}

/** Create or update a store's digest settings. */
export async function saveDigestSettings(
  schema: string,
  settings: DigestSettings,
): Promise<DigestSettings> {
  const db = tenantDb(schema);
  const t = getTenantTables(schema);

  await db
    .insert(t.digestSettings)
    .values({
      storeId: settings.store_id,
      enabled: settings.enabled,
      channels: settings.channels,
      sendHour: settings.send_hour,
      timezone: settings.timezone,
      currency: settings.currency,
      sections: settings.sections,
      skipWhenEmpty: settings.skip_when_empty,
    })
    .onConflictDoUpdate({
      target: t.digestSettings.storeId,
      set: {
        enabled: settings.enabled,
        channels: settings.channels,
        sendHour: settings.send_hour,
        timezone: settings.timezone,
        currency: settings.currency,
        sections: settings.sections,
        skipWhenEmpty: settings.skip_when_empty,
        updatedAt: new Date(),
      },
    });

  return fetchDigestSettings(schema, settings.store_id);
}

/** Drizzle implementation of the delivery-log port used by the runner. */
export function createDigestStore(schema: string): DigestStore {
  return {
    async alreadyDelivered(key: string): Promise<boolean> {
      const [storeId, digestDate, channel, destination] = key.split(":");
      if (!storeId || !digestDate || !channel || !destination) return false;

      const db = tenantDb(schema);
      const t = getTenantTables(schema);
      const rows = await db
        .select({ id: t.digestDeliveries.id })
        .from(t.digestDeliveries)
        .where(
          and(
            eq(t.digestDeliveries.storeId, storeId),
            eq(t.digestDeliveries.digestDate, digestDate),
            eq(t.digestDeliveries.channel, channel),
            eq(t.digestDeliveries.destination, destination),
          ),
        )
        .limit(1);

      return rows.length > 0;
    },

    async recordDelivery(record: DigestDeliveryRecord): Promise<void> {
      const db = tenantDb(schema);
      const t = getTenantTables(schema);
      await db
        .insert(t.digestDeliveries)
        .values({
          storeId: record.store_id,
          digestDate: record.digest_date,
          channel: record.channel,
          destination: record.destination,
          status: record.status,
          attempts: record.attempts,
          providerMessageId: record.provider_message_id,
          error: record.error,
        })
        // A concurrent cron run may have logged the same key first; the
        // existing row wins rather than blowing up the whole run.
        .onConflictDoNothing();
    },
  };
}

// ── Tenant data loading for a digest run ────────────────────────────────────

/** Store rows that have opted into the daily digest (channels configured). */
export async function fetchDigestStores(schema: string): Promise<Store[]> {
  const db = tenantDb(schema);
  const t = getTenantTables(schema);

  const rows = await db.select().from(t.stores);
  return rows.map((r) => ({
    id: r.id,
    user_id: r.userId,
    name: r.name,
    platform: r.platform,
    domain: r.domain,
    currency: r.currency,
    status: r.status,
    config: r.config,
    created_at: r.createdAt.toISOString(),
  }));
}

/**
 * Load a store's orders for a digest window.
 *
 * `ordered_at` is a timestamptz and the window bounds are dates, so the query
 * is widened to the whole UTC day and filtered again in the digest builder —
 * that keeps a store in Asia/Riyadh from losing its evening orders.
 */
export async function fetchOrdersForPeriod(
  schema: string,
  storeId: string,
  from: string,
  to: string,
): Promise<Order[]> {
  const db = tenantDb(schema);
  const t = getTenantTables(schema);

  const orderRows = await db
    .select()
    .from(t.orders)
    .where(
      and(
        eq(t.orders.storeId, storeId),
        gte(t.orders.orderedAt, new Date(`${from}T00:00:00.000Z`)),
        lte(t.orders.orderedAt, new Date(`${to}T23:59:59.999Z`)),
      ),
    );

  if (orderRows.length === 0) return [];

  const itemRows = await db
    .select()
    .from(t.orderItems)
    .where(inArray(t.orderItems.orderId, orderRows.map((o) => o.id)));

  const itemsByOrder = new Map<string, typeof itemRows>();
  for (const item of itemRows) {
    const list = itemsByOrder.get(item.orderId) ?? [];
    list.push(item);
    itemsByOrder.set(item.orderId, list);
  }

  return orderRows.map((o) => ({
    id: o.id,
    store_id: o.storeId,
    external_id: o.externalId,
    order_number: o.orderNumber,
    customer_name: o.customerName ?? "Guest",
    currency: o.currency,
    subtotal: o.subtotal,
    shipping_amount: o.shippingAmount,
    discount_amount: o.discountAmount,
    tax_amount: o.taxAmount,
    total_amount: o.totalAmount,
    payment_gateway: o.paymentGateway,
    payment_fee: o.paymentFee,
    shipping_cost: o.shippingCost,
    refund_amount: o.refundAmount,
    status: o.status,
    ordered_at: o.orderedAt.toISOString(),
    items: (itemsByOrder.get(o.id) ?? []).map((i) => ({
      id: i.id,
      product_id: i.productId,
      sku: i.sku,
      name: i.name,
      quantity: i.quantity,
      unit_price: i.unitPrice,
      unit_cost: i.unitCost,
      line_subtotal: i.lineSubtotal,
      line_cost: i.lineCost,
    })),
  }));
}

/**
 * Load a store's full journal (all entries + lines) for the digest.
 *
 * Balances are cumulative as of the period end, so the ledger is not sliced by
 * date here — `buildIncomeStatementFromEntries` and `buildBalanceSheet` do that.
 */
export async function fetchLedgerForDigest(
  schema: string,
  storeId: string,
): Promise<JournalEntry[]> {
  const db = tenantDb(schema);
  const t = getTenantTables(schema);

  const entryRows = await db
    .select()
    .from(t.journalEntries)
    .where(eq(t.journalEntries.storeId, storeId))
    .orderBy(t.journalEntries.entryNumber);

  if (entryRows.length === 0) return [];

  const lineRows = await db
    .select({ line: t.journalLines, entryId: t.journalLines.entryId })
    .from(t.journalLines)
    .innerJoin(t.journalEntries, eq(t.journalEntries.id, t.journalLines.entryId))
    .where(eq(t.journalEntries.storeId, storeId));

  const linesByEntry = new Map<string, typeof lineRows>();
  for (const row of lineRows) {
    const list = linesByEntry.get(row.entryId) ?? [];
    list.push(row);
    linesByEntry.set(row.entryId, list);
  }

  return entryRows.map((entry) => ({
    id: entry.id,
    store_id: entry.storeId,
    entry_number: entry.entryNumber,
    entry_date: entry.entryDate,
    description: entry.description,
    reference: entry.reference ?? "",
    source: entry.source,
    status: entry.status,
    lines: (linesByEntry.get(entry.id) ?? []).map(({ line }) => ({
      account_code: line.accountCode,
      account_name: line.accountName,
      account_type: line.accountType,
      description: line.description ?? "",
      debit: line.debit,
      credit: line.credit,
    })),
  }));
}
