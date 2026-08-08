"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TBody, TCell, THead, THeadCell, TRow } from "@/components/ui/table";
import { IconSearch } from "@/components/icons";
import { computeOrderProfit } from "@/lib/accounting/profitEngine";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import type { Order } from "@/types";

const STATUS_OPTIONS = ["all", "paid", "pending", "partially_refunded", "refunded"] as const;

export function OrdersTable({ orders }: { orders: Order[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesStatus = status === "all" || order.status === status;
      const matchesQuery =
        !q ||
        order.order_number.toLowerCase().includes(q) ||
        order.customer_name.toLowerCase().includes(q) ||
        order.payment_gateway.toLowerCase().includes(q) ||
        order.items.some((item) => item.sku.toLowerCase().includes(q) || item.name.toLowerCase().includes(q));
      return matchesStatus && matchesQuery;
    });
  }, [orders, query, status]);

  const totals = useMemo(() => {
    const revenue = filtered.reduce((s, o) => s + o.total_amount - o.refund_amount, 0);
    const profit = filtered.reduce((s, o) => s + computeOrderProfit(o).net_profit, 0);
    const cogs = filtered.reduce((s, o) => s + computeOrderProfit(o).cogs, 0);
    return { revenue, profit, cogs, count: filtered.length };
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-72">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
          <Input
            placeholder="Search order, customer, SKU…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as never)} className="w-full sm:w-48">
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option === "all" ? "All statuses" : option.replace("_", " ")}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
        <span className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1">
          {totals.count} orders
        </span>
        <span className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1">
          Revenue <span className="font-medium text-zinc-200">{formatCurrency(totals.revenue)}</span>
        </span>
        <span className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1">
          COGS <span className="font-medium text-zinc-200">{formatCurrency(totals.cogs)}</span>
        </span>
        <span className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1">
          Net profit{" "}
          <span className={`font-medium ${totals.profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {formatCurrency(totals.profit)}
          </span>
        </span>
      </div>

      <Table>
        <THead>
          <TRow>
            <THeadCell>Order</THeadCell>
            <THeadCell>Customer</THeadCell>
            <THeadCell>Items</THeadCell>
            <THeadCell>Gateway</THeadCell>
            <THeadCell className="text-right">Revenue</THeadCell>
            <THeadCell className="text-right">COGS</THeadCell>
            <THeadCell className="text-right">Fee</THeadCell>
            <THeadCell className="text-right">Net profit</THeadCell>
            <THeadCell>Status</THeadCell>
            <THeadCell>Date</THeadCell>
          </TRow>
        </THead>
        <TBody>
          {filtered.map((order) => {
            const profit = computeOrderProfit(order);
            const netIsProfit = profit.net_profit >= 0;
            return (
              <TRow key={order.external_id}>
                <TCell className="font-medium text-zinc-100">{order.order_number}</TCell>
                <TCell className="text-zinc-300">{order.customer_name}</TCell>
                <TCell className="text-zinc-500">
                  {order.items.length} · {order.items.reduce((s, i) => s + i.quantity, 0)} units
                </TCell>
                <TCell className="text-zinc-400">{order.payment_gateway}</TCell>
                <TCell className="text-right text-zinc-100 tabular-nums">{formatCurrency(order.total_amount, order.currency)}</TCell>
                <TCell className="text-right text-zinc-400 tabular-nums">{formatCurrency(profit.cogs, order.currency)}</TCell>
                <TCell className="text-right text-zinc-400 tabular-nums">{formatCurrency(profit.payment_fees, order.currency)}</TCell>
                <TCell className={`text-right font-medium tabular-nums ${netIsProfit ? "text-emerald-400" : "text-red-400"}`}>
                  {netIsProfit ? "+" : "−"}
                  {formatCurrency(Math.abs(profit.net_profit), order.currency)}
                </TCell>
                <TCell>
                  <Badge
                    variant={
                      order.status === "paid"
                        ? "success"
                        : order.status === "refunded"
                          ? "danger"
                          : order.status === "partially_refunded"
                            ? "warning"
                            : "neutral"
                    }
                  >
                    {order.status.replace("_", " ")}
                  </Badge>
                </TCell>
                <TCell className="whitespace-nowrap text-zinc-500">{formatDateTime(order.ordered_at)}</TCell>
              </TRow>
            );
          })}
          {filtered.length === 0 && (
            <TRow>
              <TCell colSpan={10} className="py-12 text-center text-sm text-zinc-500">
                No orders match your filters.
              </TCell>
            </TRow>
          )}
        </TBody>
      </Table>
    </div>
  );
}
