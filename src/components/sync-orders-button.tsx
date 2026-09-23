"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { syncShopifyOrders } from "@/app/(app)/orders/actions";

/**
 * Manual "Sync Shopify Orders" — pulls recent orders straight from the Shopify
 * Admin REST API using the store's Admin access token (shpat_…), so orders can
 * be imported at any time without depending on webhook delivery. Idempotent:
 * orders already in the ledger are skipped, never double-booked.
 */
export function SyncOrdersButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function handleSync() {
    setSyncing(true);
    setMessage(null);
    setIsError(false);

    const result = await syncShopifyOrders();

    setSyncing(false);
    if (!result.ok) {
      setIsError(true);
      setMessage(result.error);
      return;
    }

    const { fetched, imported, skipped, stores } = result.summary;
    const notes = stores
      .filter((s) => s.error || s.skippedNote)
      .map((s) => `${s.storeName}: ${s.error ?? s.skippedNote}`)
      .join(" · ");

    const headline =
      fetched === 0
        ? "No recent orders found in Shopify (last 30 days)."
        : `Synced from Shopify — ${imported} new order${imported === 1 ? "" : "s"} imported, ${skipped} already in the ledger.`;

    setMessage(notes ? `${headline} (${notes})` : headline);
    if (imported > 0) {
      startTransition(() => router.refresh());
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Button onClick={handleSync} disabled={syncing || isPending} variant="secondary" size="sm">
          {syncing ? "Syncing from Shopify…" : "Sync Shopify Orders"}
        </Button>
        <p className="text-xs text-zinc-500">
          Pulls the last 30 days directly from the Shopify Admin API (shpat_… token) — use when
          webhooks fail. Already-synced orders are never double-booked.
        </p>
      </div>
      {message && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            isError
              ? "border-red-500/30 bg-red-500/[0.06] text-red-300"
              : "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-300"
          }`}
        >
          {message}
        </div>
      )}
    </div>
  );
}
