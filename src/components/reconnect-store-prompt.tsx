"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * ── Re-authorization prompt for stores whose Shopify token failed ────────────
 * Shown when an order sync hits a 401 (token dead — app uninstalled or token
 * regenerated) or 403 (token missing read_orders/read_products scopes). Walks
 * the user through regenerating the Admin API token with the required scopes
 * and reconnecting the store, then offers to retry the sync.
 */
export function ReconnectStorePrompt({
  storeName,
  detail,
  missingScopes,
  onRetry,
  retrying,
}: {
  storeName?: string;
  detail?: string;
  missingScopes?: string[];
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4 text-sm">
      <p className="font-semibold text-amber-200">
        {storeName ? `${storeName} needs to be re-connected` : "A store needs to be re-connected"}
      </p>
      <p className="mt-1 text-amber-100/80">
        {detail ??
          "The store's Shopify Admin API token is invalid or missing required scopes (401/403)."}
      </p>

      {missingScopes && missingScopes.length > 0 && (
        <p className="mt-2 text-xs text-amber-100/70">
          Missing scopes:{" "}
          <span className="font-mono text-amber-200">{missingScopes.join(", ")}</span>
        </p>
      )}

      <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-amber-100/80">
        <li>
          In the Shopify admin open{" "}
          <span className="font-medium text-amber-200">Settings → Apps and sales channels → Develop apps</span>{" "}
          and select this app.
        </li>
        <li>
          Under <span className="font-medium text-amber-200">Configuration → Admin API integration</span> grant{" "}
          <span className="font-mono text-amber-200">read_orders</span> and{" "}
          <span className="font-mono text-amber-200">read_products</span>, then save.
        </li>
        <li>
          Reinstall the app (or rotate the token) under{" "}
          <span className="font-medium text-amber-200">API credentials</span> and copy the new{" "}
          <span className="font-mono text-amber-200">shpat_…</span> access token.
        </li>
        <li>
          Update the store&apos;s saved token in the app, then retry the sync.
        </li>
      </ol>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href="/stores"
          className="inline-flex h-9 items-center rounded-xl bg-amber-500 px-4 text-xs font-semibold text-amber-950 transition-colors hover:bg-amber-400"
        >
          Go to stores to update the token
        </Link>
        {onRetry && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onRetry}
            disabled={retrying}
          >
            {retrying ? "Retrying…" : "Retry sync"}
          </Button>
        )}
      </div>
    </div>
  );
}
