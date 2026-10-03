"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TCell, THead, THeadCell, TRow } from "@/components/ui/table";
import { buildBalanceSheet } from "@/lib/accounting/balanceSheet";
import { buildIncomeStatementFromEntries } from "@/lib/accounting/incomeStatement";
import { buildCashFlowStatement } from "@/lib/accounting/cashFlow";
import { buildTrialBalance, trialBalanceToCsv } from "@/lib/accounting/trialBalance";
import { computeFinancialRatios, formatRatio, type RatioStatus } from "@/lib/accounting/ratios";
import { formatCurrency, formatPercent } from "@/lib/utils";
import type { JournalEntry } from "@/types";

type PeriodKey = "30d" | "90d" | "ytd" | "all";

const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "ytd", label: "Year to date" },
  { key: "all", label: "All time" },
];

const STATUS_BADGE: Record<RatioStatus, "success" | "info" | "warning" | "danger" | "neutral"> = {
  strong: "success",
  healthy: "info",
  watch: "warning",
  risk: "danger",
  "n/a": "neutral",
};

const GROUP_LABELS: Record<string, string> = {
  liquidity: "Liquidity",
  profitability: "Profitability",
  efficiency: "Efficiency",
  leverage: "Leverage",
};

function periodBounds(key: PeriodKey, entries: JournalEntry[]): { from?: string; to?: string } {
  const now = Date.now();
  if (key === "30d") return { from: new Date(now - 30 * 86_400_000).toISOString().slice(0, 10) };
  if (key === "90d") return { from: new Date(now - 90 * 86_400_000).toISOString().slice(0, 10) };
  if (key === "ytd") return { from: `${new Date().getUTCFullYear()}-01-01` };
  const dates = entries.map((e) => e.entry_date).sort();
  return { from: dates[0], to: dates[dates.length - 1] };
}

function daysBetween(from?: string, to?: string): number {
  if (!from) return 365;
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  return Math.max(1, Math.round((end - start) / 86_400_000));
}

export function FinancialHealthView({
  entries,
  currency = "USD",
}: {
  entries: JournalEntry[];
  currency?: string;
}) {
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [bounds, setBounds] = useState<{ from?: string; to?: string }>(() => periodBounds("30d", entries));

  const report = useMemo(() => {
    const { from, to } = bounds;
    const incomeStatement = buildIncomeStatementFromEntries(entries, from, to);
    const balanceSheet = buildBalanceSheet(entries, to);
    const periodDays = daysBetween(from, to);
    const health = computeFinancialRatios(balanceSheet, incomeStatement, { periodDays });
    const cashFlow = buildCashFlowStatement(entries, from, to);
    const trialBalance = buildTrialBalance(entries, to);
    return { incomeStatement, balanceSheet, health, cashFlow, trialBalance };
  }, [entries, bounds]);

  const { health, cashFlow, trialBalance, incomeStatement } = report;
  const fmt = (value: number) => formatCurrency(value, currency);

  const exportTrialBalance = () => {
    const blob = new Blob([trialBalanceToCsv(trialBalance)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `trial-balance-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const groups = ["liquidity", "profitability", "efficiency", "leverage"] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid flex-1 grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Health score" value={`${health.score}/100`} sub={`Grade ${health.grade}`} />
          <Metric
            label="Net margin"
            value={formatPercent(incomeStatement.net_margin)}
            sub={`${fmt(incomeStatement.net_profit)} net profit`}
          />
          <Metric
            label="Working capital"
            value={fmt(health.working_capital)}
            sub={health.working_capital >= 0 ? "Positive" : "Negative"}
          />
          <Metric
            label="Cash conversion"
            value={health.cash_conversion_cycle_days === null ? "—" : `${health.cash_conversion_cycle_days.toFixed(0)}d`}
            sub="DIO + DSO − DPO"
          />
        </div>
        <Select
          value={period}
          onChange={(e) => {
            const key = e.target.value as PeriodKey;
            setPeriod(key);
            setBounds(periodBounds(key, entries));
          }}
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
            <CardTitle>Financial ratios</CardTitle>
            <CardDescription>
              Liquidity, profitability, efficiency and leverage — with benchmark bands
            </CardDescription>
          </div>
          <Badge variant={health.score >= 70 ? "success" : health.score >= 50 ? "warning" : "danger"}>
            {health.grade}
          </Badge>
        </CardHeader>
        <CardContent className="pt-2">
          <Table>
            <THead>
              <TRow>
                <THeadCell>Ratio</THeadCell>
                <THeadCell className="text-right">Value</THeadCell>
                <THeadCell>Status</THeadCell>
                <THeadCell>Benchmark</THeadCell>
              </TRow>
            </THead>
            <TBody>
              {groups.flatMap((group) =>
                health.ratios
                  .filter((r) => r.group === group)
                  .map((r, idx) => (
                    <TRow key={r.key}>
                      <TCell>
                        {idx === 0 ? (
                          <p className="type-kicker mb-1 text-zinc-600">{GROUP_LABELS[group]}</p>
                        ) : null}
                        <p className="font-medium text-zinc-100">{r.label}</p>
                        <p className="text-xs text-zinc-500">{r.hint}</p>
                      </TCell>
                      <TCell className="text-right font-medium tabular-nums text-zinc-100">
                        {formatRatio(r)}
                      </TCell>
                      <TCell>
                        <Badge variant={STATUS_BADGE[r.status]}>{r.status}</Badge>
                      </TCell>
                      <TCell className="text-xs text-zinc-500">{r.benchmark}</TCell>
                    </TRow>
                  )),
              )}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Statement of cash flows</CardTitle>
              <CardDescription>
                Direct method · {cashFlow.period.from} → {cashFlow.period.to}
              </CardDescription>
            </div>
            <Badge variant={cashFlow.reconciles ? "success" : "warning"}>
              {cashFlow.reconciles ? "Reconciled ✓" : "Check"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2 pt-2">
            <SectionLines
              title="Operating"
              lines={cashFlow.operating.lines}
              net={cashFlow.operating.net}
              currency={currency}
            />
            <SectionLines
              title="Investing"
              lines={cashFlow.investing.lines}
              net={cashFlow.investing.net}
              currency={currency}
            />
            <SectionLines
              title="Financing"
              lines={cashFlow.financing.lines}
              net={cashFlow.financing.net}
              currency={currency}
            />
            <div className="space-y-1 border-t border-zinc-800 pt-3 text-sm">
              <Row label="Opening cash" value={fmt(cashFlow.opening_cash)} />
              <Row label="Net change in cash" value={fmt(cashFlow.net_change)} emphasized />
              <Row label="Closing cash" value={fmt(cashFlow.closing_cash)} emphasized />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Trial balance</CardTitle>
              <CardDescription>Σ debits must equal Σ credits</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={trialBalance.balanced ? "success" : "danger"}>
                {trialBalance.balanced ? "Balanced ✓" : "Unbalanced"}
              </Badge>
              <Button variant="outline" size="sm" onClick={exportTrialBalance}>
                Export CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <Table>
              <THead>
                <TRow>
                  <THeadCell>Account</THeadCell>
                  <THeadCell className="text-right">Debit</THeadCell>
                  <THeadCell className="text-right">Credit</THeadCell>
                </TRow>
              </THead>
              <TBody>
                {trialBalance.rows.map((row) => (
                  <TRow key={row.account_code}>
                    <TCell>
                      <p className="text-zinc-100">
                        <span className="text-zinc-500">{row.account_code}</span> {row.account_name}
                      </p>
                    </TCell>
                    <TCell className="text-right tabular-nums text-zinc-300">
                      {row.debit > 0 ? fmt(row.debit) : "—"}
                    </TCell>
                    <TCell className="text-right tabular-nums text-zinc-300">
                      {row.credit > 0 ? fmt(row.credit) : "—"}
                    </TCell>
                  </TRow>
                ))}
                <TRow>
                  <TCell className="font-semibold text-zinc-100">Total</TCell>
                  <TCell className="text-right font-semibold tabular-nums text-zinc-100">
                    {fmt(trialBalance.total_debit)}
                  </TCell>
                  <TCell className="text-right font-semibold tabular-nums text-zinc-100">
                    {fmt(trialBalance.total_credit)}
                  </TCell>
                </TRow>
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-white bg-black px-4 py-3">
      <p className="type-kicker text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-extrabold tabular-nums text-white">{value}</p>
      {sub ? <p className="text-[11px] text-zinc-500">{sub}</p> : null}
    </div>
  );
}

function Row({ label, value, emphasized }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={emphasized ? "font-medium text-zinc-200" : "text-zinc-400"}>{label}</span>
      <span className={`tabular-nums ${emphasized ? "font-semibold text-zinc-100" : "text-zinc-300"}`}>
        {value}
      </span>
    </div>
  );
}

function SectionLines({
  title,
  lines,
  net,
  currency,
}: {
  title: string;
  lines: Array<{ key: string; label: string; amount: number }>;
  net: number;
  currency: string;
}) {
  return (
    <div className="space-y-1 border-t border-zinc-800 pt-3 first:border-0 first:pt-0">
      <p className="type-kicker text-zinc-600">{title}</p>
      {lines.length === 0 ? (
        <p className="text-xs text-zinc-600">No {title.toLowerCase()} activity.</p>
      ) : (
        lines.map((l) => (
          <div key={l.key} className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">{l.label}</span>
            <span className="tabular-nums text-zinc-300">{formatCurrency(l.amount, currency)}</span>
          </div>
        ))
      )}
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-zinc-200">Net {title.toLowerCase()}</span>
        <span className="font-semibold tabular-nums text-zinc-100">{formatCurrency(net, currency)}</span>
      </div>
    </div>
  );
}
