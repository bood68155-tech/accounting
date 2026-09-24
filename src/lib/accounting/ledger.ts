import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { tenantDb, getTenantTables } from "@/lib/db";
import { buildReversalEntry } from "@/lib/accounting/doubleEntry";
import type { JournalEntry } from "@/types";

/**
 * ── Ledger persistence + ERPNext-style reversal engine ───────────────────────
 * Shared by the webhook ingestion pipeline and the manual reversal action.
 *
 * The posted journal is immutable at the database level (migration
 * 20260924000000): corrections are NEW entries that swap every line of the
 * original and link back via `reversal_of`. This module owns that flow:
 *
 *   persistEntries(schema, entries)          — batch-insert entries + lines
 *   nextEntryNumber(schema)                  — sequential numbering
 *   getPostedEntryById(schema, storeId, id)  — fetch an entry with its lines
 *   getReversalOf(schema, entryId)           — find an existing reversal
 *   reverseEntry(schema, storeId, entryId, reason) — the full cancellation
 */

export async function persistEntries(schema: string, entries: JournalEntry[]) {
  if (entries.length === 0) return;
  const db = tenantDb(schema);
  const t = getTenantTables(schema);

  for (const entry of entries) {
    const entryId = randomUUID();
    // Propagate the generated id back onto the caller's object so callers
    // (reversal flow, tests) can reference the persisted row immediately.
    entry.id = entryId;
    await db.batch(
      [
        db.insert(t.journalEntries).values({
          id: entryId,
          storeId: entry.store_id,
          entryNumber: entry.entry_number,
          entryDate: entry.entry_date,
          description: entry.description,
          reference: entry.reference,
          source: entry.source,
          status: entry.status,
          reversalOf: entry.reversal_of ?? null,
          reversalReason: entry.reversal_reason ?? null,
        }),
        ...entry.lines.map((line) =>
          db.insert(t.journalLines).values({
            entryId,
            accountCode: line.account_code,
            accountName: line.account_name,
            accountType: line.account_type,
            description: line.description,
            debit: line.debit,
            credit: line.credit,
          }),
        ),
      ] as never,
    );
  }
}

export async function nextEntryNumber(schema: string): Promise<number> {
  const t = getTenantTables(schema);
  const rows = await tenantDb(schema)
    .select({ entryNumber: t.journalEntries.entryNumber })
    .from(t.journalEntries)
    .orderBy(desc(t.journalEntries.entryNumber))
    .limit(1);
  return (rows[0]?.entryNumber ?? 0) + 1;
}

/** One posted entry (with lines) owned by a store — reversal candidate. */
export async function getPostedEntryById(
  schema: string,
  storeId: string,
  entryId: string,
): Promise<JournalEntry & { id: string } | null> {
  const db = tenantDb(schema);
  const t = getTenantTables(schema);

  const rows = await db
    .select()
    .from(t.journalEntries)
    .where(and(eq(t.journalEntries.id, entryId), eq(t.journalEntries.storeId, storeId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const lineRows = await db
    .select()
    .from(t.journalLines)
    .where(eq(t.journalLines.entryId, entryId));

  return {
    id: row.id,
    store_id: row.storeId,
    entry_number: row.entryNumber,
    entry_date: row.entryDate,
    description: row.description,
    reference: row.reference ?? "",
    source: row.source,
    status: row.status,
    lines: lineRows.map((l) => ({
      account_code: l.accountCode,
      account_name: l.accountName,
      account_type: l.accountType,
      description: l.description ?? "",
      debit: l.debit,
      credit: l.credit,
    })),
    reversal_of: row.reversalOf,
    reversal_reason: row.reversalReason,
  };
}

/** The reversal already posted for an entry, if any (idempotency guard). */
export async function getReversalOf(
  schema: string,
  entryId: string,
): Promise<JournalEntry | null> {
  const db = tenantDb(schema);
  const t = getTenantTables(schema);

  const rows = await db
    .select()
    .from(t.journalEntries)
    .where(eq(t.journalEntries.reversalOf, entryId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const lineRows = await db
    .select()
    .from(t.journalLines)
    .where(eq(t.journalLines.entryId, row.id));

  return {
    id: row.id,
    store_id: row.storeId,
    entry_number: row.entryNumber,
    entry_date: row.entryDate,
    description: row.description,
    reference: row.reference ?? "",
    source: row.source,
    status: row.status,
    lines: lineRows.map((l) => ({
      account_code: l.accountCode,
      account_name: l.accountName,
      account_type: l.accountType,
      description: l.description ?? "",
      debit: l.debit,
      credit: l.credit,
    })),
    reversal_of: row.reversalOf,
    reversal_reason: row.reversalReason,
  };
}

export interface ReversalResult {
  ok: boolean;
  reversal?: JournalEntry;
  alreadyReversed?: boolean;
  message: string;
}

/**
 * Reverse a posted entry (medici void-style): the original STAYS in the
 * ledger untouched (the immutability guard forbids edits anyway) and an
 * equal-and-opposite reversal entry is appended, linked via `reversal_of`.
 * Because every report aggregates ALL posted entries, the pair nets to zero
 * automatically — no status flips, no report special-casing.
 *
 * Idempotent: an entry that already has a reversal returns it unchanged.
 * Reversing a reversal is rejected (would create an endless chain).
 */
export async function reverseEntry(
  schema: string,
  storeId: string,
  entryId: string,
  reason: string,
): Promise<ReversalResult> {
  const original = await getPostedEntryById(schema, storeId, entryId);
  if (!original) {
    return { ok: false, message: `Journal entry ${entryId} not found for this store.` };
  }
  if (original.status !== "posted") {
    return { ok: false, message: `Entry #${original.entry_number} is not posted (status: ${original.status}) — nothing to reverse.` };
  }
  if (original.reversal_of) {
    return { ok: false, message: `Entry #${original.entry_number} is itself a reversal — reversals cannot be reversed.` };
  }

  const existing = await getReversalOf(schema, entryId);
  if (existing) {
    return {
      ok: true,
      alreadyReversed: true,
      reversal: existing,
      message: `Entry #${original.entry_number} was already reversed by entry #${existing.entry_number} — no action taken (idempotent).`,
    };
  }

  const nextNumber = await nextEntryNumber(schema);
  const reversal = buildReversalEntry(original, nextNumber, reason);
  await persistEntries(schema, [reversal]);

  return {
    ok: true,
    reversal,
    message: `Entry #${original.entry_number} reversed by new entry #${reversal.entry_number} — ${reversal.lines.length} lines swapped (Dr↔Cr). Reason: ${reason.trim()}`,
  };
}

/**
 * Auto-reversal used by the webhook path: an `orders/cancelled` (or Salla
 * order.cancelled) event for an order that already posted journal entries
 * reverses EVERY posted entry referencing that order — the sale, the payment
 * collection (receivable settlement) and any refund entries — so every
 * account (AR, Cash, Revenue, Tax…) nets back to zero, not just the ledger
 * total. Entries are found by the order's external id in the entry reference
 * (sale/refund entries carry it directly; collection entries fall back to it
 * when no gateway payment id exists). Reversal entries themselves are
 * excluded (reversal_of IS NOT NULL) and the chain guard rejects re-reversal.
 */
export async function reverseEntriesForOrder(
  schema: string,
  storeId: string,
  orderExternalId: string,
  _entryNumbers: number[],
  reason: string,
): Promise<number> {
  const db = tenantDb(schema);
  const t = getTenantTables(schema);

  const rows = await db
    .select({ id: t.journalEntries.id, status: t.journalEntries.status })
    .from(t.journalEntries)
    .where(
      and(
        eq(t.journalEntries.storeId, storeId),
        eq(t.journalEntries.reference, orderExternalId),
      ),
    );

  let reversed = 0;
  for (const row of rows) {
    if (row.status !== "posted") continue; // safety: only posted entries
    const original = await getPostedEntryById(schema, storeId, row.id);
    if (!original || original.reversal_of) continue; // never reverse a reversal
    const result = await reverseEntry(schema, storeId, row.id, reason);
    if (result.ok && !result.alreadyReversed) reversed += 1;
  }
  void _entryNumbers; // kept for API compatibility (order row may list some)
  return reversed;
}
