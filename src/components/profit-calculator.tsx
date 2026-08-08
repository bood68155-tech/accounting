"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IconSparkles } from "@/components/icons";
import { formatCurrency, round2 } from "@/lib/utils";

interface InputState {
  sellingPrice: number;
  quantity: number;
  itemCost: number;
  shippingCharged: number;
  shippingCost: number;
  gatewayFeePct: number;
  gatewayFixed: number;
  discountPct: number;
}

const DEFAULTS: InputState = {
  sellingPrice: 32,
  quantity: 1,
  itemCost: 7.2,
  shippingCharged: 6.95,
  shippingCost: 4.35,
  gatewayFeePct: 2.9,
  gatewayFixed: 0.3,
  discountPct: 0,
};

export function ProfitCalculator() {
  const [values, setValues] = useState<InputState>(DEFAULTS);

  const set = (key: keyof InputState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [key]: parseFloat(e.target.value) || 0 }));

  const result = useMemo(() => {
    const subtotal = round2(values.sellingPrice * values.quantity);
    const discount = round2(subtotal * (values.discountPct / 100));
    const grossSales = round2(subtotal + values.shippingCharged);
    const netSales = round2(grossSales - discount);
    const cogs = round2(values.itemCost * values.quantity);
    const grossProfit = round2(netSales - cogs);
    const gatewayFee = round2(netSales * (values.gatewayFeePct / 100) + values.gatewayFixed);
    const netProfit = round2(grossProfit - gatewayFee - values.shippingCost);
    const netMargin = grossSales > 0 ? netProfit / grossSales : 0;
    const cogsPct = grossSales > 0 ? cogs / grossSales : 0;
    const feesPct = grossSales > 0 ? gatewayFee / grossSales : 0;
    const shippingPct = grossSales > 0 ? values.shippingCost / grossSales : 0;
    return { subtotal, discount, grossSales, netSales, cogs, grossProfit, gatewayFee, netProfit, netMargin, cogsPct, feesPct, shippingPct };
  }, [values]);

  const rows: Array<{ label: string; value: number; kind: "add" | "sub" | "total" }> = [
    { label: "Gross sales (price + shipping)", value: result.grossSales, kind: "add" },
    { label: "Discounts", value: -result.discount, kind: "sub" },
    { label: "Cost of goods (item cost × qty)", value: -result.cogs, kind: "sub" },
    { label: `Gateway fee (${values.gatewayFeePct}% + $${values.gatewayFixed.toFixed(2)})`, value: -result.gatewayFee, kind: "sub" },
    { label: "Shipping cost (you pay)", value: -values.shippingCost, kind: "sub" },
  ];

  const profitable = result.netProfit > 0;
  const marginBar = Math.max(2, Math.min(100, result.netMargin * 100 * 1.2));

  return (
    <Card className="overflow-hidden">
      <div className="grid md:grid-cols-2">
        {/* Inputs */}
        <div className="space-y-4 border-b border-zinc-800/70 p-6 md:border-b-0 md:border-r">
          <div className="flex items-center gap-2">
            <IconSparkles className="h-4.5 w-4.5 text-emerald-400" />
            <h3 className="text-sm font-semibold text-zinc-100">Profit calculator</h3>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pc-price">Selling price</Label>
              <Input id="pc-price" type="number" step="0.01" value={values.sellingPrice} onChange={set("sellingPrice")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pc-qty">Quantity</Label>
              <Input id="pc-qty" type="number" min="1" value={values.quantity} onChange={set("quantity")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pc-cost">Item cost (COGS)</Label>
              <Input id="pc-cost" type="number" step="0.01" value={values.itemCost} onChange={set("itemCost")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pc-discount">Discount (%)</Label>
              <Input id="pc-discount" type="number" step="0.5" value={values.discountPct} onChange={set("discountPct")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pc-ship-charged">Shipping charged</Label>
              <Input id="pc-ship-charged" type="number" step="0.01" value={values.shippingCharged} onChange={set("shippingCharged")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pc-ship-cost">Shipping cost to you</Label>
              <Input id="pc-ship-cost" type="number" step="0.01" value={values.shippingCost} onChange={set("shippingCost")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pc-fee-pct">Gateway fee (%)</Label>
              <Input id="pc-fee-pct" type="number" step="0.1" value={values.gatewayFeePct} onChange={set("gatewayFeePct")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pc-fee-fixed">Gateway fixed fee</Label>
              <Input id="pc-fee-fixed" type="number" step="0.01" value={values.gatewayFixed} onChange={set("gatewayFixed")} />
            </div>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
            onClick={() => setValues(DEFAULTS)}
          >
            Reset to defaults
          </Button>
        </div>

        {/* Breakdown */}
        <div className="p-6">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">True net profit</p>
          <p
            className={`mt-1 text-4xl font-bold tracking-tight tabular-nums ${
              profitable ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {formatCurrency(result.netProfit)}
          </p>
          <p className={`mt-1 text-xs font-medium ${profitable ? "text-emerald-500/80" : "text-red-500/80"}`}>
            {result.netMargin >= 0
              ? `+${(result.netMargin * 100).toFixed(1)}% net margin per unit`
              : `${(result.netMargin * 100).toFixed(1)}% net margin — this order loses money`}
          </p>

          {/* Margin gauge */}
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                profitable
                  ? "bg-gradient-to-r from-emerald-500 to-teal-400"
                  : "bg-gradient-to-r from-red-500 to-orange-400"
              }`}
              style={{ width: `${marginBar}%` }}
            />
          </div>

          <div className="mt-5 space-y-2.5">
            {rows.map((row) => (
              <div
                key={row.label}
                className={`flex items-center justify-between border-b border-zinc-800/60 pb-2.5 text-sm last:border-0 ${
                  row.kind === "total" ? "" : ""
                }`}
              >
                <span className="text-zinc-400">{row.label}</span>
                <span
                  className={`font-medium tabular-nums ${
                    row.kind === "add" ? "text-zinc-100" : row.value < 0 ? "text-red-400/90" : "text-zinc-100"
                  }`}
                >
                  {row.value < 0 ? "−" : "+"}
                  {formatCurrency(Math.abs(row.value))}
                </span>
              </div>
            ))}
          </div>

          {/* Cost split */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              { label: "COGS", pct: result.cogsPct, color: "bg-sky-400" },
              { label: "Fees", pct: result.feesPct, color: "bg-amber-400" },
              { label: "Shipping", pct: result.shippingPct, color: "bg-fuchsia-400" },
            ].map((seg) => (
              <div key={seg.label} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-2.5">
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${seg.color}`} />
                  <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{seg.label}</span>
                </div>
                <p className="mt-1 text-sm font-semibold text-zinc-200 tabular-nums">{(seg.pct * 100).toFixed(1)}%</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
