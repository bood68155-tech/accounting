"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ReconnectStorePrompt } from "@/components/reconnect-store-prompt";
import { syncShopifyOrders } from "@/app/(app)/orders/actions";

/**
 * Manual "Sync Shopify Orders" — pulls recent orders straight from the Shopify
 * Admin REST API using the store's Admin access token (shpat_…), so orders can
 * be imported at any time without depending on webhook delivery. Idempotent:
 * orders already in the ledger are skipped, never double-booked.
 *
 * Auth failures (401 token dead / 403 missing read_orders scope) surface as a
 * reconnect/re-authorize prompt instead of a raw error string.
 */
export function SyncOrdersButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [reauth, setReauth] = useState<{
    storeName?: string;
    detail?: string;
    missingScopes?: string[];
  } | null>(null);

  async function handleSync() {
    setSyncing(true);
    setMessage(null);
    setIsError(false);
    setReauth(null);

    const result = await syncShopifyOrders();

    setSyncing(false);
    if (!result.ok) {
      setIsError(true);
      if (result.needsReauth) {
        setReauth({
          storeName: result.storeName,
          detail: result.error,
        });
        return;
      }
      setMessage(result.error);
      return;
    }

    const { fetched, imported, skipped, stores, needsReauth } = result.summary;

    // Mixed results: some store(s) failed auth while others synced — show the
    // reconnect prompt above the summary line.
    const authStore = stores.find((s) => s.needsReauth);
    if (needsReauth && authStore) {
      // Only show "missing scopes" chips when the scopes endpoint actually
      // reported the granted set (custom apps 404 there — nothing to compare).
      const granted = authStore.grantedScopes ?? [];
      const required = authStore.requiredScopes ?? [];
      const missingScopes =
        granted.length > 0
          ? required.filter((r) => !granted.some((g) => g.toLowerCase() === r.toLowerCase()))
          : undefined;
      setReauth({
        storeName: authStore.storeName,
        detail: authStore.error,
        missingScopes,
      });
    }

    const notes = stores
      .filter((s) => !s.needsReauth && (s.error || s.skippedNote))
      .map((s) => `${s.storeName}: ${s.error ?? s.skippedNote}`)
      .join(" · ");

    const headline =
      fetched === 0 && !needsReauth
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
      {reauth && (
        <ReconnectStorePrompt
          storeName={reauth.storeName}
          detail={reauth.detail}
          missingScopes={reauth.missingScopes}
          onRetry={handleSync}
          retrying={syncing}
        />
      )}
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
