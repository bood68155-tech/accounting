import type { IncomeStatement, JournalEntry, Order, Product, Store } from "@/types";
import { isSupabaseConfigured } from "@/lib/data/config";
import {
  DEMO_STORE,
  DEMO_STORE_ID,
  getDemoIncomeStatement,
  getDemoLedgerEntries,
  getDemoMonthlySeries,
  getDemoOrders,
  getDemoProducts,
  getDemoStats,
  getDemoWebhookEvents,
} from "@/lib/data/demo";
import { buildIncomeStatementFromOrders } from "@/lib/accounting/incomeStatement";
import { computeMonthlySeries, computeStats } from "@/lib/accounting/profitEngine";
import { createClient } from "@/lib/supabase/server";

/**
 * Repository: the single entry point for page data.
 * When Supabase is configured it reads from the live database; otherwise it
 * falls back to the deterministic demo dataset so every screen is usable.
 */

export interface StoreOverview {
  store: Store | null;
  orders: Order[];
  products: Product[];
  stats: ReturnType<typeof getDemoStats>;
  monthly: ReturnType<typeof getDemoMonthlySeries>;
  recentEvents: ReturnType<typeof getDemoWebhookEvents>;
  mode: "demo" | "live";
}

export async function fetchStoreOverview(storeId: string = DEMO_STORE_ID): Promise<StoreOverview> {
  if (!isSupabaseConfigured()) {
    return {
      store: DEMO_STORE,
      orders: getDemoOrders(),
      products: getDemoProducts(),
      stats: getDemoStats(),
      monthly: getDemoMonthlySeries(),
      recentEvents: getDemoWebhookEvents(),
      mode: "demo",
    };
  }

  try {
    const supabase = await createClient();
    const { data: store } = await supabase.from("stores").select("*").eq("id", storeId).single();
    const { data: orders } = await supabase
      .from("orders")
      .select("*, order_items(*)")
      .eq("store_id", storeId)
      .order("ordered_at", { ascending: false });

    const { data: products } = await supabase
      .from("products")
      .select("*")
      .eq("store_id", storeId);

    const normalizedOrders: Order[] = (orders ?? []).map((row) => ({
      store_id: row.store_id,
      external_id: row.external_id,
      order_number: row.order_number,
      customer_name: row.customer_name,
      currency: row.currency,
      subtotal: row.subtotal,
      shipping_amount: row.shipping_amount,
      discount_amount: row.discount_amount,
      tax_amount: row.tax_amount,
      total_amount: row.total_amount,
      payment_gateway: row.payment_gateway,
      payment_fee: row.payment_fee,
      shipping_cost: row.shipping_cost,
      refund_amount: row.refund_amount,
      status: row.status,
      ordered_at: row.ordered_at,
      items: (row.order_items ?? []).map((item: Record<string, unknown>) => ({
        sku: item.sku as string,
        name: item.name as string,
        quantity: item.quantity as number,
        unit_price: item.unit_price as number,
        unit_cost: item.unit_cost as number,
        line_subtotal: item.line_subtotal as number,
        line_cost: item.line_cost as number,
      })),
    }));

    const { data: recentEvents } = await supabase
      .from("integration_events")
      .select("*")
      .eq("store_id", storeId)
      .order("processed_at", { ascending: false })
      .limit(10);

    return {
      store: (store as Store) ?? null,
      orders: normalizedOrders,
      products: (products as Product[]) ?? [],
      stats: computeStats(storeId, normalizedOrders),
      monthly: computeMonthlySeries(normalizedOrders, 6),
      recentEvents: (recentEvents ?? []) as ReturnType<typeof getDemoWebhookEvents>,
      mode: "live",
    };
  } catch {
    // Fall back to demo data if anything fails (e.g. schema not migrated yet).
    return {
      store: DEMO_STORE,
      orders: getDemoOrders(),
      products: getDemoProducts(),
      stats: getDemoStats(),
      monthly: getDemoMonthlySeries(),
      recentEvents: getDemoWebhookEvents(),
      mode: "demo",
    };
  }
}

export async function fetchLedger(storeId: string = DEMO_STORE_ID): Promise<JournalEntry[]> {
  if (!isSupabaseConfigured()) return getDemoLedgerEntries();
  try {
    const supabase = await createClient();
    const { data: entries } = await supabase
      .from("journal_entries")
      .select("*, journal_lines(*)")
      .eq("store_id", storeId)
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
      lines: (entry.journal_lines ?? []).map((l: Record<string, unknown>) => ({
        account_code: l.account_code as string,
        account_name: l.account_name as string,
        account_type: l.account_type as never,
        description: l.description as string,
        debit: l.debit as number,
        credit: l.credit as number,
      })),
    }));
  } catch {
    return getDemoLedgerEntries();
  }
}

export async function fetchIncomeStatement(
  storeId: string = DEMO_STORE_ID,
  from?: string,
  to?: string,
): Promise<IncomeStatement> {
  if (!isSupabaseConfigured()) return getDemoIncomeStatement(from, to);
  const orders = (await fetchStoreOverview(storeId)).orders;
  return buildIncomeStatementFromOrders(orders, from, to);
}
