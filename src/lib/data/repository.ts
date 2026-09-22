import { eq, desc } from "drizzle-orm";
import type {
  IncomeStatement,
  JournalEntry,
  MonthPoint,
  Order,
  Product,
  Store,
  StoreStats,
  WebhookEvent,
} from "@/types";
import { getTenantSchema } from "@/lib/tenants";
import { tenantDb, isTenantSchema, getTenantTables } from "@/lib/db";
import type { TenantOrderItemRow, TenantOrderRow } from "@/lib/db/tenant";
import { buildIncomeStatementFromOrders } from "@/lib/accounting/incomeStatement";
import { computeMonthlySeries, computeStats } from "@/lib/accounting/profitEngine";

/**
 * Repository: the single entry point for page data.
 *
 * Every read is scoped to the signed-in user's tenant schema (resolved from
 * the NextAuth session — see lib/tenants). There is no demo fallback — the
 * app always reads from Neon via Drizzle.
 */

export interface StoreOverview {
  store: Store | null;
  orders: Order[];
  products: Product[];
  stats: StoreStats;
  monthly: MonthPoint[];
  recentEvents: WebhookEvent[];
}

function emptyOverview(): StoreOverview {
  return {
    store: null,
    orders: [],
    products: [],
    stats: computeStats("", []),
    monthly: [],
    recentEvents: [],
  };
}

/** Map a tenant-schema order row + its items to the domain DTO. */
function mapOrderRow(row: TenantOrderRow, items: TenantOrderItemRow[]): Order {
  return {
    store_id: row.storeId,
    external_id: row.externalId,
    order_number: row.orderNumber,
    customer_name: row.customerName ?? "",
    currency: row.currency,
    subtotal: row.subtotal,
    shipping_amount: row.shippingAmount,
    discount_amount: row.discountAmount,
    tax_amount: row.taxAmount,
    total_amount: row.totalAmount,
    payment_gateway: row.paymentGateway,
    payment_fee: row.paymentFee,
    shipping_cost: row.shippingCost,
    refund_amount: row.refundAmount,
    status: row.status,
    ordered_at: row.orderedAt.toISOString(),
    items: items.map((item) => ({
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      unit_cost: item.unitCost,
      line_subtotal: item.lineSubtotal,
      line_cost: item.lineCost,
    })),
  };
}

/** If no store id was given, fall back to the tenant's first store. */
async function resolveStoreId(
  t: ReturnType<typeof getTenantTables>,
  db: ReturnType<typeof tenantDb>,
  storeId?: string,
): Promise<string | null> {
  if (storeId) return storeId;
  const rows = await db.select({ id: t.stores.id }).from(t.stores).orderBy(t.stores.createdAt).limit(1);
  return rows[0]?.id ?? null;
}

export async function fetchStoreOverview(storeId?: string): Promise<StoreOverview> {
  const schema = await getTenantSchema();
  if (!schema || !isTenantSchema(schema)) return emptyOverview();

  const db = tenantDb(schema);
  const t = getTenantTables(schema);

  const resolved = await resolveStoreId(t, db, storeId);
  if (!resolved) return emptyOverview();

  const storeRows = await db.select().from(t.stores).where(eq(t.stores.id, resolved)).limit(1);
  const store = storeRows[0];
  if (!store) return emptyOverview();

  const orderRows = await db
    .select()
    .from(t.orders)
    .where(eq(t.orders.storeId, resolved))
    .orderBy(desc(t.orders.orderedAt));
  const itemRows = await db
    .select({ item: t.orderItems })
    .from(t.orderItems)
    .innerJoin(t.orders, eq(t.orders.id, t.orderItems.orderId))
    .where(eq(t.orders.storeId, resolved))
    .orderBy(t.orderItems.createdAt);
  const productRows = await db
    .select()
    .from(t.products)
    .where(eq(t.products.storeId, resolved))
    .orderBy(t.products.createdAt);
  const eventRows = await db
    .select()
    .from(t.integrationEvents)
    .where(eq(t.integrationEvents.storeId, resolved))
    .orderBy(desc(t.integrationEvents.processedAt))
    .limit(10);

  const itemsByOrder = new Map<string, typeof itemRows>();
  for (const { item } of itemRows) {
    if (!itemsByOrder.has(item.orderId)) itemsByOrder.set(item.orderId, []);
    itemsByOrder.get(item.orderId)!.push({ item });
  }

  const normalizedOrders: Order[] = orderRows.map((row) =>
    mapOrderRow(row, (itemsByOrder.get(row.id) ?? []).map((x) => x.item)),
  );

  const storeDto: Store = {
    id: store.id,
    user_id: store.userId,
    name: store.name,
    platform: store.platform,
    domain: store.domain,
    currency: store.currency,
    status: store.status,
    config: store.config,
    created_at: store.createdAt.toISOString(),
  };

  const products: Product[] = productRows.map((p) => ({
    id: p.id,
    store_id: p.storeId,
    external_id: p.externalId,
    sku: p.sku,
    name: p.name,
    unit_cost: p.unitCost,
    unit_price: p.unitPrice,
    created_at: p.createdAt.toISOString(),
  }));

  const recentEvents: WebhookEvent[] = eventRows.map((e) => ({
    id: e.id,
    store_id: e.storeId,
    provider: e.provider,
    event_type: e.eventType,
    payload: e.payload,
    status: e.status,
    error: e.error,
    processed_at: e.processedAt.toISOString(),
  }));

  return {
    store: storeDto,
    orders: normalizedOrders,
    products,
    stats: computeStats(resolved, normalizedOrders),
    monthly: computeMonthlySeries(normalizedOrders, 6),
    recentEvents,
  };
}

/** All stores in the signed-in user's tenant. */
export async function fetchStores(): Promise<Store[]> {
  const schema = await getTenantSchema();
  if (!schema || !isTenantSchema(schema)) return [];

  const db = tenantDb(schema);
  const t = getTenantTables(schema);
  const rows = await db.select().from(t.stores).orderBy(t.stores.createdAt);
  return rows.map((s) => ({
    id: s.id,
    user_id: s.userId,
    name: s.name,
    platform: s.platform,
    domain: s.domain,
    currency: s.currency,
    status: s.status,
    config: s.config,
    created_at: s.createdAt.toISOString(),
  }));
}

export async function fetchLedger(storeId?: string): Promise<JournalEntry[]> {
  const schema = await getTenantSchema();
  if (!schema || !isTenantSchema(schema)) return [];

  const db = tenantDb(schema);
  const t = getTenantTables(schema);

  const resolved = await resolveStoreId(t, db, storeId);
  if (!resolved) return [];

  const entryRows = await db
    .select()
    .from(t.journalEntries)
    .where(eq(t.journalEntries.storeId, resolved))
    .orderBy(t.journalEntries.entryNumber);
  if (entryRows.length === 0) return [];

  const lineRows = await db
    .select({ line: t.journalLines })
    .from(t.journalLines)
    .innerJoin(t.journalEntries, eq(t.journalEntries.id, t.journalLines.entryId))
    .where(eq(t.journalEntries.storeId, resolved))
    .orderBy(t.journalLines.id);

  const linesByEntry = new Map<string, typeof lineRows>();
  for (const { line } of lineRows) {
    if (!linesByEntry.has(line.entryId)) linesByEntry.set(line.entryId, []);
    linesByEntry.get(line.entryId)!.push({ line });
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

export async function fetchIncomeStatement(
  storeId?: string,
  from?: string,
  to?: string,
): Promise<IncomeStatement> {
  const orders = (await fetchStoreOverview(storeId)).orders;
  return buildIncomeStatementFromOrders(orders, from, to);
}
