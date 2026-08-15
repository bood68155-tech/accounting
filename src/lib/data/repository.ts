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
import { buildIncomeStatementFromOrders } from "@/lib/accounting/incomeStatement";
import { computeMonthlySeries, computeStats } from "@/lib/accounting/profitEngine";
import { createClient } from "@/lib/supabase/server";

/**
 * Repository: the single entry point for page data.
 *
 * Every read is scoped to the signed-in user's tenant schema (resolved by the
 * middleware and exposed via cookies). There is no demo fallback — the app
 * always reads from Supabase.
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

/** Resolve the tenant schema, returning null when there is no signed-in tenant. */
async function tenantClient() {
  const schema = await getTenantSchema();
  if (!schema) return null;
  return createClient(schema);
}

/** If no store id was given, fall back to the tenant's first store. */
async function resolveStoreId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  storeId?: string,
): Promise<string | null> {
  if (storeId) return storeId;
  const { data } = await supabase.from("stores").select("id").limit(1).maybeSingle();
  return data?.id ?? null;
}

function mapOrderRow(row: Record<string, unknown>): Order {
  return {
    store_id: row.store_id as string,
    external_id: row.external_id as string,
    order_number: row.order_number as string,
    customer_name: row.customer_name as string,
    currency: row.currency as string,
    subtotal: Number(row.subtotal),
    shipping_amount: Number(row.shipping_amount),
    discount_amount: Number(row.discount_amount),
    tax_amount: Number(row.tax_amount),
    total_amount: Number(row.total_amount),
    payment_gateway: row.payment_gateway as string,
    payment_fee: Number(row.payment_fee),
    shipping_cost: Number(row.shipping_cost),
    refund_amount: Number(row.refund_amount),
    status: row.status as Order["status"],
    ordered_at: row.ordered_at as string,
    items: ((row.order_items as Record<string, unknown>[]) ?? []).map((item) => ({
      sku: item.sku as string,
      name: item.name as string,
      quantity: item.quantity as number,
      unit_price: Number(item.unit_price),
      unit_cost: Number(item.unit_cost),
      line_subtotal: Number(item.line_subtotal),
      line_cost: Number(item.line_cost),
    })),
  };
}

export async function fetchStoreOverview(storeId?: string): Promise<StoreOverview> {
  const supabase = await tenantClient();
  if (!supabase) return emptyOverview();

  const resolved = await resolveStoreId(supabase, storeId);
  if (!resolved) return emptyOverview();

  const { data: store } = await supabase
    .from("stores")
    .select("*")
    .eq("id", resolved)
    .maybeSingle();
  if (!store) return emptyOverview();

  const { data: orders } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .eq("store_id", resolved)
    .order("ordered_at", { ascending: false });

  const { data: products } = await supabase
    .from("products")
    .select("*")
    .eq("store_id", resolved);

  const { data: recentEvents } = await supabase
    .from("integration_events")
    .select("*")
    .eq("store_id", resolved)
    .order("processed_at", { ascending: false })
    .limit(10);

  const normalizedOrders = (orders ?? []).map(mapOrderRow);

  return {
    store: store as Store,
    orders: normalizedOrders,
    products: (products ?? []) as Product[],
    stats: computeStats(resolved, normalizedOrders),
    monthly: computeMonthlySeries(normalizedOrders, 6),
    recentEvents: (recentEvents ?? []) as WebhookEvent[],
  };
}

/** All stores in the signed-in user's tenant. */
export async function fetchStores(): Promise<Store[]> {
  const supabase = await tenantClient();
  if (!supabase) return [];

  const { data } = await supabase.from("stores").select("*").order("created_at", { ascending: true });
  return (data ?? []) as Store[];
}

export async function fetchLedger(storeId?: string): Promise<JournalEntry[]> {
  const supabase = await tenantClient();
  if (!supabase) return [];

  const resolved = await resolveStoreId(supabase, storeId);
  if (!resolved) return [];

  const { data: entries } = await supabase
    .from("journal_entries")
    .select("*, journal_lines(*)")
    .eq("store_id", resolved)
    .order("entry_number", { ascending: true });

  return (entries ?? []).map((entry) => ({
    id: entry.id,
    store_id: entry.store_id,
    entry_number: entry.entry_number,
    entry_date: entry.entry_date,
    description: entry.description,
    reference: entry.reference,
    source: entry.source,
    status: entry.status,
    lines: ((entry.journal_lines as Record<string, unknown>[]) ?? []).map((l) => ({
      account_code: l.account_code as string,
      account_name: l.account_name as string,
      account_type: l.account_type as JournalEntry["lines"][number]["account_type"],
      description: l.description as string,
      debit: Number(l.debit),
      credit: Number(l.credit),
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
