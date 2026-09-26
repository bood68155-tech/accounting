"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconTrendingDown } from "@/components/icons";
import { formatCompactCurrency } from "@/lib/utils";
import type { StoreAnalytics } from "@/lib/analytics/storeResearch";
import { updateAdSpend } from "@/app/(app)/stores/[id]/settings-actions";

/**
 * ── ROAS card (client) ───────────────────────────────────────────────────────
 * Shows net sales ÷ ad spend for the analyzed window. When ad spend is
 * configured, the amount is editable inline (persists to stores.config via
 * updateAdSpend and refreshes the server components). When it is not, the
 * card renders an input to connect it — replacing the static placeholder.
 */

const ROAS_INPUT_ID = "roas-ad-spend";

export function RoasCard({
  storeId,
  roas,
  adSpend,
  netSales,
  currency,
}: {
  storeId: string;
  /** null = no ad spend configured yet (input mode). */
  roas: number | null;
  adSpend: StoreAnalytics["adSpend"];
  netSales: number;
  currency: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Local state is initialized from the server value on mount only. When the
  // server value changes (after router.refresh()), the PARENT remounts this
  // card via a `key` derived from the amount — the canonical React pattern
  // for resetting state from props without effects or ref writes.
  const [editing, setEditing] = useState(roas == null);
  const [draft, setDraft] = useState(String(adSpend.amount ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    setSaved(null);
    const parsed = Number.parseFloat(draft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError("Ad spend must be a non-negative number.");
      return;
    }
    setSaving(true);
    const result = await updateAdSpend(storeId, parsed);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (parsed === 0) {
      setEditing(true);
      setDraft("");
      setSaved("Ad spend cleared — ROAS back to placeholder.");
    } else {
      setEditing(false);
      setSaved("Ad spend saved.");
    }
    startTransition(() => router.refresh());
  }

  function clearSpend() {
    setEditing(true);
    setDraft("");
    setError(null);
    setSaved(null);
  }

  const busy = saving || isPending;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
        <IconTrendingDown className="h-3.5 w-3.5 text-violet-400" /> Return on ad spend (ROAS)
      </p>

      {roas != null && !editing ? (
        <div className="mt-2.5">
          <p
            className={`text-2xl font-bold tabular-nums ${
              roas >= 3 ? "text-emerald-400" : roas >= 1.5 ? "text-amber-400" : "text-red-400"
            }`}
          >
            {roas.toFixed(2)}×
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">
            Net sales {formatCompactCurrency(netSales, currency)} ÷ ad spend{" "}
            {formatCompactCurrency(adSpend.amount ?? 0, currency)} ({adSpend.source})
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              className="text-[11px] font-medium text-emerald-400 transition-colors hover:text-emerald-300 disabled:opacity-50"
              onClick={() => {
                setEditing(true);
                setSaved(null);
              }}
              disabled={busy}
            >
              Edit amount
            </button>
            <button
              type="button"
              className="text-[11px] text-zinc-500 transition-colors hover:text-zinc-300 disabled:opacity-50"
              onClick={() => {
                setDraft("0");
                void save();
              }}
              disabled={busy}
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2.5">
          <label htmlFor={ROAS_INPUT_ID} className="text-[11px] leading-relaxed text-zinc-500">
            Enter your total ad spend for the last {""}
            window to unlock ROAS, blended-margin and CAC analytics.
          </label>
          <div className="mt-2 flex items-center gap-2">
            <input
              id={ROAS_INPUT_ID}
              type="number"
              step="0.01"
              min="0"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void save();
                }
              }}
              placeholder="0.00"
              disabled={busy}
              className="h-9 w-28 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 text-right text-sm tabular-nums text-zinc-100 placeholder:text-zinc-600 transition-colors focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
            />
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || draft === ""}
              className="inline-flex h-9 items-center rounded-xl bg-emerald-500 px-3 text-xs font-semibold text-emerald-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
            >
              {busy ? "Saving…" : roas == null ? "Connect" : "Save"}
            </button>
            {roas != null && (
              <button
                type="button"
                onClick={clearSpend}
                disabled={busy}
                className="text-[11px] text-zinc-500 transition-colors hover:text-zinc-300 disabled:opacity-50"
              >
                Cancel
              </button>
            )}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
            Stored per store in <code className="rounded bg-zinc-800 px-1 font-mono text-[10px]">stores.config.adSpend</code> — or wire an
            ads integration to update it automatically.
          </p>
        </div>
      )}

      {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
      {saved && !error && <p className="mt-2 text-[11px] text-emerald-400">{saved}</p>}
    </div>
  );
}
