import type { JournalEntry, Order, ProfitBreakdown } from "@/types";
import { toOrder, type NormalizedOrder, type NormalizedPayment } from "@/lib/providers/types";
import { computeOrderProfit } from "@/lib/accounting/profitEngine";
import { createFeeEntry, createRefundEntry, createSaleEntry } from "@/lib/accounting/doubleEntry";
import { hasAdminCredentials, createAdminClient } from "@/lib/supabase/admin";

/**
 * ── Webhook ingestion pipeline ────────────────────────────────────────────────
 * 1. Verify signature (in the route)
 * 2. Normalize payload → canonical order/payment
 * 3. Resolve the tenant schema via public.store_registry
 * 4. Persist order + items (service-role, inside the tenant schema)
 * 5. Compute true net profit
 * 6. Post balanced double-entry journal entries
 * 7. Log the integration event
 *
 * All writes happen in the store's tenant schema — schema-per-tenant isolation.
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
  if (!hasAdminCredentials()) return null;
  const { data, error } = await createAdminClient()
    .from("store_registry")
    .select("schema_name")
    .eq("store_id", storeId)
    .maybeSingle();
  if (error || !data) return null;
  return data.schema_name ?? null;
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
  if (!schema || !hasAdminCredentials()) return;
  try {
    await createAdminClient(schema).from("integration_events").insert({
      store_id: input.storeId,
      provider: input.provider,
      event_type: input.eventType,
      payload: input.payload,
      status: input.status,
      error: input.error ?? null,
      processed_at: new Date().toISOString(),
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
  const supabase = createAdminClient(schema);
  const { data: existing } = await supabase
    .from("orders")
    .select("id, entry_numbers")
    .eq("store_id", order.store_id)
    .eq("external_id", order.external_id)
    .maybeSingle();

  if (existing) return { upserted: false, entryNumbers: (existing.entry_numbers ?? []) as number[] };

  const { data: inserted, error } = await supabase
    .from("orders")
    .insert({
      store_id: order.store_id,
      external_id: order.external_id,
      order_number: order.order_number,
      customer_name: order.customer_name,
      currency: order.currency,
      subtotal: order.subtotal,
      shipping_amount: order.shipping_amount,
      discount_amount: order.discount_amount,
      tax_amount: order.tax_amount,
      total_amount: order.total_amount,
      payment_gateway: order.payment_gateway,
      payment_fee: order.payment_fee,
      shipping_cost: order.shipping_cost,
      refund_amount: order.refund_amount,
      status: order.status,
      ordered_at: order.ordered_at,
      raw: rawPayload ?? null,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to insert order: ${error.message}`);

  if (order.items.length > 0) {
    const { error: itemsError } = await supabase.from("order_items").insert(
      order.items.map((item) => ({
        order_id: inserted.id,
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        unit_cost: item.unit_cost,
        line_subtotal: item.line_subtotal,
        line_cost: item.line_cost,
      })),
    );
    if (itemsError) throw new Error(`Failed to insert order items: ${itemsError.message}`);
  }

  return { upserted: true, entryNumbers: [] as number[] };
}

async function persistEntries(schema: string, entries: JournalEntry[]) {
  if (entries.length === 0 || !hasAdminCredentials()) return;
  const supabase = createAdminClient(schema);
  for (const entry of entries) {
    const { data: inserted, error } = await supabase
      .from("journal_entries")
      .insert({
        store_id: entry.store_id,
        entry_number: entry.entry_number,
        entry_date: entry.entry_date,
        description: entry.description,
        reference: entry.reference,
        source: entry.source,
        status: entry.status,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Failed to insert journal entry: ${error.message}`);

    const { error: linesError } = await supabase.from("journal_lines").insert(
      entry.lines.map((line) => ({
        entry_id: inserted.id,
        account_code: line.account_code,
        account_name: line.account_name,
        account_type: line.account_type,
        description: line.description,
        debit: line.debit,
        credit: line.credit,
      })),
    );
    if (linesError) throw new Error(`Failed to insert journal lines: ${linesError.message}`);
  }
}

async function postEntriesForOrder(schema: string, order: Order): Promise<number[]> {
  const { data: next } = await createAdminClient(schema)
    .from("journal_entries")
    .select("entry_number")
    .order("entry_number", { ascending: false })
    .limit(1);
  let entryNumber = (next?.[0]?.entry_number ?? 0) + 1;

  const entries: JournalEntry[] = [createSaleEntry(order, entryNumber)];
  if (order.refund_amount > 0) {
    entryNumber += 1;
    entries.push(createRefundEntry(order, order.refund_amount, entryNumber));
  }
  await persistEntries(schema, entries);

  // Track posted entry numbers on the order row.
  const numbers = entries.map((e) => e.entry_number);
  await createAdminClient(schema)
    .from("orders")
    .update({ entry_numbers: numbers })
    .eq("store_id", order.store_id)
    .eq("external_id", order.external_id);
  return numbers;
}

/** Process a normalized order from a store webhook. */
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

  if (!hasAdminCredentials()) {
    return {
      ok: true,
      eventType: input.eventType,
      order,
      profit,
      message: `Order ${order.order_number} computed — true net profit ${profit.net_profit.toFixed(2)}. Not persisted: set SUPABASE_SERVICE_ROLE_KEY to enable live ingestion.`,
    };
  }

  try {
    const schema = await resolveStoreSchema(input.storeId);
    if (!schema) {
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

  if (!hasAdminCredentials()) {
    return {
      ok: true,
      eventType: input.eventType,
      message: `Computed — not persisted: set SUPABASE_SERVICE_ROLE_KEY to enable live ingestion. ${message}`,
    };
  }

  try {
    const schema = await resolveStoreSchema(input.storeId);
    if (!schema) {
      return {
        ok: false,
        eventType: input.eventType,
        message: `Store ${input.storeId} is not registered to a tenant. Connect the store first, then replay this webhook.`,
      };
    }

    if (input.payment.fee > 0) {
      const { data: next } = await createAdminClient(schema)
        .from("journal_entries")
        .select("entry_number")
        .order("entry_number", { ascending: false })
        .limit(1);
      const entryNumber = (next?.[0]?.entry_number ?? 0) + 1;
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
