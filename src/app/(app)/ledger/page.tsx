import type { Metadata } from "next";
import { Topbar } from "@/components/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TCell, THead, THeadCell, TRow } from "@/components/ui/table";
import {
  aggregateAccountBalances,
  entriesTotalCredits,
  entriesTotalDebits,
} from "@/lib/accounting/doubleEntry";
import { fetchLedger } from "@/lib/data/repository";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { EntrySource } from "@/types";

export const metadata: Metadata = { title: "General Ledger" };

const SOURCE_VARIANTS: Record<EntrySource, "success" | "info" | "warning" | "danger" | "neutral"> = {
  order: "success",
  refund: "warning",
  fee: "info",
  adjustment: "danger",
  manual: "neutral",
};

const SOURCE_LABELS: Record<EntrySource, string> = {
  order: "Sale",
  refund: "Refund",
  fee: "Fee",
  adjustment: "Adjustment",
  manual: "Manual",
};

const TYPE_STYLES: Record<string, string> = {
  asset: "text-sky-400 bg-sky-500/10 border-sky-500/25",
  liability: "text-amber-400 bg-amber-500/10 border-amber-500/25",
  equity: "text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/25",
  revenue: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25",
  expense: "text-red-400 bg-red-500/10 border-red-500/25",
};

export default async function LedgerPage() {
  const entries = await fetchLedger();
  const balances = aggregateAccountBalances(entries);
  const debits = entriesTotalDebits(entries);
  const credits = entriesTotalCredits(entries);
  const balanced = Math.abs(debits - credits) < 0.01;
  const active = entries.filter((e) => e.status === "posted");

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <Topbar title="General Ledger" subtitle="Double-entry bookkeeping · every entry balanced" />

      <div className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-6 py-6">
        {/* Trial balance */}
        <Card className={balanced ? "border-emerald-500/30" : "border-red-500/40"}>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-3">
              <span className={`h-2.5 w-2.5 rounded-full ${balanced ? "bg-emerald-400" : "bg-red-400"} animate-pulse-dot`} />
              <div>
                <p className="text-sm font-semibold text-zinc-100">
                  Trial balance {balanced ? "in equilibrium" : "out of balance"}
                </p>
                <p className="text-xs text-zinc-500">
                  {entries.length} entries · {active.length} posted · Σ debits = Σ credits
                </p>
              </div>
            </div>
            <div className="flex gap-4 text-sm tabular-nums">
              <span className="text-zinc-400">
                Debits <span className="font-semibold text-zinc-100">{formatCurrency(debits)}</span>
              </span>
              <span className="text-zinc-400">
                Credits <span className="font-semibold text-zinc-100">{formatCurrency(credits)}</span>
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Account balances */}
        <Card>
          <CardHeader>
            <CardTitle>Chart of accounts</CardTitle>
            <CardDescription>Balances signed by normal balance direction</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <Table>
              <THead>
                <TRow>
                  <THeadCell>Code</THeadCell>
                  <THeadCell>Account</THeadCell>
                  <THeadCell>Type</THeadCell>
                  <THeadCell className="text-right">Debits</THeadCell>
                  <THeadCell className="text-right">Credits</THeadCell>
                  <THeadCell className="text-right">Balance</THeadCell>
                </TRow>
              </THead>
              <TBody>
                {balances.map((account) => (
                  <TRow key={account.account_code}>
                    <TCell className="font-mono text-xs text-zinc-500">{account.account_code}</TCell>
                    <TCell className="font-medium text-zinc-100">{account.account_name}</TCell>
                    <TCell>
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${TYPE_STYLES[account.account_type] ?? TYPE_STYLES.expense}`}
                      >
                        {account.account_type}
                      </span>
                    </TCell>
                    <TCell className="text-right text-zinc-400 tabular-nums">{formatCurrency(account.debits)}</TCell>
                    <TCell className="text-right text-zinc-400 tabular-nums">{formatCurrency(account.credits)}</TCell>
                    <TCell
                      className={`text-right font-semibold tabular-nums ${
                        account.balance === 0
                          ? "text-zinc-500"
                          : account.balance > 0
                            ? account.account_type === "expense" || account.account_type === "asset"
                              ? "text-red-400"
                              : "text-emerald-400"
                            : account.account_type === "expense" || account.account_type === "asset"
                              ? "text-emerald-400"
                              : "text-red-400"
                      }`}
                    >
                      {formatCurrency(account.balance)}
                    </TCell>
                  </TRow>
                ))}
                {balances.length === 0 && (
                  <TRow>
                    <TCell colSpan={6} className="py-10 text-center text-sm text-zinc-500">
                      No journal entries yet — incoming webhooks will populate the ledger.
                    </TCell>
                  </TRow>
                )}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        {/* Journal entries */}
        <Card>
          <CardHeader>
            <CardTitle>Journal entries</CardTitle>
            <CardDescription>Posted automatically from order & refund webhooks</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-2">
              {[...entries].reverse().map((entry) => {
                const entryDebits = entry.lines.reduce((s, l) => s + l.debit, 0);
                const entryCredits = entry.lines.reduce((s, l) => s + l.credit, 0);
                return (
                  <details key={entry.id ?? entry.entry_number} className="group rounded-xl border border-zinc-800 bg-zinc-900/40 transition-colors open:border-zinc-700 hover:border-zinc-700">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                      <span className="font-mono text-xs font-semibold text-emerald-400">
                        JE-{String(entry.entry_number).padStart(4, "0")}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-200">{entry.description}</span>
                      <Badge variant={SOURCE_VARIANTS[entry.source] ?? "neutral"}>{SOURCE_LABELS[entry.source] ?? entry.source}</Badge>
                      <span className="hidden text-xs text-zinc-500 sm:block">{formatDate(entry.entry_date)}</span>
                      <span className="text-xs text-zinc-500">Ref {entry.reference}</span>
                      <span className="text-xs font-medium text-zinc-400 tabular-nums">
                        {formatCurrency(entryDebits)}
                      </span>
                    </summary>
                    <div className="border-t border-zinc-800/70 px-4 py-2">
                      <Table>
                        <THead>
                          <TRow>
                            <THeadCell className="w-24">Account</THeadCell>
                            <THeadCell>Description</THeadCell>
                            <THeadCell className="text-right">Debit</THeadCell>
                            <THeadCell className="text-right">Credit</THeadCell>
                          </TRow>
                        </THead>
                        <TBody>
                          {entry.lines.map((line, i) => (
                            <TRow key={i}>
                              <TCell className="font-mono text-xs text-zinc-400">{line.account_code}</TCell>
                              <TCell className="text-zinc-300">
                                {line.account_name}
                                <span className="ml-2 text-xs text-zinc-600">{line.description}</span>
                              </TCell>
                              <TCell className="text-right text-zinc-100 tabular-nums">
                                {line.debit > 0 ? formatCurrency(line.debit) : "—"}
                              </TCell>
                              <TCell className="text-right text-zinc-100 tabular-nums">
                                {line.credit > 0 ? formatCurrency(line.credit) : "—"}
                              </TCell>
                            </TRow>
                          ))}
                          <TRow className="border-0 bg-transparent">
                            <TCell className="text-xs font-semibold uppercase tracking-wider text-zinc-500" colSpan={2}>
                              Balanced
                            </TCell>
                            <TCell className="text-right text-xs font-semibold text-zinc-200 tabular-nums">
                              {formatCurrency(entryDebits)}
                            </TCell>
                            <TCell className="text-right text-xs font-semibold text-zinc-200 tabular-nums">
                              {formatCurrency(entryCredits)}
                            </TCell>
                          </TRow>
                        </TBody>
                      </Table>
                    </div>
                  </details>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
