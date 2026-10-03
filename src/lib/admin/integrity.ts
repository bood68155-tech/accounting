import {
  isDatabaseConfigured,
  isTenantSchema,
  requireDb,
  publicSchema,
  tenantDb,
  getTenantTables,
} from "@/lib/db";
import { round2 } from "@/lib/utils";

/**
 * ── Platform ledger integrity ─────────────────────────────────────────────────
 * An administrative utility that reconciles every tenant's books: for each
 * tenant schema it sums journal lines per entry and flags any entry where
 * Σ debits ≠ Σ credits, then rolls the result up platform-wide.
 *
 * Double-entry integrity is the one invariant that must hold globally, so this
 * is the fastest signal that a tenant's books (or the ingestion pipeline) is
 * broken. It reads tenant schemas directly — this module is server/admin-only.
 */

export interface TenantIntegrity {
  tenant_id: string;
  schema_name: string;
  store_count: number;
  entry_count: number;
  line_count: number;
  total_debits: number;
  total_credits: number;
  unbalanced_entries: number;
  balanced: boolean;
}

export interface PlatformIntegrity {
  checked_at: string;
  tenants: TenantIntegrity[];
  totals: {
    tenants: number;
    entries: number;
    lines: number;
    unbalanced_entries: number;
    total_debits: number;
    total_credits: number;
    balanced: boolean;
  };
}

export async function fetchPlatformIntegrity(): Promise<PlatformIntegrity> {
  if (!isDatabaseConfigured()) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const db = requireDb();
  const { tenants } = publicSchema;
  const tenantRows = await db
    .select({ id: tenants.id, schemaName: tenants.schemaName })
    .from(tenants);

  const results: TenantIntegrity[] = [];

  for (const tenant of tenantRows) {
    const schema = tenant.schemaName;
    if (!schema || !isTenantSchema(schema)) continue;

    const t = getTenantTables(schema);
    const tdb = tenantDb(schema);

    const [storeRows, entryRows, lineRows] = await Promise.all([
      tdb.select({ id: t.stores.id }).from(t.stores),
      tdb.select({ id: t.journalEntries.id }).from(t.journalEntries),
      tdb
        .select({
          entryId: t.journalLines.entryId,
          debit: t.journalLines.debit,
          credit: t.journalLines.credit,
        })
        .from(t.journalLines),
    ]);

    const byEntry = new Map<string, { debit: number; credit: number }>();
    for (const l of lineRows) {
      const acc = byEntry.get(l.entryId) ?? { debit: 0, credit: 0 };
      acc.debit += l.debit;
      acc.credit += l.credit;
      byEntry.set(l.entryId, acc);
    }

    let totalDebits = 0;
    let totalCredits = 0;
    let unbalanced = 0;
    for (const entry of entryRows) {
      const acc = byEntry.get(entry.id);
      if (!acc) {
        // An entry with no lines is itself a defect.
        unbalanced += 1;
        continue;
      }
      totalDebits += acc.debit;
      totalCredits += acc.credit;
      if (Math.abs(acc.debit - acc.credit) > 0.005) unbalanced += 1;
    }

    results.push({
      tenant_id: tenant.id,
      schema_name: schema,
      store_count: storeRows.length,
      entry_count: entryRows.length,
      line_count: lineRows.length,
      total_debits: round2(totalDebits),
      total_credits: round2(totalCredits),
      unbalanced_entries: unbalanced,
      balanced: unbalanced === 0,
    });
  }

  results.sort((a, b) => b.entry_count - a.entry_count);

  return {
    checked_at: new Date().toISOString(),
    tenants: results,
    totals: {
      tenants: results.length,
      entries: results.reduce((s, r) => s + r.entry_count, 0),
      lines: results.reduce((s, r) => s + r.line_count, 0),
      unbalanced_entries: results.reduce((s, r) => s + r.unbalanced_entries, 0),
      total_debits: round2(results.reduce((s, r) => s + r.total_debits, 0)),
      total_credits: round2(results.reduce((s, r) => s + r.total_credits, 0)),
      balanced: results.every((r) => r.balanced),
    },
  };
}
