"use client";

import { useMemo, useState, useTransition } from "react";
import type { Product } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TBody, TCell, THead, THeadCell, TRow } from "@/components/ui/table";
import { IconPackage, IconPlus, IconSparkles, IconX } from "@/components/icons";
import { addProduct, updateProduct, deleteProduct, type ProductFormData } from "@/app/(app)/stores/[id]/products/actions";
import { formatCurrency, formatPercent, round2 } from "@/lib/utils";

interface ProductsManagerProps {
  storeId: string;
  products: Product[];
  currency: string;
  demo: boolean;
}

const EMPTY_FORM: ProductFormData = {
  sku: "",
  name: "",
  unit_cost: 0,
  unit_price: 0,
  external_id: "",
};

export function ProductsManager({ storeId, products, currency, demo }: ProductsManagerProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductFormData>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Compute profit margin for each product.
  const productsWithMargin = useMemo(
    () =>
      products.map((p) => {
        const margin = p.unit_price > 0 ? (p.unit_price - p.unit_cost) / p.unit_price : 0;
        const profit = round2(p.unit_price - p.unit_cost);
        return { ...p, margin, profit };
      }),
    [products],
  );

  // Summary stats.
  const summary = useMemo(() => {
    const totalProducts = products.length;
    const avgMargin =
      totalProducts > 0
        ? productsWithMargin.reduce((s, p) => s + p.margin, 0) / totalProducts
        : 0;
    const totalInventoryValue = products.reduce((s, p) => s + p.unit_cost, 0);
    const totalPotentialRevenue = products.reduce((s, p) => s + p.unit_price, 0);
    return { totalProducts, avgMargin, totalInventoryValue, totalPotentialRevenue };
  }, [products, productsWithMargin]);

  function setField(key: keyof ProductFormData) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = key === "sku" || key === "name" || key === "external_id" ? e.target.value : parseFloat(e.target.value) || 0;
      setForm((f) => ({ ...f, [key]: value }));
    };
  }

  function startAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setError(null);
  }

  function startEdit(product: Product) {
    setEditingId(product.id ?? null);
    setForm({
      sku: product.sku,
      name: product.name,
      unit_cost: product.unit_cost,
      unit_price: product.unit_price,
      external_id: product.external_id ?? "",
    });
    setShowForm(true);
    setError(null);
  }

  function cancel() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.sku.trim()) {
      setError("SKU is required.");
      return;
    }
    if (!form.name.trim()) {
      setError("Product name is required.");
      return;
    }
    if (form.unit_cost < 0) {
      setError("Cost price cannot be negative.");
      return;
    }
    if (form.unit_price <= 0) {
      setError("Selling price must be greater than zero.");
      return;
    }

    startTransition(async () => {
      let result;
      if (editingId) {
        result = await updateProduct(storeId, editingId, form);
      } else {
        result = await addProduct(storeId, form);
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      cancel();
    });
  }

  // Preview margin while typing.
  const previewMargin =
    form.unit_price > 0
      ? (form.unit_price - form.unit_cost) / form.unit_price
      : 0;
  const previewProfit = round2(form.unit_price - form.unit_cost);

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Total products</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-zinc-50 tabular-nums">{summary.totalProducts}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Avg profit margin</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-emerald-400 tabular-nums">{formatPercent(summary.avgMargin)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Total cost value</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-zinc-50 tabular-nums">{formatCurrency(summary.totalInventoryValue, currency)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Total potential revenue</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-zinc-50 tabular-nums">{formatCurrency(summary.totalPotentialRevenue, currency)}</p>
        </Card>
      </div>

      {/* Products table */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Products &amp; inventory</CardTitle>
            <CardDescription>Manage cost prices (سعر الشراء) and selling prices (سعر البيع) with automatic profit calculation</CardDescription>
          </div>
          <Button size="sm" onClick={startAdd} disabled={demo || showForm}>
            <IconPlus className="h-4 w-4" /> Add product
          </Button>
        </CardHeader>
        <CardContent className="pt-2">
          {demo && (
            <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] px-4 py-3">
              <p className="text-xs text-amber-200/80">
                Demo mode — product management is read-only. Connect Supabase to add, edit, and delete products.
              </p>
            </div>
          )}

          {/* Add/Edit form */}
          {showForm && (
            <div className="mb-6 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-100">
                  {editingId ? "Edit product" : "Add new product"}
                </h3>
                <button
                  onClick={cancel}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/70 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
                >
                  <IconX className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="prod-sku">SKU</Label>
                    <Input
                      id="prod-sku"
                      value={form.sku}
                      onChange={setField("sku")}
                      placeholder="e.g. AUR-101"
                      required
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
                    <Label htmlFor="prod-name">Product name</Label>
                    <Input
                      id="prod-name"
                      value={form.name}
                      onChange={setField("name")}
                      placeholder="e.g. Amber + Cedar Candle"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="prod-cost">Cost price (سعر الشراء)</Label>
                    <Input
                      id="prod-cost"
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.unit_cost || ""}
                      onChange={setField("unit_cost")}
                      placeholder="0.00"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="prod-price">Selling price (سعر البيع)</Label>
                    <Input
                      id="prod-price"
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.unit_price || ""}
                      onChange={setField("unit_price")}
                      placeholder="0.00"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Profit per unit</Label>
                    <div className="flex h-10 items-center rounded-xl border border-zinc-800 bg-zinc-900/70 px-3.5">
                      <span className={`text-sm font-semibold tabular-nums ${previewProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {previewProfit >= 0 ? "+" : ""}{formatCurrency(previewProfit, currency)}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Expected margin</Label>
                    <div className="flex h-10 items-center rounded-xl border border-zinc-800 bg-zinc-900/70 px-3.5">
                      <span className={`text-sm font-semibold tabular-nums ${previewMargin >= 0.3 ? "text-emerald-400" : previewMargin >= 0.1 ? "text-amber-400" : "text-red-400"}`}>
                        {formatPercent(previewMargin)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Margin preview bar */}
                {form.unit_price > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-zinc-500">
                      <span>Margin preview</span>
                      <span className="tabular-nums">{formatPercent(previewMargin)} profit margin</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          previewMargin >= 0.3
                            ? "bg-gradient-to-r from-emerald-500 to-teal-400"
                            : previewMargin >= 0.1
                              ? "bg-gradient-to-r from-amber-500 to-yellow-400"
                              : "bg-gradient-to-r from-red-500 to-orange-400"
                        }`}
                        style={{ width: `${Math.max(2, Math.min(100, previewMargin * 100))}%` }}
                      />
                    </div>
                    <div className="flex gap-4 text-[11px] text-zinc-600">
                      <span>Cost: {formatCurrency(form.unit_cost, currency)}</span>
                      <span>→</span>
                      <span>Sell: {formatCurrency(form.unit_price, currency)}</span>
                      <span>=</span>
                      <span className={previewProfit >= 0 ? "text-emerald-500" : "text-red-500"}>
                        Profit: {formatCurrency(previewProfit, currency)}
                      </span>
                    </div>
                  </div>
                )}

                {error && (
                  <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-400">{error}</p>
                )}

                <div className="flex items-center gap-2">
                  <Button type="submit" size="sm" disabled={pending || demo}>
                    {pending ? "Saving…" : editingId ? "Update product" : "Add product"}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={cancel}>
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* Products table */}
          <Table>
            <THead>
              <TRow>
                <THeadCell>Product</THeadCell>
                <THeadCell>SKU</THeadCell>
                <THeadCell className="text-right">Cost price</THeadCell>
                <THeadCell className="text-right">Selling price</THeadCell>
                <THeadCell className="text-right">Profit / unit</THeadCell>
                <THeadCell className="text-right">Margin</THeadCell>
                <THeadCell className="text-right">Actions</THeadCell>
              </TRow>
            </THead>
            <TBody>
              {productsWithMargin.length === 0 ? (
                <TRow>
                  <TCell colSpan={7} className="py-12 text-center">
                    <IconPackage className="mx-auto mb-3 h-8 w-8 text-zinc-700" />
                    <p className="text-sm text-zinc-500">No products yet</p>
                    <p className="mt-1 text-xs text-zinc-600">Add your first product to start tracking costs and margins</p>
                  </TCell>
                </TRow>
              ) : (
                productsWithMargin.map((product) => (
                  <TRow key={product.id ?? product.sku}>
                    <TCell>
                      <p className="font-medium text-zinc-100">{product.name}</p>
                    </TCell>
                    <TCell>
                      <Badge variant="neutral">{product.sku}</Badge>
                    </TCell>
                    <TCell className="text-right tabular-nums text-zinc-300">
                      {formatCurrency(product.unit_cost, currency)}
                    </TCell>
                    <TCell className="text-right tabular-nums text-zinc-100 font-medium">
                      {formatCurrency(product.unit_price, currency)}
                    </TCell>
                    <TCell className={`text-right font-medium tabular-nums ${product.profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {product.profit >= 0 ? "+" : ""}{formatCurrency(product.profit, currency)}
                    </TCell>
                    <TCell className="text-right">
                      <Badge
                        variant={
                          product.margin >= 0.3
                            ? "success"
                            : product.margin >= 0.1
                              ? "warning"
                              : "danger"
                        }
                      >
                        {formatPercent(product.margin)}
                      </Badge>
                    </TCell>
                    <TCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => startEdit(product)}
                          disabled={demo || showForm}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                          onClick={async () => {
                            if (!confirm(`Delete "${product.name}"?`)) return;
                            const result = await deleteProduct(storeId, product.id ?? "");
                            if (!result.ok) alert(result.error);
                          }}
                          disabled={demo}
                        >
                          Delete
                        </Button>
                      </div>
                    </TCell>
                  </TRow>
                ))
              )}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      {/* Profit insights */}
      {productsWithMargin.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <IconSparkles className="h-4.5 w-4.5 text-emerald-400" />
              Profit insights
            </CardTitle>
            <CardDescription>Products ranked by profit margin</CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="space-y-3">
              {[...productsWithMargin]
                .sort((a, b) => b.margin - a.margin)
                .slice(0, 5)
                .map((product, i) => (
                  <div key={product.id ?? product.sku} className="flex items-center gap-4">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/60 text-[11px] font-bold text-zinc-500">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-100">{product.name}</p>
                      <p className="text-[11px] text-zinc-500">
                        {formatCurrency(product.unit_cost, currency)} → {formatCurrency(product.unit_price, currency)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold tabular-nums text-emerald-400">
                        {formatCurrency(product.profit, currency)}
                      </span>
                      <Badge
                        variant={
                          product.margin >= 0.3
                            ? "success"
                            : product.margin >= 0.1
                              ? "warning"
                              : "danger"
                        }
                      >
                        {formatPercent(product.margin)}
                      </Badge>
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
