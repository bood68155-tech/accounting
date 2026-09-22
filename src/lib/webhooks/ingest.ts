import { randomUUID } from "node:crypto";
import { and, eq, desc } from "drizzle-orm";
import type { JournalEntry, Order, ProfitBreakdown } from "@/types";
import { toOrder, type NormalizedOrder, type NormalizedPayment } from "@/lib/providers/types";
import { computeOrderProfit } from "@/lib/accounting/profitEngine";
import { createFeeEntry, createRefundEntry, createSaleEntry } from "@/lib/accounting/doubleEntry";
import {
  isDatabaseConfigured,
  isTenantSchema,
  requireDb,
  publicSchema,
  tenantDb,
  getTenantTables,
} from "@/lib/db";

/**
 * ── Webhook ingestion pipeline (Neon + Drizzle) ───────────────────────────────
 * 1. Verify signature (in the route)
 * 2. Normalize payload → canonical order/payment
 * 3. Resolve the tenant schema via public.store_registry
 * 4. Persist order + items inside the tenant schema (atomic batch)
 * 5. Compute true net profit
 * 6. Post balanced double-entry journal entries
 * 7. Log the integration event
 *
 * All writes go through the schema-qualified Drizzle tables (schema-per-tenant
 * isolation); every value is a bound parameter.
 */

export interface IngestResult {
  ok: boolean;
  eventType: string;
  order?: Order;
  profit?: ProfitBreakdown;
  entryNumbers?: number[];
  message: string;
}

/** Find the tenant schema that owns a store (via the shared registry). */
async function resolveStoreSchema(storeId: string): Promise<string | null> {
  if (!isDatabaseConfigured()) return null;
  const { storeRegistry } = publicSchema;
  const rows = await requireDb()
    .select({ schemaName: storeRegistry.schemaName })
    .from(storeRegistry)
    .where(eq(storeRegistry.storeId, storeId))
    .limit(1);
  return rows[0]?.schemaName ?? null;
}

async function logEvent(
  schema: string | null,
  input: {
    storeId: string;
    provider: string;
    eventType: string;
    payload: Record<string, unknown>;
    status: "processed" | "failed";
    error?: string;
  },
) {
  if (!schema || !isDatabaseConfigured()) return;
  try {
    const t = getTenantTables(schema);
    await tenantDb(schema).insert(t.integrationEvents).values({
      storeId: input.storeId,
      provider: input.provider,
      eventType: input.eventType,
      payload: input.payload,
      status: input.status,
      error: input.error ?? null,
    });
  } catch {
    // Logging must never break the webhook response.
  }
}

async function persistOrder(
  schema: string,
  order: Order,
  rawPayload?: Record<string, unknown>,
) {
  const db = tenantDb(schema);
  const t = getTenantTables(schema);

  const existing = await db
    .select({ id: t.orders.id, entryNumbers: t.orders.entryNumbers })
    .from(t.orders)
    .where(and(eq(t.orders.storeId, order.store_id), eq(t.orders.externalId, order.external_id)))
    .limit(1);
  if (existing.length > 0) {
    return { upserted: false, entryNumbers: existing[0].entryNumbers ?? [] };
  }

  // The order id is generated up front so the order + item inserts can run as
  // one atomic Neon HTTP batch (no statement depends on another's result).
  const orderId = randomUUID();
  await db.batch(
    [
      db.insert(t.orders).values({
        id: orderId,
        storeId: order.store_id,
        externalId: order.external_id,
        orderNumber: order.order_number,
        customerName: order.customer_name,
        currency: order.currency,
        subtotal: order.subtotal,
        shippingAmount: order.shipping_amount,
        discountAmount: order.discount_amount,
        taxAmount: order.tax_amount,
        totalAmount: order.total_amount,
        paymentGateway: order.payment_gateway,
        paymentFee: order.payment_fee,
        shippingCost: order.shipping_cost,
        refundAmount: order.refund_amount,
        status: order.status,
        orderedAt: new Date(order.ordered_at),
        raw: rawPayload ?? null,
      }),
      ...order.items.map((item) =>
        db.insert(t.orderItems).values({
          orderId,
          sku: item.sku,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          unitCost: item.unit_cost,
          lineSubtotal: item.line_subtotal,
          lineCost: item.line_cost,
        }),
      ),
    ] as never,
  );

  return { upserted: true, entryNumbers: [] as number[] };
}

async function persistEntries(schema: string, entries: JournalEntry[]) {
  if (entries.length === 0) return;
  const db = tenantDb(schema);
  const t = getTenantTables(schema);

  for (const entry of entries) {
    const entryId = randomUUID();
    await db.batch(
      [
        db.insert(t.journalEntries).values({
          id: entryId,
          storeId: entry.store_id,
          entryNumber: entry.entry_number,
          entryDate: entry.entry_date,
          description: entry.description,
          reference: entry.reference,
          source: entry.source,
          status: entry.status,
        }),
        ...entry.lines.map((line) =>
          db.insert(t.journalLines).values({
            entryId,
            accountCode: line.account_code,
            accountName: line.account_name,
            accountType: line.account_type,
            description: line.description,
            debit: line.debit,
            credit: line.credit,
          }),
        ),
      ] as never,
    );
  }
}

async function nextEntryNumber(schema: string): Promise<number> {
  const t = getTenantTables(schema);
  const rows = await tenantDb(schema)
    .select({ entryNumber: t.journalEntries.entryNumber })
    .from(t.journalEntries)
    .orderBy(desc(t.journalEntries.entryNumber))
    .limit(1);
  return (rows[0]?.entryNumber ?? 0) + 1;
}

async function postEntriesForOrder(schema: string, order: Order): Promise<number[]> {
  let entryNumber = await nextEntryNumber(schema);
  const entries: JournalEntry[] = [createSaleEntry(order, entryNumber)];
  if (order.refund_amount > 0) {
    entryNumber += 1;
    entries.push(createRefundEntry(order, order.refund_amount, entryNumber));
  }
  await persistEntries(schema, entries);

  const numbers = entries.map((e) => e.entry_number);
  const t = getTenantTables(schema);
  await tenantDb(schema)
    .update(t.orders)
    .set({ entryNumbers: numbers })
    .where(and(eq(t.orders.storeId, order.store_id), eq(t.orders.externalId, order.external_id)));
  return numbers;
}

/** Process a normalized order webhook. */
export async function processOrderWebhook(input: {
  provider: string;
  storeId: string;
  storeCurrency?: string;
  normalized: NormalizedOrder;
  eventType: string;
  rawPayload: Record<string, unknown>;
}): Promise<IngestResult> {
  const order = toOrder(input.normalized, input.storeId, input.storeCurrency);
  const profit = computeOrderProfit(order);

  if (!isDatabaseConfigured()) {
    return {
      ok: true,
      eventType: input.eventType,
      order,
      profit,
      message: `Order ${order.order_number} computed — true net profit ${profit.net_profit.toFixed(2)}. Not persisted: set DATABASE_URL to enable live ingestion.`,
    };
  }

  try {
    const schema = await resolveStoreSchema(input.storeId);
    if (!schema || !isTenantSchema(schema)) {
      return {
        ok: false,
        eventType: input.eventType,
        order,
        profit,
        message: `Store ${input.storeId} is not registered to a tenant. Connect the store first, then replay this webhook.`,
      };
    }

    const { upserted, entryNumbers: existingNumbers } = await persistOrder(schema, order, input.rawPayload);
    const entryNumbers = upserted ? await postEntriesForOrder(schema, order) : existingNumbers;

    await logEvent(schema, {
      storeId: input.storeId,
      provider: input.provider,
      eventType: input.eventType,
      payload: input.rawPayload,
      status: "processed",
    });

    return {
      ok: true,
      eventType: input.eventType,
      order,
      profit,
      entryNumbers,
      message: `Order ${order.order_number} processed — true net profit ${profit.net_profit.toFixed(2)}, ${entryNumbers.length} journal entr${entryNumbers.length === 1 ? "y" : "ies"} posted.`,
    };
  } catch (error) {
    const schema = await resolveStoreSchema(input.storeId).catch(() => null);
    await logEvent(schema, {
      storeId: input.storeId,
      provider: input.provider,
      eventType: input.eventType,
      payload: input.rawPayload,
      status: "failed",
      error: String(error),
    });
    return {
      ok: false,
      eventType: input.eventType,
      order,
      profit,
      message: `Processing failed: ${String(error)}`,
    };
  }
}

/** Process a payment event (Stripe/PayPal) — captures gateway fees. */
export async function processPaymentWebhook(input: {
  provider: string;
  storeId: string;
  payment: NormalizedPayment;
  eventType: string;
  rawPayload: Record<string, unknown>;
}): Promise<IngestResult> {
  const message = `Payment ${input.payment.external_id} — gateway fee ${input.payment.fee.toFixed(2)} (${input.payment.amount.toFixed(2)} charged, ${input.payment.net.toFixed(2)} net).`;

  if (!isDatabaseConfigured()) {
    return {
      ok: true,
      eventType: input.eventType,
      message: `Computed — not persisted: set DATABASE_URL to enable live ingestion. ${message}`,
    };
  }

  try {
    const schema = await resolveStoreSchema(input.storeId);
    if (!schema || !isTenantSchema(schema)) {
      return {
        ok: false,
        eventType: input.eventType,
        message: `Store ${input.storeId} is not registered to a tenant. Connect the store first, then replay this webhook.`,
      };
    }

    if (input.payment.fee > 0) {
      const entryNumber = await nextEntryNumber(schema);
      await persistEntries(schema, [
        createFeeEntry(
          input.storeId,
          entryNumber,
          input.payment.paid_at.slice(0, 10),
          `Gateway fee ${input.provider} ${input.payment.external_id}`,
          input.payment.external_id,
          input.payment.fee,
        ),
      ]);
    }

    await logEvent(schema, {
      storeId: input.storeId,
      provider: input.provider,
      eventType: input.eventType,
      payload: input.rawPayload,
      status: "processed",
    });

    return {
      ok: true,
      eventType: input.eventType,
      message,
    };
  } catch (error) {
    const schema = await resolveStoreSchema(input.storeId).catch(() => null);
    await logEvent(schema, {
      storeId: input.storeId,
      provider: input.provider,
      eventType: input.eventType,
      payload: input.rawPayload,
      status: "failed",
      error: String(error),
    });
    return {
      ok: false,
      eventType: input.eventType,
      message: `Processing failed: ${String(error)}`,
    };
  }
}
