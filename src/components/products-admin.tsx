"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TCell, THead, THeadCell, TRow } from "@/components/ui/table";
import { updateProductCost, syncProducts } from "@/app/(app)/products/actions";
import { formatCurrency, formatPercent } from "@/lib/utils";

export interface CatalogProduct {
  id?: string;
  store_id: string;
  external_id: string | null;
  sku: string;
  title: string;
  selling_price: number;
  cost_price: number;
  created_at?: string;
  store_name: string | null;
}

/**
 * Tenant-wide product catalog: every store's products with inline cost-price
 * editing (costs drive COGS on incoming webhook orders) and one-click catalog
 * sync from the store platform APIs (Shopify Admin / Salla Admin).
 */
export function ProductsAdmin({ products }: { products: Array<CatalogProduct> }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const rows = useMemo(
    () =>
      products.map((p) => {
        const margin = p.selling_price > 0 ? (p.selling_price - p.cost_price) / p.selling_price : 0;
        const profit = Math.round((p.selling_price - p.cost_price) * 100) / 100;
        return { ...p, margin, profit };
      }),
    [products],
  );

  async function saveCost(product: CatalogProduct) {
    const raw = drafts[product.sku];
    if (raw === undefined) return;
    const cost = Number.parseFloat(raw);
    if (!Number.isFinite(cost) || cost < 0) {
      setMessage("Cost price must be a non-negative number.");
      return;
    }
    const result = await updateProductCost(product.store_id, product.id ?? "", cost);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setMessage(`Saved cost for ${product.sku}.`);
    setDrafts((d) => {
      const next = { ...d };
      delete next[product.sku];
      return next;
    });
    startTransition(() => router.refresh());
  }

  async function handleSync(storeId?: string) {
    setSyncing(true);
    setMessage(null);
    const result = await syncProducts(storeId);
    setSyncing(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    const synced = result.results.reduce((s, r) => s + r.synced, 0);
    const notes = result.results
      .filter((r) => r.skipped || r.error)
      .map((r) => `${r.storeName}: ${r.skipped ?? r.error}`)
      .join(" · ");
    setMessage(`Synced ${synced} product${synced === 1 ? "" : "s"}.${notes ? ` ${notes}` : ""}`);
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => handleSync()} disabled={syncing || isPending}>
          {syncing ? "Syncing…" : "Sync catalogs from platforms"}
        </Button>
        <p className="text-xs text-zinc-500">
          Pulls products + unit costs from every connected store (Shopify Admin API / Salla Admin API).
          Provider costs win; costs you set here are kept when a platform doesn&apos;t expose one.
        </p>
      </div>

      {message && (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-4 py-3 text-sm text-emerald-300">
          {message}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Catalog ({rows.length})</CardTitle>
          <CardDescription>
            Cost prices feed true COGS on every incoming order — keep them accurate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-500">
              No products yet. Sync a store&apos;s catalog or add products from a store&apos;s page.
            </p>
          ) : (
            <Table>
              <THead>
                <TRow>
                  <THeadCell>Product</THeadCell>
                  <THeadCell>Store</THeadCell>
                  <THeadCell className="text-right">Cost</THeadCell>
                  <THeadCell className="text-right">Price</THeadCell>
                  <THeadCell className="text-right">Margin</THeadCell>
                  <THeadCell className="text-right">Save</THeadCell>
                </TRow>
              </THead>
              <TBody>
                {rows.map((product) => (
                  <TRow key={`${product.store_id}-${product.sku}`}>
                    <TCell>
                      <p className="font-medium text-zinc-100">{product.title}</p>
                      <Badge variant="neutral">{product.sku}</Badge>
                    </TCell>
                    <TCell className="text-zinc-400">{product.store_name ?? "—"}</TCell>
                    <TCell className="text-right">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-28 text-right tabular-nums"
                        defaultValue={String(product.cost_price)}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [product.sku]: e.target.value }))
                        }
                      />
                    </TCell>
                    <TCell className="text-right tabular-nums text-zinc-100">
                      {formatCurrency(product.selling_price, "USD")}
                    </TCell>
                    <TCell
                      className={`text-right font-medium tabular-nums ${
                        product.margin >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {formatPercent(product.margin)}
                    </TCell>
                    <TCell className="text-right">
                      <Button
                        variant="ghost"
                        disabled={isPending || drafts[product.sku] === undefined}
                        onClick={() => saveCost(product)}
                      >
                        Save
                      </Button>
                    </TCell>
                  </TRow>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
