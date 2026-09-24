"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { reverseJournalEntry } from "@/app/(app)/ledger/actions";

/**
 * ── Reverse button for posted journal entries ────────────────────────────────
 * ERPNext-style correction: prompts for a reason, posts an equal-and-opposite
 * entry linked via reversal_of, and refreshes the ledger. The original entry
 * is never touched (immutability guard).
 */
export function ReversalButton({ entryId, entryNumber }: { entryId: string; entryNumber: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [prompting, setPrompting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await reverseJournalEntry(entryId, reason);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPrompting(false);
    setDone(result.message);
    startTransition(() => router.refresh());
  }

  if (done) {
    return (
      <p className="max-w-md text-[11px] leading-snug text-emerald-400" title={done}>
        ✓ Reversed — JE-{String(entryNumber).padStart(4, "0")} offset by a new entry.
      </p>
    );
  }

  if (!prompting) {
    return (
      <Button
        variant="danger"
        size="sm"
        onClick={() => setPrompting(true)}
        disabled={busy || isPending}
        title="Post an equal-and-opposite correcting entry (the original is never edited)"
      >
        Reverse
      </Button>
    );
  }

  return (
    <div className="flex w-full min-w-72 flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3">
      <label className="text-[11px] font-medium text-amber-200" htmlFor={`reason-${entryId}`}>
        Reversal reason (required, kept on the audit trail)
      </label>
      <input
        id={`reason-${entryId}`}
        className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-amber-400 focus:outline-none"
        placeholder="e.g. duplicate order imported by mistake"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && reason.trim().length >= 3) void submit();
          if (e.key === "Escape") setPrompting(false);
        }}
        autoFocus
      />
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <Button variant="danger" size="sm" onClick={() => void submit()} disabled={busy || reason.trim().length < 3}>
          {busy ? "Posting reversal…" : "Post reversal"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setPrompting(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
