import { randomUUID } from "node:crypto";
import { and, eq, desc, inArray } from "drizzle-orm";
import type { JournalEntry, Order, ProfitBreakdown } from "@/types";
import { toOrder, type NormalizedOrder, type NormalizedPayment } from "@/lib/providers/types";
import { computeOrderProfit } from "@/lib/accounting/profitEngine";
import {
  createCreditSaleEntry,
  createFeeEntry,
  createPaymentCollectionEntry,
  createRefundEntry,
  createSaleEntry,
} from "@/lib/accounting/doubleEntry";
import {
  isDatabaseConfigured,
  isTenantSchema,
  requireDb,
  publicSchema,
  tenantDb,
  getTenantTables,
} from "@/lib/db";
import { round2 } from "@/lib/utils";

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
  /** true when the order was newly persisted (false = idempotent skip/settle). */
  upserted?: boolean;
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

/**
 * Find a connected store by its public domain across all tenants (e.g. via the
 * `X-Shopify-Shop-Domain` header when the webhook URL carries no store id).
 * Returns the store id and its tenant schema, or null when unknown.
 */
export async function resolveStoreByDomain(
  domain: string,
): Promise<{ storeId: string; schemaName: string } | null> {
  if (!isDatabaseConfigured() || !domain) return null;
  const { tenants } = publicSchema;
  const tenantRows = await requireDb()
    .select({ schemaName: tenants.schemaName })
    .from(tenants);
  for (const { schemaName } of tenantRows) {
    if (!isTenantSchema(schemaName)) continue;
    const t = getTenantTables(schemaName);
    const rows = await tenantDb(schemaName)
      .select({ id: t.stores.id })
      .from(t.stores)
      .where(eq(t.stores.domain, domain.toLowerCase()))
      .limit(1);
    if (rows[0]) return { storeId: rows[0].id, schemaName };
  }
  return null;
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
    .select({
      id: t.orders.id,
      status: t.orders.status,
      entryNumbers: t.orders.entryNumbers,
    })
    .from(t.orders)
    .where(and(eq(t.orders.storeId, order.store_id), eq(t.orders.externalId, order.external_id)))
    .limit(1);
  if (existing.length > 0) {
    return {
      upserted: false,
      entryNumbers: existing[0].entryNumbers ?? [],
      existingStatus: existing[0].status,
    };
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

  return { upserted: true, entryNumbers: [] as number[], existingStatus: null };
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

/**
 * Post the sale journal entries for an order. Orders that arrive unpaid
 * (`status: "pending"`) are booked as credit sales — Dr Accounts Receivable —
 * and the receivable is settled by a later payment event (Stripe/PayPal) via
 * `settleReceivable`. Paid orders post the classic cash sale entry.
 */
async function postEntriesForOrder(schema: string, order: Order): Promise<number[]> {
  let entryNumber = await nextEntryNumber(schema);
  const saleEntry =
    order.status === "pending"
      ? createCreditSaleEntry(order, entryNumber)
      : createSaleEntry(order, entryNumber);
  const entries: JournalEntry[] = [saleEntry];
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

/**
 * Accounts Receivable settlement: when a payment event (Stripe/PayPal) arrives
 * for an order that was booked as a credit sale, flip Dr AR → Dr Cash + fees.
 * Revenue is NOT re-recognized — only the balance sheet moves.
 * `paymentExternalId` is the gateway payment/transaction id — recorded on the
 * journal entry for audit trail (ERPNext-style voucher reference).
 */
async function settleReceivable(
  schema: string,
  storeId: string,
  orderExternalId: string,
  paymentExternalId?: string,
): Promise<boolean> {
  const db = tenantDb(schema);
  const t = getTenantTables(schema);

  const rows = await db
    .select()
    .from(t.orders)
    .where(
      and(
        eq(t.orders.storeId, storeId),
        eq(t.orders.externalId, orderExternalId),
        eq(t.orders.status, "pending"),
      ),
    )
    .limit(1);
  const orderRow = rows[0];
  if (!orderRow) return false; // nothing booked on credit — nothing to settle

  const itemRows = await db
    .select()
    .from(t.orderItems)
    .where(eq(t.orderItems.orderId, orderRow.id));

  const order: Order = {
    store_id: orderRow.storeId,
    external_id: orderRow.externalId,
    order_number: orderRow.orderNumber,
    customer_name: orderRow.customerName ?? "",
    currency: orderRow.currency,
    subtotal: orderRow.subtotal,
    shipping_amount: orderRow.shippingAmount,
    discount_amount: orderRow.discountAmount,
    tax_amount: orderRow.taxAmount,
    total_amount: orderRow.totalAmount,
    payment_gateway: orderRow.paymentGateway,
    payment_fee: orderRow.paymentFee,
    shipping_cost: orderRow.shippingCost,
    refund_amount: orderRow.refundAmount,
    status: orderRow.status,
    ordered_at: orderRow.orderedAt.toISOString(),
    items: itemRows.map((item) => ({
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      unit_cost: item.unitCost,
      line_subtotal: item.lineSubtotal,
      line_cost: item.lineCost,
    })),
  };

  const entryNumber = await nextEntryNumber(schema);
  await persistEntries(schema, [createPaymentCollectionEntry(order, entryNumber, paymentExternalId)]);

  await db
    .update(t.orders)
    .set({ status: "paid" })
    .where(eq(t.orders.id, orderRow.id));
  return true;
}

/**
 * Fill missing item costs from the tenant's product catalog (SKU → cost_price).
 * Providers that don't expose per-line costs (most order webhooks) get true
 * COGS automatically as long as the catalog has the SKU — this is what makes
 * the "cost prices drive COGS" loop real for every platform.
 */
async function enrichWithCatalogCosts(
  schema: string,
  storeId: string,
  order: Order,
): Promise<Order> {
  const missing = order.items.filter((i) => i.unit_cost === 0 && i.sku && i.sku !== "N/A");
  if (missing.length === 0) return order;

  const t = getTenantTables(schema);
  const skus = [...new Set(missing.map((i) => i.sku))];
  const catalogRows = await tenantDb(schema)
    .select({ sku: t.products.sku, costPrice: t.products.costPrice })
    .from(t.products)
    .where(and(eq(t.products.storeId, storeId), inArray(t.products.sku, skus)));
  const costBySku = new Map(catalogRows.map((r) => [r.sku, r.costPrice]));
  if (costBySku.size === 0) return order;

  return {
    ...order,
    items: order.items.map((item) => {
      if (item.unit_cost !== 0) return item;
      const cost = costBySku.get(item.sku);
      if (cost === undefined || cost <= 0) return item;
      return {
        ...item,
        unit_cost: cost,
        line_cost: round2(cost * item.quantity),
      };
    }),
  };
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
  let order = toOrder(input.normalized, input.storeId, input.storeCurrency);
  let profit = computeOrderProfit(order);

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

    // True COGS: fill zero-cost lines from the tenant catalog before booking.
    order = await enrichWithCatalogCosts(schema, input.storeId, order);
    profit = computeOrderProfit(order);

    const { upserted, entryNumbers: existingNumbers, existingStatus } = await persistOrder(
      schema,
      order,
      input.rawPayload,
    );

    let entryNumbers: number[];
    let message: string;

    if (upserted) {
      // Cancelled orders (voided/uncaptured payments) are persisted for
      // record-keeping but post NO journal entries — no revenue is recognized.
      entryNumbers = order.status === "cancelled" ? [] : await postEntriesForOrder(schema, order);
      message = order.status === "cancelled"
        ? `Order ${order.order_number} recorded as cancelled — no journal entries (no revenue recognized).`
        : `Order ${order.order_number} processed — true net profit ${profit.net_profit.toFixed(2)}, ${entryNumbers.length} journal entr${entryNumbers.length === 1 ? "y" : "ies"} posted.`;
    } else if (existingStatus === "pending" && order.status === "paid") {
      // A previously credit-sale order whose payment event just arrived (e.g.
      // Shopify orders/paid after orders/create): settle the receivable instead
      // of silently treating the delivery as a duplicate.
      const settled = await settleReceivable(schema, input.storeId, order.external_id);
      entryNumbers = existingNumbers;
      message = settled
        ? `Payment received for order ${order.order_number} — receivable settled (Dr Cash, Cr Accounts Receivable).`
        : `Order ${order.order_number} already synced — receivable was already settled.`;
    } else {
      // Idempotent redelivery (Shopify retries webhooks) — not an error.
      entryNumbers = existingNumbers;
      message = `Order ${order.order_number} already synced — no changes (idempotent skip).`;
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
      upserted,
      order,
      profit,
      entryNumbers,
      message,
    };
  } catch (error) {
    // Loud failure log: shows up in Vercel / server console with the cause.
    console.error(
      `[ingest] ${input.provider} order ${input.normalized.order_number} FAILED to save:`,
      error,
    );
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

    // A payment for a pending (credit-sale) order settles its receivable;
    // anything else is a standalone gateway fee capture.
    const settled = input.payment.order_external_id
      ? await settleReceivable(
          schema,
          input.storeId,
          input.payment.order_external_id,
          input.payment.external_id,
        )
      : false;

    // Idempotency for retried payment webhooks: gateway providers retry
    // deliveries. Before posting a standalone fee entry, check whether this
    // payment id was already journaled — a retry must never double-post.
    if (input.payment.fee > 0 && !settled) {
      const t2 = getTenantTables(schema);
      const duplicate = await tenantDb(schema)
        .select({ id: t2.journalEntries.id })
        .from(t2.journalEntries)
        .where(
          and(
            eq(t2.journalEntries.storeId, input.storeId),
            eq(t2.journalEntries.reference, input.payment.external_id),
          ),
        )
        .limit(1);
      if (duplicate.length > 0) {
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
          message: `Payment ${input.payment.external_id} already journaled — idempotent skip (no double-posted fees).`,
        };
      }
    }

    if (input.payment.fee > 0 && !settled) {
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
      message: settled
        ? `Receivable settled for order ${input.payment.order_external_id} — cash collected, fees ${input.payment.fee.toFixed(2)} booked.`
        : message,
    };
  } catch (error) {
    console.error(
      `[ingest] ${input.provider} payment ${input.payment.external_id} FAILED to process:`,
      error,
    );
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
