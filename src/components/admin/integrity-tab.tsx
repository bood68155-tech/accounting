"use client";

// ─── Integrity tab: platform-wide double-entry reconciliation ─────────────────

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TCell, THead, THeadCell, TRow } from "@/components/ui/table";
import type { PlatformIntegrity } from "@/lib/admin/integrity";
import { formatCurrency, formatNumber, relativeTime } from "@/lib/utils";

export function IntegrityTab({ data }: { data: PlatformIntegrity }) {
  const { totals } = data;
  const healthy = totals.balanced;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Tenants checked" value={formatNumber(totals.tenants)} />
        <Stat label="Journal entries" value={formatNumber(totals.entries)} />
        <Stat
          label="Unbalanced entries"
          value={formatNumber(totals.unbalanced_entries)}
          danger={totals.unbalanced_entries > 0}
        />
        <Stat
          label="Σ debits vs Σ credits"
          value={
            totals.balanced
              ? formatCurrency(totals.total_debits)
              : `${formatNumber(totals.total_debits, 2)} / ${formatNumber(totals.total_credits, 2)}`
          }
          danger={!healthy}
        />
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Platform ledger integrity</CardTitle>
            <CardDescription>
              Every tenant schema, reconciled as of {relativeTime(data.checked_at)} — Σ debits must equal Σ credits per entry
            </CardDescription>
          </div>
          <Badge variant={healthy ? "success" : "danger"}>
            {healthy ? "All books balanced ✓" : "Integrity issues"}
          </Badge>
        </CardHeader>
        <CardContent className="pt-2">
          <Table>
            <THead>
              <TRow>
                <THeadCell>Tenant schema</THeadCell>
                <THeadCell className="text-right">Stores</THeadCell>
                <THeadCell className="text-right">Entries</THeadCell>
                <THeadCell className="text-right">Lines</THeadCell>
                <THeadCell className="text-right">Debits</THeadCell>
                <THeadCell className="text-right">Credits</THeadCell>
                <THeadCell>Status</THeadCell>
              </TRow>
            </THead>
            <TBody>
              {data.tenants.length === 0 ? (
                <TRow>
                  <TCell colSpan={7} className="py-8 text-center text-sm text-zinc-500">
                    No tenant schemas provisioned yet.
                  </TCell>
                </TRow>
              ) : (
                data.tenants.map((tenant) => (
                  <TRow key={tenant.tenant_id}>
                    <TCell className="font-mono text-[11px] text-zinc-300">{tenant.schema_name}</TCell>
                    <TCell className="text-right tabular-nums text-zinc-300">
                      {formatNumber(tenant.store_count)}
                    </TCell>
                    <TCell className="text-right tabular-nums text-zinc-300">
                      {formatNumber(tenant.entry_count)}
                    </TCell>
                    <TCell className="text-right tabular-nums text-zinc-300">
                      {formatNumber(tenant.line_count)}
                    </TCell>
                    <TCell className="text-right tabular-nums text-zinc-300">
                      {formatNumber(tenant.total_debits, 2)}
                    </TCell>
                    <TCell className="text-right tabular-nums text-zinc-300">
                      {formatNumber(tenant.total_credits, 2)}
                    </TCell>
                    <TCell>
                      <Badge variant={tenant.balanced ? "success" : "danger"}>
                        {tenant.balanced ? "balanced" : `${tenant.unbalanced_entries} unbalanced`}
                      </Badge>
                    </TCell>
                  </TRow>
                ))
              )}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="border border-white bg-black p-5">
      <p className="type-kicker text-zinc-500">{label}</p>
      <p
        className={`mt-2 text-2xl font-extrabold tabular-nums ${danger ? "text-red-400" : "text-white"}`}
      >
        {value}
      </p>
    </div>
  );
}
