"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { balanceSheetRows, buildBalanceSheet } from "@/lib/accounting/balanceSheet";
import type { JournalEntry } from "@/types";
import { formatCurrency } from "@/lib/utils";

/**
 * Balance Sheet view. The ledger is fetched server-side and passed down; the
 * client recomputes the statement when the as-of date changes (pure function
 * over the same entries — no extra round-trips).
 */
export function BalanceSheetView({
  entries,
  currency,
}: {
  entries: JournalEntry[];
  currency: string;
}) {
  const [asOf, setAsOf] = useState<string>("");

  const sheet = useMemo(() => buildBalanceSheet(entries, asOf || undefined), [entries, asOf]);
  const rows = useMemo(() => balanceSheetRows(sheet), [sheet]);

  const fmt = (value: number) => formatCurrency(value, currency);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <label className="text-sm text-zinc-400">
          As of{" "}
          <input
            type="date"
            value={asOf}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setAsOf(e.target.value)}
            className="ml-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100"
          />
        </label>
        <Badge variant={sheet.balances ? "success" : "warning"}>
          {sheet.balances ? "Balanced ✓" : "Out of balance"}
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Assets</CardTitle>
            <CardDescription>As of {sheet.as_of}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {rows
              .filter((r) => r.section === "assets")
              .map((row) => (
                <div
                  key={row.key}
                  className={`flex items-center justify-between ${
                    row.kind === "total" ? "border-t border-zinc-800 pt-2 font-semibold text-zinc-100" : "text-zinc-300"
                  }`}
                >
                  <span>{row.label}</span>
                  <span className="tabular-nums">{fmt(row.value)}</span>
                </div>
              ))}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Liabilities</CardTitle>
              <CardDescription>What the business owes</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {rows
                .filter((r) => r.section === "liabilities")
                .map((row) => (
                  <div
                    key={row.key}
                    className={`flex items-center justify-between ${
                      row.kind === "total"
                        ? "border-t border-zinc-800 pt-2 font-semibold text-zinc-100"
                        : "text-zinc-300"
                    }`}
                  >
                    <span>{row.label}</span>
                    <span className="tabular-nums">{fmt(row.value)}</span>
                  </div>
                ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Equity</CardTitle>
              <CardDescription>Owner capital + retained earnings (cumulative net profit)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {rows
                .filter((r) => r.section === "equity")
                .map((row) => (
                  <div
                    key={row.key}
                    className={`flex items-center justify-between ${
                      row.kind === "total"
                        ? "border-t border-zinc-800 pt-2 font-semibold text-zinc-100"
                        : "text-zinc-300"
                    }`}
                  >
                    <span>{row.label}</span>
                    <span className="tabular-nums">{fmt(row.value)}</span>
                  </div>
                ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <p className="text-xs text-zinc-500">
        Assets = {fmt(sheet.assets.total_assets)} · Liabilities + Equity ={" "}
        {fmt(sheet.total_liabilities_and_equity)} ·{" "}
        {sheet.balances ? "identity holds ✓" : "identity mismatch — inspect journal entries"}
      </p>
    </div>
  );
}
