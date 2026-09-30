"use client";

// ─── Audit tab: who changed what in the admin console ─────────────────────────

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TCell, THead, THeadCell, TRow } from "@/components/ui/table";
import type { AdminAuditEntry } from "@/lib/admin/billing-types";
import { downloadCsv, useTableFilters } from "@/components/admin/table-filters";
import { formatDateTime, relativeTime } from "@/lib/utils";

export function AuditTab({ entries }: { entries: AdminAuditEntry[] }) {
  const { filtered, filterBar } = useTableFilters<AdminAuditEntry>(
    entries,
    (e) => `${e.actorEmail} ${e.action} ${e.targetType ?? ""} ${e.targetId ?? ""}`,
    [
      {
        key: "action",
        label: "Action",
        options: [...new Set(entries.map((e) => e.action))].sort(),
        value: (e) => e.action,
      },
    ],
  );

  function exportCsv() {
    downloadCsv(
      `admin-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      ["timestamp", "actor", "action", "target_type", "target_id", "detail"],
      filtered.map((e) => [
        e.createdAt,
        e.actorEmail,
        e.action,
        e.targetType ?? "",
        e.targetId ?? "",
        JSON.stringify(e.detail),
      ]),
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Admin audit log</CardTitle>
          <CardDescription>
            Every billing mutation is recorded — actor, action, target and details
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          Export CSV
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 pt-2">
        {filterBar}
        <Table>
          <THead>
            <TRow>
              <THeadCell>When</THeadCell>
              <THeadCell>Actor</THeadCell>
              <THeadCell>Action</THeadCell>
              <THeadCell>Target</THeadCell>
              <THeadCell>Detail</THeadCell>
            </TRow>
          </THead>
          <TBody>
            {filtered.length === 0 ? (
              <TRow>
                <TCell colSpan={5} className="py-8 text-center text-sm text-zinc-500">
                  No audit entries yet — they appear as billing changes are made.
                </TCell>
              </TRow>
            ) : (
              filtered.map((entry) => (
                <TRow key={entry.id}>
                  <TCell className="whitespace-nowrap text-xs text-zinc-400">
                    <span title={formatDateTime(entry.createdAt)}>{relativeTime(entry.createdAt)}</span>
                  </TCell>
                  <TCell className="text-xs text-zinc-200">{entry.actorEmail}</TCell>
                  <TCell>
                    <Badge variant="default">{entry.action}</Badge>
                  </TCell>
                  <TCell className="text-xs text-zinc-400">
                    {entry.targetType ? `${entry.targetType} · ${entry.targetId ?? "—"}` : "—"}
                  </TCell>
                  <TCell className="max-w-72 truncate font-mono text-[11px] text-zinc-500">
                    {JSON.stringify(entry.detail)}
                  </TCell>
                </TRow>
              ))
            )}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
}
