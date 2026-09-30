"use client";

// ─── Shared admin-table helpers ───────────────────────────────────────────────
// Search + quick-filter bar used across every admin table view (shadcn/ui
// data-table pattern: global text search + column quick filters), plus a small
// CSV client-side helper for client-filtered exports.

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { IconSearch } from "@/components/icons";

/** Global text search + quick-filter state for one table view. */
export function useTableFilters<T>(
  rows: T[],
  searchable: (row: T) => string,
  filterDefs: Array<{ key: string; label: string; options: string[]; value: (row: T) => string }>,
) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (q && !searchable(row).toLowerCase().includes(q)) return false;
      for (const def of filterDefs) {
        const selected = filters[def.key];
        if (selected && selected !== "all" && def.value(row) !== selected) return false;
      }
      return true;
    });
  }, [rows, query, filters, searchable, filterDefs]);

  const filterBar =
    filterDefs.length > 0 ? (
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="h-9 w-56 pl-9 text-sm"
            aria-label="Search table"
          />
        </div>
        {filterDefs.map((def) => (
          <Select
            key={def.key}
            value={filters[def.key] ?? "all"}
            onChange={(e) => setFilters((f) => ({ ...f, [def.key]: e.target.value }))}
            className="h-9 w-auto min-w-36 text-xs"
            aria-label={def.label}
          >
            <option value="all">{def.label}: All</option>
            {def.options.map((opt) => (
              <option key={opt} value={opt}>
                {opt.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
        ))}
        {(query || Object.values(filters).some((v) => v && v !== "all")) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery("");
              setFilters({});
            }}
          >
            Clear
          </Button>
        )}
        <span className="ml-auto text-xs text-zinc-500 tabular-nums">
          {filtered.length} / {rows.length} rows
        </span>
      </div>
    ) : null;

  return { filtered, filterBar };
}

/** Escape + join rows into a CSV string and trigger a browser download. */
export function downloadCsv(filename: string, headers: string[], rows: unknown[][]): void {
  const escape = (value: unknown): string => {
    const str = value === null || value === undefined ? "" : String(value);
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const csv = [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
