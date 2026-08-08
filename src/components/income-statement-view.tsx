"use client";

import { useMemo, useState } from "react";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { incomeStatementRows, buildIncomeStatementFromOrders } from "@/lib/accounting/incomeStatement";
import { formatCurrency, formatPercent } from "@/lib/utils";
import type { Order } from "@/types";

type PeriodKey = "30d" | "90d" | "ytd" | "all";

const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "ytd", label: "Year to date" },
  { key: "all", label: "All time" },
];

function periodBounds(key: PeriodKey): { from?: string; to?: string } {
  const now = Date.now();
  if (key === "30d") return { from: new Date(now - 30 * 86_400_000).toISOString() };
  if (key === "90d") return { from: new Date(now - 90 * 86_400_000).toISOString() };
  if (key === "ytd") return { from: `${new Date().getUTCFullYear()}-01-01` };
  return {};
}

export function IncomeStatementView({ orders, currency = "USD" }: { orders: Order[]; currency?: string }) {
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [bounds, setBounds] = useState<{ from?: string; to?: string }>(() => periodBounds("30d"));

  const statement = useMemo(
    () => buildIncomeStatementFromOrders(orders, bounds.from, bounds.to),
    [orders, bounds],
  );

  const rows = incomeStatementRows(statement);

  const handlePeriodChange = (key: PeriodKey) => {
    setPeriod(key);
    setBounds(periodBounds(key));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Net profit</p>
            <p className={`text-lg font-bold tabular-nums ${statement.net_profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {formatCurrency(statement.net_profit, currency)}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Net margin</p>
            <p className="text-lg font-bold text-zinc-100 tabular-nums">{formatPercent(statement.net_margin)}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Gross margin</p>
            <p className="text-lg font-bold text-zinc-100 tabular-nums">{formatPercent(statement.gross_margin)}</p>
          </div>
        </div>
        <Select
          value={period}
          onChange={(e) => handlePeriodChange(e.target.value as PeriodKey)}
          className="sm:w-44"
        >
          {PERIODS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>Income statement (P&amp;L)</CardTitle>
            <CardDescription>
              {new Date(statement.period.from).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              {" → "}
              {new Date(statement.period.to).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </CardDescription>
          </div>
          <Badge variant="success">US GAAP style</Badge>
        </CardHeader>
        <CardContent className="pt-4">
          <table className="w-full text-sm">
            <tbody>
              {rows.map((row) => {
                const valueColor =
                  row.kind === "total"
                    ? row.value >= 0
                      ? "text-emerald-400"
                      : "text-red-400"
                    : row.kind === "subtotal"
                      ? "text-zinc-100"
                      : row.value >= 0
                        ? "text-zinc-300"
                        : "text-red-400/90";
                return (
                  <tr
                    key={row.key}
                    className={`border-b border-zinc-800/60 last:border-0 ${
                      row.kind === "subtotal" || row.kind === "total" ? "bg-zinc-800/20" : ""
                    }`}
                  >
                    <td className="py-2.5 pl-2">
                      <span
                        className={
                          row.kind === "subtotal" || row.kind === "total"
                            ? "font-semibold text-zinc-100"
                            : "text-zinc-400"
                        }
                      >
                        {row.label}
                      </span>
                    </td>
                    <td className="py-2.5 pr-2 text-right">
                      <span className={`font-medium tabular-nums ${valueColor}`}>
                        {row.value < 0 ? "(" : ""}
                        {formatCurrency(Math.abs(row.value), currency)}
                        {row.value < 0 ? ")" : ""}
                      </span>
                    </td>
                    <td className="w-20 py-2.5 pr-4 text-right">
                      {row.kind === "subtotal" || row.kind === "total" ? (
                        <span className="text-xs text-zinc-500 tabular-nums">
                          {row.key === "net-profit"
                            ? formatPercent(statement.net_margin)
                            : row.key === "gross-profit"
                              ? formatPercent(statement.gross_margin)
                              : row.key === "net-revenue"
                                ? "100%"
                                : ""}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
