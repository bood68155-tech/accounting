"use server";

import { revalidatePath } from "next/cache";
import { getTenantSchema } from "@/lib/tenants";
import { isTenantSchema } from "@/lib/db";
import { reverseEntry } from "@/lib/accounting/ledger";
import { fetchLedger } from "@/lib/data/repository";

// ─── Ledger page actions ──────────────────────────────────────────────────────
// ERPNext-style correction flow: a posted entry can never be edited or deleted
// (the DB immutability guard forbids it) — a reversal posts a NEW entry with
// every line swapped (Dr↔Cr), linked back via reversal_of, and the pair nets
// to zero in every report.
//
// Tenant scoping: the target entry is looked up through fetchLedger(), which
// resolves the signed-in user's store from the session — a forged entry id
// from another tenant simply won't be found.

export type ReversalActionResult =
  | { ok: true; message: string; reversalNumber: number }
  | { ok: false; error: string };

export async function reverseJournalEntry(
  entryId: string,
  reason: string,
): Promise<ReversalActionResult> {
  const schema = await getTenantSchema();
  if (!schema || !isTenantSchema(schema)) {
    return { ok: false, error: "No tenant context — sign in and try again." };
  }

  const trimmed = reason.trim();
  if (trimmed.length < 3) {
    return {
      ok: false,
      error: "A reason of at least 3 characters is required for the audit trail.",
    };
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entryId)) {
    return { ok: false, error: "Invalid journal entry id." };
  }

  try {
    // Ownership check: the entry must exist inside the signed-in tenant's
    // ledger (fetchLedger is scoped to the session's resolved store).
    const entries = await fetchLedger();
    const target = entries.find((e) => e.id === entryId);
    if (!target) {
      return {
        ok: false,
        error: "Journal entry not found in your ledger — it may belong to another store.",
      };
    }
    if (target.status !== "posted") {
      return {
        ok: false,
        error: `Entry JE-${String(target.entry_number).padStart(4, "0")} is not posted — nothing to reverse.`,
      };
    }

    const result = await reverseEntry(schema, target.store_id, entryId, trimmed);
    if (!result.ok) {
      return { ok: false, error: result.message };
    }

    revalidatePath("/ledger");
    revalidatePath("/orders");
    revalidatePath("/dashboard");
    revalidatePath("/reports/balance-sheet");
    revalidatePath("/reports/income-statement");
    return {
      ok: true,
      message: result.message,
      reversalNumber: result.reversal!.entry_number,
    };
  } catch (err) {
    console.error("[reversal] FAILED:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Reversal failed — please try again.",
    };
  }
}
